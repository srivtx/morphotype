// What a design can be made of, as short plain text for an AI agent or a
// script: materials and their settings, presets, modifiers, recipes, library
// shapes, motion, keyframes, layers, fonts, backgrounds, canvas sizes and
// templates. It reads the same registries the Inspector draws from, so it
// can't drift from the app. `catalog()` is a one-screen index; ask for a
// section or a name (`catalog('chrome')`, `catalog('glitch')`) for details.
import { BUNDLED } from '../fonts/library';
import { EFFECTS, PRESETS, type EffectDef, type ParamDef } from '../render/effects';
import { BG_PRESETS, SHAPE_RECIPES } from '../state/recipes';
import { ENTER_OPTIONS, ENTER_UI, EASES, FEELS, LEAVE_OPTIONS, LEAVE_UI, LOOP_OPTIONS, LOOP_UI, STAGGER_ORDERS } from '../state/motion';
import { CANVAS_PRESETS, isChoice, MODIFIER_DEFAULTS, MODIFIER_UI, SYMBOL_DEFAULTS, SYMBOL_UI, type Field } from '../state/model';
import type { ModifierKind, SymbolKind } from '../engine/types';
import type { Template } from '../state/templates';
import { KITS, kitsText, kitText } from './kits';
import { recipesText } from './moves';

export const SECTIONS = ['kits', 'materials', 'presets', 'modifiers', 'recipes', 'shapes', 'motion', 'keyframes', 'layers', 'fonts', 'backgrounds', 'canvas', 'templates'] as const;
export type Section = (typeof SECTIONS)[number];

const fmt = (v: unknown) => (typeof v === 'number' ? String(+v.toFixed(4)) : typeof v === 'string' ? v : JSON.stringify(v));
const first = (s: string) => s.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? s;
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

function paramLine(p: ParamDef): string {
  const adv = p.advanced ? '  (advanced)' : '';
  if (p.type === 'color') return `  ${p.key}: colour = ${p.default}  "${p.label}"${adv}`;
  if (p.options) return `  ${p.key}: ${p.options.map((o, i) => `${i}=${o}`).join(' ')} = ${p.default}  "${p.label}"${adv}`;
  return `  ${p.key}: ${fmt(p.min)}…${fmt(p.max)} step ${fmt(p.step)} = ${fmt(p.default)}  "${p.label}"${adv}`;
}

function fieldLine(f: Field, defaults: Record<string, unknown>): string {
  const show = f.show ? `  (when ${Object.entries(f.show).map(([k, v]) => `${k}=${v}`).join(', ')})` : '';
  const def = defaults[f.key] === undefined ? '' : ` = ${fmt(defaults[f.key])}`;
  if (isChoice(f)) return `  ${f.key}: ${f.options.map((o) => o.value).join('|')}${def}  "${f.label}"${show}`;
  const kind = f.toggle ? '0|1' : `${fmt(f.min)}…${fmt(f.max)}${f.integer ? ' whole' : ''}`;
  return `  ${f.key}: ${kind}${def}  "${f.label}"${f.advanced ? '  (advanced)' : ''}${show}`;
}

function material(e: EffectDef): string {
  const presets = PRESETS.filter((p) => p.effect === e.id).map((p) => p.name);
  const flags = [e.photo && 'samples a picture (param image)', e.backdrop && 'sees what is behind it', e.spine && 'follows a pen line'].filter(Boolean);
  return [
    `material ${e.id} — ${e.name}`,
    `  ${e.description}`,
    ...(flags.length ? [`  ${flags.join('; ')}`] : []),
    'params (key: range = default "label"):',
    ...e.params.map(paramLine),
    ...(presets.length ? [`presets: ${presets.join(', ')}`] : []),
    `set as: style: { effect: '${e.id}', params: { … } }`,
  ].join('\n');
}

