// Effect registry. Each effect is a GLSL `effect(uv, out bg, out fg)` body
// plus a parameter schema the UI renders automatically. Lengths are in
// artboard pixels; the renderer converts to texture pixels.

export type ParamDef =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: 'color'; default: string };

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
}

const num = (key: string, label: string, min: number, max: number, step: number, def: number): ParamDef => ({
  key,
  label,
  type: 'number',
  min,
  max,
  step,
  default: def,
});
const col = (key: string, label: string, def: string): ParamDef => ({ key, label, type: 'color', default: def });

const n = (p: ParamValues, k: string) => Number(p[k] ?? 0);

export const COMMON_GLSL = /* glsl */ `
uniform sampler2D u_mask;
uniform sampler2D u_sdf;
uniform sampler2D u_height;
uniform vec2 u_texSize;
uniform vec2 u_art;
uniform float u_k;
uniform float u_time;
uniform float u_bevelTex;
uniform vec4 u_bbox;

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
    num('softness', 'Softness', 0, 80, 1, 10),
    num('depth', 'Depth', 0.1, 4, 0.05, 1.3),
    num('liquid', 'Liquid', 0, 1.5, 0.01, 0.6),
    num('scale', 'Flow scale', 0.2, 4, 0.05, 1),
    num('bands', 'Bands', 0.5, 4, 0.05, 1.3),
    num('speed', 'Animate', 0, 2, 0.01, 0),
    num('rim', 'Rim', 0, 12, 0.1, 2.2),
    col('rimColor', 'Rim colour', '#bfe3ff'),
    col('background', 'Background', '#000000'),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  animated: (p) => n(p, 'speed') > 0,
  glsl: /* glsl */ `
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_rimColor, u_background;
uniform float u_depth, u_liquid, u_scale, u_bands, u_speed, u_rim;
vec3 ramp(float v) {
  if (v < 0.28) return mix(u_c1, u_c2, smoothstep(0.0, 0.28, v));
  if (v < 0.44) return mix(u_c2, u_c1, smoothstep(0.28, 0.44, v));
  if (v < 0.66) return mix(u_c1, u_c3, smoothstep(0.44, 0.66, v));
  if (v < 0.86) return mix(u_c3, u_c4, smoothstep(0.66, 0.86, v));
  return mix(u_c4, u_c3, smoothstep(0.86, 1.0, v));
}
void effect(vec2 uv, out vec3 bg, out vec4 fg) {
  bg = u_background;
  float d = sdfPx(uv);
  float cov = cover(d);
  if (cov <= 0.0) { fg = vec4(0.0); return; }
  vec3 n = normalAt(uv, u_depth);
  vec2 p = uv * u_art / (620.0 * max(u_scale, 0.05));
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
  fg = vec4(c * cov, cov);
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
    num('bevel', 'Bevel', 2, 200, 1, 40),
    num('softness', 'Softness', 0, 80, 1, 16),
    num('depth', 'Depth', 0.1, 4, 0.05, 1),
    num('outerGlow', 'Outer glow', 0, 2, 0.01, 0.45),
    num('glowRadius', 'Glow radius', 1, 300, 1, 36),
    num('grain', 'Grain', 0, 1, 0.01, 0.4),
    num('reflection', 'Reflection', 0, 1, 0.01, 0.35),
    col('background', 'Background', '#000000'),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  glsl: /* glsl */ `
uniform vec3 u_glow, u_body, u_background;
uniform float u_rimWidth, u_rimIntensity, u_depth, u_outerGlow, u_glowRadius, u_grain, u_reflection;
vec3 glassColor(vec2 uv, float d) {
  vec3 n = normalAt(uv, u_depth);
  float inner = exp(min(d, 0.0) / max(u_rimWidth, 0.5));
  vec3 L = normalize(vec3(-0.45, -0.55, 0.7));
  float lam = max(dot(n, L), 0.0);
  float grain = (hash12(floor(uv * u_texSize)) - 0.5) * u_grain;
  float g = (inner * u_rimIntensity * (0.5 + 0.9 * lam) + (1.0 - n.z) * 0.35 * lam) * (1.0 + grain);
  vec3 c = u_body + u_glow * max(g, 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  return c + mix(u_glow, vec3(1.0), 0.6) * spec * 0.6;
}
void effect(vec2 uv, out vec3 bg, out vec4 fg) {
  bg = u_background;
  float dt = sdfPx(uv);
  float d = dt / u_k;
  float cov = cover(dt);
  fg = cov > 0.0 ? vec4(glassColor(uv, d) * cov, cov) : vec4(0.0);
  float og = exp(-max(d, 0.0) / max(u_glowRadius, 1.0)) * u_outerGlow * (1.0 - cov);
  float yb = u_bbox.w;
  if (u_reflection > 0.0 && uv.y > yb) {
    vec2 ruv = vec2(uv.x, 2.0 * yb - uv.y);
    float rt = sdfPx(ruv);
    float rc = cover(rt);
    float fade = exp(-(uv.y - yb) * u_art.y / (0.25 * max(u_bbox.w - u_bbox.y, 0.01) * u_art.y)) * u_reflection;
    if (rc > 0.0) fg = over(fg, vec4(glassColor(ruv, rt / u_k) * rc * fade, rc * fade));
  }
  fg.rgb += u_glow * og;
  fg.a = clamp(fg.a + og, 0.0, 1.0);
}`,
};

