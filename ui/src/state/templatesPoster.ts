// Animated posters in the Y2K / 3D-abstract / pixel-glitch style: chrome and
// inflatable tubes drawn on along pen lines (Line › Start/End), puffy shapes
// with topographic lines and speckles (Puffy › Surface), type breaking into
// pixel debris (the Glitch modifier) and stepped pixel badges behind script.
// Everything is a plain layer with app settings, so each part can be picked
// apart and reused; the moving parts are Motion loops and diamond keyframes.
import { background, fill, group, lineLayer, mods, stroke, style, symbolLayer, textLayer, type Node, type Project, type ShapeLayer, type Style } from './model';
import { lineAnimKey } from './geoMotion';
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
function words(s: string, font: string, size: number, x: number, y: number, st: Style, name: string, motion?: Partial<Motion>, tracking = 0, lineHeight = 1): ShapeLayer {
  const n = textLayer(s, font, { x, y, name, style: st }, { size, align: 'center', lineHeight, tracking });
  if (motion) n.motion = newMotion(motion);
  return n;
}

/**
 * A pen line (em units of `size`) that wipes off and draws itself on again:
 * Line › End holds at 1, goes to 0 and comes back (Hold). At rest, and on
 * the first frame, the whole line shows.
 */
function tube(d: string, size: number, width: number, x: number, y: number, st: Style, name: string, draw?: { period: number; phase?: number }): ShapeLayer {
  const l = lineLayer(d, size, width, { x, y, name, style: st });
  if (draw) l.animate = { [lineAnimKey('end')]: anim(0, draw.period, 'hold', draw.phase ?? 0) };
  return l;
}

const flat = (c: string): Style => style('flat', { fill: c });
const puffy = (body: string, shade: string, extra: Record<string, number | string> = {}) => style('inflate', { body, shade, ...extra });
const vinyl = (body: string, shade: string, extra: Record<string, number | string> = {}) => style('vinyl', { body, shade, ...extra });
const SILVER = { c1: '#15171c', c2: '#6f747e', c3: '#d9dde5', c4: '#ffffff', rimColor: '#ffffff', liquid: 0.25, bands: 1.4 };
const chrome = (extra: Record<string, number | string> = {}) => style('chrome', { ...SILVER, ...extra });

const scene = (name: string, hint: string, layers: Node[], bg: Background, duration = 4): Template => ({
  name,
  hint,
  category: 'Learn',
  make: (): Project => ({ version: 2, name, canvas: { width: W, height: H }, layers, background: bg, fonts: [], timeline: { duration, loop: true } }),
});

const solid = (c: string, grain = 0) => background(fill('solid', c), grain ? { grain } : {});

/** A six-petal flower outline as one closed pen line (em units): round lobes, deep pinches. */
const FLOWER = (() => {
  const pts = Array.from({ length: 144 }, (_, i) => {
    const a = (i / 144) * Math.PI * 2;
    const r = 0.2 + 0.26 * Math.pow(Math.abs(Math.cos(3 * a)), 0.55);
    return `${(Math.cos(a) * r).toFixed(4)} ${(Math.sin(a) * r).toFixed(4)}`;
  });
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
})();