function modifier(kind: ModifierKind): string {
  const ui = MODIFIER_UI[kind];
  const d = MODIFIER_DEFAULTS[kind] as unknown as Record<string, unknown>;
  const extra = Object.keys(d).filter((k) => k !== 'kind' && !ui.fields.some((f) => f.key === k));
  return [
    `modifier ${kind} — ${ui.label} (${ui.group}): ${ui.blurb}`,
    'fields (lengths are in em of the layer, 1 = its size):',
    ...ui.fields.map((f) => fieldLine(f, d)),
    ...(extra.length ? [`  also: ${extra.map((k) => `${k} = ${fmt(d[k])}`).join(', ')}`] : []),
    `add as: modifiers: [{ kind: '${kind}', …fields, on: true, uid: 'm1' }]`,
    `animate: animate['mod:<uid>:<field>'] = { to, period, phase, mode }`,
  ].join('\n');
}

function shape(kind: SymbolKind): string {
  const ui = SYMBOL_UI[kind];
  const d = SYMBOL_DEFAULTS[kind] as unknown as Record<string, unknown>;
  return [
    `shape ${kind} — ${ui.label} (${ui.group})`,
    ...(ui.fields.length ? ['fields:', ...ui.fields.map((f) => fieldLine(f, d))] : ['no fields']),
    `content: { type: 'symbol', symbol: { kind: '${kind}', … }, size: 420 }`,
    `animate: animate['sym:<field>']`,
  ].join('\n');
}

const MOTION = (): string =>
  [
    'motion (layer.motion or group.motion; poses only, nothing is rebuilt):',
    '  loop: ' + LOOP_OPTIONS.map((o) => o.value).join('|'),
    ...Object.entries(LOOP_UI).map(([k, r]) => `    ${k}: amount = ${r.label} ${r.min}…${r.max}${r.unit} (${r.default})`),
    '  period: seconds per loop · phase: 0…1 of a cycle',
    '  enter: ' + ENTER_OPTIONS.map((o) => o.value).join('|') + ' · delay: s · distance:',
    ...Object.entries(ENTER_UI).map(([k, r]) => `    ${k}: ${r.label} ${r.min}…${r.max}${r.unit} (${r.default})`),
    '    move: fromX, fromY px (fade: bool)',
    '  leave: ' + LEAVE_OPTIONS.map((o) => o.value).join('|') + ' · leaveAt: s · leaveDistance:',
    ...Object.entries(LEAVE_UI).map(([k, r]) => `    ${k}: ${r.label} ${r.min}…${r.max}${r.unit} (${r.default})`),
    '    move: toX, toY px; stops: [{ x, y, hold?, transition? }] for more spots',
    '  transition: { type: easing|time|physics, duration, ease: [x1,y1,x2,y2], bounce, stiffness, damping, mass }',
    '    feels: ' + FEELS.map((f) => `${f.label} (${f.title.toLowerCase()})`).join(', '),
    '    eases: ' + EASES.map((e) => `${e.label} [${e.value.join(',')}]`).join(', '),
    '  stagger: s between children (groups) or letters · order: ' + STAGGER_ORDERS.map((o) => o.value).join('|'),
    '  letters: letters|words (text: each moves in turn) · slide: dir right|left|up|down, oneWay, easePass',
    'scene clock: project.timeline = { duration: s, loop: bool } (default 6 s, looping)',
    recipesText(),
  ].join('\n');

