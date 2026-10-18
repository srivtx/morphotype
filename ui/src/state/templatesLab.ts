// Templates built from the newest tools: backdrop glass and lenses, Depth,
// thermal and prism light, colour dots, plush, foam, isometric faces,
// cross-stitch pixels, line shapes (globe, asterisk, wavy badge) and the
// app-icon grid. Every one is a normal, editable document.
import { applyIconTarget, iconGridLayers } from './icon';
import { background, depth, fill, group, mods, pathLayer, pattern, strokeLayer, style, symbolLayer, textLayer, tile, type Background, type Node, type Project, type ShapeLayer, type Style } from './model';
import type { Template } from './templates';

const project = (name: string, layers: Node[], bg: Background, canvas = { width: 1200, height: 1200 }): Project => ({ version: 2, name, canvas, layers, background: bg, fonts: [] });
const solid = (c: string, extra: Partial<Background> = {}) => background(fill('solid', c), extra);
const ink = (c: string): Style => style('flat', { fill: c });
const withDepth = (st: Style, amount: number, color: string, angle = 150, shade = 0.3): Style => ({ ...st, depth: { ...depth(amount, color, angle), shade } });
const stroked = (st: Style, width: number, color = '#0a0a0a'): Style => ({ ...st, stroke: { width, color, align: 'outside', opacity: 1 } });

/** Line art drawn with constant-width round strokes (for line icons). */
const line = (pts: [number, number][], width: number, color: string, name: string, x = 0, y = 0) => strokeLayer(pts, width, { x, y, name, style: ink(color) }, { taper: 0, smooth: 0 });
/** Groups have no position of their own: move their layers instead. */
const shifted = (nodes: ShapeLayer[], dx: number, dy: number): ShapeLayer[] => {
  for (const n of nodes) (n.x += dx), (n.y += dy);
  return nodes;
};

