// Mirrors the serde types in crates/morpho-core/src/engine.rs.

export type Op = 'add' | 'subtract' | 'intersect';
export type Align = 'left' | 'center' | 'right';

export type Modifier =
  | { kind: 'weight'; amount: number }
  | { kind: 'round'; radius: number }
  | { kind: 'mirror'; axis: 'x' | 'y' | 'both'; flip: number; offset: number }
  | { kind: 'scallop'; count: number; depth: number; width: number; inward: number }
  | { kind: 'outline'; width: number }
  | { kind: 'ink'; amount: number; scale: number; seed: number }
  | { kind: 'slant'; angle: number }
  | { kind: 'stretch'; x: number; y: number }
  | { kind: 'wave'; amplitude: number; wavelength: number; phase: number }
  | { kind: 'arc'; bend: number }
  | { kind: 'wobble'; amount: number; scale: number; seed: number }
  | { kind: 'melt'; amount: number; scale: number; seed: number }
  | { kind: 'pixelate'; size: number; shape: PixelShape; gap: number; dissolve?: number; angle?: number; seed?: number }
  | { kind: 'perspective'; amount: number }
  | { kind: 'warp'; style: WarpStyle; bend: number; points: [number, number][] }
  | { kind: 'slice'; count: number; gap: number; angle: number; ring: number; hole: number; jitter: number; seed: number; soften: number; x?: number; y?: number }
  | {
      kind: 'repeat';
      mode: RepeatMode;
      count: number;
      radius: number;
      sweep: number;
      orient: number;
      cols: number;
      rows: number;
      gapX: number;
      gapY: number;
      dx: number;
      dy: number;
      grow: number;
      spin: number;
    }
  | { kind: 'echo'; count: number; spacing: number; width: number }
  | { kind: 'fuse'; amount: number }
  | { kind: 'fitCircle'; amount: number }
  | { kind: 'isometric'; face: IsoFace }
  | { kind: 'foam'; amount: number; size: number; wall: number; spread: number; angle: number; seed: number };

export type RepeatMode = 'radial' | 'grid' | 'trail';

export type PixelShape = 'square' | 'dot' | 'rounded' | 'cross' | 'plus' | 'diamond';
export type IsoFace = 'top' | 'left' | 'right';
export type WarpStyle = 'custom' | 'arch' | 'arc' | 'arcLower' | 'bulge' | 'flag' | 'rise' | 'fish' | 'inflate' | 'squeeze' | 'twist';

export type ModifierKind = Modifier['kind'];
export type ModEntry = Modifier & { on: boolean; uid: string };

export type SymbolSpec =
  | { kind: 'circle' }
  | { kind: 'ring'; thickness: number }
  | { kind: 'squircle'; exponent: number; aspect: number }
  | { kind: 'roundRect'; radius: number; aspect: number }
  | { kind: 'polygon'; sides: number; rounding: number }
  | { kind: 'star'; points: number; inner: number; rounding: number }
  | { kind: 'sparkle'; pinch: number }
  | { kind: 'burst'; rays: number; ring: number; ray_width: number; inner: number }
  | { kind: 'pin'; corner: number }
  | { kind: 'cursor' }
  | { kind: 'blob'; lobes: number; depth: number; seed: number; wobble: number }
  | { kind: 'eyes'; gap: number; width: number; height: number }
  | { kind: 'heart' }
  | { kind: 'plus'; thickness: number }
  | { kind: 'catHead'; ears: number }
  | { kind: 'bubble'; tail: number; roundness: number }
  | { kind: 'spiral'; turns: number; weight: number; cap?: LineCap }
  | { kind: 'flower'; petals: number; depth: number; petal?: 'wave' | 'round' | 'pill' | 'oval' | 'pointed'; hole?: number }
  | { kind: 'arrow'; head: number; shaft: number }
  | { kind: 'bolt' }
  | { kind: 'moon'; phase: number }
  | { kind: 'smile'; curve: number; weight: number; cap?: LineCap }
  | { kind: 'rays'; rays: number; short: number; inner: number; jitter: number; seed: number }
  | { kind: 'quarter' }
  | { kind: 'half' }
  | { kind: 'cove' }
  | { kind: 'pill'; aspect: number }
  | { kind: 'folder'; tab: number; corner: number }
  | { kind: 'wavy'; waves: number; depth: number; scallop: number }
  | { kind: 'lens'; aspect: number }
  | { kind: 'cloud'; puffs: number; seed: number }
  | { kind: 'globe'; meridians: number; parallels: number; weight: number; aspect: number }
  | { kind: 'asterisk'; arms: number; weight: number; inner: number };

export type SymbolKind = SymbolSpec['kind'];

export interface TextMorph {
  font: string;
  t: number;
  axes: Record<string, number>;
}

export type Content =
  | {
      type: 'text';
      text: string;
      font: string;
      size: number;
      tracking: number;
      lineHeight: number;
      align: Align;
      axes: Record<string, number>;
      morph: TextMorph | null;
      ligatures: boolean;
    }
  | { type: 'symbol'; symbol: SymbolSpec; size: number }
  | { type: 'path'; d: string; size: number; name?: string }
  | { type: 'morph'; a: string; b: string; t: number }
  /** Freehand brush stroke; points are [x, y, pressure] in layer pixels. */
  | { type: 'stroke'; points: [number, number, number][]; width: number; taper: number; smooth: number }
  /** Pen line: path data in em units × size; open subpaths are stroked `width` px wide. */
  | { type: 'line'; d: string; size: number; width: number; cap: LineCap; squiggle?: Squiggle | null; dash?: Dash | null };

