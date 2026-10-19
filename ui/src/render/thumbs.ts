// Small previews rendered with the real engine and shaders: preset cards,
// template gallery, modifier and shape pickers.
import { useEffect, useRef, useState } from 'react';
import { engine } from '../engine/client';
import type { Box, EngineDocument } from '../engine/types';
import type { Background, Project } from '../state/model';
import { useStore } from '../state/store';
import { buildScene } from '../state/tree';
import { Renderer, sceneItem, type SceneItem } from './renderer';

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

type Scene = { items: SceneItem[]; background: Background; w: number; h: number; px: number };

/**
 * One GPU job at a time, highest priority first. A queued thumbnail nobody
 * is waiting for any more (its card scrolled away or its dialog closed) is
 * dropped before it runs, so the queue never backs up behind offscreen work.
 */
interface Job {
  prio: number;
  wanted: number;
  run: () => Promise<void>;
  drop: () => void;
}
const queue: Job[] = [];
let busy = false;

function pump() {
  if (busy) return;
  let best = -1;
  for (let i = 0; i < queue.length; i++) if (best < 0 || queue[i].prio > queue[best].prio) best = i;
  if (best < 0) return;
  const [job] = queue.splice(best, 1);
  busy = true;
  void job.run().finally(() => {
    busy = false;
    pump();
  });
}

function draw(s: Scene) {
  const r = renderer();
  if (!r) return null;
  r.setArtboard(s.w, s.h);
  r.setBackground(s.background);
  r.setScene(s.items);
  return r.toCanvas(s.px / Math.max(s.w, s.h), false);
}

const cache = new Map<string, { promise: Promise<string | null>; job: Job | null }>();

/** Render a scene to a data URL, cached by `key`. Higher `prio` runs first. */
export function renderThumb(key: string, make: () => Promise<Scene>, prio = 0): Promise<string | null> {
  const hit = cache.get(key);
  if (hit) {
    if (hit.job) {
      hit.job.wanted++;
      hit.job.prio = Math.max(hit.job.prio, prio);
    }
    return hit.promise;
  }
  let job: Job | null = null;
  const promise = new Promise<string | null>((resolve) => {
    job = {
      prio,
      wanted: 1,
      run: async () => {
        const entry = cache.get(key);
        if (entry) entry.job = null;
        try {
          const c = draw(await make());
          resolve(c ? c.toDataURL('image/png') : null);
        } catch (e) {
          console.warn('thumbnail failed', key, e);
          cache.delete(key);
          resolve(null);
        }
      },
      drop: () => resolve(null),
    };
  });
  cache.set(key, { promise, job });
  queue.push(job!);
  pump();
  return promise;
}

/** Stop waiting for a thumbnail; if nobody else wants it and it hasn't started, it's dropped. */
function release(key: string) {
  const hit = cache.get(key);
  const job = hit?.job;
  if (!job || --job.wanted > 0) return;
  const i = queue.indexOf(job);
  if (i >= 0) queue.splice(i, 1);
  cache.delete(key);
  job.drop();
}

/** Render a scene to a PNG blob, uncached and ahead of thumbnails (project previews). */
export function renderSceneBlob(make: () => Promise<Scene>): Promise<Blob | null> {
  return new Promise((resolve) => {
    queue.push({
      prio: 10,
      wanted: 1,
      run: async () => {
        try {
          const c = draw(await make());
          resolve(c ? await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png')) : null);
        } catch (e) {
          console.warn('project preview failed', e);
          resolve(null);
        }
      },
      drop: () => resolve(null),
    });
    pump();
  });
}

export function useThumb(key: string | null, make: () => Promise<Scene>, prio = 0) {
  const [url, setUrl] = useState<string | null>(null);
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!key || !ready) return;
    let live = true;
    void renderThumb(key, make, prio).then((u) => live && setUrl(u));
    return () => {
      live = false;
      release(key);
    };
    // `make` is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return url;
}

/** True once the element has scrolled into view (and stays true). */
export function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') return setSeen(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** GPU preview of a whole project. */
export async function projectScene(p: Project, px: number) {
  const { doc, objects } = buildScene(p);
  const out = await engine.buildExact(doc);
  const items: SceneItem[] = objects.flatMap((o) => {
    const r = out.renders.find((x) => x.id === o.id);
    const clip = o.clip ? out.renders.find((x) => x.id === o.clip)?.d : null;
    return r && !o.guide ? [sceneItem(o.id, r, o.style, false, clip)] : [];
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
