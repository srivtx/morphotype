// Effect registry. Each effect is a GLSL `vec4 effect(vec2 uv)` returning
// premultiplied colour for one object, plus a parameter schema the UI renders
// automatically. Lengths are in artboard pixels; the renderer converts them
// to texels. Backgrounds and app-icon tiles are drawn separately
// (see background.ts) so every object can have its own material.

export type ParamDef =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number; advanced?: boolean }
  | { key: string; label: string; type: 'color'; default: string; advanced?: boolean };

export type ParamValues = Record<string, number | string>;

export interface HeightSpec {
  /** 0 round, 1 chamfer, 2 smooth. */
  profile: number;
  bevel: number;
  softness: number;
}

export interface EffectDef {
  id: string;
  name: string;
  description: string;
  params: ParamDef[];
  glsl: string;
  height?: (p: ParamValues) => HeightSpec;
  animated?: (p: ParamValues) => boolean;
  /** How far (artboard px) the effect paints outside the shape. */
  reach: (p: ParamValues, size: { w: number; h: number }) => number;
}

const num = (key: string, label: string, min: number, max: number, step: number, def: number, advanced = false): ParamDef => ({
  key,
  label,
  type: 'number',
  min,
  max,
  step,
  default: def,
  advanced,
});
const col = (key: string, label: string, def: string, advanced = false): ParamDef => ({ key, label, type: 'color', default: def, advanced });

const n = (p: ParamValues, k: string) => Number(p[k] ?? 0);

export const COMMON_GLSL = /* glsl */ `
uniform sampler2D u_mask;
uniform sampler2D u_sdf;
uniform sampler2D u_height;
uniform vec2 u_texSize;
uniform vec2 u_art;
uniform vec4 u_region;
uniform float u_k;
uniform float u_time;
uniform float u_bevelTex;
uniform vec4 u_bbox;
uniform vec3 u_ambient;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.5;
  }
  return s / 0.97;
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.5;
  }
  return s / 0.875;
}
/** Artboard pixel position (origin top-left) of a field uv. */
vec2 artPx(vec2 uv) { return u_region.xy + uv * u_region.zw; }
/** Position inside the object's bounding box, 0..1. */
vec2 boxUv(vec2 uv) { return (uv - u_bbox.xy) / max(u_bbox.zw - u_bbox.xy, vec2(1e-4)); }
vec2 offsetUv(vec2 artOffset) { return artOffset * u_k / u_texSize; }
float sdfPx(vec2 uv) { return texture(u_sdf, uv).r; }
float sdfArt(vec2 uv) { return texture(u_sdf, uv).r / u_k; }
float cover(float dTex) { return clamp(0.5 - dTex / max(fwidth(dTex), 1e-3), 0.0, 1.0); }
float H(vec2 uv) { return texture(u_height, uv).r; }
vec3 normalAt(vec2 uv, float depth) {
  vec2 e = 1.5 / u_texSize;
  float hx = H(uv + vec2(e.x, 0.0)) - H(uv - vec2(e.x, 0.0));
  float hy = H(uv + vec2(0.0, e.y)) - H(uv - vec2(0.0, e.y));
  vec2 g = vec2(hx, hy) / 3.0 * max(u_bevelTex, 1.0) * depth;
  return normalize(vec3(-g, 1.0));
}
vec4 over(vec4 a, vec4 b) { return a + b * (1.0 - a.a); }
vec3 spectrum(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
vec4 dropShadow(vec2 uv, vec2 off, float grow, float blur, float opacity) {
  if (opacity <= 0.0) return vec4(0.0);
  float sd = sdfArt(uv - offsetUv(off)) - grow;
  float a = (1.0 - smoothstep(-blur, blur, sd)) * opacity;
  return vec4(0.0, 0.0, 0.0, a);
}
`;

