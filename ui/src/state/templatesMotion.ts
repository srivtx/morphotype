// Moving examples, each made only with the everyday tools: rounded rects,
// text, the Pattern material with Speed, outlines, clip frames and Motion
// (loops, entrances, stagger). Open one and take it apart.
import { background, fill, group, mods, style, symbolLayer, textLayer, type Node, type Project, type Style } from './model';
import { newMotion } from './motion';
import type { Template } from './templates';

const pat = (kind: number, ink: string, paper: string, p: Record<string, number | string> = {}): Style =>
  style('pattern', { kind, ink, paper, paperAlpha: 0, scale: 16, weight: 0.4, angle: 0, rays: 24, amount: 0.35, stagger: 0, cx: 0, cy: 0, phaseX: 0, phaseY: 0, seed: 3, speed: 0, ...p });
const flat = (c: string, extra: Partial<Style> = {}): Style => ({ ...style('flat', { fill: c }), ...extra });

/** Cards are measured on a 720 × 928 reference; K scales that to the artboard. */
const CARD = { w: 720, h: 928 };
const K = 340 / CARD.w;

/** A rounded rect from its reference box (left, top, right, bottom, corner radius) in card units, centred on the card. */
function box(l: number, t: number, r: number, b: number, radius: number, st: Style, name: string) {
  const [w, h] = [(r - l) * K, (b - t) * K];
  return symbolLayer('roundRect', Math.max(w, h), { x: ((l + r) / 2 - CARD.w / 2) * K, y: ((t + b) / 2 - CARD.h / 2) * K, name, style: st }, { radius: (radius * K) / Math.max(w, h), aspect: w / h });
}

/** Just the outline of a box: the Outline modifier turns a filled rect into a ring. */
function ring(l: number, t: number, r: number, b: number, radius: number, colour: string, name: string) {
  const n = box(l, t, r, b, radius, flat(colour), name);
  const size = Math.max(r - l, b - t) * K;
  n.modifiers = mods({ kind: 'outline', width: (1.6 * K * 2) / size });
  return n;
}

/** Left-aligned text from the card's left margin; `y` is the block's middle in card units. */
const text = (s: string, font: string, size: number, y: number, colour: string, name: string, extra: { lineHeight?: number; opacity?: number } = {}) =>
  textLayer(s, font, { x: (48 - CARD.w / 2) * K, y: (y - CARD.h / 2) * K, name, style: flat(colour, { opacity: extra.opacity }) }, { size: size * K, align: 'left', lineHeight: extra.lineHeight ?? 1, tracking: 0 });

interface CardSpec {
  name: string;
  colour: string;
  ink: string;
  art: Node;
  title: string;
  body: string;
  bodyInk: string;
}

/**
 * Panel art across the top of the card. Open, the title sits under it with a
 * paragraph below; in the deck only the title shows, low on the card.
 */
function card(c: CardSpec, open: boolean): Node {
  const twoLines = c.title.includes('\n');
  const title = open ? (twoLines ? 536 : 506) : twoLines ? 780 : 818;
  return group(
    [
      box(0, 0, CARD.w, CARD.h, 26, flat(c.colour), 'Card'),
      c.art,
      text(c.title, 'eb-garamond', open ? 76 : 84, title, c.ink, 'Title', { lineHeight: 0.92 }),
      ...(open ? [text(c.body, 'inter', 29, twoLines ? 716 : 640, c.bodyInk, 'Body', { lineHeight: 1.66 })] : []),
    ],
    { name: c.name },
  );
}

/** The panel area every card's art fills. */
const panel = (st: Style, l = 48, t = 48, r = 672, b = 432) => box(l, t, r, b, 0, st, 'Art');

/** Interface Kit: a wireframe on a faint grid whose row of small cards slides inside its frame. */
function wireframe(): Node {
  const line = '#a89c86';
  const strip = Array.from({ length: 6 }, (_, i) => ring(240 + i * 120, 152, 334 + i * 120, 342, 9, line, 'Tile'));
  return group(
    [
      panel(pat(2, '#3a3734', '#222120', { scale: 24.2 * K, weight: 0.05 }), 55, 55, 680, 440),
      ring(80, 80, 655, 413, 22, line, 'Window'),
      ring(104, 104, 246, 390, 10, line, 'Sidebar'),
      ring(271, 104, 630, 390, 10, line, 'Content'),
      // The carousel: an invisible frame the size of Content clips the moving strip.
      group([box(272, 106, 629, 389, 9, flat('#222120', { opacity: 0 }), 'Frame'), group(strip, { name: 'Strip', motion: newMotion({ loop: 'slide', amount: 60 * K, period: 4 }) })], { name: 'Carousel', clip: true }),
    ],
    { name: 'Wireframe' },
  );
}

