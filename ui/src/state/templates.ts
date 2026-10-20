// Starting points. Each one is a small, fully editable document.
import { effectById } from '../render/effects';
import { brushById } from './brushes';
import { LAB_TEMPLATES } from './templatesLab';
import { STUDIO_TEMPLATES } from './templatesStudio';
import { GRAPHIC_TEMPLATES } from './templatesGraphic';
import { LEARN_TEMPLATES, STARTER_TEMPLATES } from './templatesLearn';
import { SHOWCASE_TEMPLATES } from './templatesShowcase';
import { MOTION_TEMPLATES } from './templatesMotion';
import { background, fill, group, MODIFIER_UI, mods, pattern, strokeLayer, style, symbolLayer, textLayer, tile, type Background, type Node, type Project, type ShapeLayer } from './model';

/**
 * The building blocks a design uses (modifiers, materials, page pattern),
 * shown on template cards so people can see how a look is made.
 */
export function recipeOf(p: Project): string[] {
  const out = new Set<string>();
  const mat = new Set<string>();
  const visit = (n: Node) => {
    for (const m of n.modifiers) if (m.on) out.add(MODIFIER_UI[m.kind]?.label ?? m.kind);
    if (n.op === 'subtract') out.add('Cut');
    if (n.op === 'intersect') out.add('Mask');
    if ((n as { type?: string }).type === 'group') {
      const g = n as Extract<Node, { type: 'group' }>;
      if (g.merge) (out.add('Merge'), mat.add(effectById(g.style.effect).name));
      g.children.forEach(visit);
    } else if (n.op === 'add') mat.add(effectById(n.style.effect).name);
    if (n.style?.stroke) out.add('Stroke');
  };
  p.layers.forEach(visit);
  const pat = p.background.pattern;
  return [...out, ...[...mat].filter((m) => m !== 'Flat' || mat.size === 1), ...(pat ? [`${pat.kind[0].toUpperCase()}${pat.kind.slice(1)} pattern`] : [])];
}

// ---------- hand-drawn helpers (deterministic, so templates look the same every time) ----------

