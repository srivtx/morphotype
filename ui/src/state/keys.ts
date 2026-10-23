// Free keyframes: any number of keys per property, each at its own time on
// the scene clock with its own value and its own curve into it, like Figma
// Motion's or After Effects' keys. Presets (motion.ts) stay the quick path;
// keys are the "more control" layer, and the two act together: a layer can
// float and follow keys. Evaluation lives in motion.ts (keyedValue, keyPose).
//
// Where keys live:
//   node.keys.x | y | rotation | scale       the transform: absolute values, as the
//                                            Inspector shows them (a group: offsets from rest)
//   node.keys.opacity                        the style's opacity (a group: a fade)
//   node.keys["mod:<uid>:<field>"], ["sym:<field>"], ["morph:t"], ["line:start|end|offset"]
//                                            geometry, rebuilt like geoMotion.ts's cycles
//   node.style.keys[<param>]                 a material setting (numbers and colours)
//
// A property holds its first key's value before it and its last key's after
// it; on a looping timeline it jumps back to the first at the seam. A setting
// with both a cycle (`animate`) and keys follows its keys: keys win, and the
// Inspector keeps the two exclusive (a key drops the cycle, a cycle drops the
// keys).
//
// Once a property has keys, changing it (on the canvas or in the Inspector)
// writes a key at the playhead instead (`keyEdits`, run on every edit). With
// autokey on, changing a property without keys starts them: its old value at
// 0 s and the new one at the playhead.
import { effectById, type ParamDef } from '../render/effects';
import { isChoice, isGroup, MODIFIER_UI, SYMBOL_UI, type Field, type Node, type Project } from './model';
import { EASES, FEELS, keyedValue, type Bezier, type Key, type KeyedTransform, type Transition, KEY_EASE } from './motion';

export type { Key };
export type KeyTracks = Record<string, Key[]>;
export type KeyScope = 'node' | 'style';

export const TRANSFORM_PROPS = ['x', 'y', 'rotation', 'scale', 'opacity'] as const;
export type TransformProp = (typeof TRANSFORM_PROPS)[number];
export const TRANSFORM_LABELS: Record<TransformProp, string> = { x: 'Position X', y: 'Position Y', rotation: 'Rotation', scale: 'Scale', opacity: 'Opacity' };
export const isTransformProp = (k: string): k is TransformProp => (TRANSFORM_PROPS as readonly string[]).includes(k);

/** Keys within half a frame of a time are "at" it. */
export const KEY_SNAP = 1 / 60;

/** Times land on whole frames (30 a second, as video export renders). */
export const onFrame = (t: number) => Math.max(0, Math.round(t * 30) / 30);

const live = (b: KeyTracks | undefined) => !!b && Object.values(b).some((k) => k.length > 0);

/** Whether a node has keys of its own (transform, geometry or material). */
export const hasKeys = (n: Node) => live(n.keys) || live(n.style.keys);

/** Whether anything in the tree has keys. */
export function anyKeys(nodes: Node[]): boolean {
  return nodes.some((n) => hasKeys(n) || (isGroup(n) && anyKeys(n.children)));
}

/** The latest key in the tree (0 without any). */
export function lastKeyTime(nodes: Node[]): number {
  let t = 0;
  for (const n of nodes) {
    for (const k of [...Object.values(n.keys ?? {}), ...Object.values(n.style.keys ?? {})]) if (k.length) t = Math.max(t, k[k.length - 1].t);
    if (isGroup(n)) t = Math.max(t, lastKeyTime(n.children));
  }
  return t;
}

/** A node's transform keys as the renderer applies them (null without any). */
export function transformKeysOf(n: Node): KeyedTransform | null {
  const k = n.keys;
  if (!k) return null;
  const group = isGroup(n);
  const props = group ? TRANSFORM_PROPS : TRANSFORM_PROPS.filter((p) => p !== 'opacity');
  if (!props.some((p) => k[p]?.length)) return null;
  const tracks = Object.fromEntries(props.filter((p) => k[p]?.length).map((p) => [p, k[p]]));
  if (group) return { tracks, rest: { x: 0, y: 0, rotation: 0, scale: 1 }, fade: true };
  return { tracks, rest: { x: n.x, y: n.y, rotation: n.rotation, scale: n.scale }, origin: [n.x, n.y] };
}

