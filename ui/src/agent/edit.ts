// Small, checked edits to a project, one assignment at a time:
//
//   Star.gloss=0.4              a material setting (bare keys find their home)
//   "Big star".x=-120           a layer by name (quote names with dots) …
//   #l12.content.text="HELLO"   … or by id; any path into the layer works
//   Title.wave.amplitude=0.08   the layer's first modifier of that kind
//   Title.motion.loop=float     motion is created when missing
//   Title.animate.speed={"to":1,"period":4,"phase":0,"mode":"ramp"}
//   canvas.width=1080 · background.fill.colors=["#000"] · timeline.duration=4
//
// Values are JSON when they parse as JSON, else plain text; null removes a
// key. Numbers are checked against the setting's range, and unknown layers
// or settings fail with the names that would have worked.
import { defaultParams, EFFECTS, effectById } from '../render/effects';
import { newMotion } from '../state/motion';
import { isChoice, isGroup, MODIFIER_UI, SYMBOL_UI, type Field, type Node, type Project } from '../state/model';
import type { ModifierKind } from '../engine/types';

export class EditError extends Error {}

export interface Edit {
  project: Project;
  /** What changed, as "Star style.params.gloss: 0.6 → 0.4". */
  change: string;
}

type Obj = Record<string, unknown>;

export function parseValue(raw: string): unknown {
  const s = raw.trim();
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Split `target.path=value`, keeping quoted targets whole. */
export function parseAssignment(a: string): { target: string; path: string[]; value: unknown } {
  const eq = a.indexOf('=');
  if (eq < 0) throw new EditError(`"${a}" needs a value: target.setting=value`);
  const lhs = a.slice(0, eq).trim();
  let target: string, rest: string;
  if (lhs.startsWith('"')) {
    const end = lhs.indexOf('"', 1);
    if (end < 0) throw new EditError(`Unclosed quote in "${lhs}"`);
    target = lhs.slice(1, end);
    rest = lhs.slice(end + 1).replace(/^\./, '');
  } else {
    const dot = lhs.indexOf('.');
    target = dot < 0 ? lhs : lhs.slice(0, dot);
    rest = dot < 0 ? '' : lhs.slice(dot + 1);
  }
  if (!rest) throw new EditError(`"${lhs}" needs a setting after the layer: ${target}.<setting>=…`);
  return { target, path: rest.split('.'), value: parseValue(a.slice(eq + 1)) };
}

function allNodes(nodes: Node[], out: Node[] = []): Node[] {
  for (const n of nodes) {
    out.push(n);
    if (isGroup(n)) allNodes(n.children, out);
  }
  return out;
}

export function findNode(p: Project, target: string): Node {
  const all = allNodes(p.layers);
  const id = target.replace(/^#/, '');
  const byId = all.find((n) => n.id === id);
  if (byId) return byId;
  for (const same of [(n: Node) => n.name === target, (n: Node) => n.name?.toLowerCase() === target.toLowerCase()]) {
    const hits = all.filter(same);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new EditError(`${hits.length} layers are called "${target}"; use an id: ${hits.map((n) => '#' + n.id).join(', ')}`);
  }
  const names = all.map((n) => (n.name ? `"${n.name}"` : `#${n.id}`));
  throw new EditError(`No layer "${target}". Layers: ${names.join(', ')}`);
}

function checkField(f: Field | undefined, key: string, v: unknown, where: string) {
  if (!f || v === null) return;
  if (isChoice(f)) {
    if (!f.options.some((o) => o.value === v)) throw new EditError(`${where}.${key} is one of ${f.options.map((o) => o.value).join('|')}`);
  } else if (typeof v !== 'number' || v < f.min || v > f.max) {
    throw new EditError(`${where}.${key} is a number ${f.min}…${f.max}${f.integer ? ' (whole)' : ''}, got ${JSON.stringify(v)}`);
  }
}

function checkParam(effect: string, key: string, v: unknown) {
  const e = effectById(effect);
  const p = e.params.find((x) => x.key === key);
  if (!p) throw new EditError(`${e.id} has no setting "${key}". Settings: ${e.params.map((x) => x.key).join(', ')}`);
  if (v === null) return;
  if (p.type === 'color') {
    if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new EditError(`${e.id}.${key} is a colour like "#ff3366", got ${JSON.stringify(v)}`);
  } else if (typeof v !== 'number' || v < p.min || v > p.max) {
    throw new EditError(`${e.id}.${key} is a number ${p.min}…${p.max}${p.options ? ` (${p.options.map((o, i) => `${i}=${o}`).join(' ')})` : ''}, got ${JSON.stringify(v)}`);
  }
}

/** Where a short path goes on a node: the full path from the node. */
function resolve(n: Node, path: string[]): { path: string[]; check?: (v: unknown) => void } {
  const [head, ...rest] = path;
  const o = n as unknown as Obj;
  if (head === 'effect' && !rest.length) return { path: ['style', 'effect'] };
  if (head === 'params' && rest.length === 1) return { path: ['style', 'params', rest[0]], check: (v) => checkParam(n.style.effect, rest[0], v) };
  // Material settings animate on the style; modifier, shape and line keys (mod:…, sym:…, line:…) on the layer.
  if (head === 'animate' && rest.length === 1) return { path: rest[0] in n.style.params ? ['style', 'animate', rest[0]] : ['animate', rest[0]] };
  if (head === 'motion') return { path };
  if (head in o) {
    if (head === 'style' && rest[0] === 'params' && rest.length === 2) return { path, check: (v) => checkParam(n.style.effect, rest[1], v) };
    if (head === 'modifiers' && rest.length === 2) {
      const m = n.modifiers[Number(rest[0])];
      if (m) return { path, check: (v) => checkField(MODIFIER_UI[m.kind].fields.find((f) => f.key === rest[1]), rest[1], v, m.kind) };
    }
    return { path };
  }
  if (!rest.length && head in n.style.params) return { path: ['style', 'params', head], check: (v) => checkParam(n.style.effect, head, v) };
  if (head in MODIFIER_UI) {
    const i = n.modifiers.findIndex((m) => m.kind === head);
    if (i < 0) throw new EditError(`${n.name ?? n.id} has no ${head} modifier${n.modifiers.length ? `; it has ${n.modifiers.map((m) => m.kind).join(', ')}` : ''}. Add it with ${n.name ?? '#' + n.id}.modifiers=[…]`);
    if (rest.length !== 1) throw new EditError(`Say which ${head} field: ${MODIFIER_UI[head as ModifierKind].fields.map((f) => f.key).join(', ')}`);
    const kind = head as ModifierKind;
    return { path: ['modifiers', String(i), rest[0]], check: (v) => checkField(MODIFIER_UI[kind].fields.find((f) => f.key === rest[0]), rest[0], v, kind) };
  }
  if (!isGroup(n)) {
    const c = n.content as unknown as Obj;
    if (head in c) return { path: ['content', ...path] };
    if (n.content.type === 'symbol' && head in n.content.symbol) {
      const kind = n.content.symbol.kind;
      return { path: ['content', 'symbol', ...path], check: (v) => checkField(SYMBOL_UI[kind].fields.find((f) => f.key === head), head, v, kind) };
    }
  }
  const content = isGroup(n) ? [] : [...Object.keys(n.content), ...(n.content.type === 'symbol' ? Object.keys(n.content.symbol) : [])];
  const options = [...Object.keys(o), ...Object.keys(n.style.params), ...n.modifiers.map((m) => m.kind), ...content];
  throw new EditError(`${n.name ?? '#' + n.id} has no "${head}". Try: ${[...new Set(options)].filter((k) => !['id', 'type', 'kind', 'symbol'].includes(k)).join(', ')}`);
}

function get(o: unknown, path: string[]): unknown {
  return path.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Obj)[k] : undefined), o);
}

