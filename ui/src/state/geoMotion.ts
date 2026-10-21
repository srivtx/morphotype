// Geometry that moves on the scene clock: modifier and shape settings with a
// keyframe (a ParamAnim, like animated materials). Unlike motion and materials,
// these change the outline itself, so the layers that have them are rebuilt by
// the engine while the clock runs (see app/geoMotion.ts); everything else in
// the design is built once, as usual.
//
// Keys, on the node's `animate`:
//   mod:<uid>:<field>   a modifier's number field (layers and merged groups)
//   sym:<field>         a library shape's number field
import type { EngineDocument, ModEntry } from '../engine/types';
import { isChoice, isGroup, MODIFIER_UI, SYMBOL_UI, type Field, type Node, type NumberField, type Project, type ShapeLayer } from './model';
import { animatedValue, type ParamAnim } from './motion';
import { buildScene, walk } from './tree';

export type GeoAnims = Record<string, ParamAnim>;

export const modAnimKey = (uid: string, field: string) => `mod:${uid}:${field}`;
export const symAnimKey = (field: string) => `sym:${field}`;

/** Whether a keyframe still points at a number setting (its modifier may be gone, or the shape changed). */
function applies(n: Node, key: string): boolean {
  const m = /^mod:([^:]+):(.+)$/.exec(key);
  if (m) return typeof (n.modifiers.find((x) => x.uid === m[1]) as unknown as Record<string, unknown> | undefined)?.[m[2]] === 'number';
  if (!key.startsWith('sym:') || isGroup(n) || n.content.type !== 'symbol') return false;
  return typeof (n.content.symbol as unknown as Record<string, unknown>)[key.slice(4)] === 'number';
}

/** Whether a node has any moving geometry setting. */
export const hasGeoAnim = (n: Node) => !!n.animate && Object.keys(n.animate).some((k) => applies(n, k));

/** Whether anything in the tree has moving geometry. */
export function anyGeoAnim(nodes: Node[]): boolean {
  return nodes.some((n) => hasGeoAnim(n) || (isGroup(n) && anyGeoAnim(n.children)));
}

const numberField = (fields: Field[], key: string) => fields.find((f): f is NumberField => f.key === key && !isChoice(f));

/** A number setting at `t`: whole-number fields (counts, seeds) step. */
function valueAt(from: number, a: ParamAnim, t: number, loopLength: number | undefined, f: NumberField | undefined): number {
  if (typeof a.to !== 'number') return from;
  const v = animatedValue(from, a, t, loopLength) as number;
  return f?.integer ? Math.round(v) : v;
}

/** Modifiers with their animated fields at `t` (the same array when nothing applies). */
export function modifiersAt(mods: ModEntry[], anims: GeoAnims | undefined, t: number, loopLength?: number): ModEntry[] {
  let out = mods;
  for (const [k, a] of Object.entries(anims ?? {})) {
    const m = /^mod:([^:]+):(.+)$/.exec(k);
    if (!m) continue;
    const i = out.findIndex((x) => x.uid === m[1]);
    if (i < 0) continue;
    const from = (out[i] as unknown as Record<string, unknown>)[m[2]];
    if (typeof from !== 'number') continue;
    if (out === mods) out = mods.slice();
    out[i] = { ...out[i], [m[2]]: valueAt(from, a, t, loopLength, numberField(MODIFIER_UI[out[i].kind].fields, m[2])) } as ModEntry;
  }
  return out;
}

/** A layer's content with its animated shape fields at `t`. */
export function contentAt(c: ShapeLayer['content'], anims: GeoAnims | undefined, t: number, loopLength?: number): ShapeLayer['content'] {
  if (c.type !== 'symbol') return c;
  let symbol = c.symbol;
  for (const [k, a] of Object.entries(anims ?? {})) {
    if (!k.startsWith('sym:')) continue;
    const key = k.slice(4);
    const from = (symbol as unknown as Record<string, unknown>)[key];
    if (typeof from !== 'number') continue;
    symbol = { ...symbol, [key]: valueAt(from, a, t, loopLength, numberField(SYMBOL_UI[symbol.kind].fields, key)) };
  }
  return symbol === c.symbol ? c : { ...c, symbol };
}

/** A node as it is at `t` (the same object when it has no moving geometry). */
export function nodeAt<T extends Node>(n: T, t: number, loopLength?: number): T {
  if (!hasGeoAnim(n)) return n;
  if (isGroup(n)) return { ...n, modifiers: modifiersAt(n.modifiers, n.animate, t, loopLength) };
  const l = n as ShapeLayer;
  return { ...l, modifiers: modifiersAt(l.modifiers, l.animate, t, loopLength), content: contentAt(l.content, l.animate, t, loopLength) } as T;
}

function nodesAt(nodes: Node[], t: number, loopLength?: number): Node[] {
  let out = nodes;
  nodes.forEach((n, i) => {
    let m = nodeAt(n, t, loopLength);
    if (isGroup(m)) {
      const children = nodesAt(m.children, t, loopLength);
      if (children !== m.children) m = { ...m, children };
    }
    if (m === n) return;
    if (out === nodes) out = nodes.slice();
    out[i] = m;
  });
  return out;
}

/** The project's layers as they are at `t` (the same project when nothing moves). */
export function projectAt(p: Project, t: number, loopLength?: number): Project {
  const layers = nodesAt(p.layers, t, loopLength);
  return layers === p.layers ? p : { ...p, layers };
}

/** Ids of nodes whose outline changes over time: animated ones, and morphs of them. */
export function movingIds(p: Project): Set<string> {
  const ids = new Set<string>();
  walk(p.layers, (n) => {
    if (hasGeoAnim(n)) ids.add(n.id);
  });
  if (!ids.size) return ids;
  walk(p.layers, (n) => {
    if (!isGroup(n) && n.content.type === 'morph' && (ids.has(n.content.a) || ids.has(n.content.b))) ids.add(n.id);
  });
  return ids;
}

/**
 * An engine document for just the renders whose outline moves, built at `t`
 * (null when nothing moves): the animated layers, merged groups and morphs,
 * plus whatever layers those renders are made of (cuts, masks, sources).
 */
export function movingDocAt(p: Project, t: number, loopLength?: number, quality?: number, moving = movingIds(p)): EngineDocument | null {
  if (!moving.size) return null;
  const { doc } = buildScene(projectAt(p, t, loopLength), quality);
  const idOf = (m: string | { id: string }) => (typeof m === 'string' ? m : m.id);
  const renders = (doc.renders ?? []).filter((r) => moving.has(r.id) || r.members.some((m) => moving.has(idOf(m))));
  if (!renders.length) return null;
  const need = new Set(renders.flatMap((r) => r.members.map(idOf)));
  // Morphs need their sources.
  for (const l of doc.layers) if (need.has(l.id) && l.content.type === 'morph') need.add(l.content.a), need.add(l.content.b);
  return { layers: doc.layers.filter((l) => need.has(l.id)), renders, quality: doc.quality };
}

/** Drop keyframes whose modifier is gone (after removing a modifier). */
export function pruneGeoAnims(n: Node) {
  if (!n.animate) return;
  const uids = new Set(n.modifiers.map((m) => m.uid));
  for (const k of Object.keys(n.animate)) {
    const m = /^mod:([^:]+):/.exec(k);
    if (m && !uids.has(m[1])) delete n.animate[k];
  }
  if (!Object.keys(n.animate).length) delete n.animate;
}
