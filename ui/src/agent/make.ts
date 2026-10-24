// A whole design from one spec: canvas, background, kit, layers (text,
// shapes, lines, outlines, groups, modifiers), where they go and how they
// move. Building is plain data (this file); placing needs the engine's boxes,
// so the layout comes back as instructions for page.ts to resolve (measure,
// then place). Layers are listed bottom first: later ones draw on top.
//
//   { "name": "Night Drive", "canvas": "1080x1350", "kit": "chrome-night", "duration": 4,
//     "layers": [
//       { "shape": "ring", "name": "Halo", "fitWidth": 85, "place": "top third" },
//       { "text": "NIGHT\nDRIVE", "name": "Title", "fitWidth": 80, "place": "top third" },
//       { "text": "LIVE · 21.11 · WAREHOUSE 9", "name": "Info", "place": "bottom" } ],
//     "motion": { "recipe": "cascade", "layers": ["Title", "Info"] } }
import { ENTER_UI } from '../state/motion';
import { isGroup, type Project } from '../state/model';
import { addLayer, addModifier, addGroup, blank, type Add, type Change, type LayerKind } from './build';
import { applyEdits } from './edit';
import { allNodes, EditError, findNode } from './find';
import { kitByName, kitColor, type Kit, type Look, type Role } from './kits';
import { moveEdits, type MoveSpec } from './moves';
import { setLayout, type LayoutOp, type Placement, type Stack } from './place';

export interface LayerSpec {
  name?: string;
  text?: string;
  shape?: string;
  line?: string;
  path?: string;
  /** Children, bottom first; with `merge` they fuse into one shape. */
  group?: LayerSpec[];
  merge?: boolean;
  /** Which of the kit's looks it takes (default: the first text is the headline, other text is body, the rest accent). */
  role?: Role;
  font?: string;
  size?: number;
  /** #rrggbb or a kit palette name: the look's main colour (a fill, a neon's glow, an ink), or flat in that colour. */
  color?: string;
  material?: string;
  preset?: string;
  recipe?: string;
  /** Modifiers by kind, with fields: [{ "kind": "wave", "amplitude": 0.04 }] (or just "wave"). */
  modifiers?: (string | ({ kind: string } & Record<string, unknown>))[];
  /** px from the centre, "x,y" or [x, y]: only when no place is given. */
  at?: string | [number, number];
  rotation?: number;
  scale?: number;
  /** Pen lines: stroke width, px. */
  width?: number;
  tracking?: number;
  // Layout (see place.ts).
  fit?: string | number;
  fitWidth?: number;
  fitHeight?: number;
  place?: string;
  margin?: number | string;
  centre?: boolean | 'x' | 'y' | 'both';
  contain?: boolean;
  offset?: [number, number] | string;
  /** Any other settings, as Layer.setting assignments without the layer: { "gloss": 0.4 } or ["wave.amplitude=0.05"]. */
  set?: Record<string, unknown> | string[];
  /** This layer's motion: a recipe's fields (enter, loop, delay…), or motion settings as they're stored. */
  motion?: MoveSpec & { delay?: number } & Record<string, unknown>;
}

export interface Spec {
  name?: string;
  /** "1080x1350", a preset name ("Instagram post") or { width, height }. */
  canvas?: string | { width: number; height: number };
  /** A colour, "#a,#b", a background preset, or a background object. */
  background?: string | Project['background'];
  kit?: string;
  style?: 'poster' | 'logo' | 'abstract';
  /** Seconds on the clock; with `loop` (default true). */
  duration?: number;
  loop?: boolean;
  layers: LayerSpec[];
  /** Stacks and rows: { "stack": ["Title", "Info"], "gap": 40, "place": "centre" }. */
  layout?: Stack[];
  /** Motion recipes over several layers: { "recipe": "cascade", "layers": ["Title", "Info"] }. */
  motion?: MoveSpec | MoveSpec[];
  /** Assignments over everything, last: ["Title.gloss=0.6", "background.grain=0.2"]. */
  set?: string[];
}

export interface Made {
  project: Project;
  /** For page.ts to resolve against the build: fits first, then places and stacks. */
  layout: LayoutOp[];
  /** What was built, a line per step. */
  notes: string[];
}

const LAYOUT_KEYS = ['fit', 'fitWidth', 'fitHeight', 'place', 'margin', 'centre', 'contain', 'offset'] as const;
const MOVE_KEYS = new Set(['recipe', 'enter', 'leave', 'loop', 'stagger', 'start', 'feel', 'duration', 'distance', 'letters', 'letterStagger', 'period', 'amount', 'spread', 'leaveAt']);

