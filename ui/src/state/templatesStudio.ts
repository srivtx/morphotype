// Templates measured on reference pictures and built from the studio tools:
// glow gradients, grain gradients, mosaic bricks, soft edges and pen paths.
// Paths are written in the reference's pixels and mapped onto the artboard.
import { parsePath, serializePath } from './geometry';
import { background, fill, group, lineLayer, mods, pathLayer, style, symbolLayer, textLayer, type Background, type Node, type Project, type ShapeLayer, type Style } from './model';
import type { Template } from './templates';
import type { LineCap } from '../engine/types';

const project = (name: string, layers: Node[], bg: Background, canvas: { width: number; height: number }): Project => ({ version: 2, name, canvas, layers, background: bg, fonts: [] });
const solid = (c: string) => background(fill('solid', c));
const ink = (c: string): Style => style('flat', { fill: c });

/** Maps reference pixels onto the artboard: (x, y) → ((x − ox)·k, (y − oy)·k). */
function frame(ox: number, oy: number, k: number) {
  const P = (x: number, y: number) => ({ x: (x - ox) * k, y: (y - oy) * k });
  /** A pen path (closed fills, `width` strokes it as a line), from reference path data. */
  const pen = (d: string, name: string, st: Style, width?: number, cap: LineCap = 'round', extra: Partial<ShapeLayer> = {}): ShapeLayer => {
    const cs = parsePath(d).map((c) => ({ ...c, nodes: c.nodes.map((n) => ({ ...n, ...P(n.x, n.y), hin: n.hin && P(n.hin.x, n.hin.y), hout: n.hout && P(n.hout.x, n.hout.y) })) }));
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of cs) for (const n of c.nodes) for (const p of [n, n.hin, n.hout]) if (p) (x0 = Math.min(x0, p.x)), (y0 = Math.min(y0, p.y)), (x1 = Math.max(x1, p.x)), (y1 = Math.max(y1, p.y));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const size = Math.max(1, x1 - x0, y1 - y0);
    const q = (p: { x: number; y: number }) => ({ x: (p.x - cx) / size, y: (p.y - cy) / size });
    const out = serializePath(cs.map((c) => ({ open: width !== undefined ? c.open : false, nodes: c.nodes.map((n) => ({ ...q(n), hin: n.hin && q(n.hin), hout: n.hout && q(n.hout) })) })));
    const at = { x: cx, y: cy, style: st, name, ...extra };
    return width !== undefined ? lineLayer(out, size, width * k, at, cap) : pathLayer(out, size, name, at);
  };
  /** A rounded rectangle from its reference corners; `r` is the corner radius in reference px. */
  const box = (x0: number, y0: number, x1: number, y1: number, r: number, name: string, st: Style, extra: Partial<ShapeLayer> = {}): ShapeLayer => {
    const w = (x1 - x0) * k;
    const h = (y1 - y0) * k;
    const size = Math.max(w, h);
    return symbolLayer('roundRect', size, { ...P((x0 + x1) / 2, (y0 + y1) / 2), name, style: st, ...extra }, { radius: (r * k) / size, aspect: w / h });
  };
  const text = (t: string, font: string, x: number, y: number, size: number, st: Style, name: string, extra: Partial<ShapeLayer> = {}, content: object = {}) =>
    textLayer(t, font, { ...P(x, y), name, style: st, ...extra }, { size: size * k, ...content });
  return { P, pen, box, text, k };
}

/** A tile that clips what's drawn in it (a clipping group: the tile is its bottom layer). */
const clipped = (name: string, art: Node[], tile: ShapeLayer): Node => group([tile, ...art], { name, clip: true });

const glowStyle = (p: Record<string, number | string>) => style('glow', { edge: '#000000', mid: '#000000', core: '#000000', inside: 0, outside: 0, grain: 0.06, ...p });

