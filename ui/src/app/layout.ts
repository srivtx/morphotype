// Layout: lay a set of shapes out as a row, a column, a grid or a fanned
// hand of cards, live from the Layout controls. Each change re-lays the
// shapes out from where they were before the first change, so dragging a
// slider back and forth never compounds; any other edit starts afresh.
import type { Box } from '../engine/types';
import { isGroup, type Node, type Project } from '../state/model';
import { edit, store } from '../state/store';
import { find, findNode, layersOf, topmost } from '../state/tree';
import { nodeBox } from './actions';

export type LayoutKind = 'row' | 'column' | 'grid' | 'fan';

export interface Layout {
  kind: LayoutKind;
  /** Space between neighbours, px (negative overlaps them). */
  gap: number;
  /** Grid columns. */
  cols: number;
  /** Fan: degrees from the first card to the last. */
  spread: number;
  /** Fan: how much the hand curves (0 = a straight line). */
  curve: number;
}

export const DEFAULT_LAYOUT: Layout = { kind: 'row', gap: 24, cols: 3, spread: 30, curve: 0.5 };

export interface Spot {
  /** Centre, relative to the set's centre. */
  x: number;
  y: number;
  /** Extra turn, degrees. */
  rotate: number;
}

/** Where each box goes (in order), centred on 0. */
export function layoutOf(boxes: Box[], L: Layout): Spot[] {
  const n = boxes.length;
  const ws = boxes.map((b) => b[2] - b[0]);
  const hs = boxes.map((b) => b[3] - b[1]);
  const spots: Spot[] = [];
  if (L.kind === 'row' || L.kind === 'column') {
    const along = L.kind === 'row' ? ws : hs;
    let at = 0;
    for (let i = 0; i < n; i++) {
      const c = at + along[i] / 2;
      spots.push(L.kind === 'row' ? { x: c, y: 0, rotate: 0 } : { x: 0, y: c, rotate: 0 });
      at += along[i] + L.gap;
    }
  } else if (L.kind === 'grid') {
    const cols = Math.max(1, Math.min(n, Math.round(L.cols)));
    const [cw, ch] = [Math.max(...ws), Math.max(...hs)];
    for (let i = 0; i < n; i++) spots.push({ x: (i % cols) * (cw + L.gap), y: Math.floor(i / cols) * (ch + L.gap), rotate: 0 });
  } else {
    // A hand of cards: turned evenly through the spread, centres on an arc
    // about a point below the hand (flatter as the curve goes to 0), and
    // stepped sideways by the gap.
    const h = Math.max(...hs);
    const radius = h / Math.max(0.02, L.curve);
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) - 0.5 : 0;
      const a = (L.spread * f * Math.PI) / 180;
      spots.push({ x: radius * Math.sin(a) + f * (n - 1) * L.gap, y: radius * (1 - Math.cos(a)), rotate: L.spread * f });
    }
  }
  // Centre the set on 0.
  const xs = spots.map((s) => s.x);
  const ys = spots.map((s) => s.y);
  const [mx, my] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return spots.map((s) => ({ ...s, x: s.x - mx, y: s.y - my }));
}

/** The shapes a layout moves: the selection, or one selected group's children. */
export function layoutTargets(p: Project, selection: string[]): Node[] {
  const ids = topmost(p.layers, selection);
  const nodes = ids.map((id) => findNode(p.layers, id)).filter((n): n is Node => !!n);
  if (nodes.length === 1 && isGroup(nodes[0])) return nodes[0].children;
  return nodes;
}

let snap: { key: string; after: Project | null; originals: Node[]; boxes: Box[]; centre: [number, number] } | null = null;

/** Lay the targets out. Returns false when there's nothing to arrange. */
export function arrange(L: Layout): boolean {
  const s = store.get();
  const nodes = layoutTargets(s.project, s.selection).filter((n) => !n.locked);
  const key = nodes.map((n) => n.id).join();
  // Start from the shapes as they were before the first change, unless something else changed them since.
  if (!snap || snap.key !== key || snap.after !== s.project) {
    const boxes = nodes.map((n) => nodeBox(n));
    if (nodes.length < 2 || boxes.some((b) => !b)) return false;
    const u = (boxes as Box[]).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    snap = { key, after: null, originals: nodes.map((n) => structuredClone(n)), boxes: boxes as Box[], centre: [(u[0] + u[2]) / 2, (u[1] + u[3]) / 2] };
  }
  const { originals, boxes, centre } = snap;
  // Rows read left to right, columns top to bottom, grids in reading order; a fan keeps the stacking order.
  const order = originals.map((_, i) => i);
  const mid = (i: number, axis: 0 | 1) => (boxes[i][axis] + boxes[i][axis + 2]) / 2;
  if (L.kind === 'row') order.sort((a, b) => mid(a, 0) - mid(b, 0));
  if (L.kind === 'column') order.sort((a, b) => mid(a, 1) - mid(b, 1));
  if (L.kind === 'grid') order.sort((a, b) => Math.round((mid(a, 1) - mid(b, 1)) / 8) || mid(a, 0) - mid(b, 0));
  const spots = layoutOf(
    order.map((i) => boxes[i]),
    L,
  );
  edit((p) => {
    order.forEach((i, k) => {
      const orig = originals[i];
      const f = find(p.layers, orig.id);
      if (!f) return;
      const n = structuredClone(orig);
      (f.parent ? f.parent.children : p.layers)[f.index] = n;
      const [cx, cy] = [mid(i, 0), mid(i, 1)];
      const [tx, ty] = [centre[0] + spots[k].x, centre[1] + spots[k].y];
      const r = (spots[k].rotate * Math.PI) / 180;
      const [c, s2] = [Math.cos(r), Math.sin(r)];
      for (const l of layersOf(n)) {
        // Turn about the shape's own centre, then move that centre to its spot.
        const [dx, dy] = [l.x - cx, l.y - cy];
        l.x = tx + dx * c - dy * s2;
        l.y = ty + dx * s2 + dy * c;
        l.rotation += spots[k].rotate;
      }
    });
  }, `layout:${key}`);
  snap.after = store.get().project;
  return true;
}
