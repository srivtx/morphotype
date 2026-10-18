import type { EngineDocument, EngineLayer, Member, Op, RenderSpec } from '../engine/types';
import { isGroup, type Group, type Node, type Project, type ShapeLayer, type Style } from './model';

export interface Found {
  node: Node;
  parent: Group | null;
  siblings: Node[];
  index: number;
}

export function find(nodes: Node[], id: string, parent: Group | null = null): Found | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return { node: n, parent, siblings: nodes, index: i };
    if (isGroup(n)) {
      const f = find(n.children, id, n);
      if (f) return f;
    }
  }
  return null;
}

export function findNode(nodes: Node[], id: string | null | undefined): Node | undefined {
  return id ? find(nodes, id)?.node : undefined;
}

/** Depth-first, bottom to top. */
export function walk(nodes: Node[], fn: (n: Node, parent: Group | null, depth: number) => void, parent: Group | null = null, depth = 0) {
  for (const n of nodes) {
    fn(n, parent, depth);
    if (isGroup(n)) walk(n.children, fn, n, depth + 1);
  }
}

export function allLayers(nodes: Node[]): ShapeLayer[] {
  const out: ShapeLayer[] = [];
  walk(nodes, (n) => {
    if (!isGroup(n)) out.push(n);
  });
  return out;
}

export function layersOf(n: Node): ShapeLayer[] {
  return isGroup(n) ? allLayers(n.children) : [n];
}

/** Groups from the root down to (not including) the node. */
export function ancestors(nodes: Node[], id: string): Group[] {
  const path: Group[] = [];
  const rec = (list: Node[]): boolean => {
    for (const n of list) {
      if (n.id === id) return true;
      if (isGroup(n)) {
        path.push(n);
        if (rec(n.children)) return true;
        path.pop();
      }
    }
    return false;
  };
  return rec(nodes) ? path : [];
}

export function isLocked(nodes: Node[], id: string): boolean {
  const f = find(nodes, id);
  if (!f) return false;
  return !!f.node.locked || ancestors(nodes, id).some((g) => g.locked);
}

export function isVisible(nodes: Node[], id: string): boolean {
  const f = find(nodes, id);
  if (!f) return false;
  return f.node.visible && ancestors(nodes, id).every((g) => g.visible);
}

/** Remove nodes by id; returns them in tree order. */
export function removeNodes(nodes: Node[], ids: Set<string>): Node[] {
  const removed: Node[] = [];
  const rec = (list: Node[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (ids.has(n.id)) {
        removed.unshift(list.splice(i, 1)[0]);
      } else if (isGroup(n)) {
        rec(n.children);
      }
    }
  };
  rec(nodes);
  return removed;
}

export function childrenOf(nodes: Node[], parentId: string | null): Node[] | null {
  if (parentId === null) return nodes;
  const p = findNode(nodes, parentId);
  return isGroup(p) ? p.children : null;
}

/** Whether `id` is `ancestor` or inside it. */
export function contains(ancestor: Node, id: string): boolean {
  if (ancestor.id === id) return true;
  return isGroup(ancestor) && ancestor.children.some((c) => contains(c, id));
}

/** Drop ids whose ancestor is also listed, keeping tree order. */
export function topmost(nodes: Node[], ids: string[]): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  walk(nodes, (n) => {
    if (set.has(n.id) && !ancestors(nodes, n.id).some((g) => set.has(g.id))) out.push(n.id);
  });
  return out;
}

// ---------- scene: tree → engine document ----------

export interface SceneObject {
  id: string;
  style: Style;
}

/** Strip UI-only fields so style edits don't trigger geometry rebuilds. */
/** Modifiers that move letters around; paused while typing on the canvas so the caret lines up. */
export const POSITIONAL = new Set(['slant', 'stretch', 'wave', 'arc', 'warp', 'perspective', 'fitCircle', 'repeat', 'isometric']);

function engineLayer(l: ShapeLayer, visible: boolean, typing = false): EngineLayer {
  return {
    id: l.id,
    visible,
    op: l.op,
    x: l.x,
    y: l.y,
    rotation: l.rotation,
    scale: l.scale,
    sx: l.sx ?? 1,
    sy: l.sy ?? 1,
    modifiers: typing ? l.modifiers.filter((m) => !POSITIONAL.has(m.kind)) : l.modifiers,
    content: l.content,
  };
}

/** Member refs for every visible layer under a node; `force` overrides their ops. */
function members(n: Node, force?: Op): Member[] {
  if (!n.visible) return [];
  if (!isGroup(n)) {
    const op = force ?? n.op;
    return [op === n.op ? n.id : { id: n.id, op }];
  }
  const f = force ?? (n.op !== 'add' ? n.op : undefined);
  return n.children.flatMap((c) => members(c, f));
}

/**
 * Turn the layer tree into engine renders. Each visible shape or merged group
 * becomes one styled object. A Cut or Mask node doesn't render by itself: it
 * clips the nearest non-clipping sibling below it (every object inside, if
 * that sibling is a group), like clipping masks in Photoshop.
 */
export function buildScene(p: Project, quality?: number, typing?: string | null): { doc: EngineDocument; objects: SceneObject[] } {
  const layers: EngineLayer[] = [];
  const renders: RenderSpec[] = [];
  const objects: SceneObject[] = [];
  walk(p.layers, (n) => {
    if (!isGroup(n)) layers.push(engineLayer(n, isVisible(p.layers, n.id), n.id === typing));
  });
  const rec = (nodes: Node[], hidden: boolean): RenderSpec[] => {
    const made: RenderSpec[] = [];
    let base: RenderSpec[] = [];
    for (const n of nodes) {
      const off = hidden || !n.visible;
      if (n.op !== 'add') {
        const cut = off ? [] : members(n, n.op);
        for (const r of base) r.members.push(...cut);
        continue;
      }
      if (isGroup(n) && n.merge) {
        const r: RenderSpec = { id: n.id, members: off ? [] : n.children.flatMap((c) => members(c)), modifiers: n.modifiers };
        if (!off) {
          made.push(r);
          objects.push({ id: n.id, style: n.style });
        }
        base = off ? [] : [r];
      } else if (isGroup(n)) {
        const sub = rec(n.children, off);
        made.push(...sub);
        base = sub;
      } else {
        if (off) {
          base = [];
          continue;
        }
        const r: RenderSpec = { id: n.id, members: [n.id] };
        made.push(r);
        objects.push({ id: n.id, style: n.style });
        base = [r];
      }
    }
    return made;
  };
  renders.push(...rec(p.layers, false));
  // Objects were collected depth-first in paint order already.
  return { doc: { layers, renders, quality }, objects };
}

/** The node a clipping node clips into (nearest non-clipping sibling below), if any. */
export function clipBase(siblings: Node[], index: number): Node | null {
  for (let i = index - 1; i >= 0; i--) if (siblings[i].op === 'add') return siblings[i];
  return null;
}
