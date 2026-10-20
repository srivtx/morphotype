import { describe, expect, it } from 'vitest';
import { animatedValue, applyMat, bezierAt, DEFAULT_TRANSITION, loopPeriod, motionReach, newMotion, placement, poseAt, poseMatrix, progressAt, settleTime, springAt, springOf } from './motion';

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
    const mid = parseInt(String(animatedValue('#000000', { ...a, to: '#ffffff' }, 0.5)).slice(1, 3), 16);
    expect(Math.abs(mid - 127.5)).toBeLessThanOrEqual(1);
  });
});
