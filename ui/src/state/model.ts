import type { Content, EngineLayer, GlyphPart, LineCap, ModEntry, Modifier, ModifierKind, Op, SymbolKind, SymbolSpec, TextMorph } from '../engine/types';
import { defaultParams, effectById, type ParamValues } from '../render/effects';
import type { Motion, ParamAnim } from './motion';
import type { Timeline } from './clock';

export interface ProjectFont {
  id: string;
  /** Base64 font bytes for fonts the user imported (bundled ones are referenced by id). */
  data?: string;
  name?: string;
}

export type StrokeAlign = 'outside' | 'center' | 'inside';

/** A line around the outline, drawn over any material. */
export interface Stroke {
  /** Artboard px. */
  width: number;
  color: string;
  align: StrokeAlign;
  opacity: number;
}

export type BlendMode = 'normal' | 'multiply' | 'screen';

/** Solid 3D extrusion behind a layer, like letters cut from thick card. */
export interface Depth {
  /** Artboard px. */
  amount: number;
  /** Direction the sides go toward, degrees clockwise from up (135 = down-right). */
  angle: number;
  color: string;
  /** 0..1: how much the sides darken toward the back. */
  shade: number;
}

export function depth(amount = 40, color = '#ff5a1f', angle = 150): Depth {
  return { amount, angle, color, shade: 0.35 };
}

/** How an object is shaded: an effect and its parameters, plus an optional stroke. */
export interface Style {
  effect: string;
  params: ParamValues;
  stroke?: Stroke | null;
  /** 0..1, default 1. */
  opacity?: number;
  /** How it mixes with what's below (multiply for overprinted inks). */
  blend?: BlendMode;
  depth?: Depth | null;
  /** Soft edges, in artboard px: a blur of the outline (cheap, from the distance field). */
  soften?: number;
  /** Settings that change over time on the scene clock, by param key. */
  animate?: Record<string, ParamAnim>;
}

export function stroke(width = 6, color = '#0a0a0a', align: StrokeAlign = 'outside'): Stroke {
  return { width, color, align, opacity: 1 };
}