export type LineCap = 'round' | 'butt' | 'square';

export type SquiggleKind = 'zigzag' | 'meander' | 'loops' | 'scallop';

/** A zigzag, wave, meander, coil or scallop along a pen line (px). */
export interface Squiggle {
  kind: SquiggleKind;
  /** Line to tip. */
  amplitude: number;
  /** Tip to tip along the line. */
  spacing: number;
  /** 0 sharp, 1 fully rounded. */
  smooth: number;
  /** Zigzag: radius of each turn in px; the tips stay at the amplitude. */
  round?: number;
  /** Coils: how far each turn rolls back (above 1 it loops). */
  loops: number;
  /** Whole ridges on every segment between pen points. */
  perSegment: boolean;
  /** End with a leg straight across the line. */
  flatEnds: boolean;
  flip: boolean;
}

/** Dashes along a pen line (px); a 0 dash with round ends draws dots. */
export interface Dash {
  dash: number;
  gap: number;
  offset: number;
}

/** What the engine needs to know about a layer. */
export interface EngineLayer {
  id: string;
  visible: boolean;
  op: Op;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  /** Stretch in the layer's own frame. */
  sx: number;
  sy: number;
  modifiers: ModEntry[];
  content: Content;
}

export type Box = [number, number, number, number];

export type Member = string | { id: string; op: Op };

export interface RenderSpec {
  id: string;
  members: Member[];
  modifiers?: ModEntry[];
  em?: number;
}

export interface EngineDocument {
  layers: EngineLayer[];
  renders?: RenderSpec[];
  quality?: number;
}

export interface LayerOut {
  id: string;
  bbox: Box | null;
  error: string | null;
  d: string | null;
  local: Box | null;
  frames: { uid: string; bbox: Box }[];
}

export interface RenderOut {
  id: string;
  d: string;
  bbox: Box | null;
  points: number;
  /** A single pen line's centre line: `[x, y, t, joined]` per point (t 0…1 along it). */
  spine?: number[];
}

export interface BuildOut {
  renders: RenderOut[];
  bbox: Box | null;
  layers: LayerOut[];
  points: number;
}

export interface PathsOut {
  paths: { id: string; d: string }[];
  bbox: Box | null;
}

export interface BakeOut {
  d: string;
  size: number;
}

export interface PieceOut {
  d: string;
  size: number;
  x: number;
  y: number;
}

export interface CaretLine {
  /** UTF-16 offset of the line's first character. */
  start: number;
  baseline: number;
  /** x before each UTF-16 unit of the line, then the line end. */
  carets: number[];
}

/** Caret layout of a text layer in its local units (before modifiers). */
export interface TextLayout {
  lines: CaretLine[];
  ascent: number;
  descent: number;
  cap: number;
}

export interface GlyphOut {
  d: string;
  advance: number;
  exists: boolean;
}

export interface GlyphPreview {
  ch: string;
  d: string;
  advance: number;
  edited: boolean;
}

export interface GlyphEdit {
  ch: string;
  d?: string;
  advance?: number;
  modifiers?: ModEntry[];
  parts?: GlyphPart[];
  ownLook?: boolean;
  hideBase?: boolean;
}

/**
 * A layer of a glyph, in em units (y-down, baseline 0): a library shape
 * (centred on x, y), a path, or another glyph used as a component.
 */
export interface GlyphPart {
  id: string;
  name?: string;
  symbol?: SymbolSpec;
  glyph?: string;
  d?: string;
  op: Op;
  x: number;
  y: number;
  /** A shape's size in em, or a component's or path's scale. */
  size: number;
  rotation: number;
  sx: number;
  sy: number;
  modifiers: ModEntry[];
  visible: boolean;
}

export interface Axis {
  tag: string;
  name: string;
  min: number;
  default: number;
  max: number;
}

export interface FontInfo {
  family: string;
  style: string;
  fullName: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineGap: number;
  capHeight: number;
  xHeight: number;
  glyphCount: number;
  axes: Axis[];
  faces: number;
  /** Copyright notice, licence and licence URL (name IDs 0, 13, 14). */
  copyright?: string;
  license?: string;
  licenseUrl?: string;
}

export interface TraceOptions {
  threshold: number | null;
  invert: boolean;
  smooth: number;
  despeckle: number;
  pixel: boolean;
  maxSize?: number;
  /** Normalise to the whole image (so traces of one picture line up). */
  frame?: boolean;
}

export interface TraceOut {
  d: string;
  contours: number;
  aspect: number;
}

export interface FontSpec {
  font: string;
  axes: Record<string, number>;
  morph: TextMorph | null;
  modifiers: ModEntry[];
  family: string;
  style: string;
  charset: string | null;
  weightClass?: number;
  quality?: number;
  glyphs?: GlyphEdit[];
  tracking?: number;
  format?: 'ttf' | 'woff';
  /** Only drawn glyphs; the base font lends metrics. */
  blank?: boolean;
  /** Font version, e.g. "1.004". */
  version?: string;
}

export interface SvgOptions {
  fill?: string;
  background?: string;
  padding?: number;
}
