// Layout and taste, measured: where every layer's box sits, edges that nearly
// line up (the off-by-3-px that reads as sloppy), content that's nearly but
// not quite centred, things crowding an edge, text sizes too close to give a
// clear lead, and from the pixels where the visual weight sits and how many
// hues the palette really uses. These are notes, not rules: a poster may
// break any of them on purpose.
import type { BuildResult } from '../engine/client';
import type { Box } from '../engine/types';
import { isGroup, nodeLabel, type Node, type Project } from '../state/model';
import type { Finding, Pixels } from './check';
import { num } from './describe';
import { findNode, handle } from './find';

export interface Item {
  id: string;
  name: string;
  text: boolean;
  /** Text: its font size on the canvas, px, and how many characters it has. */
  size?: number;
  /** Text: its own size setting (before scale). */
  contentSize?: number;
  chars?: number;
  box: Box;
}

/** What draws, with its box: visible leaves and merged groups, top layer last. */
export function itemsOf(p: Project, build: BuildResult | null): Item[] {
  const boxes = new Map<string, Box | null>([...(build?.layers ?? []), ...(build?.renders ?? [])].map((l) => [l.id, l.bbox]));
  const out: Item[] = [];
  const go = (nodes: Node[], k: number) => {
    for (const n of nodes) {
      if (!n.visible) continue;
      if (isGroup(n) && !n.merge) go(n.children, k);
      else if (isGroup(n) || !n.guide) {
        const box = boxes.get(n.id);
        if (!box) continue;
        const text = !isGroup(n) && n.content.type === 'text';
        const c = !isGroup(n) && n.content.type === 'text' ? n.content : null;
        out.push({ id: n.id, name: nodeLabel(n), text, size: c ? c.size * (n as { scale: number }).scale * k : undefined, contentSize: c?.size, chars: c ? c.text.replace(/\s/g, '').length : undefined, box });
      }
    }
  };
  go(p.layers, 1);
  return out;
}

const who = (i: Item) => `"${i.name}"`;
/** An item as a command names it. */
const h = (p: Project, i: Item) => `"${handle(p, findNode(p, i.id))}"`;
const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);

/** Each layer's box and its distance to every edge, as a table. */
export function boxTable(p: Project, items: Item[]): string {
  const { width: W, height: H } = p.canvas;
  const rows = [...items].reverse().map((i) => {
    const [x0, y0, x1, y1] = i.box;
    const m = [x0 + W / 2, W / 2 - x1, y0 + H / 2, H / 2 - y1].map((v) => num(Math.round(v)));
    return `${who(i).padEnd(26)} ${`${num(Math.round(x1 - x0))}×${num(Math.round(y1 - y0))}`.padEnd(10)} centre ${num(Math.round((x0 + x1) / 2))},${num(Math.round((y0 + y1) / 2))}`.padEnd(54) + `  margins L ${m[0]} R ${m[1]} T ${m[2]} B ${m[3]}${i.size ? ` · ${num(Math.round(i.size))}px type` : ''}`;
  });
  return [`boxes on ${W}×${H} (px; x,y from the centre; negative margins are off the canvas), top first:`, ...rows].join('\n');
}

