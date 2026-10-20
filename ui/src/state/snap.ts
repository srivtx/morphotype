// Point snapping for drawing and point editing: onto points, onto lines
// through them (smart guides), artboard and layer edges, or the grid.
import type { Pt } from './geometry';

export interface SnapGuide {
  axis: 'x' | 'y';
  at: number;
}

export interface SnapTargets {
  /** Vertical lines to snap x onto. */
  xs: number[];
  /** Horizontal lines to snap y onto. */
  ys: number[];
  /** Points to land on exactly; their x and y also act as guides. */
  points: Pt[];
}

export const noTargets = (): SnapTargets => ({ xs: [], ys: [], points: [] });

/**
 * Snap `p` within `tol`: onto a point if one is that close, otherwise x and y
 * separately onto the nearest guide line; axes left free round to `grid`
 * (0 = no grid). Returns the guides used, for drawing.
 */
export function snapPoint(p: Pt, t: SnapTargets, tol: number, grid = 0): { p: Pt; guides: SnapGuide[] } {
  let hit: Pt | null = null;
  let best = tol;
  for (const q of t.points) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= best) (best = d), (hit = q);
  }
  if (hit) return { p: { x: hit.x, y: hit.y }, guides: [{ axis: 'x', at: hit.x }, { axis: 'y', at: hit.y }] };
  const nearest = (v: number, lines: number[]) => {
    let out: number | null = null;
    for (const l of lines) if (Math.abs(l - v) <= tol && (out === null || Math.abs(l - v) < Math.abs(out - v))) out = l;
    return out;
  };
  const gx = nearest(p.x, [...t.xs, ...t.points.map((q) => q.x)]);
  const gy = nearest(p.y, [...t.ys, ...t.points.map((q) => q.y)]);
  const guides: SnapGuide[] = [];
  if (gx !== null) guides.push({ axis: 'x', at: gx });
  if (gy !== null) guides.push({ axis: 'y', at: gy });
  const free = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
  return { p: { x: gx ?? free(p.x), y: gy ?? free(p.y) }, guides };
}

type Box = [number, number, number, number];

export interface SpacingTargets {
  /** Where the moving box's start edge (left / top) would leave a gap equal to one already there. */
  start: number[];
  /** Same for its end edge (right / bottom). */
  end: number[];
  /** Where its centre sits halfway between two neighbours. */
  centre: number[];
}

/**
 * Equal-spacing targets along `axis` for `box` among `others` in the same
 * row (x) or column (y): halfway between two neighbours, or one existing gap
 * away from a neighbour, as in Figma's spacing guides.
 */
export function spacingTargets(box: Box, others: Box[], axis: 'x' | 'y'): SpacingTargets {
  const [s, e, ps, pe] = axis === 'x' ? [0, 2, 1, 3] : [1, 3, 0, 2];
  // Neighbours share some of the box's extent across the axis.
  const row = others.filter((o) => o[ps] < box[pe] && o[pe] > box[ps]).sort((a, b) => a[s] - b[s]);
  const size = box[e] - box[s];
  const out: SpacingTargets = { start: [], end: [], centre: [] };
  const gaps: number[] = [];
  for (let i = 0; i < row.length; i++)
    for (let j = i + 1; j < row.length; j++) {
      const gap = row[j][s] - row[i][e];
      if (gap <= 0) continue;
      if (j === i + 1) gaps.push(gap);
      if (gap > size) out.centre.push((row[i][e] + row[j][s]) / 2);
    }
  for (const g of gaps)
    for (const o of row) {
      out.start.push(o[e] + g);
      out.end.push(o[s] - g);
    }
  return out;
}

/** Edge positions that would make a box anchored at `anchor` exactly as long as one of `sizes`, growing in direction `dir` (±1). */
export function sizeTargets(anchor: number, dir: number, sizes: number[]): number[] {
  return sizes.filter((v) => v > 0).map((v) => anchor + dir * v);
}
