// Artboard background: page fill (solid, linear, radial or aura mesh), an
// optional app-icon tile with gloss, shadow and rim light, and film grain.
import type { Background, Fill, Pattern } from '../state/model';
import { hexToRgb, type UniformValue } from './gl';

export const BG_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform vec2 u_art;
uniform float u_pKind, u_pN, u_pAngle;
uniform vec3 u_p0, u_p1, u_p2, u_p3;
uniform float u_tOn, u_tShape, u_tSize, u_tRadius, u_tKind, u_tN, u_tAngle, u_tGloss, u_tShadow, u_tRim, u_tHolo;
uniform vec3 u_t0, u_t1, u_t2, u_t3, u_tRimColor;
uniform float u_grain, u_checker, u_k;
uniform float u_patKind, u_patSize, u_patWeight, u_patOpacity;
uniform vec3 u_patColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 spectrum(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
vec3 ramp(float t, float n, vec3 a, vec3 b, vec3 c, vec3 d) {
  t = clamp(t, 0.0, 1.0);
  if (n < 1.5) return a;
  if (n < 2.5) return mix(a, b, t);
  if (n < 3.5) return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
  float s = t * 3.0;
  return s < 1.0 ? mix(a, b, s) : s < 2.0 ? mix(b, c, s - 1.0) : mix(c, d, s - 2.0);
}
float blob(vec2 q, vec2 c, vec2 r) { vec2 k = (q - c) / r; return exp(-dot(k, k) * 1.6); }
/** Colour of a fill at q (0..1 over its box), aspect = box w / h. */
vec3 fillColor(float kind, float n, float angle, vec3 a, vec3 b, vec3 c, vec3 d, vec2 q, float aspect) {
  if (kind < 1.5) return a;
  if (kind < 2.5) {
    float r = radians(angle);
    vec2 p = (q - 0.5) * vec2(aspect, 1.0);
    vec2 dir = vec2(sin(r), -cos(r));
    float ext = 0.5 * (abs(dir.x) * aspect + abs(dir.y));
    return ramp(dot(p, dir) / (2.0 * ext) + 0.5, n, a, b, c, d);
  }
  if (kind < 3.5) return ramp(length((q - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0)) * 1.55, n, a, b, c, d);
  // Aura mesh: base colour with soft blobs of the others.
  float s = radians(angle);
  vec2 A = vec2(0.5 + 0.32 * cos(s), 0.3 + 0.2 * sin(s * 1.3));
  vec2 B = vec2(0.5 + 0.3 * cos(s + 2.3), 0.72 + 0.18 * sin(s + 1.1));
  vec2 C = vec2(0.5 + 0.34 * sin(s * 0.7 + 2.0), 0.5 + 0.3 * cos(s * 1.9));
  vec3 col = a;
  if (n > 1.5) col = mix(col, b, blob(q, A, vec2(0.42, 0.34)) * 0.95);
  if (n > 2.5) col = mix(col, c, blob(q, B, vec2(0.38, 0.32)) * 0.9);
  if (n > 3.5) col = mix(col, d, blob(q, C, vec2(0.22, 0.24)) * 0.7);
  return col;
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
/** Hand-drawn doodles scattered one per cell: squiggles, crosses, dots, rings, arcs and pluses. */
float doodleAt(vec2 q, float s, float w, float aa) {
  vec2 cell = floor(q / s);
  float h = hash12(cell * 1.37 + 0.5), h2 = hash12(cell * 2.11 + 7.3), h3 = hash12(cell * 3.7 + 1.9);
  vec2 c = (cell + 0.5 + (vec2(h2, h3) - 0.5) * 0.3) * s;
  float ang = h2 * 6.2832;
  vec2 p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (q - c);
  float r = s * 0.24;
  float f;
  if (h < 0.24) {
    float x = clamp(p.x, -r * 1.3, r * 1.3);
    f = length(vec2(p.x - x, (p.y - sin(x / r * 3.14159) * r * 0.42) * 0.8));
  } else if (h < 0.4) {
    f = min(sdSeg(p, vec2(-r, -r) * 0.6, vec2(r, r) * 0.6), sdSeg(p, vec2(-r, r) * 0.6, vec2(r, -r) * 0.6));
  } else if (h < 0.62) {
    f = length(p) - r * 0.32 + w;
  } else if (h < 0.76) {
    f = abs(length(p) - r * 0.55);
  } else if (h < 0.9) {
    float a = atan(p.y, p.x);
    f = abs(a) < 2.0 ? abs(length(p) - r * 0.7) : min(length(p - r * 0.7 * vec2(cos(2.0), sin(2.0))), length(p - r * 0.7 * vec2(cos(2.0), -sin(2.0))));
  } else {
    f = min(sdSeg(p, vec2(-r, 0.0) * 0.6, vec2(r, 0.0) * 0.6), sdSeg(p, vec2(0.0, -r) * 0.6, vec2(0.0, r) * 0.6));
  }
  return 1.0 - smoothstep(w - aa, w + aa, f);
}
/** Coverage of the page pattern at artboard pixel px (centred on the artboard). */
float patternAt(vec2 px) {
  if (u_patKind < 0.5) return 0.0;
  float s = max(u_patSize, 2.0);
  vec2 q = px - 0.5 * u_art;
  float aa = 0.75 / u_k;
  float w = u_patWeight * 0.5;
  if (u_patKind < 1.5) {
    vec2 g = abs(fract(q / s + 0.5) - 0.5) * s;
    return 1.0 - smoothstep(w - aa, w + aa, min(g.x, g.y));
  }
  if (u_patKind < 2.5) {
    vec2 v = (fract(q / s) - 0.5) * s;
    return 1.0 - smoothstep(u_patWeight - aa, u_patWeight + aa, length(v));
  }
  if (u_patKind < 3.5) {
    float g = abs(fract(q.y / s + 0.5) - 0.5) * s;
    return 1.0 - smoothstep(w - aa, w + aa, g);
  }
  if (u_patKind < 4.5) {
    float g = abs(fract(dot(q, vec2(0.70711)) / s + 0.5) - 0.5) * s;
    return 1.0 - smoothstep(w - aa, w + aa, g);
  }
  if (u_patKind < 5.5) {
    vec2 c = floor(q / s);
    return mod(c.x + c.y, 2.0) < 1.0 ? 1.0 : 0.0;
  }
  return doodleAt(q, s, w, aa);
}
float tileSd(vec2 c, float r) {
  if (u_tShape < 0.5) {
    float e = mix(12.0, 3.2, u_tRadius);
    vec2 a = abs(c) / r;
    return (pow(pow(a.x, e) + pow(a.y, e), 1.0 / e) - 1.0) * r;
  }
  if (u_tShape < 1.5) {
    float cr = u_tRadius * r;
    vec2 q = abs(c) - vec2(r - cr);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cr;
  }
  return length(c) - r;
}
void main() {
  vec2 px = v_uv * u_art;
  vec4 col;
  if (u_pKind < 0.5) {
    vec2 c = floor(px * u_k / 10.0);
    vec3 chk = mod(c.x + c.y, 2.0) < 1.0 ? vec3(0.16) : vec3(0.22);
    col = u_checker > 0.5 ? vec4(chk, 1.0) : vec4(0.0);
  } else {
    col = vec4(fillColor(u_pKind, u_pN, u_pAngle, u_p0, u_p1, u_p2, u_p3, v_uv, u_art.x / u_art.y), 1.0);
  }
  float pat = patternAt(px) * u_patOpacity;
  if (pat > 0.0) col = vec4(mix(col.rgb, u_patColor, pat), max(col.a, pat));
  if (u_tOn > 0.5) {
    vec2 c = px - 0.5 * u_art;
    float r = u_tSize * 0.5 * min(u_art.x, u_art.y);
    float td = tileSd(c, r);
    float aa = 0.75 / u_k;
    // Soft drop shadow under the tile.
    float sd = tileSd(c - vec2(0.0, 0.04 * r), r);
    float shadow = (1.0 - smoothstep(-0.06 * r, 0.1 * r, sd)) * u_tShadow * 0.6;
    col.rgb *= 1.0 - shadow;
    col.a = max(col.a, shadow);
    float cov = clamp(0.5 - td / aa, 0.0, 1.0);
    vec2 q = (c / r) * 0.5 + 0.5;
    vec3 t = fillColor(u_tKind, u_tN, u_tAngle, u_t0, u_t1, u_t2, u_t3, q, 1.0);
    float edge = exp(min(td, 0.0) / (r * 0.05));
    t += edge * 0.16 * u_tGloss * smoothstep(0.3 * r, -r, c.y);
    t = mix(t, vec3(1.0), u_tGloss * 0.16 * smoothstep(0.0, -r, c.y));
    if (u_tRim > 0.0) {
      float rim = exp(min(td, 0.0) / max(u_tRim, 0.5));
      vec3 rc = u_tHolo > 0.5 ? mix(spectrum(atan(c.y, c.x) / 6.28318 + q.x * 0.6 + q.y * 0.4), vec3(1.0), 0.35) : u_tRimColor;
      t = mix(t, rc, rim * 0.9);
    }
    col = vec4(mix(col.rgb, t, cov), max(col.a, cov));
  }
  float g = (hash12(floor(px * u_k)) - 0.5) * u_grain * 0.16;
  col.rgb += g * col.a;
  o = vec4(col.rgb * col.a, col.a);
}`;

const KIND = { none: 0, solid: 1, linear: 2, radial: 3, aura: 4 } as const;
const PATTERN = { grid: 1, dots: 2, lines: 3, diagonal: 4, checker: 5, doodles: 6 } as const;

function fillUniforms(prefix: 'p' | 't', f: Fill): Record<string, UniformValue> {
  const cs = f.colors.length ? f.colors : ['#000000'];
  const at = (i: number) => hexToRgb(cs[Math.min(i, cs.length - 1)]);
  return {
    [`u_${prefix}Kind`]: KIND[f.kind] ?? 1,
    [`u_${prefix}N`]: Math.min(4, cs.length),
    [`u_${prefix}Angle`]: f.angle ?? 180,
    [`u_${prefix}0`]: at(0),
    [`u_${prefix}1`]: at(1),
    [`u_${prefix}2`]: at(2),
    [`u_${prefix}3`]: at(3),
  };
}

export function backgroundUniforms(bg: Background): Record<string, UniformValue> {
  const t = bg.tile;
  const pt = bg.pattern;
  const u: Record<string, UniformValue> = {
    ...fillUniforms('p', bg.fill),
    u_grain: bg.grain,
    u_tOn: !!t,
    u_patKind: pt ? PATTERN[pt.kind] : 0,
    u_patSize: pt?.size ?? 40,
    u_patWeight: pt?.weight ?? 1,
    u_patOpacity: pt?.opacity ?? 0,
    u_patColor: hexToRgb(pt?.color ?? '#000000'),
  };
  if (t) {
    Object.assign(u, fillUniforms('t', t.fill), {
      u_tShape: t.shape === 'squircle' ? 0 : t.shape === 'rounded' ? 1 : 2,
      u_tSize: t.size,
      u_tRadius: t.radius,
      u_tGloss: t.gloss,
      u_tShadow: t.shadow,
      u_tRim: t.rim,
      u_tRimColor: hexToRgb(t.rimColor),
      u_tHolo: t.holo,
    });
  }
  return u;
}

/** Representative colour behind objects, for effects that pick up bounce light. */
export function ambientOf(bg: Background): [number, number, number] {
  const f = bg.tile ? bg.tile.fill : bg.fill;
  if (f.kind === 'none' || !f.colors.length) return [0.1, 0.1, 0.1];
  const rgb = f.colors.map(hexToRgb);
  return [0, 1, 2].map((i) => rgb.reduce((s, c) => s + c[i], 0) / rgb.length) as [number, number, number];
}

/** CSS layers for a pattern, scaled down by `scale` for small previews. */
export function patternCss(pt: Pattern | null | undefined, scale = 0.12): string {
  if (!pt || pt.opacity <= 0) return '';
  const s = Math.max(4, pt.size * scale);
  const w = Math.max(1, pt.weight * scale);
  const c = pt.color;
  switch (pt.kind) {
    case 'grid':
      return `linear-gradient(${c} ${w}px, transparent ${w}px) 0 0 / ${s}px ${s}px, linear-gradient(90deg, ${c} ${w}px, transparent ${w}px) 0 0 / ${s}px ${s}px`;
    case 'lines':
      return `linear-gradient(${c} ${w}px, transparent ${w}px) 0 0 / ${s}px ${s}px`;
    case 'dots':
      return `radial-gradient(circle, ${c} ${w}px, transparent ${w + 0.5}px) 0 0 / ${s}px ${s}px`;
    case 'diagonal':
      return `repeating-linear-gradient(45deg, ${c} 0 ${w}px, transparent ${w}px ${s}px)`;
    case 'checker':
      return `repeating-conic-gradient(${c} 0 25%, transparent 0 50%) 0 0 / ${s * 2}px ${s * 2}px`;
    case 'doodles':
      // A light stand-in for previews; the canvas draws the real doodles.
      return `radial-gradient(circle, ${c} ${w * 1.5}px, transparent ${w * 1.5 + 0.5}px) 0 0 / ${s}px ${s}px, radial-gradient(circle, transparent ${s * 0.12}px, ${c} ${s * 0.12}px, ${c} ${s * 0.12 + w}px, transparent ${s * 0.12 + w + 0.5}px) ${s / 2}px ${s / 2}px / ${s}px ${s}px`;
  }
}

/** CSS for a whole page background: pattern over fill. */
export function backgroundCss(b: Background, scale?: number): string {
  const p = patternCss(b.pattern, scale);
  return p ? `${p}, ${fillCss(b.fill)}` : fillCss(b.fill);
}

/** CSS for the same background (used in thumbnails and pickers). */
export function fillCss(f: Fill): string {
  const cs = f.colors.length ? f.colors : ['#000000'];
  switch (f.kind) {
    case 'none':
      return 'repeating-conic-gradient(#2a2a2e 0 25%, #1c1c20 0 50%) 0 0 / 12px 12px';
    case 'solid':
      return cs[0];
    case 'linear':
      return cs.length > 1 ? `linear-gradient(${f.angle}deg, ${cs.join(', ')})` : cs[0];
    case 'radial':
      return cs.length > 1 ? `radial-gradient(circle at 50% 50%, ${cs.join(', ')})` : cs[0];
    case 'aura':
      return [
        cs[1] ? `radial-gradient(60% 50% at 50% 30%, ${cs[1]} 0%, transparent 70%)` : '',
        cs[2] ? `radial-gradient(55% 45% at 50% 75%, ${cs[2]} 0%, transparent 70%)` : '',
        cs[0],
      ]
        .filter(Boolean)
        .join(', ');
  }
}