export const STUDIO_TEMPLATES: Template[] = [
  {
    name: 'Glow widgets',
    hint: 'Status tiles lit from the edges: glow gradients inside and around simple shapes',
    category: 'Social',
    make: () => {
      const { pen, box, text, k } = frame(321.5, 321.5, 2);
      const tile = (x0: number, y0: number, x1: number, y1: number) => box(x0, y0, x1, y1, 30, 'Tile', ink('#000000'));
      const label = (t: string, x: number, y: number, align = 'center') => text(t, 'inter', x, y, 13, ink('#8e8e93'), 'Label', {}, { align, lineHeight: 1.15 });
      return project(
        'Glow widgets',
        [
          clipped('Attention', [pen('M246 -150L447 -150L536 168C548 205 532 228 492 228L150 228C110 228 94 205 106 168Z', 'Light', glowStyle({ edge: '#f8b800', mid: '#5c1a06', core: '#000000', inside: 90 * k, curve: 0.7 }))], tile(18, 18, 626, 312)),
          label('Attention', 320, 270),
          clipped(
            'Done',
            [
              pen('M-20 370L140 560L340 360', 'Teal light', { ...ink('#0a6670'), soften: 70 * k, opacity: 0.9 }, 120),
              pen('M-20 400L140 590L340 390', 'Green light', { ...ink('#14b257'), soften: 38 * k }, 70),
            ],
            tile(18, 333, 312, 626),
          ),
          label('Done', 256, 578),
          clipped('Water balance', [pen('M478 436C486 470 520 486 545 520C570 555 578 600 575 660L380 660C377 600 386 555 411 520C436 486 470 470 478 436Z', 'Drop', glowStyle({ outside: 62 * k, out1: '#1f8bff', out2: '#4b2bd0', outAmount: 1 }))], tile(333, 333, 626, 626)),
          label('Water\nbalance', 393, 382, 'left'),
        ],
        solid('#1c1c1e'),
        { width: 1286, height: 1286 },
      );
    },
  },
  {
    name: 'Health widgets',
    hint: 'Glowing health tiles: a lit half disc, soft light arcs, a charging bolt and a heart',
    category: 'Social',
    make: () => {
      const { pen, box, text, k } = frame(600, 600, 1);
      const tile = (x0: number, y0: number, x1: number, y1: number) => box(x0, y0, x1, y1, 75, 'Tile', ink('#000000'));
      const label = (t: string, x: number, y: number) => text(t, 'inter', x, y, 26, ink('#9a9a9e'), 'Label');
      const tall = () => tile(35, 35, 582, 1165);
      return project(
        'Health widgets',
        [
          clipped(
            'Bioimpedance',
            [
              pen('M20 520Q308 780 600 520', 'Teal haze', { ...ink('#0b4f6a'), soften: 70 }, 150),
              pen('M20 540Q308 790 600 540', 'Teal arc', { ...ink('#16c49a'), soften: 26 }, 46),
              pen('M20 780Q308 980 600 780', 'Violet haze', { ...ink('#2a1a6e'), soften: 80, opacity: 0.85 }, 170),
              pen('M20 860Q308 1060 600 860', 'Blue arc', { ...ink('#1f8fff'), soften: 20 }, 40),
              pen('M36 -200L580 -200L580 30C580 230 455 405 308 405C161 405 36 230 36 30Z', 'Half disc', glowStyle({ edge: '#16d24c', mid: '#0a4652', core: '#07101c', inside: 120, curve: 0.9 })),
            ],
            tall(),
          ),
          label('Bioimpedance', 308, 1088),
          clipped('Charger', [pen('M560 -40L885 -40L822 305L962 308L880 640L560 640Z', 'Bolt edge', glowStyle({ outside: 340, out1: '#ffd60a', out2: '#1e8a1a', outMix: 0.28, outAmount: 1 }))], tile(620, 35, 1165, 582)),
          label('Charger', 738, 505),
          clipped('Heart rate', [symbolLayer('heart', 800 * k, { x: 1110 - 600, y: 1010 - 600, name: 'Heart', style: glowStyle({ outside: 230, out1: '#ff4646', out2: '#c41f6c', outMix: 0.5, outAmount: 1 }) })], tile(620, 618, 1165, 1165)),
          label('Heart rate', 940, 918),
        ],
        solid('#1f1f1f'),
        { width: 1200, height: 1200 },
      );
    },
  },
  {
    name: 'Grain spheres',
    hint: 'Soft spheres in three-colour gradients, dissolved into film grain',
    category: 'Social',
    make: () => {
      const { P, k } = frame(540, 540, 1);
      const sphere = (x: number, y: number, r: number, lit: string, body: string, dark: string, angle: number, spread: number, name: string) =>
        symbolLayer('circle', r * 2 * k, { ...P(x, y), name, style: style('grainy', { lit, body, dark, lightAngle: angle, spread, grain: 0.5, grainSize: 1.3, edgeGrain: 0.3, bevel: r * 1.1, softness: r * 0.15 }) });
      return project(
        'Grain spheres',
        [
          sphere(438, 800, 162, '#ff8ad8', '#ff6a8a', '#3b8dff', -80, 1.6, 'Blue sphere'),
          sphere(528, 528, 250, '#ff90e6', '#ff5a4f', '#ff4f48', -25, 1.1, 'Red sphere'),
          sphere(332, 325, 188, '#ff8ee6', '#ff6450', '#1f9e44', -35, 1.8, 'Green sphere'),
          sphere(822, 822, 128, '#ff8ee6', '#ff9a66', '#f2b400', -60, 1.3, 'Yellow sphere'),
        ],
        solid('#e2e2e0'),
        { width: 1080, height: 1080 },
      );
    },
  },
  {
    name: 'Tetris card',
    hint: 'A colour-chip card of soft-edged falling blocks',
    category: 'Print',
    make: () => {
      const { P, box, text, k } = frame(367.5, 473.5, 1.5);
      // Colours of the 9 × 8 grid, sampled from the picture.
      const C: Record<string, string> = { y: '#ffb800', o: '#ff5d08', l: '#1f95ff', b: '#2a2feb', g: '#44d412', r: '#ff001e', p: '#ff5db1', n: '#b57b32' };
      const grid = ['yoolllggr', 'yyobbbgrr', 'ypnbnyynn', 'ppnnnyynp', 'pooplllpp', 'borppoopr', 'brrrpoyyn', 'bbggggyyn'];
      const cell = 51.78;
      const x0 = 117;
      const y0 = 163;
      const layers: Node[] = [];
      for (const key of Object.keys(C)) {
        let d = '';
        grid.forEach((row, j) =>
          [...row].forEach((c, i) => {
            if (c !== key) return;
            const a = P(x0 + i * cell - 0.6, y0 + j * 52.1 - 0.6);
            const s = (cell + 1.2) * k;
            d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}h${s.toFixed(1)}v${s.toFixed(1)}h${(-s).toFixed(1)}Z`;
          }),
        );
        if (!d) continue;
        const cs = parsePath(d);
        let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const c of cs) for (const n of c.nodes) (bx0 = Math.min(bx0, n.x)), (by0 = Math.min(by0, n.y)), (bx1 = Math.max(bx1, n.x)), (by1 = Math.max(by1, n.y));
        const cx = (bx0 + bx1) / 2;
        const cy = (by0 + by1) / 2;
        const size = Math.max(bx1 - bx0, by1 - by0);
        const q = (p: { x: number; y: number }) => ({ x: (p.x - cx) / size, y: (p.y - cy) / size });
        layers.push(pathLayer(serializePath(cs.map((c) => ({ nodes: c.nodes.map((n) => ({ ...n, ...q(n) })) }))), size, `Blocks ${key}`, { x: cx, y: cy, style: { ...ink(C[key]), soften: 3 } }));
      }
      return project(
        'Tetris card',
        [
          box(100, 148, 600, 798, 0, 'Card', ink('#fbf1df')),
          group(layers, { name: 'Blocks' }),
          text('PANTONE', 'inter-black', 280, 637, 62, ink('#0b0b0b'), 'Title', {}, { tracking: -0.04 }),
          text('Tetris', 'inter', 156, 685, 22, ink('#0b0b0b'), 'Name', { modifiers: mods({ kind: 'weight', amount: 0.012 }) }),
          text('Game Boy', 'inter', 167, 763, 16, ink('#0b0b0b'), 'Note', { modifiers: mods({ kind: 'weight', amount: 0.012 }) }),
        ],
        solid('#000000'),
        { width: 1102, height: 1420 },
      );
    },
  },
  {
    name: 'Brick icons',
    hint: 'Six icons filled with toy-brick mosaics: silhouettes with the Mosaic material',
    category: 'Icon',
    make: () => {
      const { P, pen, box, k } = frame(600, 600, 0.9);
      const R = '#f22d1b';
      const Y = '#ffd200';
      const B = '#1f8fe8';
      const G = '#0f9f55';
      const W = '#ffffff';
      const mosaic = (seed: number, cell = 30, wide = 1): Style => style('mosaic', { cell: cell * k, wide, bricks: 0.85, gap: 0, round: 0, c1: R, c2: Y, c3: B, c4: G, c5: W, c6: '#62c3ff', seed });
      const dotColors = [Y, B, R, R, R, G, G, Y, R, R, W, B];
      const dots: Node[] = dotColors.map((c, i) => symbolLayer('circle', 27 * k, { ...P(557 + (i % 3) * 43, 845 + Math.floor(i / 3) * 37), name: 'Key', style: ink(c) }));
      const car = (y: number, seed: number, name: string) =>
        group(
          [
            pen(`M893 ${y}L1025 ${y}L1050 ${y + 22}L1081 ${y + 22}L1081 ${y + 58}L836 ${y + 58}L836 ${y + 22}L868 ${y + 22}Z`, 'Body', mosaic(seed, 13, 5)),
            box(870, y + 58, 905, y + 76, 0, 'Wheel', ink(R)),
            box(1010, y + 58, 1045, y + 76, 0, 'Wheel', ink(B)),
          ],
          { name },
        );
      return project(
        'Brick icons',
        [
          group([pen('M224 160L246 160L246 185L262 185L262 210L295 235L295 545L177 545L177 235L210 210L210 185L224 185Z', 'Bottle', mosaic(3)), box(200, 210, 272, 236, 0, 'Shoulder', ink(W)), box(224, 160, 246, 185, 0, 'Cap', ink(R))], { name: 'Bottle' }),
          group(
            [
              pen('M455 322L560 300L582 390L520 392C490 392 465 360 455 322Z', 'Leaf', mosaic(11, 20)),
              pen('M740 322L635 300L613 390L675 392C705 392 730 360 740 322Z', 'Leaf', mosaic(12, 20)),
              symbolLayer('circle', 40 * k, { ...P(598, 205), name: 'Petal', style: ink(W) }),
              symbolLayer('circle', 40 * k, { ...P(572, 232), name: 'Petal', style: ink(B) }),
              symbolLayer('circle', 40 * k, { ...P(625, 232), name: 'Petal', style: ink(R) }),
              symbolLayer('circle', 40 * k, { ...P(598, 258), name: 'Petal', style: ink(Y) }),
              symbolLayer('circle', 22 * k, { ...P(560, 195), name: 'Bud', style: ink(G) }),
              box(577, 280, 620, 330, 0, 'Stalk', mosaic(14, 22)),
              box(583, 390, 612, 455, 0, 'Stem', ink(Y)),
              box(525, 452, 672, 495, 0, 'Pot', ink('#4fb3ff')),
              box(545, 495, 655, 535, 0, 'Pot base', ink(R)),
            ],
            { name: 'Plant' },
          ),
          group([pen('M880 262L918 200L1070 200L1070 262L1070 512L880 512Z', 'Carton', mosaic(21)), box(958, 413, 1040, 482, 6, 'Label', ink('#111111')), box(970, 428, 1028, 436, 3, 'Line', ink(Y)), box(970, 445, 1028, 453, 3, 'Line', ink(R)), box(970, 462, 1028, 470, 3, 'Line', ink(Y))], { name: 'Milk' }),
          group([box(120, 758, 362, 930, 0, 'Screen', mosaic(31)), box(82, 952, 400, 975, 0, 'Base', mosaic(32, 23, 2))], { name: 'Laptop' }),
          group([box(524, 712, 680, 983, 14, 'Calculator', mosaic(41, 20)), box(540, 735, 664, 818, 0, 'Face', ink('#000000')), box(553, 750, 618, 770, 0, 'Screen', ink(W)), box(630, 750, 648, 770, 0, 'Key', ink(Y)), box(540, 830, 664, 965, 0, 'Pad', ink('#000000')), ...dots], { name: 'Calculator' }),
          group([car(718, 51, 'Car 1'), car(808, 52, 'Car 2'), car(900, 53, 'Car 3')], { name: 'Cars' }),
        ],
        solid('#000000'),
        { width: 1080, height: 1080 },
      );
    },
  },
  {
    name: 'Object words',
    hint: 'Rounded type where letters are swapped for objects: a toggle, a screw, a glass bubble, sticker tiles',
    category: 'Type',
    make: () => {
      const { P, box, text, k } = frame(472.5, 602, 1.2);
      const white = { ...ink('#ffffff'), modifiers: mods({ kind: 'round', radius: 0.01 }) };
      const word = (t: string, x: number, y: number, name: string) => text(t, 'inter', x, y, 212, white, name, { modifiers: white.modifiers }, { tracking: -0.01 });
      const tilt = (n: ShapeLayer, deg: number) => ((n.rotation = deg), n);
      return project(
        'Object words',
        [
          word('Ab', 281, 237, 'Ab'),
          group(
            [
              box(418, 197, 605, 318, 60, 'Track', ink('#7cf27a')),
              symbolLayer('circle', 112 * k, { ...P(479, 258), name: 'Knob', style: style('inflate', { body: '#ffffff', shade: '#c9d3cf', bevel: 40, gloss: 0.2, shadow: 0.35, shadowOffset: 6, shadowSoft: 14 }) }),
            ],
            { name: 'Toggle' },
          ),
          word('ut', 699, 237, 'ut'),
          word('W', 320, 465, 'W'),
          group(
            [
              symbolLayer('pill', 70 * k, { ...P(478, 520), rotation: 90, name: 'Thread', style: style('inflate', { body: '#7a7a7a', shade: '#2a2a2a', bevel: 30, gloss: 0.5, shadow: 0 }) }, { aspect: 1.5 }),
              symbolLayer('circle', 124 * k, { ...P(478, 460), name: 'Head', style: style('inflate', { body: '#d6d6d6', shade: '#4a4a4a', bevel: 70, gloss: 0.8, shadow: 0 }) }),
              symbolLayer('star', 56 * k, { ...P(478, 454), name: 'Torx', style: style('inflate', { body: '#3b3b3b', shade: '#0a0a0a', bevel: 10, gloss: 0.3, shadow: 0 }) }, { points: 6, inner: 0.62, rounding: 0.12 }),
            ],
            { name: 'Screw' },
          ),
          word('rk', 632, 465, 'rk'),
          word('T', 266, 690, 'T'),
          group(
            [
              text('a', 'inter', 392, 704, 190, white, 'a', { modifiers: white.modifiers }),
              symbolLayer('bubble', 182 * k, { ...P(394, 702), name: 'Glass bubble', style: style('lens', { refraction: 1.2, dispersion: 0.6, magnify: 0.15, tint: '#000000', tintAmount: 0.62, rim: 1.6, highlight: 1.4, film: 0.4, iridescence: 0, bevel: 60, softness: 14 }) }, { tail: 0.35, roundness: 0.85 }),
            ],
            { name: 'Glass bubble' },
          ),
          word('lks', 603, 690, 'lks'),
          word('F', 290, 905, 'F'),
          group(
            [
              tilt(box(322, 860, 470, 1012, 4, 'Red tile', { ...ink('#f2352b'), stroke: { width: 1.5, color: '#ff9a92', align: 'inside', opacity: 0.8 } }), -4),
              tilt(text('e', 'rubik-mono', 396, 936, 105, ink('#0a0a0a'), 'Heavy e', { modifiers: mods({ kind: 'weight', amount: 0.03 }) }), -4),
              tilt(box(458, 858, 607, 1010, 4, 'Green tile', { ...ink('#4cae4f'), stroke: { width: 1.5, color: '#b6e8b4', align: 'inside', opacity: 0.8 } }), 5),
              tilt(text('e', 'caveat', 532, 922, 190, ink('#c9ff3d'), 'Script e', { modifiers: mods({ kind: 'weight', amount: 0.025 }) }), 5),
            ],
            { name: 'Sticker tiles' },
          ),
          word('d', 651, 905, 'd'),
        ],
        solid('#0a0a0a'),
        { width: 1134, height: 1445 },
      );
    },
  },
  {
    name: 'Keycap tower',
    hint: 'Four 3D keycaps stacked on a sky: the Keycap material, one translucent',
    category: 'Social',
    make: () => {
      const { box, text, pen, k } = frame(522, 602, 1080 / 1044);
      const cap = (y0: number, color: string, bounce: string, name: string, extra: Record<string, number | string> = {}) =>
        box(400, y0, 633, y0 + 240, 34, name, style('keycap', { color, bounce, sky: '#8fb6dc', wall: 38 * k, tilt: 0.45, tiltX: -0.35, topRound: 46 * k, dish: 0.8, rise: 50, lightAngle: -130, light: 1, gloss: 0.6, rimLight: 1, shadow: 0.35, ...extra }));
      const hand = { ...ink('#fdf8ec'), stroke: { width: 3.6 * k, color: '#141414', align: 'outside' as const, opacity: 1 } };
      return project(
        'Keycap tower',
        [
          cap(95, '#eef0f3', '#ff8a2a', 'go key'),
          text('go', 'archivo', 503, 210, 56, ink('#111111'), 'go'),
          group([box(500, 365, 535, 560, 6, 'Stem', ink('#b82400')), box(470, 445, 565, 470, 6, 'Stem cross', ink('#b82400'))], { name: 'Stem (seen through the key)' }),
          cap(345, '#ff7f12', '#ffb36b', 'create key', { translucent: 0.85, gloss: 0.8 }),
          text('create!', 'inter', 533, 470, 40, ink('#ffffff'), 'create', { modifiers: mods({ kind: 'weight', amount: 0.012 }) }),
          cap(595, '#eef0f3', '#8ee03a', 'pollen key'),
          text('pollen.', 'archivo', 502, 718, 44, ink('#111111'), 'pollen', {}, { tracking: -0.03 }),
          cap(845, '#a8e83a', '#7fd0ff', 'peace key'),
          // Measured on the picture: the palm and V fingers are one outlined shape;
          // the folded fingers and the thumb sit on top, each with its own outline.
          group(
            [
              group(
                [
                  pen('M530 918L542 962', 'Index finger', ink('#fdf8ec'), 15),
                  pen('M558 922L543 965', 'Middle finger', ink('#fdf8ec'), 15),
                  symbolLayer('circle', 52 * k, { x: (527 - 522) * k, y: (988 - 602) * k, name: 'Palm' }),
                ],
                { name: 'Hand', merge: true, style: hand },
              ),
              pen('M507 950L498 978', 'Ring finger', hand, 13),
              pen('M520 956L513 983', 'Little finger', hand, 13),
              pen('M511 978L551 988', 'Thumb', hand, 14),
            ],
            { name: 'Peace hand' },
          ),
        ],
        background({ ...fill('linear', '#2a84c6', '#78b6e6'), angle: 180 }),
        { width: 1080, height: 1246 },
      );
    },
  },
  {
    name: 'Macro keypad',
    hint: 'A cream macro pad with nine keycaps, a pixel screen and a dial',
    category: 'Social',
    make: () => {
      const { P, box, text, k } = frame(481, 602, 1080 / 962);
      const outline = { width: 2.5, color: '#2a1d16', align: 'outside' as const, opacity: 1 };
      const key = (i: number, j: number, color: string, side: string, name: string, extra: Record<string, number> = {}) => {
        const x0 = 229 + i * 174;
        const y0 = 425 + j * 173;
        return { ...box(x0, y0, x0 + 165, y0 + 165, 22, name, { ...style('keycap', { color, bounce: side, sky: '#fff6e8', wall: 24 * k, tilt: 0.5, tiltX: 0, topRound: 26 * k, dish: 0.6, rise: 34, lightAngle: -120, gloss: 0.5, rimLight: 0.6, shadow: 0.25, ...extra }), stroke: outline }) };
      };
      const label = (t: string, i: number, j: number) => [
        text('P', 'inter', 285 + i * 174, 484 + j * 173, 16, ink('#1a1a1a'), 'P'),
        text(t, 'inter', 309 + i * 174, 513 + j * 173, 52, ink('#1a1a1a'), t),
      ];
      const ctr = (i: number, j: number) => P(311 + i * 174, 503 + j * 173);
      return project(
        'Macro keypad',
        [
          box(197, 182, 775, 970, 40, 'Body', style('keycap', { color: '#efe6d4', bounce: '#fff3dc', sky: '#fff8ec', wall: 12 * k, tilt: 0.15, tiltX: 0, topRound: 34 * k, dish: 0.05, rise: 14, gloss: 0.3, rimLight: 0.4, shadow: 0.5 })),
          box(186, 430, 200, 548, 6, 'Side button', ink('#4a74e8')),
          box(157, 608, 198, 688, 10, 'Side knob', style('keycap', { color: '#efe6d4', bounce: '#fff3dc', sky: '#fff8ec', wall: 8, tilt: 0, tiltX: 0, topRound: 8, dish: 0.1, rise: 10, shadow: 0.2 })),
          box(203, 207, 613, 397, 16, 'Screen', ink('#1d1d1d')),
          text('CORRECT MY ENGLISH\nAND MAKE MY LANGUAGE\nMORE POLITE\n_', 'silkscreen', 237, 296, 24, ink('#f2f2ea'), 'Screen text', {}, { align: 'left', lineHeight: 1.2 }),
          text('P2', 'silkscreen', 250, 366, 12, ink('#d97a52'), 'Page'),
          text('0', 'silkscreen', 570, 366, 12, ink('#3fd06a'), 'Count'),
          symbolLayer('circle', 18 * k, { ...P(657, 380), name: 'LED', style: style('inflate', { body: '#18a84a', shade: '#065a22', bevel: 8, gloss: 0.6, shadow: 0 }) }),
          symbolLayer('circle', 212 * k, { ...P(752, 272), name: 'Dial', style: style('keycap', { color: '#f2ead9', bounce: '#fff3dc', sky: '#fff8ec', wall: 14 * k, tilt: 0, tiltX: 0, topRound: 200, dish: 0.25, rise: 20, gloss: 0.3, shadow: 0.5 }) }),
          symbolLayer('ring', 178 * k, { ...P(752, 272), name: 'Light ring', style: { ...ink('#4c47ff'), soften: 1.5 } }, { thickness: 0.035 }),
          symbolLayer('roundRect', 70 * k, { ...P(745, 268), rotation: 30, name: 'Logo', style: { ...ink('#f2ead9'), stroke: { width: 3, color: '#111111', align: 'center', opacity: 1 } } }, { radius: 0.3, aspect: 0.55 }),
          symbolLayer('roundRect', 70 * k, { ...P(762, 278), rotation: 30, name: 'Logo', style: { ...ink('#f2ead9'), stroke: { width: 3, color: '#111111', align: 'center', opacity: 1 } } }, { radius: 0.3, aspect: 0.55 }),
          key(0, 0, '#f6f6f8', '#cfd2dc', 'US key'),
          group([0, 1, 2, 3, 4].map((r) => box(276, 487 + r * 7, 342, 490 + r * 7, 0, 'Stripe', ink('#e0202e'))).concat([box(276, 487, 302, 504, 0, 'Canton', ink('#1f3fa8'))]), { name: 'US flag' }),
          key(1, 0, '#f6dcd6', '#e3b7ae', 'Key 2'),
          ...label('2', 1, 0),
          key(2, 0, '#e8c2ef', '#c99bd2', 'Key 3'),
          ...label('3', 2, 0),
          key(0, 1, '#2066ea', '#0d3fb5', 'Smile key'),
          symbolLayer('circle', 44 * k, { ...ctr(0, 1), name: 'Smile', style: style('inflate', { body: '#ffd23a', shade: '#e09a00', bevel: 18, gloss: 0.5, shadow: 0 }) }),
          key(1, 1, '#ffe414', '#e8b800', 'Bug key'),
          symbolLayer('circle', 40 * k, { ...ctr(1, 1), name: 'Ladybug', style: ink('#f0463c') }),
          key(2, 1, '#f6f6f8', '#cfd2dc', 'Japanese key'),
          symbolLayer('circle', 46 * k, { ...ctr(2, 1), name: 'Sun', style: ink('#ff0a0a') }),
          key(0, 2, '#21b33c', '#0f7d23', 'Brazil key'),
          symbolLayer('roundRect', 52 * k, { ...ctr(0, 2), rotation: 45, sy: 0.55, name: 'Diamond', style: ink('#ffe414') }, { radius: 0.05, aspect: 1 }),
          symbolLayer('circle', 20 * k, { ...ctr(0, 2), name: 'Globe', style: ink('#26a7e8') }),
          key(1, 2, '#f6cfb2', '#e3a985', 'Key 8'),
          ...label('8', 1, 2),
          key(2, 2, '#f2867a', '#d05d52', 'Key 9'),
          ...label('9', 2, 2),
        ],
        solid('#000000'),
        { width: 1080, height: 1352 },
      );
    },
  },
  {
    name: 'Pixel word',
    hint: 'A wordmark whose X is built from pixels',
    category: 'Logo',
    make: () => {
      const { P, k } = frame(320, 320, 1080 / 640);
      const px = 14.4;
      const cells: [number, number][] = [[0, 0], [4, 0], [1, 1], [3, 1], [2, 2], [1, 3], [3, 3], [0, 4], [4, 4]];
      const x0 = 263;
      const y0 = 288;
      return project(
        'Pixel word',
        [
          textLayer('PI', 'inter', { ...P(212, 322), name: 'PI', style: ink('#0b0b0b'), modifiers: mods({ kind: 'weight', amount: 0.024 }) }, { size: 94 * k, tracking: 0.06 }),
          group(
            cells.map(([i, j]) => symbolLayer('roundRect', px * k, { ...P(x0 + (i + 0.5) * px, y0 + (j + 0.5) * px * (68 / 72)), name: 'Pixel', style: ink('#0b0b0b') }, { radius: 0, aspect: 1 })),
            { name: 'X pixels', merge: true, style: ink('#0b0b0b') },
          ),
          textLayer('EL', 'inter', { ...P(406, 322), name: 'EL', style: ink('#0b0b0b'), modifiers: mods({ kind: 'weight', amount: 0.024 }) }, { size: 94 * k, tracking: 0.06 }),
        ],
        solid('#d4d5d8'),
        { width: 1080, height: 1080 },
      );
    },
  },
  {
    name: 'Creative mode',
    hint: 'A flat isometric switch poster with outlines, drawn with the pen',
    category: 'Print',
    make: () => {
      const { pen, box, text } = frame(400, 400, 1.5);
      const line = { width: 3, color: '#1b1b1b', align: 'center' as const, opacity: 1 };
      const outlined = (c: string): Style => ({ ...ink(c), stroke: line });
      return project(
        'Creative mode',
        [
          box(128, 35, 672, 765, 0, 'Frame', ink('#1e1e1e')),
          box(142, 48, 658, 752, 0, 'Paper', ink('#ece5cf')),
          text('CREATIVE', 'archivo', 400, 110, 112, ink('#161616'), 'Title', { sx: 0.74 }, { tracking: -0.02 }),
          text('MODE', 'archivo', 400, 204, 112, ink('#161616'), 'Title', { sx: 0.74 }, { tracking: -0.02 }),
          box(183, 262, 617, 722, 14, 'Panel', outlined('#0f9a4c')),
          pen('M270 368L310 345L537 345L497 368Z', 'Box top', outlined('#f6c300')),
          pen('M497 368L537 345L537 618L497 640Z', 'Box side', outlined('#e5601a')),
          pen('M270 368L497 368L497 640L270 640Z', 'Box front', outlined('#e86fa6')),
          // The rocker, measured corner by corner: base, slanted front, dark side, light top.
          pen('M342 503L427 503L427 572L342 572Z', 'Switch base', outlined('#e86fa6')),
          pen('M430 432L430 500L427 503L427 432Z', 'Side shadow', ink('#2a1420')),
          pen('M408 418L427 432L427 503L393 446Z', 'Rocker side', outlined('#d9468a')),
          pen('M308 446L393 446L427 503L342 503Z', 'Rocker front', outlined('#e66fa4')),
          pen('M324 418L408 418L393 446L308 446Z', 'Rocker top', outlined('#e9b6c9')),
          text('ON', 'inter', 372, 403, 21, ink('#1b1b1b'), 'On'),
          text('OFF', 'inter', 372, 619, 21, ink('#1b1b1b'), 'Off'),
        ],
        solid('#d9dce6'),
        { width: 1200, height: 1200 },
      );
    },
  },
];
