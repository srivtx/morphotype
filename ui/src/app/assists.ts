// Smart assists: one click for the fiddly parts of flat shape designs —
// a centre dot, a face, a sheet of coloured tiles, variations of a shape.
import type { Box, ModEntry, SymbolSpec } from '../engine/types';
import { ambientOf } from '../render/background';
import { luminance, QUICK_COLORS } from '../render/palette';
import { group, isChoice, isGroup, style, SYMBOL_UI, symbolLayer, type Node } from '../state/model';
import { edit, select, store, toast } from '../state/store';
import { find, findNode } from '../state/tree';
import { addNode, nodeBox, selectedNodes, styleOf } from './actions';

type Rgb = [number, number, number];

const rgbOf = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as Rgb;
};
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function fillOf(n: Node): string {
  const f = styleOf(n)?.params.fill;
  return typeof f === 'string' && f.startsWith('#') ? f : '#888888';
}

function backgroundRgb(): Rgb {
  return ambientOf(store.get().project.background).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) as Rgb;
}

/** The quick colour that stands out most from both the shape and the background. */
export function accentFor(fill: string): string {
  const f = rgbOf(fill);
  const bg = backgroundRgb();
  const score = (c: string) => Math.min(distance(rgbOf(c), f), distance(rgbOf(c), bg));
  return [...QUICK_COLORS].sort((a, b) => score(b) - score(a))[0];
}

/** Ink for details drawn on a shape: near-black on light fills, cream on dark ones. */
const inkOn = (fill: string) => (luminance(fill) > 0.35 ? '#0a0a0a' : '#f4f1ea');

/** Insert right above `id` in its own list of layers. */
function addAbove(id: string, n: Node) {
  const f = find(store.get().project.layers, id);
  addNode(n, f ? { parent: f.parent?.id ?? null, index: f.index + 1 } : {});
}

/** A dot in a contrasting colour, centred on the shape (a flower's centre, a badge's boss). */
export function addCentreDot(id: string) {
  const n = findNode(store.get().project.layers, id);
  const b = n && nodeBox(n);
  if (!n || !b) return;
  const sym = !isGroup(n) && n.content.type === 'symbol' ? n.content.symbol : null;
  // A flower with a hole gets a dot that fills it; otherwise about a third of the shape.
  const hole = sym?.kind === 'flower' ? (sym.hole ?? 0) : 0;
  const d = Math.min(b[2] - b[0], b[3] - b[1]) * (hole > 0 ? hole : 0.34);
  addAbove(id, symbolLayer('circle', Math.max(2, Math.round(d)), { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, name: 'Centre', style: style('flat', { fill: accentFor(fillOf(n)) }) }));
}

/** Two eyes and a smile in the middle of the shape, as one group. */
export function addFace(id: string) {
  const n = findNode(store.get().project.layers, id);
  const b = n && nodeBox(n);
  if (!n || !b) return;
  const size = Math.min(b[2] - b[0], b[3] - b[1]) * 0.34;
  const [cx, cy] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const ink = style('flat', { fill: inkOn(fillOf(n)) });
  const eyes = symbolLayer('eyes', Math.round(size), { x: cx, y: cy - size * 0.12, name: 'Eyes', style: structuredClone(ink) }, { gap: 0.3, width: 0.13, height: 0.34 });
  const smile = symbolLayer('smile', Math.round(size * 0.7), { x: cx, y: cy + size * 0.3, name: 'Smile', style: structuredClone(ink) }, { curve: 0.55, weight: 0.16, cap: 'round' });
  addAbove(id, group([eyes, smile], { name: 'Face' }));
}

/** Bold flat tiles that read well behind shapes. */
const TILE_COLORS = ['#ff8fcf', '#ffcf1a', '#d4bfe6', '#ff5a00', '#1f66cc', '#2e9150', '#86923a', '#f4f1ea'];

/**
 * Lay the selected shapes (or, with fewer than two selected, every top-level one) out in a grid filling the
 * artboard, each scaled to fit and centred on its own coloured tile.
 */
