// Layout in words instead of pixel maths: fit a layer to a share of the
// canvas, put it at a spot (top, centre, the thirds, the corners) with a
// margin, stack or row several with a gap, centre by what's drawn. Every
// instruction is resolved against the engine's real build boxes, measure then
// place: fits change sizes (so they need a rebuild before anything is
// placed), and moves are exact, so places and stacks run in one pass.
//
// Everything here is pure: it takes the project and its boxes and returns
// assignments for edit.ts.
import type { Box } from '../engine/types';
import { isGroup, type Node, type Project, type ShapeLayer } from '../state/model';
import { EditError, findNode } from './find';

/** One layer (or group): fit it, place it, centre it, keep it inside the margins. */
export interface Placement {
  target: string;
  /** Long side of the fit, as % of the canvas width / height (both: it fits inside both). */
  fitWidth?: number;
  fitHeight?: number;
  /** top, centre, bottom, top third, bottom third, left, right, top left, top right, bottom left, bottom right. */
  place?: string;
  /** From the edge, px, or "6%" of the canvas's short side. */
  margin?: number | string;
  /** Centre by ink: x, y or both. */
  centre?: 'x' | 'y' | 'both';
  /** Shrink it if it's bigger than the canvas inside the margins, then move it inside them. */
  contain?: boolean;
  /** px, after placing. */
  offset?: [number, number];
}

/** Layers one under another (stack) or side by side (row), first listed first. */
export interface Stack {
  stack?: string[];
  row?: string[];
  gap?: number;
  /** Across the stack: start (left / top), centre or end. */
  align?: 'start' | 'centre' | 'end' | 'left' | 'right' | 'top' | 'bottom' | 'center' | 'middle';
  place?: string;
  margin?: number | string;
  offset?: [number, number];
}

export type LayoutOp = Placement | Stack;

export const isStack = (o: LayoutOp): o is Stack => 'stack' in o || 'row' in o;

type X = 'left' | 'centre' | 'right' | null;
type Y = 'top' | 'centre' | 'bottom' | 'top third' | 'bottom third' | null;

const SPOT_WORDS = 'top, centre, bottom, top third, bottom third, left, right, top left, top right, bottom left, bottom right';

/** A spot's two halves. One word means centred on the other axis ("top" is top centre). */
export function spot(s: string): { x: X; y: Y } {
  const w = s.toLowerCase().replace(/center|middle/g, 'centre').replace(/upper/g, 'top').replace(/lower/g, 'bottom').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  const table: Record<string, { x: X; y: Y }> = {
    centre: { x: 'centre', y: 'centre' },
    top: { x: 'centre', y: 'top' },
    bottom: { x: 'centre', y: 'bottom' },
    left: { x: 'left', y: 'centre' },
    right: { x: 'right', y: 'centre' },
    'top third': { x: 'centre', y: 'top third' },
    'bottom third': { x: 'centre', y: 'bottom third' },
  };
  if (table[w]) return table[w];
  const [a, b] = w.split(' ');
  const ys: Record<string, Y> = { top: 'top', bottom: 'bottom', centre: 'centre' };
  const xs: Record<string, X> = { left: 'left', right: 'right', centre: 'centre' };
  if (a in ys && b in xs) return { x: xs[b], y: ys[a] };
  if (a in xs && b in ys) return { x: xs[a], y: ys[b] };
  const third = /^(top|bottom) third (left|right)$/.exec(w);
  if (third) return { x: xs[third[2]], y: `${third[1]} third` as Y };
  throw new EditError(`No spot "${s}". Spots: ${SPOT_WORDS}`);
}

export const defaultMargin = (p: Project) => Math.round(Math.min(p.canvas.width, p.canvas.height) * 0.06);