/** Place a card: centre at x, y (artboard px from the middle), turned `deg`. */
function place(n: Node, x: number, y: number, deg: number): Node {
  const r = (deg * Math.PI) / 180;
  const walk = (m: Node) => {
    if ('children' in m) return m.children.forEach(walk);
    const [dx, dy] = [m.x, m.y];
    m.x = x + dx * Math.cos(r) - dy * Math.sin(r);
    m.y = y + dx * Math.sin(r) + dy * Math.cos(r);
    m.rotation += deg;
  };
  walk(n);
  return n;
}

/** The five cards, open (with their paragraphs) or as they sit in the deck. */
function cards(open: boolean): Node[] {
  return [
        card({
          name: 'Working Knowledge',
          colour: '#e4500f',
          ink: '#fff3a6',
          bodyInk: '#ffc28c',
          art: panel(pat(20, '#fff3a6', '#e4500f', { scale: 12 * K, weight: 0.36, stagger: 1, amount: 0.67, rays: 104, speed: 0.1 })),
          title: 'Working\nKnowledge',
          body: "Frameworks, principles, and models I've\nlearned and developed that you will be\nable to immediately apply to your practice.",
        }, open),
        card({
          name: 'Practical Demonstration',
          colour: '#f5ebda',
          ink: '#4e4433',
          bodyInk: '#7b715f',
          art: panel(pat(21, '#4f4636', '#f5ebda', { scale: 33.9 * K, weight: 0.88, speed: 0.6 }), 54, 56, 664, 426),
          title: 'Practical\nDemonstration',
          body: 'Detailed walkthroughs of designing\ninterfaces, identifying opportunities, and\nimproving through refinement.',
        }, open),
        card({
          name: 'Collaborating with AI',
          colour: '#0a8fd4',
          ink: '#a9f2ff',
          bodyInk: '#8fd8f2',
          art: panel(pat(23, '#a9f2ff', '#0a8fd4', { scale: 12.6 * K, weight: 0.16, amount: 0.9, rays: 48, speed: 0.12 }), 48, 48, 670, 426),
          title: 'Collaborating\nwith AI',
          body: 'Video lessons on practical, specific\nmethods of working with AI to get exacting\nresults. Tools covered include Claude\nCode and v0.',
        }, open),
        card({
          name: 'Means & Methods',
          colour: '#52f29a',
          ink: '#0b5a10',
          bodyInk: '#22803a',
          art: panel(pat(22, '#0b5a10', '#52f29a', { scale: 43 * K, weight: 0.86, speed: 0.15 }), 62, 66, 658, 410),
          title: 'Means &\nMethods',
          body: 'General tips and techniques to apply to\nyour daily work to achieve excellence in\ninterface design and assembly.',
        }, open),
        card({
          name: 'Interface Kit',
          colour: '#222120',
          ink: '#f3ebdd',
          bodyInk: '#b3ab9e',
          art: wireframe(),
          title: 'Interface Kit',
          body: 'Screencasts, highlights, and deep dives\nthat showcase the end-to-end journey for\ndesigning and building Interface Kit.',
        }, open),
  ];
}

const deal = (stagger: number, distance: number) => newMotion({ enter: 'rise', distance, stagger, transition: { type: 'time', duration: 0.7, bounce: 0.25, ease: [0.16, 1, 0.3, 1], stiffness: 200, damping: 20, mass: 1 } });

export const MOTION_TEMPLATES: Template[] = [
  {
    name: 'Moving cards',
    hint: 'Five course cards dealt onto the table, each with moving art: riding lines, a flickering mosaic, flowing lines, barcode rows and a sliding wireframe',
    category: 'Social',
    make: (): Project => {
      const deck = cards(false);
      // Laid out as in the reference: overlapping, each turned a little.
      const spots: [number, number, number][] = [
        [-480, -10, -7],
        [-235, 38, 3.4],
        [-5, -55, -2.2],
        [215, 30, 1.2],
        [462, -23, 4.8],
      ];
      deck.forEach((c, i) => place(c, ...spots[i]));
      return { version: 2, name: 'Moving cards', canvas: { width: 2000, height: 880 }, layers: [group(deck, { name: 'Deck', motion: deal(0.12, 260) })], background: background(fill('solid', '#ffffff')), fonts: [], timeline: { duration: 6, loop: true } };
    },
  },
  {
    name: 'Course cards',
    hint: 'The same five cards opened up, each with its paragraph and its own moving art, laid out in a row',
    category: 'Social',
    make: (): Project => {
      // Layout → Row with a 40 px gap.
      const row = cards(true);
      row.forEach((c, i) => place(c, (i - 2) * (CARD.w * K + 40), 0, 0));
      return { version: 2, name: 'Course cards', canvas: { width: 1960, height: 600 }, layers: [group(row, { name: 'Cards', motion: deal(0.1, 120) })], background: background(fill('solid', '#0b0b0b')), fonts: [], timeline: { duration: 6, loop: true } };
    },
  },
];
