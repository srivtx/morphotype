import { useEffect, useRef, useState } from 'react';
import { setRenderer, updateLayer } from '../app/actions';
import { Renderer } from '../render/renderer';
import { effectById } from '../render/effects';
import { store, toast, useStore } from '../state/store';

/** Hands the renderer to the rest of the app once the canvas exists. */
export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [, force] = useState(0);
  const build = useStore((s) => s.build);
  const effect = useStore((s) => s.project.effect);
  const canvasSize = useStore((s) => s.project.canvas);
  const selection = useStore((s) => s.selection);
  const transparent = useStore((s) => s.previewTransparent);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let r: Renderer;
    try {
      r = new Renderer(canvas);
    } catch (e) {
      setFailure((e as Error).message);
      return;
    }
    r.onError = (e) => {
      console.error(e);
      toast(`Rendering failed: ${e.message.split('\n')[0]}`, 'error');
    };
    rendererRef.current = r;
    setRenderer(r);
    const ro = new ResizeObserver(() => {
      fit(false);
      r.invalidate();
    });
    ro.observe(wrapRef.current!);
    return () => {
      ro.disconnect();
      r.dispose();
      setRenderer(null);
      rendererRef.current = null;
    };
  }, []);

  const fitted = useRef(true);
  const fit = (force = true) => {
    const r = rendererRef.current;
    const el = wrapRef.current;
    if (!r || !el) return;
    if (!force && !fitted.current) return;
    const { w, h } = r.artboard;
    const zoom = Math.min((el.clientWidth - 64) / w, (el.clientHeight - 64) / h);
    r.view = { zoom: Math.max(0.05, zoom), panX: 0, panY: 0 };
    fitted.current = true;
    syncResolution();
    r.invalidate();
    force && setTimeout(() => forceRender(), 0);
  };
  const forceRender = () => force((n) => n + 1);
  const syncResolution = () => {
    const r = rendererRef.current;
    if (!r) return;
    const { w, h } = r.artboard;
    r.setPreviewResolution(Math.max(w, h) * r.view.zoom * (window.devicePixelRatio || 1));
  };

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setArtboard(canvasSize.width, canvasSize.height);
    fit(true);
  }, [canvasSize.width, canvasSize.height]);

  useEffect(() => {
    rendererRef.current?.setGeometry(build?.d ?? '', build?.bbox ?? null);
  }, [build]);

  useEffect(() => {
    rendererRef.current?.setEffect(effectById(effect.id), effect.params);
  }, [effect]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.transparentPreview = transparent;
    r.invalidate();
  }, [transparent]);

  useEffect(() => {
    const onFit = () => fit(true);
    window.addEventListener('mt-fit', onFit);
    return () => window.removeEventListener('mt-fit', onFit);
  }, []);

  // Zoom with pinch / ⌘-scroll, pan with plain scroll (trackpad-friendly).
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      e.preventDefault();
      fitted.current = false;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left - rect.width / 2;
        const my = e.clientY - rect.top - rect.height / 2;
        const factor = Math.exp(-e.deltaY * 0.01);
        const zoom = Math.min(16, Math.max(0.05, r.view.zoom * factor));
        const k = zoom / r.view.zoom;
        r.view = { zoom, panX: mx - (mx - r.view.panX) * k, panY: my - (my - r.view.panY) * k };
        syncResolution();
      } else {
        r.view = { ...r.view, panX: r.view.panX - e.deltaX, panY: r.view.panY - e.deltaY };
      }
      r.invalidate();
      forceRender();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<null | { kind: 'pan' | 'move'; x: number; y: number; id?: string; lx?: number; ly?: number }>(null);
  const spaceDown = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        spaceDown.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && (spaceDown.current = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const local = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = local(e);
    if (e.button === 1 || spaceDown.current) {
      drag.current = { kind: 'pan', x: p.x, y: p.y };
      return;
    }
    const a = r.toArt(p.x, p.y);
    const s = store.get();
    const hits = (s.build?.layers ?? []).filter((o) => o.bbox && a.x >= o.bbox[0] && a.x <= o.bbox[2] && a.y >= o.bbox[1] && a.y <= o.bbox[3]);
    // Prefer the selected layer if it's under the pointer, otherwise the topmost.
    const hit = hits.find((h) => h.id === s.selection) ?? hits.at(-1);
    if (!hit) {
      drag.current = { kind: 'pan', x: p.x, y: p.y };
      return;
    }
    const layer = s.project.layers.find((l) => l.id === hit.id)!;
    store.set({ selection: hit.id });
    drag.current = { kind: 'move', x: p.x, y: p.y, id: hit.id, lx: layer.x, ly: layer.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const r = rendererRef.current;
    if (!d || !r) return;
    const p = local(e);
    if (d.kind === 'pan') {
      fitted.current = false;
      r.view = { ...r.view, panX: r.view.panX + p.x - d.x, panY: r.view.panY + p.y - d.y };
      d.x = p.x;
      d.y = p.y;
      r.invalidate();
      forceRender();
    } else if (d.id) {
      const dx = (p.x - d.x) / r.view.zoom;
      const dy = (p.y - d.y) / r.view.zoom;
      const snap = (v: number) => (e.shiftKey ? Math.round(v / 10) * 10 : Math.round(v));
      updateLayer(d.id, (l) => ((l.x = snap((d.lx ?? 0) + dx)), (l.y = snap((d.ly ?? 0) + dy))), 'drag');
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const r = rendererRef.current;
  const sel = build?.layers.find((l) => l.id === selection)?.bbox;
  let box: { x: number; y: number; w: number; h: number } | null = null;
  if (r && sel) {
    const ar = r.artRect();
    const z = r.view.zoom;
    const { w, h } = r.artboard;
    box = { x: ar.x + (sel[0] + w / 2) * z, y: ar.y + (sel[1] + h / 2) * z, w: (sel[2] - sel[0]) * z, h: (sel[3] - sel[1]) * z };
  }

  return (
    <div className="viewport" ref={wrapRef}>
      <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
      {box && <div className="sel-box" style={{ left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8 }} />}
      {failure && (
        <div className="gl-failure">
          <h3>GPU rendering isn't available</h3>
          <p>{failure}</p>
          <p>Shapes still build and SVG / font exports still work.</p>
        </div>
      )}
      <div className="view-tools">
        <button className="btn small" onClick={() => fit(true)} title="Fit artboard (⌘0)">
          Fit
        </button>
        <span className="zoom">{r ? Math.round(r.view.zoom * 100) : 0}%</span>
        <label className="check small" title="Preview transparency (affects PNG export option)">
          <input type="checkbox" checked={transparent} onChange={(e) => store.set({ previewTransparent: e.target.checked })} /> Transparent
        </label>
        {build && <span className="stat">{build.points.toLocaleString()} pts · {build.ms.toFixed(1)} ms</span>}
      </div>
    </div>
  );
}