export function tileSheet() {
  const s = store.get();
  // Two or more selected: those. Otherwise everything (one shape on one tile isn't a sheet).
  const picked = selectedNodes().filter((n) => !n.locked);
  const nodes = (picked.length > 1 ? picked : s.project.layers.filter((n) => n.visible && !n.locked)).filter((n) => n.name !== 'Tile');
  const boxes = nodes.map((n) => nodeBox(n));
  if (!nodes.length || boxes.some((b) => !b)) return toast('Nothing to arrange yet', 'info');
  const items = clusterBoxes(boxes as Box[]);
  const { width: W, height: H } = s.project.canvas;
  const cols = Math.ceil(Math.sqrt(items.length * (W / H)));
  const rows = Math.ceil(items.length / cols);
  const [cw, ch] = [W / cols, H / rows];
  const tiles: Node[] = [];
  edit((p) => {
    items.forEach((members, i) => {
      const b = members.map((k) => boxes[k]!).reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]);
      const to = { x: -W / 2 + ((i % cols) + 0.5) * cw, y: -H / 2 + (Math.floor(i / cols) + 0.5) * ch };
      const from = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
      const f = (Math.min(cw, ch) * 0.6) / Math.max(1, b[2] - b[0], b[3] - b[1]);
      const place = (m: Node) => {
        if (isGroup(m)) return m.children.forEach(place);
        // Scale about `from`, then move it to `to`: the layer's origin and size follow.
        m.x = to.x + (m.x - from.x) * f;
        m.y = to.y + (m.y - from.y) * f;
        m.scale *= f;
      };
      for (const k of members) {
        const n = findNode(p.layers, nodes[k].id);
        if (n) place(n);
      }
      // A tile colour clearly different from the main shape's own.
      const main = fillOf(nodes[members[0]]);
      const colour = [...TILE_COLORS.slice(i % TILE_COLORS.length), ...TILE_COLORS].find((c) => distance(rgbOf(c), rgbOf(main)) > 120) ?? accentFor(main);
      tiles.push(symbolLayer('roundRect', Math.max(cw, ch), { x: to.x, y: to.y, name: 'Tile', style: style('flat', { fill: colour }) }, { radius: 0, aspect: cw / ch }));
    });
    p.layers.splice(0, 0, ...tiles);
  });
  select(nodes.map((n) => n.id));
  toast(`Arranged ${items.length} on ${cols} × ${rows} tiles`, 'info');
}

/**
 * Group boxes into items for a tile sheet: a box whose centre sits inside a
 * bigger one (a face, a centre dot) travels with it. Each item lists its
 * members' indices, the biggest first; items keep the order of their biggest.
 */
export function clusterBoxes(boxes: Box[]): number[][] {
  const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);
  const order = boxes.map((_, i) => i).sort((a, b) => area(boxes[b]) - area(boxes[a]));
  const owner = new Map<number, number>();
  for (const i of order) {
    const [cx, cy] = [(boxes[i][0] + boxes[i][2]) / 2, (boxes[i][1] + boxes[i][3]) / 2];
    const host = order.find((j) => j !== i && area(boxes[j]) > area(boxes[i]) && !owner.has(j) && cx > boxes[j][0] && cx < boxes[j][2] && cy > boxes[j][1] && cy < boxes[j][3]);
    if (host !== undefined) owner.set(i, host);
  }
  const roots = boxes.map((_, i) => i).filter((i) => !owner.has(i));
  return roots.map((r) => [r, ...order.filter((i) => owner.get(i) === r)]);
}

export interface Variant {
  symbol: SymbolSpec;
  modifiers: ModEntry[];
}

/**
 * New takes on a shape: every slider nudged within its range, seeds rerolled
 * (the shape's and its modifiers'), now and then another option picked.
 */
export function variationsOf(symbol: SymbolSpec, modifiers: ModEntry[], count = 8, rand: () => number = Math.random): Variant[] {
  const ui = SYMBOL_UI[symbol.kind];
  return Array.from({ length: count }, () => {
    const next = { ...symbol } as unknown as Record<string, number | string>;
    for (const f of ui.fields) {
      if (isChoice(f)) {
        if (rand() < 0.3) next[f.key] = f.options[Math.floor(rand() * f.options.length)].value;
        continue;
      }
      if (f.toggle) continue;
      if (f.key === 'seed') {
        next[f.key] = Math.floor(rand() * 1000);
        continue;
      }
      const cur = Number(next[f.key] ?? f.min);
      const v = Math.min(f.max, Math.max(f.min, cur + (rand() - 0.5) * (f.max - f.min) * 0.5));
      next[f.key] = f.integer ? Math.round(v) : Math.round(v / f.step) * f.step;
    }
    const mods = modifiers.map((m) => ('seed' in m ? ({ ...m, seed: Math.floor(rand() * 1000) } as ModEntry) : m));
    return { symbol: next as unknown as SymbolSpec, modifiers: mods };
  });
}