const wob = (k: number, seed: number) => Math.sin(k * 12.9898 + seed * 78.233) * 0.5 + Math.sin(k * 3.1 + seed) * 0.5;
type P = [number, number];
/** A loose flower: one continuous line looping out into petals. */
function flowerLine(petals: number, r: number, seed: number): P[] {
  const out: P[] = [];
  for (let k = 0; k <= 360; k++) {
    const t = (k / 360) * Math.PI * 2;
    const rr = r * Math.abs(Math.cos((petals / 2) * t)) * (0.9 + 0.12 * wob(k / 40, seed));
    out.push([rr * Math.cos(t) + 4 * wob(k / 9, seed + 1), rr * Math.sin(t) + 4 * wob(k / 9, seed + 2)]);
  }
  return out;
}
/** A messy scribble cloud. */
function scribble(w: number, h: number, turns: number, seed: number): P[] {
  const out: P[] = [];
  for (let k = 0; k <= turns * 40; k++) {
    const t = (k / 40) * Math.PI * 2;
    const drift = k / (turns * 40) - 0.5;
    out.push([(w / 2) * Math.cos(t * 1.02) * (0.7 + 0.3 * wob(k / 30, seed)) + drift * w * 0.4, (h / 2) * Math.sin(t) * (0.75 + 0.25 * wob(k / 25, seed + 3))]);
  }
  return out;
}
/** A curved hand-drawn arrow from a to b, bowed by `bend`, as two strokes (shaft, head). */
function arrow(a: P, b: P, bend: number): [P[], P[]] {
  const mx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * bend;
  const my = (a[1] + b[1]) / 2 + (b[0] - a[0]) * bend;
  const shaft: P[] = [];
  for (let k = 0; k <= 30; k++) {
    const t = k / 30;
    shaft.push([(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * mx + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * my + t * t * b[1]]);
  }
  const [px, py] = shaft[27];
  const ang = Math.atan2(b[1] - py, b[0] - px);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.16 + 14;
  const head: P[] = [
    [b[0] - len * Math.cos(ang - 0.5), b[1] - len * Math.sin(ang - 0.5)],
    b,
    [b[0] - len * Math.cos(ang + 0.5), b[1] - len * Math.sin(ang + 0.5)],
  ];
  return [shaft, head];
}
const drawn = (pts: P[], width: number, color: string, brush: string, name: string, x = 0, y = 0, taper = 0.05) =>
  strokeLayer(pts, width, { x, y, name, style: brushById(brush).style(color) }, { taper, smooth: 0.5 });

export interface Template {
  name: string;
  hint: string;
  category: 'Logo' | 'Icon' | 'Type' | 'Social' | 'Print' | 'Learn';
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
const STAMP = (ink: string, tooth = 0.55) => style('distressed', { ink, roughness: 1.2, speckle: 0.12, grain: 0.15, lines: 0, tooth, bleed: 0 });
/** Flat colour with a black outline and a hard offset shadow. */
const BRUTAL = (fill: string, dx = 14, dy = 14) => style('flat', { fill, outline: 6, outlineColor: '#0a0a0a', shadowOpacity: 1, shadowX: dx, shadowY: dy, shadowBlur: 0, shadowColor: '#0a0a0a' });

const ALL: Template[] = [
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
  {
    name: 'Sun stamp',
    hint: 'A square sliced into rays around an off-centre sun, printed like a rubber stamp',
    category: 'Logo',
    make: () =>
      project(
        'Sun stamp',
        [
          // Measured from a lino print: sun up and right of centre, ~2.4% gaps, soft piece corners.
          symbolLayer('roundRect', 1060, {
            name: 'Stamp',
            style: STAMP('#e01010', 0.6),
            modifiers: mods(
              { kind: 'slice', count: 12, gap: 0.024, angle: 4, ring: 0.29, hole: 0, jitter: 0.9, seed: 11, soften: 0.036, x: 0.125, y: -0.18 },
              { kind: 'wobble', amount: 0.003, scale: 0.3, seed: 3 },
            ),
          }, { radius: 0.035, aspect: 1 }),
          symbolLayer('circle', 64, { x: -250, y: -237, rotation: 27, sx: 1.9, op: 'subtract', name: 'Eye' }),
          symbolLayer('circle', 34, { x: -8, y: -440, sy: 1.25, op: 'subtract', name: 'Dot' }),
        ],
        solid('#ffffff'),
      ),
  },
  {
    name: 'Ring seal',
    hint: 'A word set all the way round a circle, with a sliced star, in rough black ink',
    category: 'Logo',
    make: () =>
      project(
        'Ring seal',
        [
          // Heavy letters squeezed narrow so twelve fit the full turn, with cut-paper edges.
          textLayer('MORPHO MORPHO ', 'archivo', {
            name: 'Ring text',
            style: STAMP('#141414', 0.25),
            modifiers: mods({ kind: 'stretch', x: 0.8, y: 1 }, { kind: 'weight', amount: 0.012 }, { kind: 'arc', bend: 2 }, { kind: 'wobble', amount: 0.01, scale: 0.12, seed: 6 }, { kind: 'ink', amount: 0.006, scale: 0.1, seed: 2 }),
          }, { size: 280, tracking: 0.07 }),
          symbolLayer('circle', 540, {
            name: 'Star',
            style: STAMP('#141414', 0.25),
            modifiers: mods({ kind: 'slice', count: 8, gap: 0.05, angle: 0, ring: 0, hole: 0.17, jitter: 0, seed: 1, soften: 0.008, x: 0, y: 0 }, { kind: 'wobble', amount: 0.01, scale: 0.12, seed: 9 }, { kind: 'ink', amount: 0.006, scale: 0.1, seed: 4 }),
          }),
        ],
        solid('#24b55f', { grain: 0.7 }),
      ),
  },
  {
    name: 'Fused band',
    hint: 'Heavy letters packed into an oval band so only thin gaps spell the words',
    category: 'Logo',
    make: () =>
      project(
        'Fused band',
        [
          // Letters grown until they almost touch, squeezed into the oval and clipped
          // by it; only the narrow gaps between them stay white.
          group(
            [
              symbolLayer('circle', 760, { sx: 1.62, name: 'Oval' }),
              textLayer('SOFT\nWAVE', 'rubik-mono', {
                name: 'Words',
                op: 'intersect',
                sx: 1.5,
                sy: 1.45,
                modifiers: mods({ kind: 'weight', amount: 0.022 }, { kind: 'fitCircle', amount: 1 }),
              }, { size: 220, lineHeight: 0.86, tracking: -0.02 }),
            ],
            { name: 'Letters', merge: true, style: INK('#212121'), modifiers: mods({ kind: 'round', radius: 0.012 }) },
          ),
          symbolLayer('ring', 760, { sx: 1.62, name: 'Rim', style: INK('#212121') }, { thickness: 0.05 }),
        ],
        solid('#f4f4f2'),
        { width: 1600, height: 1000 },
      ),
  },
  {
    name: 'Pixel poster',
    hint: 'Pixel type, a voxel coin and a dissolving edge on a split page',
    category: 'Print',
    make: () => {
      const blue = '#0b3fd9';
      const W = 1200;
      return project(
        'Pixel poster',
        [
          // The field ends at y = 0 and a tall band dissolves from there: few cells
          // drop at its top (page specks in the blue), most at its bottom.
          symbolLayer('roundRect', W, { y: -450, name: 'Blue field', style: INK(blue) }, { radius: 0, aspect: W / 900 }),
          symbolLayer('roundRect', W, {
            y: 259.2,
            name: 'Dissolve',
            style: INK(blue),
            modifiers: mods({ kind: 'pixelate', size: 0.018, shape: 'square', gap: 0.08, dissolve: 1, angle: 180, seed: 5 }),
          }, { radius: 0, aspect: W / 518.4 }),
          textLayer('SEE YOU\nNEXT TIME', 'silkscreen', { y: -640, name: 'Title', style: INK('#e9ecf2'), modifiers: mods({ kind: 'stretch', x: 0.82, y: 1 }) }, { size: 210, lineHeight: 0.92, tracking: -0.06 }),
          symbolLayer('circle', 520, {
            y: -130,
            name: 'Coin',
            style: style('extrude', { face: '#7d9bff', side: '#0a1f6e', outline: 0, depth: 16, angle: 135 }),
            modifiers: mods({ kind: 'pixelate', size: 0.032, shape: 'square', gap: 0.1, dissolve: 0, angle: 180, seed: 1 }),
          }),
          symbolLayer('polygon', 230, {
            x: 20,
            y: -130,
            rotation: 90,
            name: 'Play',
            style: INK('#ffffff'),
            modifiers: mods({ kind: 'pixelate', size: 0.07, shape: 'square', gap: 0.12, dissolve: 0, angle: 180, seed: 1 }),
          }, { sides: 3, rounding: 0 }),
          textLayer('MORPHO\n2026', 'silkscreen', { x: -380, y: 560, name: 'Mark', style: INK(blue) }, { size: 92, lineHeight: 0.9, align: 'left' }),
          textLayer('TYPE AND LOGO LAB\nFOR THE NEW AGE\nMADE ON THE GPU', 'bricolage', { x: 250, y: 395, name: 'Blurb', style: INK('#16181d') }, { size: 30, lineHeight: 1, align: 'left', tracking: -0.01 }),
          textLayer('START A PROJECT WITH US?', 'bricolage', { x: 250, y: 520, name: 'Small print', style: INK('#16181d') }, { size: 20, align: 'left' }),
          symbolLayer('roundRect', 1130, { y: 790, sy: 0.03, name: 'Rule', style: INK('#16181d') }, { radius: 0, aspect: 10 }),
          textLayer('© MORPHOTYPE', 'bricolage', { x: -500, y: 830, name: 'Credit', style: INK('#16181d') }, { size: 20, align: 'left' }),
          textLayer('[ TYPE ]   [ LOGO ]', 'bricolage', { y: 830, name: 'Tags', style: INK('#16181d') }, { size: 20 }),
          textLayer('ISSUE 01', 'bricolage', { x: 520, y: 830, name: 'Issue', style: INK('#16181d') }, { size: 20 }),
        ],
        solid('#e3e6eb'),
        { width: W, height: 1800 },
      );
    },
  },
  {
    name: 'Dither signal',
    hint: 'A one-bit dithered orb, echo lines and a stepped outline trail',
    category: 'Social',
    make: () =>
      project(
        'Dither signal',
        [
          symbolLayer('circle', 560, { y: -150, name: 'Orb', style: style('dither', { ink: '#0a0a0a', light: '#e9ff3b', cell: 5, shade: 0.85, ramp: 0.25, shadow: 0 }) }),
          symbolLayer('circle', 600, { y: -150, name: 'Echo', style: INK('#e9ff3b'), modifiers: mods({ kind: 'outline', width: 0.01 }, { kind: 'echo', count: 2, spacing: 0.045, width: 0.01 }) }),
          textLayer('SIGNAL', 'bricolage', {
            y: 420,
            name: 'Trail',
            style: INK('#e9ff3b'),
            modifiers: mods({ kind: 'outline', width: 0.012 }, { kind: 'repeat', mode: 'trail', count: 6, radius: 0, sweep: 360, orient: 0, cols: 1, rows: 1, gapX: 0, gapY: 0, dx: 0, dy: -0.09, grow: 1, spin: 0 }),
          }, { size: 230, tracking: -0.04 }),
          textLayer('SIGNAL', 'bricolage', { y: 420, name: 'Word', style: INK('#e9ff3b') }, { size: 230, tracking: -0.04 }),
          textLayer('LIVE FROM THE GPU · 001', 'bricolage', { y: -590, name: 'Caption', style: INK('#e9ff3b') }, { size: 30, tracking: 0.08 }),
        ],
        solid('#0a0a0a', { grain: 0.25 }),
        { width: 1080, height: 1350 },
      ),
  },
  {
    name: 'Pixel wordmark',
    hint: 'Bitmap lettering with an outline and a stepped 3D shadow',
    category: 'Logo',
    make: () =>
      project(
        'Pixel wordmark',
        [
          textLayer('pixels', 'silkscreen', {
            name: 'Wordmark',
            style: style('extrude', { face: '#e2ff2e', side: '#23203f', depth: 22, angle: 135, shade: 0, outline: 9, outlineColor: '#23203f' }),
          }, { size: 250, tracking: -0.04 }),
        ],
        solid('#6129ff'),
      ),
  },
  {
    name: 'Voxel cursor',
    hint: 'A cursor built from 3D blocks, with a white core inside a blue rim',
    category: 'Icon',
    make: () => {
      const cells = (fill: string) => style('extrude', { face: fill, side: '#0a3fb8', depth: 30, angle: 150, shade: 0.45, outline: 0 });
      const pix = (extra: object[] = []) => mods(...(extra as never[]), { kind: 'pixelate', size: 0.075, shape: 'square', gap: 0.05, dissolve: 0, angle: 180, seed: 1 });
      return project(
        'Voxel cursor',
        [
          symbolLayer('cursor', 760, { rotation: -18, name: 'Rim', style: cells('#1f63f0'), modifiers: pix() }),
          symbolLayer('cursor', 760, { rotation: -18, name: 'Core', style: cells('#f1f0ee'), modifiers: pix([{ kind: 'weight', amount: -0.09 }]) }),
        ],
        solid('#ffffff'),
      );
    },
  },
  {
    name: 'Dot type',
    hint: 'Dot-matrix letters whose neighbouring dots melt together, on a dot grid',
    category: 'Type',
    make: () =>
      project(
        'Dot type',
        [
          // The pixel grid starts at the layer's origin, so with the layer at the
          // artboard centre and the pattern's cell matching it, the dots sit on the page's dot grid.
          textLayer('ab\nkm', 'archivo', {
            name: 'Letters',
            style: INK('#0d0d0d'),
            modifiers: mods({ kind: 'pixelate', size: 0.11, shape: 'dot', gap: 0.2, dissolve: 0, angle: 180, seed: 1 }, { kind: 'fuse', amount: 0.03 }),
          }, { size: 520, lineHeight: 0.9, tracking: 0.06 }),
          textLayer('Letterform variations 04       Specimen A       004', 'bricolage', { y: -500, name: 'Header', style: INK('#2a2f2c') }, { size: 26 }),
          symbolLayer('roundRect', 1040, { y: -460, sy: 0.02, name: 'Rule', style: INK('#2a2f2c') }, { radius: 0, aspect: 10 }),
        ],
        background(fill('solid', '#e4f0ec'), { pattern: pattern('dots', '#0d0d0d', { size: 57.2, weight: 3.5, opacity: 0.8 }) }),
        { width: 1200, height: 1200 },
      ),
  },
  {
    name: 'Pixel garden',
    hint: 'Six little bitmap flowers in a grid, ready to recolour',
    category: 'Icon',
    make: () => {
      const ink = INK('#111111');
      const px = () => mods({ kind: 'pixelate', size: 0.07, shape: 'square', gap: 0, dissolve: 0, angle: 180, seed: 1 });
      const heads: [string, object, number][] = [
        ['flower', { petals: 3, depth: 0.5 }, 0],
        ['flower', { petals: 5, depth: 0.25 }, 0],
        ['star', { points: 6, inner: 0.6, rounding: 0.2 }, 0],
        ['heart', {}, 180],
        ['sparkle', { pinch: 0.4 }, 0],
        ['flower', { petals: 4, depth: 0.45 }, 45],
      ];
      const kids = heads.map(([kind, params, rot], k) => {
        const x = ((k % 3) - 1) * 300;
        const y = (Math.floor(k / 3) - 0.5) * 360;
        return group(
          [
            symbolLayer(kind as never, 170, { x, y: y - 70, rotation: rot, name: 'Head' }, params as never),
            symbolLayer('roundRect', 200, { x, y: y + 40, sx: 0.12, name: 'Stem' }, { radius: 0, aspect: 0.5 }),
            symbolLayer('circle', 46, { x: x - 48, y: y + 82, rotation: -35, sx: 1.8, name: 'Leaf' }),
            symbolLayer('circle', 46, { x: x + 48, y: y + 82, rotation: 35, sx: 1.8, name: 'Leaf' }),
          ],
          { merge: true, name: `Flower ${k + 1}`, style: ink, modifiers: px() },
        );
      });
      return project('Pixel garden', kids, solid('#f1ede3'), { width: 1080, height: 1080 });
    },
  },
  {
    name: 'Printed shapes',
    hint: 'Halftone-shaded 3D shapes on green, with marker notes and arrows',
    category: 'Social',
    make: () => {
      const ink = '#16161a';
      const shaded = (extra: object = {}) => style('halftone', { ink: '#5b4fe0', cell: 7, ramp: 0.25, rampAngle: 200, shade: 1, min: 0.02, max: 1.25, paper: '#ffffff', paperOn: 1, offsetX: -8, offsetY: 7, ...extra });
      const label = (t: string, x: number, y: number, size = 64) => textLayer(t, 'caveat-brush', { x, y, name: t, style: INK(ink) }, { size, tracking: 0.04 });
      const underline = (x: number, y: number, w: number) => drawn([[-w / 2, 3], [-w / 4, -2], [w / 4, 2], [w / 2, -3]], 7, ink, 'marker', 'Underline', x, y);
      const layers = [
        symbolLayer('star', 360, { x: -560, y: -170, rotation: 8, name: 'Star', style: shaded() }, { points: 6, inner: 0.42, rounding: 0.04 }),
        symbolLayer('cursor', 330, { x: 10, y: -190, rotation: -18, name: 'Cursor', style: shaded({ rampAngle: 120 }) }),
        symbolLayer('polygon', 330, { x: 520, y: -190, rotation: 30, name: 'Cube', style: shaded({ rampAngle: 90, ramp: 0.5 }) }, { sides: 6, rounding: 0.04 }),
        symbolLayer('pill', 380, { x: -470, y: 300, rotation: -52, name: 'Pencil', style: shaded({ rampAngle: 140 }) }, { aspect: 3.4 }),
        symbolLayer('heart', 320, { x: 20, y: 300, rotation: 4, name: 'Heart', style: shaded({ rampAngle: 230 }) }),
        symbolLayer('squircle', 300, { x: 520, y: 320, rotation: 34, name: 'Tile', style: shaded({ rampAngle: 60 }) }, { exponent: 12, aspect: 1 }),
        ...(
          [
            ['WOWS', -740, 40, 64, -740, 85, 160],
            ['INTERACTIVE\n+ WEB', -10, -400, 52, 20, -335, 190],
            ['3D', 760, -20, 64, 760, 18, 110],
            ['HANDMADE', -10, 70, 64, -10, 110, 260],
            ['ILLUSTRATION', -560, 470, 64, -560, 508, 300],
          ] as [string, number, number, number, number, number, number][]
        ).map(([t, x, y, size, ux, uy, w]) => group([label(t, x, y, size), underline(ux, uy, w)], { name: t.replace('\n', ' '), open: false })),
        label('KEYFRAME\nANIMATION', 760, 150, 52),
      ];
      const arrows: Node[] = [];
      for (const [a, b, bend] of [
        [[-760, -10], [-640, -90], -0.25],
        [[200, -320], [240, -200], 0.6],
        [[740, -70], [690, -150], 0.3],
        [[120, 80], [200, 190], -0.3],
        [[-430, 430], [-440, 360], 0.2],
        [[700, 220], [640, 290], 0.3],
      ] as [P, P, number][]) {
        const [shaft, head] = arrow(a, b, bend);
        arrows.push(group([drawn(shaft, 7, ink, 'marker', 'Shaft', 0, 0, 0.15), drawn(head, 7, ink, 'marker', 'Head')], { name: 'Arrow', open: false }));
      }
      // Little "wow" ticks around the star.
      const ticks = ([[-560, -400, 90], [-380, -330, 40], [-330, -170, 0], [-760, -280, 150], [-560, 70, 270]] as [number, number, number][]).map(([x, y, a]) => {
        const r = (a * Math.PI) / 180;
        return drawn([[0, 0], [22 * Math.cos(r), -22 * Math.sin(r)]], 7, ink, 'marker', 'Tick', x, y);
      });
      layers.push(group(arrows, { name: 'Arrows', open: false }), group(ticks, { name: 'Ticks', open: false }));
      return project('Printed shapes', layers, solid('#0aa84f', { grain: 0.15 }), { width: 1920, height: 1080 });
    },
  },
  {
    name: 'Night notes',
    hint: 'Pink marker scribbles, flowers and handwriting over a dark street photo (drop your own in)',
    category: 'Social',
    make: () => {
      const pink = '#ff7ec4';
      const layers = [
        // Stand-in for a photo: replace it via Style → Photo, or drop an image.
        symbolLayer('roundRect', 1080, { name: 'Photo (replace me)', style: style('flat', { fill: '#1d2430', fill2: '#3a4655', gradient: 1, angle: 160, texture: 0.4 }) }, { radius: 0, aspect: 1 }),
        drawn(scribble(360, 300, 6, 2), 3, pink, 'pencil', 'Scribble', -300, -380),
        drawn([[-120, -60], [-40, 80], [10, -20], [90, 60], [150, -90]], 46, pink, 'marker', 'Big V', -300, -380, 0),
        drawn(flowerLine(5, 190, 4), 16, pink, 'marker', 'Flower', 300, -300),
        drawn([[0, 0], [30, 160], [70, 330], [110, 470]], 4, pink, 'pencil', 'Stem', 300, -300),
        drawn(flowerLine(5, 220, 9), 4, pink, 'pencil', 'Flower outline', 330, 230),
        drawn([[-260, 0], [-100, -14], [60, -6], [240, -30]], 40, pink, 'marker', 'Swipe', 360, 280, 0),
        drawn(scribble(160, 140, 3, 7), 4, pink, 'pencil', 'Loops', -420, 400),
        drawn([[-150, 0], [150, 0]], 52, pink, 'marker', 'Bar', -400, 120, 0),
        drawn([[-180, 0], [180, 0]], 48, pink, 'marker', 'Bar', 330, 470, 0),
        drawn([[-120, 0], [150, 0]], 44, pink, 'marker', 'Bar', 360, 410, 0),
        symbolLayer('roundRect', 300, { x: -20, y: 40, rotation: -2, name: 'Paper', style: style('flat', { fill: pink, texture: 0.5 }) }, { radius: 0.01, aspect: 0.62 }),
        textLayer('and you left\nno trace in\nthe dark, no\nsound at all,\njust a name\nin the papers', 'caveat', { x: -140, y: 20, rotation: -2, name: 'Note', style: INK('#ffd9ec') }, { size: 40, lineHeight: 1.05, align: 'left' }),
      ];
      return project('Night notes', layers, solid('#141a22'), { width: 1080, height: 1080 });
    },
  },
  {
    name: 'Echo rings',
    hint: 'Hand-drawn contour rings radiating from the subject of a photo',
    category: 'Social',
    make: () =>
      project(
        'Echo rings',
        [
          symbolLayer('roundRect', 1080, { name: 'Photo (replace me)', style: style('flat', { fill: '#6d7176', fill2: '#3f4247', gradient: 1, angle: 200, texture: 0.5 }) }, { radius: 0, aspect: 1 }),
          symbolLayer('blob', 240, {
            sy: 1.9,
            y: 60,
            name: 'Rings',
            style: style('distressed', { ink: '#f4e23a', roughness: 0.35, speckle: 0, grain: 0.2, lines: 0, tooth: 0.08, bleed: 0.3 }),
            modifiers: mods({ kind: 'outline', width: 0.025 }, { kind: 'echo', count: 7, spacing: 0.2, width: 0.025 }, { kind: 'wobble', amount: 0.04, scale: 0.5, seed: 4 }),
          }, { lobes: 5, depth: 0.05, seed: 3, wobble: 0.4 }),
        ],
        solid('#55595e'),
        { width: 1080, height: 1080 },
      ),
  },
  {
    name: 'Folder sticker',
    hint: 'Flat folder with thick outlines and hard shadows on grid paper',
    category: 'Icon',
    make: () =>
      project(
        'Folder sticker',
        [
          symbolLayer('folder', 860, { x: -15, y: -95, name: 'Back', style: BRUTAL('#9b4ff0', -32, 36) }, { tab: 0.28, corner: 0.03 }),
          symbolLayer('roundRect', 830, { x: 65, y: -79, name: 'Paper', style: BRUTAL('#f2ebe2', 0, 0), modifiers: mods({ kind: 'slant', angle: 4 }) }, { radius: 0.025, aspect: 1.45 }),
          symbolLayer('roundRect', 835, { x: 69, y: -43, name: 'Front', style: BRUTAL('#9b4ff0', -30, 38), modifiers: mods({ kind: 'slant', angle: 15 }) }, { radius: 0.022, aspect: 835 / 575 }),
          symbolLayer('pill', 600, { y: 400, name: 'Label', style: BRUTAL('#f2ebe2', -10, 14) }, { aspect: 4 }),
          textLayer('Fresh Ideas', 'young-serif', { y: 402, name: 'Label text', style: INK('#121212') }, { size: 76, tracking: -0.01 }),
          symbolLayer('cursor', 250, { x: 447, y: 285, rotation: -14, name: 'Cursor', style: BRUTAL('#ff4a10', -10, 12) }),
        ],
        background(fill('solid', '#0d7a2c'), { pattern: pattern('grid', '#085a1f', { size: 200, weight: 6, opacity: 1 }) }),
      ),
  },
];

/** Newest, most current looks first. */
const FEATURED = [
  ...SHOWCASE_TEMPLATES.map((t) => t.name),
  ...MOTION_TEMPLATES.map((t) => t.name),
  ...STARTER_TEMPLATES.map((t) => t.name),
  ...LEARN_TEMPLATES.map((t) => t.name),
  ...GRAPHIC_TEMPLATES.map((t) => t.name),
  ...LAB_TEMPLATES.map((t) => t.name),
  ...STUDIO_TEMPLATES.map((t) => t.name),
  'Printed shapes', 'Night notes', 'Echo rings', 'Sun stamp', 'Ring seal', 'Voxel cursor', 'Dot type', 'Folder sticker', 'Pixel wordmark', 'Pixel poster', 'Dither signal', 'Fused band', 'Pixel garden'];
const EVERY = [...ALL, ...LAB_TEMPLATES, ...STUDIO_TEMPLATES, ...GRAPHIC_TEMPLATES, ...MOTION_TEMPLATES, ...LEARN_TEMPLATES, ...STARTER_TEMPLATES, ...SHOWCASE_TEMPLATES];
export const TEMPLATES: Template[] = [...FEATURED.map((n) => EVERY.find((t) => t.name === n)!).filter(Boolean), ...EVERY.filter((t) => !FEATURED.includes(t.name))];
