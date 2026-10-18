import type { Box, LayerOut } from '../../engine/types';
import { isGroup, type Node, type Project, type ShapeLayer } from '../../state/model';
import { allLayers, ancestors, find, isLocked, isVisible } from '../../state/tree';

const paths = new Map<string, Path2D>();
const ctx = document.createElement('canvas').getContext('2d')!;

export function pathOf(d: string): Path2D {
  let p = paths.get(d);
  if (!p) {
    if (paths.size > 600) paths.clear();
    p = new Path2D(d);
    paths.set(d, p);
  }
  return p;
}

/** Topmost visible, unlocked layer under an artboard point. */
export function hitLayer(p: Project, outs: LayerOut[], x: number, y: number, tolerance: number): ShapeLayer | null {
  const layers = allLayers(p.layers);
  const byId = new Map(outs.map((o) => [o.id, o]));
  ctx.lineWidth = tolerance * 2;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const o = byId.get(l.id);
    if (!o?.d || !o.bbox) continue;
    const b = o.bbox;
    if (x < b[0] - tolerance || x > b[2] + tolerance || y < b[1] - tolerance || y > b[3] + tolerance) continue;
    if (!isVisible(p.layers, l.id) || isLocked(p.layers, l.id)) continue;
    const path = pathOf(o.d);
    if (ctx.isPointInPath(path, x, y, 'nonzero') || ctx.isPointInStroke(path, x, y)) return l;
  }
  return null;
}

/**
 * Which node a click on `layer` should select: the outermost group, unless
 * the selection is already inside a group on that path (then its child), or
 * `deep` (⌘-click) asks for the layer itself.
 */
export function resolveTarget(p: Project, layer: ShapeLayer, selection: string[], deep: boolean): Node {
  if (deep) return layer;
  const chain: Node[] = [...ancestors(p.layers, layer.id), layer];
  // Deepest group on the chain that contains, or is the parent of, the selection.
  let scopeIndex = -1;
  for (const id of selection) {
    const f = find(p.layers, id);
    if (!f) continue;
    const parents = [...ancestors(p.layers, id)];
    for (let k = chain.length - 1; k >= 0; k--) {
      const c = chain[k];
      if (isGroup(c) && (parents.some((g) => g.id === c.id) || c.id === id)) {
        // Selecting inside c → pick c's child on the chain; selecting c itself keeps c.
        const idx = c.id === id ? k - 1 : k;
        scopeIndex = Math.max(scopeIndex, idx);
        break;
      }
    }
  }
  return chain[Math.min(scopeIndex + 1, chain.length - 1)];
}

export function boxesIntersect(a: Box, b: Box) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function unionOf(boxes: (Box | null | undefined)[]): Box | null {
  let u: Box | null = null;
  for (const b of boxes) {
    if (!b) continue;
    u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : [...b];
  }
  return u;
}
