// Small previews rendered with the real engine and shaders: preset cards,
// template gallery, modifier and shape pickers.
import { useEffect, useState } from 'react';
import { engine } from '../engine/client';
import type { Box, EngineDocument } from '../engine/types';
import type { Background, Project } from '../state/model';
import { useStore } from '../state/store';
import { buildScene } from '../state/tree';
import { effectById } from './effects';
import { Renderer, type SceneItem } from './renderer';

let thumbRenderer: Renderer | null | undefined;
function renderer(): Renderer | null {
  if (thumbRenderer === undefined) {
    try {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      thumbRenderer = new Renderer(c);
      thumbRenderer.checker = false;
      thumbRenderer.paused = true;
    } catch {
      thumbRenderer = null;
    }
  }
  return thumbRenderer;
}

const cache = new Map<string, Promise<string | null>>();
let chain: Promise<unknown> = Promise.resolve();

/** Render a scene to a data URL. Calls are serialised and cached by `key`. */
export function renderThumb(key: string, make: () => Promise<{ items: SceneItem[]; background: Background; w: number; h: number; px: number }>): Promise<string | null> {
  const hit = cache.get(key);
  if (hit) return hit;
  const job = (chain = chain.then(async () => {
    const r = renderer();
    if (!r) return null;
    try {
      const s = await make();
      r.setArtboard(s.w, s.h);
      r.setBackground(s.background);
      r.setScene(s.items);
      const c = r.toCanvas(s.px / Math.max(s.w, s.h), false);
      return c.toDataURL('image/png');
    } catch (e) {
      console.warn('thumbnail failed', key, e);
      cache.delete(key);
      return null;
    }
  })) as Promise<string | null>;
  cache.set(key, job);
  return job;
}

export function useThumb(key: string | null, make: () => Promise<{ items: SceneItem[]; background: Background; w: number; h: number; px: number }>) {
  const [url, setUrl] = useState<string | null>(null);
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!key || !ready) return;
    let live = true;
    void renderThumb(key, make).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
    // `make` is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return url;
}

/** GPU preview of a whole project. */
export async function projectScene(p: Project, px: number) {
  const { doc, objects } = buildScene(p);
  const out = await engine.buildExact(doc);
  const items: SceneItem[] = objects.flatMap((o) => {
    const r = out.renders.find((x) => x.id === o.id);
    return r ? [{ id: o.id, d: r.d, bbox: r.bbox, effect: effectById(o.style.effect), params: o.style.params }] : [];
  });
  return { items, background: p.background, w: p.canvas.width, h: p.canvas.height, px };
}

/** Outline of a small engine document, for crisp SVG previews in pickers. */
export async function shapePreview(doc: EngineDocument): Promise<{ d: string; box: Box } | null> {
  const out = await engine.buildExact(doc);
  const r = out.renders[0];
  return r?.bbox ? { d: r.d, box: r.bbox } : null;
}

const shapeCache = new Map<string, Promise<{ d: string; box: Box } | null>>();
export function useShape(key: string, doc: () => EngineDocument) {
  const [v, setV] = useState<{ d: string; box: Box } | null>(null);
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    let p = shapeCache.get(key);
    if (!p) {
      p = shapePreview(doc()).catch(() => null);
      shapeCache.set(key, p);
    }
    void p.then((x) => {
      if (!x) shapeCache.delete(key);
      if (live) setV(x);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return v;
}

export function viewBoxOf(box: Box, pad = 0.08) {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const s = Math.max(w, h) * (1 + pad * 2);
  return `${(box[0] + box[2]) / 2 - s / 2} ${(box[1] + box[3]) / 2 - s / 2} ${s} ${s}`;
}
