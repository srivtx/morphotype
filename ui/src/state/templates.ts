// Starting points. Each one is a small, fully editable document.
import { background, fill, group, mods, style, symbolLayer, textLayer, tile, type Background, type Node, type Project, type ShapeLayer } from './model';

export interface Template {
  name: string;
  hint: string;
  category: 'Logo' | 'Icon' | 'Type' | 'Social' | 'Print';
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
  {
    name: 'Critter icons',
    hint: 'Five mascot app icons on a pastel sky',
    category: 'Icon',
    make: () => {
      const black = INK('#0a0a0a');
      const critter = (i: number, x: number, tileColor: string, body: ShapeLayer, eyeY = -6) => {
        body.x = x;
        return group(
          [
            symbolLayer('roundRect', 240, { x, name: 'Tile', style: style('flat', { fill: tileColor }) }, { radius: 0.11, aspect: 1 }),
            body,
            symbolLayer('eyes', 64, { x, y: eyeY, style: INK('#ffffff'), name: 'Eyes' }, { gap: 0.5, width: 0.2, height: 0.34 }),
          ],
          { name: `Critter ${i + 1}` },
        );
      };
      return project(
        'Critter icons',
        [
          critter(0, -560, '#f2252c', symbolLayer('sparkle', 170, { style: black }, { pinch: 0.42 })),
          critter(1, -280, '#ffe95c', symbolLayer('rays', 160, { style: black }, { rays: 13, short: 0.82, inner: 0.36, jitter: 0.5, seed: 4 })),
          critter(2, 0, '#2bd065', symbolLayer('polygon', 170, { rotation: 45, style: black, modifiers: mods({ kind: 'pixelate', size: 0.12, shape: 'square', gap: 0 }) }, { sides: 4, rounding: 0 })),
          critter(3, 280, '#3388f5', symbolLayer('roundRect', 180, { style: black, modifiers: mods({ kind: 'pixelate', size: 0.075, shape: 'square', gap: 0 }) }, { radius: 0.22, aspect: 2.2 })),
          critter(4, 560, '#b360fa', symbolLayer('polygon', 180, { rotation: 180, y: 8, style: black }, { sides: 3, rounding: 0.18 }), -14),
        ],
        background({ ...fill('linear', '#9fd4fb', '#fbe1d0', '#f9a8cf'), angle: 180 }, { grain: 0.15 }),
        { width: 1600, height: 900 },
      );
    },
  },
  {
    name: 'Mascot card',
    hint: 'Business card with a smiling wordmark and a blind emboss',
    category: 'Print',
    make: () => {
      const cream = style('flat', { fill: '#f4ead8', texture: 0.6 });
      const red = INK('#e8442e');
      const face = (x: number) =>
        group(
          [
            symbolLayer('squircle', 196, { x, y: 60, style: cream, name: 'O' }, { exponent: 4.5, aspect: 1.08 }),
            symbolLayer('eyes', 120, { x, y: 40, style: red, name: 'Eyes' }, { gap: 0.82, width: 0.11, height: 0.11 }),
            symbolLayer('smile', 64, { x, y: 74, style: red, name: 'Smile' }, { curve: 0.55, weight: 0.3 }),
          ],
          { name: 'Face' },
        );
      return project(
        'Mascot card',
        [
          group([symbolLayer('ring', 150, { x: -380, y: -170, style: style('emboss') }, { thickness: 0.16 }), symbolLayer('ring', 66, { x: -380, y: -170, style: style('emboss') }, { thickness: 0.3 })], { name: 'Emboss' }),
          textLayer('M', 'dela-gothic', { x: -320, y: 60, style: cream }, { size: 250 }),
          face(-110),
          textLayer('J', 'dela-gothic', { x: 100, y: 60, style: cream }, { size: 250 }),
          face(300),
          textLayer('hola@mojo.studio', 'playfair', { y: -220, x: 250, style: INK('#f4ead8'), name: 'Email' }, { size: 26, tracking: 0.04 }),
        ],
        solid('#e8442e', { grain: 0.3 }),
        { width: 1050, height: 600 },
      );
    },
  },
  {
    name: 'Pixel ID card',
    hint: 'Pixel wordmark over a lime starburst on cream',
    category: 'Print',
    make: () =>
      project(
        'Pixel ID card',
        [
          symbolLayer('rays', 560, { x: 120, rotation: 8, style: INK('#b8f59a'), name: 'Burst' }, { rays: 11, short: 0.55, inner: 0.12, jitter: 0.6, seed: 7 }),
          textLayer('NOVA', 'silkscreen', { x: 120, y: 0, style: INK('#5b5b5b') }, { size: 200 }),
          textLayer('NOVA', 'bungee', { x: -330, y: -200, style: style('flat', { fill: '#e8336d', texture: 0.4 }), modifiers: mods({ kind: 'ink', amount: 0.03, scale: 0.4, seed: 5 }), name: 'Label' }, { size: 90 }),
          textLayer('designer', 'space-grotesk', { x: 330, y: -220, style: INK('#1a1a1a'), name: 'Role' }, { size: 44 }),
          textLayer('logos · posters · identity', 'inter', { x: 120, y: 230, style: INK('#1a1a1a'), name: 'Tags' }, { size: 26 }),
          symbolLayer('sparkle', 60, { x: 430, y: 230, style: INK('#e8336d') }, { pinch: 0.6 }),
        ],
        solid('#f3efe6', { grain: 0.35 }),
        { width: 1011, height: 638 },
      ),
  },
  {
    name: 'Star lockup',
    hint: 'Four-point star mark beside a stacked wordmark',
    category: 'Logo',
    make: () =>
      project(
        'Star lockup',
        [
          symbolLayer('sparkle', 400, { x: -400, style: INK(), name: 'Mark' }, { pinch: 0.45 }),
          symbolLayer('squircle', 46, { x: -400, op: 'subtract', name: 'Window' }, { exponent: 12, aspect: 1 }),
          textLayer('Nova\nDesign\nLab', 'inter-black', { x: -150, y: 20, style: INK(), name: 'Wordmark' }, { size: 120, lineHeight: 0.92, tracking: -0.03, align: 'left' }),
          textLayer('®', 'inter-black', { x: -215, y: -150, style: INK(), name: 'Registered' }, { size: 56 }),
        ],
        solid('#ffffff'),
        { width: 1600, height: 900 },
      ),
  },
  {
    name: 'Badge row',
    hint: 'Letters in rings with a star in the middle',
    category: 'Logo',
    make: () => {
      const letters = ['S', 'T', '', 'U', 'D', 'O'];
      return project(
        'Badge row',
        letters.map((ch, i) => {
          const x = (i - 2.5) * 170;
          return group(
            [
              symbolLayer('ring', 150, { x, style: INK() }, { thickness: 0.08 }),
              ch ? textLayer(ch, 'inter-black', { x, style: INK() }, { size: 80 }) : symbolLayer('sparkle', 90, { x, style: INK() }, { pinch: 0.55 }),
            ],
            { name: ch || 'Star' },
          );
        }),
        solid('#ffffff'),
        { width: 1400, height: 500 },
      );
    },
  },
  {
    name: 'Riso zine',
    hint: 'Overprinted risograph type with halftone dots',
    category: 'Print',
    make: () =>
      project(
        'Riso zine',
        [
          symbolLayer('circle', 640, { y: -120, style: style('halftone', { ink: '#ffd23f', cell: 16, ramp: 1, rampAngle: 200 }), name: 'Sun' }),
          textLayer('ZINE', 'archivo', { y: 240, style: style('riso'), modifiers: mods({ kind: 'ink', amount: 0.01, scale: 0.4, seed: 2 }) }, { size: 300, tracking: -0.02 }),
          textLayer('issue no. 3', 'space-grotesk', { y: -560, style: INK('#2b6bff'), name: 'Issue' }, { size: 40, tracking: 0.1 }),
        ],
        solid('#f4f1ea', { grain: 0.3 }),
        { width: 1080, height: 1350 },
      ),
  },
];