/** Set `path` on `root` in place, creating the last key only. */
function put(root: Obj, path: string[], v: unknown, label: string) {
  let o: unknown = root;
  for (const k of path.slice(0, -1)) {
    const next = (o as Obj)[k];
    if (!next || typeof next !== 'object') throw new EditError(`${label}: nothing at "${k}" in ${path.join('.')}`);
    o = next;
  }
  const last = path[path.length - 1];
  if (Array.isArray(o) && !/^\d+$/.test(last)) throw new EditError(`${label}: ${path.slice(0, -1).join('.')} is a list; use an index`);
  if (v === null && !Array.isArray(o)) delete (o as Obj)[last];
  else (o as Obj)[last] = v;
}

const ROOTS: Record<string, string[]> = { canvas: ['canvas'], background: ['background'], bg: ['background'], timeline: ['timeline'], project: [] };

/** Apply one assignment to a copy of `p`. */
export function applyEdit(p: Project, assignment: string): Edit {
  const { target, path, value } = parseAssignment(assignment);
  const project = structuredClone(p);
  const root = ROOTS[target.toLowerCase()];
  if (root && !allNodes(p.layers).some((n) => n.name === target)) {
    if (target.toLowerCase() === 'timeline') project.timeline ??= { duration: 6, loop: true };
    const full = [...root, ...path];
    const before = get(project, full);
    put(project as unknown as Obj, full, value, target);
    return { project, change: `${full.join('.')}: ${fmtv(before)} → ${fmtv(value)}` };
  }
  const n = findNode(project, target);
  const r = resolve(n, path);
  r.check?.(value);
  if (r.path[0] === 'motion') n.motion ??= newMotion();
  if (r.path[0] === 'animate') n.animate ??= {};
  if (r.path[0] === 'style' && r.path[1] === 'animate') n.style.animate ??= {};
  const before = get(n, r.path);
  if (r.path.join('.') === 'style.effect') {
    if (typeof value !== 'string' || !EFFECTS.some((e) => e.id === value)) throw new EditError(`effect is one of ${EFFECTS.map((e) => e.id).join(', ')}`);
    // A new material keeps the settings both share and starts the rest at its defaults.
    const d = defaultParams(effectById(value));
    n.style = { ...n.style, effect: value, params: { ...d, ...Object.fromEntries(Object.entries(n.style.params).filter(([k]) => k in d)) }, animate: undefined };
  } else {
    put(n as unknown as Obj, r.path, value, n.name ?? n.id);
  }
  return { project, change: `${n.name ? `"${n.name}"` : '#' + n.id} ${r.path.join('.')}: ${fmtv(before)} → ${fmtv(value)}` };
}

const fmtv = (v: unknown) => (v === undefined ? '(unset)' : JSON.stringify(v));

/** Apply several assignments in order. */
export function applyEdits(p: Project, assignments: string[]): { project: Project; changes: string[] } {
  const changes: string[] = [];
  for (const a of assignments) {
    const e = applyEdit(p, a);
    p = e.project;
    changes.push(e.change);
  }
  return { project: p, changes };
}
