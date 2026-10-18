// One colour in, a whole material out. Each material's colour parameters
// have a role (base, shadow, highlight…); recolouring derives every role from
// a single pick in OKLCH so chrome, puffy or aura stay believable in any hue.
import type { Style } from '../state/model';
import { effectById } from './effects';
import { hexToRgb } from './gl';

export type ColorRole = 'base' | 'shadow' | 'deep' | 'light' | 'soft' | 'highlight' | 'accent' | 'side' | 'keep';

/** Roles per effect parameter. Parameters left out keep their colour. */
export const COLOR_ROLES: Record<string, Record<string, ColorRole>> = {
  flat: { fill: 'base', fill2: 'accent' },
  chrome: { c1: 'shadow', c2: 'base', c3: 'light', c4: 'highlight', rimColor: 'light' },
  glass: { glow: 'base', body: 'deep' },
  inflate: { body: 'soft', shade: 'base' },
  sticker: { fill: 'base' },
  aura: { c1: 'base', c2: 'shadow', c3: 'light', c4: 'highlight' },
  holo: { body: 'deep' },
  extrude: { face: 'base', side: 'side' },
  icon: { glyph: 'base' },
  neon: { color: 'base', core: 'highlight' },
  distressed: { ink: 'base' },
  emboss: { color: 'base' },
  halftone: { ink: 'base' },
  riso: { ink: 'base', ink2: 'accent' },
};

// ---------- OKLCH ----------

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

export function oklchToHex(L: number, C: number, H: number): string {
  // Reduce chroma until the colour fits in sRGB.
  for (let c = C; c >= 0; c -= 0.005) {
    const h = (H * Math.PI) / 180;
    const A = c * Math.cos(h);
    const B = c * Math.sin(h);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    if (rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4) || c < 0.005) {
      return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return '#000000';
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A colour for `role`, derived from the picked colour. */
export function roleColor(hex: string, role: ColorRole): string {
  const [L, C, H] = hexToOklch(hex);
  switch (role) {
    case 'base':
    case 'keep':
      return hex.toLowerCase();
    case 'shadow':
      return oklchToHex(clamp01(L * 0.32), C * 0.8, H);
    case 'deep':
      return oklchToHex(0.12, Math.min(C, 0.04), H);
    case 'light':
      return oklchToHex(clamp01(L + (1 - L) * 0.55), C * 0.7, H);
    case 'soft':
      return oklchToHex(clamp01(Math.max(0.92, L + 0.3)), C * 0.25, H);
    case 'highlight':
      return oklchToHex(0.97, C * 0.15, H);
    case 'accent':
      return oklchToHex(clamp01(L * 0.9 + 0.05), Math.max(C, 0.12), (H + 48) % 360);
    case 'side':
      return oklchToHex(clamp01(L * 0.62), C * 1.05, (H + 345) % 360);
  }
}

/** The parameter that best represents a style's colour. */
export function primaryColorKey(st: Style): string | null {
  const roles = COLOR_ROLES[st.effect] ?? {};
  const base = Object.entries(roles).find(([, r]) => r === 'base')?.[0];
  if (base) return base;
  return effectById(st.effect).params.find((p) => p.type === 'color')?.key ?? null;
}

export function primaryColor(st: Style): string | null {
  const k = primaryColorKey(st);
  return k ? String(st.params[k] ?? effectById(st.effect).params.find((p) => p.key === k)?.default ?? '#000000') : null;
}

/** Recolour a whole material from one colour. */
export function recolor(st: Style, hex: string): Style {
  const roles = COLOR_ROLES[st.effect];
  const params = { ...st.params };
  if (!roles) {
    const k = primaryColorKey(st);
    if (k) params[k] = hex;
    return { ...st, params };
  }
  for (const [k, role] of Object.entries(roles)) params[k] = roleColor(hex, role);
  return { ...st, params };
}

/** Relative luminance 0..1 of a colour (for picking readable defaults). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Curated one-click colours shown next to materials. */
export const QUICK_COLORS = ['#f4f1ea', '#0a0a0a', '#ff3d2e', '#ff7a1a', '#ffd23f', '#b4f22e', '#2bd67b', '#28c8ff', '#2b6bff', '#7b4dff', '#ff4fb1', '#c8a27a'];
