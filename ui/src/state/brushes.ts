// Brushes for the draw tool: a stroke shape (width, taper, smoothing) and the
// material that makes it read as a pen, marker, pencil or highlighter.
import { style, type Style } from './model';

export interface Brush {
  id: string;
  label: string;
  hint: string;
  /** Default width in artboard px. */
  width: number;
  taper: number;
  smooth: number;
  style: (color: string) => Style;
}

export const BRUSHES: Brush[] = [
  { id: 'pen', label: 'Pen', hint: 'Smooth ink line that thins at the ends', width: 6, taper: 0.25, smooth: 0.6, style: (c) => style('flat', { fill: c }) },
  {
    id: 'marker',
    label: 'Marker',
    hint: 'Flat felt-tip with a dry, streaky edge',
    width: 18,
    taper: 0,
    smooth: 0.5,
    style: (c) => style('distressed', { ink: c, roughness: 0.8, speckle: 0.08, grain: 0.25, lines: 0, tooth: 0.25, bleed: 0 }),
  },
  {
    id: 'pencil',
    label: 'Pencil',
    hint: 'Thin, grainy and a bit rough: scribbles and notes',
    width: 3,
    taper: 0.1,
    smooth: 0.25,
    style: (c) => style('distressed', { ink: c, roughness: 0.6, speckle: 0.3, grain: 0.5, lines: 0, tooth: 0.5, bleed: 0 }),
  },
  {
    id: 'highlighter',
    label: 'Highlighter',
    hint: 'Wide, see-through and multiplied over what is below',
    width: 40,
    taper: 0,
    smooth: 0.8,
    style: (c) => ({ ...style('flat', { fill: c }), opacity: 0.55, blend: 'multiply' }),
  },
];

export const brushById = (id: string) => BRUSHES.find((b) => b.id === id) ?? BRUSHES[0];
