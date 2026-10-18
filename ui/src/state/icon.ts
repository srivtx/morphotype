// App icons by platform. macOS draws your icon as-is, so the rounded tile
// and its shadow belong in the artwork (Apple's grid: an 824 px squircle on a
// 1024 canvas). iOS, iPadOS, watchOS and Android launchers crop the corners
// themselves, so those icons are full-bleed squares.
import { pathLayer, style, symbolLayer, tile, type Background, type ShapeLayer, type Tile } from './model';

export type IconTarget = 'macos' | 'ios' | 'custom';

export const ICON_TARGETS: { value: IconTarget; label: string; hint: string }[] = [
  { value: 'macos', label: 'macOS', hint: 'Rounded tile with a shadow, drawn into the icon (824 of 1024 px).' },
  { value: 'ios', label: 'iOS, Android', hint: 'Full square. The system rounds the corners, so leave them square and preview the mask.' },
  { value: 'custom', label: 'Custom', hint: 'Any shape, for web, favicons and social avatars.' },
];

const MAC_SIZE = 824 / 1024;
/** Tile roundness that gives the macOS superellipse (exponent ≈ 5). */
const MAC_RADIUS = 0.8;

export function iconTarget(t: Tile | null): IconTarget | null {
  if (!t) return null;
  if (t.shape === 'squircle' && Math.abs(t.size - MAC_SIZE) < 0.01 && Math.abs(t.radius - MAC_RADIUS) < 0.02) return 'macos';
  if (t.shape === 'rounded' && t.size >= 0.999 && t.radius <= 0.001) return 'ios';
  return 'custom';
}

export function applyIconTarget(bg: Background, target: IconTarget) {
  const base = bg.tile ?? tile({ kind: 'linear', colors: ['#c9b8ff', '#8a63f5'], angle: 180 });
  if (target === 'macos') bg.tile = { ...base, shape: 'squircle', size: MAC_SIZE, radius: MAC_RADIUS, shadow: Math.max(base.shadow, 0.3) };
  else if (target === 'ios') bg.tile = { ...base, shape: 'rounded', size: 1, radius: 0, shadow: 0, rim: 0 };
  else bg.tile = { ...base, shape: 'squircle', size: 0.84, radius: 0.6 };
}

/** Outline of the system mask (iOS-style continuous corners) over a square of side `s`, centred. */
export function maskPath(s: number, cx = 0, cy = 0): string {
  const r = s / 2;
  const e = 5;
  const pts: string[] = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const x = Math.sign(c) * Math.abs(c) ** (2 / e) * r;
    const y = Math.sign(sn) * Math.abs(sn) ** (2 / e) * r;
    pts.push(`${(cx + x).toFixed(2)},${(cy + y).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/**
 * The app-icon design grid for a square of side `s` centred on the origin:
 * the icon shape, three keyline circles, a 4×4 grid and both diagonals.
 * Returned as polylines (closed ones loop) so they can draw as an overlay or
 * become stroke layers for presentation shots.
 */
export function iconGridLines(s: number): { pts: [number, number][]; closed: boolean }[] {
  const out: { pts: [number, number][]; closed: boolean }[] = [];
  const circle = (r: number) => out.push({ pts: Array.from({ length: 96 }, (_, i) => [r * Math.cos((i / 96) * Math.PI * 2), r * Math.sin((i / 96) * Math.PI * 2)] as [number, number]), closed: true });
  const e = s * 0.45;
  // The icon shape: a continuous-corner squircle.
  out.push({
    pts: Array.from({ length: 128 }, (_, i) => {
      const a = (i / 128) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      return [Math.sign(c) * Math.abs(c) ** 0.4 * e, Math.sign(sn) * Math.abs(sn) ** 0.4 * e] as [number, number];
    }),
    closed: true,
  });
  circle(s * 0.4);
  circle(s * 0.29);
  circle(s * 0.19);
  for (const k of [-0.41, -0.205, 0, 0.205, 0.41]) {
    out.push({ pts: [[k * s, -0.48 * s], [k * s, 0.48 * s]], closed: false });
    out.push({ pts: [[-0.48 * s, k * s], [0.48 * s, k * s]], closed: false });
  }
  out.push({ pts: [[-0.48 * s, -0.48 * s], [0.48 * s, 0.48 * s]], closed: false });
  out.push({ pts: [[-0.48 * s, 0.48 * s], [0.48 * s, -0.48 * s]], closed: false });
  return out;
}

/**
 * The icon grid as exact, cheap shapes (no distance fields): lines are thin
 * rectangles, keylines are rings, and the icon shape is a hairline path.
 */
export function iconGridLayers(s: number, color = '#8a8a8a', weight = Math.max(1.5, s * 0.0035)): ShapeLayer[] {
  const st = style('flat', { fill: color });
  const out: ShapeLayer[] = [];
  const lines = iconGridLines(s);
  // The icon shape: outer and inner squircle contours make a hairline ring.
  const e = s * 0.45;
  const sq = (r: number, rev: boolean) => {
    const pts = Array.from({ length: 128 }, (_, i) => {
      const a = ((rev ? 128 - i : i) / 128) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      return `${(Math.sign(c) * Math.abs(c) ** 0.4 * r).toFixed(2)} ${(Math.sign(sn) * Math.abs(sn) ** 0.4 * r).toFixed(2)}`;
    });
    return `M${pts.join('L')}Z`;
  };
  out.push(pathLayer(sq(e + weight / 2, false) + sq(e - weight / 2, true), 1, 'Icon shape', { style: st }));
  for (const r of [0.4, 0.29, 0.19]) out.push(symbolLayer('ring', r * 2 * s + weight, { name: 'Keyline', style: st }, { thickness: weight / (r * 2 * s + weight) }));
  for (const l of lines.filter((x) => !x.closed)) {
    const [[x0, y0], [x1, y1]] = l.pts;
    const len = Math.hypot(x1 - x0, y1 - y0);
    // A square squashed to the line weight (rectangle aspect is capped at 10:1).
    out.push(symbolLayer('roundRect', len, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rotation: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI, sy: weight / len, name: 'Grid line', style: st }, { radius: 0, aspect: 1 }));
  }
  return out;
}