function kindOf(l: LayerSpec): [LayerKind | 'group', string] {
  const kinds = (['text', 'shape', 'line', 'path', 'group'] as const).filter((k) => l[k] !== undefined);
  if (kinds.length !== 1) throw new EditError(`each layer is one of text, shape, line, path or group${kinds.length ? `, not ${kinds.join(' and ')}` : ''}: ${JSON.stringify(l).slice(0, 80)}`);
  const k = kinds[0];
  return [k, k === 'group' ? '' : String(l[k])];
}

/** The look a layer takes: its own settings over its role's in the kit. */
function lookOf(kit: Kit | null, role: Role, l: LayerSpec, p: Project): Add {
  const k: Look = kit?.[role] ?? {};
  const short = Math.min(p.canvas.width, p.canvas.height);
  // A preset or material of its own replaces the kit's look; a colour of its own tints it.
  const own = l.preset || l.material;
  const color = l.color ?? (own ? undefined : k.color);
  return {
    font: l.font ?? k.font,
    preset: own ? l.preset : k.preset,
    material: l.material,
    recipe: l.recipe ?? (own || l.color ? undefined : k.recipe),
    color: color ? kitColor(kit, color) : undefined,
    size: l.size ?? (k.size && role !== 'headline' ? Math.round(short * k.size) : role === 'body' && l.text !== undefined ? Math.round(short * 0.034) : undefined),
  };
}

/** The spec as a project, its layout instructions and notes. */
export function fromSpec(spec: Spec, o: { kit?: string; style?: Spec['style'] } = {}): Made {
  if (!spec || !Array.isArray(spec.layers)) throw new EditError('a spec has "layers": [ … ], bottom first (see docs/AGENT-TOOLS.md)');
  const kitName = o.kit ?? spec.kit;
  const kit = kitName ? kitByName(kitName) : null;
  const canvas = typeof spec.canvas === 'object' ? `${spec.canvas.width}x${spec.canvas.height}` : spec.canvas;
  let p = blank({ name: spec.name, canvas, background: typeof spec.background === 'string' ? spec.background : kit?.background, duration: spec.duration });
  if (spec.background && typeof spec.background === 'object') p.background = structuredClone(spec.background);
  if (spec.duration !== undefined || spec.loop !== undefined) p.timeline = { duration: spec.duration ?? 6, loop: spec.loop ?? true };
  const style = o.style ?? spec.style;
  if (kit || style) p.agent = { ...(kit ? { kit: kit.name } : {}), ...(style ? { style } : {}) };
  const notes: string[] = [];
  const layout: LayoutOp[] = [];
  const fits: LayoutOp[] = [];
  const moves: MoveSpec[] = [];
  let headline = false;

  /** Adds one layer (or group) on top, or into a group; returns its id. */
  const add = (l: LayerSpec): string => {
    const [kind, what] = kindOf(l);
    let id: string;
    if (kind === 'group') {
      const kids = (l.group ?? []).map((c) => add(c));
      const r = addGroup(p, kids.map((k) => '#' + k), { name: l.name, merge: !!l.merge, preset: l.preset, material: l.material, recipe: l.recipe });
      p = r.project;
      id = r.id!;
      notes.push(r.change);
    } else {
      const role: Role = l.role ?? (kind === 'text' ? (headline ? 'body' : 'headline') : 'accent');
      if (role === 'headline' && kind === 'text') headline = true;
      const look = lookOf(kit, role, l, p);
      const at = Array.isArray(l.at) ? l.at.join(',') : l.at;
      const r = addLayer(p, kind, what, { name: l.name, at, rotation: l.rotation, scale: l.scale, width: l.width, ...look });
      p = r.project;
      id = r.id!;
      const tracking = l.tracking ?? (kind === 'text' ? kit?.[role].tracking : undefined);
      if (tracking !== undefined) p = applyEdits(p, [`#${id}.content.tracking=${tracking}`]).project;
      notes.push(r.change + (kit ? ` · ${role}` : ''));
      // A headline with no size of its own fills most of the width.
      if (role === 'headline' && kind === 'text' && l.size === undefined && l.fit === undefined && l.fitWidth === undefined && l.fitHeight === undefined) fits.push({ target: '#' + id, fitWidth: 80 });
    }
    for (const m of l.modifiers ?? []) {
      const { kind: mk, ...fields } = typeof m === 'string' ? { kind: m } : m;
      const r = addModifier(p, '#' + id, mk, fields);
      p = r.project;
    }
    if (l.set) {
      const list = Array.isArray(l.set) ? l.set : Object.entries(l.set).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
      p = applyEdits(p, list.map((a) => `#${id}.${a}`)).project;
    }
    const place: Placement = { target: '#' + id };
    for (const k of LAYOUT_KEYS) if (l[k] !== undefined) setLayout(place, k, k === 'centre' && l[k] === true ? 'both' : l[k]);
    if (Object.keys(place).length > 1) {
      // Fits run before anything is placed, but keep each layer's own order.
      if (place.fitWidth !== undefined || place.fitHeight !== undefined) fits.push({ target: place.target, fitWidth: place.fitWidth, fitHeight: place.fitHeight });
      const { fitWidth: _w, fitHeight: _h, ...rest } = place;
      if (Object.keys(rest).length > 1) layout.push(rest);
    }
    if (l.motion) {
      const m = l.motion;
      const recipe = Object.fromEntries(Object.entries(m).filter(([k]) => MOVE_KEYS.has(k))) as MoveSpec;
      const raw = Object.entries(m).filter(([k]) => !MOVE_KEYS.has(k) && k !== 'delay' && k !== 'layers');
      if (m.delay !== undefined) recipe.start = m.delay as number;
      if (Object.keys(recipe).length) moves.push({ ...recipe, layers: ['#' + id] });
      if (raw.length) p = applyEdits(p, raw.map(([k, v]) => `#${id}.motion.${k}=${JSON.stringify(v)}`)).project;
    }
    return id;
  };
  for (const l of spec.layers) add(l);
  for (const s of spec.layout ?? []) {
    if (!s.stack && !s.row) throw new EditError(`layout entries are stacks or rows: { "stack": ["A", "B"], "gap": 40 }, got ${JSON.stringify(s).slice(0, 60)}`);
    for (const t of s.stack ?? s.row ?? []) findNode(p, t);
    layout.push(s);
  }
  // Motion last, once every layer exists: recipes over several layers, then each layer's own.
  const recipes = spec.motion ? (Array.isArray(spec.motion) ? spec.motion : [spec.motion]) : [];
  for (const m of [...recipes, ...moves]) {
    if (m.enter && !(m.enter in ENTER_UI) && m.enter !== 'fade') throw new EditError(`No entrance "${m.enter}". Entrances: fade, ${Object.keys(ENTER_UI).join(', ')}`);
    const r = moveEdits(p, m);
    p = r.project;
    notes.push(r.summary);
  }
  if (spec.set?.length) {
    const r = applyEdits(p, spec.set);
    p = r.project;
    notes.push(...r.changes);
  }
  return { project: p, layout: [...fits, ...layout], notes };
}

