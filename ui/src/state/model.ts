import type { Content, EngineLayer, ModEntry, Modifier, ModifierKind, Op, SymbolKind, SymbolSpec, TextMorph } from '../engine/types';
import { defaultParams, effectById, type ParamValues } from '../render/effects';

export interface ProjectFont {
  id: string;
  /** Base64 font bytes for fonts the user imported (bundled ones are referenced by id). */
  data?: string;
  name?: string;
}

/** How an object is shaded: an effect and its parameters. */
export interface Style {
  effect: string;
  params: ParamValues;
}

/** A shape on the canvas: text, symbol, outline or morph, with its own style. */
export interface ShapeLayer extends EngineLayer {
  name?: string;
  locked?: boolean;
  style: Style;
}

/**
 * A group moves and styles its children together. Normally each child keeps
 * its own style; with `merge` the children fuse into one shape that uses the
 * group's style and modifiers (like a boolean union in other editors).
 */
export interface Group {
  type: 'group';
  id: string;
  name?: string;
  visible: boolean;
  locked?: boolean;
  op: Op;
  merge: boolean;
  /** Expanded in the layers panel. */
  open?: boolean;
  style: Style;
  modifiers: ModEntry[];
  children: Node[];
}

export type Node = ShapeLayer | Group;

export function isGroup(n: Node | undefined | null): n is Group {
  return !!n && (n as Group).type === 'group';
}

export type FillKind = 'none' | 'solid' | 'linear' | 'radial' | 'aura';

export interface Fill {
  kind: FillKind;
  /** One to four colours. */
  colors: string[];
  /** Degrees, for linear gradients; also rotates aura blobs. */
  angle: number;
}

export type TileShape = 'squircle' | 'rounded' | 'circle';

/** App-icon style tile behind the artwork. */
export interface Tile {
  shape: TileShape;
  /** Fraction of the shorter artboard side. */
  size: number;
  /** Corner roundness 0..1. */
  radius: number;
  fill: Fill;
  gloss: number;
  shadow: number;
  /** Rim light width in px; 0 turns it off. */
  rim: number;
  rimColor: string;
  /** Iridescent rim instead of a solid colour. */
  holo: boolean;
}

export interface Background {
  fill: Fill;
  grain: number;
  tile: Tile | null;
}

/** A font being designed in Type mode. */
export interface TypeProject {
  family: string;
  style: string;
  base: string;
  axes: Record<string, number>;
  morph: TextMorph | null;
  modifiers: ModEntry[];
  /** Extra advance for every glyph, in em. */
  tracking: number;
  /** Characters the font includes, in display order. */
  charset: string;
  glyphs: Record<string, GlyphEdit>;
  sample: string;
}

export interface GlyphEdit {
  /** Replacement outline in em units (y-down, baseline 0). */
  d?: string;
  advance?: number;
  modifiers?: ModEntry[];
}

export interface Project {
  version: 2;
  name: string;
  canvas: { width: number; height: number };
  background: Background;
  layers: Node[];
  fonts: ProjectFont[];
  type?: TypeProject;
}