export function marginOf(p: Project, m: number | string | undefined): number {
  if (m === undefined) return defaultMargin(p);
  if (typeof m === 'number') return m;
  const pc = /^\s*(-?[\d.]+)\s*%\s*$/.exec(m);
  if (pc) return (Math.min(p.canvas.width, p.canvas.height) * Number(pc[1])) / 100;
  if (Number.isFinite(Number(m))) return Number(m);
  throw new EditError(`margin is px or a % of the canvas ("6%"), got "${m}"`);
}

/** Where a w×h box goes for a spot: its left and top. null keeps that axis. */
function spotAt(p: Project, s: { x: X; y: Y }, w: number, h: number, m: number): [number | null, number | null] {
  const { width: W, height: H } = p.canvas;
  const x = s.x === 'left' ? -W / 2 + m : s.x === 'right' ? W / 2 - m - w : s.x === 'centre' ? -w / 2 : null;
  const y = s.y === 'top' ? -H / 2 + m : s.y === 'bottom' ? H / 2 - m - h : s.y === 'centre' ? -h / 2 : s.y === 'top third' ? -H / 6 - h / 2 : s.y === 'bottom third' ? H / 6 - h / 2 : null;
  return [x, y];
}

export type Boxes = Map<string, Box | null>;

/** Boxes by id from a build: leaves, and merged groups as one. */
export const boxesOf = (build: { layers?: { id: string; bbox: Box | null }[]; renders?: { id: string; bbox: Box | null }[] } | null): Boxes => new Map([...(build?.layers ?? []), ...(build?.renders ?? [])].map((l) => [l.id, l.bbox]));

const union = (bs: Box[]): Box | null => (bs.length ? bs.reduce<Box>((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]) : null);

/** What a node draws, as one box: its own, or its visible children's together. */
export function nodeBox(n: Node, boxes: Boxes): Box | null {
  if (!n.visible) return null;
  if (isGroup(n)) return (n.merge ? boxes.get(n.id) : null) ?? union(n.children.map((c) => nodeBox(c, boxes)).filter((b): b is Box => !!b));
  if (n.guide) return null;
  return boxes.get(n.id) ?? null;
}

/** The layers that actually move when a node moves (a group has no position of its own). */
function leaves(n: Node, out: ShapeLayer[] = []): ShapeLayer[] {
  if (isGroup(n)) n.children.forEach((c) => leaves(c, out));
  else out.push(n);
  return out;
}

const r2 = (v: number) => +v.toFixed(2);
const ref = (n: Node) => JSON.stringify('#' + n.id);

/** Assignments that move a node by dx, dy, and the boxes moved to match (so later steps see them). */
function moveBy(n: Node, dx: number, dy: number, boxes: Boxes, out: string[]) {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  for (const l of leaves(n)) {
    if (Math.abs(dx) >= 0.01) out.push(`${ref(l)}.x=${r2(l.x + dx)}`);
    if (Math.abs(dy) >= 0.01) out.push(`${ref(l)}.y=${r2(l.y + dy)}`);
    l.x += dx;
    l.y += dy;
  }
  const shift = (m: Node) => {
    const b = boxes.get(m.id);
    if (b) boxes.set(m.id, [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy]);
    if (isGroup(m)) m.children.forEach(shift);
  };
  shift(n);
}

/** Size a node by k about the centre of its box (which stays put): text, shapes and lines by their size, positions in a group spread with it. */
function scaleBy(n: Node, k: number, c: [number, number], out: string[]) {
  for (const l of leaves(n)) {
    out.push(`${ref(l)}.content.size=${r2((l.content as { size: number }).size * k)}`);
    const x = c[0] + (l.x - c[0]) * k, y = c[1] + (l.y - c[1]) * k;
    if (Math.abs(x - l.x) >= 0.01) out.push(`${ref(l)}.x=${r2(x)}`);
    if (Math.abs(y - l.y) >= 0.01) out.push(`${ref(l)}.y=${r2(y)}`);
  }
}

const sizeable = (n: Node) => leaves(n).every((l) => 'size' in l.content);