const KEYFRAMES = (): string =>
  [
    'keyframes: values that change on the scene clock, as { to, period, phase, mode }',
    '  mode: swing (there and back) | ramp (round and round) | flicker (random holds) | hold (rests, goes to To, comes back)',
    '  period: s per cycle (snapped to fit the timeline) · phase: 0…1',
    'where they go:',
    '  style.animate[<param>]       a material setting (numbers or colours), drawn on the GPU',
    '  animate["mod:<uid>:<field>"] a modifier number field (rebuilds the outline)',
    '  animate["sym:<field>"]       a library shape field',
    '  animate["morph:t"]           a font morph blend, or a morph layer',
    '  animate["line:start|end|offset"] how much of a pen line is drawn (draw-on: end 0 → 1)',
    'keys: any number per property, each at its own time with its own value and curve (free keyframes)',
    "  set them: Star.keys.rotation=[[0,0],[1,45],[2.5,30]] · Star.keys.x=[[0,-200],[1.5,200,\"back out\"]] · Star.keys.fill=[[0,\"#ffffff\"],[2,\"#ff3366\"]]",
    '  each key: [t (s), value, curve into it?] or { t, v, ease }; null removes them',
    '  curves: ' + [...EASES.map((e) => e.label), ...FEELS.map((f) => f.label)].map((x) => x.toLowerCase()).join(', ') + ' (default ease in out), 4 Bézier numbers, or a transition',
    '  keys.x | y | rotation | scale | opacity   a layer\'s own values (a group\'s: offsets from rest); they ride on top of motion',
    '  keys[<param>]                             a material setting (lands in style.keys), numbers or colours',
    '  keys["mod:<uid>:<field>"], ["sym:<field>"], ["morph:t"], ["line:end"]…  geometry, as for animate',
    '  before its first key a property holds that value, after its last it holds that one (a looping clock jumps back at the seam)',
    '  a setting with keys ignores its cycle and its plain value; keys past the timeline\'s end never play (set lengthens it to fit)',
  ].join('\n');

const LAYERS = (): string =>
  [
    'project: { version: 2, name, canvas: { width, height }, background, layers: [bottom … top], fonts: [], timeline? }',
    'layer: { id, name?, visible, op: add|subtract|intersect, x, y (px from the canvas centre, y down), rotation (°), scale, sx, sy,',
    '         modifiers: [], content, style: { effect, params, stroke?, opacity?, blend?: normal|multiply|screen, depth?, soften?, animate? },',
    '         motion?, animate?, keys? (see `keyframes`), guide? (shown while designing, left out of exports), locked? }',
    'content:',
    "  { type: 'text', text, font, size (px), tracking, lineHeight, align: left|center|right, axes: {}, morph: null|{ font, axes, t }, ligatures }",
    "  { type: 'symbol', symbol: { kind, … }, size }   (see `shapes`)",
    "  { type: 'path', d (SVG path in em, y down), size }",
    "  { type: 'line', d, size, width (px), cap: round|butt|square, squiggle?, dash?: { dash, gap, offset }, trim?: { start, end, offset, each } }",
    "  { type: 'stroke', points: [[x, y, pressure]], width, taper, smooth }",
    "  { type: 'morph', a, b (SVG paths), t }",
    "group: { type: 'group', id, name?, visible, op, merge (fuse children into one shape with the group's style), clip, style, modifiers, children, motion?, animate?, open? (expanded in the layers panel) }",
    'style.stroke: { width, color, align: outside|center|inside, opacity } · style.depth: { amount (px), angle (° from up), color, shade 0…1 }',
  ].join('\n');

const BACKGROUNDS = (): string =>
  [
    'background: { fill, grain: 0…1, tile: null | tile, pattern?: null | pattern }',
    '  fill: { kind: none|solid|linear|radial|aura, colors: [1–4 hex], angle (°) }',
    '  tile (app-icon plate): { shape: squircle|rounded|circle, size (of the short side), radius 0…1, fill, gloss, shadow, rim (px), rimColor, holo }',
    '  pattern: { kind: grid|dots|lines|diagonal|checker|doodles, size (px), weight (px), color, opacity }',
    'presets: ' + BG_PRESETS.map((b) => b.name).join(', '),
  ].join('\n');

const CANVAS = (): string => 'canvas sizes:\n' + CANVAS_PRESETS.map((c) => `  ${c.label}: ${c.w}×${c.h} (${c.group})`).join('\n');