/** A layer's or merged group's opacity keys: they set its material's opacity directly. */
export const opacityKeysOf = (n: Node) => (!isGroup(n) || n.merge ? (n.keys?.opacity?.length ? n.keys.opacity : undefined) : undefined);

/** Geometry keys (modifier, shape, morph and line settings), for geoMotion. */
export function geoKeysOf(n: Node): KeyTracks | undefined {
  if (!n.keys) return undefined;
  const out = Object.entries(n.keys).filter(([k, v]) => v.length && !isTransformProp(k));
  return out.length ? Object.fromEntries(out) : undefined;
}

/** Index of the key at `t` (within half a frame), or -1. */
export const keyAt = (keys: Key[] | undefined, t: number) => keys?.findIndex((k) => Math.abs(k.t - t) < KEY_SNAP) ?? -1;

/** The key before / after `t` (not counting one at it). */
export const prevKey = (keys: Key[] | undefined, t: number) => [...(keys ?? [])].reverse().find((k) => k.t < t - KEY_SNAP);
export const nextKey = (keys: Key[] | undefined, t: number) => keys?.find((k) => k.t > t + KEY_SNAP);

export const sortKeys = (keys: Key[]) => keys.sort((a, b) => a.t - b.t);

/** Add a key at `t`, or change the one there (keeping its curve). Returns the keys, sorted. */
export function setKey(keys: Key[], t: number, v: number | string, ease?: Transition): Key[] {
  const at = onFrame(t);
  const i = keyAt(keys, at);
  if (i >= 0) {
    keys[i].v = v;
    if (ease) keys[i].ease = ease;
  } else keys.push(ease ? { t: at, v, ease } : { t: at, v });
  return sortKeys(keys);
}

/** The keys bag a property lives in: material settings on the style, everything else on the node. */
export const bagOf = (n: Node, scope: KeyScope) => (scope === 'style' ? n.style.keys : n.keys);

/**
 * Change one property's keys in place: `fn` edits them (or returns new ones,
 * or null to clear them). Empty lists and bags are dropped, and keys replace a
 * cycle on the same setting.
 */
export function updateKeys(n: Node, scope: KeyScope, key: string, fn: (keys: Key[]) => Key[] | null | void) {
  const bag = scope === 'style' ? (n.style.keys ??= {}) : (n.keys ??= {});
  const r = fn(bag[key] ?? []);
  const next = r === null ? [] : sortKeys(r ?? bag[key] ?? []);
  if (next.length) {
    bag[key] = next;
    const cycles = scope === 'style' ? n.style.animate : n.animate;
    if (cycles?.[key]) {
      delete cycles[key];
      if (!Object.keys(cycles).length) delete (scope === 'style' ? n.style : n).animate;
    }
  } else delete bag[key];
  if (!Object.keys(bag).length) delete (scope === 'style' ? n.style : n).keys;
}

// ---------- properties: what can be keyed on a node ----------

export interface KeyProp {
  scope: KeyScope;
  key: string;
  get: (n: Node) => number | string | undefined;
  /** How an edit to a keyed property moves its key: by the change (canvas drags, nudges), by the ratio (scale), or to the new value. */
  rel?: 'add' | 'mul';
  /** Whole numbers only (counts, seeds). */
  integer?: boolean;
}

/** A material setting that can move: numbers (but not choices or switches) and colours. */
export const keyableParam = (p: ParamDef) => p.type === 'color' || (!p.options && !(p.min === 0 && p.max === 1 && p.step === 1));

const numberFields = (fields: Field[]) => fields.filter((f): f is Extract<Field, { min: number }> => !isChoice(f) && !('toggle' in f && f.toggle));
const rec = (o: unknown) => o as Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

