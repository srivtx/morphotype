import { useCallback, useEffect, useRef, useState } from 'react';
import { duplicateSelected, editPoints, editText, endTextEdit, finishDrawing, getRenderer, nodeBox, setRenderer, startText } from '../../app/actions';
import type { Box } from '../../engine/types';
import { Renderer, sceneItem, type SceneItem } from '../../render/renderer';
import { apply, invert, type Pt, type Xform } from '../../state/geometry';
import { isGroup, type Node, type ShapeLayer } from '../../state/model';
import { beginGesture, commitEdit, edit, select, store, toast, useStore } from '../../state/store';
import { allLayers, ancestors, buildScene, find, findNode, isLocked, isVisible, layersOf, topmost } from '../../state/tree';
import { boxesIntersect, hitLayer, resolveTarget, unionOf } from './hit';
import { Overlay, type Guide, type Handle } from './Overlay';
import { TextEditor } from './TextEditor';
import { Toolbar } from './Toolbar';
import { openContextMenu } from '../ContextMenu';

type Drag =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'marquee'; a: Pt; b: Pt; additive: boolean; base: string[] }
  | { kind: 'move'; start: Pt; moved: boolean; layers: Map<string, Pt>; box: Box | null; ids: string[] }
  | { kind: 'scale'; handle: Handle; start: Pt; layers: Map<string, Xform>; box: Box; single: { id: string; local: Box } | null }
  | { kind: 'rotate'; center: Pt; startAngle: number; layers: Map<string, Xform> }
  | { kind: 'draw' };

const xf = (l: ShapeLayer): Xform => ({ x: l.x, y: l.y, rotation: l.rotation, scale: l.scale, sx: l.sx ?? 1, sy: l.sy ?? 1 });

