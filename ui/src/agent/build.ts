// Making a design from scratch, as data: a blank project, new layers (text,
// shapes, pen lines, outlines, groups), modifiers, presets and recipes,
// removing, duplicating and restacking. Like edit.ts, every function returns
// a changed copy and a line saying what it did, and bad names fail with the
// names that would have worked.
import { EFFECTS, PRESETS, defaultParams, effectById } from '../render/effects';
import { BUNDLED } from '../fonts/library';
import { BG_PRESETS, SHAPE_RECIPES } from '../state/recipes';
import { background, CANVAS_PRESETS, fill, group, isGroup, lineLayer, MODIFIER_DEFAULTS, MODIFIER_UI, newModifier, nodeLabel, pathLayer, style, SYMBOL_UI, symbolLayer, textLayer, uid, type Group, type Node, type Project, type ShapeLayer } from '../state/model';
import type { Modifier, ModifierKind, SymbolKind } from '../engine/types';
import { EditError, findNode } from './find';

export interface Change {
  project: Project;
  change: string;
  /** The new node's id, for what adds one. */
  id?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_·-]+/g, '');

/** A canvas size: "1080x1350", or a preset's label ("Instagram post"). */
export function canvasSize(spec: string): { width: number; height: number } {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(spec.trim());
  if (m) return { width: +m[1], height: +m[2] };
  const c = CANVAS_PRESETS.find((x) => norm(x.label) === norm(spec)) ?? CANVAS_PRESETS.find((x) => norm(x.label).includes(norm(spec)));
  if (!c) throw new EditError(`No canvas size "${spec}". Use WxH or one of: ${CANVAS_PRESETS.map((x) => x.label).join(', ')}`);
  return { width: c.w, height: c.h };
}

