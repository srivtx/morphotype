// Animated showcases: one finished scene per material, each moved with the
// plain Motion tools and, where it helps, a moving material setting (the
// diamond button). Built only from what ships with the app — library shapes,
// modifier recipes, bundled fonts and materials — so every part can be
// selected, changed and reused.
import { background, fill, group, mods, pattern, style, symbolLayer, textLayer, type Node, type Project, type ShapeLayer, type Style } from './model';
import { FEELS, newMotion, type Motion, type ParamAnim, type Transition } from './motion';
import type { Background } from './model';
import type { SymbolKind } from '../engine/types';
import type { Template } from './templates';

const W = 1200;
const H = 800;

const feel = (label: string, duration?: number): Transition => {
  const t = { ...FEELS.find((f) => f.label === label)!.value };
  return duration ? { ...t, duration } : t;
};
const anim = (to: number | string, period: number, mode: ParamAnim['mode'] = 'swing', phase = 0): ParamAnim => ({ to, period, phase, mode });

function shape(kind: SymbolKind, size: number, x: number, y: number, st: Style, name: string, params: Record<string, unknown> = {}, motion?: Partial<Motion>): ShapeLayer {
  const n = symbolLayer(kind, size, { x, y, name, style: st }, params);
  if (motion) n.motion = newMotion(motion);
  return n;
}

/** Centred type; `y` is the middle of the line. */
function words(s: string, font: string, size: number, x: number, y: number, st: Style, name: string, motion?: Partial<Motion>, tracking = 0): ShapeLayer {
  const n = textLayer(s, font, { x, y, name, style: st }, { size, align: 'center', lineHeight: 1, tracking });
  if (motion) n.motion = newMotion(motion);
  return n;
}

const flat = (c: string): Style => style('flat', { fill: c });

const scene = (name: string, hint: string, layers: Node[], bg: Background, duration = 4): Template => ({
  name,
  hint,
  category: 'Learn',
  make: (): Project => ({ version: 2, name, canvas: { width: W, height: H }, layers, background: bg, fonts: [], timeline: { duration, loop: true } }),
});

const solid = (c: string, grain = 0) => background(fill('solid', c), grain ? { grain } : {});