/** Push the latest build plus current styles into the renderer. */
export function syncScene(r: Renderer) {
  const s = store.get();
  const { objects } = buildScene(s.project);
  const renders = new Map((s.build?.renders ?? []).map((x) => [x.id, x]));
  const items: SceneItem[] = [];
  for (const o of objects) {
    const out = renders.get(o.id);
    if (out) items.push(sceneItem(o.id, out, o.style));
  }
  r.setScene(items);
  r.setBackground(s.project.background);
}

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [guides, setGuides] = useState<Guide[]>([]);
  /** Live readout next to the pointer while dragging. */
  const [hint, setHint] = useState<{ x: number; y: number; text: string } | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [cursor, setCursor] = useState<string>('default');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const build = useStore((s) => s.build);
  const project = useStore((s) => s.project);
  const canvasSize = project.canvas;
  const settings = useStore((s) => s.settings);
  const tool = useStore((s) => s.tool);
  const editing = useStore((s) => s.editing);
  const rerender = useCallback(() => setTick((n) => n + 1), []);

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
      rerender();
    });
    ro.observe(wrapRef.current!);
    return () => {
      ro.disconnect();
      r.dispose();
      setRenderer(null);
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fitted = useRef(true);
  const syncResolution = () => {
    const r = rendererRef.current;
    if (!r) return;
    const { w, h } = r.artboard;
    const q = store.get().settings.previewQuality;
    const k = q === 'fast' ? 0.6 : q === 'sharp' ? 1.25 : 1;
    r.setPreviewResolution(Math.max(w, h) * r.view.zoom * (window.devicePixelRatio || 1) * k);
  };
  const fit = (force = true) => {
    const r = rendererRef.current;
    const el = wrapRef.current;
    if (!r || !el) return;
    if (!force && !fitted.current) return;
    const { w, h } = r.artboard;
    const zoom = Math.min((el.clientWidth - 96) / w, (el.clientHeight - 140) / h);
    r.view = { zoom: Math.max(0.02, zoom), panX: 0, panY: -12 };
    fitted.current = true;
    syncResolution();
    r.invalidate();
    rerender();
  };
  const zoomAt = (zoom: number, mx = 0, my = 0) => {
    const r = rendererRef.current;
    if (!r) return;
    zoom = Math.min(32, Math.max(0.02, zoom));
    const k = zoom / r.view.zoom;
    r.view = { zoom, panX: mx - (mx - r.view.panX) * k, panY: my - (my - r.view.panY) * k };
    fitted.current = false;
    syncResolution();
    r.invalidate();
    rerender();
  };

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setArtboard(canvasSize.width, canvasSize.height);
    fit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize.width, canvasSize.height]);

  // Geometry or styles changed → update the GPU scene.
  useEffect(() => {
    const r = rendererRef.current;
    if (r) syncScene(r);
  }, [build, project.layers, project.background]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.checker = settings.checker;
    r.paused = settings.reduceMotion;
    syncResolution();
    r.invalidate();
  }, [settings.checker, settings.reduceMotion, settings.previewQuality]);

  useEffect(() => {
    const onFit = () => fit(true);
    const onZoom = (e: Event) => {
      const d = (e as CustomEvent<{ to?: number; by?: number; selection?: boolean }>).detail ?? {};
      const r = rendererRef.current;
      const el = wrapRef.current;
      if (!r || !el) return;
      if (d.selection) {
        const box = unionOf(store.get().selection.map((id) => findNode(store.get().project.layers, id)).map((n) => (n ? nodeBox(n) : null)));
        if (!box) return;
        const zoom = Math.min(8, Math.min((el.clientWidth - 160) / (box[2] - box[0] || 1), (el.clientHeight - 200) / (box[3] - box[1] || 1)));
        r.view = { zoom, panX: -((box[0] + box[2]) / 2) * zoom, panY: -((box[1] + box[3]) / 2) * zoom };
        fitted.current = false;
        syncResolution();
        r.invalidate();
        rerender();
      } else zoomAt(d.to ?? r.view.zoom * (d.by ?? 1));
    };
    window.addEventListener('mt-fit', onFit);
    window.addEventListener('mt-zoom', onZoom);
    return () => {
      window.removeEventListener('mt-fit', onFit);
      window.removeEventListener('mt-zoom', onZoom);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zoom with pinch / ⌘-scroll, pan with plain scroll (trackpad-friendly).
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        zoomAt(r.view.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
      } else {
        fitted.current = false;
        r.view = { ...r.view, panX: r.view.panX - e.deltaX, panY: r.view.panY - e.deltaY };
        r.invalidate();
        rerender();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t as HTMLElement | null)?.isContentEditable;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(true);
      if (e.code === 'Space' && !typing(e.target)) {
        setSpaceHeld(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
      if (e.key === 'Alt') setAltHeld(false);
    };
    const blur = () => (setAltHeld(false), setSpaceHeld(false));
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const drag = useRef<Drag | null>(null);
  // The live brush stroke is drawn straight into one SVG path (no React
  // renders, no engine work); the engine builds the real outline on release.
  const strokePts = useRef<[number, number, number][]>([]);
  const previewRef = useRef<SVGPathElement>(null);
  const drawPreview = () => {
    const r = rendererRef.current;
    const el = previewRef.current;
    if (!r || !el) return;
    const s = store.get().settings;
    let d = '';
    for (const [x, y] of strokePts.current) {
      const q = r.toScreen(x, y);
      d += `${d ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    }
    el.setAttribute('d', d);
    el.setAttribute('stroke', s.brushColor);
    el.setAttribute('stroke-width', String(Math.max(1, s.brushWidth * r.view.zoom)));
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const toArt = (e: { clientX: number; clientY: number }) => {
    const p = local(e);
    return rendererRef.current!.toArt(p.x, p.y);
  };

  // ---------- snapping ----------

  const snapMove = (box: Box, dx: number, dy: number, moving: Set<string>, skip: boolean): { dx: number; dy: number; guides: Guide[] } => {
    const s = store.get();
    const set = s.settings;
    if (!set.snap || skip) return { dx, dy, guides: [] };
    const r = rendererRef.current!;
    const tol = 6 / r.view.zoom;
    const W = s.project.canvas.width;
    const H = s.project.canvas.height;
    const xs: number[] = [];
    const ys: number[] = [];
    if (set.snapArtboard) {
      xs.push(-W / 2, 0, W / 2);
      ys.push(-H / 2, 0, H / 2);
    }
    if (set.snapObjects) {
      for (const o of s.build?.layers ?? []) {
        if (!o.bbox || moving.has(o.id) || !isVisible(s.project.layers, o.id)) continue;
        const b = o.bbox;
        xs.push(b[0], (b[0] + b[2]) / 2, b[2]);
        ys.push(b[1], (b[1] + b[3]) / 2, b[3]);
      }
    }
    const nb: Box = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy];
    const best = (cands: number[], mine: number[]) => {
      let out: { d: number; at: number } | null = null;
      for (const m of mine)
        for (const c of cands) {
          const d = c - m;
          if (Math.abs(d) <= tol && (!out || Math.abs(d) < Math.abs(out.d))) out = { d, at: c };
        }
      return out;
    };
    const gx = best(xs, [nb[0], (nb[0] + nb[2]) / 2, nb[2]]);
    const gy = best(ys, [nb[1], (nb[1] + nb[3]) / 2, nb[3]]);
    const guides: Guide[] = [];
    if (gx) {
      dx += gx.d;
      guides.push({ axis: 'x', at: gx.at });
    }
    if (gy) {
      dy += gy.d;
      guides.push({ axis: 'y', at: gy.at });
    }
    if (set.snapGrid && !gx) dx = Math.round((box[0] + dx) / set.gridSize) * set.gridSize - box[0];
    if (set.snapGrid && !gy) dy = Math.round((box[1] + dy) / set.gridSize) * set.gridSize - box[1];
    return { dx, dy, guides };
  };

  // ---------- pointer ----------

  const startMove = (start: Pt) => {
    const s = store.get();
    const ids = topmost(s.project.layers, s.selection).filter((id) => !isLocked(s.project.layers, id));
    const layers = new Map<string, Pt>();
    for (const id of ids) {
      const n = findNode(s.project.layers, id);
      if (n) for (const l of layersOf(n)) layers.set(l.id, { x: l.x, y: l.y });
    }
    const box = unionOf(ids.map((id) => findNode(s.project.layers, id)).map((n) => (n ? nodeBox(n) : null)));
    drag.current = { kind: 'move', start, moved: false, layers, box, ids };
    beginGesture();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const r = rendererRef.current;
    if (!r || e.button === 2) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    wrapRef.current?.focus({ preventScroll: true });
    const p = local(e);
    if (e.button === 1 || spaceHeld || store.get().tool === 'hand') {
      drag.current = { kind: 'pan', x: p.x, y: p.y };
      setCursor('grabbing');
      return;
    }
    const a = r.toArt(p.x, p.y);
    let s = store.get();
    if (s.tool === 'draw') {
      e.preventDefault();
      if (s.editing?.kind === 'text') endTextEdit();
      drag.current = { kind: 'draw' };
      strokePts.current = [[a.x, a.y, e.pointerType === 'pen' ? e.pressure : 0]];
      drawPreview();
      return;
    }
    if (s.tool === 'text') {
      // Keep the browser from moving focus back to the canvas after this click.
      e.preventDefault();
      const hit = hitLayer(s.project, s.build?.layers ?? [], a.x, a.y, 3 / r.view.zoom);
      if (s.editing?.kind === 'text') endTextEdit();
      if (hit?.content.type === 'text') editText(hit.id, a);
      else startText({ x: Math.round(a.x), y: Math.round(a.y) });
      store.set({ tool: 'select' });
      return;
    }
    if (s.editing?.kind === 'text') {
      // Clicking anywhere outside the text being typed finishes it.
      endTextEdit();
      s = store.get();
    }
    if (s.editing) {
      // Clicking outside the edited layer leaves editing.
      const hit = hitLayer(s.project, s.build?.layers ?? [], a.x, a.y, 4 / r.view.zoom);
      if (hit?.id !== s.editing.id) store.set({ editing: null });
      else return;
    }
    const hit = hitLayer(s.project, s.build?.layers ?? [], a.x, a.y, 3 / r.view.zoom);
    if (!hit) {
      drag.current = { kind: 'marquee', a, b: a, additive: e.shiftKey, base: e.shiftKey ? s.selection : [] };
      if (!e.shiftKey) select([]);
      return;
    }
    const target = resolveTarget(s.project, hit, s.selection, e.metaKey || e.ctrlKey);
    if (e.shiftKey) {
      select(s.selection.includes(target.id) ? s.selection.filter((x) => x !== target.id) : [...s.selection, target.id]);
      if (!store.get().selection.includes(target.id)) return;
    } else if (!s.selection.includes(target.id)) {
      select([target.id]);
    }
    if (e.altKey) {
      duplicateSelected(0);
    }
    startMove(a);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const a = toArt(e);
    const s = store.get();
    const hit = hitLayer(s.project, s.build?.layers ?? [], a.x, a.y, 3 / r.view.zoom);
    if (!hit) return;
    const chain: Node[] = [...ancestors(s.project.layers, hit.id), hit];
    const cur = s.selection.length === 1 ? chain.findIndex((n) => n.id === s.selection[0]) : -1;
    const next = chain[cur + 1];
    if (cur >= 0 && next && cur < chain.length - 1) {
      select([next.id]);
      return;
    }
    if (hit.content.type === 'text') editText(hit.id, a);
    else if (hit.content.type === 'path') void editPoints(hit.id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const d = drag.current;
    const p = local(e);
    const a = r.toArt(p.x, p.y);
    if (d?.kind === 'draw') {
      // Coalesced events keep fast strokes smooth; points closer than ~1.5 screen px are skipped.
      const pts = strokePts.current;
      const rect = (e.currentTarget as Element).getBoundingClientRect();
      const native = e.nativeEvent as PointerEvent;
      const evs = native.getCoalescedEvents?.() ?? [];
      let added = false;
      for (const ev of evs.length ? evs : [native]) {
        const q = r.toArt(ev.clientX - rect.left, ev.clientY - rect.top);
        const prev = pts[pts.length - 1];
        if (Math.hypot(q.x - prev[0], q.y - prev[1]) * r.view.zoom < 1.5) continue;
        pts.push([q.x, q.y, ev.pointerType === 'pen' ? ev.pressure : 0]);
        added = true;
      }
      if (added) drawPreview();
      return;
    }
    if (!d) {
      if (spaceHeld || store.get().tool === 'hand') return;
      const s = store.get();
      if (s.settings.hoverOutlines && !s.editing) {
        const hit = hitLayer(s.project, s.build?.layers ?? [], a.x, a.y, 3 / r.view.zoom);
        const target = hit ? resolveTarget(s.project, hit, s.selection, e.metaKey || e.ctrlKey) : null;
        if ((target?.id ?? null) !== s.hover) store.set({ hover: target?.id ?? null });
      }
      return;
    }
    if (d.kind === 'pan') {
      fitted.current = false;
      r.view = { ...r.view, panX: r.view.panX + p.x - d.x, panY: r.view.panY + p.y - d.y };
      d.x = p.x;
      d.y = p.y;
      r.invalidate();
      rerender();
    } else if (d.kind === 'marquee') {
      d.b = a;
      const box: Box = [Math.min(d.a.x, a.x), Math.min(d.a.y, a.y), Math.max(d.a.x, a.x), Math.max(d.a.y, a.y)];
      setMarquee(box);
      const s = store.get();
      // Select at the level of the current scope (top level by default).
      const scope = s.selection.length ? find(s.project.layers, s.selection[0])?.parent : null;
      const pool = (scope ? scope.children : s.project.layers).filter((n) => n.visible && !n.locked);
      const hits = pool.filter((n) => {
        const b = nodeBox(n);
        return b && boxesIntersect(b, box);
      });
      const ids = [...new Set([...d.base, ...hits.map((n) => n.id)])];
      if (ids.join() !== s.selection.join()) select(ids);
    } else if (d.kind === 'move') {
      let dx = a.x - d.start.x;
      let dy = a.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * r.view.zoom < 3) return;
      d.moved = true;
      if (e.shiftKey) {
        // Constrain to the dominant axis.
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      let g: Guide[] = [];
      if (d.box) {
        const res = snapMove(d.box, dx, dy, new Set(d.layers.keys()), e.metaKey || e.ctrlKey);
        dx = res.dx;
        dy = res.dy;
        g = res.guides;
      }
      setGuides(g);
      if (d.box) setHint({ x: p.x, y: p.y, text: `${dx >= 0 ? '+' : '−'}${Math.abs(Math.round(dx))}, ${dy >= 0 ? '+' : '−'}${Math.abs(Math.round(dy))}${e.shiftKey ? '' : ' · ⇧ one axis'}` });
      edit((proj) => {
        for (const l of allLayers(proj.layers)) {
          const st = d.layers.get(l.id);
          if (!st) continue;
          l.x = Math.round((st.x + dx) * 100) / 100;
          l.y = Math.round((st.y + dy) * 100) / 100;
        }
      }, 'canvas-move');
    } else if (d.kind === 'scale') {
      const corner = d.handle[0] !== 0 && d.handle[1] !== 0;
      const s = store.get();
      const only = d.single ? findNode(s.project.layers, d.single.id) : null;
      const text = !!only && !isGroup(only) && only.content.type === 'text';
      // Figma convention: ⇧ keeps proportions. Text never squashes from a corner.
      const uniform = corner ? text || (s.settings.keepRatio ? !e.shiftKey : e.shiftKey) : e.shiftKey;
      applyScale(d, a, uniform, e.altKey);
      setHint({ x: p.x, y: p.y, text: `${uniform ? 'Proportional' : '⇧ keeps proportions'} · ⌥ from centre` });
    } else if (d.kind === 'rotate') {
      let ang = ((Math.atan2(a.y - d.center.y, a.x - d.center.x) - d.startAngle) * 180) / Math.PI;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      setHint({ x: p.x, y: p.y, text: `${Math.round(ang)}°${e.shiftKey ? '' : ' · ⇧ snaps to 15°'}` });
      const rad = (ang * Math.PI) / 180;
      const c = Math.cos(rad);
      const sn = Math.sin(rad);
      edit((proj) => {
        for (const l of allLayers(proj.layers)) {
          const st = d.layers.get(l.id);
          if (!st) continue;
          const vx = st.x - d.center.x;
          const vy = st.y - d.center.y;
          l.x = d.center.x + vx * c - vy * sn;
          l.y = d.center.y + vx * sn + vy * c;
          l.rotation = ((((st.rotation + ang + 180) % 360) + 360) % 360) - 180;
        }
      }, 'canvas-rotate');
    }
  };

  const applyScale = (d: Extract<Drag, { kind: 'scale' }>, a: Pt, uniform: boolean, fromCenter: boolean) => {
    const [ix, iy] = d.handle;
    const corner = ix !== 0 && iy !== 0;
    if (d.single) {
      const st = d.layers.get(d.single.id)!;
      const L = d.single.local;
      const cx = (L[0] + L[2]) / 2;
      const cy = (L[1] + L[3]) / 2;
      const anchor = fromCenter ? { x: cx, y: cy } : { x: ix < 0 ? L[2] : ix > 0 ? L[0] : cx, y: iy < 0 ? L[3] : iy > 0 ? L[1] : cy };
      const hp = { x: ix < 0 ? L[0] : ix > 0 ? L[2] : cx, y: iy < 0 ? L[1] : iy > 0 ? L[3] : cy };
      const p = invert(st, a);
      let fx = ix !== 0 && hp.x !== anchor.x ? (p.x - anchor.x) / (hp.x - anchor.x) : 1;
      let fy = iy !== 0 && hp.y !== anchor.y ? (p.y - anchor.y) / (hp.y - anchor.y) : 1;
      let next: Xform;
      if (!corner && uniform) {
        // ⇧ on a side handle scales evenly from that side.
        const f = ix !== 0 ? fx : fy;
        next = { ...st, scale: st.scale * (Math.abs(f) < 0.01 ? 0.01 : Math.abs(f)) };
      } else if (corner && uniform) {
        const vx = hp.x - anchor.x;
        const vy = hp.y - anchor.y;
        const f = ((p.x - anchor.x) * vx + (p.y - anchor.y) * vy) / (vx * vx + vy * vy || 1);
        next = { ...st, scale: st.scale * (Math.abs(f) < 0.01 ? 0.01 * Math.sign(f || 1) : f) };
      } else {
        if (Math.abs(fx) < 0.01) fx = 0.01 * Math.sign(fx || 1);
        if (Math.abs(fy) < 0.01) fy = 0.01 * Math.sign(fy || 1);
        next = { ...st, sx: st.sx * fx, sy: st.sy * fy };
      }
      // Keep the anchor where it was.
      const A = apply(st, anchor);
      const moved = apply({ ...next, x: 0, y: 0 }, anchor);
      next.x = A.x - moved.x;
      next.y = A.y - moved.y;
      edit((proj) => {
        const l = findNode(proj.layers, d.single!.id);
        if (l && !isGroup(l)) {
          l.x = next.x;
          l.y = next.y;
          l.scale = next.scale;
          l.sx = next.sx;
          l.sy = next.sy;
        }
      }, 'canvas-scale');
      return;
    }
    const b = d.box;
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    const A = fromCenter ? { x: cx, y: cy } : { x: ix < 0 ? b[2] : ix > 0 ? b[0] : cx, y: iy < 0 ? b[3] : iy > 0 ? b[1] : cy };
    const Hx = ix < 0 ? b[0] : ix > 0 ? b[2] : cx;
    const Hy = iy < 0 ? b[1] : iy > 0 ? b[3] : cy;
    let fx = ix !== 0 ? (a.x - A.x) / (Hx - A.x || 1) : 1;
    let fy = iy !== 0 ? (a.y - A.y) / (Hy - A.y || 1) : 1;
    if (!corner && uniform) {
      if (ix !== 0) fy = Math.abs(fx);
      else fx = Math.abs(fy);
    } else if (corner && uniform) {
      const vx = Hx - A.x;
      const vy = Hy - A.y;
      const f = ((a.x - A.x) * vx + (a.y - A.y) * vy) / (vx * vx + vy * vy || 1);
      fx = fy = f;
    }
    fx = Math.abs(fx) < 0.01 ? 0.01 : fx;
    fy = Math.abs(fy) < 0.01 ? 0.01 : fy;
    edit((proj) => {
      for (const l of allLayers(proj.layers)) {
        const st = d.layers.get(l.id);
        if (!st) continue;
        l.x = A.x + (st.x - A.x) * fx;
        l.y = A.y + (st.y - A.y) * fy;
        if (fx === fy) {
          l.scale = st.scale * Math.abs(fx);
          l.sx = st.sx * Math.sign(fx);
          l.sy = st.sy * Math.sign(fy);
        } else {
          const rot = ((st.rotation % 180) + 180) % 180;
          if (rot < 1 || rot > 179) {
            l.sx = st.sx * fx;
            l.sy = st.sy * fy;
          } else if (Math.abs(rot - 90) < 1) {
            l.sx = st.sx * fy;
            l.sy = st.sy * fx;
          } else {
            l.scale = st.scale * Math.sqrt(Math.abs(fx * fy));
          }
        }
      }
    }, 'canvas-scale');
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'draw') {
      const pts = strokePts.current;
      strokePts.current = [];
      previewRef.current?.setAttribute('d', '');
      finishDrawing(pts);
      return;
    }
    setGuides([]);
    setHint(null);
    setMarquee(null);
    if (d?.kind === 'pan') setCursor('default');
    commitEdit();
  };

  /** Start a scale or rotate drag from an overlay handle. */
  const beginHandle = (kind: 'scale' | 'rotate', handle: Handle, e: React.PointerEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    e.stopPropagation();
    (wrapRef.current as Element).setPointerCapture(e.pointerId);
    const s = store.get();
    const ids = topmost(s.project.layers, s.selection).filter((id) => !isLocked(s.project.layers, id));
    const nodes = ids.map((id) => findNode(s.project.layers, id)).filter((n): n is Node => !!n);
    const layers = new Map<string, Xform>();
    for (const n of nodes) for (const l of layersOf(n)) layers.set(l.id, xf(l));
    const a = toArt(e);
    beginGesture();
    const only = nodes.length === 1 && !isGroup(nodes[0]) ? nodes[0] : null;
    const localBox = only ? s.build?.layers.find((o) => o.id === only.id)?.local : null;
    if (kind === 'rotate') {
      let center: Pt;
      if (only && localBox) center = apply(xf(only), { x: (localBox[0] + localBox[2]) / 2, y: (localBox[1] + localBox[3]) / 2 });
      else {
        const b = unionOf(nodes.map(nodeBox));
        if (!b) return;
        center = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
      }
      drag.current = { kind: 'rotate', center, startAngle: Math.atan2(a.y - center.y, a.x - center.x), layers };
    } else {
      const box = unionOf(nodes.map(nodeBox));
      if (!box) return;
      drag.current = { kind: 'scale', handle, start: a, layers, box, single: only && localBox ? { id: only.id, local: localBox } : null };
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const r = rendererRef.current;
    if (r) {
      const a = toArt(e);
      const s = store.get();
      const hit = hitLayer(s.project, s.build?.layers ?? [], a.x, a.y, 3 / r.view.zoom);
      if (hit) {
        const target = resolveTarget(s.project, hit, s.selection, e.metaKey || e.ctrlKey);
        if (!s.selection.includes(target.id)) select([target.id]);
      }
    }
    openContextMenu(e.clientX, e.clientY);
  };

  const r = rendererRef.current;
  const panning = spaceHeld || tool === 'hand';
  return (
    <div
      className={`viewport ${panning ? 'panning' : ''}`}
      ref={wrapRef}
      tabIndex={-1}
      style={{ cursor: panning ? (cursor === 'grabbing' ? 'grabbing' : 'grab') : tool === 'text' ? 'text' : tool === 'draw' ? 'crosshair' : cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => store.get().hover && store.set({ hover: null })}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} />
      <svg className="draw-preview" aria-hidden>
        <path ref={previewRef} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      </svg>
      {r && <Overlay renderer={r} tick={tick} guides={guides} marquee={marquee} editing={editing} onHandle={beginHandle} onCursor={setCursor} measure={altHeld && !drag.current} />}
      {hint && (
        <div className="drag-hint" style={{ left: hint.x + 16, top: hint.y + 18 }}>
          {hint.text}
        </div>
      )}
      {r && <TextEditor renderer={r} tick={tick} />}
      {failure && (
        <div className="gl-failure">
          <h3>GPU rendering isn't available</h3>
          <p>{failure}</p>
          <p>Shapes still build and SVG / font exports still work.</p>
        </div>
      )}
      <Toolbar zoom={r?.view.zoom ?? 1} onFit={() => fit(true)} onZoom={(z) => zoomAt(z)} />
      {build && (
        <div className="stat" aria-live="off">
          {build.points.toLocaleString()} pts · {build.ms.toFixed(1)} ms
        </div>
      )}
    </div>
  );
}

export { getRenderer };