/**
 * Pass one: sizes. Fit to a share of the canvas, and contain (shrink only when
 * it's bigger than the canvas inside its margins). Needs a rebuild after.
 */
export function fitEdits(p0: Project, boxes: Boxes, ops: LayoutOp[]): string[] {
  const p = structuredClone(p0);
  const out: string[] = [];
  const { width: W, height: H } = p.canvas;
  for (const o of ops) {
    if (isStack(o) || (o.fitWidth === undefined && o.fitHeight === undefined && !o.contain)) continue;
    const n = findNode(p, o.target);
    const b = nodeBox(n, boxes);
    if (!b) throw new EditError(`${n.name ?? n.id} has no outline to fit`);
    if (!sizeable(n)) throw new EditError(`${n.name ?? n.id} can't be sized (strokes have no size)`);
    const w = b[2] - b[0], h = b[3] - b[1];
    const ks: number[] = [];
    if (o.fitWidth !== undefined) ks.push((W * o.fitWidth) / 100 / Math.max(1e-6, w));
    if (o.fitHeight !== undefined) ks.push((H * o.fitHeight) / 100 / Math.max(1e-6, h));
    if (o.contain) {
      const m = marginOf(p, o.margin);
      ks.push(Math.min(1, (W - 2 * m) / Math.max(1e-6, w), (H - 2 * m) / Math.max(1e-6, h)));
    }
    const k = Math.min(...ks);
    if (Math.abs(k - 1) > 0.002) scaleBy(n, k, [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], out);
  }
  return out;
}

/** Pass two: positions. Places, centring, containing and stacks, in the order given. */
export function placeEdits(p0: Project, boxes0: Boxes, ops: LayoutOp[]): string[] {
  const p = structuredClone(p0);
  const boxes: Boxes = new Map(boxes0);
  const out: string[] = [];
  const { width: W, height: H } = p.canvas;
  for (const o of ops) {
    if (isStack(o)) {
      stackOne(p, boxes, o, out);
      continue;
    }
    const n = findNode(p, o.target);
    const box = () => {
      const b = nodeBox(n, boxes);
      if (!b) throw new EditError(`${n.name ?? n.id} has no outline to place`);
      return b;
    };
    const m = marginOf(p, o.margin);
    if (o.place) {
      const b = box();
      const [x, y] = spotAt(p, spot(o.place), b[2] - b[0], b[3] - b[1], m);
      moveBy(n, x === null ? 0 : x - b[0], y === null ? 0 : y - b[1], boxes, out);
    }
    if (o.centre) {
      const b = box();
      moveBy(n, o.centre === 'y' ? 0 : -(b[0] + b[2]) / 2, o.centre === 'x' ? 0 : -(b[1] + b[3]) / 2, boxes, out);
    }
    if (o.contain) {
      const b = box();
      const dx = b[0] < -W / 2 + m ? -W / 2 + m - b[0] : b[2] > W / 2 - m ? W / 2 - m - b[2] : 0;
      const dy = b[1] < -H / 2 + m ? -H / 2 + m - b[1] : b[3] > H / 2 - m ? H / 2 - m - b[3] : 0;
      moveBy(n, dx, dy, boxes, out);
    }
    if (o.offset) moveBy(n, o.offset[0], o.offset[1], boxes, out);
  }
  return out;
}

