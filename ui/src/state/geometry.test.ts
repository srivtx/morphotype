import { describe, expect, it } from 'vitest';
import { apply, invert, parsePath, serializePath, splitSegment, toggleSmooth, warpNet } from './geometry';

describe('geometry', () => {
  it('inverts layer transforms', () => {
    const t = { x: 10, y: -4, rotation: 33, scale: 2, sx: -1.5, sy: 0.7 };
    const p = { x: 3, y: 9 };
    const q = invert(t, apply(t, p));
    expect(q.x).toBeCloseTo(p.x, 9);
    expect(q.y).toBeCloseTo(p.y, 9);
  });

  it('parses quadratic, relative and shorthand commands into cubic nodes', () => {
    const cs = parsePath('M0 0Q10 0 10 10L0 10Zm20 0h5v5h-5z');
    expect(cs.length).toBe(2);
    expect(cs[0].nodes.length).toBe(3);
    expect(cs[0].nodes[0].hout).toBeDefined();
    expect(cs[1].nodes.map((n) => [n.x, n.y])).toEqual([
      [20, 0],
      [25, 0],
      [25, 5],
      [20, 5],
    ]);
    const again = parsePath(serializePath(cs));
    expect(parsePath(serializePath(again))).toEqual(again);
    expect(again[0].nodes[1].hin!.y).toBeCloseTo(cs[0].nodes[1].hin!.y, 4);
  });

  it('splits curves without changing them and toggles smoothness', () => {
    const cs = parsePath('M0 0C0 -10 20 -10 20 0L20 10L0 10Z');
    splitSegment(cs[0], 0, 0.5);
    expect(cs[0].nodes.length).toBe(5);
    expect(cs[0].nodes[1].y).toBeCloseTo(-7.5, 6);
    toggleSmooth(cs[0], 3);
    expect(cs[0].nodes[3].hin).toBeDefined();
    toggleSmooth(cs[0], 3);
    expect(cs[0].nodes[3].hin).toBeUndefined();
  });

  it('matches the engine warp presets', () => {
    // Same numbers as warp_net in crates/morpho-core/src/modifiers.rs.
    const arch = warpNet('arch', 0.5, []);
    expect(arch[1][1]).toBeCloseTo(-0.21, 9);
    expect(arch[0]).toEqual([0, 0]);
    const custom = warpNet('custom', 0, [[0.1, 0.2]]);
    expect(custom[0]).toEqual([0.1, 0.2]);
  });
});
