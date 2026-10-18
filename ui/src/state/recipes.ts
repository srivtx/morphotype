// One-click looks: modifier recipes for shapes and type, and backgrounds.
import type { Modifier } from '../engine/types';
import { background, fill, pattern, tile, type Background } from './model';

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
  { name: 'All the way round', mods: [{ kind: 'arc', bend: 2 }], tags: 'circle text ring badge seal full arc' },
  { name: 'Round badge', mods: [{ kind: 'fitCircle', amount: 1 }], tags: 'fit circle ellipse envelope' },
  { name: 'Fused band', mods: [{ kind: 'weight', amount: 0.02 }, { kind: 'fuse', amount: 0.16 }, { kind: 'fitCircle', amount: 1 }, { kind: 'round', radius: 0.03 }], tags: 'club ring ellipse fuse blob logo' },
  { name: 'Fused', mods: [{ kind: 'fuse', amount: 0.12 }, { kind: 'round', radius: 0.02 }], tags: 'merge solid connected' },
  { name: 'Sun rays', mods: [{ kind: 'slice', count: 10, gap: 0.045, angle: 8, ring: 0.42, hole: 0, jitter: 0.6, seed: 3, soften: 0.04 }], tags: 'slice cut stamp sunburst' },
  { name: 'Wedges', mods: [{ kind: 'slice', count: 8, gap: 0.06, angle: 0, ring: 0, hole: 0.16, jitter: 0, seed: 1, soften: 0 }], tags: 'slice pie cut segments' },
  { name: 'Pixel dissolve', mods: [{ kind: 'pixelate', size: 0.05, shape: 'square', gap: 0.1, dissolve: 0.75, angle: 180, seed: 2 }], tags: 'pixel fade dither scatter' },
  { name: 'Blob dots', mods: [{ kind: 'pixelate', size: 0.1, shape: 'dot', gap: 0.18, dissolve: 0, angle: 180, seed: 1 }, { kind: 'fuse', amount: 0.06 }], tags: 'dot matrix metaball connected liquid pixel' },
  { name: 'Voxels', mods: [{ kind: 'pixelate', size: 0.075, shape: 'square', gap: 0.05, dissolve: 0, angle: 180, seed: 1 }], tags: 'voxel cubes blocks 3d pixel (pair with Retro 3D)' },
  { name: 'Echo', mods: [{ kind: 'echo', count: 4, spacing: 0.05, width: 0.014 }], tags: 'ripple contour rings offset lines poster' },
  {
    name: 'Echo stack',
    mods: [{ kind: 'outline', width: 0.012 }, { kind: 'repeat', mode: 'trail', count: 7, radius: 0, sweep: 360, orient: 0, cols: 1, rows: 1, gapX: 0, gapY: 0, dx: 0.035, dy: -0.025, grow: 1, spin: 0 }],
    tags: 'trail blend steps wireframe stack kinetic outline',
  },
  {
    name: 'Spin trail',
    mods: [{ kind: 'repeat', mode: 'trail', count: 9, radius: 0, sweep: 360, orient: 0, cols: 1, rows: 1, gapX: 0, gapY: 0, dx: 0, dy: 0, grow: 0.9, spin: 8 }, { kind: 'outline', width: 0.01 }],
    tags: 'trail spiral tunnel blend rotate scale',
  },
  { name: 'Rough cut', mods: [{ kind: 'wobble', amount: 0.012, scale: 0.12, seed: 5 }, { kind: 'ink', amount: 0.008, scale: 0.2, seed: 2 }], tags: 'stamp lino hand cut rough edge' },
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
  { name: 'Green grid', bg: background(fill('solid', '#0d7a2c'), { pattern: pattern('grid', '#06451a', { size: 200, weight: 6, opacity: 1 }) }) },
  { name: 'Graph paper', bg: background(fill('solid', '#f4f1ea'), { pattern: pattern('grid', '#2b6bff', { size: 60, weight: 1.5, opacity: 0.25 }) }) },
  { name: 'Dot grid', bg: background(fill('solid', '#f2ede4'), { pattern: pattern('dots', '#0a0a0a', { size: 40, weight: 2.5, opacity: 0.35 }) }) },
  { name: 'Blueprint', bg: background(fill('solid', '#1546d6'), { pattern: pattern('grid', '#ffffff', { size: 80, weight: 1.5, opacity: 0.22 }) }) },
  { name: 'Ruled cream', bg: background(fill('solid', '#f6efe1'), { pattern: pattern('lines', '#d0453a', { size: 56, weight: 1.5, opacity: 0.35 }), grain: 0.2 }) },
  { name: 'Candy stripes', bg: background(fill('solid', '#ffd6e8'), { pattern: pattern('diagonal', '#ff7ab6', { size: 60, weight: 26, opacity: 0.6 }) }) },
  { name: 'Riso green', bg: background(fill('solid', '#22b25a'), { grain: 0.6 }) },
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
