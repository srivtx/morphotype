import { describe, expect, it } from 'vitest';
import { addStop, animatedValue, applyMat, bezierAt, DEFAULT_TRANSITION, FEELS, feelOf, lastSlot, leaveEnd, legsOf, loopPeriod, motionEnd, motionReach, newMotion, placement, poseAt, poseMatrix, progressAt, settleTime, springAt, springOf, staggerSlot } from './motion';

describe('transitions', () => {
  it('eases like CSS cubic-bezier', () => {
    expect(bezierAt([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3, 4);
    expect(bezierAt([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 4);
    // ease-out is ahead of linear, ease-in behind.
    expect(bezierAt([0.16, 1, 0.3, 1], 0.25)).toBeGreaterThan(0.6);
    expect(bezierAt([0.7, 0, 0.84, 0], 0.25)).toBeLessThan(0.05);
    expect(bezierAt([0.34, 1.56, 0.64, 1], 0.6)).toBeGreaterThan(1);
  });

  it('springs start at rest, overshoot when bouncy and settle at 1', () => {
    const bouncy = springOf({ ...DEFAULT_TRANSITION, type: 'time', duration: 0.5, bounce: 0.5 });
    expect(springAt(bouncy, 0)).toBe(0);
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => springAt(bouncy, i / 100)));
    expect(peak).toBeGreaterThan(1.05);
    expect(springAt(bouncy, 5)).toBeCloseTo(1, 3);
    // No bounce: critically damped, never past 1.
    const firm = springOf({ ...DEFAULT_TRANSITION, type: 'time', duration: 0.5, bounce: 0 });
    expect(Math.max(...Array.from({ length: 300 }, (_, i) => springAt(firm, i / 100)))).toBeLessThanOrEqual(1 + 1e-9);
    // Overdamped physics springs crawl in from below.
    const slow = springOf({ ...DEFAULT_TRANSITION, type: 'physics', stiffness: 100, damping: 60, mass: 1 });
    expect(springAt(slow, 0.5)).toBeGreaterThan(0);
    expect(springAt(slow, 0.5)).toBeLessThan(1);
    expect(springAt(slow, 30)).toBeCloseTo(1, 4);
  });

  it('has settled by its settle time', () => {
    for (const t of [
      { ...DEFAULT_TRANSITION, type: 'time' as const, bounce: 0.3 },
      { ...DEFAULT_TRANSITION, type: 'physics' as const, stiffness: 300, damping: 10, mass: 1 },
      { ...DEFAULT_TRANSITION, type: 'easing' as const, duration: 0.8 },
    ]) {
      const end = settleTime(t);
      expect(Math.abs(progressAt(t, end) - 1)).toBeLessThan(0.01);
    }
  });
});

describe('poses', () => {
  it('fits loops to a whole number of cycles on a looping timeline', () => {
    expect(loopPeriod(2.3, 6)).toBeCloseTo(2, 6);
    expect(loopPeriod(10, 6)).toBe(6);
    const m = newMotion({ loop: 'float', amount: 20, period: 2.3 });
    expect(poseAt(m, 6, 6).y).toBeCloseTo(poseAt(m, 0, 6).y, 6);
  });

  it('enters from its offset and arrives at rest', () => {
    const m = newMotion({ enter: 'rise', distance: 100, delay: 0.5 });
    expect(poseAt(m, 0).y).toBe(100);
    expect(poseAt(m, 0).opacity).toBe(0);
    const done = poseAt(m, 0.5 + settleTime(m.transition) + 1);
    expect(done.y).toBeCloseTo(0, 1);
    expect(done.opacity).toBe(1);
  });

  it('turns and scales about the pivot', () => {
    const m = poseMatrix({ x: 0, y: 0, rotate: 90, scale: 2, opacity: 1 }, [10, 10]);
    expect(applyMat(m, 10, 10)).toEqual([10, 10]);
    const [x, y] = applyMat(m, 11, 10);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(12);
  });

  it('staggers children by their offset', () => {
    const m = newMotion({ loop: 'slide', amount: 50, period: 2 });
    const a = placement([{ motion: m, pivot: [0, 0], offset: 0 }], 0.5);
    const b = placement([{ motion: m, pivot: [0, 0], offset: 0.5 }], 1);
    expect(a.m[4]).toBeCloseTo(b.m[4]);
    expect(a.m[4]).toBeCloseTo(50);
  });

  it('measures how far motion carries a box', () => {
    const m = newMotion({ loop: 'slide', amount: 80, period: 2 });
    const times = Array.from({ length: 41 }, (_, i) => i / 10);
    expect(motionReach([{ motion: m, pivot: [0, 0], offset: 0 }], [-10, -10, 10, 10], times)).toBe(80);
  });
});

describe('animated settings', () => {
  it('swings numbers and blends colours', () => {
    const a = { to: 10, period: 2, phase: 0, mode: 'swing' as const };
    expect(animatedValue(0, a, 0)).toBeCloseTo(0);
    expect(animatedValue(0, a, 1)).toBeCloseTo(10);
    expect(animatedValue(0, a, 2)).toBeCloseTo(0);
    expect(animatedValue(0, { ...a, mode: 'ramp' }, 1)).toBeCloseTo(5);
    expect(animatedValue('#000000', { ...a, to: '#ffffff' }, 1)).toBe('#ffffff');
    // Flicker holds steps of a third, the same at the same time.
    const fl = { ...a, mode: 'flicker' as const };
    const steps = Array.from({ length: 40 }, (_, i) => animatedValue(0, fl, i * 0.13) as number);
    expect(steps.every((v) => [0, 10 / 3, 20 / 3, 10].some((s) => Math.abs(v - s) < 1e-9))).toBe(true);
    expect(new Set(steps.map((v) => v.toFixed(3))).size).toBeGreaterThan(2);
    expect(animatedValue(0, fl, 0.3)).toBe(animatedValue(0, fl, 0.3));
    // Hold waits at its value, goes to To, waits a moment, and is back by the end of the cycle.
    const ho = { ...a, mode: 'hold' as const };
    expect(animatedValue(0, ho, 0)).toBe(0);
    expect(animatedValue(0, ho, 2 * 0.35)).toBe(0);
    expect(animatedValue(0, ho, 2 * 0.55)).toBeGreaterThan(5);
    expect(animatedValue(0, ho, 2 * 0.65)).toBeCloseTo(10);
    expect(animatedValue(0, ho, 2 * 0.85)).toBeGreaterThan(0);
    expect(animatedValue(0, ho, 2 * 0.999)).toBeLessThan(0.01);
    const mid = parseInt(String(animatedValue('#000000', { ...a, to: '#ffffff' }, 0.5)).slice(1, 3), 16);
    expect(Math.abs(mid - 127.5)).toBeLessThanOrEqual(1);
  });
});

describe('moves, Then, slides and stagger order', () => {
  const smooth = { ...DEFAULT_TRANSITION, type: 'easing' as const, duration: 1, ease: [0, 0, 1, 1] as [number, number, number, number] };

  it('moves in from where it starts to its place, without fading', () => {
    const m = newMotion({ enter: 'move', fromX: -200, fromY: 50, transition: smooth });
    expect(poseAt(m, 0)).toMatchObject({ x: -200, y: 50, opacity: 1 });
    expect(poseAt(m, 0.5)).toMatchObject({ x: -100, y: 25 });
    expect(poseAt(m, 1)).toMatchObject({ x: 0, y: 0 });
  });

  it('then moves on to where it goes and stays', () => {
    const m = newMotion({ leave: 'move', toX: 300, leaveAt: 2, transition: smooth });
    expect(poseAt(m, 1.9).x).toBe(0);
    expect(poseAt(m, 2.5).x).toBeCloseTo(150);
    expect(poseAt(m, 5)).toMatchObject({ x: 300, opacity: 1 });
    // Fades leave fading.
    expect(poseAt(newMotion({ leave: 'rise', leaveDistance: 40, leaveAt: 0, transition: smooth }), 1)).toMatchObject({ y: -40, opacity: 0 });
    expect(motionEnd(m)).toBe(3);
  });

  it('travels through every stop after Then, in order, holding at each', () => {
    const slow = { ...smooth, duration: 2 };
    const m = newMotion({ leave: 'move', toX: 300, leaveAt: 1, transition: smooth, stops: [{ x: 300, y: 200, hold: 0.5 }, { x: 0, y: 200, transition: slow }] });
    const at = (t: number) => {
      const p = poseAt(m, t);
      return [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000];
    };
    expect(at(0.5)).toEqual([0, 0]);
    expect(at(1.5)).toEqual([150, 0]);
    // Arrived at 2, holds until 2.5, then down to the second spot by 3.5.
    expect(at(2.2)).toEqual([300, 0]);
    expect(at(3)).toEqual([300, 100]);
    expect(at(3.5)).toEqual([300, 200]);
    // No hold: straight on, with its own two-second curve.
    expect(at(4.5)).toEqual([150, 200]);
    expect(at(6)).toEqual([0, 200]);
    expect(poseAt(m, 6).opacity).toBe(1);
    expect(legsOf(m).map((l) => [l.start, l.end])).toEqual([
      [1, 2],
      [2.5, 3.5],
      [3.5, 5.5],
    ]);
    expect(leaveEnd(m)).toBe(5.5);
    expect(motionEnd(m)).toBe(5.5);
    // Stops follow Then's curve unless they have their own; they only apply to Move to….
    expect(legsOf(m)[1].transition).toBe(smooth);
    expect(poseAt({ ...m, leave: 'right', leaveDistance: 100 }, 6)).toMatchObject({ x: 100, y: 0 });
    expect(legsOf({ ...m, leave: 'right' })).toEqual([]);
  });

  it('adds each new stop a turn to the right of the way it was going', () => {
    const m = newMotion({ leave: 'move', toX: 200, toY: 0, leaveAt: 1 });
    expect(addStop(m)).toMatchObject({ x: 200, y: 160 });
    expect(addStop(m)).toMatchObject({ x: 40, y: 160 });
    expect(m.stops).toHaveLength(2);
    // Files without stops play as they did.
    const old = newMotion({ leave: 'move', toX: 200, leaveAt: 1, transition: smooth });
    expect(poseAt(old, 1.5).x).toBeCloseTo(100);
    expect(leaveEnd(old)).toBe(2);
  });

  it('slides one way in any direction, or there and back', () => {
    const one = newMotion({ loop: 'slide', amount: 100, period: 2, dir: 'left', oneWay: true });
    expect(poseAt(one, 0).x).toBeCloseTo(0);
    expect(poseAt(one, 1).x).toBeCloseTo(-50);
    expect(poseAt(one, 1.99).x).toBeCloseTo(-99.5);
    expect(poseAt(one, 2).x).toBeCloseTo(0);
    const up = newMotion({ loop: 'slide', amount: 100, period: 2, dir: 'up', oneWay: true });
    expect(poseAt(up, 1)).toMatchObject({ x: 0, y: -50 });
    // Files from before directions: a sine along x.
    const old = newMotion({ loop: 'slide', amount: 100, period: 2 });
    expect(poseAt(old, 0.5).x).toBeCloseTo(100);
    expect(poseAt(old, 1.5).x).toBeCloseTo(-100);
  });

  it('orders a stagger first to last, reversed, from the centre or shuffled', () => {
    expect([0, 1, 2, 3, 4].map((i) => staggerSlot('first', i, 5))).toEqual([0, 1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4].map((i) => staggerSlot('last', i, 5))).toEqual([4, 3, 2, 1, 0]);
    expect([0, 1, 2, 3, 4].map((i) => staggerSlot('centre', i, 5))).toEqual([2, 1, 0, 1, 2]);
    const shuffled = [0, 1, 2, 3, 4].map((i) => staggerSlot('random', i, 5, 42));
    expect([...shuffled].sort()).toEqual([0, 1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4].map((i) => staggerSlot('random', i, 5, 42))).toEqual(shuffled);
    expect(lastSlot('centre', 5)).toBe(2);
  });

  it('names the feel of a transition', () => {
    expect(feelOf(DEFAULT_TRANSITION)).toBe('Smooth');
    for (const f of FEELS) expect(feelOf(f.value)).toBe(f.label);
    expect(feelOf({ ...DEFAULT_TRANSITION, type: 'physics' })).toBeNull();
  });
});