/** Findings from the boxes alone. */
export function layoutFindings(p: Project, items: Item[]): Finding[] {
  const { width: W, height: H } = p.canvas;
  const tol = Math.max(2, Math.min(W, H) * 0.012);
  // Below this nobody sees it (and glyph shapes alone shift text boxes this much).
  const seen = Math.max(1.5, Math.min(W, H) * 0.002);
  const out: Finding[] = [];
  const inside = items.filter((i) => i.box[0] < W / 2 && i.box[2] > -W / 2 && i.box[1] < H / 2 && i.box[3] > -H / 2);
  // Edges that nearly line up.
  const edges = (b: Box) => ({ left: b[0], 'centre (x)': (b[0] + b[2]) / 2, right: b[2], top: b[1], 'middle (y)': (b[1] + b[3]) / 2, bottom: b[3] });
  const misses: (Finding & { d: number })[] = [];
  const edge = (k: string) => k.replace(/ \(.\)/, '');
  for (let a = 0; a < inside.length; a++) {
    for (let b = a + 1; b < inside.length; b++) {
      const ea = edges(inside[a].box), eb = edges(inside[b].box);
      let best: (Finding & { d: number }) | null = null;
      for (const k of Object.keys(ea) as (keyof typeof ea)[]) {
        const d = Math.abs(ea[k] - eb[k]);
        // The smaller one moves to the bigger one.
        const [big, small] = area(inside[a].box) >= area(inside[b].box) ? [inside[a], inside[b]] : [inside[b], inside[a]];
        if (d > seen && d <= tol && (!best || d < best.d)) best = { level: 'warn', style: true, d, text: `${who(inside[a])} and ${who(inside[b])}: ${edge(k)}s ${num(d)}px apart, nearly lined up`, hint: `align {file} ${h(p, small)} --to ${h(p, big)} --edge ${edge(k)}` };
        if (d <= seen) {
          best = null;
          break;
        }
      }
      if (best) misses.push(best);
    }
    const c = edges(inside[a].box);
    for (const [k, v, axis] of [['horizontally', c['centre (x)'], 'x'], ['vertically', c['middle (y)'], 'y']] as const) {
      if (Math.abs(v) > seen && Math.abs(v) <= tol) misses.push({ level: 'warn', style: true, d: Math.abs(v), text: `${who(inside[a])}: ${num(Math.abs(v))}px off centre ${k}, nearly centred`, fix: { layout: [{ target: '#' + inside[a].id, centre: axis }], does: `centred ${k} by its ink` } });
    }
  }
  misses.sort((x, y) => x.d - y.d);
  for (const { d: _, ...m } of misses.slice(0, 6)) out.push(m);
  if (misses.length > 6) out.push({ level: 'info', style: true, text: `${misses.length - 6} more near-misses like these` });
  // Content as a whole: off centre by a little, or crowding an edge.
  if (inside.length) {
    const u = inside.reduce<Box>((b, i) => [Math.min(b[0], i.box[0]), Math.min(b[1], i.box[1]), Math.max(b[2], i.box[2]), Math.max(b[3], i.box[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const [L, R] = [u[0] + W / 2, W / 2 - u[2]];
    if (L > 0 && R > 0 && u[2] - u[0] > W * 0.5 && Math.abs(L - R) > tol && Math.abs(L - R) < W * 0.08) out.push({ level: 'info', style: true, text: `the design sits ${num(Math.round(Math.abs(L - R) / 2))}px ${L > R ? 'right' : 'left'} of centre (margins left ${num(Math.round(L))}, right ${num(Math.round(R))})` });
    const close = Math.min(W, H) * 0.025;
    for (const i of inside) {
      const m: [string, number][] = [['left', i.box[0] + W / 2], ['right', W / 2 - i.box[2]], ['top', i.box[1] + H / 2], ['bottom', H / 2 - i.box[3]]];
      const near = m.filter(([, v]) => v > 0.75 && v < close);
      if (near.length) out.push({ level: 'warn', style: true, text: `${who(i)}: only ${near.map(([s, v]) => `${num(Math.round(v))}px from the ${s}`).join(' and ')} edge: crowded (bleed it off or give it room)`, hint: `set {file} '${h(p, i)}.contain=true'` });
    }
  }
  // Type sizes.
  // Single letters often make a word together (a "2" and a "K"): leave them out.
  const texts = items.filter((i) => i.text && i.size && (i.chars ?? 0) >= 3).sort((a, b) => b.size! - a.size!);
  const biggest = Math.max(0, ...items.filter((i) => i.size).map((i) => i.size!));
  if (texts.length >= 2) {
    const [a, b] = texts;
    if (b.size! / a.size! > 0.88 && a.name !== b.name && a.size! > biggest * 0.6) out.push({ level: 'warn', style: true, text: `no clear lead: ${who(a)} (${num(Math.round(a.size!))}px) and ${who(b)} (${num(Math.round(b.size!))}px) are about the same size`, hint: `set {file} '${h(p, b)}.size=${Math.round((b.contentSize ?? b.size!) * 0.6)}'` });
    const sizes = new Set(texts.map((t) => Math.round(Math.log(t.size!) / Math.log(1.08))));
    if (sizes.size > 4) out.push({ level: 'info', style: true, text: `${sizes.size} different text sizes: fewer reads cleaner` });
  }
  if (items.length > 30) out.push({ level: 'info', style: true, text: `${items.length} separate things on the canvas: busy` });
  return out;
}

const HUES = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'pink'];

/** Where the visual weight sits and the main hues, from the design against its bare background. */
export function lookFindings(design: Pixels, bare: Pixels): Finding[] {
  const { width: w, height: h } = design;
  const d = design.data, e = bare.data;
  let m = 0, mx = 0, my = 0, colored = 0;
  const hues = new Array<number>(12).fill(0);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const ink = (Math.abs(d[i] - e[i]) + Math.abs(d[i + 1] - e[i + 1]) + Math.abs(d[i + 2] - e[i + 2])) / 765;
      m += ink;
      mx += ink * (x + 0.5);
      my += ink * (y + 0.5);
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      if (s < 0.3 || l < 0.12 || l > 0.92) continue;
      const hue = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      hues[Math.floor(((hue * 60 + 15) % 360) / 30)]++;
      colored++;
    }
  }
  const out: Finding[] = [];
  if (m > 0) {
    const ox = (mx / m / w - 0.5) * 2, oy = (my / m / h - 0.5) * 2;
    const off = Math.hypot(ox, oy);
    const side = `${Math.abs(oy) > 0.08 ? (oy < 0 ? 'upper' : 'lower') : ''}${Math.abs(oy) > 0.08 && Math.abs(ox) > 0.08 ? ' ' : ''}${Math.abs(ox) > 0.08 ? (ox < 0 ? 'left' : 'right') : ''}`;
    out.push({ level: 'info', text: off < 0.1 ? 'visual weight: balanced around the centre' : `visual weight sits ${side || 'off centre'} (${num(Math.round(off * 50))}% of the way to the edge)` });
  }
  const main = hues.map((n, k) => ({ n, k })).filter((x) => colored && x.n / colored > 0.04).sort((a, b) => b.n - a.n);
  const neutral = 1 - colored / (w * h);
  out.push({ level: main.length >= 6 ? 'warn' : 'info', style: true, text: `palette: ${main.length ? `${main.length} main hue${main.length > 1 ? 's' : ''} (${main.map((x) => HUES[x.k]).join(', ')})` : 'no strong hues'}${neutral > 0.5 ? ', mostly neutrals' : ''}${main.length >= 6 ? ': busy, try fewer' : ''}` });
  return out;
}
