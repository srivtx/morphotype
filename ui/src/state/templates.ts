// Starting points. Each one is a small, fully editable document.
import { background, fill, group, mods, style, symbolLayer, textLayer, tile, type Background, type Node, type Project } from './model';

export interface Template {
  name: string;
  hint: string;
  category: 'Logo' | 'Icon' | 'Type' | 'Social';
  make: () => Project;
}

function project(name: string, layers: Node[], bg: Background, canvas = { width: 1200, height: 1200 }): Project {
  return { version: 2, name, canvas, layers, background: bg, fonts: [] };
}

const solid = (c: string, extra: Partial<Background> = {}) => background(fill('solid', c), extra);
const lin = (a: string, b: string, angle = 180) => ({ ...fill('linear', a, b), angle });

const ICE = style('chrome', { bevel: 70, softness: 16 });
const PLASMA = style('chrome', { c1: '#16002b', c2: '#5a17d6', c3: '#ff2e9a', c4: '#ffd36b', rimColor: '#ff7ad1', bevel: 26 });
const MOLTEN = style('chrome', { c1: '#071722', c2: '#00a99d', c3: '#ff6a00', c4: '#ffe7c2', rimColor: '#ff9a3c', liquid: 1, bevel: 24 });
const TOXIC = style('chrome', { c1: '#061204', c2: '#2f6b0b', c3: '#c8ff3a', c4: '#ffb300', rimColor: '#d8ff7a' });
const STICKER = style('sticker', { lineWidth: 16, shadow: 0.15 });
const INK = (c = '#0a0a0a') => style('flat', { fill: c });

