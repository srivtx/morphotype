// The pen: click for corner points, drag for smooth curves (handles mirror),
// click the first point to close a filled shape, Enter or Esc to finish an
// open line, ⌫ to take back the last point, ⇧ for 45° steps. The path lives
// here until it's finished, so drawing never touches the document or engine.
import { useEffect, useSyncExternalStore } from 'react';
import { finishPen } from '../../app/actions';
import type { Node as GNode, Pt } from '../../state/geometry';
import { setSettings, store, useStore } from '../../state/store';
import type { Renderer } from '../../render/renderer';
import { ColorChip } from '../ColorPicker';
import { QUICK_COLORS } from '../../render/palette';

interface PenState {
  nodes: GNode[];
  cursor: Pt | null;
  /** The node whose handles are being dragged out. */
  dragging: number | null;
}

let state: PenState = { nodes: [], cursor: null, dragging: null };
const listeners = new Set<() => void>();
const set = (s: Partial<PenState>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};
const usePen = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);

/** Screen distance (px) within which a click closes the path on its first point. */
const CLOSE_PX = 9;

function snap45(from: Pt, p: Pt): Pt {
  const a = Math.round(Math.atan2(p.y - from.y, p.x - from.x) / (Math.PI / 4)) * (Math.PI / 4);
  const r = Math.hypot(p.x - from.x, p.y - from.y);
  return { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
}

export function penActive() {
  return state.nodes.length > 0;
}

/** Pointer down with the pen. Returns true if it closed the path. */
export function penDown(a: Pt, zoom: number, shift: boolean): boolean {
  const ns = state.nodes;
  const first = ns[0];
  if (ns.length >= 2 && Math.hypot(a.x - first.x, a.y - first.y) * zoom < CLOSE_PX) {
    finish(true);
    return true;
  }
  const p = shift && ns.length ? snap45(ns[ns.length - 1], a) : a;
  set({ nodes: [...ns, { x: p.x, y: p.y }], dragging: ns.length, cursor: p });
  return false;
}

/** Dragging after a click pulls out mirrored handles: a smooth point. */
export function penDrag(a: Pt, zoom: number) {
  const i = state.dragging;
  if (i === null) return;
  const n = state.nodes[i];
  if (Math.hypot(a.x - n.x, a.y - n.y) * zoom < 2) return;
  const nodes = state.nodes.slice();
  nodes[i] = { x: n.x, y: n.y, hout: { x: a.x, y: a.y }, hin: { x: 2 * n.x - a.x, y: 2 * n.y - a.y } };
  set({ nodes, cursor: a });
}

export function penUp() {
  set({ dragging: null });
}

export function penHover(a: Pt, shift: boolean) {
  const ns = state.nodes;
  set({ cursor: shift && ns.length ? snap45(ns[ns.length - 1], a) : a });
}

function finish(closed: boolean) {
  const nodes = state.nodes;
  set({ nodes: [], cursor: null, dragging: null });
  if (nodes.length >= 2) finishPen(nodes, closed);
}

/** Path preview, the pen's bar and its keys. Mounted while the pen tool is on. */
export function PenOverlay({ renderer }: { renderer: Renderer | null }) {
  const p = usePen();
  const s = useStore((x) => x.settings);
  useStore((x) => x.project.canvas);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state.nodes.length) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(false);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopImmediatePropagation();
        set({ nodes: state.nodes.slice(0, -1) });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Leaving the pen keeps what was drawn, as an open line.
      finish(false);
    };
  }, []);
  const r = renderer;
  const S = (q: Pt) => (r ? r.toScreen(q.x, q.y) : q);
  let d = '';
  p.nodes.forEach((n, k) => {
    const q = S(n);
    if (k === 0) return void (d += `M${q.x} ${q.y}`);
    const a = p.nodes[k - 1];
    const c1 = S(a.hout ?? a);
    const c2 = S(n.hin ?? n);
    d += `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${q.x} ${q.y}`;
  });
  const last = p.nodes[p.nodes.length - 1];
  let band = '';
  if (last && p.cursor && p.dragging === null) {
    const a = S(last);
    const c1 = S(last.hout ?? last);
    const b = S(p.cursor);
    band = `M${a.x} ${a.y}C${c1.x} ${c1.y} ${b.x} ${b.y} ${b.x} ${b.y}`;
  }
  const first = p.nodes[0];
  const nearStart = !!(first && p.cursor && p.nodes.length >= 2 && r && Math.hypot(p.cursor.x - first.x, p.cursor.y - first.y) * r.view.zoom < CLOSE_PX);
  const width = Math.max(1, s.penWidth * (r?.view.zoom ?? 1));
  return (
    <>
      <svg className="pen-preview" width="100%" height="100%">
        {d && <path className="pen-stroke" d={d} stroke={s.penColor} strokeWidth={width} />}
        {d && <path className="pen-path" d={d} />}
        {band && <path className="pen-band" d={band} />}
        {last?.hout && last.hin && (
          <g className="pen-handles">
            <line x1={S(last.hin).x} y1={S(last.hin).y} x2={S(last.hout).x} y2={S(last.hout).y} />
            <circle cx={S(last.hin).x} cy={S(last.hin).y} r={3} />
            <circle cx={S(last.hout).x} cy={S(last.hout).y} r={3} />
          </g>
        )}
        {p.nodes.map((n, i) => {
          const q = S(n);
          return <rect key={i} className={`pen-node ${i === 0 && nearStart ? 'close' : ''}`} x={q.x - 3.5} y={q.y - 3.5} width={7} height={7} />;
        })}
      </svg>
      <div className="edit-pill brush-bar pen-bar" role="toolbar" aria-label="Pen">
        <span className="pen-hint">{nearStart ? 'Click to close the shape' : p.nodes.length ? 'Click: corner · drag: curve · Enter: finish line · ⌫: undo point' : 'Click to place points, drag for curves. Click the first point to close a shape.'}</span>
        <label className="brush-width" data-tip="Line width for open paths">
          <input type="range" min={1} max={120} step={0.5} value={s.penWidth} onChange={(e) => setSettings({ penWidth: Number(e.target.value) })} aria-label="Line width" />
          <span>{Math.round(s.penWidth)}</span>
        </label>
        <ColorChip label="Pen colour" value={s.penColor} onChange={(v) => setSettings({ penColor: v })} />
        <div className="brush-colors">
          {QUICK_COLORS.slice(0, 6).map((c) => (
            <button key={c} className="quick-color" style={{ background: c }} aria-label={`Pen ${c}`} onClick={() => setSettings({ penColor: c })} />
          ))}
        </div>
        <button className="link-btn" onClick={() => store.set({ tool: 'select' })}>
          Done <kbd>Esc</kbd>
        </button>
      </div>
    </>
  );
}
