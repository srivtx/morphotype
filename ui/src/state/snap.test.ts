import { describe, expect, it } from 'vitest';
import { noTargets, sizeTargets, snapPoint, spacingTargets } from './snap';

describe('snapPoint', () => {
  it('lands on a nearby point and reports both guides', () => {
    const r = snapPoint({ x: 102, y: 49 }, { ...noTargets(), points: [{ x: 100, y: 50 }] }, 5);
    expect(r.p).toEqual({ x: 100, y: 50 });
    expect(r.guides).toEqual([
      { axis: 'x', at: 100 },
      { axis: 'y', at: 50 },
    ]);
  });

  it('lines up with a point that is far away along one axis (smart guide)', () => {
    const r = snapPoint({ x: 203, y: 400 }, { ...noTargets(), points: [{ x: 200, y: 0 }] }, 5);
    expect(r.p).toEqual({ x: 200, y: 400 });
    expect(r.guides).toEqual([{ axis: 'x', at: 200 }]);
  });

  it('picks the nearest line and leaves free axes alone, or on the grid', () => {
    const t = { xs: [0, 8], ys: [], points: [] };
    expect(snapPoint({ x: 6, y: 13 }, t, 5).p).toEqual({ x: 8, y: 13 });
    expect(snapPoint({ x: 6, y: 13 }, t, 5, 10).p).toEqual({ x: 8, y: 10 });
    expect(snapPoint({ x: 50, y: 50 }, t, 5).guides).toEqual([]);
  });
});

describe('spacingTargets', () => {
  const a: [number, number, number, number] = [0, 0, 100, 100];
  const b: [number, number, number, number] = [300, 0, 400, 100];
  it('offers the midpoint between neighbours and their existing gap', () => {
    const t = spacingTargets([150, 10, 200, 60], [a, b], 'x');
    expect(t.centre).toEqual([200]);
    // The gap a→b is 200: one gap right of b, one gap left of a.
    expect(t.start).toContain(600);
    expect(t.end).toContain(-200);
  });
  it('ignores boxes outside the row', () => {
    expect(spacingTargets([150, 500, 200, 560], [a, b], 'x')).toEqual({ start: [], end: [], centre: [] });
  });
});

describe('sizeTargets', () => {
  it('turns sizes into edge positions from the anchor', () => {
    expect(sizeTargets(10, 1, [50, 0])).toEqual([60]);
    expect(sizeTargets(10, -1, [50])).toEqual([-40]);
  });
});