/** Every keyable property of `n` that `was` (the same node before an edit) has too. */
export function keyProps(n: Node, was: Node = n): KeyProp[] {
  const out: KeyProp[] = [];
  if (!isGroup(n)) {
    out.push({ scope: 'node', key: 'x', rel: 'add', get: (x) => num(rec(x).x) }, { scope: 'node', key: 'y', rel: 'add', get: (x) => num(rec(x).y) });
    out.push({ scope: 'node', key: 'rotation', rel: 'add', get: (x) => num(rec(x).rotation) }, { scope: 'node', key: 'scale', rel: 'mul', get: (x) => num(rec(x).scale) });
  }
  if (!isGroup(n) || n.merge) {
    out.push({ scope: 'node', key: 'opacity', get: (x) => x.style.opacity ?? 1 });
    if (n.style.effect === was.style.effect) {
      for (const p of effectById(n.style.effect).params) if (keyableParam(p)) out.push({ scope: 'style', key: p.key, get: (x) => x.style.params[p.key] ?? p.default });
    }
  }
  for (const m of n.modifiers) {
    const before = was.modifiers.find((x) => x.uid === m.uid);
    if (!before || before.kind !== m.kind) continue;
    for (const f of numberFields(MODIFIER_UI[m.kind].fields)) {
      out.push({ scope: 'node', key: `mod:${m.uid}:${f.key}`, integer: f.integer, get: (x) => num(rec(x.modifiers.find((y) => y.uid === m.uid))?.[f.key]) });
    }
  }
  if (isGroup(n) || isGroup(was)) return out;
  const c = n.content;
  const b = (was as typeof n).content;
  if (c.type === 'symbol' && b.type === 'symbol' && c.symbol.kind === b.symbol.kind) {
    for (const f of numberFields(SYMBOL_UI[c.symbol.kind].fields)) out.push({ scope: 'node', key: `sym:${f.key}`, integer: f.integer, get: (x) => (!isGroup(x) && x.content.type === 'symbol' ? num(rec(x.content.symbol)[f.key]) : undefined) });
  }
  if ((c.type === 'text' && c.morph) || c.type === 'morph') {
    out.push({ scope: 'node', key: 'morph:t', get: (x) => (isGroup(x) ? undefined : x.content.type === 'morph' ? x.content.t : x.content.type === 'text' ? x.content.morph?.t : undefined) });
  }
  if (c.type === 'line') {
    for (const f of ['start', 'end', 'offset'] as const) out.push({ scope: 'node', key: `line:${f}`, get: (x) => (!isGroup(x) && x.content.type === 'line' ? (x.content.trim?.[f] ?? (f === 'end' ? 1 : 0)) : undefined) });
  }
  return out;
}

const same = (a: number | string, b: number | string) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : String(a).toLowerCase() === String(b).toLowerCase());

function nodesById(nodes: Node[], out = new Map<string, Node>()) {
  for (const n of nodes) {
    out.set(n.id, n);
    if (isGroup(n)) nodesById(n.children, out);
  }
  return out;
}

/**
 * After an edit: every keyed property it changed gets a key at the playhead
 * `t` instead, and with `autokey` every keyable property it changed starts
 * keys (its old value at 0 s, the new one at `t`). A drag moves a keyed
 * position or angle by as much as it moved the layer, and a scale by the same
 * ratio, so the object follows the pointer wherever the keys had put it;
 * everything else takes the new value. Settings that cycle aren't autokeyed.
 */
export function keyEdits(before: Project, after: Project, t: number, autokey: boolean) {
  if (!autokey && !anyKeys(after.layers)) return;
  const old = nodesById(before.layers);
  const at = onFrame(t);
  const visit = (nodes: Node[]) => {
    for (const n of nodes) {
      if (isGroup(n)) visit(n.children);
      const b = old.get(n.id);
      if (!b || (!autokey && !hasKeys(n)) || isGroup(n) !== isGroup(b)) continue;
      for (const p of keyProps(n, b)) {
        const [was, now] = [p.get(b), p.get(n)];
        if (was === undefined || now === undefined || same(was, now)) continue;
        const keys = bagOf(n, p.scope)?.[p.key];
        if (keys?.length) {
          const cur = keyedValue(keys, at);
          let v = now;
          if (typeof cur === 'number' && typeof was === 'number' && typeof now === 'number') {
            if (p.rel === 'add') v = cur + (now - was);
            else if (p.rel === 'mul') v = Math.abs(was) > 1e-9 ? cur * (now / was) : now;
          }
          setKey(keys, at, typeof v === 'number' && p.integer ? Math.round(v) : v);
        } else if (autokey && !(p.scope === 'style' ? n.style.animate : n.animate)?.[p.key]) {
          updateKeys(n, p.scope, p.key, () => (at > KEY_SNAP ? [{ t: 0, v: was }, { t: at, v: now }] : [{ t: 0, v: now }]));
        }
      }
    }
  };
  visit(after.layers);
}