/** A background: a colour, two colours for a gradient ("#000,#333"), or a preset's name. */
export function backgroundOf(spec: string) {
  const cols = spec.split(',').map((s) => s.trim());
  if (cols.every((c) => /^#[0-9a-f]{6}$/i.test(c))) return background(cols.length > 1 ? fill('linear', ...cols) : fill('solid', cols[0]));
  const b = BG_PRESETS.find((x) => norm(x.name) === norm(spec));
  if (!b) throw new EditError(`No background "${spec}". Use #rrggbb, "#a,#b" for a gradient, or one of: ${BG_PRESETS.map((x) => x.name).join(', ')}`);
  return structuredClone(b.bg);
}

export function blank(o: { name?: string; canvas?: string; background?: string; duration?: number } = {}): Project {
  return {
    version: 2,
    name: o.name ?? 'Untitled',
    canvas: o.canvas ? canvasSize(o.canvas) : { width: 1080, height: 1080 },
    background: o.background ? backgroundOf(o.background) : background(fill('solid', '#0b0b0d')),
    layers: [],
    fonts: [],
    ...(o.duration ? { timeline: { duration: o.duration, loop: true } } : {}),
  };
}

function all(nodes: Node[], out: Node[] = []): Node[] {
  for (const n of nodes) {
    out.push(n);
    if (isGroup(n)) all(n.children, out);
  }
  return out;
}

/** The list a node sits in, and its index there. */
function home(p: Project, id: string): { list: Node[]; i: number; parent: Group | null } {
  const look = (list: Node[], parent: Group | null): ReturnType<typeof home> | null => {
    for (const [i, n] of list.entries()) {
      if (n.id === id) return { list, i, parent };
      if (isGroup(n)) {
        const r = look(n.children, n);
        if (r) return r;
      }
    }
    return null;
  };
  const r = look(p.layers, null);
  if (!r) throw new EditError(`No layer #${id}`);
  return r;
}

/** A name nobody else in the design has: "Star", then "Star 2"… */
function freeName(p: Project, want: string): string {
  const taken = new Set(all(p.layers).map((n) => n.name ?? nodeLabel(n)));
  if (!taken.has(want)) return want;
  for (let i = 2; ; i++) if (!taken.has(`${want} ${i}`)) return `${want} ${i}`;
}

export interface Place {
  name?: string;
  /** "x,y" in px from the canvas centre. */
  at?: string;
  rotation?: number;
  scale?: number;
  /** Material id, or a preset's name. */
  material?: string;
  preset?: string;
  recipe?: string;
  /** Put it above / below this layer, or last inside this group (default: on top). */
  above?: string;
  below?: string;
  into?: string;
}

function look(n: ShapeLayer | Group, o: Place) {
  if (o.preset) applyPreset(n, o.preset);
  else if (o.material) {
    const m = o.material;
    const pre = PRESETS.find((x) => norm(x.name) === norm(m));
    if (pre) applyPreset(n, pre.name);
    else {
      if (!EFFECTS.some((e) => e.id === m)) throw new EditError(`No material "${m}". Materials: ${EFFECTS.map((e) => e.id).join(', ')}; or a preset name (catalog presets)`);
      n.style = style(m);
    }
  }
  if (o.recipe) applyRecipe(n, o.recipe);
}

function applyPreset(n: { style: ShapeLayer['style'] }, name: string) {
  const pre = PRESETS.find((x) => norm(x.name) === norm(name));
  if (!pre) throw new EditError(`No preset "${name}". Presets: ${PRESETS.map((x) => x.name).join(', ')}`);
  n.style = { ...n.style, effect: pre.effect, params: { ...defaultParams(effectById(pre.effect)), ...pre.params }, animate: undefined };
}

function applyRecipe(n: { modifiers: ShapeLayer['modifiers'] }, name: string) {
  const r = SHAPE_RECIPES.find((x) => norm(x.name) === norm(name));
  if (!r) throw new EditError(`No recipe "${name}". Recipes: ${SHAPE_RECIPES.map((x) => x.name).join(', ')}`);
  n.modifiers = [...n.modifiers, ...r.mods.map((m) => newModifier(m.kind, m as Partial<Modifier>))];
}

function insert(p: Project, n: Node, o: Place) {
  if (o.into) {
    const g = findNode(p, o.into);
    if (!isGroup(g)) throw new EditError(`${o.into} isn't a group`);
    g.children.push(n);
  } else if (o.above || o.below) {
    const ref = findNode(p, (o.above ?? o.below)!);
    const h = home(p, ref.id);
    h.list.splice(o.above ? h.i + 1 : h.i, 0, n);
  } else p.layers.push(n);
}

function place(n: ShapeLayer, o: Place) {
  if (o.at) {
    const [x, y] = o.at.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new EditError(`--at is x,y in px from the centre, got "${o.at}"`);
    n.x = x;
    n.y = y;
  }
  if (o.rotation !== undefined) n.rotation = o.rotation;
  if (o.scale !== undefined) n.scale = o.scale;
}

export type LayerKind = 'text' | 'shape' | 'line' | 'path';

export interface Add extends Place {
  size?: number;
  font?: string;
  /** Pen lines: stroke width in px. */
  width?: number;
  /** Colour shortcut: the material's main colour (fill, colour or ink), or flat in that colour. */
  color?: string;
}

/**
 * A new layer. `what` is the text, the shape kind, or the path data (em
 * units, y down, centred on 0,0) for lines and outlines.
 */
export function addLayer(p0: Project, kind: LayerKind, what: string, o: Add = {}): Change {
  const p = structuredClone(p0);
  let n: ShapeLayer;
  if (kind === 'text') {
    const font = o.font ?? 'archivo';
    if (!BUNDLED.some((f) => f.id === font) && !p.fonts.some((f) => f.id === font)) throw new EditError(`No font "${font}". Bundled: ${BUNDLED.map((f) => f.id).join(', ')}${p.fonts.length ? `; in this design: ${p.fonts.map((f) => f.id).join(', ')}` : ''}`);
    n = textLayer(what.replace(/\\n/g, '\n'), font, {}, o.size ? { size: o.size } : {});
  } else if (kind === 'shape') {
    const k = (Object.keys(SYMBOL_UI) as SymbolKind[]).find((s) => norm(s) === norm(what) || norm(SYMBOL_UI[s].label) === norm(what));
    if (!k) throw new EditError(`No shape "${what}". Shapes: ${Object.keys(SYMBOL_UI).join(', ')}`);
    n = symbolLayer(k, o.size ?? 420);
  } else if (kind === 'line') {
    n = lineLayer(what, o.size ?? 400, o.width ?? 12);
  } else if (kind === 'path') {
    n = pathLayer(what, o.size ?? 400, 'Outline');
  } else throw new EditError(`add makes text, shape, line or path layers (or a modifier, group, font or image), not "${kind}"`);
  if (!/^[MmLlCcQqHhVvZzAaSsTt0-9\s.,-]+$/.test(what) && (kind === 'line' || kind === 'path')) throw new EditError(`"${what}" isn't SVG path data (em units, e.g. "M-0.5 0 C-0.2 -0.3 0.2 0.3 0.5 0")`);
  n.name = freeName(p, o.name ?? (kind === 'text' ? what.replace(/\\n|\n/g, ' ').slice(0, 24) : nodeLabel(n)));
  place(n, o);
  look(n, o);
  if (o.color) {
    if (!/^#[0-9a-f]{6}$/i.test(o.color)) throw new EditError(`--color is #rrggbb, got "${o.color}"`);
    // The material's one main colour when it has one (a fill, a neon's glow, an ink); else flat in that colour.
    const main = ['fill', 'color', 'ink'].find((k) => k in n.style.params);
    if (main) n.style.params[main] = o.color;
    else n.style = style('flat', { fill: o.color });
  }
  insert(p, n, o);
  return { project: p, id: n.id, change: `added "${n.name}" #${n.id}: ${kind} ${kind === 'text' ? `"${what.replace(/\\n/g, '⏎')}"` : kind === 'shape' ? what : 'path'} · ${n.style.effect}${n.modifiers.length ? ` · ${n.modifiers.map((m) => m.kind).join('+')}` : ''}` };
}

/** A modifier on a layer, with its defaults and any `fields` over them. */
export function addModifier(p0: Project, target: string, kind: string, fields: Record<string, unknown> = {}): Change {
  const p = structuredClone(p0);
  const n = findNode(p, target);
  const k = (Object.keys(MODIFIER_UI) as ModifierKind[]).find((m) => norm(m) === norm(kind) || norm(MODIFIER_UI[m].label) === norm(kind));
  if (!k) {
    const r = SHAPE_RECIPES.find((x) => norm(x.name) === norm(kind));
    if (r) {
      applyRecipe(n, r.name);
      return { project: p, change: `"${n.name ?? n.id}": added recipe ${r.name} (${r.mods.map((m) => m.kind).join(' + ')})` };
    }
    throw new EditError(`No modifier "${kind}". Modifiers: ${Object.keys(MODIFIER_UI).join(', ')}; or a recipe (catalog recipes)`);
  }
  const known = new Set(Object.keys(MODIFIER_DEFAULTS[k]));
  const bad = Object.keys(fields).filter((f) => !known.has(f));
  if (bad.length) throw new EditError(`${k} has no ${bad.join(', ')}. Fields: ${[...known].filter((f) => f !== 'kind').join(', ')}`);
  const m = newModifier(k, fields as Partial<Modifier>);
  n.modifiers = [...n.modifiers, m];
  return { project: p, change: `"${n.name ?? n.id}": added ${k}[${m.uid}]${Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ''}` };
}

/** Wrap layers in a group, where the topmost of them was. */
export function addGroup(p0: Project, members: string[], o: Place & { merge?: boolean } = {}): Change {
  const p = structuredClone(p0);
  if (!members.length) throw new EditError('group needs the layers to put in it');
  const nodes = members.map((m) => findNode(p, m));
  const homes = nodes.map((n) => home(p, n.id));
  if (homes.some((h) => h.list !== homes[0].list)) throw new EditError('Grouped layers must sit side by side in the same list (not some inside other groups)');
  const order = homes.map((h, k) => ({ h, n: nodes[k] })).sort((a, b) => a.h.i - b.h.i);
  const g = group(order.map((x) => x.n), { name: freeName(p, o.name ?? (o.merge ? 'Merged shape' : 'Group')), merge: !!o.merge });
  const list = homes[0].list;
  const at = order[order.length - 1].h.i - (order.length - 1);
  for (const x of [...order].reverse()) list.splice(x.h.i, 1);
  list.splice(at, 0, g);
  if (o.merge) look(g, o);
  return { project: p, id: g.id, change: `grouped ${nodes.map((n) => n.name ?? n.id).join(', ')} as "${g.name}" #${g.id}${o.merge ? ' (merged into one shape)' : ''}` };
}

export function removeLayers(p0: Project, targets: string[]): Change {
  const p = structuredClone(p0);
  const gone = targets.map((t) => {
    const n = findNode(p, t);
    const h = home(p, n.id);
    h.list.splice(h.i, 1);
    return n.name ?? `#${n.id}`;
  });
  return { project: p, change: `removed ${gone.join(', ')}` };
}

/** A copy just above the original, with new ids (and modifier uids) throughout. */
export function duplicateLayer(p0: Project, target: string, o: Place = {}): Change {
  const p = structuredClone(p0);
  const n = findNode(p, target);
  const copy = structuredClone(n);
  const fresh = (x: Node) => {
    x.id = uid(isGroup(x) ? 'g' : 'l');
    const uids = new Map(x.modifiers.map((m) => [m.uid, uid('m')]));
    x.modifiers = x.modifiers.map((m) => ({ ...m, uid: uids.get(m.uid)! }));
    // Modifier keyframes follow their modifier's new uid.
    if (x.animate) x.animate = Object.fromEntries(Object.entries(x.animate).map(([k, v]) => [k.replace(/^mod:([^:]+):/, (s, u: string) => (uids.has(u) ? `mod:${uids.get(u)}:` : s)), v]));
    if (isGroup(x)) x.children.forEach(fresh);
  };
  fresh(copy);
  copy.name = freeName(p, o.name ?? n.name ?? nodeLabel(n));
  if (!isGroup(copy)) place(copy, o);
  look(copy as ShapeLayer, o);
  if (o.above || o.below || o.into) insert(p, copy, o);
  else {
    const h = home(p, n.id);
    h.list.splice(h.i + 1, 0, copy);
  }
  return { project: p, id: copy.id, change: `duplicated "${n.name ?? n.id}" as "${copy.name}" #${copy.id}` };
}

/** Restack: top, bottom, up, down, or above / below another layer (in its own list). */
export function arrange(p0: Project, target: string, where: string, other?: string): Change {
  const p = structuredClone(p0);
  const n = findNode(p, target);
  const h = home(p, n.id);
  h.list.splice(h.i, 1);
  if (where === 'top') h.list.push(n);
  else if (where === 'bottom') h.list.unshift(n);
  else if (where === 'up') h.list.splice(Math.min(h.list.length, h.i + 1), 0, n);
  else if (where === 'down') h.list.splice(Math.max(0, h.i - 1), 0, n);
  else if (where === 'above' || where === 'below') {
    if (!other) throw new EditError(`arrange ${target} ${where} needs another layer`);
    const ref = findNode(p, other);
    const r = home(p, ref.id);
    r.list.splice(where === 'above' ? r.i + 1 : r.i, 0, n);
  } else throw new EditError(`arrange takes top, bottom, up, down, above <layer> or below <layer>, not "${where}"`);
  const pos = home(p, n.id);
  return { project: p, change: `"${n.name ?? n.id}" is now ${pos.i + 1} of ${pos.list.length} from the bottom${pos.parent ? ` in "${pos.parent.name ?? pos.parent.id}"` : ''}` };
}

/** Presets and recipes by assignment: Layer.preset="Ice chrome", Layer.recipe=Glitch. */
export function applyLook(p0: Project, target: string, key: 'preset' | 'recipe', name: string): Change {
  const p = structuredClone(p0);
  const n = findNode(p, target);
  if (key === 'preset') applyPreset(n, name);
  else applyRecipe(n, name);
  return { project: p, change: `"${n.name ?? n.id}" ${key}: ${name}${key === 'preset' ? ` (${n.style.effect})` : ''}` };
}
