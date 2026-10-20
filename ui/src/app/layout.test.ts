import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, layoutOf } from './layout';
import type { Box } from '../engine/types';

const card: Box = [0, 0, 100, 140];

describe('layoutOf', () => {
  it('lays a row out edge to edge with the gap, centred', () => {
    const s = layoutOf([card, card, card], { ...DEFAULT_LAYOUT, kind: 'row', gap: 20 });
    expect(s.map((p) => p.x)).toEqual([-120, 0, 120]);
    expect(s.every((p) => p.y === 0 && p.rotate === 0)).toBe(true);
  });

  it('fills a grid in reading order', () => {
    const s = layoutOf([card, card, card, card], { ...DEFAULT_LAYOUT, kind: 'grid', cols: 2, gap: 0 });
    expect(s.map((p) => [p.x, p.y])).toEqual([
      [-50, -70],
      [50, -70],
      [-50, 70],
      [50, 70],
    ]);
  });

  it('fans a hand symmetrically, turned through the spread', () => {
    const s = layoutOf([card, card, card, card, card], { ...DEFAULT_LAYOUT, kind: 'fan', spread: 40, curve: 0.5, gap: 0 });
    expect(s[0].rotate).toBeCloseTo(-20);
    expect(s[4].rotate).toBeCloseTo(20);
    expect(s[2].rotate).toBeCloseTo(0);
    expect(s[0].x).toBeCloseTo(-s[4].x);
    // The middle card rides highest.
    expect(s[2].y).toBeLessThan(s[0].y);
  });
});
