import type { Content, Layer, ModEntry, Modifier, ModifierKind, SymbolKind, SymbolSpec } from '../engine/types';
import { defaultParams, effectById, type ParamValues } from '../render/effects';

export interface ProjectFont {
  id: string;
  /** Base64 font bytes for fonts the user imported (bundled ones are referenced by id). */
  data?: string;
  name?: string;
}

export interface Project {
  version: 1;
  name: string;
  canvas: { width: number; height: number };
  layers: Layer[];
  effect: { id: string; params: ParamValues };
  fonts: ProjectFont[];
}

let counter = 0;
export function uid(prefix = 'l'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const MODIFIER_DEFAULTS: Record<ModifierKind, Modifier> = {
  weight: { kind: 'weight', amount: 0.03 },
  round: { kind: 'round', radius: 0.03 },
  outline: { kind: 'outline', width: 0.04 },
  ink: { kind: 'ink', amount: 0.015, scale: 0.5, seed: 1 },
  slant: { kind: 'slant', angle: 12 },
  stretch: { kind: 'stretch', x: 1.2, y: 1 },
  wave: { kind: 'wave', amplitude: 0.08, wavelength: 2.5, phase: 0 },
  arc: { kind: 'arc', bend: 0.35 },
  wobble: { kind: 'wobble', amount: 0.03, scale: 0.6, seed: 1 },
  melt: { kind: 'melt', amount: 0.3, scale: 0.4, seed: 1 },
  pixelate: { kind: 'pixelate', size: 0.07 },
  perspective: { kind: 'perspective', amount: 0.3 },
};

export interface NumberField {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

export const MODIFIER_UI: Record<ModifierKind, { label: string; fields: NumberField[] }> = {
  weight: { label: 'Weight', fields: [{ key: 'amount', label: 'Amount', min: -0.1, max: 0.2, step: 0.001 }] },
  round: { label: 'Round corners', fields: [{ key: 'radius', label: 'Radius', min: 0, max: 0.2, step: 0.001 }] },
  outline: { label: 'Outline', fields: [{ key: 'width', label: 'Width', min: 0.002, max: 0.2, step: 0.001 }] },
  ink: {
    label: 'Ink bleed',
    fields: [
      { key: 'amount', label: 'Amount', min: 0, max: 0.08, step: 0.001 },
      { key: 'scale', label: 'Scale', min: 0.05, max: 3, step: 0.01 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true },
    ],
  },
  slant: { label: 'Slant', fields: [{ key: 'angle', label: 'Angle', min: -45, max: 45, step: 0.5 }] },
  stretch: {
    label: 'Stretch',
    fields: [
      { key: 'x', label: 'Width', min: 0.2, max: 3, step: 0.01 },
      { key: 'y', label: 'Height', min: 0.2, max: 3, step: 0.01 },
    ],
  },
  wave: {
    label: 'Wave',
    fields: [
      { key: 'amplitude', label: 'Amplitude', min: -0.5, max: 0.5, step: 0.005 },
      { key: 'wavelength', label: 'Wavelength', min: 0.2, max: 10, step: 0.05 },
      { key: 'phase', label: 'Phase', min: 0, max: 6.283, step: 0.01 },
    ],
  },
  arc: { label: 'Arc', fields: [{ key: 'bend', label: 'Bend', min: -1, max: 1, step: 0.01 }] },
  wobble: {
    label: 'Wobble',
    fields: [
      { key: 'amount', label: 'Amount', min: 0, max: 0.2, step: 0.001 },
      { key: 'scale', label: 'Scale', min: 0.05, max: 3, step: 0.01 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true },
    ],
  },
  melt: {
    label: 'Melt',
    fields: [
      { key: 'amount', label: 'Drip length', min: 0, max: 1.5, step: 0.01 },
      { key: 'scale', label: 'Drip spacing', min: 0.05, max: 2, step: 0.01 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true },
    ],
  },
  pixelate: { label: 'Pixelate', fields: [{ key: 'size', label: 'Pixel size', min: 0.01, max: 0.3, step: 0.001 }] },
  perspective: { label: 'Perspective', fields: [{ key: 'amount', label: 'Amount', min: -0.9, max: 0.9, step: 0.01 }] },
};

export function newModifier(kind: ModifierKind): ModEntry {
  return { ...MODIFIER_DEFAULTS[kind], on: true, uid: uid('m') } as ModEntry;
}

export const SYMBOL_DEFAULTS: Record<SymbolKind, SymbolSpec> = {
  circle: { kind: 'circle' },
  ring: { kind: 'ring', thickness: 0.18 },
  squircle: { kind: 'squircle', exponent: 5, aspect: 1 },
  roundRect: { kind: 'roundRect', radius: 0.2, aspect: 1 },
  polygon: { kind: 'polygon', sides: 6, rounding: 0.1 },
  star: { kind: 'star', points: 5, inner: 0.45, rounding: 0.1 },
  sparkle: { kind: 'sparkle', pinch: 0.3 },
  burst: { kind: 'burst', rays: 12, ring: 0.12, ray_width: 0.1, inner: 0.26 },
  pin: { kind: 'pin', corner: 3 },
  cursor: { kind: 'cursor' },
  blob: { kind: 'blob', lobes: 8, depth: 0.08, seed: 0, wobble: 0 },
  eyes: { kind: 'eyes', gap: 0.34, width: 0.14, height: 0.26 },
  heart: { kind: 'heart' },
  plus: { kind: 'plus', thickness: 0.3 },
  catHead: { kind: 'catHead', ears: 0.3 },
};

export const SYMBOL_UI: Record<SymbolKind, { label: string; fields: NumberField[] }> = {
  circle: { label: 'Circle', fields: [] },
  ring: { label: 'Ring', fields: [{ key: 'thickness', label: 'Thickness', min: 0.01, max: 0.49, step: 0.005 }] },
  squircle: {
    label: 'Squircle',
    fields: [
      { key: 'exponent', label: 'Squareness', min: 1, max: 20, step: 0.1 },
      { key: 'aspect', label: 'Aspect', min: 0.2, max: 5, step: 0.01 },
    ],
  },
  roundRect: {
    label: 'Rounded rect',
    fields: [
      { key: 'radius', label: 'Radius', min: 0, max: 0.5, step: 0.005 },
      { key: 'aspect', label: 'Aspect', min: 0.2, max: 5, step: 0.01 },
    ],
  },
  polygon: {
    label: 'Polygon',
    fields: [
      { key: 'sides', label: 'Sides', min: 3, max: 16, step: 1, integer: true },
      { key: 'rounding', label: 'Rounding', min: 0, max: 0.5, step: 0.005 },
    ],
  },
  star: {
    label: 'Star',
    fields: [
      { key: 'points', label: 'Points', min: 3, max: 24, step: 1, integer: true },
      { key: 'inner', label: 'Inner radius', min: 0.05, max: 0.95, step: 0.005 },
      { key: 'rounding', label: 'Rounding', min: 0, max: 0.5, step: 0.005 },
    ],
  },
  sparkle: { label: 'Sparkle', fields: [{ key: 'pinch', label: 'Pinch', min: 0, max: 0.9, step: 0.01 }] },
  burst: {
    label: 'Sun badge',
    fields: [
      { key: 'rays', label: 'Rays', min: 3, max: 36, step: 1, integer: true },
      { key: 'ring', label: 'Ring', min: 0.02, max: 0.3, step: 0.005 },
      { key: 'ray_width', label: 'Ray width', min: 0.01, max: 0.3, step: 0.005 },
      { key: 'inner', label: 'Inner ring', min: 0.05, max: 0.45, step: 0.005 },
    ],
  },
  pin: { label: 'Pin', fields: [{ key: 'corner', label: 'Corner', min: 0, max: 5, step: 0.05 }] },
  cursor: { label: 'Cursor', fields: [] },
  blob: {
    label: 'Cloud blob',
    fields: [
      { key: 'lobes', label: 'Lobes', min: 2, max: 24, step: 1, integer: true },
      { key: 'depth', label: 'Lobe depth', min: 0, max: 0.3, step: 0.005 },
      { key: 'wobble', label: 'Wobble', min: 0, max: 1, step: 0.01 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true },
    ],
  },
  eyes: {
    label: 'Eyes',
    fields: [
      { key: 'gap', label: 'Gap', min: 0, max: 1, step: 0.005 },
      { key: 'width', label: 'Width', min: 0.02, max: 0.5, step: 0.005 },
      { key: 'height', label: 'Height', min: 0.02, max: 1, step: 0.005 },
    ],
  },
  heart: { label: 'Heart', fields: [] },
  plus: { label: 'Plus', fields: [{ key: 'thickness', label: 'Thickness', min: 0.05, max: 0.9, step: 0.005 }] },
  catHead: { label: 'Cat head', fields: [{ key: 'ears', label: 'Ears', min: 0, max: 0.6, step: 0.005 }] },
};

function layer(content: Content, extra: Partial<Layer> = {}): Layer {
  return { id: uid(), visible: true, op: 'add', x: 0, y: 0, rotation: 0, scale: 1, modifiers: [], content, ...extra };
}

type TextContent = Extract<Content, { type: 'text' }>;

export function textLayer(text = 'Morph', font = 'archivo', extra: Partial<Layer> = {}, content: Partial<TextContent> = {}): Layer {
  return layer(
    { type: 'text', text, font, size: 220, tracking: 0, lineHeight: 1, align: 'center', axes: {}, morph: null, ligatures: true, ...content },
    extra,
  );
}

export function symbolLayer(kind: SymbolKind, size = 420, extra: Partial<Layer> = {}): Layer {
  return layer({ type: 'symbol', symbol: { ...SYMBOL_DEFAULTS[kind] }, size }, extra);
}

export function pathLayer(d: string, size: number, name: string): Layer {
  return layer({ type: 'path', d, size, name });
}

export function morphLayer(a: string, b: string): Layer {
  return layer({ type: 'morph', a, b, t: 0.5 });
}

export function layerLabel(l: Layer): string {
  if (l.name) return l.name;
  const c = l.content;
  switch (c.type) {
    case 'text':
      return c.text.replace(/\n/g, ' ').trim() || 'Empty text';
    case 'symbol':
      return SYMBOL_UI[c.symbol.kind].label;
    case 'path':
      return c.name ?? 'Traced image';
    case 'morph':
      return 'Morph';
  }
}

export function withEffect(id: string, overrides: ParamValues = {}): Project['effect'] {
  return { id, params: { ...defaultParams(effectById(id)), ...overrides } };
}

export function emptyProject(): Project {
  return {
    version: 1,
    name: 'Untitled',
    canvas: { width: 1200, height: 1200 },
    layers: [textLayer('Morph', 'archivo', { modifiers: [] })],
    effect: withEffect('chrome'),
    fonts: [],
  };
}

const mods = (...m: Modifier[]): ModEntry[] => m.map((x) => ({ ...x, on: true, uid: uid('m') }) as ModEntry);

export interface Template {
  name: string;
  hint: string;
  make: () => Project;
}

function project(name: string, layers: Layer[], effect: Project['effect'], canvas = { width: 1200, height: 1200 }): Project {
  return { version: 1, name, canvas, layers, effect, fonts: [] };
}

export const TEMPLATES: Template[] = [
  {
    name: 'Chrome cursor',
    hint: 'Pin with a punched-out cursor in ice chrome',
    make: () =>
      project(
        'Chrome cursor',
        [symbolLayer('pin', 560), symbolLayer('cursor', 300, { op: 'subtract', x: -10, y: 0, rotation: 0 })],
        withEffect('chrome', { bevel: 70, softness: 16 }),
      ),
  },
  {
    name: 'Sun badge',
    hint: 'Badge with a letter in plasma chrome',
    make: () =>
      project(
        'Sun badge',
        [symbolLayer('burst', 640, { rotation: 15 }), textLayer('G', 'archivo', {}, { size: 190 })],
        withEffect('chrome', { c1: '#16002b', c2: '#5a17d6', c3: '#ff2e9a', c4: '#ffd36b', rimColor: '#ff7ad1', bevel: 26 }),
      ),
  },
  {
    name: 'Pixel runner',
    hint: 'Pixelated word in molten chrome',
    make: () =>
      project(
        'Pixel runner',
        [textLayer('RUN', 'archivo', { modifiers: mods({ kind: 'pixelate', size: 0.09 }) })],
        withEffect('chrome', { c1: '#071722', c2: '#00a99d', c3: '#ff6a00', c4: '#ffe7c2', rimColor: '#ff9a3c', liquid: 1, bevel: 24 }),
      ),
  },
  {
    name: 'Puffy mascot',
    hint: 'Cloud body with punched eyes, inflated',
    make: () =>
      project(
        'Puffy mascot',
        [symbolLayer('blob', 760), symbolLayer('eyes', 420, { op: 'subtract', y: -20 })],
        withEffect('inflate'),
      ),
  },
  {
    name: 'App icon',
    hint: 'Cat mascot on a squircle tile',
    make: () =>
      project(
        'App icon',
        [symbolLayer('catHead', 600, { y: 40 }), symbolLayer('eyes', 300, { op: 'subtract', y: 70 })],
        withEffect('icon'),
      ),
  },
  {
    name: 'Glow glass',
    hint: 'Frosted glass type with a floor reflection',
    make: () =>
      project('Glow glass', [textLayer('lab', 'unbounded', { y: -60, modifiers: mods({ kind: 'round', radius: 0.03 }) })], withEffect('glass')),
  },
  {
    name: 'Distressed type',
    hint: 'Worn print stack with melted drips',
    make: () =>
      project(
        'Distressed type',
        [
          textLayer(
            'Distressed\ntext\neffect',
            'inter-black',
            { x: -480, modifiers: mods({ kind: 'ink', amount: 0.012, scale: 0.35, seed: 3 }, { kind: 'melt', amount: 0.12, scale: 0.25, seed: 5 }) },
            { size: 190, tracking: -0.04, lineHeight: 0.92, align: 'left' },
          ),
        ],
        withEffect('distressed'),
      ),
  },
  {
    name: 'Neon script',
    hint: 'Script lettering as a neon tube',
    make: () => project('Neon script', [textLayer('Night', 'pacifico', { modifiers: mods({ kind: 'slant', angle: 4 }) })], withEffect('neon')),
  },
  {
    name: 'Font morph',
    hint: 'Halfway between a grotesque and a script',
    make: () =>
      project(
        'Font morph',
        [
          textLayer('Morph', 'archivo', {}, { size: 240, morph: { font: 'pacifico', t: 0.5, axes: {} } }),
        ],
        withEffect('chrome', { c1: '#061204', c2: '#2f6b0b', c3: '#c8ff3a', c4: '#ffb300', rimColor: '#d8ff7a' }),
      ),
  },
];
