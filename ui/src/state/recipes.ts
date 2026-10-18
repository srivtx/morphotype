// One-click looks: modifier recipes for shapes and type, and backgrounds.
import type { Modifier } from '../engine/types';
import { background, fill, tile, type Background } from './model';

export interface Recipe {
  name: string;
  mods: Modifier[];
  tags?: string;
}

export const SHAPE_RECIPES: Recipe[] = [
  { name: 'Bitmap', mods: [{ kind: 'pixelate', size: 0.07, shape: 'square', gap: 0 }], tags: 'pixel 8-bit retro' },
  { name: 'Dot matrix', mods: [{ kind: 'pixelate', size: 0.065, shape: 'dot', gap: 0.06 }], tags: 'led pixel dots' },
  { name: 'Soft pixel', mods: [{ kind: 'pixelate', size: 0.09, shape: 'square', gap: 0 }, { kind: 'round', radius: 0.025 }], tags: 'rounded pixel blocks' },
  { name: 'Tiles', mods: [{ kind: 'pixelate', size: 0.075, shape: 'rounded', gap: 0.14 }], tags: 'mosaic pixel' },
  { name: 'Rounded', mods: [{ kind: 'round', radius: 0.04 }], tags: 'soft friendly' },
  { name: 'Heavy', mods: [{ kind: 'weight', amount: 0.035 }], tags: 'bold' },
  { name: 'Inline', mods: [{ kind: 'outline', width: 0.03 }], tags: 'outline hollow' },
  { name: 'Melting', mods: [{ kind: 'melt', amount: 0.35, scale: 0.3, seed: 4 }], tags: 'drip liquid' },
  { name: 'Ink stamp', mods: [{ kind: 'ink', amount: 0.015, scale: 0.4, seed: 3 }], tags: 'grunge rough' },
  { name: 'Wobbly', mods: [{ kind: 'wobble', amount: 0.03, scale: 0.5, seed: 2 }], tags: 'hand drawn' },
  { name: 'Arch', mods: [{ kind: 'warp', style: 'arch', bend: 0.5, points: [] }], tags: 'warp bend' },
  { name: 'Flag', mods: [{ kind: 'warp', style: 'flag', bend: 0.5, points: [] }], tags: 'warp wave' },
  { name: 'Bulge', mods: [{ kind: 'warp', style: 'bulge', bend: 0.45, points: [] }], tags: 'warp inflate' },
  { name: 'Wavy', mods: [{ kind: 'wave', amplitude: 0.06, wavelength: 1.6, phase: 0 }], tags: 'wave' },
  { name: 'Italic', mods: [{ kind: 'slant', angle: 12 }], tags: 'slant oblique' },
  { name: 'Condensed', mods: [{ kind: 'stretch', x: 0.72, y: 1 }], tags: 'narrow' },
  { name: 'Wide', mods: [{ kind: 'stretch', x: 1.35, y: 1 }], tags: 'extended' },
  { name: 'Circle', mods: [{ kind: 'arc', bend: 0.6 }], tags: 'arc badge' },
];

export interface BgPreset {
  name: string;
  bg: Background;
}

const lin = (a: string, b: string, angle = 180) => ({ ...fill('linear', a, b), angle });

export const BG_PRESETS: BgPreset[] = [
  { name: 'Midnight', bg: background(fill('solid', '#0b0b0d')) },
  { name: 'Black', bg: background(fill('solid', '#000000')) },
  { name: 'Paper', bg: background(fill('solid', '#f2ede4'), { grain: 0.25 }) },
  { name: 'Concrete', bg: background(fill('solid', '#2b2b2e'), { grain: 0.35 }) },
  { name: 'Electric violet', bg: background(fill('solid', '#7b4dff')) },
  { name: 'Lime', bg: background(fill('solid', '#b4f22e')) },
  { name: 'Tangerine', bg: background(fill('solid', '#ff7a2f')) },
  { name: 'Sky', bg: background(lin('#7ccfff', '#2b8bff')) },
  { name: 'Blue backdrop', bg: background(lin('#2b8bff', '#1a3fe0')) },
  { name: 'Bubblegum', bg: background(lin('#ff9fd2', '#ff4fa3')) },
  { name: 'Dusk grain', bg: background(lin('#33468f', '#b7b4aa'), { grain: 0.55 }) },
  { name: 'Sunset aura', bg: background({ ...fill('aura', '#ff3d00', '#1a0000', '#ff9a3d', '#ffd2b0'), angle: 40 }) },
  { name: 'Acid aura', bg: background({ ...fill('aura', '#d6ff1f', '#5a1fff', '#b9ff3d', '#f6ffd0'), angle: 200 }) },
  { name: 'Ocean aura', bg: background({ ...fill('aura', '#1424ff', '#000028', '#4fb4ff', '#c7e4ff'), angle: 90 }) },
  { name: 'Rose aura', bg: background({ ...fill('aura', '#ff4fb1', '#1d0030', '#ffffff', '#ffd0f0'), angle: 300 }) },
  { name: 'Lilac tile', bg: background(fill('solid', '#000000'), { tile: tile(lin('#c9b8ff', '#8a63f5')) }) },
  { name: 'Sunset tile', bg: background(fill('solid', '#000000'), { tile: tile(lin('#ff8a1f', '#ff4d00')) }) },
  { name: 'Candy tile', bg: background(fill('solid', '#000000'), { tile: tile(lin('#ff77c8', '#ff2f6d')) }) },
  { name: 'Sky tile', bg: background(fill('solid', '#000000'), { tile: tile(fill('solid', '#62c4ff'), { gloss: 0.15 }) }) },
  { name: 'Lime tile', bg: background(fill('solid', '#000000'), { tile: tile(fill('solid', '#b2f12a'), { gloss: 0.15 }) }) },
  { name: 'Ink tile', bg: background(fill('solid', '#000000'), { tile: tile(lin('#1e1e22', '#050506'), { rim: 10, holo: true, gloss: 0.2 }) }) },
  { name: 'White tile', bg: background(fill('solid', '#000000'), { tile: tile(lin('#ffffff', '#e9e9ee'), { gloss: 0.1 }) }) },
  { name: 'Aura tile', bg: background(fill('solid', '#1b1b1d'), { tile: tile({ ...fill('aura', '#ff4fb1', '#1d0030', '#ffffff', '#ffd0f0'), angle: 300 }, { rim: 6, rimColor: '#ffd0f0', gloss: 0 }) }) },
];