function templatesText(list: Template[] | null): string {
  if (!list) return 'templates: not loaded';
  const by = new Map<string, Template[]>();
  for (const t of list) by.set(t.category, [...(by.get(t.category) ?? []), t]);
  return [...by].map(([cat, ts]) => `${cat}:\n${ts.map((t) => `  ${t.name} — ${t.hint}`).join('\n')}`).join('\n');
}

function section(s: Section, templates: Template[] | null): string {
  switch (s) {
    case 'kits':
      return kitsText();
    case 'materials':
      return EFFECTS.map((e) => `${e.id} — ${e.name}: ${first(e.description)}`).join('\n') + '\n(details: catalog <id>)';
    case 'presets':
      return PRESETS.map((p) => `${p.name} → ${p.effect}${p.tags ? ` (${p.tags})` : ''}`).join('\n');
    case 'modifiers':
      return (Object.keys(MODIFIER_UI) as ModifierKind[]).map((k) => `${k} — ${MODIFIER_UI[k].label} (${MODIFIER_UI[k].group}): ${MODIFIER_UI[k].blurb}`).join('\n') + '\n(details: catalog <kind>)';
    case 'recipes':
      return SHAPE_RECIPES.map((r) => `${r.name}: ${r.mods.map((m) => JSON.stringify(m)).join(' + ')}`).join('\n');
    case 'shapes':
      return (Object.keys(SYMBOL_UI) as SymbolKind[]).map((k) => `${k} — ${SYMBOL_UI[k].label} (${SYMBOL_UI[k].group})${SYMBOL_UI[k].fields.length ? ': ' + SYMBOL_UI[k].fields.map((f) => f.key).join(', ') : ''}`).join('\n');
    case 'motion':
      return MOTION();
    case 'keyframes':
      return KEYFRAMES();
    case 'layers':
      return LAYERS();
    case 'fonts':
      return 'bundled fonts (content.font): ' + BUNDLED.map((f) => f.id).join(', ');
    case 'backgrounds':
      return BACKGROUNDS();
    case 'canvas':
      return CANVAS();
    case 'templates':
      return templatesText(templates);
  }
}

function index(templates: Template[] | null): string {
  const names = (xs: string[]) => xs.join(', ');
  return [
    'Morphotype catalog. Ask for a section or any name below for details.',
    `kits (${KITS.length}): ${names(KITS.map((k) => k.name))} (background, palette, fonts and looks in one word)`,
    `materials (${EFFECTS.length}): ${names(EFFECTS.map((e) => e.id))}`,
    `presets (${PRESETS.length}): material looks by name`,
    `modifiers (${Object.keys(MODIFIER_UI).length}): ${names(Object.keys(MODIFIER_UI))}`,
    `recipes (${SHAPE_RECIPES.length}): modifier combos by name`,
    `shapes (${Object.keys(SYMBOL_UI).length}): ${names(Object.keys(SYMBOL_UI))}`,
    `motion: loops (${names(LOOP_OPTIONS.slice(1).map((o) => o.value))}), entrances, leaves, transitions`,
    'keyframes: animating any material, modifier, shape or line setting',
    'layers: the project and layer format',
    `fonts (${BUNDLED.length}), backgrounds (${BG_PRESETS.length} presets), canvas (${CANVAS_PRESETS.length} sizes), templates (${templates?.length ?? '?'})`,
  ].join('\n');
}

/**
 * The catalog as text: the index with no query; a section by name; or any
 * material, modifier, shape, preset, recipe or template by name. Unknown
 * words list the closest matches.
 */