function stackOne(p: Project, boxes: Boxes, o: Stack, out: string[]) {
  const row = !!o.row;
  const names = (row ? o.row : o.stack) ?? [];
  if (names.length < 2) throw new EditError(`a ${row ? 'row' : 'stack'} needs two layers or more`);
  const nodes = names.map((t) => findNode(p, t));
  const bs = nodes.map((n) => {
    const b = nodeBox(n, boxes);
    if (!b) throw new EditError(`${n.name ?? n.id} has no outline to stack`);
    return b;
  });
  const gap = o.gap ?? Math.round(Math.min(p.canvas.width, p.canvas.height) * 0.03);
  const al = o.align === 'left' || o.align === 'top' || o.align === 'start' ? 'start' : o.align === 'right' || o.align === 'bottom' || o.align === 'end' ? 'end' : 'centre';
  // Main axis 1 (y) for a stack, 0 (x) for a row; the cross axis is the other.
  const [ma, ca] = row ? [0, 1] : [1, 0];
  const len = (b: Box) => b[ma + 2] - b[ma];
  const wide = (b: Box) => b[ca + 2] - b[ca];
  const total = bs.reduce((s, b) => s + len(b), 0) + gap * (bs.length - 1);
  const across = Math.max(...bs.map(wide));
  const u = union(bs)!;
  // Where the block goes: its spot, or where its members are now.
  let start = (u[ma] + u[ma + 2]) / 2 - total / 2;
  let cross = (u[ca] + u[ca + 2]) / 2 - across / 2;
  if (o.place) {
    const [x, y] = spotAt(p, spot(o.place), row ? total : across, row ? across : total, marginOf(p, o.margin));
    const [m, c] = row ? [x, y] : [y, x];
    if (m !== null) start = m;
    if (c !== null) cross = c;
  }
  let at = start;
  nodes.forEach((n, i) => {
    const b = bs[i];
    const want = al === 'start' ? cross : al === 'end' ? cross + across - wide(b) : cross + (across - wide(b)) / 2;
    const d = [0, 0];
    d[ma] = at - b[ma];
    d[ca] = want - b[ca];
    if (o.offset) {
      d[0] += o.offset[0];
      d[1] += o.offset[1];
    }
    moveBy(n, d[0], d[1], boxes, out);
    at += len(b) + gap;
  });
}

/** Line layers up by their boxes: each edge of each target meets the same edge of `to` (the canvas or a layer). */
export function alignEdits(p0: Project, boxes: Boxes, targets: string[], to: string, edges: string[]): string[] {
  const p = structuredClone(p0);
  const { width: W, height: H } = p.canvas;
  const EDGES: Record<string, { axis: 0 | 1; at: (b: Box) => number }> = {
    left: { axis: 0, at: (b) => b[0] },
    right: { axis: 0, at: (b) => b[2] },
    centre: { axis: 0, at: (b) => (b[0] + b[2]) / 2 },
    top: { axis: 1, at: (b) => b[1] },
    bottom: { axis: 1, at: (b) => b[3] },
    middle: { axis: 1, at: (b) => (b[1] + b[3]) / 2 },
  };
  const target = to === 'canvas' ? ([-W / 2, -H / 2, W / 2, H / 2] as Box) : nodeBox(findNode(p, to), boxes);
  if (!target) throw new EditError(`${to} has no outline to align to`);
  const out: string[] = [];
  for (const t of targets) {
    const n = findNode(p, t);
    const b = nodeBox(n, boxes);
    if (!b) throw new EditError(`${n.name ?? n.id} has no outline to align`);
    const move = [0, 0];
    for (const e of edges) {
      const E = EDGES[e === 'center' ? 'centre' : e];
      if (!E) throw new EditError(`align edges are ${Object.keys(EDGES).join(', ')}; not "${e}"`);
      move[E.axis] = E.at(target) - E.at(b);
    }
    moveBy(n, move[0], move[1], boxes, out);
  }
  return out;
}

const LAYOUT_KEYS = new Set(['place', 'margin', 'fitWidth', 'fitHeight', 'fit', 'centre', 'center', 'contain', 'offset']);

/**
 * Layout written as assignments (`Title.place=top third`, `Title.fitWidth=80`,
 * `Info.margin=64`), taken out of a list of edits: one placement per layer,
 * and the edits that are left.
 */