// ---------- autokey: a record switch in the timeline, not saved ----------

let recording = false;
const recSubs = new Set<() => void>();
export const autokey = {
  get on() {
    return recording;
  },
  set(v: boolean) {
    recording = v;
    recSubs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    recSubs.add(f);
    return () => void recSubs.delete(f);
  },
};

// ---------- reading keys from files and agents ----------

/** Named curves for keys: the easing presets ("ease out", "linear"…) and the feels ("smooth", "bouncy"…). */
export function easeNamed(name: string): Transition | undefined {
  const s = name.trim().toLowerCase().replace(/[-_]/g, ' ');
  const e = EASES.find((x) => x.label.toLowerCase() === s);
  if (e) return { ...KEY_EASE, ease: [...e.value] as Bezier };
  const f = FEELS.find((x) => x.label.toLowerCase() === s);
  return f ? { ...f.value } : undefined;
}

/** The name of a key's curve, when it has one. */
export function easeName(tr: Transition | undefined): string {
  if (!tr) return 'ease in out';
  if (tr.type === 'easing') {
    const e = EASES.find((x) => x.value.every((v, i) => Math.abs(v - tr.ease[i]) < 1e-3));
    return e ? e.label.toLowerCase() : `[${tr.ease.join(',')}]`;
  }
  const f = FEELS.find((x) => x.value.type === tr.type && Math.abs(x.value.bounce - tr.bounce) < 1e-3);
  return f && tr.type === 'time' ? f.label.toLowerCase() : tr.type === 'time' ? `spring bounce ${tr.bounce}` : 'physics spring';
}

const isTransition = (o: unknown): o is Transition => !!o && typeof o === 'object' && ['easing', 'time', 'physics'].includes(String(rec(o).type));

function easeOf(raw: unknown): Transition | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') {
    const e = easeNamed(raw);
    if (!e) throw new Error(`no curve "${raw}"; use ${[...EASES.map((x) => x.label), ...FEELS.map((x) => x.label)].map((x) => x.toLowerCase()).join(', ')}, 4 Bézier numbers or a transition`);
    return e;
  }
  if (Array.isArray(raw) && raw.length === 4 && raw.every((v) => typeof v === 'number')) return { ...KEY_EASE, ease: raw as Bezier };
  if (isTransition(raw)) return { ...KEY_EASE, ...raw };
  throw new Error(`a key's curve is a name, 4 Bézier numbers or a transition, got ${JSON.stringify(raw)}`);
}

/**
 * Keys as written by hand or by an agent: [[t, v], [t, v, curve]…] or
 * [{ t, v, ease }…], in any order. Throws on anything else.
 */
export function parseKeys(raw: unknown): Key[] {
  if (!Array.isArray(raw)) throw new Error(`keys are a list like [[0,0],[1,45,"linear"]], got ${JSON.stringify(raw)}`);
  const keys = raw.map((k): Key => {
    const [t, v, ease] = Array.isArray(k) ? k : k && typeof k === 'object' ? [rec(k).t, rec(k).v, rec(k).ease] : [];
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) throw new Error(`a key's time is seconds ≥ 0, got ${JSON.stringify(k)}`);
    if (typeof v !== 'number' && typeof v !== 'string') throw new Error(`a key's value is a number or a colour, got ${JSON.stringify(k)}`);
    const tr = easeOf(ease);
    return tr ? { t, v, ease: tr } : { t, v };
  });
  return sortKeys(keys);
}

/** Keys as loaded from a file: well-formed ones, sorted, empty lists dropped. */
export function cleanKeys(bag: unknown): KeyTracks | undefined {
  if (!bag || typeof bag !== 'object') return undefined;
  const out: KeyTracks = {};
  for (const [k, list] of Object.entries(bag)) {
    if (!Array.isArray(list)) continue;
    const keys = list.filter((x): x is Key => !!x && typeof x === 'object' && Number.isFinite(x.t) && (typeof x.v === 'number' || typeof x.v === 'string'));
    for (const x of keys) if (x.ease && !isTransition(x.ease)) delete x.ease;
    if (keys.length) out[k] = sortKeys(keys);
  }
  return Object.keys(out).length ? out : undefined;
}