export const SHOWCASE_TEMPLATES: Template[] = [
  scene(
    'Animated · Neon sign',
    'A neon "Open" flickers on a concrete wall, its glow breathing: Neon tube with Flicker, and a moving Intensity',
    (() => {
      const neon = (color: string, core: string, extra: Record<string, number> = {}) => style('neon', { color, core, tube: 7, glow: 30, intensity: 1.1, ...extra });
      const frame = shape('roundRect', 820, 0, 10, neon('#2fd8ff', '#e9fbff', { tube: 6 }), 'Frame', { radius: 0.12, aspect: 820 / 470 }, { enter: 'fade', delay: 0.1, transition: feel('Smooth', 0.4) });
      frame.style.animate = { intensity: anim(1.5, 2, 'swing') };
      const open = words('Open', 'pacifico', 230, 0, -40, neon('#ff3df2', '#fff3ff', { flicker: 0.2 }), 'Open', { enter: 'fade', delay: 0.6, transition: feel('Snappy', 0.15) });
      open.style.animate = { glow: anim(48, 1, 'swing') };
      const late = words('LATE NIGHT', 'inter-black', 46, 0, 170, neon('#ffd21e', '#fffbe6', { tube: 3, glow: 18 }), 'Late night', { enter: 'fade', delay: 1.1, transition: feel('Snappy', 0.15), loop: 'blink', amount: 55, period: 2 }, 0.14);
      return [frame, open, late];
    })(),
    solid('#2b2b2e', 0.35),
  ),
  scene(
    'Animated · Sticker pack',
    'Five die-cut stickers pop onto a striped sheet one by one, then rock gently: Sticker, One by one, Sway',
    (() => {
      const sticker = (f: string) => style('sticker', { fill: f, line: '#14121a', lineWidth: 10, border: '#ffffff', borderWidth: 12, shadow: 0.3 });
      const kids = (
        [
          ['moon', '#ffb21e'],
          ['bolt', '#2f7bff'],
          ['heart', '#ff4f7a'],
          ['star', '#2fbf71'],
          ['flower', '#9b5cff'],
        ] as [SymbolKind, string][]
      ).map(([k, c], i) => shape(k, 170, -440 + i * 220, i % 2 ? 40 : -20, sticker(c), `${k} sticker`, k === 'star' ? { rounding: 0.25 } : k === 'flower' ? { petals: 6, depth: 0.3, petal: 'round', hole: 0.2 } : {}));
      const row = group(kids, { name: 'Stickers', motion: newMotion({ enter: 'grow', distance: 0, delay: 0.2, stagger: 0.14, transition: feel('Bouncy', 0.55), loop: 'sway', amount: 6, period: 2 }) });
      const title = words('STICKER PACK', 'bungee', 72, 0, 230, sticker('#ffffff'), 'Title', { enter: 'rise', distance: 80, delay: 1.1, transition: feel('Bouncy', 0.5) });
      return [row, title];
    })(),
    background(fill('solid', '#ffd6e8'), { pattern: pattern('diagonal', '#ff7ab6', { size: 60, weight: 26, opacity: 0.6 }) }),
  ),
  scene(
    'Animated · Liquid chrome',
    'A chrome sparkle turns while its metal flows, Y2K floats beneath, tiny stars orbit: Chrome with Animate, Spin, Orbit',
    (() => {
      const chrome = (extra: Record<string, number | string> = {}) => style('chrome', { c1: '#0a0030', c2: '#5b2bd6', c3: '#ff9ce6', c4: '#ffffff', speed: 0.35, ...extra });
      const star = shape('sparkle', 330, 0, -70, chrome(), 'Sparkle', { pinch: 0.42 }, { loop: 'spin', amount: 1, period: 4, enter: 'grow', distance: 0, delay: 0.1, transition: feel('Bouncy', 0.7) });
      const y2k = words('Y2K', 'unbounded', 170, 0, 230, chrome({ bevel: 26, speed: 0.5 }), 'Y2K', { loop: 'float', amount: 14, period: 2, enter: 'rise', distance: 90, delay: 0.5, transition: feel('Smooth', 0.7) });
      const orbiters = [0, 0.33, 0.66].map((phase, i) => shape('sparkle', 46, 0, -70, flat('#ffffff'), `Orbiter ${i + 1}`, { pinch: 0.3 }, { loop: 'orbit', amount: 250, period: 4, phase }));
      return [...orbiters, star, y2k];
    })(),
    background({ ...fill('aura', '#1424ff', '#000028', '#4fb4ff', '#c7e4ff'), angle: 90 }),
  ),
  scene(
    'Animated · Keyboard',
    'Keycaps drop in letter by letter to spell HELLO, then each one presses in turn: Keycap, One by one, Pulse',
    (() => {
      const caps = ['#f2f3f5', '#ffb21e', '#f2f3f5', '#f2f3f5', '#ff5a36'];
      const keys = 'HELLO'.split('').map((ch, i) => {
        const x = -400 + i * 200;
        return group([shape('roundRect', 170, x, 30, style('keycap', { color: caps[i], tilt: 0.3, tiltX: -0.15 }), 'Cap', { radius: 0.18 }), words(ch, 'space-grotesk', 74, x, 16, flat('#2a2a30'), 'Letter')], { name: `Key ${ch}` });
      });
      return [
        group(keys, { name: 'Keys', motion: newMotion({ enter: 'drop', distance: 120, delay: 0.2, stagger: 0.16, transition: feel('Snappy', 0.35), loop: 'pulse', amount: 7, period: 2 }) }),
        words('type anything', 'space-grotesk', 34, 0, 220, flat('#8e95a3'), 'Caption', { enter: 'fade', delay: 1.2 }),
      ];
    })(),
    solid('#e9edf3'),
  ),
  scene(
    'Animated · Melting',
    'Heavy type slowly melts and sets again under a turning sun: a Melt modifier whose Amount moves',
    (() => {
      const melt = words('MELT', 'anton', 330, 0, 40, flat('#fff3e0'), 'Melt');
      melt.modifiers = mods({ kind: 'melt', amount: 0.05, scale: 0.3, seed: 4 });
      melt.animate = { [`mod:${melt.modifiers[0].uid}:amount`]: anim(0.55, 4, 'swing') };
      const sun = shape('rays', 620, 0, 20, flat('#ff9a3d'), 'Sun', { rays: 16, short: 0.6, inner: 0.3 }, { loop: 'spin', amount: 1, period: 12 });
      const hot = words("it's getting hot", 'caveat-brush', 54, 0, -250, flat('#5a1a00'), 'Caption', { enter: 'rise', distance: 40, delay: 0.3 });
      return [sun, melt, hot];
    })(),
    solid('#ff7a2f'),
  ),
  scene(
    'Animated · Arcade',
    'Pixel dots run past a bobbing pixel ghost while PRESS START blinks: Bitmap and Dot matrix recipes, a one-way Slide',
    (() => {
      const pix = (n: ShapeLayer, size = 0.07) => ((n.modifiers = mods({ kind: 'pixelate', size, shape: 'square', gap: 0 })), n);
      const ghost = group([pix(shape('bubble', 230, -260, -40, flat('#ff4fa3'), 'Body', { tail: 0.2 })), pix(shape('eyes', 120, -250, -60, flat('#ffffff'), 'Eyes'), 0.12)], { name: 'Ghost', motion: newMotion({ loop: 'float', amount: 22, period: 2 }) });
      const heart = pix(shape('heart', 130, 300, -60, flat('#ff3d3d'), 'Heart', {}, { loop: 'pulse', amount: 14, period: 1 }), 0.1);
      const frame = shape('roundRect', 1000, 0, 140, flat('#141418'), 'Lane', { radius: 0.2, aspect: 1000 / 90 });
      const dots = group(
        Array.from({ length: 12 }, (_, i) => pix(shape('circle', 30, -540 + i * 100, 140, flat('#ffd21e'), `Dot ${i + 1}`), 0.25)),
        { name: 'Dots', motion: newMotion({ loop: 'slide', dir: 'left', oneWay: true, amount: 100, period: 0.5 }) },
      );
      const press = words('PRESS START', 'silkscreen', 64, 0, 280, flat('#ffffff'), 'Press start', { loop: 'blink', amount: 100, period: 1 }, 0.04);
      const level = words('LEVEL 1', 'silkscreen', 48, 0, -300, flat('#2fd8ff'), 'Level', { enter: 'drop', distance: 120, delay: 0.2, transition: feel('Bouncy', 0.5) });
      return [level, ghost, heart, group([frame, dots], { name: 'Lane', clip: true }), press];
    })(),
    solid('#000000'),
  ),
  scene(
    'Animated · Plush weather',
    'A fuzzy sun turns behind a floating plush cloud while a bolt flashes: Plush material, Spin, Float, Blink',
    (() => {
      const plush = (color: string, shade: string, extra: Record<string, number> = {}) => style('plush', { color, shade, fuzz: 8, ...extra });
      const sun = shape('rays', 380, 150, -110, plush('#ffc21a', '#e0641c', { bevel: 60 }), 'Sun', { rays: 12, short: 0.7, inner: 0.42 }, { loop: 'spin', amount: 1, period: 10, enter: 'grow', distance: 0, delay: 0.1, transition: feel('Bouncy', 0.8) });
      const cloud = shape('cloud', 420, -60, 30, plush('#f4f6ff', '#9aa6d6', { bevel: 110 }), 'Cloud', { puffs: 3 }, { loop: 'float', amount: 16, period: 3, enter: 'left', distance: 300, delay: 0.3, transition: feel('Smooth', 0.9) });
      const bolt = shape('bolt', 170, 40, 230, plush('#ffe24a', '#d18a00', { bevel: 40 }), 'Bolt', {}, { loop: 'blink', amount: 90, period: 1.5, phase: 0.3 });
      const label = words('Mostly fluffy', 'bricolage', 52, -330, 300, flat('#ffffff'), 'Forecast', { enter: 'rise', distance: 40, delay: 0.9 });
      return [sun, bolt, cloud, label];
    })(),
    background(fill('linear', '#7ccfff', '#2b8bff')),
  ),
  scene(
    'Animated · Holo card',
    'A foil trading card rocks and its rainbow sweeps across: Holo with a Hue shift that ramps round and round',
    (() => {
      const card = shape('roundRect', 560, 0, 0, style('holo', { body: '#101018', rimWidth: 12, gloss: 0.8 }), 'Card', { radius: 0.07, aspect: 0.72 });
      card.style.animate = { shift: anim(1, 4, 'ramp') };
      const star = shape('star', 210, 0, -60, style('holo', { body: '#ffffff', foil: 1, pastel: 0.3 }), 'Star', { points: 5, inner: 0.48, rounding: 0.2 }, { loop: 'spin', amount: 1, period: 6 });
      star.style.animate = { shift: anim(1, 4, 'ramp', 0.5) };
      const rare = words('RARE', 'dela-gothic', 74, 0, 170, flat('#ffffff'), 'Rare', {}, 0.06);
      return [group([card, star, rare], { name: 'Holo card', motion: newMotion({ enter: 'spin', distance: 90, delay: 0.1, transition: feel('Bouncy', 0.9), loop: 'sway', amount: 5, period: 4 }) })];
    })(),
    solid('#0b0b0d'),
  ),
  scene(
    'Animated · Pop 3D',
    'Chunky 3D type whose shadow swings all the way round, popping in time: Extrude with a ramping Direction',
    (() => {
      const pop = words('POP', 'rubik-mono', 260, 0, 0, style('extrude', { face: '#ff4fa3', side: '#5b2bd6', depth: 46, outline: 7, outlineColor: '#14121a' }), 'Pop', { loop: 'pulse', amount: 6, period: 0.75, enter: 'grow', distance: 0, delay: 0.1, transition: feel('Bouncy', 0.6) });
      pop.style.animate = { angle: anim(405, 3, 'ramp') };
      const dots = [0, 1, 2, 3].map((i) => shape('plus', 70, [-460, 450, -420, 470][i], [-250, -230, 240, 250][i], flat('#14121a'), `Plus ${i + 1}`, { thickness: 0.32 }, { loop: 'spin', amount: i % 2 ? -1 : 1, period: 3 }));
      return [...dots, pop];
    })(),
    solid('#b4f22e'),
    3,
  ),
  scene(
    'Animated · Print club',
    'A two-ink risograph poster that jitters off-register while its flower turns and the words slide in from both sides',
    (() => {
      const riso = (ink: string, ink2: string, extra: Record<string, number> = {}) => style('riso', { ink, ink2, ...extra });
      const flower = shape('flower', 380, 0, -40, riso('#ff4fb1', '#2b6bff'), 'Flower', { petals: 8, depth: 0.3, petal: 'round', hole: 0.18 }, { loop: 'spin', amount: 1, period: 8 });
      flower.style.animate = { offsetX: anim(-9, 0.5, 'flicker') };
      const print = words('PRINT', 'dela-gothic', 120, 0, -300, riso('#2b6bff', '#ff4fb1'), 'Print', { enter: 'left', distance: 500, delay: 0.2, transition: feel('Snappy', 0.6) });
      const club = words('CLUB', 'dela-gothic', 120, 0, 240, riso('#2b6bff', '#ff4fb1'), 'Club', { enter: 'right', distance: 500, delay: 0.35, transition: feel('Snappy', 0.6) });
      return [flower, print, club];
    })(),
    solid('#f2ede4', 0.25),
  ),
];