export function layoutFromAssignments(assignments: string[]): { ops: Placement[]; rest: string[] } {
  const by = new Map<string, Placement>();
  const rest: string[] = [];
  for (const a of assignments) {
    const m = /^("[^"]+"|[^.=]+)\.([A-Za-z]+)=(.*)$/s.exec(a.trim());
    if (!m || !LAYOUT_KEYS.has(m[2])) {
      rest.push(a);
      continue;
    }
    const target = m[1].replace(/^"|"$/g, '');
    const o = by.get(target) ?? { target };
    by.set(target, o);
    setLayout(o, m[2], parse(m[3]));
  }
  return { ops: [...by.values()], rest };
}

const parse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s.trim();
  }
};

/** One layout key on a placement, checked. */
export function setLayout(o: Placement, key: string, v: unknown) {
  const number = (what: string) => {
    const n = typeof v === 'string' ? Number(v.replace(/%$/, '')) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new EditError(`${what} is a % of the canvas, like 80; got ${JSON.stringify(v)}`);
    return n;
  };
  if (key === 'place') {
    if (typeof v !== 'string') throw new EditError(`place is a spot: ${SPOT_WORDS}`);
    spot(v);
    o.place = v;
  } else if (key === 'margin') o.margin = v as number | string;
  else if (key === 'fitWidth') o.fitWidth = number('fitWidth');
  else if (key === 'fitHeight') o.fitHeight = number('fitHeight');
  else if (key === 'fit') {
    // fit="width 80%" | "height 30%" | 80 (width)
    const s = String(v).trim();
    const w = /^(width|w|height|h)?\s*([\d.]+)\s*%?$/i.exec(s);
    if (!w) throw new EditError(`fit is "width 80%" or "height 30%", got ${JSON.stringify(v)}`);
    if (w[1] && /^h/i.test(w[1])) o.fitHeight = Number(w[2]);
    else o.fitWidth = Number(w[2]);
  } else if (key === 'centre' || key === 'center') {
    const c = v === true ? 'both' : v === 'centre' || v === 'center' ? 'both' : v;
    if (c !== 'x' && c !== 'y' && c !== 'both') throw new EditError('centre is x, y or both (true)');
    o.centre = c;
  } else if (key === 'contain') o.contain = v !== false;
  else if (key === 'offset') {
    const xy = Array.isArray(v) ? v : String(v).split(',').map(Number);
    if (xy.length !== 2 || !xy.every((x) => Number.isFinite(Number(x)))) throw new EditError(`offset is x,y in px, got ${JSON.stringify(v)}`);
    o.offset = [Number(xy[0]), Number(xy[1])];
  }
}

/** A short line for each instruction, for the CLI to show what it did. */
export function layoutText(ops: LayoutOp[], p?: Project): string[] {
  const name = (t: string) => {
    try {
      return p ? (findNode(p, t).name ?? t) : t;
    } catch {
      return t;
    }
  };
  // Fits and places of one layer on one line.
  const merged: LayoutOp[] = [];
  for (const o of ops) {
    const same = !isStack(o) && merged.find((m): m is Placement => !isStack(m) && m.target === o.target);
    if (same) Object.assign(same, Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
    else merged.push({ ...o });
  }
  return merged.map((o) => {
    if (isStack(o)) return `${o.row ? 'row' : 'stack'} ${(o.row ?? o.stack ?? []).map(name).join(', ')}${o.gap !== undefined ? ` gap ${o.gap}` : ''}${o.place ? ` at ${o.place}` : ''}`;
    const bits = [o.fitWidth !== undefined && `fit ${o.fitWidth}% wide`, o.fitHeight !== undefined && `fit ${o.fitHeight}% tall`, o.place && `at ${o.place}${o.margin !== undefined ? ` (margin ${o.margin})` : ''}`, o.centre && `centred by ink (${o.centre})`, o.contain && 'kept inside the margins', o.offset && `nudged ${o.offset.join(',')}`].filter(Boolean);
    return `${name(o.target)}: ${bits.join(', ')}`;
  });
}