const inflate: EffectDef = {
  id: 'inflate',
  name: 'Puffy',
  description: 'Soft inflated 3D with a gradient backdrop and contact shadow.',
  params: [
    col('body', 'Body', '#eef2ff'),
    col('shade', 'Shade', '#8f9ee6'),
    col('bgTop', 'Backdrop top', '#2b8bff'),
    col('bgBottom', 'Backdrop bottom', '#1a3fe0'),
    num('bevel', 'Puff', 4, 300, 1, 90),
    num('softness', 'Softness', 0, 80, 1, 14),
    num('depth', 'Depth', 0.1, 3, 0.05, 0.9),
    num('gloss', 'Gloss', 0, 1.5, 0.01, 0.45),
    num('rimTint', 'Backdrop bounce', 0, 1, 0.01, 0.35),
    num('shadow', 'Shadow', 0, 1, 0.01, 0.4),
    num('shadowOffset', 'Shadow offset', 0, 120, 1, 24),
    num('shadowSoft', 'Shadow blur', 1, 200, 1, 40),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  glsl: /* glsl */ `
uniform vec3 u_body, u_shade, u_bgTop, u_bgBottom;
uniform float u_depth, u_gloss, u_rimTint, u_shadow, u_shadowOffset, u_shadowSoft;
void effect(vec2 uv, out vec3 bg, out vec4 fg) {
  vec3 back = mix(u_bgTop, u_bgBottom, smoothstep(0.0, 1.0, uv.y));
  vec2 so = vec2(0.0, u_shadowOffset * u_k) / u_texSize;
  float sd = sdfArt(uv - so);
  float sh = exp(-max(sd, 0.0) / max(u_shadowSoft, 1.0)) * u_shadow;
  bg = back * (1.0 - sh * 0.6);
  float dt = sdfPx(uv);
  float cov = cover(dt);
  if (cov <= 0.0) { fg = vec4(0.0); return; }
  vec3 n = normalAt(uv, u_depth);
  vec3 L = normalize(vec3(-0.35, -0.7, 0.62));
  float wrap = clamp(dot(n, L) * 0.6 + 0.45, 0.0, 1.0);
  vec3 c = mix(u_shade, u_body, smoothstep(0.0, 1.0, wrap));
  float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.5);
  c = mix(c, back * 1.15, fres * u_rimTint);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 16.0) * u_gloss;
  c += vec3(spec);
  c *= mix(0.88, 1.0, smoothstep(0.0, 0.5, H(uv)));
  fg = vec4(c * cov, cov);
}`,
};

const icon: EffectDef = {
  id: 'icon',
  name: 'App icon',
  description: 'Squircle app tile with a flat glyph, outline and soft shadow.',
  params: [
    col('tileTop', 'Tile top', '#c9b8ff'),
    col('tileBottom', 'Tile bottom', '#8a63f5'),
    col('glyph', 'Glyph', '#0b0812'),
    num('tileSize', 'Tile size', 0.2, 1, 0.01, 0.84),
    num('corner', 'Corner', 2, 12, 0.1, 5),
    num('gloss', 'Gloss', 0, 1, 0.01, 0.45),
    num('shine', 'Glyph shine', 0, 1, 0.01, 0.35),
    num('outline', 'Outline', 0, 40, 0.5, 0),
    col('outlineColor', 'Outline colour', '#ffffff'),
    num('shadow', 'Shadow', 0, 1, 0.01, 0.35),
    num('bevel', 'Glyph bevel', 1, 80, 1, 14),
    col('background', 'Background', '#000000'),
  ],
  height: (p) => ({ profile: 2, bevel: n(p, 'bevel'), softness: 3 }),
  glsl: /* glsl */ `
uniform vec3 u_tileTop, u_tileBottom, u_glyph, u_outlineColor, u_background;
uniform float u_tileSize, u_corner, u_gloss, u_shine, u_outline, u_shadow;
void effect(vec2 uv, out vec3 bg, out vec4 fg) {
  bg = u_background;
  vec2 c = (uv - 0.5) * u_art;
  float r = u_tileSize * 0.5 * min(u_art.x, u_art.y);
  vec2 a = abs(c) / r;
  float e = max(u_corner, 2.0);
  float se = pow(pow(a.x, e) + pow(a.y, e), 1.0 / e);
  float td = (se - 1.0) * r;
  float tcov = clamp(0.5 - td / max(fwidth(td), 1e-3), 0.0, 1.0);
  vec3 tile = mix(u_tileTop, u_tileBottom, smoothstep(-r, r, c.y));
  float edge = exp(min(td, 0.0) / (r * 0.05));
  tile += edge * 0.18 * u_gloss * smoothstep(0.3 * r, -r, c.y);
  tile = mix(tile, vec3(1.0), u_gloss * 0.18 * smoothstep(0.0, -r, c.y));
  vec2 so = vec2(0.0, 0.025 * r * u_k) / u_texSize;
  float sd = sdfArt(uv - so);
  tile *= 1.0 - exp(-max(sd, 0.0) / (0.05 * r)) * u_shadow * 0.55;
  vec4 f = vec4(tile * tcov, tcov);
  float dt = sdfPx(uv);
  if (u_outline > 0.0) {
    float ow = u_outline * u_k;
    float ring = cover(abs(dt - ow * 0.5) - ow * 0.5);
    f = over(vec4(u_outlineColor * ring, ring), f);
  }
  float g = cover(dt);
  vec3 n = normalAt(uv, 1.0);
  float lit = dot(n, normalize(vec3(-0.4, -0.7, 0.6)));
  vec3 glyph = u_glyph * (0.9 + 0.2 * lit) + vec3(u_shine * 0.35 * pow(max(lit, 0.0), 12.0) * (1.0 - n.z));
  f = over(vec4(glyph * g, g), f);
  fg = f;
}`,
};

const distressed: EffectDef = {
  id: 'distressed',
  name: 'Distressed print',
  description: 'Worn letterpress ink with rough edges, speckles, grain and scan lines.',
  params: [
    col('ink', 'Ink', '#ece6d8'),
    col('paper', 'Paper', '#0b0b0b'),
    num('roughness', 'Roughness', 0, 20, 0.1, 3),
    num('scale', 'Texture scale', 0.2, 5, 0.05, 1),
    num('bleed', 'Ink spread', -10, 10, 0.1, 0.5),
    num('speckle', 'Speckle', 0, 1, 0.01, 0.45),
    num('grain', 'Grain', 0, 1, 0.01, 0.6),
    num('lines', 'Scan lines', 0, 1, 0.01, 0.4),
    num('seed', 'Seed', 0, 100, 1, 7),
  ],
  glsl: /* glsl */ `
uniform vec3 u_ink, u_paper;
uniform float u_roughness, u_scale, u_bleed, u_speckle, u_grain, u_lines, u_seed;
void effect(vec2 uv, out vec3 bg, out vec4 fg) {
  vec2 p = uv * u_art;
  float s = max(u_scale, 0.05);
  float g0 = hash12(floor(p * 1.5) + u_seed * 17.0);
  bg = u_paper + (g0 - 0.5) * u_grain * 0.07;
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
  fg = vec4(ink * cov, cov);
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
    num('fill', 'Fill', 0, 1, 0.01, 0),
    num('flicker', 'Flicker', 0, 1, 0.01, 0),
    col('background', 'Background', '#07030d'),
  ],
  animated: (p) => n(p, 'flicker') > 0,
  glsl: /* glsl */ `
uniform vec3 u_color, u_core, u_background;
uniform float u_tube, u_glow, u_intensity, u_fill, u_flicker;
void effect(vec2 uv, out vec3 bg, out vec4 fg) {
  bg = u_background;
  float dt = sdfPx(uv);
  float d = dt / u_k;
  float tt = abs(dt) - u_tube * 0.5 * u_k;
  float tube = clamp(0.5 - tt / max(fwidth(tt), 1e-3), 0.0, 1.0);
  float core = exp(-abs(d) / max(u_tube * 0.3, 0.3));
  float glow = exp(-max(tt / u_k, 0.0) / max(u_glow, 1.0)) * u_intensity;
  float fl = 1.0 - u_flicker * 0.65 * step(0.8, hash11(floor(u_time * 9.0)));
  float fill = d < 0.0 ? u_fill * 0.3 : 0.0;
  vec3 c = (u_color * (glow * 0.85 + tube * 0.5 + fill) + u_core * core * tube) * fl;
  fg = vec4(c, clamp(max(max(glow * 0.9, tube), fill) * fl, 0.0, 1.0));
}`,
};

const flat: EffectDef = {
  id: 'flat',
  name: 'Flat',
  description: 'Clean fill with optional outline and drop shadow.',
  params: [
    col('fill', 'Fill', '#f4f1ea'),
    col('background', 'Background', '#141414'),
    num('outline', 'Outline', 0, 60, 0.5, 0),
    col('outlineColor', 'Outline colour', '#ff5a1f'),
    num('shadowX', 'Shadow X', -100, 100, 1, 0),
    num('shadowY', 'Shadow Y', -100, 100, 1, 12),
    num('shadowBlur', 'Shadow blur', 0.5, 100, 0.5, 14),
    num('shadowOpacity', 'Shadow', 0, 1, 0.01, 0),
  ],
  glsl: /* glsl */ `
uniform vec3 u_fill, u_background, u_outlineColor;
uniform float u_outline, u_shadowX, u_shadowY, u_shadowBlur, u_shadowOpacity;
void effect(vec2 uv, out vec3 bg, out vec4 fg) {
  bg = u_background;
  float dt = sdfPx(uv);
  vec4 f = vec4(0.0);
  if (u_shadowOpacity > 0.0) {
    float sd = sdfArt(uv - vec2(u_shadowX, u_shadowY) * u_k / u_texSize) - u_outline;
    float sa = clamp(0.5 - sd / max(u_shadowBlur, 0.5), 0.0, 1.0) * u_shadowOpacity;
    f = vec4(0.0, 0.0, 0.0, sa);
  }
  if (u_outline > 0.0) {
    float ow = u_outline * u_k;
    float ring = cover(abs(dt - ow * 0.5) - ow * 0.5);
    f = over(vec4(u_outlineColor * ring, ring), f);
  }
  float c = cover(dt);
  fg = over(vec4(u_fill * c, c), f);
}`,
};

export const EFFECTS: EffectDef[] = [chrome, glass, inflate, icon, distressed, neon, flat];

export function effectById(id: string): EffectDef {
  return EFFECTS.find((e) => e.id === id) ?? chrome;
}

export function defaultParams(e: EffectDef): ParamValues {
  return Object.fromEntries(e.params.map((p) => [p.key, p.default]));
}

export interface Preset {
  name: string;
  effect: string;
  params: ParamValues;
  /** Swatch colours for the preset chip. */
  swatch: string[];
}

export const PRESETS: Preset[] = [
  { name: 'Ice chrome', effect: 'chrome', params: {}, swatch: ['#020b2b', '#0b5cff', '#7cc8ff', '#ffffff'] },
  {
    name: 'Toxic chrome',
    effect: 'chrome',
    params: { c1: '#061204', c2: '#2f6b0b', c3: '#c8ff3a', c4: '#ffb300', rimColor: '#d8ff7a' },
    swatch: ['#061204', '#2f6b0b', '#c8ff3a', '#ffb300'],
  },
  {
    name: 'Molten',
    effect: 'chrome',
    params: { c1: '#071722', c2: '#00a99d', c3: '#ff6a00', c4: '#ffe7c2', rimColor: '#ff9a3c', liquid: 1.0 },
    swatch: ['#071722', '#00a99d', '#ff6a00', '#ffe7c2'],
  },
  {
    name: 'Plasma',
    effect: 'chrome',
    params: { c1: '#16002b', c2: '#5a17d6', c3: '#ff2e9a', c4: '#ffd36b', rimColor: '#ff7ad1' },
    swatch: ['#16002b', '#5a17d6', '#ff2e9a', '#ffd36b'],
  },
  {
    name: 'Mercury',
    effect: 'chrome',
    params: { c1: '#050505', c2: '#4a4a4a', c3: '#c4c4c4', c4: '#ffffff', rimColor: '#ffffff', liquid: 0.35 },
    swatch: ['#050505', '#4a4a4a', '#c4c4c4', '#ffffff'],
  },
  { name: 'Blue glass', effect: 'glass', params: {}, swatch: ['#000000', '#01040b', '#2aa8ff', '#bfe6ff'] },
  { name: 'Ember glass', effect: 'glass', params: { glow: '#ff7a1a' }, swatch: ['#000000', '#120400', '#ff7a1a', '#ffd2a8'] },
  { name: 'Puffy cloud', effect: 'inflate', params: {}, swatch: ['#1a3fe0', '#2b8bff', '#8f9ee6', '#eef2ff'] },
  {
    name: 'Bubblegum',
    effect: 'inflate',
    params: { body: '#ffe0f1', shade: '#ff6fb8', bgTop: '#ff9fd2', bgBottom: '#ff4fa3' },
    swatch: ['#ff4fa3', '#ff9fd2', '#ff6fb8', '#ffe0f1'],
  },
  { name: 'Lilac icon', effect: 'icon', params: {}, swatch: ['#c9b8ff', '#8a63f5', '#0b0812', '#ffffff'] },
  {
    name: 'Sunset icon',
    effect: 'icon',
    params: { tileTop: '#ff8a1f', tileBottom: '#ff4d00', glyph: '#ffc61a', outline: 0 },
    swatch: ['#ff8a1f', '#ff4d00', '#ffc61a', '#fff3d6'],
  },
  {
    name: 'Candy icon',
    effect: 'icon',
    params: { tileTop: '#ff77c8', tileBottom: '#ff2f6d', glyph: '#fff2fb', shine: 0.6 },
    swatch: ['#ff77c8', '#ff2f6d', '#fff2fb', '#000000'],
  },
  { name: 'Distressed', effect: 'distressed', params: {}, swatch: ['#0b0b0b', '#3a3a3a', '#a7a29a', '#ece6d8'] },
  { name: 'Neon pink', effect: 'neon', params: {}, swatch: ['#07030d', '#5c0f57', '#ff3df2', '#fff3ff'] },
  { name: 'Neon cyan', effect: 'neon', params: { color: '#28f0ff', core: '#f0ffff', background: '#02070b' }, swatch: ['#02070b', '#06424a', '#28f0ff', '#f0ffff'] },
  { name: 'Flat', effect: 'flat', params: {}, swatch: ['#141414', '#141414', '#f4f1ea', '#f4f1ea'] },
];