export const POSTER_TEMPLATES: Template[] = [
  scene(
    'Animated · Y2K set',
    'A 3D-abstract set: a puffy blob with drifting contour lines, a spiky chrome star, speckled foam, a chrome flower tube and a script stroke drawing themselves on (Line › End), around pixel and serif type',
    (() => {
      const blue = '#2347ff';
      const y = tube('M -0.36 -0.3 C -0.32 -0.52 -0.12 -0.3 -0.14 -0.02 C -0.15 0.16 0.04 0.18 0.11 -0.04 L 0.2 -0.36 C 0.12 0.3 0.02 0.78 -0.26 0.74 C -0.48 0.7 -0.34 0.42 0.08 0.36', 360, 15, -300, -20, flat(blue), 'Script y', { period: 4 });
      const two = words('2', 'archivo', 400, -40, -10, flat(blue), 'Pixel 2');
      two.modifiers = mods({ kind: 'pixelate', size: 0.075, shape: 'square', gap: 0, dissolve: 0, angle: 180, seed: 1 });
      const k = words('K', 'young-serif', 420, 210, -10, flat(blue), 'Serif K');
      const blob = shape('blob', 300, -400, -190, puffy('#c98cff', '#7b2fd6', { bevel: 90, gloss: 0.55, surface: 1, marks: '#f3e6ff', marksAmount: 0.85, marksSize: 55, marksWidth: 1.4 }), 'Topo blob', { lobes: 3, depth: 0.15, seed: 2, wobble: 0.4 }, { loop: 'float', amount: 14, period: 4 });
      blob.rotation = -18;
      blob.style.animate = { marksFlow: anim(1.6, 4, 'swing'), bevel: anim(60, 4, 'swing') };
      const spikes = shape('rays', 330, 0, 0, chrome({ form: 1, bevel: 120, softness: 7 }), 'Spikes', { rays: 14, short: 0.45, inner: 0.16, jitter: 0.6, seed: 3 });
      const ball = shape('circle', 74, 0, 0, chrome({ c1: '#4a4f58', c2: '#9aa0aa', bevel: 40, liquid: 0, bands: 1 }), 'Ball');
      const star = group([spikes, ball], { name: 'Chrome star', motion: newMotion({ loop: 'spin', amount: 1, period: 8 }) });
      [spikes, ball].forEach((c) => ((c.x = 400), (c.y = -170)));
      const foam = shape('blob', 270, -420, 230, puffy('#5ce84e', '#1c8f26', { bevel: 30, gloss: 0.3, surface: 2, marks: '#0b260d', marksAmount: 0.9, marksSize: 22, marksWidth: 1.6 }), 'Speckled foam', { lobes: 11, depth: 0.12, seed: 5, wobble: 0.8 }, { loop: 'float', amount: 12, period: 2, phase: 0.3 });
      foam.modifiers = mods({ kind: 'wobble', amount: 0.045, scale: 0.16, seed: 3 });
      const flower = tube(FLOWER, 330, 30, 420, 215, chrome({ bevel: 15, softness: 0, liquid: 0.12, bands: 1.1 }), 'Chrome flower', { period: 4, phase: 0.38 });
      flower.motion = newMotion({ loop: 'sway', amount: 8, period: 4 });
      const caption = words('Bold, tactile and perfectly futuristic.\nAbstract 3D for designers and agencies.', 'inter', 21, 0, 300, flat('#111111'), 'Caption', undefined, 0, 1.3);
      const brand = words('Y2K by', 'space-grotesk', 22, -520, -350, flat('#111111'), 'Brand');
      const badge = shape('ring', 34, -455, -350, flat('#111111'), 'Eyes ring', { thickness: 0.07 });
      const eyes = shape('eyes', 22, -455, -351, flat('#111111'), 'Eyes', { gap: 0.36, width: 0.2, height: 0.38 }, { loop: 'blink', amount: 100, period: 2, phase: 0.9 });
      const arrow = tube('M -0.5 0 L 0.5 0 M 0.25 -0.22 L 0.5 0 L 0.25 0.22', 30, 2.2, 400, -351, flat('#111111'), 'Arrow');
      const dl = words('DOWNLOAD', 'space-grotesk', 18, 480, -350, flat('#111111'), 'Download', undefined, 0.04);
      return [brand, badge, eyes, arrow, dl, foam, blob, y, two, k, star, flower, caption];
    })(),
    solid('#ebebec', 0.12),
  ),
  scene(
    'Animated · Inflatable',
    'Inflated pool-toy tubes over thin black type, in Inflatable vinyl: a pinched "#" wiping off and drawing back on, a pink arrow, a ringed silver star whose pinch breathes',
    (() => {
      const title = words('INFLATABLE\nABSTRACT', 'inter', 158, 0, -10, flat('#0a0a0a'), 'Title', undefined, -0.035, 0.9);
      const hash = tube('M -0.16 -0.46 L -0.16 0.46 M 0.16 -0.46 L 0.16 0.46 M -0.46 -0.15 L 0.46 -0.15 M -0.46 0.17 L 0.46 0.17', 270, 46, -440, -215, vinyl('#4dff2e', '#0e8f1a', { rings: 2, ringGap: 40, pinch: 0.5, shadow: 0.25 }), 'Hash', { period: 4 });
      hash.rotation = -10;
      // Wipes back to its first bar, never quite gone.
      hash.animate![lineAnimKey('end')].to = 0.25;
      const arrow = tube('M -0.42 0.5 L -0.42 0 C -0.42 -0.12 -0.36 -0.16 -0.2 -0.16 L 0.18 -0.16', 330, 44, -400, 230, vinyl('#ff5ec4', '#b0106e', { shadow: 0.25 }), 'Arrow');
      const head = shape('polygon', 150, -290, 177, vinyl('#ff7a2e', '#c23a00', { bevel: 60, seam: 0.5, shadow: 0.25 }), 'Arrow head', { sides: 3, rounding: 0.18 });
      head.rotation = 90;
      const arrowSet = group([arrow, head], { name: 'Arrow', motion: newMotion({ loop: 'float', amount: 10, period: 2 }) });
      const star = shape('sparkle', 240, 430, -230, vinyl('#e9ecf2', '#5d6474', { rings: 1, ringGap: 30, pinch: 0.7, through: 0.2, shadow: 0.3 }), 'Silver star', { pinch: 0.45 }, { loop: 'pulse', amount: 12, period: 2 });
      star.style.animate = { pinch: anim(0.2, 2, 'swing') };
      const wave = tube('M -0.5 0 L 0.5 0', 360, 36, 370, 270, vinyl('#3d6bff', '#1b2fb0', { wrinkles: 0.5, shadow: 0.25 }), 'Blue wave', { period: 4, phase: 0.4 });
      if (wave.content.type === 'line') wave.content.squiggle = { kind: 'zigzag', amplitude: 30, spacing: 46, smooth: 1, round: 0, loops: 1.2, perSegment: false, flatEnds: false, flip: false };
      const tag = shape('roundRect', 200, 270, 165, { ...flat('#86ff4a'), stroke: stroke(3, '#0a0a0a', 'inside') }, 'Tag', { radius: 0.16, aspect: 2.6 });
      const vol = words('VOL.2', 'inter', 50, 270, 163, flat('#0a0a0a'), 'Vol', undefined, -0.02);
      const tagSet = group([tag, vol], { name: 'Vol tag', motion: newMotion({ enter: 'grow', distance: 0, delay: 0.3, transition: feel('Bouncy', 0.6), loop: 'sway', amount: 4, period: 2 }) });
      [tag, vol].forEach((c) => (c.rotation = -7));
      const top = words('Inflatable vol.2  /  For Figma & Blender', 'space-grotesk', 18, 0, -360, flat('#0a0a0a'), 'Top line', undefined, 0.02);
      return [top, title, wave, hash, arrowSet, star, tagSet];
    })(),
    solid('#fbfbfb'),
  ),
  scene(
    'Animated · Global trend',
    'A pixel-glitch night poster: heavy type shedding and gathering pixel debris (a Glitch whose Debris and Tear move), italic outline type, glowing clouds and stars',
    (() => {
      const glitchy = (s: string, y: number, seed: number, phase: number) => {
        const w = words(s, 'archivo', 196, 0, y, flat('#ffffff'), s, undefined, -0.01);
        w.modifiers = mods({ kind: 'glitch', amount: 0.12, size: 0.065, spread: 0.32, shift: 0, bands: 0.09, seed });
        const uid = w.modifiers[0].uid;
        w.animate = { [`mod:${uid}:amount`]: anim(0.6, 4, 'hold', phase), [`mod:${uid}:shift`]: anim(0.07, 2, 'flicker', phase) };
        return w;
      };
      const outline = (s: string, y: number, motion?: Partial<Motion>) => {
        const w = words(s, 'inter-black', 150, 0, y, flat('#ffffff'), s, motion, 0.02);
        w.modifiers = mods({ kind: 'slant', angle: 14 }, { kind: 'outline', width: 0.016 });
        return w;
      };
      const glow = (c: string, core: string) => style('glow', { edge: c, mid: c, core, inside: 90, curve: 1.4, out1: c, out2: c, outside: 60, outAmount: 0.75, outMix: 0.8, grain: 0.25 });
      const cloudA = shape('cloud', 220, -320, 10, glow('#ff9d1a', '#ffd08a'), 'Orange cloud', { puffs: 3, seed: 2 }, { loop: 'float', amount: 14, period: 4 });
      const cloudB = shape('cloud', 260, 330, 40, glow('#c8ff2a', '#f2ffc0'), 'Lime cloud', { puffs: 4, seed: 5 }, { loop: 'float', amount: 14, period: 4, phase: 0.5 });
      const starR = shape('star', 170, -420, 130, glow('#ff3b3b', '#ffb0a8'), 'Red star', { points: 8, inner: 0.36, rounding: 0 }, { loop: 'pulse', amount: 14, period: 2 });
      const starB = shape('star', 90, 200, -60, glow('#3b4bff', '#b8c0ff'), 'Blue star', { points: 6, inner: 0.4, rounding: 0 }, { loop: 'pulse', amount: 20, period: 2, phase: 0.5 });
      [cloudA, cloudB, starR, starB].forEach((n) => (n.style.animate = { outAmount: anim(1.1, 2, 'swing', n.motion?.phase ?? 0) }));
      const foot = words('PRESERVING THE LOCAL CULTURE  /  BRINGING THE GLOBAL VIBE', 'space-grotesk', 15, 0, 365, flat('#ffffff'), 'Footer', undefined, 0.06);
      return [cloudA, cloudB, starR, starB, glitchy('GLOBAL', -250, 3, 0), outline('TREND', -110), glitchy('LOCAL', 150, 9, 0.5), outline('STYLE', 290), foot];
    })(),
    background(fill('solid', '#050505'), { grain: 0.35 }),
  ),
  scene(
    'Animated · Pixel badge',
    'Script words (from the proverb sạch / rách) on stepped pixel badges that break apart and build back: Pixel badge (Weight + Pixels) whose Dissolve moves, with a black stroke',
    (() => {
      const badge = (s: string, x: number, y: number, c: string, angle: number, phase: number): Node[] => {
        const back = words(s, 'pacifico', 210, x, y, { ...flat(c), stroke: stroke(4, '#0a0a0a', 'outside') }, `${s} badge`);
        back.modifiers = mods({ kind: 'weight', amount: 0.14 }, { kind: 'pixelate', size: 0.075, shape: 'square', gap: 0, dissolve: 0, angle, seed: 2 });
        back.animate = { [`mod:${back.modifiers[1].uid}:dissolve`]: anim(1, 4, 'hold', phase) };
        const ink = words(s, 'pacifico', 210, x, y, flat('#0a0a0a'), s);
        return [back, ink];
      };
      const cho = (x: number, y: number) => words('CHO', 'inter-black', 44, x, y, flat('#0a0a0a'), 'Cho', undefined, 0.04);
      const tiny = (s: string, x: number, y: number) => words(s, 'space-grotesk', 15, x, y, flat('#0a0a0a'), s, undefined, 0.08);
      return [
        ...badge('Sạch', -150, -150, '#2fe07a', 90, 0),
        ...badge('Rách', 170, 170, '#ff8fd6', 270, 0.3),
        cho(150, -230),
        cho(-180, 250),
        tiny('STEPPED PIXEL BADGES', -430, -350),
        tiny('NO. 09  |  [ PX ]', 480, -350),
      ];
    })(),
    solid('#e6e6e3', 0.15),
  ),
  scene(
    'Animated · Tube burst',
    'A burst of soft green tubes growing out from the middle, one after another (Line › End on each), turning slowly beside big thin type',
    (() => {
      const lime = puffy('#a8e63c', '#4d8a12', { bevel: 21, gloss: 0.55, rimTint: 0.15, shadow: 0.35, shadowOffset: 14 });
      const n = 16;
      const spokes = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + 0.2 * Math.sin(i * 2.3);
        const len = 0.28 + 0.2 * (0.5 + 0.5 * Math.sin(i * 1.7 + 0.4));
        const [x, y] = [Math.cos(a) * len, Math.sin(a) * len * 0.82];
        const t = tube(`M 0 0 L ${x.toFixed(3)} ${y.toFixed(3)}`, 520, 40 + (i % 3) * 3, 0, 0, lime, `Tube ${i + 1}`, { period: 4, phase: ((i * 7) % n) * 0.012 });
        t.animate![lineAnimKey('end')].to = 0.12;
        return t;
      });
      const burst = group(spokes, { name: 'Burst', motion: newMotion({ loop: 'spin', amount: 1, period: 16 }) });
      spokes.forEach((c) => ((c.x = -300), (c.y = -20)));
      const title = words('flat-e', 'inter', 300, 230, -60, flat('#ffffff'), 'Title', undefined, -0.04);
      const line = words('{ aims to create }', 'inter', 52, 120, 250, flat('#ffffff'), 'Tagline', undefined, -0.01);
      const under = tube('M -0.5 0 L 0.5 0', 190, 4, 170, 285, flat('#a8e63c'), 'Underline', { period: 4, phase: 0.3 });
      if (under.content.type === 'line') under.content.squiggle = { kind: 'zigzag', amplitude: 5, spacing: 16, smooth: 1, round: 0, loops: 1.2, perSegment: false, flatEnds: false, flip: false };
      const nav = words('work    about    contact', 'inter', 22, -440, -350, flat('#ffffff'), 'Nav');
      return [nav, burst, title, line, under];
    })(),
    solid('#050505'),
  ),
];