export const TEMPLATES: Template[] = [
  {
    name: 'Chrome cursor',
    hint: 'Pin with a punched-out cursor in ice chrome',
    category: 'Logo',
    make: () => project('Chrome cursor', [symbolLayer('pin', 560, { style: ICE }), symbolLayer('cursor', 300, { op: 'subtract', x: -10 })], solid('#000000')),
  },
  {
    name: 'Sun badge',
    hint: 'Badge with a letter fused in plasma chrome',
    category: 'Logo',
    make: () =>
      project('Sun badge', [group([symbolLayer('burst', 640, { rotation: 15 }), textLayer('G', 'archivo', {}, { size: 190 })], { merge: true, name: 'Badge', style: PLASMA })], solid('#000000')),
  },
  {
    name: 'Pixel runner',
    hint: 'Pixelated word in molten chrome',
    category: 'Logo',
    make: () => project('Pixel runner', [textLayer('RUN', 'archivo', { style: MOLTEN, modifiers: mods({ kind: 'pixelate', size: 0.09, shape: 'square', gap: 0 }) })], solid('#000000')),
  },
  {
    name: 'Puffy mascot',
    hint: 'Cloud body with punched eyes, inflated',
    category: 'Icon',
    make: () => project('Puffy mascot', [symbolLayer('blob', 760, { style: style('inflate') }), symbolLayer('eyes', 420, { op: 'subtract', y: -20 })], background(lin('#2b8bff', '#1a3fe0'))),
  },
  {
    name: 'Chat mascot',
    hint: 'Sticker-style bubble with eyes on a sky tile',
    category: 'Icon',
    make: () =>
      project(
        'Chat mascot',
        [
          group(
            [
              symbolLayer('bubble', 560, { style: STICKER, y: 10 }),
              symbolLayer('eyes', 300, { x: 60, y: -40, style: INK() }, { gap: 0.42, width: 0.17, height: 0.2 }),
            ],
            { name: 'Mascot' },
          ),
        ],
        solid('#000000', { tile: tile(fill('solid', '#62c4ff'), { gloss: 0.12, shadow: 0.25 }) }),
        { width: 1024, height: 1024 },
      ),
  },
  {
    name: 'Spiral app',
    hint: 'Bubble with a spiral on a tangerine tile',
    category: 'Icon',
    make: () =>
      project(
        'Spiral app',
        [symbolLayer('bubble', 560, { style: style('sticker', { lineWidth: 14 }), y: 10 }), symbolLayer('spiral', 330, { style: INK(), y: -14, rotation: -40 }, { turns: 2.2, weight: 0.6 })],
        solid('#000000', { tile: tile(fill('solid', '#ff7a2f'), { gloss: 0.12 }) }),
        { width: 1024, height: 1024 },
      ),
  },
  {
    name: 'Night blob',
    hint: 'Ink mascot with a mint outline on an aqua tile',
    category: 'Icon',
    make: () =>
      project(
        'Night blob',
        [
          symbolLayer('blob', 520, { rotation: 12, style: style('sticker', { fill: '#0a0a0a', line: '#73f0f2', lineWidth: 12, border: '#0a0a0a', borderWidth: 10, shine: 0.05, shadow: 0 }) }, { lobes: 5, depth: 0.12, wobble: 0.4, seed: 3 }),
          symbolLayer('eyes', 200, { x: 30, y: -10, style: INK('#ffffff') }, { gap: 0.6, width: 0.22, height: 0.26 }),
        ],
        solid('#000000', { tile: tile(fill('solid', '#a3f6ff'), { gloss: 0.1 }) }),
        { width: 1024, height: 1024 },
      ),
  },
  {
    name: 'App icon',
    hint: 'Cat mascot on a lilac squircle tile',
    category: 'Icon',
    make: () =>
      project(
        'App icon',
        [symbolLayer('catHead', 600, { y: 40, style: style('icon') }), symbolLayer('eyes', 300, { op: 'subtract', y: 70 })],
        solid('#000000', { tile: tile(lin('#c9b8ff', '#8a63f5')) }),
        { width: 1024, height: 1024 },
      ),
  },
  {
    name: 'Holo J',
    hint: 'Iridescent script letter on a dark tile with a holo rim',
    category: 'Icon',
    make: () =>
      project(
        'Holo J',
        [textLayer('J', 'pacifico', { y: -30, style: style('holo', { bevel: 34 }) }, { size: 560 })],
        solid('#000000', { tile: tile(lin('#1e1e22', '#050506'), { rim: 12, holo: true, gloss: 0.15 }) }),
        { width: 1024, height: 1024 },
      ),
  },
  {
    name: 'Aura tiles',
    hint: 'Mesh-gradient squircles with glowing edges',
    category: 'Icon',
    make: () => {
      const auras = [
        { c1: '#ff3d00', c2: '#1a0000', c3: '#ff9a3d', c4: '#ffd2b0', seed: 3 },
        { c1: '#d6ff1f', c2: '#5a1fff', c3: '#b9ff3d', c4: '#f6ffd0', seed: 7.4 },
        { c1: '#1424ff', c2: '#000028', c3: '#4fb4ff', c4: '#c7e4ff', seed: 1.2 },
        { c1: '#ff4fb1', c2: '#1d0030', c3: '#ffffff', c4: '#ffd0f0', seed: 12.6 },
      ];
      return project(
        'Aura tiles',
        auras.map((a, i) => symbolLayer('squircle', 440, { name: `Tile ${i + 1}`, x: (i % 2 ? 1 : -1) * 260, y: (i < 2 ? -1 : 1) * 260, style: style('aura', a) }, { exponent: 4.2 })),
        solid('#161616'),
      );
    },
  },
  {
    name: 'Glow glass',
    hint: 'Frosted glass type with a floor reflection',
    category: 'Type',
    make: () => project('Glow glass', [textLayer('lab', 'unbounded', { y: -60, style: style('glass'), modifiers: mods({ kind: 'round', radius: 0.03 }) })], solid('#000000')),
  },
  {
    name: 'Bitmap poster',
    hint: 'One word in soft pixels, dot matrix and blocks',
    category: 'Type',
    make: () => {
      const white = INK('#ffffff');
      const line = (text: string, y: number, m: Parameters<typeof mods>) =>
        textLayer(text, 'space-grotesk', { y, style: white, modifiers: mods(...m), name: text }, { size: 300, tracking: 0.02 });
      return project(
        'Bitmap poster',
        [
          textLayer('Power Type Foundry', 'space-grotesk', { y: -560, style: white, name: 'Label' }, { size: 34 }),
          textLayer('Bitmap Font', 'silkscreen', { y: -480, style: white, name: 'Title' }, { size: 92 }),
          line('Intra', -250, [{ kind: 'pixelate', size: 0.075, shape: 'square', gap: 0 }, { kind: 'round', radius: 0.018 }]),
          line('Extra', 70, [{ kind: 'pixelate', size: 0.07, shape: 'dot', gap: 0.04 }]),
          line('Outra', 390, [{ kind: 'pixelate', size: 0.085, shape: 'square', gap: 0 }]),
        ],
        solid('#000000'),
        { width: 1080, height: 1350 },
      );
    },
  },
  {
    name: 'Sudo display',
    hint: 'Blocky figures on a grainy dusk gradient',
    category: 'Type',
    make: () =>
      project(
        'Sudo display',
        [
          textLayer('123', 'archivo', { y: -150, style: INK(), modifiers: mods({ kind: 'pixelate', size: 0.075, shape: 'square', gap: 0 }, { kind: 'round', radius: 0.012 }) }, { size: 380, tracking: 0.04 }),
          textLayer('SUDO DISPLAY', 'space-grotesk', { y: 260, style: INK('#f2f0ea'), name: 'Caption' }, { size: 60, tracking: 0.12 }),
        ],
        background(lin('#33468f', '#b7b4aa'), { grain: 0.6 }),
        { width: 1080, height: 1080 },
      ),
  },
  {
    name: 'Pixel F',
    hint: 'One letter in big soft pixels on electric violet',
    category: 'Logo',
    make: () =>
      project('Pixel F', [textLayer('F', 'archivo', { style: INK(), modifiers: mods({ kind: 'pixelate', size: 0.125, shape: 'square', gap: 0 }, { kind: 'round', radius: 0.03 }) }, { size: 760 })], solid('#7b4dff'), {
        width: 1080,
        height: 1080,
      }),
  },
  {
    name: 'Distressed type',
    hint: 'Worn print stack with melted drips',
    category: 'Type',
    make: () =>
      project(
        'Distressed type',
        [
          textLayer(
            'Distressed\ntext\neffect',
            'inter-black',
            { x: -480, style: style('distressed'), modifiers: mods({ kind: 'ink', amount: 0.012, scale: 0.35, seed: 3 }, { kind: 'melt', amount: 0.12, scale: 0.25, seed: 5 }) },
            { size: 190, tracking: -0.04, lineHeight: 0.92, align: 'left' },
          ),
        ],
        solid('#0b0b0b', { grain: 0.3 }),
      ),
  },
  {
    name: 'Neon script',
    hint: 'Script lettering as a neon tube',
    category: 'Type',
    make: () => project('Neon script', [textLayer('Night', 'pacifico', { style: style('neon'), modifiers: mods({ kind: 'slant', angle: 4 }) })], solid('#07030d')),
  },
  {
    name: 'Retro sign',
    hint: 'Arched diner lettering with a solid 3D extrusion',
    category: 'Logo',
    make: () =>
      project('Retro sign', [textLayer('Diner', 'bungee', { style: style('extrude'), modifiers: mods({ kind: 'warp', style: 'arch', bend: 0.35, points: [] }) }, { size: 230 })], solid('#2b1d3a'), {
        width: 1600,
        height: 900,
      }),
  },
  {
    name: 'Font morph',
    hint: 'Halfway between a grotesque and a script',
    category: 'Type',
    make: () => project('Font morph', [textLayer('Morph', 'archivo', { style: TOXIC }, { size: 240, morph: { font: 'pacifico', t: 0.5, axes: {} } })], solid('#000000')),
  },
  {
    name: 'YouTube thumbnail',
    hint: 'Loud headline sticker on an electric gradient',
    category: 'Social',
    make: () =>
      project(
        'Thumbnail',
        [
          symbolLayer('star', 560, { x: 400, y: -40, rotation: 8, style: style('flat', { fill: '#ffd23f' }) }, { points: 18, inner: 0.78, rounding: 0.15 }),
          textLayer('BIG\nNEWS', 'archivo', { x: -140, y: 0, rotation: -4, style: style('sticker', { fill: '#ffffff', line: '#0a0a0a', lineWidth: 14, border: '#ff3d7f', borderWidth: 12, shadow: 0.35 }) }, { size: 210, lineHeight: 0.9 }),
        ],
        background(lin('#7b4dff', '#00e5ff', 120)),
        { width: 1280, height: 720 },
      ),
  },
  {
    name: 'Instagram quote',
    hint: 'Warm gradient type on paper for a square post',
    category: 'Social',
    make: () =>
      project(
        'Instagram quote',
        [
          textLayer('make\nweird\nthings', 'playfair', { style: style('flat', { fill: '#ff6a00', fill2: '#ff3d7f', gradient: 1 }) }, { size: 230, lineHeight: 0.88 }),
          symbolLayer('sparkle', 120, { x: 330, y: -330, style: style('flat', { fill: '#ff3d7f' }) }),
        ],
        solid('#f2ede4', { grain: 0.25 }),
        { width: 1080, height: 1080 },
      ),
  },
];
