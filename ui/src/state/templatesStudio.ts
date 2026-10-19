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
          text('CREATIVE', 'archivo', 392, 116, 96, ink('#161616'), 'Title', { sx: 0.78 }, { tracking: -0.02 }),
          text('MODE', 'archivo', 392, 192, 96, ink('#161616'), 'Title', { sx: 0.78 }, { tracking: -0.02 }),
          box(183, 262, 617, 722, 14, 'Panel', outlined('#0f9a4c')),
          pen('M266 365L297 347L527 347L497 365Z', 'Box top', outlined('#f6c300')),
          pen('M497 365L527 347L527 622L497 640Z', 'Box side', outlined('#e5601a')),
          pen('M266 365L497 365L497 640L266 640Z', 'Box front', outlined('#e86fa6')),
          pen('M335 503L415 503L415 572L335 572Z', 'Switch base', outlined('#e86fa6')),
          pen('M333 437L414 437L414 503L333 503Z', 'Rocker front', outlined('#eb7fb0')),
          pen('M348 412L398 412L414 437L333 437Z', 'Rocker top', outlined('#f3b3cf')),
          pen('M398 412L428 452L428 512L414 503L414 437Z', 'Rocker side', outlined('#d23f86')),
          text('ON', 'inter', 380, 397, 16, ink('#1b1b1b'), 'On'),
          text('OFF', 'inter', 380, 613, 16, ink('#1b1b1b'), 'Off'),
        ],
        solid('#d9dce6'),
        { width: 1200, height: 1200 },
      );
    },
  },
];
