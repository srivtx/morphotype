import { describe, expect, it } from 'vitest';
import { pieceCount, pieceLinks, piecesOf, textPieces, type Piece, type PlacedLink } from './letters';
import { background, fill, group, style, textLayer, type Project } from './model';
import { motionEnd, newMotion, placement, poseAt, settleTime, staggerSlot, seedOf, type Motion } from './motion';
import { tracksOf } from './tracks';
import { buildScene } from './tree';

const project = (layers: Project['layers']): Project => ({ version: 2, name: 't', canvas: { width: 800, height: 400 }, layers, background: background(fill('solid', '#ffffff')), fonts: [], timeline: { duration: 6, loop: true } });
const ink = style('flat', { fill: '#000000' });
/** A square subpath, as the engine writes polylines. */
const sq = (x: number, y: number, s = 10) => `M${x} ${y}L${x + s} ${y} ${x + s} ${y + s} ${x} ${y + s}Z`;
const piece = (x: number): Piece => ({ d: sq(x, 0), bbox: [x, 0, x + 10, 10] });
const rise = (over: Partial<Motion> = {}) => newMotion({ enter: 'rise', distance: 100, delay: 0.5, letters: 'letters', stagger: 0.1, ...over });

describe('letter by letter', () => {
  it('counts letters and words, spaces aside', () => {
    expect(pieceCount('Hi there!', 'letters')).toBe(8);
    expect(pieceCount('  Hi there!\nyou ', 'words')).toBe(3);
    expect(pieceCount('', 'words')).toBe(0);
    const t = textLayer('Go on', 'inter', { style: ink, motion: rise() });
    expect(textPieces(t)).toBe(4);
    t.motion!.letters = 'words';
    expect(textPieces(t)).toBe(2);
    // Moving as one, or not moving: no pieces.
    delete t.motion!.letters;
    expect(textPieces(t)).toBe(0);
    expect(textPieces(textLayer('Go on', 'inter', { style: ink, motion: newMotion({ letters: 'letters' }) }))).toBe(0);
  });

  it('cuts the outline by the letter and word tags', () => {
    // i (stem and dot), o (with its hole), then a second word: k.
    const out = { d: sq(0, 10) + sq(0, 0, 4) + sq(20, 10) + sq(22, 12, 4) + sq(60, 10), glyphs: [0, 0, 1, 1, 2], words: [0, 0, 1] };
    const letters = piecesOf(out, 'letters')!;
    expect(letters.map((p) => p.d)).toEqual([sq(0, 10) + sq(0, 0, 4), sq(20, 10) + sq(22, 12, 4), sq(60, 10)]);
    expect(letters.map((p) => p.bbox)).toEqual([
      [0, 0, 10, 20],
      [20, 10, 30, 20],
      [60, 10, 70, 20],
    ]);
    const words = piecesOf(out, 'words')!;
    expect(words.length).toBe(2);
    expect(words[0].bbox).toEqual([0, 0, 30, 20]);
    // Without tags (or with stale ones) the text moves as one.
    expect(piecesOf({ d: out.d }, 'letters')).toBeNull();
    expect(piecesOf({ ...out, glyphs: [0, 1] }, 'letters')).toBeNull();
  });

  it('starts each letter a gap after the one before, turning about its own centre', () => {
    const m = rise();
    const outer: PlacedLink = { motion: newMotion({ loop: 'float', amount: 5 }), pivot: [0, 0], offset: 0.3 };
    const links = pieceLinks([{ motion: m, pivot: [100, 100], offset: 0.2 }, outer], [piece(0), piece(20), piece(40), piece(60)], 'txt');
    expect(links.map((l) => +l[0].offset.toFixed(6))).toEqual([0.2, 0.3, 0.4, 0.5]);
    expect(links.map((l) => l[0].pivot)).toEqual([
      [5, 5],
      [25, 5],
      [45, 5],
      [65, 5],
    ]);
    // A group's motion around the text stays as it is.
    expect(links.every((l) => l[1] === outer)).toBe(true);
    // Halfway through: the first letter is up, the last hasn't started.
    const t = 0.5 + 0.2 + settleTime(m.transition);
    const y = (l: PlacedLink[]) => placement(l.slice(0, 1), t).m[5];
    expect(Math.abs(y(links[0]))).toBeLessThan(0.5);
    expect(y(links[3])).toBeGreaterThan(1);
    expect(y(links[3])).toBeCloseTo(poseAt(m, t - 0.5).y, 6);
  });

  it('follows the stagger order', () => {
    const pieces = [0, 1, 2, 3, 4].map((i) => piece(i * 20));
    const offsets = (order: Motion['order']) => pieceLinks([{ motion: rise({ order }), pivot: [0, 0], offset: 0 }], pieces, 'txt').map((l) => +l[0].offset.toFixed(6));
    expect(offsets('first')).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(offsets('last')).toEqual([0.4, 0.3, 0.2, 0.1, 0]);
    expect(offsets('centre')).toEqual([0.2, 0.1, 0, 0.1, 0.2]);
    const shuffled = offsets('random');
    expect([...shuffled].sort()).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(shuffled).toEqual(pieces.map((_, i) => +(staggerSlot('random', i, 5, seedOf('txt')) * 0.1).toFixed(6)));
  });

  it('asks the engine for letters only for text that moves letter by letter', () => {
    const moving = textLayer('Hey', 'inter', { style: ink, motion: rise() });
    const together = textLayer('Hey', 'inter', { style: ink, motion: rise({ letters: undefined }) });
    const still = textLayer('Hey', 'inter', { style: ink });
    const { doc, objects } = buildScene(project([moving, together, still]));
    expect(doc.renders!.map((r) => !!r.letters)).toEqual([true, false, false]);
    expect(objects.map((o) => o.letters)).toEqual(['letters', undefined, undefined]);
    // Its own motion comes first, as the canvas expects.
    expect(objects[0].motion![0].at).toBe(moving.id);
    // Inside a staggered group: the group's link follows.
    const g = group([textLayer('Hey', 'inter', { style: ink, motion: rise() })], { motion: newMotion({ enter: 'fade', stagger: 0.2 }) });
    const inner = buildScene(project([g])).objects[0];
    expect(inner.motion!.map((l) => l.motion)).toEqual([g.children[0].motion, g.motion]);
  });

  it('shows the text on the timeline as a staggered span', () => {
    const t = textLayer('Hello', 'inter', { style: ink, motion: rise({ leave: 'fade', leaveAt: 3 }) });
    const m = t.motion!;
    const [enter, leave] = tracksOf(t, { duration: 6, loop: true });
    const settle = settleTime(m.transition);
    expect(enter).toMatchObject({ kind: 'enter', children: 5, start: 0.5, label: 'Rise · 5 letters in turn' });
    expect(enter.kind === 'enter' && enter.end).toBeCloseTo(0.5 + 0.4 + settle, 6);
    expect(leave).toMatchObject({ kind: 'leave', children: 5, start: 3 });
    expect(motionEnd(m, textPieces(t))).toBeCloseTo(3 + 0.4 + settle, 6);
    m.letters = 'words';
    expect(tracksOf(t, { duration: 6, loop: true })[0]).toMatchObject({ children: 1, label: 'Rise · 1 word in turn' });
  });
});
