import { describe, expect, it } from 'vitest';
import { fitGradient, type Quantized } from './pixelArt';

/** A 20×20 picture of one ink whose colour comes from `f(x, y)`. */
function picture(f: (x: number, y: number) => [number, number, number]): Quantized {
  const w = 20, h = 20;
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set(f(x, y), (y * w + x) * 3);
  return { w, h, palette: ['#808080'], index: new Uint8Array(w * h), counts: [w * h], rgb };
}
const box = { x0: 0, y0: 0, x1: 20, y1: 20 };

describe('fitGradient', () => {
  it('finds a top-to-bottom ramp and its colours', () => {
    const g = fitGradient(picture((_, y) => [10 * y, 10 * y, 10 * y]), 0, box)!;
    expect(g.angle).toBeCloseTo(180, -1);
    expect(parseInt(g.fill.slice(1, 3), 16)).toBeLessThan(20);
    expect(parseInt(g.fill2.slice(1, 3), 16)).toBeGreaterThan(170);
    expect(g.gradStart).toBeLessThan(0.1);
    expect(g.gradEnd).toBeGreaterThan(0.9);
  });

  it('follows a left-to-right ramp', () => {
    const g = fitGradient(picture((x) => [255 - 8 * x, 40, 8 * x]), 0, box)!;
    // Brightness falls to the right (red → blue), so the ramp runs right to left.
    expect([90, 270]).toContain(Math.round(g.angle / 90) * 90);
  });

  it('leaves flat colour flat', () => {
    expect(fitGradient(picture(() => [30, 140, 90]), 0, box)).toBeNull();
  });
});
