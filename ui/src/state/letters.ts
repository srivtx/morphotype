// Text moving letter by letter (or word by word) without splitting it into
// layers. The engine says which letter and word each outline of a text
// belongs to (RenderOut.glyphs and .words, asked for only for such texts);
// the canvas then draws each letter as its own object, with the text's motion
// about the letter's centre and started `stagger` seconds after the one before
// in the text's order, as a staggered group does with its children.
import type { Box, RenderOut } from '../engine/types';
import { isGroup, type Node, type ShapeLayer } from './model';
import { isStill, seedOf, staggerSlot, type KeyedTransform, type LetterMode, type Motion, type StaggerOrder } from './motion';

/** A text layer whose letters or words move on their own. */
export const splitsText = (n: Node | undefined): n is ShapeLayer => !!n && !isGroup(n) && n.content.type === 'text' && !!n.motion?.letters && !isStill(n.motion);

/** Which letter goes first (STAGGER_ORDERS, in a text's words). */
export const LETTER_ORDERS: { value: StaggerOrder; label: string; title: string }[] = [
  { value: 'first', label: 'In order', title: 'As you read them' },
  { value: 'last', label: 'Reverse', title: 'The last one first' },
  { value: 'centre', label: 'From centre', title: 'The middle ones first, spreading out' },
  { value: 'random', label: 'Random', title: 'A shuffled order (the same every time)' },
];

/** How many letters or words a text has (spaces aside), as its timeline counts them. */
export function pieceCount(text: string, mode: LetterMode): number {
  if (mode === 'words') return text.split(/\s+/).filter(Boolean).length;
  return [...text].filter((c) => !/\s/.test(c)).length;
}

/** The pieces a text layer's motion moves in turn (0 when it moves as one). */
export const textPieces = (n: Node): number => (splitsText(n) && n.content.type === 'text' ? pieceCount(n.content.text, n.motion!.letters!) : 0);

export interface Piece {
  d: string;
  bbox: Box;
}

/** Bounds of polyline path data (`M x y L x y … Z`, as the engine writes it). */
function polyBounds(d: string): Box | null {
  const v = d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
  if (!v || v.length < 2) return null;
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 1 < v.length; i += 2) {
    const [x, y] = [Number(v[i]), Number(v[i + 1])];
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], y);
  }
  return b;
}

/** A text's outline cut into its letters or words, in reading order; null without the engine's letter tags. */
export function piecesOf(out: Pick<RenderOut, 'd' | 'glyphs' | 'words'>, mode: LetterMode): Piece[] | null {
  const { glyphs, words } = out;
  if (!glyphs || !words) return null;
  const subs = out.d.match(/M[^M]*/g) ?? [];
  if (subs.length !== glyphs.length) return null;
  const parts: string[][] = [];
  subs.forEach((s, i) => {
    const k = mode === 'words' ? (words[glyphs[i]] ?? 0) : glyphs[i];
    (parts[k] ??= []).push(s);
  });
  const list: Piece[] = [];
  for (const p of parts) {
    if (!p) continue;
    const d = p.join('');
    const bbox = polyBounds(d);
    if (bbox) list.push({ d, bbox });
  }
  return list;
}

/** One motion on a drawn object, about a pivot, running `offset` s late. */
export interface PlacedLink {
  motion: Motion;
  pivot: [number, number];
  offset: number;
  /** Transform keys (a link of their own, see tree.ts). */
  keys?: KeyedTransform;
}

/**
 * The motions on each piece of a text: its own (the first link) about the
 * piece's centre, the piece starting its slot × stagger later; any groups'
 * motions around it as they are.
 */
export function pieceLinks(links: PlacedLink[], pieces: Piece[], seedId: string): PlacedLink[][] {
  const [own, ...outer] = links;
  const m = own.motion;
  const n = pieces.length;
  const seed = seedOf(seedId);
  return pieces.map((p, i) => [{ motion: m, pivot: [(p.bbox[0] + p.bbox[2]) / 2, (p.bbox[1] + p.bbox[3]) / 2], offset: own.offset + staggerSlot(m.order, i, n, seed) * m.stagger }, ...outer]);
}