export function catalog(query = '', templates: Template[] | null = null): string {
  const q = query.trim();
  if (!q) return index(templates);
  const k = norm(q);
  const sec = SECTIONS.find((s) => norm(s) === k || norm(s).replace(/s$/, '') === k);
  if (sec) return section(sec, templates);
  const out: string[] = [];
  const eff = EFFECTS.find((e) => norm(e.id) === k || norm(e.name) === k);
  if (eff) out.push(material(eff));
  const mod = (Object.keys(MODIFIER_UI) as ModifierKind[]).find((m) => norm(m) === k || norm(MODIFIER_UI[m].label) === k);
  if (mod) out.push(modifier(mod));
  const sym = (Object.keys(SYMBOL_UI) as SymbolKind[]).find((s) => norm(s) === k || norm(SYMBOL_UI[s].label) === k);
  if (sym) out.push(shape(sym));
  const pre = PRESETS.find((p) => norm(p.name) === k);
  if (pre) out.push(`preset ${pre.name}: material ${pre.effect}, background ${pre.bg}\n  params: ${JSON.stringify(pre.params)}\n  (other params keep the material's defaults: catalog ${pre.effect})`);
  const rec = SHAPE_RECIPES.find((r) => norm(r.name) === k);
  if (rec) out.push(`recipe ${rec.name}: ${rec.mods.map((m) => JSON.stringify(m)).join(' + ')}`);
  const kit = KITS.find((x) => norm(x.name) === k);
  if (kit) out.push(`kit ${kitText(kit)}`);
  const tpl = templates?.find((t) => norm(t.name) === k);
  if (tpl) out.push(`template ${tpl.name} (${tpl.category}) — ${tpl.hint}\n  (see it as layers: describe "${tpl.name}")`);
  if (out.length) return out.join('\n\n');
  return search(k, templates);
}

function search(k: string, templates: Template[] | null): string {
  const hits: string[] = [];
  const has = (...s: (string | undefined)[]) => s.some((x) => x && norm(x).includes(k));
  for (const e of EFFECTS) if (has(e.id, e.name, e.description)) hits.push(`material ${e.id} — ${e.name}`);
  for (const e of EFFECTS) for (const p of e.params) if (has(p.key, p.label)) hits.push(`param ${e.id}.${p.key} — ${p.label}`);
  for (const p of PRESETS) if (has(p.name, p.tags)) hits.push(`preset ${p.name} → ${p.effect}`);
  for (const [m, ui] of Object.entries(MODIFIER_UI)) if (has(m, ui.label, ui.blurb)) hits.push(`modifier ${m} — ${ui.label}`);
  for (const r of SHAPE_RECIPES) if (has(r.name, r.tags)) hits.push(`recipe ${r.name}`);
  for (const [s, ui] of Object.entries(SYMBOL_UI)) if (has(s, ui.label)) hits.push(`shape ${s} — ${ui.label}`);
  for (const t of templates ?? []) if (has(t.name, t.hint)) hits.push(`template ${t.name}`);
  for (const x of KITS) if (has(x.name, x.blurb)) hits.push(`kit ${x.name}`);
  if (!hits.length) return `Nothing matches "${k}". Sections: ${SECTIONS.join(', ')}.`;
  const more = hits.length > 40 ? `\n… and ${hits.length - 40} more` : '';
  return hits.slice(0, 40).join('\n') + more;
}

/** A template by exact name, then any case, then a unique part of a name. */
export function findTemplate(list: Template[], name: string): Template {
  const k = name.toLowerCase();
  const part = list.filter((x) => x.name.toLowerCase().includes(k));
  const t = list.find((x) => x.name === name) ?? list.find((x) => x.name.toLowerCase() === k) ?? (part.length === 1 ? part[0] : undefined);
  if (t) return t;
  const near = part.length ? part : list.filter((x) => k.split(/\s+/).some((w) => w.length > 2 && x.name.toLowerCase().includes(w)));
  throw new Error(`No template "${name}"${part.length > 1 ? ' (several match)' : ''}. ${near.length ? `Did you mean: ${near.slice(0, 8).map((x) => x.name).join(', ')}` : 'List them with: catalog templates'}`);
}