const chrome: EffectDef = {
  id: 'chrome',
  name: 'Liquid chrome',
  description: 'Reflective liquid metal with flowing colour bands.',
  params: [
    col('c1', 'Shadow', '#020b2b'),
    col('c2', 'Body', '#0b5cff'),
    col('c3', 'Light', '#7cc8ff'),
    col('c4', 'Highlight', '#ffffff'),
    num('bevel', 'Bevel', 2, 200, 1, 46),
    num('softness', 'Softness', 0, 80, 1, 10, true),
    num('depth', 'Depth', 0.1, 4, 0.05, 1.3, true),
    num('liquid', 'Liquid', 0, 1.5, 0.01, 0.6),
    num('scale', 'Flow scale', 0.2, 4, 0.05, 1, true),
    num('bands', 'Bands', 0.5, 4, 0.05, 1.3, true),
    num('speed', 'Animate', 0, 2, 0.01, 0),
    num('rim', 'Rim', 0, 12, 0.1, 2.2, true),
    col('rimColor', 'Rim colour', '#bfe3ff', true),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  animated: (p) => n(p, 'speed') > 0,
  reach: () => 4,
  glsl: /* glsl */ `
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_rimColor;
uniform float u_depth, u_liquid, u_scale, u_bands, u_speed, u_rim;
vec3 ramp(float v) {
  if (v < 0.28) return mix(u_c1, u_c2, smoothstep(0.0, 0.28, v));
  if (v < 0.44) return mix(u_c2, u_c1, smoothstep(0.28, 0.44, v));
  if (v < 0.66) return mix(u_c1, u_c3, smoothstep(0.44, 0.66, v));
  if (v < 0.86) return mix(u_c3, u_c4, smoothstep(0.66, 0.86, v));
  return mix(u_c4, u_c3, smoothstep(0.86, 1.0, v));
}
vec4 effect(vec2 uv) {
  float d = sdfPx(uv);
  float cov = cover(d);
  if (cov <= 0.0) return vec4(0.0);
  vec3 n = normalAt(uv, u_depth);
  vec2 p = artPx(uv) / (620.0 * max(u_scale, 0.05));
  float t = u_time * u_speed;
  vec2 q = vec2(fbm3(p + vec2(0.0, t * 0.5)), fbm3(p + vec2(5.2, 1.3) - vec2(t * 0.35, 0.0)));
  float w = fbm3(p * 1.4 + q * 1.8 + vec2(t * 0.2, -t * 0.1));
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float v = 0.55 + 0.55 * r.y + 0.25 * r.x + u_liquid * ((w - 0.5) * 1.5 + (q.y - 0.5) * 0.8);
  v = abs(fract(v * u_bands * 0.5) * 2.0 - 1.0);
  vec3 c = ramp(v);
  vec3 L = normalize(vec3(-0.35, -0.75, 0.55));
  float spec = pow(max(dot(r, L), 0.0), 48.0);
  c += u_c4 * spec * 0.9;
  float rim = exp(min(d / u_k, 0.0) / max(u_rim, 0.05)) * step(0.01, u_rim);
  c = mix(c, u_rimColor, rim * 0.85);
  return vec4(c * cov, cov);
}`,
};

const glass: EffectDef = {
  id: 'glass',
  name: 'Glow glass',
  description: 'Dark frosted glass lit from inside, with grain and a floor reflection.',
  params: [
    col('glow', 'Glow', '#2aa8ff'),
    col('body', 'Body', '#01040b'),
    num('rimWidth', 'Rim width', 1, 120, 1, 14),
    num('rimIntensity', 'Rim intensity', 0, 4, 0.05, 1.5),
    num('bevel', 'Bevel', 2, 200, 1, 40, true),
    num('softness', 'Softness', 0, 80, 1, 16, true),
    num('depth', 'Depth', 0.1, 4, 0.05, 1, true),
    num('outerGlow', 'Outer glow', 0, 2, 0.01, 0.45),
    num('glowRadius', 'Glow radius', 1, 300, 1, 36, true),
    num('grain', 'Grain', 0, 1, 0.01, 0.4),
    num('reflection', 'Reflection', 0, 1, 0.01, 0.35),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  reach: (p, s) => n(p, 'glowRadius') * 4 * Math.min(1, n(p, 'outerGlow') * 2 + 0.2) + (n(p, 'reflection') > 0 ? s.h * 1.05 : 0),
  glsl: /* glsl */ `
uniform vec3 u_glow, u_body;
uniform float u_rimWidth, u_rimIntensity, u_depth, u_outerGlow, u_glowRadius, u_grain, u_reflection;
vec3 glassColor(vec2 uv, float d) {
  vec3 n = normalAt(uv, u_depth);
  float inner = exp(min(d, 0.0) / max(u_rimWidth, 0.5));
  vec3 L = normalize(vec3(-0.45, -0.55, 0.7));
  float lam = max(dot(n, L), 0.0);
  float grain = (hash12(floor(artPx(uv) * u_k)) - 0.5) * u_grain;
  float g = (inner * u_rimIntensity * (0.5 + 0.9 * lam) + (1.0 - n.z) * 0.35 * lam) * (1.0 + grain);
  vec3 c = u_body + u_glow * max(g, 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  return c + mix(u_glow, vec3(1.0), 0.6) * spec * 0.6;
}
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float d = dt / u_k;
  float cov = cover(dt);
  vec4 fg = cov > 0.0 ? vec4(glassColor(uv, d) * cov, cov) : vec4(0.0);
  float og = exp(-max(d, 0.0) / max(u_glowRadius, 1.0)) * u_outerGlow * (1.0 - cov);
  float yb = u_bbox.w;
  if (u_reflection > 0.0 && uv.y > yb) {
    vec2 ruv = vec2(uv.x, 2.0 * yb - uv.y);
    float rt = sdfPx(ruv);
    float rc = cover(rt);
    float fade = exp(-(uv.y - yb) / (0.25 * max(u_bbox.w - u_bbox.y, 0.01))) * u_reflection;
    if (rc > 0.0) fg = over(fg, vec4(glassColor(ruv, rt / u_k) * rc * fade, rc * fade));
  }
  fg.rgb += u_glow * og;
  fg.a = clamp(fg.a + og, 0.0, 1.0);
  return fg;
}`,
};

const inflate: EffectDef = {
  id: 'inflate',
  name: 'Puffy',
  description: 'Soft inflated 3D with a contact shadow, like a balloon or a cloud.',
  params: [
    col('body', 'Body', '#eef2ff'),
    col('shade', 'Shade', '#8f9ee6'),
    num('bevel', 'Puff', 4, 300, 1, 90),
    num('softness', 'Softness', 0, 80, 1, 14, true),
    num('depth', 'Depth', 0.1, 3, 0.05, 0.9, true),
    num('gloss', 'Gloss', 0, 1.5, 0.01, 0.45),
    num('rimTint', 'Backdrop bounce', 0, 1, 0.01, 0.35, true),
    num('shadow', 'Shadow', 0, 1, 0.01, 0.4),
    num('shadowOffset', 'Shadow offset', 0, 120, 1, 24, true),
    num('shadowSoft', 'Shadow blur', 1, 200, 1, 40, true),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  reach: (p) => n(p, 'shadowOffset') + n(p, 'shadowSoft') * 4,
  glsl: /* glsl */ `
uniform vec3 u_body, u_shade;
uniform float u_depth, u_gloss, u_rimTint, u_shadow, u_shadowOffset, u_shadowSoft;
vec4 effect(vec2 uv) {
  float sd = sdfArt(uv - offsetUv(vec2(0.0, u_shadowOffset)));
  float sh = exp(-max(sd, 0.0) / max(u_shadowSoft, 1.0)) * u_shadow * 0.6;
  vec4 shadow = vec4(0.0, 0.0, 0.0, sh);
  float dt = sdfPx(uv);
  float cov = cover(dt);
  if (cov <= 0.0) return shadow;
  vec3 n = normalAt(uv, u_depth);
  vec3 L = normalize(vec3(-0.35, -0.7, 0.62));
  float wrap = clamp(dot(n, L) * 0.6 + 0.45, 0.0, 1.0);
  vec3 c = mix(u_shade, u_body, smoothstep(0.0, 1.0, wrap));
  float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.5);
  c = mix(c, u_ambient * 1.15, fres * u_rimTint);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 16.0) * u_gloss;
  c += vec3(spec);
  c *= mix(0.88, 1.0, smoothstep(0.0, 0.5, H(uv)));
  return over(vec4(c * cov, cov), shadow);
}`,
};

const icon: EffectDef = {
  id: 'icon',
  name: 'Glossy glyph',
  description: 'Solid colour with a gentle bevel shine, outline and soft shadow, made for icon tiles.',
  params: [
    col('glyph', 'Colour', '#0b0812'),
    num('shine', 'Shine', 0, 1, 0.01, 0.35),
    num('outline', 'Outline', 0, 40, 0.5, 0),
    col('outlineColor', 'Outline colour', '#ffffff'),
    num('shadow', 'Shadow', 0, 1, 0.01, 0.25),
    num('shadowY', 'Shadow offset', -60, 60, 1, 10, true),
    num('shadowBlur', 'Shadow blur', 1, 80, 1, 18, true),
    num('bevel', 'Bevel', 1, 80, 1, 14, true),
  ],
  height: (p) => ({ profile: 2, bevel: n(p, 'bevel'), softness: 3 }),
  reach: (p) => n(p, 'outline') + Math.abs(n(p, 'shadowY')) + n(p, 'shadowBlur') * 2,
  glsl: /* glsl */ `
uniform vec3 u_glyph, u_outlineColor;
uniform float u_shine, u_outline, u_shadow, u_shadowY, u_shadowBlur;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  vec4 f = dropShadow(uv, vec2(0.0, u_shadowY), u_outline, u_shadowBlur, u_shadow * 0.6);
  if (u_outline > 0.0) {
    float ow = u_outline * u_k;
    float ring = cover(dt - ow);
    f = over(vec4(u_outlineColor * ring, ring), f);
  }
  float g = cover(dt);
  vec3 n = normalAt(uv, 1.0);
  float lit = dot(n, normalize(vec3(-0.4, -0.7, 0.6)));
  vec3 glyph = u_glyph * (0.9 + 0.2 * lit) + vec3(u_shine * 0.35 * pow(max(lit, 0.0), 12.0) * (1.0 - n.z));
  return over(vec4(glyph * g, g), f);
}`,
};

const sticker: EffectDef = {
  id: 'sticker',
  name: 'Sticker',
  description: 'Bold mascot style: fill, thick outline and a die-cut border.',
  params: [
    col('fill', 'Fill', '#ffffff'),
    col('line', 'Outline', '#0a0a0a'),
    num('lineWidth', 'Outline width', 0, 60, 0.5, 14),
    col('border', 'Border', '#ffffff'),
    num('borderWidth', 'Border width', 0, 60, 0.5, 0),
    num('shine', 'Shine', 0, 1, 0.01, 0.25),
    num('shadow', 'Shadow', 0, 1, 0.01, 0.2),
    num('shadowY', 'Shadow offset', -60, 60, 1, 8, true),
    num('shadowBlur', 'Shadow blur', 0.5, 80, 0.5, 10, true),
  ],
  height: () => ({ profile: 2, bevel: 18, softness: 3 }),
  reach: (p) => n(p, 'lineWidth') + n(p, 'borderWidth') + Math.abs(n(p, 'shadowY')) + n(p, 'shadowBlur') * 2,
  glsl: /* glsl */ `
uniform vec3 u_fill, u_line, u_border;
uniform float u_lineWidth, u_borderWidth, u_shine, u_shadow, u_shadowY, u_shadowBlur;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float outer = u_lineWidth + u_borderWidth;
  vec4 f = dropShadow(uv, vec2(0.0, u_shadowY), outer, u_shadowBlur, u_shadow * 0.7);
  if (u_borderWidth > 0.0) {
    float cb = cover(dt - outer * u_k);
    f = over(vec4(u_border * cb, cb), f);
  }
  if (u_lineWidth > 0.0) {
    float cl = cover(dt - u_lineWidth * u_k);
    f = over(vec4(u_line * cl, cl), f);
  }
  float cf = cover(dt);
  vec3 n = normalAt(uv, 0.7);
  float lit = dot(n, normalize(vec3(-0.4, -0.7, 0.6)));
  vec3 c = u_fill * (0.985 + 0.025 * lit) + vec3(u_shine * 0.3 * pow(max(lit, 0.0), 10.0) * (1.0 - n.z));
  return over(vec4(c * cf, cf), f);
}`,
};

const aura: EffectDef = {
  id: 'aura',
  name: 'Aura gradient',
  description: 'Soft mesh gradient inside the shape with a glowing edge, like modern UI tiles.',
  params: [
    col('c1', 'Base', '#ff3d00'),
    col('c2', 'Blob A', '#1a0000'),
    col('c3', 'Blob B', '#ff9a3d'),
    col('c4', 'Edge light', '#ffd2b0'),
    num('seed', 'Arrangement', 0, 100, 0.1, 3),
    num('softness', 'Softness', 0.2, 2, 0.01, 1),
    num('edge', 'Edge width', 0, 80, 0.5, 10),
    num('edgeGlow', 'Edge glow', 0, 1, 0.01, 0.6),
    num('outerGlow', 'Outer glow', 0, 1.5, 0.01, 0.25),
    num('glowRadius', 'Glow radius', 1, 200, 1, 30, true),
    num('grain', 'Grain', 0, 1, 0.01, 0.15),
  ],
  reach: (p) => n(p, 'glowRadius') * 4 * Math.min(1, n(p, 'outerGlow') * 2 + 0.1),
  glsl: /* glsl */ `
uniform vec3 u_c1, u_c2, u_c3, u_c4;
uniform float u_seed, u_softness, u_edge, u_edgeGlow, u_outerGlow, u_glowRadius, u_grain;
float blob(vec2 q, vec2 c, vec2 r) { vec2 k = (q - c) / max(r, vec2(1e-3)); return exp(-dot(k, k) * 1.6); }
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float d = dt / u_k;
  float cov = cover(dt);
  vec2 q = boxUv(uv);
  float s = u_seed;
  vec2 a = vec2(0.5 + 0.3 * cos(s * 1.7), 0.42 + 0.3 * sin(s * 1.3));
  vec2 b = vec2(0.5 + 0.32 * cos(s * 0.9 + 2.4), 0.6 + 0.28 * sin(s * 1.1 + 1.7));
  vec2 c3 = vec2(0.5 + 0.35 * sin(s * 2.3 + 0.5), 0.5 + 0.35 * cos(s * 0.7 + 3.1));
  float sf = u_softness;
  vec3 c = u_c1;
  c = mix(c, u_c2, blob(q, a, vec2(0.34, 0.26) * sf) * 0.95);
  c = mix(c, u_c3, blob(q, b, vec2(0.3, 0.34) * sf) * 0.85);
  c = mix(c, u_c2, blob(q, c3, vec2(0.18, 0.2) * sf) * 0.5);
  float e = exp(min(d, 0.0) / max(u_edge, 0.5)) * step(0.01, u_edge);
  c = mix(c, u_c4, e * u_edgeGlow);
  c += (hash12(floor(artPx(uv) * u_k)) - 0.5) * u_grain * 0.12;
  vec4 f = vec4(c * cov, cov);
  float og = exp(-max(d, 0.0) / max(u_glowRadius, 1.0)) * u_outerGlow * (1.0 - cov);
  f.rgb += mix(u_c3, u_c4, 0.5) * og;
  f.a = clamp(f.a + og, 0.0, 1.0);
  return f;
}`,
};

const holo: EffectDef = {
  id: 'holo',
  name: 'Holographic',
  description: 'Iridescent foil that shifts with the bevel, or a dark body with a holo rim.',
  params: [
    col('body', 'Body', '#0b0b0f'),
    num('foil', 'Foil coverage', 0, 1, 0.01, 1),
    num('rimWidth', 'Rim width', 0.5, 80, 0.5, 10),
    num('pastel', 'Pastel', 0, 1, 0.01, 0.55),
    num('shift', 'Hue shift', 0, 1, 0.005, 0),
    num('scale', 'Pattern scale', 0.2, 4, 0.05, 1, true),
    num('bevel', 'Bevel', 2, 120, 1, 26, true),
    num('gloss', 'Gloss', 0, 1.5, 0.01, 0.6),
    num('speed', 'Animate', 0, 2, 0.01, 0),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: 6 }),
  animated: (p) => n(p, 'speed') > 0,
  reach: () => 4,
  glsl: /* glsl */ `
uniform vec3 u_body;
uniform float u_foil, u_rimWidth, u_pastel, u_shift, u_scale, u_gloss, u_speed;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float cov = cover(dt);
  if (cov <= 0.0) return vec4(0.0);
  vec3 n = normalAt(uv, 1.0);
  vec2 p = artPx(uv) / (500.0 * max(u_scale, 0.05));
  float t = dot(n.xy, vec2(0.7, 0.45)) * 1.1 + (p.x * 0.6 + p.y * 0.4) + 0.25 * fbm3(p * 2.0) + u_shift + u_time * u_speed * 0.1;
  vec3 foil = mix(spectrum(t), vec3(1.0), u_pastel * 0.6);
  float rim = exp(min(dt / u_k, 0.0) / max(u_rimWidth, 0.5));
  vec3 c = mix(u_body, foil, clamp(max(rim, u_foil), 0.0, 1.0));
  vec3 L = normalize(vec3(-0.4, -0.7, 0.6));
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * u_gloss;
  c += vec3(spec);
  return vec4(c * cov, cov);
}`,
};

const extrude: EffectDef = {
  id: 'extrude',
  name: 'Retro 3D',
  description: 'Solid extrusion in any direction with an outline, like vintage signage.',
  params: [
    col('face', 'Face', '#ffd23f'),
    col('side', 'Side', '#e8442e'),
    num('depth', 'Depth', 0, 120, 1, 28),
    num('angle', 'Direction', 0, 360, 1, 45),
    num('shade', 'Side shading', 0, 1, 0.01, 0.35),
    num('outline', 'Outline', 0, 30, 0.5, 6),
    col('outlineColor', 'Outline colour', '#140a1e'),
  ],
  reach: (p) => n(p, 'depth') + n(p, 'outline') + 2,
  glsl: /* glsl */ `
uniform vec3 u_face, u_side, u_outlineColor;
uniform float u_depth, u_angle, u_shade, u_outline;
vec4 effect(vec2 uv) {
  float a = radians(u_angle);
  vec2 dir = vec2(cos(a), sin(a));
  float dt = sdfPx(uv);
  float unionD = dt;
  float hit = -1.0;
  float steps = clamp(u_depth * u_k / 1.25, 1.0, 120.0);
  for (int i = 1; i <= 120; i++) {
    if (float(i) > steps) break;
    float t = float(i) / steps;
    float s = sdfPx(uv - offsetUv(dir * t * u_depth));
    unionD = min(unionD, s);
    if (s < 0.0 && hit < 0.0) hit = t;
  }
  vec4 f = vec4(0.0);
  if (u_outline > 0.0) {
    float ring = cover(unionD - u_outline * u_k);
    f = vec4(u_outlineColor * ring, ring);
  }
  float sc = cover(unionD);
  vec3 side = u_side * (1.0 - u_shade * clamp(hit, 0.0, 1.0));
  f = over(vec4(side * sc, sc), f);
  if (u_outline > 0.0) {
    float edge = cover(abs(dt) - u_outline * 0.5 * u_k) * (1.0 - cover(dt + u_outline * 0.5 * u_k));
    f = over(vec4(u_outlineColor * edge, edge), f);
  }
  float fc = cover(dt + (u_outline > 0.0 ? u_outline * 0.5 * u_k : 0.0));
  return over(vec4(u_face * fc, fc), f);
}`,
};

const distressed: EffectDef = {
  id: 'distressed',
  name: 'Distressed print',
  description: 'Worn letterpress ink with rough edges, speckles, grain and scan lines.',
  params: [
    col('ink', 'Ink', '#ece6d8'),
    num('roughness', 'Roughness', 0, 20, 0.1, 3),
    num('scale', 'Texture scale', 0.2, 5, 0.05, 1, true),
    num('bleed', 'Ink spread', -10, 10, 0.1, 0.5, true),
    num('speckle', 'Speckle', 0, 1, 0.01, 0.45),
    num('grain', 'Grain', 0, 1, 0.01, 0.6),
    num('lines', 'Scan lines', 0, 1, 0.01, 0.4),
    num('seed', 'Seed', 0, 100, 1, 7, true),
  ],
  reach: (p) => n(p, 'roughness') * 3 + Math.max(0, n(p, 'bleed')) + 2,
  glsl: /* glsl */ `
uniform vec3 u_ink;
uniform float u_roughness, u_scale, u_bleed, u_speckle, u_grain, u_lines, u_seed;
vec4 effect(vec2 uv) {
  vec2 p = artPx(uv);
  float s = max(u_scale, 0.05);
  float g0 = hash12(floor(p * 1.5) + u_seed * 17.0);
  float d = sdfArt(uv);
  float n1 = fbm(p / (16.0 * s) + u_seed);
  float n2 = fbm(p / (4.0 * s) - u_seed * 1.7);
  float dd = d - u_bleed + u_roughness * ((n1 - 0.5) * 2.4 + (n2 - 0.5) * 1.1);
  float cov = clamp(0.5 - dd / max(fwidth(dd), 1e-3), 0.0, 1.0);
  float sp = fbm(p / (2.6 * s) + 31.0 + u_seed);
  float hole = smoothstep(1.0 - u_speckle * 0.42, 1.03 - u_speckle * 0.42, sp) * smoothstep(-1.0, -5.0, dd);
  cov *= 1.0 - hole;
  float line = pow(0.5 + 0.5 * sin(p.y * 6.2831 / 46.0), 60.0);
  vec3 ink = u_ink * (1.0 - u_grain * 0.3 * g0) * (1.0 - u_lines * 0.45 * line);
  return vec4(ink * cov, cov);
}`,
};

const neon: EffectDef = {
  id: 'neon',
  name: 'Neon tube',
  description: 'Glowing glass tube bent along the outline.',
  params: [
    col('color', 'Glow', '#ff3df2'),
    col('core', 'Core', '#fff3ff'),
    num('tube', 'Tube width', 0.5, 40, 0.5, 6),
    num('glow', 'Glow radius', 1, 200, 1, 34),
    num('intensity', 'Intensity', 0, 3, 0.05, 1.1),
    num('fill', 'Fill', 0, 1, 0.01, 0, true),
    num('flicker', 'Flicker', 0, 1, 0.01, 0),
  ],
  animated: (p) => n(p, 'flicker') > 0,
  reach: (p) => n(p, 'tube') + n(p, 'glow') * 4,
  glsl: /* glsl */ `
uniform vec3 u_color, u_core;
uniform float u_tube, u_glow, u_intensity, u_fill, u_flicker;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float d = dt / u_k;
  float tt = abs(dt) - u_tube * 0.5 * u_k;
  float tube = clamp(0.5 - tt / max(fwidth(tt), 1e-3), 0.0, 1.0);
  float core = exp(-abs(d) / max(u_tube * 0.3, 0.3));
  float glow = exp(-max(tt / u_k, 0.0) / max(u_glow, 1.0)) * u_intensity;
  float fl = 1.0 - u_flicker * 0.65 * step(0.8, hash11(floor(u_time * 9.0)));
  float fill = d < 0.0 ? u_fill * 0.3 : 0.0;
  vec3 c = (u_color * (glow * 0.85 + tube * 0.5 + fill) + u_core * core * tube) * fl;
  return vec4(c, clamp(max(max(glow * 0.9, tube), fill) * fl, 0.0, 1.0));
}`,
};

const flat: EffectDef = {
  id: 'flat',
  name: 'Flat',
  description: 'Clean fill or gradient with an optional outline and drop shadow.',
  params: [
    col('fill', 'Fill', '#f4f1ea'),
    col('fill2', 'Gradient to', '#ff5a1f'),
    num('gradient', 'Gradient', 0, 1, 0.01, 0),
    num('angle', 'Gradient angle', 0, 360, 1, 180, true),
    num('outline', 'Outline', 0, 60, 0.5, 0),
    col('outlineColor', 'Outline colour', '#ff5a1f'),
    num('shadowOpacity', 'Shadow', 0, 1, 0.01, 0),
    num('shadowX', 'Shadow X', -100, 100, 1, 0, true),
    num('shadowY', 'Shadow Y', -100, 100, 1, 12, true),
    num('shadowBlur', 'Shadow blur', 0.5, 100, 0.5, 14, true),
    num('texture', 'Print texture', 0, 1, 0.01, 0),
  ],
  reach: (p) => n(p, 'outline') + Math.max(Math.abs(n(p, 'shadowX')), Math.abs(n(p, 'shadowY'))) + n(p, 'shadowBlur') * 2,
  glsl: /* glsl */ `
uniform vec3 u_fill, u_fill2, u_outlineColor;
uniform float u_gradient, u_angle, u_outline, u_shadowX, u_shadowY, u_shadowBlur, u_shadowOpacity, u_texture;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  vec4 f = dropShadow(uv, vec2(u_shadowX, u_shadowY), u_outline, u_shadowBlur, u_shadowOpacity);
  if (u_outline > 0.0) {
    float ring = cover(dt - u_outline * u_k);
    f = over(vec4(u_outlineColor * ring, ring), f);
  }
  float c = cover(dt);
  float a = radians(u_angle);
  float g = clamp(dot(boxUv(uv) - 0.5, vec2(sin(a), -cos(a))) + 0.5, 0.0, 1.0);
  vec3 colr = mix(u_fill, u_fill2, g * u_gradient);
  if (u_texture > 0.0) {
    // Ink on paper: soft blotches, fibres and a slightly worn edge.
    vec2 p = artPx(uv);
    colr *= 1.0 - u_texture * (0.1 * fbm3(p / 40.0) + 0.06 * hash12(floor(p * u_k)));
    c *= 1.0 - u_texture * 0.35 * smoothstep(0.62, 0.8, fbm(p / 5.0)) * smoothstep(-6.0, 0.0, dt / u_k);
  }
  return over(vec4(colr * c, c), f);
}`,
};


const emboss: EffectDef = {
  id: 'emboss',
  name: 'Letterpress',
  description: 'Pressed into or raised from paper, lit from one side. Match the backdrop for a blind emboss.',
  params: [
    col('color', 'Colour', '#e8442e'),
    num('match', 'Match backdrop', 0, 1, 0.01, 1),
    num('depth', 'Depth', -3, 3, 0.05, -1.2),
    num('bevel', 'Edge width', 1, 80, 0.5, 9),
    num('light', 'Light angle', 0, 360, 1, 225),
    num('highlight', 'Highlight', 0, 1, 0.01, 0.45),
    num('shade', 'Shadow', 0, 1, 0.01, 0.5),
    num('paper', 'Paper texture', 0, 1, 0.01, 0.35),
  ],
  height: (p) => ({ profile: 2, bevel: n(p, 'bevel'), softness: 2 }),
  reach: () => 3,
  glsl: /* glsl */ `
uniform vec3 u_color;
uniform float u_match, u_depth, u_light, u_highlight, u_shade, u_paper;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float cov = cover(dt - 1.5 * u_k);
  if (cov <= 0.0) return vec4(0.0);
  vec3 nrm = normalAt(uv, u_depth);
  float a = radians(u_light);
  vec2 L = vec2(cos(a), sin(a));
  float s = dot(nrm.xy, -L) * 2.2;
  vec3 base = mix(u_color, u_ambient, u_match);
  vec2 p = artPx(uv);
  float tex = (fbm3(p / 3.0) - 0.5) * u_paper * 0.12 + (hash12(floor(p * u_k)) - 0.5) * u_paper * 0.05;
  vec3 c = base * (1.0 + tex);
  c = mix(c, vec3(1.0), clamp(s, 0.0, 1.0) * u_highlight * 0.7);
  c *= 1.0 - clamp(-s, 0.0, 1.0) * u_shade * 0.75;
  // Pressed letters catch a little shade on the floor too.
  float floorShade = u_depth < 0.0 ? 0.06 * smoothstep(0.0, 0.5, H(uv)) : 0.0;
  c *= 1.0 - floorShade;
  return vec4(c * cov, cov);
}`,
};

const halftone: EffectDef = {
  id: 'halftone',
  name: 'Halftone',
  description: 'Printed dots or lines that grow along a gradient or towards the middle, like comics and risograph prints.',
  params: [
    col('ink', 'Ink', '#0a0a0a'),
    num('cell', 'Dot spacing', 2, 80, 0.5, 14),
    num('angle', 'Screen angle', 0, 180, 1, 45),
    num('lines', 'Lines instead of dots', 0, 1, 1, 0),
    num('ramp', 'Fade', 0, 1, 0.01, 0.7),
    num('rampAngle', 'Fade direction', 0, 360, 1, 180),
    num('edge', 'Grow towards the middle', 0, 1, 0.01, 0, true),
    num('min', 'Smallest dot', 0, 1, 0.01, 0.08, true),
    num('max', 'Largest dot', 0, 1.5, 0.01, 1.15, true),
  ],
  reach: () => 2,
  glsl: /* glsl */ `
uniform vec3 u_ink;
uniform float u_cell, u_angle, u_lines, u_ramp, u_rampAngle, u_edge, u_min, u_max;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float cov = cover(dt);
  if (cov <= 0.0) return vec4(0.0);
  float ra = radians(u_rampAngle);
  float g = clamp(dot(boxUv(uv) - 0.5, vec2(sin(ra), -cos(ra))) + 0.5, 0.0, 1.0);
  float tone = mix(1.0, g, u_ramp);
  tone *= mix(1.0, smoothstep(0.0, u_cell * 4.0, -dt / u_k), u_edge);
  tone = mix(u_min, u_max, tone);
  vec2 p = artPx(uv);
  float a = radians(u_angle);
  vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p / max(u_cell, 0.5);
  vec2 f = fract(q) - 0.5;
  float d = u_lines > 0.5 ? (abs(f.y) - tone * 0.5) : (length(f) - sqrt(max(tone, 0.0)) * 0.5);
  d *= u_cell * u_k;
  float m = clamp(0.5 - d / max(fwidth(d), 1e-3), 0.0, 1.0);
  float a2 = m * cov;
  return vec4(u_ink * a2, a2);
}`,
};

const riso: EffectDef = {
  id: 'riso',
  name: 'Risograph',
  description: 'Two overprinted inks slightly out of register, with grainy, uneven coverage.',
  params: [
    col('ink', 'Ink', '#ff4fb1'),
    col('ink2', 'Second ink', '#2b6bff'),
    num('offsetX', 'Misregister X', -40, 40, 0.5, 7),
    num('offsetY', 'Misregister Y', -40, 40, 0.5, 5),
    num('second', 'Second ink', 0, 1, 0.01, 0.85),
    num('grain', 'Grain', 0, 1, 0.01, 0.55),
    num('patchy', 'Uneven ink', 0, 1, 0.01, 0.35),
    num('seed', 'Seed', 0, 100, 1, 3, true),
  ],
  reach: (p) => Math.max(Math.abs(n(p, 'offsetX')), Math.abs(n(p, 'offsetY'))) + 3,
  glsl: /* glsl */ `
uniform vec3 u_ink, u_ink2;
uniform float u_offsetX, u_offsetY, u_second, u_grain, u_patchy, u_seed;
float density(vec2 p, float seed) {
  float g = hash12(floor(p * u_k * 0.8) + seed * 31.0);
  float blot = fbm3(p / 90.0 + seed);
  return clamp(1.0 - u_grain * 0.55 * g - u_patchy * 0.6 * smoothstep(0.35, 0.75, blot), 0.0, 1.0);
}
vec4 effect(vec2 uv) {
  vec2 p = artPx(uv);
  float a1 = cover(sdfPx(uv)) * density(p, u_seed);
  float a2 = cover(sdfPx(uv - offsetUv(vec2(u_offsetX, u_offsetY)))) * density(p + 17.0, u_seed + 5.0) * u_second;
  // Overprint: where both inks land they multiply.
  vec3 c = u_ink * a1 * (1.0 - a2) + u_ink2 * a2 * (1.0 - a1) + u_ink * u_ink2 * a1 * a2;
  return vec4(c, a1 + a2 - a1 * a2);
}`,
};

export const EFFECTS: EffectDef[] = [flat, chrome, glass, inflate, sticker, aura, holo, extrude, icon, neon, distressed, emboss, halftone, riso];

export function effectById(id: string): EffectDef {
  return EFFECTS.find((e) => e.id === id) ?? flat;
}

export function defaultParams(e: EffectDef): ParamValues {
  return Object.fromEntries(e.params.map((p) => [p.key, p.default]));
}

export interface Preset {
  name: string;
  effect: string;
  params: ParamValues;
  /** Backdrop for the preview thumbnail (and "apply with background"). */
  bg: string;
  tags?: string;
}

export const PRESETS: Preset[] = [
  { name: 'Ice chrome', effect: 'chrome', params: {}, bg: '#000000', tags: 'metal blue' },
  { name: 'Toxic chrome', effect: 'chrome', params: { c1: '#061204', c2: '#2f6b0b', c3: '#c8ff3a', c4: '#ffb300', rimColor: '#d8ff7a' }, bg: '#000000', tags: 'metal green gold' },
  { name: 'Molten', effect: 'chrome', params: { c1: '#071722', c2: '#00a99d', c3: '#ff6a00', c4: '#ffe7c2', rimColor: '#ff9a3c', liquid: 1.0 }, bg: '#000000', tags: 'metal orange teal' },
  { name: 'Plasma', effect: 'chrome', params: { c1: '#16002b', c2: '#5a17d6', c3: '#ff2e9a', c4: '#ffd36b', rimColor: '#ff7ad1' }, bg: '#000000', tags: 'metal purple pink' },
  { name: 'Mercury', effect: 'chrome', params: { c1: '#050505', c2: '#4a4a4a', c3: '#c4c4c4', c4: '#ffffff', rimColor: '#ffffff', liquid: 0.35 }, bg: '#000000', tags: 'metal silver' },
  { name: 'Rose gold', effect: 'chrome', params: { c1: '#2a0f0c', c2: '#a8574a', c3: '#f2b8a2', c4: '#fff4ee', rimColor: '#ffd9cc', liquid: 0.3 }, bg: '#120807', tags: 'metal copper' },
  { name: 'Blue glass', effect: 'glass', params: {}, bg: '#000000', tags: 'glow' },
  { name: 'Ember glass', effect: 'glass', params: { glow: '#ff7a1a' }, bg: '#000000', tags: 'glow orange' },
  { name: 'Mint glass', effect: 'glass', params: { glow: '#3dffb5', body: '#010a06' }, bg: '#000000', tags: 'glow green' },
  { name: 'Puffy cloud', effect: 'inflate', params: {}, bg: '#2b6bff', tags: '3d balloon white' },
  { name: 'Bubblegum', effect: 'inflate', params: { body: '#ffe0f1', shade: '#ff6fb8' }, bg: '#ff6fb8', tags: '3d pink' },
  { name: 'Lime puff', effect: 'inflate', params: { body: '#f4ffd6', shade: '#86c11b', shadow: 0.3 }, bg: '#a6e21b', tags: '3d green' },
  { name: 'Mascot sticker', effect: 'sticker', params: {}, bg: '#5cc6ff', tags: 'outline cartoon' },
  { name: 'Ink sticker', effect: 'sticker', params: { fill: '#0a0a0a', line: '#ffffff', lineWidth: 6, borderWidth: 0, shine: 0.1 }, bg: '#ffffff', tags: 'black' },
  { name: 'Die-cut', effect: 'sticker', params: { fill: '#ff5a1f', line: '#140a1e', lineWidth: 8, borderWidth: 18, shadow: 0.35 }, bg: '#1b1b1f', tags: 'border' },
  { name: 'Sunset aura', effect: 'aura', params: {}, bg: '#161616', tags: 'gradient mesh' },
  { name: 'Acid aura', effect: 'aura', params: { c1: '#d6ff1f', c2: '#5a1fff', c3: '#b9ff3d', c4: '#f6ffd0', seed: 7.4 }, bg: '#161616', tags: 'gradient mesh yellow violet' },
  { name: 'Ocean aura', effect: 'aura', params: { c1: '#1424ff', c2: '#000028', c3: '#4fb4ff', c4: '#c7e4ff', seed: 1.2 }, bg: '#161616', tags: 'gradient mesh blue' },
  { name: 'Rose aura', effect: 'aura', params: { c1: '#ff4fb1', c2: '#1d0030', c3: '#ffffff', c4: '#ffd0f0', seed: 12.6 }, bg: '#161616', tags: 'gradient mesh pink' },
  { name: 'Forest aura', effect: 'aura', params: { c1: '#073d12', c2: '#000a02', c3: '#4fe37a', c4: '#bff5c8', seed: 22 }, bg: '#161616', tags: 'gradient mesh green' },
  { name: 'Holo foil', effect: 'holo', params: {}, bg: '#0b0b0f', tags: 'iridescent rainbow' },
  { name: 'Holo rim', effect: 'holo', params: { foil: 0, rimWidth: 7 }, bg: '#000000', tags: 'iridescent dark' },
  { name: 'Retro sign', effect: 'extrude', params: {}, bg: '#2b1d3a', tags: '3d vintage' },
  { name: 'Pop 3D', effect: 'extrude', params: { face: '#ffffff', side: '#7b4dff', outline: 0, depth: 18, angle: 60 }, bg: '#7b4dff', tags: '3d purple' },
  { name: 'Glossy ink', effect: 'icon', params: {}, bg: '#a98bff', tags: 'icon black' },
  { name: 'Sunset glyph', effect: 'icon', params: { glyph: '#ffc61a' }, bg: '#ff5a10', tags: 'icon yellow' },
  { name: 'Candy glyph', effect: 'icon', params: { glyph: '#fff2fb', shine: 0.6 }, bg: '#ff3d86', tags: 'icon white' },
  { name: 'Blind emboss', effect: 'emboss', params: {}, bg: '#e8442e', tags: 'letterpress deboss paper business card pressed' },
  { name: 'Raised cream', effect: 'emboss', params: { color: '#f2e9d8', match: 0, depth: 1.3, highlight: 0.55, shade: 0.45 }, bg: '#e8442e', tags: 'letterpress emboss paper card' },
  { name: 'Paper deboss', effect: 'emboss', params: { color: '#efe8dc', match: 1, depth: -1.6, bevel: 12 }, bg: '#efe8dc', tags: 'letterpress white paper stationery' },
  { name: 'Printed ink', effect: 'flat', params: { fill: '#f4ead8', texture: 0.8 }, bg: '#e8442e', tags: 'paper print texture card cream' },
  { name: 'Comic dots', effect: 'halftone', params: {}, bg: '#ffd23f', tags: 'halftone pop art print dots' },
  { name: 'Pink halftone', effect: 'halftone', params: { ink: '#ff3d7f', cell: 10, ramp: 1, rampAngle: 135 }, bg: '#fff3e6', tags: 'halftone gradient dots print' },
  { name: 'Line screen', effect: 'halftone', params: { ink: '#2b6bff', lines: 1, cell: 9, ramp: 0.85, angle: 0 }, bg: '#f4f1ea', tags: 'halftone lines engraving print' },
  { name: 'Riso pink + blue', effect: 'riso', params: {}, bg: '#f4f1ea', tags: 'risograph print overprint zine' },
  { name: 'Riso orange + green', effect: 'riso', params: { ink: '#ff7a1a', ink2: '#1a8a6a', offsetX: -6, offsetY: 6 }, bg: '#f4f1ea', tags: 'risograph print overprint poster' },
  { name: 'Distressed', effect: 'distressed', params: {}, bg: '#0b0b0b', tags: 'grunge print' },
  { name: 'Neon pink', effect: 'neon', params: {}, bg: '#07030d', tags: 'glow' },
  { name: 'Neon cyan', effect: 'neon', params: { color: '#28f0ff', core: '#f0ffff' }, bg: '#02070b', tags: 'glow' },
  { name: 'Flat', effect: 'flat', params: {}, bg: '#141414', tags: 'solid' },
  { name: 'Flat ink', effect: 'flat', params: { fill: '#0a0a0a' }, bg: '#7b4dff', tags: 'solid black' },
  { name: 'Peach gradient', effect: 'flat', params: { fill: '#ffb36b', fill2: '#ff3d7f', gradient: 1 }, bg: '#130f1a', tags: 'gradient' },
  { name: 'Electric gradient', effect: 'flat', params: { fill: '#45f3ff', fill2: '#7b4dff', gradient: 1, angle: 135 }, bg: '#08080c', tags: 'gradient blue' },
];