/** A blank design, with a kit's background and the kit and style kept for later adds and checks. */
export function newDesign(o: { name?: string; canvas?: string; background?: string; duration?: number; kit?: string; style?: Spec['style'] }): Project {
  const kit = o.kit ? kitByName(o.kit) : null;
  const p = blank({ ...o, background: o.background ?? kit?.background });
  if (o.style && !['poster', 'logo', 'abstract'].includes(o.style)) throw new EditError(`--style is poster, logo or abstract, not "${o.style}"`);
  if (kit || o.style) p.agent = { ...(kit ? { kit: kit.name } : {}), ...(o.style ? { style: o.style } : {}) };
  return p;
}

/** add, with the design's kit: the role's look (headline, accent, body) under the layer's own settings. */
export function addWithKit(p: Project, kind: LayerKind, what: string, o: Add & { role?: string }): Change {
  const kit = p.agent?.kit ? kitByName(p.agent.kit) : null;
  if (o.role && !['headline', 'accent', 'body'].includes(o.role)) throw new EditError(`--role is headline, accent or body, not "${o.role}"`);
  if (!kit) return addLayer(p, kind, what, { ...o, color: o.color ? kitColor(null, o.color) : undefined });
  const texts = allNodes(p.layers).some((n) => !isGroup(n) && n.content.type === 'text');
  const role = (o.role as Role | undefined) ?? (kind === 'text' ? (texts ? 'body' : 'headline') : 'accent');
  const look = lookOf(kit, role, { text: kind === 'text' ? what : undefined, font: o.font, size: o.size, color: o.color, preset: o.preset, material: o.material, recipe: o.recipe }, p);
  const r = addLayer(p, kind, what, { ...o, ...look });
  const tracking = kind === 'text' ? kit[role].tracking : undefined;
  return tracking === undefined ? r : { ...r, project: applyEdits(r.project, [`#${r.id}.content.tracking=${tracking}`]).project, change: `${r.change} · ${role} (${kit.name})` };
}
