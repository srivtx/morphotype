import { iconGridLines } from '../../state/icon';
import { nodeBox } from '../../app/actions';
import type { Box } from '../../engine/types';
import type { Renderer } from '../../render/renderer';
import { apply, boxCorners, type Pt } from '../../state/geometry';
import { isGroup, type Node } from '../../state/model';
import { useStore, type EditMode } from '../../state/store';
import { findNode, layersOf } from '../../state/tree';
import { unionOf } from './hit';
import { maskPath } from '../../state/icon';
import { PointEditor } from './PointEditor';
import { WarpEditor } from './WarpEditor';

export type Handle = [number, number];
export interface Guide {
  axis: 'x' | 'y';
  at: number;
}

const HANDLES: Handle[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M6 14a7 7 0 1 0 2-7" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M6 14a7 7 0 1 0 2-7" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round"/><path d="M4 4v4.5h4.5" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4v4.5h4.5" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}") 12 12, crosshair`;

function resizeCursor(angle: number) {
  const a = ((((angle * 180) / Math.PI) % 180) + 180) % 180;
  if (a < 22.5 || a >= 157.5) return 'ew-resize';
  if (a < 67.5) return 'nwse-resize';
  if (a < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

export function Overlay({
  renderer: r,
  tick,
  guides,
  marquee,
  editing,
  onHandle,
  onCursor,
  measure = false,
}: {
  renderer: Renderer;
  tick: number;
  guides: Guide[];
  marquee: Box | null;
  editing: EditMode;
  onHandle: (kind: 'scale' | 'rotate', h: Handle, e: React.PointerEvent) => void;
  onCursor: (c: string) => void;
  /** ⌥ held: show distances from the selection to what's under the pointer. */
  measure?: boolean;
}) {
  void tick;
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const build = useStore((s) => s.build);
  const settings = useStore((s) => s.settings);
  const z = r.view.zoom;
  const ar = r.artRect();
  const { w: W, h: H } = r.artboard;
  const tx = ar.x + (W / 2) * z;
  const ty = ar.y + (H / 2) * z;
  const S = (p: Pt) => ({ x: tx + p.x * z, y: ty + p.y * z });
  const outs = new Map((build?.layers ?? []).map((o) => [o.id, o]));

  const nodes = selection.map((id) => findNode(project.layers, id)).filter((n): n is Node => !!n);
  const outline = (n: Node | undefined, cls: string) =>
    n
      ? layersOf(n).map((l) => {
          const d = outs.get(l.id)?.d;
          return d ? <path key={`${cls}-${l.id}`} className={`${cls} ${l.op !== 'add' ? 'clip' : ''}`} d={d} vectorEffect="non-scaling-stroke" /> : null;
        })
      : null;

  // Selection frame: rotated for a single shape, axis-aligned otherwise.
  let quad: Pt[] | null = null;
  let size: { w: number; h: number } | null = null;
  const only = nodes.length === 1 && !isGroup(nodes[0]) ? nodes[0] : null;
  const localBox = only ? outs.get(only.id)?.local : null;
  if (only && localBox) {
    const t = { x: only.x, y: only.y, rotation: only.rotation, scale: only.scale, sx: only.sx ?? 1, sy: only.sy ?? 1 };
    quad = boxCorners(localBox).map((p) => apply(t, p));
    size = { w: Math.abs((localBox[2] - localBox[0]) * t.scale * t.sx), h: Math.abs((localBox[3] - localBox[1]) * t.scale * t.sy) };
  } else if (nodes.length) {
    const b = unionOf(nodes.map(nodeBox));
    if (b) {
      quad = boxCorners(b);
      size = { w: b[2] - b[0], h: b[3] - b[1] };
    }
  }
  const sq = quad?.map(S);
  const locked = nodes.some((n) => n.locked);
  const showHandles = sq && !editing && !locked && (sq[1].x - sq[0].x) ** 2 + (sq[1].y - sq[0].y) ** 2 > 16;
  const centre = sq ? { x: (sq[0].x + sq[2].x) / 2, y: (sq[0].y + sq[2].y) / 2 } : null;
  const handlePos = (h: Handle): Pt => {
    const q = sq!;
    // Bilinear interpolation over the quad (corners TL, TR, BR, BL).
    const u = (h[0] + 1) / 2;
    const v = (h[1] + 1) / 2;
    const top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u };
    const bot = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
    return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
  };

  const editLayer = editing ? findNode(project.layers, editing.id) : undefined;

  // ⌥ distances: selection to the hovered layer, or to the artboard edges.
  const measures: { a: Pt; b: Pt; label: string }[] = [];
  const selBox = measure && nodes.length ? unionOf(nodes.map(nodeBox)) : null;
  if (selBox) {
    const hn = hover && !selection.includes(hover) ? findNode(project.layers, hover) : undefined;
    const other: Box = (hn && nodeBox(hn)) || [-W / 2, -H / 2, W / 2, H / 2];
    const A = selBox;
    const cy = (Math.max(A[1], other[1]) + Math.min(A[3], other[3])) / 2;
    const cx = (Math.max(A[0], other[0]) + Math.min(A[2], other[2])) / 2;
    const midY = Math.max(A[1], other[1]) <= Math.min(A[3], other[3]) ? cy : (A[1] + A[3]) / 2;
    const midX = Math.max(A[0], other[0]) <= Math.min(A[2], other[2]) ? cx : (A[0] + A[2]) / 2;
    const push = (a: Pt, b: Pt) => {
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (d > 0.5) measures.push({ a, b, label: String(Math.round(d)) });
    };
    // Horizontal gaps.
    if (A[2] <= other[0]) push({ x: A[2], y: midY }, { x: other[0], y: midY });
    else if (other[2] <= A[0]) push({ x: other[2], y: midY }, { x: A[0], y: midY });
    else {
      if (other[0] < A[0]) push({ x: other[0], y: midY }, { x: A[0], y: midY });
      if (A[2] < other[2]) push({ x: A[2], y: midY }, { x: other[2], y: midY });
    }
    // Vertical gaps.
    if (A[3] <= other[1]) push({ x: midX, y: A[3] }, { x: midX, y: other[1] });
    else if (other[3] <= A[1]) push({ x: midX, y: other[3] }, { x: midX, y: A[1] });
    else {
      if (other[1] < A[1]) push({ x: midX, y: other[1] }, { x: midX, y: A[1] });
      if (A[3] < other[3]) push({ x: midX, y: A[3] }, { x: midX, y: other[3] });
    }
  }

  return (
    <svg className="overlay" width="100%" height="100%">
      {settings.grid && (
        <g className="grid">
          <defs>
            <pattern id="mt-grid" width={settings.gridSize * z} height={settings.gridSize * z} patternUnits="userSpaceOnUse" x={ar.x} y={ar.y}>
              <path d={`M ${settings.gridSize * z} 0 L 0 0 0 ${settings.gridSize * z}`} fill="none" />
            </pattern>
          </defs>
          <rect x={ar.x} y={ar.y} width={ar.w} height={ar.h} fill="url(#mt-grid)" />
        </g>
      )}
      <rect className="artboard-edge" x={ar.x - 0.5} y={ar.y - 0.5} width={ar.w + 1} height={ar.h + 1} />
      <text className="artboard-label" x={ar.x} y={ar.y - 8}>
        {project.name} <tspan>{W} × {H}</tspan>
      </text>
      {settings.iconGrid && (
        <g className="icon-grid" transform={`matrix(${z},0,0,${z},${tx},${ty})`}>
          {iconGridLines(Math.min(W, H)).map((l, i) => (
            <path key={i} d={`M${l.pts.map((p) => p.join(',')).join('L')}${l.closed ? 'Z' : ''}`} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      )}
      <g transform={`matrix(${z},0,0,${z},${tx},${ty})`}>
        {hover && !selection.includes(hover) && !editing && outline(findNode(project.layers, hover), 'hover-outline')}
        {!editing && nodes.map((n) => outline(n, 'sel-outline'))}
      </g>
      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <line key={i} className="guide" x1={tx + g.at * z} x2={tx + g.at * z} y1={ar.y - 2000} y2={ar.y + ar.h + 2000} />
        ) : (
          <line key={i} className="guide" y1={ty + g.at * z} y2={ty + g.at * z} x1={ar.x - 2000} x2={ar.x + ar.w + 2000} />
        ),
      )}
      {sq && !editing && <polygon className={`sel-frame ${locked ? 'locked' : ''}`} points={sq.map((p) => `${p.x},${p.y}`).join(' ')} />}
      {showHandles &&
        centre &&
        HANDLES.map((h) => {
          const p = handlePos(h);
          const ang = Math.atan2(p.y - centre.y, p.x - centre.x);
          const corner = h[0] !== 0 && h[1] !== 0;
          return (
            <g key={h.join()}>
              {corner && (
                <circle
                  className="rotate-zone"
                  cx={p.x + Math.cos(ang) * 12}
                  cy={p.y + Math.sin(ang) * 12}
                  r={11}
                  style={{ cursor: ROTATE_CURSOR }}
                  onPointerDown={(e) => onHandle('rotate', h, e)}
                />
              )}
              <rect
                className={`handle ${corner ? 'corner' : 'edge'}`}
                x={p.x - 4}
                y={p.y - 4}
                width={8}
                height={8}
                rx={corner ? 2 : 4}
                style={{ cursor: resizeCursor(ang) }}
                onPointerDown={(e) => onHandle('scale', h, e)}
                onPointerEnter={() => onCursor(resizeCursor(ang))}
                onPointerLeave={() => onCursor('default')}
              />
            </g>
          );
        })}
      {sq && size && !editing && (
        <g className="size-badge" transform={`translate(${(sq[2].x + sq[3].x) / 2}, ${Math.max(sq[2].y, sq[3].y) + 18})`}>
          <rect x={-38} y={-11} width={76} height={20} rx={6} />
          <text textAnchor="middle" y={3}>
            {Math.round(size.w)} × {Math.round(size.h)}
          </text>
        </g>
      )}
      {measures.map((m, i) => {
        const a = S(m.a);
        const b = S(m.b);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const w = m.label.length * 7 + 12;
        return (
          <g key={i} className="measure">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <rect x={mx - w / 2} y={my - 9} width={w} height={18} rx={5} />
            <text x={mx} y={my + 4} textAnchor="middle">
              {m.label}
            </text>
          </g>
        );
      })}
      {settings.iconMask && (
        <g className="icon-mask" pointerEvents="none">
          <path d={`M${ar.x},${ar.y}h${ar.w}v${ar.h}h${-ar.w}Z ${maskPath(Math.min(ar.w, ar.h), ar.x + ar.w / 2, ar.y + ar.h / 2)}`} fillRule="evenodd" />
          <path className="icon-mask-line" d={maskPath(Math.min(ar.w, ar.h), ar.x + ar.w / 2, ar.y + ar.h / 2)} />
        </g>
      )}
      {marquee && (
        <rect className="marquee" x={tx + marquee[0] * z} y={ty + marquee[1] * z} width={(marquee[2] - marquee[0]) * z} height={(marquee[3] - marquee[1]) * z} />
      )}
      {editing?.kind === 'points' && editLayer && !isGroup(editLayer) && <PointEditor layer={editLayer} toScreen={S} zoom={z} renderer={r} />}
      {editing?.kind === 'warp' && editLayer && !isGroup(editLayer) && <WarpEditor layer={editLayer} uid={editing.uid} frame={outs.get(editLayer.id)?.frames.find((f) => f.uid === editing.uid)?.bbox ?? null} toScreen={S} renderer={r} />}
    </svg>
  );
}
