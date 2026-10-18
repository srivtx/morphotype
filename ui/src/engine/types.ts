// Mirrors the serde types in crates/morpho-core/src/engine.rs.

export type Op = 'add' | 'subtract' | 'intersect';
export type Align = 'left' | 'center' | 'right';

export type Modifier =
  | { kind: 'weight'; amount: number }
  | { kind: 'round'; radius: number }
  | { kind: 'outline'; width: number }
  | { kind: 'ink'; amount: number; scale: number; seed: number }
  | { kind: 'slant'; angle: number }
  | { kind: 'stretch'; x: number; y: number }
  | { kind: 'wave'; amplitude: number; wavelength: number; phase: number }
  | { kind: 'arc'; bend: number }
  | { kind: 'wobble'; amount: number; scale: number; seed: number }
  | { kind: 'melt'; amount: number; scale: number; seed: number }
  | { kind: 'pixelate'; size: number }
  | { kind: 'perspective'; amount: number };

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
  | { kind: 'catHead'; ears: number };

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
  | { type: 'morph'; a: string; b: string; t: number };

export interface Layer {
  id: string;
  name?: string;
  visible: boolean;
  op: Op;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  modifiers: ModEntry[];
  content: Content;
}

export interface EngineDocument {
  layers: Layer[];
  quality?: number;
}

export interface LayerOut {
  id: string;
  bbox: [number, number, number, number] | null;
  error: string | null;
}

export interface BuildOut {
  d: string;
  bbox: [number, number, number, number] | null;
  layers: LayerOut[];
  points: number;
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
}

export interface TraceOptions {
  threshold: number | null;
  invert: boolean;
  smooth: number;
  despeckle: number;
  pixel: boolean;
  maxSize?: number;
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
}

export interface SvgOptions {
  fill?: string;
  background?: string;
  padding?: number;
}