let counter = 0;
export function uid(prefix = 'l'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- modifiers ----------

export const MODIFIER_DEFAULTS: Record<ModifierKind, Modifier> = {
  weight: { kind: 'weight', amount: 0.03 },
  round: { kind: 'round', radius: 0.03 },
  outline: { kind: 'outline', width: 0.04 },
  ink: { kind: 'ink', amount: 0.015, scale: 0.5, seed: 1 },
  slant: { kind: 'slant', angle: 12 },
  stretch: { kind: 'stretch', x: 1.2, y: 1 },
  wave: { kind: 'wave', amplitude: 0.08, wavelength: 2.5, phase: 0 },
  arc: { kind: 'arc', bend: 0.35 },
  warp: { kind: 'warp', style: 'arch', bend: 0.5, points: [] },
  wobble: { kind: 'wobble', amount: 0.03, scale: 0.6, seed: 1 },
  melt: { kind: 'melt', amount: 0.3, scale: 0.4, seed: 1 },
  pixelate: { kind: 'pixelate', size: 0.07, shape: 'square', gap: 0 },
  perspective: { kind: 'perspective', amount: 0.3 },
};

export interface NumberField {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  /** Only shown in advanced mode. */
  advanced?: boolean;
}

export interface ChoiceField {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export type Field = NumberField | ChoiceField;

export function isChoice(f: Field): f is ChoiceField {
  return 'options' in f;
}

export interface ModifierUI {
  label: string;
  /** One line for the picker. */
  blurb: string;
  group: 'Shape' | 'Distort' | 'Texture';
  fields: Field[];
}

export const WARP_STYLES: { value: string; label: string }[] = [
  { value: 'arch', label: 'Arch' },
  { value: 'arc', label: 'Arc' },
  { value: 'arcLower', label: 'Arc lower' },
  { value: 'bulge', label: 'Bulge' },
  { value: 'flag', label: 'Flag' },
  { value: 'rise', label: 'Rise' },
  { value: 'fish', label: 'Fish' },
  { value: 'inflate', label: 'Inflate' },
  { value: 'squeeze', label: 'Squeeze' },
  { value: 'twist', label: 'Twist' },
  { value: 'custom', label: 'Custom (points only)' },
];

export const MODIFIER_UI: Record<ModifierKind, ModifierUI> = {
  weight: { label: 'Weight', blurb: 'Bolder or thinner strokes', group: 'Shape', fields: [{ key: 'amount', label: 'Amount', min: -0.1, max: 0.2, step: 0.001 }] },
  round: { label: 'Round corners', blurb: 'Soft, friendly corners', group: 'Shape', fields: [{ key: 'radius', label: 'Radius', min: 0, max: 0.2, step: 0.001 }] },
  outline: { label: 'Outline', blurb: 'Hollow, inline strokes', group: 'Shape', fields: [{ key: 'width', label: 'Width', min: 0.002, max: 0.2, step: 0.001 }] },
  pixelate: {
    label: 'Pixels',
    blurb: 'Bitmap blocks, dot matrix or soft pixels',
    group: 'Shape',
    fields: [
      {
        key: 'shape',
        label: 'Cells',
        options: [
          { value: 'square', label: 'Blocks' },
          { value: 'dot', label: 'Dots' },
          { value: 'rounded', label: 'Soft' },
        ],
      },
      { key: 'size', label: 'Pixel size', min: 0.01, max: 0.3, step: 0.001 },
      { key: 'gap', label: 'Gap', min: 0, max: 0.8, step: 0.01 },
    ],
  },
  slant: { label: 'Slant', blurb: 'Italic lean', group: 'Distort', fields: [{ key: 'angle', label: 'Angle', min: -45, max: 45, step: 0.5 }] },
  stretch: {
    label: 'Stretch',
    blurb: 'Condense or expand',
    group: 'Distort',
    fields: [
      { key: 'x', label: 'Width', min: 0.2, max: 3, step: 0.01 },
      { key: 'y', label: 'Height', min: 0.2, max: 3, step: 0.01 },
    ],
  },
  warp: {
    label: 'Warp',
    blurb: 'Envelope with presets and draggable points',
    group: 'Distort',
    fields: [
      { key: 'style', label: 'Style', options: WARP_STYLES },
      { key: 'bend', label: 'Bend', min: -1, max: 1, step: 0.01 },
    ],
  },
  arc: { label: 'Arc', blurb: 'Set text on a circle', group: 'Distort', fields: [{ key: 'bend', label: 'Bend', min: -1, max: 1, step: 0.01 }] },
  wave: {
    label: 'Wave',
    blurb: 'Wavy baseline',
    group: 'Distort',
    fields: [
      { key: 'amplitude', label: 'Amplitude', min: -0.5, max: 0.5, step: 0.005 },
      { key: 'wavelength', label: 'Wavelength', min: 0.2, max: 10, step: 0.05 },
      { key: 'phase', label: 'Phase', min: 0, max: 6.283, step: 0.01, advanced: true },
    ],
  },
  perspective: { label: 'Perspective', blurb: 'Keystone, like a poster on a wall', group: 'Distort', fields: [{ key: 'amount', label: 'Amount', min: -0.9, max: 0.9, step: 0.01 }] },
  wobble: {
    label: 'Wobble',
    blurb: 'Hand-drawn wiggle',
    group: 'Texture',
    fields: [
      { key: 'amount', label: 'Amount', min: 0, max: 0.2, step: 0.001 },
      { key: 'scale', label: 'Scale', min: 0.05, max: 3, step: 0.01 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true, advanced: true },
    ],
  },
  melt: {
    label: 'Melt',
    blurb: 'Dripping liquid',
    group: 'Texture',
    fields: [
      { key: 'amount', label: 'Drip length', min: 0, max: 1.5, step: 0.01 },
      { key: 'scale', label: 'Drip spacing', min: 0.05, max: 2, step: 0.01 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true, advanced: true },
    ],
  },
  ink: {
    label: 'Ink bleed',
    blurb: 'Rough letterpress edges',
    group: 'Texture',
    fields: [
      { key: 'amount', label: 'Amount', min: 0, max: 0.08, step: 0.001 },
      { key: 'scale', label: 'Scale', min: 0.05, max: 3, step: 0.01 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true, advanced: true },
    ],
  },
};

export function newModifier(kind: ModifierKind, overrides: Partial<Modifier> = {}): ModEntry {
  return { ...structuredClone(MODIFIER_DEFAULTS[kind]), ...overrides, on: true, uid: uid('m') } as ModEntry;
}

export const mods = (...m: Modifier[]): ModEntry[] => m.map((x) => ({ ...x, on: true, uid: uid('m') }) as ModEntry);

// ---------- symbols ----------

export const SYMBOL_DEFAULTS: Record<SymbolKind, SymbolSpec> = {
  circle: { kind: 'circle' },
  ring: { kind: 'ring', thickness: 0.18 },
  squircle: { kind: 'squircle', exponent: 5, aspect: 1 },
  roundRect: { kind: 'roundRect', radius: 0.2, aspect: 1 },
  polygon: { kind: 'polygon', sides: 6, rounding: 0.1 },
  star: { kind: 'star', points: 5, inner: 0.45, rounding: 0.1 },
  sparkle: { kind: 'sparkle', pinch: 0.3 },
  flower: { kind: 'flower', petals: 4, depth: 0.35 },
  burst: { kind: 'burst', rays: 12, ring: 0.12, ray_width: 0.1, inner: 0.26 },
  heart: { kind: 'heart' },
  moon: { kind: 'moon', phase: 0.4 },
  bolt: { kind: 'bolt' },
  arrow: { kind: 'arrow', head: 0.45, shaft: 0.3 },
  plus: { kind: 'plus', thickness: 0.3 },
  spiral: { kind: 'spiral', turns: 2.5, weight: 0.55 },
  pin: { kind: 'pin', corner: 3 },
  cursor: { kind: 'cursor' },
  bubble: { kind: 'bubble', tail: 0.3, roundness: 2.6 },
  blob: { kind: 'blob', lobes: 8, depth: 0.08, seed: 0, wobble: 0 },
  eyes: { kind: 'eyes', gap: 0.34, width: 0.14, height: 0.26 },
  catHead: { kind: 'catHead', ears: 0.3 },
};

export const SYMBOL_UI: Record<SymbolKind, { label: string; group: 'Basic' | 'Badge' | 'Mascot'; fields: NumberField[] }> = {
  circle: { label: 'Circle', group: 'Basic', fields: [] },
  ring: { label: 'Ring', group: 'Basic', fields: [{ key: 'thickness', label: 'Thickness', min: 0.01, max: 0.49, step: 0.005 }] },
  squircle: {
    label: 'Squircle',
    group: 'Basic',
    fields: [
      { key: 'exponent', label: 'Squareness', min: 1, max: 20, step: 0.1 },
      { key: 'aspect', label: 'Aspect', min: 0.2, max: 5, step: 0.01 },
    ],
  },
  roundRect: {
    label: 'Rounded rect',
    group: 'Basic',
    fields: [
      { key: 'radius', label: 'Radius', min: 0, max: 0.5, step: 0.005 },
      { key: 'aspect', label: 'Aspect', min: 0.2, max: 5, step: 0.01 },
    ],
  },
  polygon: {
    label: 'Polygon',
    group: 'Basic',
    fields: [
      { key: 'sides', label: 'Sides', min: 3, max: 16, step: 1, integer: true },
      { key: 'rounding', label: 'Rounding', min: 0, max: 0.5, step: 0.005 },
    ],
  },
  star: {
    label: 'Star',
    group: 'Badge',
    fields: [
      { key: 'points', label: 'Points', min: 3, max: 24, step: 1, integer: true },
      { key: 'inner', label: 'Inner radius', min: 0.05, max: 0.95, step: 0.005 },
      { key: 'rounding', label: 'Rounding', min: 0, max: 0.5, step: 0.005 },
    ],
  },
  sparkle: { label: 'Sparkle', group: 'Badge', fields: [{ key: 'pinch', label: 'Pinch', min: 0, max: 0.9, step: 0.01 }] },
  flower: {
    label: 'Flower',
    group: 'Badge',
    fields: [
      { key: 'petals', label: 'Petals', min: 2, max: 16, step: 1, integer: true },
      { key: 'depth', label: 'Depth', min: 0, max: 0.8, step: 0.005 },
    ],
  },
  burst: {
    label: 'Sun badge',
    group: 'Badge',
    fields: [
      { key: 'rays', label: 'Rays', min: 3, max: 36, step: 1, integer: true },
      { key: 'ring', label: 'Ring', min: 0.02, max: 0.3, step: 0.005 },
      { key: 'ray_width', label: 'Ray width', min: 0.01, max: 0.3, step: 0.005 },
      { key: 'inner', label: 'Inner ring', min: 0.05, max: 0.45, step: 0.005 },
    ],
  },
  heart: { label: 'Heart', group: 'Badge', fields: [] },
  moon: { label: 'Moon', group: 'Badge', fields: [{ key: 'phase', label: 'Fullness', min: 0, max: 1, step: 0.01 }] },
  bolt: { label: 'Bolt', group: 'Badge', fields: [] },
  arrow: {
    label: 'Arrow',
    group: 'Basic',
    fields: [
      { key: 'head', label: 'Head', min: 0.1, max: 0.9, step: 0.01 },
      { key: 'shaft', label: 'Shaft', min: 0.05, max: 0.9, step: 0.01 },
    ],
  },
  plus: { label: 'Plus', group: 'Basic', fields: [{ key: 'thickness', label: 'Thickness', min: 0.05, max: 0.9, step: 0.005 }] },
  spiral: {
    label: 'Spiral',
    group: 'Mascot',
    fields: [
      { key: 'turns', label: 'Turns', min: 0.5, max: 6, step: 0.05 },
      { key: 'weight', label: 'Weight', min: 0.1, max: 0.95, step: 0.01 },
    ],
  },
  pin: { label: 'Pin', group: 'Mascot', fields: [{ key: 'corner', label: 'Corner', min: 0, max: 5, step: 0.05 }] },
  cursor: { label: 'Cursor', group: 'Mascot', fields: [] },
  bubble: {
    label: 'Chat bubble',
    group: 'Mascot',
    fields: [
      { key: 'tail', label: 'Tail', min: 0, max: 0.6, step: 0.01 },
      { key: 'roundness', label: 'Squareness', min: 2, max: 8, step: 0.05 },
    ],
  },
  blob: {
    label: 'Cloud blob',
    group: 'Mascot',
    fields: [
      { key: 'lobes', label: 'Lobes', min: 2, max: 24, step: 1, integer: true },
      { key: 'depth', label: 'Lobe depth', min: 0, max: 0.3, step: 0.005 },
      { key: 'wobble', label: 'Wobble', min: 0, max: 1, step: 0.01 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true, advanced: true },
    ],
  },
  eyes: {
    label: 'Eyes',
    group: 'Mascot',
    fields: [
      { key: 'gap', label: 'Gap', min: 0, max: 1, step: 0.005 },
      { key: 'width', label: 'Width', min: 0.02, max: 0.5, step: 0.005 },
      { key: 'height', label: 'Height', min: 0.02, max: 1, step: 0.005 },
    ],
  },
  catHead: { label: 'Cat head', group: 'Mascot', fields: [{ key: 'ears', label: 'Ears', min: 0, max: 0.6, step: 0.005 }] },
};

// ---------- styles ----------

export function style(effect: string, overrides: ParamValues = {}): Style {
  return { effect, params: { ...defaultParams(effectById(effect)), ...overrides } };
}

export const DEFAULT_STYLE = (): Style => style('flat');

// ---------- factories ----------

function layer(content: Content, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    id: uid(),
    visible: true,
    op: 'add',
    x: 0,
    y: 0,
    rotation: 0,
    scale: 1,
    sx: 1,
    sy: 1,
    modifiers: [],
    content,
    style: DEFAULT_STYLE(),
    ...extra,
  };
}

type TextContent = Extract<Content, { type: 'text' }>;

export function textLayer(text = 'Morph', font = 'archivo', extra: Partial<ShapeLayer> = {}, content: Partial<TextContent> = {}): ShapeLayer {
  return layer({ type: 'text', text, font, size: 220, tracking: 0, lineHeight: 1, align: 'center', axes: {}, morph: null, ligatures: true, ...content }, extra);
}

export function symbolLayer(kind: SymbolKind, size = 420, extra: Partial<ShapeLayer> = {}, params: Partial<SymbolSpec> = {}): ShapeLayer {
  return layer({ type: 'symbol', symbol: { ...SYMBOL_DEFAULTS[kind], ...params } as SymbolSpec, size }, extra);
}

export function pathLayer(d: string, size: number, name: string, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return layer({ type: 'path', d, size, name }, { name, ...extra });
}

export function morphLayer(a: string, b: string): ShapeLayer {
  return layer({ type: 'morph', a, b, t: 0.5 });
}

export function group(children: Node[], extra: Partial<Group> = {}): Group {
  return { type: 'group', id: uid('g'), visible: true, op: 'add', merge: false, open: true, style: DEFAULT_STYLE(), modifiers: [], children, ...extra };
}

export function nodeLabel(n: Node): string {
  if (n.name) return n.name;
  if (isGroup(n)) return n.merge ? 'Merged shape' : 'Group';
  const c = n.content;
  switch (c.type) {
    case 'text':
      return c.text.replace(/\n/g, ' ').trim() || 'Empty text';
    case 'symbol':
      return SYMBOL_UI[c.symbol.kind]?.label ?? 'Shape';
    case 'path':
      return c.name ?? 'Outline';
    case 'morph':
      return 'Morph';
  }
}

export function fill(kind: FillKind, ...colors: string[]): Fill {
  return { kind, colors, angle: 180 };
}

export function background(f: Fill = fill('solid', '#0b0b0d'), extra: Partial<Background> = {}): Background {
  return { fill: f, grain: 0, tile: null, ...extra };
}

export function tile(f: Fill, extra: Partial<Tile> = {}): Tile {
  return { shape: 'squircle', size: 0.84, radius: 0.6, fill: f, gloss: 0.35, shadow: 0.3, rim: 0, rimColor: '#ffffff', holo: false, ...extra };
}

export function emptyProject(): Project {
  return {
    version: 2,
    name: 'Untitled',
    canvas: { width: 1200, height: 1200 },
    background: background(),
    layers: [textLayer('Morph', 'archivo', { style: style('chrome') })],
    fonts: [],
  };
}

export const CANVAS_PRESETS: { label: string; group: string; w: number; h: number; keywords?: string }[] = [
  { label: 'Logo', group: 'Brand', w: 1200, h: 1200 },
  { label: 'App icon', group: 'Brand', w: 1024, h: 1024 },
  { label: 'Favicon', group: 'Brand', w: 512, h: 512 },
  { label: 'Wordmark', group: 'Brand', w: 2000, h: 700 },
  { label: 'Instagram post', group: 'Social', w: 1080, h: 1080, keywords: 'square feed' },
  { label: 'Instagram portrait', group: 'Social', w: 1080, h: 1350 },
  { label: 'Story / Reel', group: 'Social', w: 1080, h: 1920, keywords: 'instagram tiktok shorts vertical phone' },
  { label: 'YouTube thumbnail', group: 'Social', w: 1280, h: 720, keywords: 'video cover 16:9' },
  { label: 'X / Twitter header', group: 'Social', w: 1500, h: 500, keywords: 'banner cover' },
  { label: 'Open Graph image', group: 'Web', w: 1200, h: 630, keywords: 'og social share link preview' },
  { label: 'Desktop wallpaper', group: 'Web', w: 2560, h: 1440 },
  { label: 'Poster', group: 'Print', w: 1200, h: 1800 },
];