export const LAB_TEMPLATES: Template[] = [
  {
    name: 'Glass lens',
    hint: 'A clear glass drop bending and splitting the word behind it',
    category: 'Type',
    make: () =>
      project(
        'Glass lens',
        [
          textLayer('glass.', 'inter-black', { y: 20, name: 'Word', style: ink('#151515') }, { size: 330, tracking: -0.05 }),
          symbolLayer('circle', 560, { x: -110, y: -20, rotation: -24, sx: 1.04, sy: 0.9, name: 'Lens', style: style('lens', { refraction: 0.85, dispersion: 0.9, magnify: 0.22, iridescence: 0.7, rim: 0.9, bevel: 120, softness: 14 }) }),
        ],
        solid('#eeefef'),
        { width: 1320, height: 990 },
      ),
  },
  {
    name: 'Crystal word',
    hint: 'A prism-glass cube over bold white type on black',
    category: 'Logo',
    make: () =>
      project(
        'Crystal word',
        [
          textLayer('mono', 'inter-black', { name: 'Word', style: ink('#f4f4f4') }, { size: 300, tracking: -0.04 }),
          symbolLayer('polygon', 360, { x: -40, y: -10, rotation: 14, name: 'Crystal', style: style('lens', { refraction: 1.1, dispersion: 1.3, iridescence: 1.2, magnify: 0.12, rim: 1, bevel: 40, softness: 4 }) }, { sides: 6, rounding: 0.05 }),
          symbolLayer('polygon', 180, { x: -40, y: -10, rotation: 14, name: 'Facet', style: style('lens', { refraction: 0.8, dispersion: 1.2, iridescence: 0.9, magnify: -0.2, rim: 0.7, bevel: 24, softness: 2 }) }, { sides: 6, rounding: 0.05 }),
        ],
        solid('#000000'),
        { width: 1200, height: 900 },
      ),
  },
  {
    name: 'Frosted 404',
    hint: 'Extruded 3D numbers behind a frosted glass folder',
    category: 'Icon',
    make: () =>
      project(
        'Frosted 404',
        [
          textLayer('404', 'inter-black', { y: -40, rotation: -8, name: '404', style: withDepth(ink('#ffffff'), 64, '#ff5a1f', 165, 0.25) }, { size: 420, tracking: -0.04 }),
          symbolLayer('folder', 600, { y: 110, rotation: 6, name: 'Glass folder', style: style('frost', { tint: '#e6e9ff', tint2: '#3542d6', gradient: 0.9, tintAmount: 0.5, blur: 30, rim: 1, refraction: 0.6, shadow: 0.45 }) }, { tab: 0.32, corner: 0.06 }),
          symbolLayer('plus', 120, { x: 0, y: 270, rotation: 45, name: 'Close', style: ink('#ffffff'), modifiers: mods({ kind: 'round', radius: 0.08 }) }, { thickness: 0.38 }),
          textLayer('error state icons', 'space-grotesk', { x: -330, y: -470, name: 'Caption', style: ink('#c9cbe0') }, { size: 30, tracking: 0.04 }),
          textLayer('404-error', 'space-grotesk', { x: 370, y: -470, name: 'Tag', style: ink('#c9cbe0') }, { size: 30, tracking: 0.04 }),
        ],
        background({ ...fill('radial', '#1d2140', '#0d0e15'), angle: 180 }),
        { width: 1080, height: 1080 },
      ),
  },
  {
    name: 'Thermal wings',
    hint: 'A butterfly in heat-camera colours glowing into red',
    category: 'Social',
    make: () => {
      const wing = (x: number, y: number, size: number, rot: number, aspect: number) => symbolLayer('lens', size, { x, y, rotation: rot, name: 'Wing' }, { aspect });
      return project(
        'Thermal wings',
        [
          group(
            [
              wing(-300, -90, 760, -52, 0.6),
              wing(300, -90, 760, 52, 0.6),
              wing(-200, 230, 560, -28, 0.62),
              wing(200, 230, 560, 28, 0.62),
              symbolLayer('pill', 420, { y: 60, rotation: 90, name: 'Body' }, { aspect: 5 }),
            ],
            { name: 'Butterfly', merge: true, style: style('thermal', { spread: 120, glow: 230, glowAmount: 1, noise: 0.45, scale: 1.4, grain: 0.6 }), modifiers: mods({ kind: 'round', radius: 0.02 }) },
          ),
          textLayer('Morphosis', 'inter-black', { y: 10, name: 'Title', style: ink('#ffffff') }, { size: 110, tracking: -0.03 }),
        ],
        solid('#e8133c', { grain: 0.4 }),
        { width: 1600, height: 900 },
      );
    },
  },
  {
    name: 'Prism grid',
    hint: 'Slits of light throwing spectral streaks out from the centre',
    category: 'Social',
    make: () =>
      project(
        'Prism grid',
        [
          symbolLayer('roundRect', 200, {
            name: 'Slits',
            style: { ...style('prism', { length: 0.8, intensity: 0.75, spread: 1, core: 0.4 }), blend: 'screen' },
            modifiers: mods({ kind: 'slant', angle: 10 }, { kind: 'repeat', mode: 'grid', count: 1, radius: 0, sweep: 360, orient: 0, cols: 8, rows: 6, gapX: 0.2, gapY: 0.36, dx: 0, dy: 0, grow: 1, spin: 0 }),
          }, { radius: 0, aspect: 0.24 }),
        ],
        solid('#000000'),
        { width: 900, height: 1600 },
      ),
  },
  {
    name: 'Heat dots',
    hint: 'A circle of colour printed as an LED dot screen',
    category: 'Social',
    make: () => project('Heat dots', [symbolLayer('circle', 760, { name: 'Disc', style: style('colordots', { cell: 12 }) })], solid('#000000'), { width: 900, height: 1600 }),
  },
  {
    name: 'Foam letter',
    hint: 'One big letter eaten through by acid-green bubbles',
    category: 'Type',
    make: () =>
      project(
        'Foam letter',
        [
          textLayer('M', 'archivo', {
            name: 'Letter',
            style: style('inflate', { body: '#b8ff2e', shade: '#3c9a00', bevel: 7, softness: 2, shadow: 0 }),
            modifiers: mods({ kind: 'wobble', amount: 0.012, scale: 0.35, seed: 4 }, { kind: 'foam', amount: 1, size: 0.14, wall: 0.007, spread: 0.55, angle: 135, seed: 7 }),
          }, { size: 1000 }),
        ],
        solid('#000000'),
      ),
  },
  {
    name: 'Cross-stitch wall',
    hint: 'Cross-stitch type on a two-colour wall dissolving in diamonds',
    category: 'Print',
    make: () =>
      project(
        'Cross-stitch wall',
        [
          symbolLayer('roundRect', 1000, { x: 420, name: 'Olive half', style: ink('#4b4a14'), modifiers: mods({ kind: 'pixelate', size: 0.032, shape: 'diamond', gap: 0, dissolve: 0.5, angle: 270, seed: 5 }) }, { radius: 0, aspect: 0.95 }),
          textLayer('LOBE', 'young-serif', { name: 'Word', style: ink('#f4efc6'), modifiers: mods({ kind: 'weight', amount: 0.02 }, { kind: 'pixelate', size: 0.058, shape: 'cross', gap: 0, dissolve: 0, angle: 180, seed: 1 }) }, { size: 470, tracking: 0.08 }),
        ],
        solid('#ff4a17'),
        { width: 1600, height: 900 },
      ),
  },
  {
    name: 'Badge set',
    hint: 'Twelve sticker badges from circles, wavy edges, globes and asterisks',
    category: 'Icon',
    make: () => {
      const P = '#ff6fe0';
      const L = '#e6ff3a';
      const V = '#5b3cff';
      const D = '#2a2a2a';
      const C = '#f6f0e6';
      const xs = [-450, -150, 150, 450];
      const ys = [-380, 0, 380];
      const at = (i: number) => ({ x: xs[i % 4], y: ys[Math.floor(i / 4)] });
      const badge = (i: number, base: Node, mark: Node) => group([base, mark], { name: `Badge ${i + 1}`, open: false });
      const disc = (i: number, c: string) => symbolLayer('circle', 250, { ...at(i), name: 'Disc', style: ink(c) });
      const wavy = (i: number, c: string, scallop = 0, waves = 20) => symbolLayer('wavy', 260, { ...at(i), name: 'Wavy badge', style: ink(c) }, { waves, depth: 0.16, scallop });
      // `extra.x/y` nudge from the badge's centre.
      const m = (i: number, kind: Parameters<typeof symbolLayer>[0], size: number, c: string, params: object = {}, extra: Partial<ShapeLayer> = {}) => {
        const p = at(i);
        return symbolLayer(kind, size, { name: 'Mark', style: ink(c), ...extra, x: p.x + (extra.x ?? 0), y: p.y + (extra.y ?? 0) }, params);
      };
      return project(
        'Badge set',
        [
          badge(0, disc(0, P), m(0, 'flower', 140, C, { petals: 4, depth: 0.62 }, { rotation: 45 })),
          badge(1, wavy(1, L, 0, 18), group([m(1, 'smile', 90, D, { curve: 0.6, weight: 0.25 }, { y: 20 }), m(1, 'eyes', 90, D, { gap: 0.5, width: 0.16, height: 0.3 }, { y: -30 })], { name: 'Face' })),
          badge(2, disc(2, V), m(2, 'star', 170, C, { points: 8, inner: 0.3, rounding: 0 })),
          badge(3, disc(3, D), m(3, 'globe', 175, L, { meridians: 2, parallels: 2, weight: 0.03 })),
          badge(4, m(4, 'roundRect', 220, V, { radius: 0.2, aspect: 1 }, { rotation: 45, name: 'Diamond' }), m(4, 'circle', 70, C, {}, { modifiers: mods({ kind: 'repeat', mode: 'radial', count: 3, radius: 0.6, sweep: 360, orient: 0, cols: 1, rows: 1, gapX: 0, gapY: 0, dx: 0, dy: 0, grow: 1, spin: 0 }) })),
          badge(5, disc(5, D), m(5, 'asterisk', 160, C, { arms: 8, weight: 0.09, inner: 0 })),
          badge(6, wavy(6, P, 1, 14), m(6, 'globe', 180, C, { meridians: 3, parallels: 2, weight: 0.03, aspect: 1.7 })),
          badge(7, disc(7, L), m(7, 'asterisk', 185, D, { arms: 24, weight: 0.014, inner: 0.12 })),
          badge(8, disc(8, P), m(8, 'rays', 190, D, { rays: 10, short: 0.9, inner: 0.22 })),
          badge(9, disc(9, L), m(9, 'star', 175, P, { points: 8, inner: 0.22, rounding: 0 })),
          badge(10, disc(10, D), m(10, 'ring', 160, C, { thickness: 0.035 }, { sy: 0.32, modifiers: mods({ kind: 'repeat', mode: 'trail', count: 3, radius: 0, sweep: 360, orient: 0, cols: 1, rows: 1, gapX: 0, gapY: 0, dx: 0, dy: 0.42, grow: 1, spin: 0 }) })),
          badge(11, wavy(11, V, 0, 22), m(11, 'quarter', 62, C, {}, { modifiers: mods({ kind: 'repeat', mode: 'radial', count: 4, radius: 0.36, sweep: 360, orient: 1, cols: 1, rows: 1, gapX: 0, gapY: 0, dx: 0, dy: 0, grow: 1, spin: 0 }) })),
          textLayer('BADGE SET · MORPHOTYPE', 'space-grotesk', { y: 560, name: 'Credit', style: ink(C) }, { size: 22, tracking: 0.12 }),
        ],
        solid('#0e0e0e', { grain: 0.5 }),
      );
    },
  },
  {
    name: 'Pixel office',
    hint: 'A serif headline over pixel blobs, sparkles and an eye',
    category: 'Social',
    make: () => {
      const px = (size: number) => mods({ kind: 'pixelate', size, shape: 'square', gap: 0, dissolve: 0, angle: 180, seed: 1 });
      const cream = ink('#f6f0d8');
      return project(
        'Pixel office',
        [
          symbolLayer('blob', 760, { x: 30, y: -60, name: 'Pink blob', style: ink('#e66ef0'), modifiers: px(0.03) }, { lobes: 5, depth: 0.16, seed: 3, wobble: 0.6 }),
          symbolLayer('blob', 430, { x: -60, y: -40, name: 'Violet blob', style: ink('#8d7bff'), modifiers: px(0.05) }, { lobes: 4, depth: 0.2, seed: 8, wobble: 0.4 }),
          symbolLayer('pill', 560, { x: -70, y: 330, rotation: 80, name: 'Green worm', style: ink('#2fc94a'), modifiers: px(0.06) }, { aspect: 2.4 }),
          group(
            [line([[0, 0], [60, 40], [20, 90], [90, 150]], 26, '#ffb21f', 'Zigzag', 120, -330), line([[0, 0], [50, 60], [10, 120], [70, 170]], 26, '#ffb21f', 'Zigzag', 170, 160)],
            { name: 'Zigzags', merge: true, modifiers: px(0.12), style: ink('#ffb21f') },
          ),
          symbolLayer('sparkle', 170, { x: 320, y: -380, name: 'Sparkle', style: ink('#ffb21f'), modifiers: px(0.1) }, { pinch: 0.55 }),
          symbolLayer('sparkle', 100, { x: 420, y: -270, name: 'Sparkle', style: ink('#ffb21f'), modifiers: px(0.12) }, { pinch: 0.55 }),
          symbolLayer('sparkle', 150, { x: -420, y: -160, sy: 1.5, name: 'Sparkle', style: ink('#1aa6e8'), modifiers: px(0.1) }, { pinch: 0.6 }),
          symbolLayer('sparkle', 130, { x: 410, y: 340, sy: 1.5, name: 'Sparkle', style: ink('#1aa6e8'), modifiers: px(0.1) }, { pinch: 0.6 }),
          group(
            shifted(
              [
                symbolLayer('lens', 300, { rotation: 90, name: 'White', style: ink('#f6f0d8'), modifiers: px(0.06) }, { aspect: 0.5 }),
                symbolLayer('circle', 130, { name: 'Iris', style: ink('#ff3d8b'), modifiers: px(0.12) }),
                symbolLayer('circle', 62, { name: 'Pupil', style: ink('#8d7bff'), modifiers: px(0.2) }),
              ],
              40,
              -100,
            ),
            { name: 'Eye' },
          ),
          textLayer('REMINDER', 'space-grotesk', { y: -330, name: 'Kicker', style: cream }, { size: 62, tracking: 0.02 }),
          textLayer('out   of', 'young-serif', { y: -110, name: 'Line 1', style: cream }, { size: 240, tracking: -0.03 }),
          textLayer('office', 'young-serif', { y: 140, name: 'Line 2', style: cream }, { size: 260, tracking: -0.03 }),
          textLayer('I APPRECIATE YOUR UNDERSTANDING AND\nCOOPERATION DURING THIS TIME. I WILL MAKE SURE TO\nADDRESS YOUR EMAIL PROMPTLY UPON MY RETURN.', 'space-grotesk', { y: 330, name: 'Note', style: cream }, { size: 24, lineHeight: 1.15, tracking: -0.02 }),
          textLayer('WE ARE BACK ON APRIL 25, 2026', 'space-grotesk', { y: 470, name: 'Date', style: cream }, { size: 36, tracking: -0.02 }),
        ],
        solid('#111111'),
        { width: 1080, height: 1080 },
      );
    },
  },
  {
    name: 'Plush box',
    hint: 'A fuzzy pink mascot in a doodle-printed green box',
    category: 'Print',
    make: () =>
      project(
        'Plush box',
        [
          textLayer('ORLION\nSTUDIO', 'archivo', { y: -430, name: 'Wordmark', style: ink('#ffffff') }, { size: 130, lineHeight: 0.95, tracking: 0.01 }),
          symbolLayer('roundRect', 820, { y: 240, name: 'Window', style: style('flat', { fill: '#2c9a27', shadowOpacity: 0.35, shadowX: 0, shadowY: -10, shadowBlur: 30, shadowColor: '#0a3d08' }) }, { radius: 0.07, aspect: 1.3 }),
          symbolLayer('blob', 640, { y: 300, sy: 0.74, name: 'Plush', style: style('plush', {}) }, { lobes: 9, depth: 0.12, seed: 5, wobble: 0.3 }),
          symbolLayer('sparkle', 120, { x: -190, y: 230, name: 'Sparkle', style: ink('#ffffff') }, { pinch: 0.55 }),
          group(
            [
              symbolLayer('pill', 130, { x: 30, y: 400, name: 'Eye', style: ink('#ffffff') }, { aspect: 2.2 }),
              symbolLayer('pill', 130, { x: 190, y: 400, name: 'Eye', style: ink('#ffffff') }, { aspect: 2.2 }),
              symbolLayer('circle', 60, { x: 66, y: 400, name: 'Pupil', style: ink('#0a0a0a') }),
              symbolLayer('circle', 60, { x: 226, y: 400, name: 'Pupil', style: ink('#0a0a0a') }),
            ],
            { name: 'Eyes' },
          ),
        ],
        solid('#3fc23a', { pattern: pattern('doodles', '#86e46a', { size: 130, weight: 8, opacity: 1 }) }),
        { width: 1080, height: 1350 },
      ),
  },
  {
    name: 'Wavy badge icon',
    hint: 'A cream wavy-edged badge with a blue line icon',
    category: 'Icon',
    make: () => {
      const B = '#1f4ed8';
      return project(
        'Wavy badge icon',
        [
          symbolLayer('wavy', 860, { name: 'Badge', style: ink('#f4f1ea') }, { waves: 18, depth: 0.1, scallop: 0.15 }),
          group(
            shifted(
              [
                line([[-60, 150], [-150, 60], [70, -190], [160, -100], [-60, 150]], 30, B, 'Pencil'),
                line([[10, -130], [100, -40]], 30, B, 'Cap'),
                line([[-210, 230], [-120, 180], [-40, 230], [40, 180], [120, 230], [200, 180]], 30, B, 'Squiggle'),
              ],
              0,
              -30,
            ),
            { name: 'Line icon' },
          ),
        ],
        solid(B),
        { width: 1080, height: 1080 },
      );
    },
  },
  {
    name: 'Iso bunny',
    hint: 'An isometric cube mascot with ears, outlined in black',
    category: 'Logo',
    make: () => {
      const face = (f: 'top' | 'left' | 'right', x: number, y: number) => symbolLayer('roundRect', 340, { x, y, name: `${f[0].toUpperCase()}${f.slice(1)} face`, modifiers: mods({ kind: 'isometric', face: f }) }, { radius: 0.16, aspect: 1 });
      const white = stroked(ink('#ffffff'), 16);
      return project(
        'Iso bunny',
        [
          symbolLayer('pill', 380, { x: -150, y: -350, rotation: 64, name: 'Ear', style: white, modifiers: mods({ kind: 'isometric', face: 'left' }) }, { aspect: 2.8 }),
          symbolLayer('pill', 380, { x: 110, y: -330, rotation: 90, name: 'Ear', style: white, modifiers: mods({ kind: 'isometric', face: 'right' }) }, { aspect: 2.8 }),
          group([face('top', 0, -170), face('left', -147, 85), face('right', 147, 85)], { name: 'Head', merge: true, style: white, modifiers: mods({ kind: 'round', radius: 0.02 }) }),
          symbolLayer('smile', 150, { x: -40, y: 110, name: 'Smile', style: ink('#0a0a0a'), modifiers: mods({ kind: 'isometric', face: 'left' }) }, { curve: -0.5, weight: 0.18 }),
          symbolLayer('plus', 90, { x: -210, y: 90, name: 'Wink', style: ink('#0a0a0a'), modifiers: mods({ kind: 'isometric', face: 'left' }) }, { thickness: 0.2 }),
        ],
        solid('#111111'),
        { width: 1080, height: 1080 },
      );
    },
  },
  {
    name: 'Flame icon',
    hint: 'A flame mascot on the app-icon grid, ready to present',
    category: 'Icon',
    make: () => {
      const grid = iconGridLayers(1080, '#7a7a7a', 3.5);
      const flame = 'M-0.4 0.1C-0.42 -0.1 -0.38 -0.22 -0.32 -0.3L-0.21 -0.19C-0.18 -0.34 -0.12 -0.44 -0.05 -0.5L0.04 -0.31C0.08 -0.38 0.12 -0.42 0.17 -0.44C0.34 -0.3 0.44 -0.1 0.42 0.08C0.4 0.3 0.2 0.44 0 0.44C-0.24 0.44 -0.4 0.32 -0.4 0.1Z';
      return project(
        'Flame icon',
        [
          group(grid, { name: 'Icon grid', locked: true, open: false }),
          group(
            [
              pathLayer(flame, 620, 'Flame', { x: 10, y: 0, style: ink('#ffffff'), modifiers: mods({ kind: 'round', radius: 0.02 }) }),
              symbolLayer('circle', 170, { x: -10, y: 60, sx: 0.6, rotation: -6, op: 'subtract', name: 'Eye' }),
              symbolLayer('circle', 150, { x: 140, y: 40, sx: 0.58, rotation: -4, op: 'subtract', name: 'Eye' }),
            ],
            { name: 'Mascot', merge: true, style: ink('#ffffff') },
          ),
        ],
        solid('#000000'),
        { width: 1080, height: 1080 },
      );
    },
  },
  {
    name: 'Weather icon',
    hint: 'A sunny app icon: a smiling sun peeking over a cloud',
    category: 'Icon',
    make: () => {
      const bg = solid('#000000', { tile: tile(fill('solid', '#0a5cff')) });
      applyIconTarget(bg, 'macos');
      const s = 1080 * (824 / 1024);
      return project(
        'Weather icon',
        [
          group(
            [
              symbolLayer('circle', 300, { x: -150, y: 100, name: 'Sun', style: ink('#ffc21a') }),
              symbolLayer('pill', 70, { x: -190, y: 60, name: 'Eye', style: ink('#0a0a0a') }, { aspect: 0.42 }),
              symbolLayer('pill', 70, { x: -120, y: 60, name: 'Eye', style: ink('#0a0a0a') }, { aspect: 0.42 }),
              symbolLayer('cloud', 640, { x: -60, y: 300, name: 'Cloud', style: ink('#ffffff') }, { puffs: 3, seed: 2 }),
              symbolLayer('squircle', s, { op: 'intersect', name: 'Tile mask' }, { exponent: 5, aspect: 1 }),
            ],
            { name: 'Icon art' },
          ),
        ],
        bg,
        { width: 1080, height: 1080 },
      );
    },
  },
];
