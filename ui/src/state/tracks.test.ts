import { describe, expect, it } from 'vitest';
import { background, fill, group, style, symbolLayer, type Project } from './model';
import { DEFAULT_TRANSITION, newMotion, settleTime } from './motion';
import { rowsOf, snapTime, tracksOf } from './tracks';

const square = (name: string) => symbolLayer('roundRect', 100, { name, style: style('flat', { fill: '#ff0000' }) }, { radius: 0.1 });
const project = (layers: Project['layers']): Project => ({ version: 2, name: 't', canvas: { width: 400, height: 400 }, layers, background: background(fill('solid', '#ffffff')), fonts: [], timeline: { duration: 6, loop: true } });

describe('timeline rows', () => {
  it('lists only what moves, top of the stack first, plus the selection', () => {
    const a = square('A');
    const b = square('B');
    const c = square('C');
    b.motion = newMotion({ loop: 'float', amount: 10 });
    const p = project([a, b, c]);
    expect(rowsOf(p, []).map((r) => r.node.name)).toEqual(['B']);
    expect(rowsOf(p, [c.id]).map((r) => r.node.name)).toEqual(['C', 'B']);
  });

  it("places a staggered group's children one after another", () => {
    const kids = [square('A'), square('B'), square('C')];
    const g = group(kids, { name: 'G', motion: newMotion({ enter: 'rise', distance: 50, delay: 0.5, stagger: 0.2 }) });
    const rows = rowsOf(project([g]), []);
    expect(rows.map((r) => [r.node.name, r.depth])).toEqual([
      ['G', 0],
      ['C', 1],
      ['B', 1],
      ['A', 1],
    ]);
    const settle = settleTime(g.motion!.transition);
    const span = rows[0].tracks[0];
    expect(span.kind === 'enter' && [span.start, span.end, span.children]).toEqual([0.5, 0.5 + 0.4 + settle, 3]);
    const c = rows[1].tracks[0];
    expect(c.kind === 'enter' && [c.owner, c.index, c.start]).toEqual([g.id, 2, 0.5 + 0.4]);
  });

  it("shows Then with stops as one clip with a step for each", () => {
    const smooth = { ...DEFAULT_TRANSITION, duration: 1, ease: [0, 0, 1, 1] as [number, number, number, number] };
    const a = square('A');
    a.motion = newMotion({ leave: 'move', toX: 100, leaveAt: 1, transition: smooth, stops: [{ x: 100, y: 100, hold: 0.5 }, { x: 0, y: 100 }] });
    const [then] = tracksOf(a, { duration: 6, loop: true });
    expect(then.kind === 'leave' && [then.start, then.end, then.label, then.steps]).toEqual([
      1,
      4.5,
      'Move to… · 3 stops',
      [
        { start: 1, end: 2 },
        { start: 2.5, end: 3.5 },
        { start: 3.5, end: 4.5 },
      ],
    ]);
    // A staggered group's stops play on each child in turn.
    const g = group([square('B'), square('C')], { name: 'G', motion: newMotion({ ...a.motion, stagger: 0.5 }) });
    const c = rowsOf(project([g]), [])[1].tracks[0];
    expect(c.kind === 'leave' && c.steps?.map((p) => p.start)).toEqual([1.5, 3, 4]);
    expect(rowsOf(project([g]), [])[0].tracks[0]).toMatchObject({ end: 5, steps: undefined });
    // Without stops, nothing changes.
    a.motion.stops = undefined;
    expect(tracksOf(a, { duration: 6, loop: true })[0]).toMatchObject({ start: 1, end: 2, label: 'Move to…', steps: undefined });
  });

  it('shows loops at the cycle the clock really plays', () => {
    const a = square('A');
    a.motion = newMotion({ loop: 'sway', amount: 5, period: 2.5 });
    a.style.animate = { fill: { to: '#0000ff', period: 4, phase: 0, mode: 'swing' } };
    const [loop, fill] = tracksOf(a, { duration: 6, loop: true });
    // 6 s holds 2 whole cycles of 2.5 s → 3 s; 1.5 of 4 s → 2 (rounded) → 3 s.
    expect(loop.kind === 'loop' && loop.period).toBeCloseTo(3);
    expect(fill.kind === 'param' && [fill.label, fill.color]).toEqual(['Fill', true]);
    // Playing once, nothing is fitted.
    expect(tracksOf(a, { duration: 6, loop: false })[0]).toMatchObject({ period: 2.5 });
  });
});

describe('snapTime', () => {
  it('lands on whole frames, or on a target close by', () => {
    // 0.523 s is frame 15.69 → frame 16.
    expect(snapTime(0.523, 30, [], 0.05)).toBeCloseTo(16 / 30, 6);
    expect(snapTime(0.523, 30, [0.5], 0.05)).toBe(0.5);
    expect(snapTime(0.7, 30, [0.5], 0.05)).toBeCloseTo(0.7);
  });
});

describe('key rows', () => {
  it('lists a track per keyed property, and a keyed setting drops its cycle track', () => {
    const a = square('A');
    a.keys = { rotation: [{ t: 0, v: 0 }, { t: 1, v: 45 }] };
    a.style.keys = { fill: [{ t: 0, v: '#ffffff' }, { t: 2, v: '#000000' }] };
    a.style.animate = { fill: { to: '#00ff00', period: 2, phase: 0, mode: 'swing' } };
    const rows = rowsOf(project([a]), []);
    expect(rows[0].tracks.map((k) => [k.kind, 'label' in k ? k.label : ''])).toEqual([
      ['keys', 'Rotation'],
      ['keys', 'Fill'],
    ]);
    const fill = rows[0].tracks[1];
    expect(fill.kind === 'keys' && [fill.scope, fill.color]).toEqual(['style', true]);
  });
});