/** A shape on the canvas: text, symbol, outline or morph, with its own style. */
export interface ShapeLayer extends EngineLayer {
  name?: string;
  locked?: boolean;
  style: Style;
  /** A reference to trace over: shown while designing, left out of every export. */
  guide?: boolean;
  /** Loop and entrance, played on the scene clock. */
  motion?: Motion;
  /** Shape and modifier settings that change over time, rebuilt on the scene clock (see geoMotion.ts). */
  animate?: Record<string, ParamAnim>;
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
  /** Clip everything above the bottom layer to its shape, like a frame. */
  clip?: boolean;
  style: Style;
  modifiers: ModEntry[];
  children: Node[];
  /** Moves the whole group, or each child in turn (see Motion.stagger). */
  motion?: Motion;
  /** Merged groups: modifier settings that change over time (see geoMotion.ts). */
  animate?: Record<string, ParamAnim>;
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

export type PatternKind = 'grid' | 'dots' | 'lines' | 'diagonal' | 'checker' | 'doodles';

/** A repeating pattern over the page fill: grid paper, dot grid, stripes… */
export interface Pattern {
  kind: PatternKind;
  /** Cell size in artboard px. */
  size: number;
  /** Line width or dot radius in px. */
  weight: number;
  color: string;
  opacity: number;
}

export interface Background {
  fill: Fill;
  grain: number;
  tile: Tile | null;
  pattern?: Pattern | null;
}

/** A font being designed in Type mode. */
export interface TypeProject {
  /** Stable id, so renaming the font keeps it linked to text using it. */
  id?: string;
  /** Started blank: only drawn glyphs are in the font. */
  blank?: boolean;
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
  /** Kerning by character pair ("AV"), in em: replaces the base font's for that pair. */
  kerning: Record<string, number>;
  sample: string;
  /** Files exported or installed so far; the font's version is 1.<revision>. */
  revision?: number;
}

export interface GlyphEdit {
  /** Replacement outline in em units (y-down, baseline 0). */
  d?: string;
  advance?: number;
  modifiers?: ModEntry[];
  /** Layers on top of the outline, bottom to top. */
  parts?: GlyphPart[];
  /** Skip the font-wide look for this glyph. */
  ownLook?: boolean;
  /** Leave out the base or drawn outline: the glyph is only its parts. */
  hideBase?: boolean;
}

export interface Project {
  version: 2;
  name: string;
  canvas: { width: number; height: number };
  background: Background;
  layers: Node[];
  fonts: ProjectFont[];
  /** Pictures used by Photo materials; only present in saved files (see assets.ts). */
  images?: { id: string; data: string; w: number; h: number; name?: string }[];
  type?: TypeProject;
  /** Length and looping of the scene clock (animated materials and motion). */
  timeline?: Timeline;
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
  mirror: { kind: 'mirror', axis: 'x', flip: 0, offset: 0 },
  scallop: { kind: 'scallop', count: 12, depth: 1, width: 1, inward: 0 },
  outline: { kind: 'outline', width: 0.04 },
  ink: { kind: 'ink', amount: 0.015, scale: 0.5, seed: 1 },
  slant: { kind: 'slant', angle: 12 },
  stretch: { kind: 'stretch', x: 1.2, y: 1 },
  wave: { kind: 'wave', amplitude: 0.08, wavelength: 2.5, phase: 0 },
  arc: { kind: 'arc', bend: 0.35 },
  warp: { kind: 'warp', style: 'arch', bend: 0.5, points: [] },
  wobble: { kind: 'wobble', amount: 0.03, scale: 0.6, seed: 1 },
  melt: { kind: 'melt', amount: 0.3, scale: 0.4, seed: 1 },
  pixelate: { kind: 'pixelate', size: 0.07, shape: 'square', gap: 0, dissolve: 0, angle: 180, seed: 1 },
  perspective: { kind: 'perspective', amount: 0.3 },
  slice: { kind: 'slice', count: 8, gap: 0.035, angle: 0, ring: 0, hole: 0, jitter: 0, seed: 1, soften: 0.02, x: 0, y: 0 },
  repeat: { kind: 'repeat', mode: 'radial', count: 6, radius: 0.6, sweep: 360, orient: 1, cols: 3, rows: 1, gapX: 0.1, gapY: 0.1, dx: 0.06, dy: 0.06, grow: 1, spin: 0 },
  echo: { kind: 'echo', count: 3, spacing: 0.06, width: 0.015 },
  fuse: { kind: 'fuse', amount: 0.08 },
  fitCircle: { kind: 'fitCircle', amount: 1 },
  isometric: { kind: 'isometric', face: 'top' },
  foam: { kind: 'foam', amount: 0.7, size: 0.16, wall: 0.012, spread: 0, angle: 135, seed: 1 },
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
  /** A 0/1 value shown as a switch. */
  toggle?: boolean;
  /** Only shown while other fields have these values ('nonzero': while a number isn't 0). */
  show?: Record<string, string>;
}

export interface ChoiceField {
  key: string;
  label: string;
  options: { value: string; label: string; title?: string }[];
  show?: Record<string, string>;
}

/** How an open stroke ends: pen lines, smiles and spirals. */
export const CAP_OPTIONS: { value: LineCap; label: string; title: string }[] = [
  { value: 'round', label: 'Round', title: 'Round ends, like a marker' },
  { value: 'butt', label: 'Flat', title: 'Cut square at the last point' },
  { value: 'square', label: 'Square', title: 'Square, half the width past the last point' },
];

/** Whether a field applies given the modifier's current values. */
export function fieldShown(f: Field, values: Record<string, unknown>): boolean {
  // 'nonzero' shows a field only while a number field isn't 0 (e.g. a fade's direction).
  return !f.show || Object.entries(f.show).every(([k, v]) => (v === 'nonzero' ? Number(values[k] ?? 0) !== 0 : values[k] === v));
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
  mirror: {
    label: 'Mirror',
    blurb: 'Symmetric halves: draw one side, get both',
    group: 'Shape',
    fields: [
      {
        key: 'axis',
        label: 'Halves',
        options: [
          { value: 'x', label: 'Left · right' },
          { value: 'y', label: 'Top · bottom' },
          { value: 'both', label: 'Both' },
        ],
      },
      { key: 'flip', label: 'Keep the other half', min: 0, max: 1, step: 1, toggle: true },
      { key: 'offset', label: 'Move the line', min: -1, max: 1, step: 0.001 },
    ],
  },
  scallop: {
    label: 'Scallops',
    blurb: 'Round bumps or bites all along the edge',
    group: 'Shape',
    fields: [
      { key: 'count', label: 'Bumps', min: 3, max: 64, step: 1, integer: true },
      { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01 },
      { key: 'width', label: 'Width', min: 0.5, max: 2, step: 0.01 },
      { key: 'inward', label: 'Bite in', min: 0, max: 1, step: 1, toggle: true },
    ],
  },
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
          { value: 'cross', label: 'Cross' },
          { value: 'plus', label: 'Plus' },
          { value: 'diamond', label: 'Diamond' },
        ],
      },
      { key: 'size', label: 'Pixel size', min: 0.01, max: 0.3, step: 0.001 },
      { key: 'gap', label: 'Gap', min: 0, max: 0.8, step: 0.01 },
      { key: 'dissolve', label: 'Dissolve', min: 0, max: 1, step: 0.01 },
      { key: 'angle', label: 'Dissolve toward', min: 0, max: 360, step: 1, advanced: true },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true, advanced: true },
    ],
  },
  slice: {
    label: 'Slice',
    blurb: 'Cut rays or pie wedges out from the centre',
    group: 'Shape',
    fields: [
      { key: 'count', label: 'Cuts', min: 0, max: 48, step: 1, integer: true },
      { key: 'gap', label: 'Gap', min: 0.005, max: 0.2, step: 0.001 },
      { key: 'ring', label: 'Ring', min: 0, max: 1, step: 0.005 },
      { key: 'hole', label: 'Hole', min: 0, max: 1, step: 0.005 },
      { key: 'soften', label: 'Soft corners', min: 0, max: 0.15, step: 0.001 },
      { key: 'angle', label: 'Rotate', min: -180, max: 180, step: 0.5 },
      { key: 'x', label: 'Centre X', min: -1, max: 1, step: 0.005, advanced: true },
      { key: 'y', label: 'Centre Y', min: -1, max: 1, step: 0.005, advanced: true },
      { key: 'jitter', label: 'Irregular', min: 0, max: 1, step: 0.01, advanced: true },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true, advanced: true },
    ],
  },
  echo: {
    label: 'Echo lines',
    blurb: 'Concentric outline rings around the shape',
    group: 'Shape',
    fields: [
      { key: 'count', label: 'Rings', min: 1, max: 20, step: 1, integer: true },
      { key: 'spacing', label: 'Spacing', min: 0.005, max: 0.3, step: 0.001 },
      { key: 'width', label: 'Line width', min: 0.002, max: 0.15, step: 0.001 },
    ],
  },
  fuse: { label: 'Fuse', blurb: 'Melt nearby letters into one solid form', group: 'Shape', fields: [{ key: 'amount', label: 'Close gaps', min: 0, max: 0.4, step: 0.001 }] },
  foam: {
    label: 'Foam',
    blurb: 'Packed bubbles cut out, like foam or a sponge',
    group: 'Shape',
    fields: [
      { key: 'amount', label: 'Bubbles', min: 0, max: 1, step: 0.01 },
      { key: 'size', label: 'Largest', min: 0.02, max: 0.6, step: 0.005 },
      { key: 'wall', label: 'Walls', min: 0.002, max: 0.08, step: 0.001 },
      { key: 'spread', label: 'Fade out', min: 0, max: 1, step: 0.01 },
      { key: 'angle', label: 'Fade toward', min: 0, max: 360, step: 1, show: { spread: 'nonzero' } },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true, advanced: true },
    ],
  },
  repeat: {
    label: 'Repeat',
    blurb: 'Copies around a circle or in a grid',
    group: 'Shape',
    fields: [
      {
        key: 'mode',
        label: 'Layout',
        options: [
          { value: 'radial', label: 'Around' },
          { value: 'grid', label: 'Grid' },
          { value: 'trail', label: 'Trail' },
        ],
      },
      { key: 'count', label: 'Copies', min: 1, max: 48, step: 1, integer: true, show: { mode: 'radial' } },
      { key: 'count', label: 'Copies', min: 1, max: 48, step: 1, integer: true, show: { mode: 'trail' } },
      { key: 'dx', label: 'Step X', min: -1, max: 1, step: 0.002, show: { mode: 'trail' } },
      { key: 'dy', label: 'Step Y', min: -1, max: 1, step: 0.002, show: { mode: 'trail' } },
      { key: 'grow', label: 'Scale per step', min: 0.5, max: 1.5, step: 0.005, show: { mode: 'trail' } },
      { key: 'spin', label: 'Turn per step', min: -45, max: 45, step: 0.5, show: { mode: 'trail' } },
      { key: 'radius', label: 'Radius', min: 0, max: 4, step: 0.01, show: { mode: 'radial' } },
      { key: 'orient', label: 'Face outward', min: 0, max: 1, step: 1, toggle: true, show: { mode: 'radial' } },
      { key: 'sweep', label: 'Sweep', min: -360, max: 360, step: 1, advanced: true, show: { mode: 'radial' } },
      { key: 'cols', label: 'Columns', min: 1, max: 30, step: 1, integer: true, show: { mode: 'grid' } },
      { key: 'rows', label: 'Rows', min: 1, max: 30, step: 1, integer: true, show: { mode: 'grid' } },
      { key: 'gapX', label: 'Gap X', min: -1, max: 2, step: 0.005, show: { mode: 'grid' } },
      { key: 'gapY', label: 'Gap Y', min: -1, max: 2, step: 0.005, show: { mode: 'grid' } },
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
  arc: { label: 'Arc', blurb: 'Set text on a circle; 2 goes all the way round', group: 'Distort', fields: [{ key: 'bend', label: 'Bend', min: -2, max: 2, step: 0.01 }] },
  isometric: {
    label: 'Isometric',
    blurb: 'Lay it on a face of a 3D cube',
    group: 'Distort',
    fields: [
      {
        key: 'face',
        label: 'Face',
        options: [
          { value: 'top', label: 'Top' },
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
      },
    ],
  },
  fitCircle: { label: 'Fit in circle', blurb: 'Squeeze into a round badge or ellipse', group: 'Distort', fields: [{ key: 'amount', label: 'Amount', min: 0, max: 1.5, step: 0.01 }] },
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
  flower: { kind: 'flower', petals: 4, depth: 0.35, petal: 'wave', hole: 0 },
  burst: { kind: 'burst', rays: 12, ring: 0.12, ray_width: 0.1, inner: 0.26 },
  heart: { kind: 'heart' },
  moon: { kind: 'moon', phase: 0.4 },
  bolt: { kind: 'bolt' },
  arrow: { kind: 'arrow', head: 0.45, shaft: 0.3 },
  plus: { kind: 'plus', thickness: 0.3 },
  spiral: { kind: 'spiral', turns: 2.5, weight: 0.55, cap: 'round' },
  pin: { kind: 'pin', corner: 3 },
  cursor: { kind: 'cursor' },
  bubble: { kind: 'bubble', tail: 0.3, roundness: 2.6 },
  blob: { kind: 'blob', lobes: 8, depth: 0.08, seed: 0, wobble: 0 },
  eyes: { kind: 'eyes', gap: 0.34, width: 0.14, height: 0.26 },
  catHead: { kind: 'catHead', ears: 0.3 },
  smile: { kind: 'smile', curve: 0.5, weight: 0.35, cap: 'round' },
  rays: { kind: 'rays', rays: 12, short: 0.55, inner: 0.18, jitter: 0, seed: 0 },
  pill: { kind: 'pill', aspect: 3 },
  quarter: { kind: 'quarter' },
  half: { kind: 'half' },
  cove: { kind: 'cove' },
  folder: { kind: 'folder', tab: 0.38, corner: 0.05 },
  wavy: { kind: 'wavy', waves: 18, depth: 0.08, scallop: 0 },
  lens: { kind: 'lens', aspect: 0.55 },
  cloud: { kind: 'cloud', puffs: 3, seed: 0 },
  globe: { kind: 'globe', meridians: 2, parallels: 2, weight: 0.04, aspect: 1 },
  asterisk: { kind: 'asterisk', arms: 8, weight: 0.12, inner: 0 },
};

export const SYMBOL_UI: Record<SymbolKind, { label: string; group: 'Basic' | 'Badge' | 'Mascot'; fields: Field[] }> = {
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
  wavy: {
    label: 'Wavy badge',
    group: 'Badge',
    fields: [
      { key: 'waves', label: 'Waves', min: 3, max: 64, step: 1, integer: true },
      { key: 'depth', label: 'Depth', min: 0, max: 0.3, step: 0.005 },
      { key: 'scallop', label: 'Scallops', min: 0, max: 1, step: 0.01 },
    ],
  },
  sparkle: { label: 'Sparkle', group: 'Badge', fields: [{ key: 'pinch', label: 'Pinch', min: 0, max: 0.9, step: 0.01 }] },
  asterisk: {
    label: 'Asterisk',
    group: 'Badge',
    fields: [
      { key: 'arms', label: 'Arms', min: 2, max: 64, step: 1, integer: true },
      { key: 'weight', label: 'Line weight', min: 0.005, max: 0.4, step: 0.005 },
      { key: 'inner', label: 'Empty middle', min: 0, max: 0.9, step: 0.01 },
    ],
  },
  globe: {
    label: 'Globe',
    group: 'Badge',
    fields: [
      { key: 'meridians', label: 'Meridians', min: 0, max: 8, step: 1, integer: true },
      { key: 'parallels', label: 'Parallels', min: 0, max: 8, step: 1, integer: true },
      { key: 'weight', label: 'Line weight', min: 0.01, max: 0.2, step: 0.005 },
      { key: 'aspect', label: 'Width', min: 0.3, max: 3, step: 0.01 },
    ],
  },
  flower: {
    label: 'Flower',
    group: 'Badge',
    fields: [
      {
        key: 'petal',
        label: 'Petal',
        options: [
          { value: 'wave', label: 'Wavy' },
          { value: 'round', label: 'Round' },
          { value: 'pill', label: 'Pill' },
          { value: 'oval', label: 'Oval' },
          { value: 'pointed', label: 'Pointed' },
        ],
      },
      { key: 'petals', label: 'Petals', min: 2, max: 16, step: 1, integer: true },
      { key: 'depth', label: 'Gaps', min: 0, max: 0.8, step: 0.005 },
      { key: 'hole', label: 'Centre hole', min: 0, max: 0.8, step: 0.005 },
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
  pill: { label: 'Pill', group: 'Basic', fields: [{ key: 'aspect', label: 'Aspect', min: 0.2, max: 8, step: 0.01 }] },
  lens: { label: 'Lens', group: 'Basic', fields: [{ key: 'aspect', label: 'Width', min: 0.05, max: 1, step: 0.01 }] },
  quarter: { label: 'Quarter circle', group: 'Basic', fields: [] },
  half: { label: 'Half circle', group: 'Basic', fields: [] },
  cove: { label: 'Cove', group: 'Basic', fields: [] },
  folder: {
    label: 'Folder',
    group: 'Mascot',
    fields: [
      { key: 'tab', label: 'Tab', min: 0.1, max: 0.8, step: 0.005 },
      { key: 'corner', label: 'Corners', min: 0, max: 0.2, step: 0.005 },
    ],
  },  cloud: {
    label: 'Cloud',
    group: 'Mascot',
    fields: [
      { key: 'puffs', label: 'Puffs', min: 1, max: 7, step: 1, integer: true },
      { key: 'seed', label: 'Variation', min: 0, max: 99, step: 1, integer: true },
    ],
  },

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
      { key: 'cap', label: 'Ends', options: CAP_OPTIONS },
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
  smile: {
    label: 'Smile',
    group: 'Mascot',
    fields: [
      { key: 'curve', label: 'Curve', min: -1, max: 1, step: 0.01 },
      { key: 'weight', label: 'Thickness', min: 0.05, max: 1, step: 0.01 },
      { key: 'cap', label: 'Ends', options: CAP_OPTIONS },
    ],
  },
  rays: {
    label: 'Starburst',
    group: 'Badge',
    fields: [
      { key: 'rays', label: 'Rays', min: 3, max: 48, step: 1, integer: true },
      { key: 'short', label: 'Short rays', min: 0, max: 1, step: 0.01 },
      { key: 'inner', label: 'Inner radius', min: 0.05, max: 0.45, step: 0.005 },
      { key: 'jitter', label: 'Irregular', min: 0, max: 1, step: 0.01 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, integer: true, advanced: true },
    ],
  },
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

/** A freehand stroke through points relative to the layer position. */
export function strokeLayer(points: [number, number][], width = 8, extra: Partial<ShapeLayer> = {}, opts: { taper?: number; smooth?: number } = {}): ShapeLayer {
  return layer({ type: 'stroke', points: points.map(([x, y]) => [x, y, 0] as [number, number, number]), width, taper: opts.taper ?? 0, smooth: opts.smooth ?? 0.5 }, { name: 'Drawing', ...extra });
}

/** A pen line: `d` in em units of `size` px, stroked `width` px wide. */
export function lineLayer(d: string, size: number, width = 12, extra: Partial<ShapeLayer> = {}, cap: LineCap = 'round'): ShapeLayer {
  return layer({ type: 'line', d, size, width, cap }, { name: 'Line', style: style('flat', { fill: '#0a0a0a' }), ...extra });
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
    case 'stroke':
      return 'Drawing';
    case 'line':
      return 'Line';
  }
}

export function fill(kind: FillKind, ...colors: string[]): Fill {
  return { kind, colors, angle: 180 };
}

export function background(f: Fill = fill('solid', '#0b0b0d'), extra: Partial<Background> = {}): Background {
  return { fill: f, grain: 0, tile: null, ...extra };
}

export function pattern(kind: PatternKind, color = '#000000', extra: Partial<Pattern> = {}): Pattern {
  return { kind, size: kind === 'dots' ? 40 : kind === 'doodles' ? 120 : 100, weight: kind === 'doodles' ? 7 : 3, color, opacity: 1, ...extra };
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
  { label: 'Business card', group: 'Print', w: 1050, h: 600, keywords: '3.5 x 2 in 300 dpi stationery' },
  { label: 'ID badge', group: 'Print', w: 1011, h: 638, keywords: 'cr80 card lanyard' },
  { label: 'A4 flyer', group: 'Print', w: 2480, h: 3508, keywords: 'a4 300 dpi print paper' },
];
