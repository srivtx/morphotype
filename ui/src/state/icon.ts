// App icons by platform. macOS draws your icon as-is, so the rounded tile
// and its shadow belong in the artwork (Apple's grid: an 824 px squircle on a
// 1024 canvas). iOS, iPadOS, watchOS and Android launchers crop the corners
// themselves, so those icons are full-bleed squares.
import { tile, type Background, type Tile } from './model';

export type IconTarget = 'macos' | 'ios' | 'custom';

export const ICON_TARGETS: { value: IconTarget; label: string; hint: string }[] = [
  { value: 'macos', label: 'macOS', hint: 'Rounded tile with a shadow, drawn into the icon (824 of 1024 px).' },
  { value: 'ios', label: 'iOS · Android', hint: 'Full square. The system rounds the corners, so leave them square and preview the mask.' },
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
