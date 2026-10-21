// Effect registry. Each effect is a GLSL `vec4 effect(vec2 uv)` returning
// premultiplied colour for one object, plus a parameter schema the UI renders
// automatically. Lengths are in artboard pixels; the renderer converts them
// to texels. Backgrounds and app-icon tiles are drawn separately
// (see background.ts) so every object can have its own material.

export type ParamDef =
  /** `options` turns a number into a named choice (the value is the option's index). */
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number; advanced?: boolean; options?: string[] }
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
  /** Samples a picture (style param `image`) bound as `u_photo`. */
  photo?: boolean;
  /**
   * Sees what's already drawn behind it (glass, lenses): the renderer copies
   * that area into `u_backdrop` and a copy blurred by the `blur` param into
   * `u_backdropBlur`. Read them with `behind(uv)` and `behindBlur(uv)`.
   */
  backdrop?: boolean;
  /**
   * Reads a pen line's centre line (bound as `u_spine`, `u_spineN` points of
   * x, y, t, joined in artboard px from the centre); `alongLine(uv, side)`
   * returns how far along the line (0…1) a pixel lies.
   */
  spine?: boolean;
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
const choice = (key: string, label: string, options: string[], def: number): ParamDef => ({ key, label, type: 'number', min: 0, max: options.length - 1, step: 1, default: def, options });

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
/** Soft edges in artboard px (0 = crisp). */
uniform float u_soften;

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
float cover(float dTex) {
  if (u_soften > 0.0) {
    float w = u_soften * u_k + fwidth(dTex);
    return 1.0 - smoothstep(-w, w, dTex);
  }
  return clamp(0.5 - dTex / max(fwidth(dTex), 1e-3), 0.0, 1.0);
}
float H(vec2 uv) { return texture(u_height, uv).r; }
vec3 normalAt(vec2 uv, float depth) {
  vec2 e = 1.5 / u_texSize;
  float hx = H(uv + vec2(e.x, 0.0)) - H(uv - vec2(e.x, 0.0));
  float hy = H(uv + vec2(0.0, e.y)) - H(uv - vec2(0.0, e.y));
  vec2 g = vec2(hx, hy) / 3.0 * max(u_bevelTex, 1.0) * depth;
  return normalize(vec3(-g, 1.0));
}
vec4 over(vec4 a, vec4 b) { return a + b * (1.0 - a.a); }
uniform sampler2D u_backdrop;
uniform sampler2D u_backdropBlur;
uniform vec4 u_bdMap;
uniform float u_hasBackdrop;
vec2 bdUv(vec2 uv) { return uv * u_bdMap.xy + u_bdMap.zw; }
/** What's drawn behind this object at a field uv (premultiplied, opaque where the canvas is). */
vec4 behind(vec2 uv) { return u_hasBackdrop > 0.5 ? texture(u_backdrop, bdUv(uv)) : vec4(0.0); }
vec4 behindBlur(vec2 uv) { return u_hasBackdrop > 0.5 ? texture(u_backdropBlur, bdUv(uv)) : vec4(0.0); }
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
  if (u_reflection > 0.0) {
    // Coverage before the per-pixel row test: fwidth needs the whole quad.
    vec2 ruv = vec2(uv.x, 2.0 * yb - uv.y);
    float rt = sdfPx(ruv);
    float rc = cover(rt);
    float fade = exp(-(uv.y - yb) / (0.25 * max(u_bbox.w - u_bbox.y, 0.01))) * u_reflection;
    if (uv.y > yb && rc > 0.0) fg = over(fg, vec4(glassColor(ruv, rt / u_k) * rc * fade, rc * fade));
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
    choice('surface', 'Surface', ['Smooth', 'Contour lines', 'Speckles'], 0),
    col('marks', 'Marks colour', '#ffffff'),
    num('marksAmount', 'Marks', 0, 1, 0.01, 0.8),
    num('marksSize', 'Mark size', 4, 400, 1, 70),
    num('marksWidth', 'Line width', 0.2, 16, 0.1, 1.6),
    num('marksFlow', 'Flow', -10, 10, 0.01, 0),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  reach: (p) => n(p, 'shadowOffset') + n(p, 'shadowSoft') * 4,
  glsl: /* glsl */ `
uniform vec3 u_body, u_shade, u_marks;
uniform float u_depth, u_gloss, u_rimTint, u_shadow, u_shadowOffset, u_shadowSoft;
uniform float u_surface, u_marksAmount, u_marksSize, u_marksWidth, u_marksFlow;
/** Topographic lines: level curves of a slow noise, lifted by the puff so they wrap round the form. */
float contours(vec2 uv) {
  vec2 p = artPx(uv) / max(u_marksSize * 5.0, 1.0);
  // About one line per Mark size across the noise's slopes.
  float v = (fbm3(p + vec2(u_marksFlow * 0.13, u_marksFlow * 0.05)) * 2.4 + 0.5 * H(uv)) * 9.0 + u_marksFlow * 0.25;
  float d = abs(fract(v + 0.5) - 0.5) / max(fwidth(v), 1e-4);
  return 1.0 - clamp(d - u_marksWidth * u_k * 0.5 + 0.5, 0.0, 1.0);
}
/** Flecks of different sizes, two offset grids of one random dot per cell. */
float speckles(vec2 uv) {
  vec2 p = artPx(uv) + vec2(u_marksFlow * 7.0, 0.0);
  float s = max(u_marksSize * 0.5, 1.0), a = 0.0;
  for (int k = 0; k < 2; k++) {
    vec2 q = p / s + float(k) * vec2(0.5, 0.37);
    vec2 cell = floor(q);
    float h = hash12(cell + float(k) * 17.0);
    if (h < u_marksAmount * 0.9) {
      vec2 at = cell + 0.25 + 0.5 * vec2(hash12(cell + 3.1), hash12(cell + 7.7));
      float r = (0.06 + 0.2 * pow(hash12(cell + 11.3), 2.0)) * (0.6 + u_marksWidth * 0.25);
      float d = (length(q - at) - r) * s * u_k;
      a = max(a, clamp(0.5 - d, 0.0, 1.0) * (0.65 + 0.35 * hash12(cell + 5.3)));
    }
  }
  return a;
}
vec4 effect(vec2 uv) {
  float sd = sdfArt(uv - offsetUv(vec2(0.0, u_shadowOffset)));
  float sh = exp(-max(sd, 0.0) / max(u_shadowSoft, 1.0)) * u_shadow * 0.6;
  vec4 shadow = vec4(0.0, 0.0, 0.0, sh);
  float dt = sdfPx(uv);
  float cov = cover(dt);
  // Marks before the early return: contour lines take derivatives.
  float marks = u_surface > 1.5 ? speckles(uv) : u_surface > 0.5 ? contours(uv) * u_marksAmount : 0.0;
  if (cov <= 0.0) return shadow;
  vec3 n = normalAt(uv, u_depth);
  vec3 L = normalize(vec3(-0.35, -0.7, 0.62));
  float wrap = clamp(dot(n, L) * 0.6 + 0.45, 0.0, 1.0);
  vec3 c = mix(u_shade, u_body, smoothstep(0.0, 1.0, wrap));
  // Printed on the skin: shaded with it, so marks darken on the shadow side.
  c = mix(c, u_marks * mix(0.72, 1.06, wrap), marks);
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
    num('tooth', 'Stamp grain', 0, 1, 0.01, 0),
    num('seed', 'Seed', 0, 100, 1, 7, true),
  ],
  reach: (p) => n(p, 'roughness') * 3 + Math.max(0, n(p, 'bleed')) + 2,
  glsl: /* glsl */ `
uniform vec3 u_ink;
uniform float u_roughness, u_scale, u_bleed, u_speckle, u_grain, u_lines, u_tooth, u_seed;
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
  if (u_tooth > 0.0) {
    // Paper tooth: fine specks where the stamp missed, denser near the edges.
    float t = vnoise(p / (1.15 * s) + u_seed * 3.1) * 0.62 + fbm3(p / (9.0 * s) - u_seed) * 0.38;
    float thr = 1.0 - u_tooth * (0.3 + 0.32 * exp(min(dd, 0.0) / (5.0 * s)));
    cov *= 1.0 - smoothstep(thr, thr + 0.05, t);
  }
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
    choice('gradType', 'Gradient shape', ['Linear', 'Radial'], 0),
    num('gradX', 'Radial centre X', -1, 1, 0.01, 0, true),
    num('gradY', 'Radial centre Y', -1, 1, 0.01, 0, true),
    num('gradSize', 'Radial size', 0.05, 3, 0.01, 1, true),
    num('gradStart', 'Gradient starts', 0, 1, 0.005, 0, true),
    num('gradEnd', 'Gradient ends', 0, 1, 0.005, 1, true),
    num('outline', 'Outline', 0, 60, 0.5, 0),
    col('outlineColor', 'Outline colour', '#ff5a1f'),
    num('shadowOpacity', 'Shadow', 0, 1, 0.01, 0),
    num('shadowX', 'Shadow X', -100, 100, 1, 0, true),
    num('shadowY', 'Shadow Y', -100, 100, 1, 12, true),
    num('shadowBlur', 'Shadow blur', 0, 100, 0.5, 14, true),
    col('shadowColor', 'Shadow colour', '#000000', true),
    num('texture', 'Print texture', 0, 1, 0.01, 0),
  ],
  reach: (p) => n(p, 'outline') + Math.max(Math.abs(n(p, 'shadowX')), Math.abs(n(p, 'shadowY'))) + n(p, 'shadowBlur') * 2,
  glsl: /* glsl */ `
uniform vec3 u_fill, u_fill2, u_outlineColor, u_shadowColor;
uniform float u_gradient, u_angle, u_gradType, u_gradX, u_gradY, u_gradSize, u_gradStart, u_gradEnd, u_outline, u_shadowX, u_shadowY, u_shadowBlur, u_shadowOpacity, u_texture;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  // Blur 0 gives a hard offset shadow, as in flat "neo-brutalist" graphics.
  vec4 f = dropShadow(uv, vec2(u_shadowX, u_shadowY), u_outline, max(u_shadowBlur, 0.75 / u_k), u_shadowOpacity);
  f.rgb = u_shadowColor * f.a;
  if (u_outline > 0.0) {
    float ring = cover(dt - u_outline * u_k);
    f = over(vec4(u_outlineColor * ring, ring), f);
  }
  float c = cover(dt);
  float a = radians(u_angle);
  float g = clamp(dot(boxUv(uv) - 0.5, vec2(sin(a), -cos(a))) + 0.5, 0.0, 1.0);
  // Radial: 0 at the centre, 1 on an ellipse fitted to the box (× size).
  if (u_gradType > 0.5) g = clamp(length((boxUv(uv) - 0.5 - 0.5 * vec2(u_gradX, u_gradY)) * 2.0) / max(u_gradSize, 0.01), 0.0, 1.0);
  // The ramp can run over just part of the shape (a highlight cap, a fade at the bottom).
  g = clamp((g - u_gradStart) / max(u_gradEnd - u_gradStart, 1e-3), 0.0, 1.0);
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
    num('shade', '3D light', 0, 1, 0.01, 0),
    num('bevel', 'Roundness', 4, 300, 1, 90, true),
    col('paper', 'Paper', '#ffffff'),
    num('paperOn', 'Paper under dots', 0, 1, 0.01, 0),
    num('offsetX', 'Misregister X', -40, 40, 0.5, 0, true),
    num('offsetY', 'Misregister Y', -40, 40, 0.5, 0, true),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: 10 }),
  reach: (p) => 2 + Math.max(Math.abs(n(p, 'offsetX')), Math.abs(n(p, 'offsetY'))),
  glsl: /* glsl */ `
uniform vec3 u_ink, u_paper;
uniform float u_cell, u_angle, u_lines, u_ramp, u_rampAngle, u_edge, u_min, u_max, u_shade, u_paperOn, u_offsetX, u_offsetY;
vec4 effect(vec2 uv) {
  // Paper (optional) sits where the shape is; the dots print slightly off it.
  float pc = cover(sdfPx(uv)) * u_paperOn;
  vec4 paper = vec4(u_paper * pc, pc);
  uv -= offsetUv(vec2(u_offsetX, u_offsetY));
  float dt = sdfPx(uv);
  float cov = cover(dt);
  float ra = radians(u_rampAngle);
  float g = clamp(dot(boxUv(uv) - 0.5, vec2(sin(ra), -cos(ra))) + 0.5, 0.0, 1.0);
  float tone = mix(1.0, g, u_ramp);
  tone *= mix(1.0, smoothstep(0.0, u_cell * 4.0, -dt / u_k), u_edge);
  if (u_shade > 0.0) {
    // Dots grow on the side facing away from the light, like printed shading.
    vec3 nrm = normalAt(uv, 1.0);
    float lit = clamp(dot(nrm, normalize(vec3(-0.5, -0.6, 0.62))) * 0.9 + 0.15, 0.0, 1.0);
    tone *= mix(1.0, 1.0 - lit, u_shade);
  }
  tone = mix(u_min, u_max, tone);
  vec2 p = artPx(uv);
  float a = radians(u_angle);
  vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p / max(u_cell, 0.5);
  vec2 f = fract(q) - 0.5;
  float d = u_lines > 0.5 ? (abs(f.y) - tone * 0.5) : (length(f) - sqrt(max(tone, 0.0)) * 0.5);
  d *= u_cell * u_k;
  float m = clamp(0.5 - d / max(fwidth(d), 1e-3), 0.0, 1.0);
  // Only after fwidth: a derivative needs every pixel of its 2×2 quad still running.
  if (cov <= 0.0) return paper;
  float a2 = m * cov;
  return over(vec4(u_ink * a2, a2), paper);
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

const dither: EffectDef = {
  id: 'dither',
  name: 'Dither',
  description: 'One-bit dithering: light and gradients drawn with two inks in a pixel pattern.',
  params: [
    col('ink', 'Ink', '#0a0a0a'),
    col('light', 'Light', '#e9ff3b'),
    num('cell', 'Pixel size', 1, 24, 0.5, 4),
    num('shade', '3D light', 0, 1, 0.01, 0.7),
    num('ramp', 'Gradient', 0, 1, 0.01, 0.35),
    num('angle', 'Gradient angle', 0, 360, 1, 160, true),
    num('levels', 'Tone', -1, 1, 0.01, 0),
    num('bevel', 'Roundness', 4, 300, 1, 80, true),
    num('noise', 'Noise pattern', 0, 1, 1, 0),
    num('shadow', 'Dithered shadow', 0, 1, 0.01, 0),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: 8 }),
  reach: (p) => (n(p, 'shadow') > 0 ? 60 : 1),
  glsl: /* glsl */ `
uniform vec3 u_ink, u_light;
uniform float u_cell, u_shade, u_ramp, u_angle, u_levels, u_noise, u_shadow;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer8(vec2 a) {
  float b4 = bayer2(0.25 * a) * 0.0625 + bayer2(0.5 * a) * 0.25 + bayer2(a);
  return fract(b4);
}
float threshold(vec2 px) {
  vec2 c = floor(px / max(u_cell, 1.0));
  return u_noise > 0.5 ? hash12(c) : bayer8(c);
}
vec4 effect(vec2 uv) {
  vec2 px = artPx(uv);
  float th = threshold(px);
  // Coverage first: fwidth inside the per-pixel shadow test would read pixels that skipped it.
  float dt = sdfPx(uv);
  float cov = cover(dt);
  vec4 shadow = vec4(0.0);
  if (u_shadow > 0.0) {
    float sd = sdfArt(uv - offsetUv(vec2(0.0, 22.0)));
    float s = exp(-max(sd, 0.0) / 26.0) * u_shadow;
    if (s > th) shadow = vec4(u_ink, 1.0) * clamp(1.0 - cov, 0.0, 1.0);
  }
  if (cov <= 0.0) return shadow;
  vec3 nrm = normalAt(uv, 1.0);
  vec3 L = normalize(vec3(-0.45, -0.65, 0.62));
  float lit = clamp(dot(nrm, L) * 0.75 + 0.3, 0.0, 1.0);
  float a = radians(u_angle);
  float g = clamp(dot(boxUv(uv) - 0.5, vec2(sin(a), -cos(a))) + 0.5, 0.0, 1.0);
  float tone = mix(1.0, lit, u_shade) * mix(1.0, g, u_ramp);
  tone = clamp(tone + u_levels * 0.5, 0.0, 1.0);
  vec3 c = tone > th ? u_light : u_ink;
  return over(vec4(c * cov, cov), shadow);
}`,
};

const photo: EffectDef = {
  id: 'photo',
  name: 'Photo',
  description: 'A picture inside the shape, framed to fill it, with optional duotone, contrast and grain.',
  photo: true,
  params: [
    num('zoom', 'Zoom', 1, 6, 0.01, 1),
    num('x', 'Pan X', -1, 1, 0.01, 0),
    num('y', 'Pan Y', -1, 1, 0.01, 0),
    num('duotone', 'Duotone', 0, 1, 0.01, 0),
    col('dark', 'Shadows', '#14102e'),
    col('light', 'Highlights', '#ff8a1f'),
    num('contrast', 'Contrast', 0, 2, 0.01, 1),
    num('brightness', 'Brightness', -1, 1, 0.01, 0),
    num('saturation', 'Saturation', 0, 2, 0.01, 1, true),
    num('grain', 'Grain', 0, 1, 0.01, 0),
  ],
  reach: () => 1,
  glsl: /* glsl */ `
uniform sampler2D u_photo;
uniform float u_hasPhoto, u_imgAspect, u_zoom, u_x, u_y, u_duotone, u_contrast, u_brightness, u_saturation, u_grain;
uniform vec3 u_dark, u_light;
vec4 effect(vec2 uv) {
  float cov = cover(sdfPx(uv));
  vec2 box = (u_bbox.zw - u_bbox.xy) * u_region.zw;
  float ba = box.x / max(box.y, 1e-3);
  vec2 q = boxUv(uv) - 0.5;
  // Cover: fill the shape's box, cropping the picture's longer side.
  if (ba > u_imgAspect) q.y *= u_imgAspect / ba; else q.x *= ba / u_imgAspect;
  float z = max(u_zoom, 1.0);
  q = q / z + 0.5 + vec2(u_x, u_y) * 0.5 * (1.0 - 1.0 / z);
  vec3 c = u_hasPhoto > 0.5 ? texture(u_photo, q).rgb : mix(vec3(0.55), vec3(0.7), step(0.5, fract((q.x + q.y) * 8.0)));
  // Only after sampling: the picture's mip level comes from derivatives of q across the 2×2 quad.
  if (cov <= 0.0) return vec4(0.0);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, u_saturation);
  c = (c - 0.5) * u_contrast + 0.5 + u_brightness * 0.5;
  l = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  c = mix(c, mix(u_dark, u_light, smoothstep(0.0, 1.0, l)), u_duotone);
  c += (hash12(floor(artPx(uv) * u_k)) - 0.5) * u_grain * 0.25;
  return vec4(clamp(c, 0.0, 1.0) * cov, cov);
}`,
};


const frost: EffectDef = {
  id: 'frost',
  name: 'Frosted glass',
  description: 'Blurs whatever is behind it, with a tint, a lit edge and grain. Put it over type or shapes.',
  backdrop: true,
  params: [
    num('blur', 'Blur', 0, 120, 0.5, 26),
    col('tint', 'Tint', '#ffffff'),
    num('tintAmount', 'Tint amount', 0, 1, 0.01, 0.18),
    col('tint2', 'Bottom tint', '#3b4bd8'),
    num('gradient', 'Tint gradient', 0, 1, 0.01, 0),
    num('rim', 'Edge light', 0, 2, 0.01, 0.8),
    num('refraction', 'Bend at edges', 0, 2, 0.01, 0.5),
    num('grain', 'Grain', 0, 1, 0.01, 0.2),
    num('shadow', 'Shadow', 0, 1, 0.01, 0.35),
    num('bevel', 'Edge width', 2, 120, 1, 16, true),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: 3 }),
  reach: (p) => (n(p, 'shadow') > 0 ? 70 : 0) + n(p, 'refraction') * 20,
  glsl: /* glsl */ `
uniform vec3 u_tint, u_tint2;
uniform float u_blur, u_tintAmount, u_gradient, u_rim, u_refraction, u_grain, u_shadow;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float d = dt / u_k;
  float cov = cover(dt);
  vec4 sh = dropShadow(uv, vec2(0.0, 16.0), -4.0, 28.0, u_shadow * 0.55);
  if (cov <= 0.0) return sh;
  vec3 n = normalAt(uv, 1.0);
  vec3 bg = behindBlur(uv + offsetUv(-n.xy * u_refraction * 16.0)).rgb;
  vec3 tint = mix(u_tint, u_tint2, clamp(boxUv(uv).y, 0.0, 1.0) * u_gradient);
  vec3 c = mix(bg, tint, u_tintAmount);
  c += (1.0 - c) * 0.06;
  vec3 L = normalize(vec3(-0.45, -0.6, 0.66));
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0);
  float edge = (1.0 - n.z) * max(dot(normalize(n.xy + 1e-5), -L.xy), 0.0);
  c += (spec * 0.45 + edge * 0.55) * u_rim;
  c += (hash12(floor(artPx(uv) * u_k)) - 0.5) * u_grain * 0.09;
  return over(vec4(clamp(c, 0.0, 1.0) * cov, cov), sh);
}`,
};

const lens: EffectDef = {
  id: 'lens',
  name: 'Lens glass',
  description: 'Clear glass that bends and magnifies what is behind it, splitting light into colour at the edges.',
  backdrop: true,
  params: [
    num('refraction', 'Refraction', 0, 2, 0.01, 0.7),
    num('dispersion', 'Colour split', 0, 2, 0.01, 0.6),
    num('magnify', 'Magnify', -1, 1, 0.01, 0.2),
    num('focusX', 'Focus X', -1, 1, 0.01, 0),
    num('focusY', 'Focus Y', -1, 1, 0.01, 0),
    num('rainbow', 'Rainbow light', 0, 2, 0.01, 0),
    num('rainbowWidth', 'Rainbow width', 0.1, 3, 0.01, 1),
    num('rainbowShift', 'Rainbow shift', -1, 1, 0.01, 0),
    num('lightAngle', 'Light angle', -180, 180, 1, -130),
    num('iridescence', 'Iridescence', 0, 1.5, 0.01, 0.5),
    num('highlight', 'Highlight', 0, 2, 0.01, 0.8),
    num('film', 'Edge film', 0, 1, 0.01, 0),
    num('edgeBend', 'Edge bend', 0, 2, 0.01, 0),
    num('rim', 'Rim', 0, 2, 0.01, 0.8),
    col('tint', 'Tint', '#ffffff'),
    num('tintAmount', 'Tint amount', 0, 1, 0.01, 0.03),
    num('thickness', 'Thickness', 0, 1, 0.01, 0),
    num('blur', 'Frost', 0, 60, 0.5, 0),
    num('bevel', 'Dome', 4, 600, 1, 70, true),
    num('chamfer', 'Flat facets', 0, 1, 1, 0, true),
    num('softness', 'Smooth dome', 0, 300, 1, 10, true),
  ],
  height: (p) => ({ profile: n(p, 'chamfer') > 0.5 ? 1 : 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  reach: (p, size) => n(p, 'refraction') * (30 + n(p, 'bevel') * 0.8) + n(p, 'thickness') * 0.75 * Math.min(size.w, size.h),
  glsl: /* glsl */ `
uniform vec3 u_tint;
uniform float u_refraction, u_dispersion, u_magnify, u_focusX, u_focusY, u_iridescence, u_rim, u_tintAmount, u_thickness, u_rainbow, u_rainbowWidth, u_lightAngle, u_highlight, u_film, u_rainbowShift, u_edgeBend;
/**
 * Light fanned out by a prism and overlapping with itself, as rendered glass
 * shows it: hue wraps red → yellow → green → (dim blue) → magenta → red, so
 * bands blend through magenta and stay mostly warm.
 */
vec3 prismBand(float u) {
  float h = fract(u);
  vec3 c = clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  float blue = smoothstep(0.42, 0.55, h) * (1.0 - smoothstep(0.7, 0.8, h));
  return c * (1.0 - 0.7 * blue);
}
/** Pure spectral colour, 0 = deep red … 1 = violet, fading out at both ends. */
vec3 spectral(float t) {
  vec3 c = clamp(abs(fract(t * 0.8 + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return c * smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.85, t);
}
/** Where a view ray through surface normal n lands on the back plane, depth h art px below. */
vec2 lensShift(vec3 n, float ior, float h) {
  vec3 t = refract(vec3(0.0, 0.0, -1.0), n, 1.0 / ior);
  return offsetUv(t.xy / max(-t.z, 0.2) * (h + 6.0));
}
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float d = dt / u_k;
  float cov = cover(dt);
  if (cov <= 0.0) return vec4(0.0);
  vec3 n = normalAt(uv, 1.0);
  float steep = 1.0 - n.z;
  float la = radians(u_lightAngle);
  vec3 L = normalize(vec3(cos(la) * 0.78, sin(la) * 0.78, 0.62));
  // Magnify around the focus point (the middle of the shape by default).
  vec2 ctr = (u_bbox.xy + u_bbox.zw) * 0.5 + (u_bbox.zw - u_bbox.xy) * 0.5 * vec2(u_focusX, u_focusY);
  float zoom = 1.0 - u_magnify * 0.6;
  vec2 box = (u_bbox.zw - u_bbox.xy) * u_region.zw;
  vec2 m = ctr + (uv - ctr) * zoom;
  // Physically based: the view ray enters the dome (Snell's law), then runs
  // down to the flat back of the glass, as deep as the dome is tall there. A
  // convex dome magnifies by itself; steep rims bend hardest.
  // A thick block: rays through the slopes run much deeper before they leave.
  float hArt = H(uv) * u_bevelTex / u_k + u_thickness * 0.6 * min(box.x, box.y);
  // Edge bend: at a grazing edge the glass reflects its own inside (total
  // internal reflection), squeezing a wide strip of it into a thin band.
  vec2 edgeOff = vec2(0.0);
  if (u_edgeBend > 0.0) {
    // Steer by the smooth surface normal (the raw outline would make the band ragged).
    vec2 e = vec2(4.0) / u_texSize;
    vec2 g = vec2(sdfPx(uv + vec2(e.x, 0.0)) - sdfPx(uv - vec2(e.x, 0.0)), sdfPx(uv + vec2(0.0, e.y)) - sdfPx(uv - vec2(0.0, e.y)));
    g = normalize(g + 1e-6) + n.xy * 4.0;
    float rimW = 0.08 * min(box.x, box.y);
    float s = clamp(1.0 + d / rimW, 0.0, 1.0);
    edgeOff = offsetUv(-normalize(g + 1e-6) * s * s * rimW * 2.2 * u_edgeBend);
  }
  float ior = 1.0 + 0.5 * u_refraction;
  // Each wavelength has its own index (Cauchy): violet bends more than red.
  float spread = u_dispersion * 0.18;
  vec3 c;
  if (spread < 0.001) c = behindBlur(m + edgeOff + lensShift(n, ior, hArt)).rgb;
  else {
    // Jittered per pixel so the wavelengths blend into a continuous spectrum
    // instead of showing separate coloured copies.
    vec3 acc = vec3(0.0), ws = vec3(0.0);
    vec2 fp = floor(artPx(uv) * u_k);
    float jit = fract(52.9829189 * fract(dot(fp, vec2(0.06711056, 0.00583715))));
    for (int i = 0; i < 16; i++) {
      float t = (float(i) + jit) / 16.0;
      vec3 w = max(vec3(0.0), 1.0 - abs(t - vec3(0.1, 0.5, 0.9)) / 0.42);
      // Lateral colour: each wavelength is also magnified a little differently.
      vec2 mt = m + (uv - ctr) * ((t - 0.5) * u_dispersion * 0.05);
      acc += behindBlur(mt + edgeOff * (1.0 + (t - 0.5) * u_dispersion * 0.35) + lensShift(n, ior + (t - 0.5) * spread, hArt)).rgb * w;
      ws += w;
    }
    c = acc / ws;
  }
  // Thick glass passes less light through its slopes (absorption, reflection).
  c *= 1.0 - smoothstep(0.03, 0.3, steep) * clamp(u_thickness, 0.0, 1.0) * 0.8;
  // Thin-film colour on the steep, lit side of the glass.
  float lit = 0.35 + 0.65 * max(dot(normalize(n.xy + 1e-5), normalize(L.xy)), 0.0);
  vec3 iri = spectrum(atan(n.y, n.x) / 6.2832 + steep * 1.7);
  c = mix(c, c * 0.35 + iri, clamp(steep * steep * u_iridescence * 1.6 * lit, 0.0, 1.0) * 0.7);
  c = mix(c, u_tint, u_tintAmount);
  // Rainbow light: a bright studio light seen through the slopes of the glass.
  // Every wavelength bends by a different amount, so where the slope turns
  // toward the light its image fans out into ordered spectral bands.
  if (u_rainbow > 0.0) {
    // Where the light's image lands depends on the slope and on where on the
    // glass we are, so flat facets still sweep through the spectrum.
    vec2 ld = normalize(L.xy);
    vec2 pc = boxUv(uv) - 0.5;
    vec2 slope = n.xy / max(n.z, 0.2);
    float toward = dot(slope, ld);
    float w = 0.9 * u_rainbowWidth;
    // The light's image runs around the bevel, so the hue follows the angle
    // around the shape, measured from the light.
    vec2 pd = normalize(pc + 1e-5);
    float around = atan(ld.x * pd.y - ld.y * pd.x, dot(ld, pd)) / 3.14159;
    float u = 0.5 - around / w + toward * 0.25 + u_rainbowShift;
    float back = (-toward * 0.5 - dot(pc, ld) * 0.8 - 0.25) / w;
    float onSlope = smoothstep(0.02, 0.15, 1.0 - n.z);
    // Slopes facing the light show the light itself, not what's behind.
    // A big studio light: slopes up to sideways-on to it still catch it.
    float litFace = smoothstep(-0.35, 0.2, toward) * onSlope * min(u_rainbow, 1.0);
    vec3 band = prismBand(u);
    c = mix(c, band * max(u_rainbow, 1.0), litFace * max(max(band.r, band.g), band.b));
    c += spectral(back) * 0.12 * smoothstep(0.0, 0.2, -toward) * u_rainbow * onSlope;
  }
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
  c += vec3(spec) * 0.8 * u_highlight;
  // Fresnel: grazing glass reflects a little light.
  c += pow(steep, 3.0) * 0.18 * u_rim;
  // A thin dark rim where the glass edge catches nothing.
  c *= 1.0 - smoothstep(-2.5, 0.0, d) * 0.4 * u_rim;
  // Edge film: a hairline of thin-film colour along the outline, gold where
  // the edge faces the light and violet-blue where it turns away.
  if (u_film > 0.0) {
    float facing = dot(normalize(n.xy + 1e-5), normalize(L.xy));
    vec3 film = mix(vec3(0.33, 0.24, 0.62), vec3(0.72, 0.6, 0.22), smoothstep(-0.6, 0.6, facing));
    float band = smoothstep(-4.5, -1.5, d);
    c = mix(c, film, band * u_film);
  }
  return vec4(clamp(c, 0.0, 1.0) * cov, cov);
}`,
};

const thermal: EffectDef = {
  id: 'thermal',
  name: 'Thermal',
  description: 'Heat-camera colours: a cool core that heats up toward the edges and glows out into the canvas.',
  params: [
    num('spread', 'Heat spread', 4, 300, 1, 70),
    num('glow', 'Glow', 0, 400, 1, 140),
    num('glowAmount', 'Glow amount', 0, 1, 0.01, 0.9),
    num('noise', 'Hot spots', 0, 1, 0.01, 0.35),
    num('scale', 'Spot size', 0.2, 4, 0.01, 1),
    num('shift', 'Shift colours', -0.5, 0.5, 0.01, 0),
    num('invert', 'Hot core', 0, 1, 1, 0),
    num('grain', 'Grain', 0, 1, 0.01, 0.55),
    num('seed', 'Seed', 0, 100, 0.1, 2, true),
  ],
  height: (p) => ({ profile: 2, bevel: n(p, 'spread'), softness: n(p, 'spread') * 0.4 }),
  reach: (p) => n(p, 'glow') * 3 * Math.min(1, n(p, 'glowAmount') * 2),
  glsl: /* glsl */ `
uniform float u_spread, u_glow, u_glowAmount, u_noise, u_scale, u_shift, u_invert, u_grain, u_seed;
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.06, 0.17, 1.0), c1 = vec3(0.18, 0.55, 1.0), c2 = vec3(0.62, 0.84, 1.0), c3 = vec3(1.0, 0.95, 0.54), c4 = vec3(1.0, 0.7, 0.12), c5 = vec3(1.0, 0.23, 0.12), c6 = vec3(0.91, 0.07, 0.24);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.42) return mix(c1, c2, (t - 0.25) / 0.17);
  if (t < 0.55) return mix(c2, c3, (t - 0.42) / 0.13);
  if (t < 0.7) return mix(c3, c4, (t - 0.55) / 0.15);
  if (t < 0.85) return mix(c4, c5, (t - 0.7) / 0.15);
  return mix(c5, c6, (t - 0.85) / 0.15);
}
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float d = dt / u_k;
  float cov = cover(dt);
  vec2 p = artPx(uv);
  float h = d <= 0.0 ? 0.5 * (1.0 - H(uv)) : 1.0 - 0.5 * exp(-d / max(u_glow, 1.0));
  h += (fbm3(p / (180.0 * u_scale) + u_seed) - 0.5) * u_noise * 0.6;
  if (u_invert > 0.5) h = 1.0 - h;
  vec3 c = heat(h + u_shift);
  c += (hash12(floor(p * u_k) + u_seed) - 0.5) * u_grain * 0.22;
  float a = max(cov, (1.0 - cov) * u_glowAmount * exp(-max(d, 0.0) / max(u_glow * 1.2, 1.0)));
  return vec4(clamp(c, 0.0, 1.0) * a, a);
}`,
};

const prism: EffectDef = {
  id: 'prism',
  name: 'Prism light',
  description: 'Spectral light streaks shining out from the shapes, away from a centre. Lovely with Screen blending on black.',
  params: [
    num('length', 'Streak length', 0, 1, 0.01, 0.55),
    num('intensity', 'Intensity', 0, 3, 0.01, 1.3),
    num('hue', 'Hue', 0, 1, 0.005, 0),
    num('spread', 'Colour spread', 0, 3, 0.01, 1),
    num('saturation', 'Saturation', 0, 1.5, 0.01, 1),
    num('core', 'Shapes glow', 0, 2, 0.01, 0.8),
    num('cx', 'Centre X', -1, 1, 0.01, 0, true),
    num('cy', 'Centre Y', -1, 1, 0.01, 0, true),
  ],
  reach: (p, s) => n(p, 'length') * Math.max(s.w, s.h) * 0.7,
  glsl: /* glsl */ `
uniform float u_length, u_intensity, u_hue, u_spread, u_saturation, u_core, u_cx, u_cy;
vec4 effect(vec2 uv) {
  vec2 ctr = mix(u_bbox.xy, u_bbox.zw, vec2(0.5 + 0.5 * u_cx, 0.5 + 0.5 * u_cy));
  vec2 toC = ctr - uv;
  float acc = 0.0;
  float jit = hash12(floor(artPx(uv) * u_k));
  for (int i = 0; i < 40; i++) {
    float s = (float(i) + jit) / 40.0 * u_length;
    acc += texture(u_mask, uv + toC * s).a * (1.0 - s / max(u_length, 1e-3));
  }
  acc = acc / 40.0 * 3.0;
  vec2 v = artPx(uv) - artPx(ctr);
  vec3 col = spectrum(atan(v.y, v.x) / 6.2832 * u_spread + u_hue);
  col = mix(vec3(dot(col, vec3(0.333))), col, u_saturation);
  float core = cover(sdfPx(uv));
  vec3 rgb = col * acc * u_intensity + mix(col, vec3(1.0), 0.2) * core * u_core;
  float a = clamp(max(max(rgb.r, rgb.g), rgb.b), 0.0, 1.0);
  return vec4(min(rgb, vec3(a)), a);
}`,
};

const colorDots: EffectDef = {
  id: 'colordots',
  name: 'Colour dots',
  description: 'A soft colour field printed as a dot screen: dots grow where the colour is bright.',
  params: [
    col('c1', 'Hot', '#ff2a14'),
    col('c2', 'Warm', '#ffb21f'),
    col('c3', 'Cool', '#2d3cff'),
    col('c4', 'Dark', '#12030a'),
    num('cell', 'Dot spacing', 3, 60, 0.5, 11),
    num('contrast', 'Contrast', 0.3, 3, 0.01, 1.1),
    num('softness', 'Softness', 0.2, 2, 0.01, 1),
    num('angle', 'Screen angle', 0, 90, 1, 0, true),
    num('seed', 'Arrangement', 0, 100, 0.1, 4),
  ],
  reach: () => 0,
  glsl: /* glsl */ `
uniform vec3 u_c1, u_c2, u_c3, u_c4;
uniform float u_cell, u_contrast, u_softness, u_angle, u_seed;
float blob(vec2 q, vec2 c, vec2 r) { vec2 k = (q - c) / max(r, vec2(1e-3)); return exp(-dot(k, k) * 1.6); }
vec3 field(vec2 q) {
  float s = u_seed;
  vec3 c = u_c4;
  c = mix(c, u_c1, blob(q, vec2(0.5 + 0.1 * cos(s), 0.85), vec2(0.45, 0.32) * u_softness));
  c = mix(c, u_c2, blob(q, vec2(0.08 + 0.1 * sin(s * 1.3), 0.3), vec2(0.18, 0.3) * u_softness) * 0.9);
  c = mix(c, u_c2, blob(q, vec2(0.92, 0.32 + 0.1 * cos(s * 0.7)), vec2(0.16, 0.26) * u_softness) * 0.8);
  c = mix(c, u_c3, blob(q, vec2(0.02, 0.6 + 0.1 * sin(s)), vec2(0.12, 0.2) * u_softness) * 0.9);
  c = mix(c, u_c4, blob(q, vec2(0.5, 0.15), vec2(0.3, 0.3) * u_softness) * 0.8);
  return c;
}
vec4 effect(vec2 uv) {
  float cov = cover(sdfPx(uv));
  float a = radians(u_angle);
  mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 p = R * artPx(uv);
  vec2 g = p / u_cell;
  vec2 cellC = transpose(R) * ((floor(g) + 0.5) * u_cell);
  vec2 uvC = (cellC - u_region.xy) / u_region.zw;
  vec3 c = field(clamp(boxUv(uvC), 0.0, 1.0));
  float lum = pow(clamp(dot(c, vec3(0.3, 0.59, 0.11)) * 2.0, 0.0, 1.0), u_contrast);
  float r = 0.5 * u_cell * clamp(sqrt(lum) * 1.35, 0.0, 1.0);
  float dist = length(fract(g) - 0.5) * u_cell;
  float aa = max(fwidth(dist), 1e-3);
  // Only after fwidth: a derivative needs every pixel of its 2×2 quad still running.
  if (cov <= 0.0) return vec4(0.0);
  float dotA = clamp((r - dist) / aa + 0.5, 0.0, 1.0) * cov;
  vec3 col = clamp(c / max(max(c.r, max(c.g, c.b)), 0.25), 0.0, 1.0);
  return vec4(col * dotA, dotA);
}`,
};

const plush: EffectDef = {
  id: 'plush',
  name: 'Plush',
  description: 'Soft fuzzy fabric with a furry edge, like a stuffed toy.',
  params: [
    col('color', 'Fabric', '#e5179b'),
    col('shade', 'Shade', '#7d0753'),
    num('fuzz', 'Fuzz', 0, 40, 0.5, 9),
    num('density', 'Fur fineness', 0.2, 4, 0.01, 1),
    num('light', 'Light', 0, 1, 0.01, 0.75),
    num('sheen', 'Sheen', 0, 1.5, 0.01, 0.45),
    num('bevel', 'Puff', 4, 300, 1, 80, true),
    num('softness', 'Softness', 0, 80, 1, 24, true),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  reach: (p) => n(p, 'fuzz') * 2 + 4,
  glsl: /* glsl */ `
uniform vec3 u_color, u_shade;
uniform float u_fuzz, u_density, u_light, u_sheen;
vec4 effect(vec2 uv) {
  float d = sdfArt(uv);
  vec2 p = artPx(uv);
  float f1 = fbm3(p * 0.32 * u_density);
  float f2 = vnoise(p * 1.1 * u_density);
  float hair = f1 * 0.65 + f2 * 0.35 - 0.5;
  float dd = d - hair * u_fuzz * 1.6 - u_fuzz * 0.15;
  float a = clamp(0.5 - dd / max(fwidth(dd), 0.75), 0.0, 1.0);
  if (a <= 0.0) return vec4(0.0);
  vec3 n = normalAt(uv, 1.0);
  vec3 L = normalize(vec3(-0.4, -0.55, 0.73));
  float lam = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(u_shade, u_color, mix(0.75, pow(lam, 0.8), u_light));
  c *= 0.86 + 0.28 * (f2 - 0.5) + 0.12 * (f1 - 0.5);
  float rim = (1.0 - n.z) * u_sheen;
  c += mix(u_color, vec3(1.0), 0.55) * rim * 0.35;
  // Stray hairs past the edge are thinner and darker.
  c *= mix(0.75, 1.0, clamp(-d / max(u_fuzz, 1.0), 0.0, 1.0));
  return vec4(clamp(c, 0.0, 1.0) * a, a);
}`,
};


const glow: EffectDef = {
  id: 'glow',
  name: 'Glow gradient',
  description: 'Colour by distance from the edge, inside and out: glowing UI shapes, auras and light fades.',
  params: [
    col('edge', 'Edge colour', '#ffc21a'),
    col('mid', 'Middle colour', '#6b1f08'),
    col('core', 'Core colour', '#000000'),
    num('inside', 'Inside glow', 0, 800, 1, 140),
    num('curve', 'Falloff', 0.2, 4, 0.01, 1),
    col('out1', 'Outer colour', '#2f7bff'),
    col('out2', 'Outer fade', '#5b2bd6'),
    num('outside', 'Outer glow', 0, 800, 1, 0),
    num('outAmount', 'Outer strength', 0, 1.5, 0.01, 1),
    num('outMix', 'Outer colour shift', 0.05, 1, 0.01, 0.6),
    num('grain', 'Grain', 0, 1, 0.01, 0.1),
  ],
  // The inside gradient follows a smoothed depth, so corners don't crease.
  height: (p) => ({ profile: 1, bevel: Math.max(1, n(p, 'inside')), softness: n(p, 'inside') * 0.35 }),
  reach: (p) => n(p, 'outside') * 1.2,
  glsl: /* glsl */ `
uniform vec3 u_edge, u_mid, u_core, u_out1, u_out2;
uniform float u_inside, u_curve, u_outside, u_outAmount, u_outMix, u_grain;
vec3 grad3(vec3 a, vec3 b, vec3 c, float t) { return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0); }
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float d = dt / u_k;
  float cov = cover(dt);
  vec4 o = vec4(0.0);
  // Outside: a glow that fades from the outer colour through the fade colour to nothing.
  if (u_outside > 0.0 && u_outAmount > 0.0) {
    float t = clamp(max(d, 0.0) / u_outside, 0.0, 1.0);
    float g = pow(1.0 - smoothstep(0.0, 1.0, t), 1.6) * u_outAmount;
    vec3 c = mix(u_out1, u_out2, smoothstep(0.0, u_outMix, t));
    o = vec4(c * g, g) * (1.0 - cov);
  }
  if (cov > 0.0) {
    // Inside: edge colour at the outline, through the middle colour to the core.
    float t = u_inside > 0.0 ? pow(clamp(H(uv), 0.0, 1.0), u_curve) : 1.0;
    o = vec4(grad3(u_edge, u_mid, u_core, t) * cov, cov) + o;
  }
  o.rgb += (hash12(floor(artPx(uv) * u_k)) - 0.5) * u_grain * 0.12 * o.a;
  return clamp(o, 0.0, 1.0);
}`,
};

const grainy: EffectDef = {
  id: 'grainy',
  name: 'Grain gradient',
  description: 'A lit, rounded form coloured by a three-colour gradient and dissolved into film grain.',
  params: [
    col('lit', 'Light colour', '#ff8de6'),
    col('body', 'Body colour', '#ff5a4f'),
    col('dark', 'Shadow colour', '#26a84a'),
    num('lightAngle', 'Light angle', -180, 180, 1, -40),
    num('spread', 'Spread', 0.2, 3, 0.01, 1),
    num('grain', 'Grain', 0, 1, 0.01, 0.55),
    num('grainSize', 'Grain size', 0.5, 6, 0.1, 1.2),
    num('edgeGrain', 'Grainy edge', 0, 1, 0.01, 0.5),
    num('bevel', 'Roundness', 4, 600, 1, 400, true),
    num('softness', 'Softness', 0, 120, 1, 30, true),
  ],
  height: (p) => ({ profile: 0, bevel: n(p, 'bevel'), softness: n(p, 'softness') }),
  reach: (p) => 4 + n(p, 'edgeGrain') * 12,
  glsl: /* glsl */ `
uniform vec3 u_lit, u_body, u_dark;
uniform float u_lightAngle, u_spread, u_grain, u_grainSize, u_edgeGrain;
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float d = dt / u_k;
  // Grain is a per-pixel dither of the gradient position (and of the edge):
  // the colours stay pure but blend through a speckle, like risograph or film.
  vec2 gp = floor(artPx(uv) * u_k / max(u_grainSize, 0.5));
  float nz = hash12(gp) - 0.5;
  float edgeW = 1.0 + u_edgeGrain * 10.0;
  float cov = clamp(0.5 - (d + nz * edgeW * 1.6 * u_edgeGrain) / edgeW, 0.0, 1.0);
  cov = max(cover(dt) * (1.0 - u_edgeGrain), cov);
  if (cov <= 0.0) return vec4(0.0);
  vec3 n = normalAt(uv, 1.0);
  float la = radians(u_lightAngle);
  vec3 L = normalize(vec3(cos(la) * 0.8, sin(la) * 0.8, 0.6));
  // Sideways light only, so the middle of the form shows the body colour.
  float t = clamp(dot(n.xy, normalize(L.xy)) * 0.5 * u_spread + 0.5 + nz * u_grain, 0.0, 1.0);
  // 0 = shadow side, 0.5 = body, 1 = lit side.
  vec3 c = t < 0.5 ? mix(u_dark, u_body, smoothstep(0.0, 0.5, t)) : mix(u_body, u_lit, smoothstep(0.5, 1.0, t));
  // Round form: the rim turning away from the light falls off a little.
  float rim = 1.0 - n.z;
  c *= 1.0 - 0.35 * rim * rim * (1.0 - max(dot(normalize(n.xy + 1e-5), normalize(L.xy)), 0.0));
  return vec4(clamp(c, 0.0, 1.0) * cov, cov);
}`,
};

const mosaic: EffectDef = {
  id: 'mosaic',
  name: 'Mosaic',
  description: 'Fills the shape with blocks and bricks in random palette colours, like toy bricks or pixel quilts.',
  params: [
    num('cell', 'Block size', 2, 200, 0.5, 24),
    num('bricks', 'Bricks', 0, 1, 0.01, 0.6),
    num('wide', 'Brick width', 0.25, 8, 0.01, 1),
    num('gap', 'Gap', 0, 0.45, 0.01, 0),
    num('round', 'Rounded', 0, 0.5, 0.01, 0),
    col('c1', 'Colour 1', '#e8281e'),
    col('c2', 'Colour 2', '#ffd400'),
    col('c3', 'Colour 3', '#1b6fe0'),
    col('c4', 'Colour 4', '#11a85a'),
    col('c5', 'Colour 5', '#ffffff'),
    col('c6', 'Colour 6', '#4bb4ff'),
    num('seed', 'Shuffle', 0, 100, 1, 7),
  ],
  reach: () => 2,
  glsl: /* glsl */ `
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_c5, u_c6;
uniform float u_cell, u_bricks, u_wide, u_gap, u_round, u_seed;
vec3 pal(float h) {
  float i = floor(h * 6.0);
  return i < 1.0 ? u_c1 : i < 2.0 ? u_c2 : i < 3.0 ? u_c3 : i < 4.0 ? u_c4 : i < 5.0 ? u_c5 : u_c6;
}
vec4 effect(vec2 uv) {
  float dt = sdfPx(uv);
  float cov = cover(dt);
  // Cells counted from the object's top-left corner so blocks line up with it.
  vec2 p = (artPx(uv) - (u_region.xy + u_bbox.xy * u_region.zw)) / (u_cell * vec2(max(u_wide, 0.05), 1.0));
  vec2 c = floor(p);
  // Every 2x2 block is four singles, two bricks across, two bricks down, or one big block.
  vec2 blk = floor(c / 2.0);
  float r = hash12(blk + u_seed * 17.0);
  vec2 lo = c, size = vec2(1.0);
  if (r < u_bricks * 0.4) { lo = vec2(blk.x * 2.0, c.y); size = vec2(2.0, 1.0); }
  else if (r < u_bricks * 0.8) { lo = vec2(c.x, blk.y * 2.0); size = vec2(1.0, 2.0); }
  else if (r < u_bricks) { lo = blk * 2.0; size = vec2(2.0); }
  vec3 col = pal(hash12(lo * 1.37 + size * 7.1 + u_seed));
  // Gaps and rounded corners inside each block.
  vec2 q = (p - lo) / size - 0.5;
  vec2 half_ = 0.5 - u_gap / size * 0.5;
  float rr = u_round * min(half_.x * size.x, half_.y * size.y) / max(size.x, size.y);
  vec2 e = abs(q) - half_ + rr;
  float bd = (length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - rr) * u_cell * min(size.x, size.y) * u_k;
  float inBlock = (u_gap > 0.0 || u_round > 0.0) ? clamp(0.5 - bd / max(fwidth(bd), 1e-3), 0.0, 1.0) : 1.0;
  // Only after fwidth: a derivative needs every pixel of its 2×2 quad still running.
  if (cov <= 0.0) return vec4(0.0);
  float a = cov * inBlock;
  return vec4(col * a, a);
}`,
};


export const PATTERN_KINDS = ['Stripes', 'Dots', 'Grid', 'Checker', 'Sunburst', 'Rings', 'Waves', 'Chevron', 'Truchet', 'Scales', 'Houndstooth', 'Op-art bulge', 'Spiral', 'Crosses', 'Triangles', 'Diamonds', 'Honeycomb', 'Squiggles', 'Crosshatch', 'Gingham', 'Bars', 'Mosaic', 'Barcode', 'Flow lines'];

const patternFx: EffectDef = {
  id: 'pattern',
  name: 'Pattern',
  description: 'Fills the shape with a crisp repeating pattern drawn on the GPU: stripes, dots, sunbursts, Truchet arcs, houndstooth, op-art, riding bars, a flickering mosaic, barcode rows, flowing lines and more. Speed sets it moving.',
  params: [
    choice('kind', 'Pattern', PATTERN_KINDS, 0),
    col('ink', 'Ink', '#111111'),
    col('paper', 'Paper', '#f4f1ea'),
    num('paperAlpha', 'Paper opacity', 0, 1, 0.01, 1),
    num('scale', 'Scale', 2, 600, 0.5, 40),
    num('weight', 'Weight', 0.01, 0.99, 0.005, 0.35),
    num('angle', 'Angle', -180, 180, 0.5, 0),
    num('rays', 'Rays / arms', 1, 128, 1, 24),
    num('amount', 'Wave / bulge', 0, 2, 0.01, 0.35),
    num('stagger', 'Stagger rows', 0, 1, 1, 0, true),
    num('cx', 'Centre X', -1, 1, 0.001, 0, true),
    num('cy', 'Centre Y', -1, 1, 0.001, 0, true),
    num('phaseX', 'Shift X', -1, 1, 0.001, 0, true),
    num('phaseY', 'Shift Y', -1, 1, 0.001, 0, true),
    num('seed', 'Shuffle', 0, 100, 1, 3, true),
    num('speed', 'Speed', -4, 4, 0.05, 0),
  ],
  animated: (p) => n(p, 'speed') !== 0,
  reach: () => 2,
  glsl: /* glsl */ `
uniform vec3 u_ink, u_paper;
uniform float u_kind, u_paperAlpha, u_scale, u_weight, u_angle, u_rays, u_amount, u_stagger, u_cx, u_cy, u_phaseX, u_phaseY, u_seed, u_speed, u_loopLength;
const float TAU = 6.2831853;
/** Cycles run so far (Speed per second); on a looping timeline a whole number per loop, so the end meets the start. */
float T;
/** Half the shape's height, in cells (bars grow from its bottom). */
float HALF_H;
float cycles() {
  float r = u_speed;
  if (u_loopLength > 0.0 && r != 0.0) r = sign(r) * max(1.0, floor(abs(r) * u_loopLength + 0.5)) / u_loopLength;
  return r * u_time;
}
float band(float t, float w) { return abs(fract(t) - 0.5) - w * 0.5; }
float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
/** Signed distance (in cells; negative = ink) of the pattern at q (cells) and pixel offset px from the centre. */
float pattern(vec2 q, vec2 px) {
  float w = u_weight;
  int k = int(u_kind + 0.5);
  vec2 g = floor(q), f = fract(q) - 0.5;
  if (k == 0) return band(q.y, w);
  if (k == 1) {
    vec2 qq = q + vec2(u_stagger * 0.5 * mod(floor(q.y), 2.0), 0.0);
    return length(fract(qq) - 0.5) - w * 0.5;
  }
  if (k == 2) return min(abs(f.x), abs(f.y)) - w * 0.25;
  if (k == 3) {
    float c = mod(g.x + g.y, 2.0);
    float e = min(0.5 - abs(f.x), 0.5 - abs(f.y));
    return c > 0.5 ? -e : e;
  }
  if (k == 4) {
    float r = length(px) / u_scale;
    float t = (atan(px.y, px.x) / TAU) * u_rays + T;
    return band(t, w) * (TAU * max(r, 1e-3) / u_rays);
  }
  if (k == 5) return band(length(px) / u_scale - T, w);
  if (k == 6) {
    float y = q.y + u_amount * sin(q.x * TAU);
    float slope = u_amount * TAU * cos(q.x * TAU);
    return band(y, w) / sqrt(1.0 + slope * slope);
  }
  if (k == 7) {
    float tri = abs(fract(q.x) - 0.5) * 2.0;
    float y = q.y + u_amount * 2.0 * tri;
    return band(y, w) / sqrt(1.0 + 16.0 * u_amount * u_amount);
  }
  if (k == 8) {
    vec2 ff = fract(q);
    if (hash12(g + u_seed * 13.0) > 0.5) ff.x = 1.0 - ff.x;
    return min(abs(length(ff) - 0.5), abs(length(ff - 1.0) - 0.5)) - w * 0.5;
  }
  if (k == 9) {
    // Fish scales: rows half a cell apart, every other one shifted; lower rows lie on top.
    for (int j = 1; j >= -1; j--) {
      float row = floor(q.y * 2.0) + float(j);
      float sh = mod(row, 2.0) * 0.5;
      vec2 c = vec2(floor(q.x - sh + 0.5) + sh, row * 0.5);
      float d = length(q - c) - 0.5;
      if (d < 0.0) return -d - w * 0.25;
    }
    return 1.0;
  }
  if (k == 10) {
    // Houndstooth: per cell one solid quarter, one empty, two with diagonal teeth.
    vec2 t = fract(q);
    bool l = t.x < 0.5, top = t.y < 0.5;
    if (l && top) return -0.25;
    if (!l && !top) return 0.25;
    // Stripe edges pass through the solid quarters' corners, so they read as teeth.
    return band((q.x + q.y) * 2.0 + 0.25, 0.5) / 2.828;
  }
  if (k == 11) {
    float r = length(px) / u_scale;
    float bulge = u_amount * exp(-r * r / max(u_rays * u_rays * 0.01, 0.01));
    return band(q.y * (1.0 - bulge), w) / max(1.0 - bulge, 0.2);
  }
  if (k == 12) {
    float r = length(px) / u_scale;
    float a = atan(px.y, px.x) / TAU;
    // Arms one cell apart: each turn moves out by the number of arms.
    return band(r - a * max(floor(u_rays), 1.0) - T, w);
  }
  if (k == 13) {
    vec2 a = abs(f);
    float arm = 0.32, t = w * 0.25;
    vec2 d1 = a - vec2(arm, t), d2 = a - vec2(t, arm);
    float b1 = length(max(d1, 0.0)) + min(max(d1.x, d1.y), 0.0);
    float b2 = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0);
    return min(b1, b2);
  }
  if (k == 14) {
    // Equilateral triangles: up ones in ink, down ones in paper.
    vec2 t = vec2(q.x - q.y * 0.5773503, q.y * 1.1547005);
    vec2 tf = fract(t);
    bool up = tf.x + tf.y > 1.0;
    float e = (up ? min(min(1.0 - tf.x, 1.0 - tf.y), tf.x + tf.y - 1.0) : min(min(tf.x, tf.y), 1.0 - tf.x - tf.y)) * 0.8660254;
    return up ? -e : e;
  }
  if (k == 15) {
    vec2 r = vec2(q.x + q.y, q.y - q.x) * 0.7071068;
    vec2 rg = floor(r), rf = fract(r) - 0.5;
    float c = mod(rg.x + rg.y, 2.0);
    float e = min(0.5 - abs(rf.x), 0.5 - abs(rf.y));
    return c > 0.5 ? -e : e;
  }
  if (k == 16) {
    vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(q, s) - s * 0.5, b = mod(q - s * 0.5, s) - s * 0.5;
    vec2 h = dot(a, a) < dot(b, b) ? a : b;
    return abs(hexDist(h) - 0.5) - w * 0.15;
  }
  if (k == 17) {
    // Memphis squiggles: one short wave per cell, randomly turned and placed.
    float best = 1e9;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = g + vec2(float(i), float(j));
      float h1 = hash12(c + u_seed * 7.0), h2 = hash12(c * 1.7 + u_seed), h3 = hash12(c * 2.3 + 5.0);
      vec2 o = c + 0.5 + (vec2(h1, h2) - 0.5) * 0.35;
      float an = h3 * TAU;
      vec2 l = mat2(cos(an), -sin(an), sin(an), cos(an)) * (q - o);
      float x = clamp(l.x, -0.32, 0.32);
      float y = 0.08 * (0.5 + u_amount) * sin(x * TAU * 1.5);
      best = min(best, length(vec2(l.x - x, (l.y - y) / sqrt(1.0 + pow(0.08 * (0.5 + u_amount) * TAU * 1.5, 2.0) * 0.5))) - w * 0.12);
    }
    return best;
  }
  if (k == 18) return min(band((q.x + q.y) * 0.7071068, w), band((q.x - q.y) * 0.7071068, w));
  if (k == 20) {
    // Riding bars: one line per cell, a segment (Wave = its share of the
    // height) whose centre rides a wave Rays bars long from edge to edge, so
    // segments run off the top and bottom; Stagger keeps every other line full.
    float c = floor(q.x);
    float across = abs(fract(q.x) - 0.5) - w * 0.5;
    if (u_stagger > 0.5 && mod(c, 2.0) < 0.5) return across;
    float seg = clamp(u_amount, 0.05, 1.0) * HALF_H;
    float mid = HALF_H * sin(TAU * (c / max(u_rays, 1.0) - T));
    return max(across, abs(q.y - mid) - seg);
  }
  if (k == 21) return max(abs(f.x), abs(f.y)) - w * 0.5;
  if (k == 22) {
    // Barcode rows: solid ink split into blocks one to a few units wide by thin
    // gaps; each row slides its own way at a whole-number speed.
    float row = floor(q.y);
    float dir = mod(row, 2.0) < 0.5 ? 1.0 : -1.0;
    float x = (q.x + dir * (1.0 + floor(hash12(vec2(row, u_seed + 3.0)) * 3.0)) * T) * 4.0;
    float b = floor(x), fx = fract(x);
    // Mostly single bars, now and then a wider block.
    bool cutL = hash12(vec2(b, row) + u_seed) > 0.22, cutR = hash12(vec2(b + 1.0, row) + u_seed) > 0.22;
    float gap = min(cutL ? fx : 9.0, cutR ? 1.0 - fx : 9.0);
    return max((0.16 - gap) * 0.25, abs(fract(q.y) - 0.5) - w * 0.5);
  }
  if (k == 23) {
    // Flow lines: one line per cell bending in a long wave (Rays cells long),
    // swelling and pinching row by row, thicker toward the bottom.
    float swell = 0.55 + 0.45 * sin(q.y * 0.37 + u_seed);
    float ph = TAU * (q.x / max(u_rays, 1.0) - T) + q.y * 0.18;
    float y = q.y + u_amount * swell * sin(ph);
    float slope = u_amount * swell * TAU / max(u_rays, 1.0) * cos(ph);
    float down = clamp((q.y + HALF_H) / max(2.0 * HALF_H, 1e-3), 0.0, 1.0);
    return band(y, w * (0.45 + 1.1 * down)) / sqrt(1.0 + slope * slope);
  }
  // Gingham: crossing bands; the shader mixes half ink where one band runs.
  return min(band(q.x, w), band(q.y, w));
}
vec4 effect(vec2 uv) {
  float cov = cover(sdfPx(uv));
  vec2 lo = u_region.xy + u_bbox.xy * u_region.zw, hi = u_region.xy + u_bbox.zw * u_region.zw;
  vec2 ctr = (lo + hi) * 0.5 + (hi - lo) * 0.5 * vec2(u_cx, u_cy);
  vec2 px = artPx(uv) - ctr;
  float an = radians(u_angle);
  px = mat2(cos(an), sin(an), -sin(an), cos(an)) * px;
  vec2 q = px / u_scale + vec2(u_phaseX, u_phaseY);
  int k = int(u_kind + 0.5);
  T = cycles();
  HALF_H = (hi.y - lo.y) * 0.5 / u_scale;
  // Moving patterns slide one cell per cycle along their own grain; radial ones turn or ripple.
  if (k == 0 || k == 7 || k == 11 || k == 15) q.y -= T;
  else if (k != 4 && k != 5 && k != 12 && k < 20) q.x -= T;
  float d = pattern(q, px);
  // Distance in cells → screen pixels for a one-pixel anti-aliased edge.
  float aa = max(length(fwidth(q)), 1e-4) * 0.75;
  // Only after fwidth: a derivative needs every pixel of its 2×2 quad still running.
  if (cov <= 0.0) return vec4(0.0);
  float ink = clamp(0.5 - d / aa, 0.0, 1.0);
  if (k == 19) ink = (clamp(0.5 - band(q.x, u_weight) / aa, 0.0, 1.0) + clamp(0.5 - band(q.y, u_weight) / aa, 0.0, 1.0)) * 0.5;
  if (k == 21) {
    // Mosaic: four greys, each tile changing at its own moments.
    vec2 g = floor(q);
    float h = hash12(g + u_seed * 5.0);
    float v = hash12(g * 1.37 + floor(T * 4.0 + h * 4.0) * 0.731 + u_seed);
    // Even the palest tile shows; now and then one is missing.
    ink *= (0.25 + 0.75 * floor(v * 4.0) / 3.0) * step(0.035, hash12(g + u_seed * 9.0 + 0.5));
  }
  vec4 paper = vec4(u_paper, 1.0) * u_paperAlpha;
  vec4 c = mix(paper, vec4(u_ink, 1.0), ink);
  return c * cov;
}`,
};

const ribbon: EffectDef = {
  id: 'ribbon',
  name: 'Ribbon',
  description: 'Colour that flows along a pen line, from one end to the other, with tube shading and a gloss — for ribbons, cords and neon tubes. Other shapes blend left to right.',
  spine: true,
  params: [
    col('c1', 'Start', '#ff8a1f'),
    col('c2', 'Colour 2', '#ff4f7a'),
    col('c3', 'Colour 3', '#b98cff'),
    col('c4', 'Colour 4', '#3b8cff'),
    col('c5', 'End', '#bfe3ff'),
    num('stop2', 'Colour 2 at', 0, 1, 0.01, 0.25),
    num('stop3', 'Colour 3 at', 0, 1, 0.01, 0.5),
    num('stop4', 'Colour 4 at', 0, 1, 0.01, 0.75),
    num('shade', 'Tube shading', 0, 1, 0.01, 0.35),
    num('gloss', 'Gloss', 0, 1, 0.01, 0.3),
    num('lightAngle', 'Light angle', -180, 180, 1, -60),
    num('twist', 'Twists', 0, 12, 0.5, 0),
    num('fade', 'Fade out', 0, 1, 0.01, 0),
    num('fadeStart', 'Fade from', 0, 1, 0.01, 0.8, true),
  ],
  reach: () => 2,
  glsl: /* glsl */ `
uniform sampler2D u_spine;
uniform float u_spineN;
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_c5;
uniform float u_stop2, u_stop3, u_stop4, u_shade, u_gloss, u_lightAngle, u_twist, u_fade, u_fadeStart;
/** How far along the pen line (0…1) the nearest point is; also its distance and the line's direction there. */
float alongLine(vec2 p, out float dist, out vec2 dir, out float side) {
  float best = 1e20, t = 0.0;
  dir = vec2(1.0, 0.0);
  side = 1.0;
  vec4 a = texelFetch(u_spine, ivec2(0, 0), 0);
  for (int i = 1; i < 4096; i++) {
    if (float(i) >= u_spineN) break;
    vec4 b = texelFetch(u_spine, ivec2(i, 0), 0);
    if (b.w > 0.5) {
      vec2 ab = b.xy - a.xy;
      float l2 = max(dot(ab, ab), 1e-9);
      float u = clamp(dot(p - a.xy, ab) / l2, 0.0, 1.0);
      vec2 q = p - (a.xy + ab * u);
      float d = dot(q, q);
      if (d < best) { best = d; t = mix(a.z, b.z, u); dir = ab / sqrt(l2); side = sign(ab.x * q.y - ab.y * q.x); }
    }
    a = b;
  }
  dist = sqrt(best);
  return t;
}
vec3 ramp5(float t) {
  float s2 = max(u_stop2, 1e-3), s3 = max(u_stop3, s2 + 1e-3), s4 = max(u_stop4, s3 + 1e-3);
  if (t < s2) return mix(u_c1, u_c2, t / s2);
  if (t < s3) return mix(u_c2, u_c3, (t - s2) / (s3 - s2));
  if (t < s4) return mix(u_c3, u_c4, (t - s3) / (s4 - s3));
  return mix(u_c4, u_c5, clamp((t - s4) / max(1.0 - s4, 1e-3), 0.0, 1.0));
}
vec4 effect(vec2 uv) {
  float sd = sdfPx(uv);
  float cov = cover(sd);
  if (cov <= 0.0) return vec4(0.0);
  float dist, side, t;
  vec2 dir;
  if (u_spineN >= 2.0) {
    t = alongLine(artPx(uv) - u_art * 0.5, dist, dir, side);
  } else {
    t = boxUv(uv).x; dist = 0.0; dir = vec2(1.0, 0.0); side = 1.0;
  }
  // Across the tube: −1 … 1 from one edge to the other (half width = centre to edge).
  float half_ = max(dist - sd / u_k, 1e-3);
  float across = clamp(side * dist / half_, -1.0, 1.0) * cos(3.14159265 * u_twist * t);
  vec3 n = normalize(vec3(vec2(-dir.y, dir.x) * across, sqrt(max(1.0 - across * across, 0.0)) + 0.15));
  float la = radians(u_lightAngle);
  vec3 L = normalize(vec3(cos(la), sin(la), 1.1));
  float diff = max(dot(n, L), 0.0);
  vec3 col = ramp5(t) * mix(1.0, 0.62 + 0.5 * diff, u_shade);
  vec3 h = normalize(L + vec3(0.0, 0.0, 1.0));
  col += u_gloss * pow(max(dot(n, h), 0.0), 24.0);
  float a = cov * (1.0 - u_fade * smoothstep(u_fadeStart, 1.0, t));
  return vec4(min(col, 1.0) * a, a);
}`,
};

const keycap: EffectDef = {
  id: 'keycap',
  name: 'Keycap',
  description: 'A sculpted 3D key: a rounded, dished top face on curved walls, lit by a soft light and reflecting its surroundings. Can be translucent plastic that shows what is under it.',
  backdrop: true,
  params: [
    col('color', 'Colour', '#f2f3f5'),
    num('wall', 'Wall width', 2, 160, 0.5, 30),
    num('tilt', 'Tilt', -1, 1, 0.01, 0.3),
    num('tiltX', 'Tilt sideways', -1, 1, 0.01, -0.15),
    num('topRound', 'Top rounding', 0, 200, 0.5, 40),
    num('dish', 'Dish', 0, 1, 0.01, 0.6),
    num('lightAngle', 'Light angle', -180, 180, 1, -135),
    num('light', 'Light', 0, 2, 0.01, 1),
    col('sky', 'Sky reflection', '#9ec4ea'),
    col('bounce', 'Reflection below', '#ffffff'),
    col('above', 'Reflection above', '#ffffff'),
    num('aboveMirror', 'Mirror above', 0, 1, 0.01, 0),
    num('gloss', 'Gloss', 0, 1, 0.01, 0.55),
    num('mirror', 'Mirror below', 0, 1, 0.01, 0),
    num('occlusion', 'Shadow from above', 0, 1.5, 0.01, 0),
    col('shadowTint', 'Shadow tint', '#56677c'),
    num('rimLight', 'Rim light', 0, 2, 0.01, 0.8),
    num('sheen', 'Wall sheen', 0, 1, 0.01, 0.3),
    num('evenTop', 'Even top', 0, 1, 0.01, 0),
    num('skyFill', 'Sky fill', 0, 1, 0.01, 0.35),
    num('shadowWalls', 'Shadow on walls only', 0, 1, 1, 0),
    num('translucent', 'Translucent', 0, 1, 0.01, 0),
    num('shadow', 'Shadow', 0, 1, 0.01, 0.4),
    num('rise', 'Height', 4, 200, 1, 40, true),
  ],
  reach: (p) => (n(p, 'shadow') > 0 ? 60 : 4) + n(p, 'translucent') * 30,
  glsl: /* glsl */ `
uniform vec3 u_color, u_sky, u_bounce, u_above, u_shadowTint;
uniform float u_wall, u_tilt, u_tiltX, u_topRound, u_dish, u_lightAngle, u_light, u_gloss, u_translucent, u_shadow, u_rise, u_rimLight, u_mirror, u_occlusion, u_aboveMirror, u_sheen, u_shadowWalls, u_evenTop, u_skyFill;
vec2 kBox() { return (u_bbox.zw - u_bbox.xy) * u_region.zw; }
/** Signed distance (art px) to the top face: a rounded box inset by the wall, shifted by the tilt. */
float kTop(vec2 uv) {
  vec2 box = kBox();
  vec2 pa = (boxUv(uv) - 0.5) * box;
  vec2 c = vec2(u_tiltX, -u_tilt) * u_wall * 0.8;
  vec2 hs = max(box * 0.5 - u_wall, vec2(1.0));
  float r = min(u_topRound, min(hs.x, hs.y));
  vec2 q = abs(pa - c) - (hs - r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
/** Height of the key surface in art px: curved walls up to a dished top. */
float kH(vec2 uv) {
  float dOut = max(-sdfArt(uv), 0.0);
  float dt = kTop(uv);
  vec2 hs = max(kBox() * 0.5 - u_wall, vec2(1.0));
  float H = u_rise;
  if (dt <= 0.0) {
    // A smooth bowl (superellipse radius, so no creases toward the corners).
    vec2 pa = (boxUv(uv) - 0.5) * kBox() - vec2(u_tiltX, -u_tilt) * u_wall * 0.8;
    // Separable bowl: smooth everywhere, so no streaks along the diagonals.
    vec2 q = clamp(abs(pa) / hs, 0.0, 1.0);
    float bowl = (1.0 - q.x * q.x) * (1.0 - q.y * q.y);
    return H - u_dish * H * 0.9 * bowl;
  }
  // Walls: a rounded shoulder from the base to the rim.
  float t = dOut / max(dOut + dt, 1e-3);
  return H * (1.0 - pow(1.0 - t, 2.4));
}
vec4 effect(vec2 uv) {
  float dt0 = sdfPx(uv);
  float cov = cover(dt0);
  vec4 sh = dropShadow(uv, vec2(0.0, 12.0), -3.0, 24.0, u_shadow * 0.55);
  if (cov <= 0.0) return sh;
  // Normal from the height field (finite differences in art px).
  float e = 1.5;
  vec2 ex = offsetUv(vec2(e, 0.0)), ey = offsetUv(vec2(0.0, e));
  float hx = kH(uv + ex) - kH(uv - ex);
  float hy = kH(uv + ey) - kH(uv - ey);
  vec3 n = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0));
  float la = radians(u_lightAngle);
  vec3 L = normalize(vec3(cos(la) * 0.85, sin(la) * 0.85, 0.5));
  // Soft key light plus a bright ambient (studio).
  float diff = max(dot(n, L), 0.0);
  vec3 base = u_color * (0.42 + 0.72 * diff * u_light);
  // Fill light bounced up from below (the floor or the next key) onto the walls
  // facing down (field y points down the screen). The dish stays in its own shade.
  float onWall = smoothstep(0.0, 3.0, kTop(uv));
  base += (u_color * u_bounce * 0.9 + u_bounce * 0.25) * max(n.y, 0.0) * onWall;
  // Environment: sky above (screen up), floor bounce below (screen down).
  vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
  // The dish sees the sky; only the walls see the floor.
  vec3 env = mix(u_sky, u_bounce, smoothstep(-0.6, 0.6, R.y) * onWall);
  // Plastic: a little reflection face-on, more at grazing angles.
  float fres = 0.04 + 0.5 * pow(1.0 - max(n.z, 0.0), 3.0);
  vec3 c = mix(base, env * (0.5 + 0.5 * u_color), clamp(fres * (0.5 + u_gloss), 0.0, 1.0));
  // A soft-box highlight from the light side.
  float spec = pow(max(dot(R, L), 0.0), mix(6.0, 30.0, u_gloss));
  c += vec3(spec) * u_gloss * 0.45 * u_light;
  // A second, harder light from the side opposite the key light: bright rims on the walls.
  vec3 L2 = normalize(vec3(-cos(la) * 0.95, -sin(la) * 0.3, 0.25));
  c += vec3(pow(max(dot(R, L2), 0.0), 3.0)) * u_rimLight * 0.5 * smoothstep(0.05, 0.3, 1.0 - n.z) * onWall;
  // Thin coloured plastic glows evenly on top (light scattered inside it).
  c = mix(c, u_color * (1.0 + 0.08 * diff), u_evenTop * (1.0 - onWall));
  // Walls turned toward the light catch it fully: a broad sheen.
  float litWall = max(dot(normalize(n.xy + 1e-5), normalize(L.xy)), 0.0) * onWall * smoothstep(0.05, 0.25, 1.0 - n.z);
  c = mix(c, mix(u_color * 1.12, vec3(1.0), u_sheen), clamp(litWall * 1.9, 0.0, 1.0));
  // Walls turned away from the light still get the sky.
  float darkWall = max(-dot(normalize(n.xy + 1e-5), normalize(L.xy)), 0.0) * onWall;
  c = mix(c, u_sky * mix(u_color, vec3(1.0), 0.5), darkWall * u_skyFill);
  // Glossy walls facing down mirror what's below them (the floor or the next key).
  float front = max(n.y, 0.0) * onWall;
  c = mix(c, u_bounce * (0.75 + 0.25 * spec), clamp(pow(front, 1.5) * 2.6, 0.0, 1.0) * u_mirror);
  // Shadow cast by whatever is above (the key above): with the light from one
  // side it falls diagonally across the top corner on the other side.
  if (u_occlusion > 0.0) {
    vec2 bu = boxUv(uv);
    float side = L.x > 0.0 ? bu.x : 1.0 - bu.x;
    float yTop = bu.y;
    float reach = yTop + side * 0.95;
    float shade = 1.0 - smoothstep(u_occlusion * 0.55 - 0.08, u_occlusion * 0.55 + 0.08, reach);
    if (u_shadowWalls > 0.5) shade *= onWall;
    c *= mix(vec3(1.0), u_shadowTint / max(max(u_color.r, max(u_color.g, u_color.b)), 0.3), shade * 0.85);
  }
  // (After the shadow.) Walls facing up mirror what's above them (the key above).
  float back = max(-n.y, 0.0) * onWall;
  c = mix(c, u_above * (0.85 + 0.2 * spec), clamp(back * 2.4, 0.0, 1.0) * u_aboveMirror);
  // A thin highlight where the dish meets the shoulder.
  float td = kTop(uv);
  float rimLine = (1.0 - smoothstep(0.0, 2.2, abs(td + 1.0)));
  // Translucent plastic: what's under the key, refracted by the surface and tinted.
  if (u_translucent > 0.0) {
    // Tinted plastic passes the brightness of what's under it, in its own colour.
    // The flat window passes what's under it cleanly; the curved walls bend it.
    float wallBend = smoothstep(-2.0, 4.0, kTop(uv));
    vec3 under = behind(uv + offsetUv(-n.xy * 26.0 * wallBend)).rgb;
    float lum = dot(under, vec3(0.3, 0.55, 0.15));
    float thin = 1.0 - n.z;
    // Part scattered light in the plastic's colour, part a true colour filter
    // (multiplied), so a red part under orange plastic still reads red.
    vec3 scatter = u_color * (0.75 + 0.5 * lum);
    // Warm parts under the plastic show through in their own colour; cool ones
    // (the sky) only lend their brightness.
    float warm = clamp((under.r - under.b) * 2.0, 0.0, 1.0);
    vec3 trans = mix(scatter, under * 1.1, warm * 0.9) * (0.82 + 0.3 * thin);
    // The top window glows lighter, with a bright inner rim where light gathers.
    float inWin = 1.0 - smoothstep(-2.0, 0.0, td);
    trans *= 1.0 - 0.12 * inWin;
    trans += mix(u_color, vec3(1.0, 0.85, 0.5), 0.35) * rimLine * 0.45;
    trans = mix(trans, u_bounce * u_color * 1.3, clamp(front * 2.4, 0.0, 1.0) * u_mirror * 0.6);
    c = mix(c, trans + vec3(spec) * u_gloss * 0.6, u_translucent * (1.0 - fres * 0.5));
  }
  return over(vec4(clamp(c, 0.0, 1.0) * cov, cov), sh);
}`,
};

export const EFFECTS: EffectDef[] = [flat, chrome, glass, inflate, sticker, aura, holo, extrude, icon, neon, distressed, emboss, halftone, riso, dither, photo, frost, lens, thermal, prism, colorDots, plush, glow, grainy, mosaic, keycap, patternFx, ribbon];

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
  { name: 'Printed 3D', effect: 'halftone', params: { ink: '#5b4fe0', cell: 7, ramp: 0.25, rampAngle: 200, shade: 1, min: 0.02, max: 1.25, paper: '#ffffff', paperOn: 1, offsetX: -7, offsetY: 6 }, bg: '#0aa84f', tags: 'halftone 3d shading screen print misregistered dots illustration' },
  { name: 'Pink halftone', effect: 'halftone', params: { ink: '#ff3d7f', cell: 10, ramp: 1, rampAngle: 135 }, bg: '#fff3e6', tags: 'halftone gradient dots print' },
  { name: 'Line screen', effect: 'halftone', params: { ink: '#2b6bff', lines: 1, cell: 9, ramp: 0.85, angle: 0 }, bg: '#f4f1ea', tags: 'halftone lines engraving print' },
  { name: 'Riso pink + blue', effect: 'riso', params: {}, bg: '#f4f1ea', tags: 'risograph print overprint zine' },
  { name: 'Voxel blue', effect: 'extrude', params: { face: '#1f63f0', side: '#0a3fb8', depth: 30, angle: 150, shade: 0.45, outline: 0 }, bg: '#ffffff', tags: 'voxel cubes 3d blocks pixel minecraft' },
  { name: 'Pixel pop', effect: 'extrude', params: { face: '#e2ff2e', side: '#23203f', depth: 22, angle: 135, shade: 0, outline: 9, outlineColor: '#23203f' }, bg: '#6129ff', tags: 'pixel game logo 3d shadow outline lime' },
  { name: 'Acid dither', effect: 'dither', params: {}, bg: '#0a0a0a', tags: 'dither 1-bit bitmap pixel shading lime' },
  { name: 'Blue dither', effect: 'dither', params: { ink: '#0b3fd9', light: '#e3e6eb', cell: 5, shade: 0.8, ramp: 0.2 }, bg: '#e3e6eb', tags: 'dither 1-bit pixel blue poster' },
  { name: 'Mono dither', effect: 'dither', params: { ink: '#111111', light: '#f2f0ea', cell: 3, noise: 1, shade: 0.6, ramp: 0.5 }, bg: '#f2f0ea', tags: 'dither noise grain 1-bit black white' },
  { name: 'Rubber stamp', effect: 'distressed', params: { ink: '#e3120b', roughness: 1.2, speckle: 0.12, grain: 0.15, lines: 0, tooth: 0.55, bleed: 0 }, bg: '#ffffff', tags: 'stamp lino print grain red crayon' },
  { name: 'Lino black', effect: 'distressed', params: { ink: '#141414', roughness: 2, speckle: 0.2, grain: 0.3, lines: 0, tooth: 0.4, bleed: 0.4 }, bg: '#22b25a', tags: 'stamp linocut print grain rough' },
  { name: 'Neo-brutal', effect: 'flat', params: { fill: '#9b4ff0', outline: 6, outlineColor: '#0a0a0a', shadowOpacity: 1, shadowX: 14, shadowY: 14, shadowBlur: 0, shadowColor: '#0a0a0a' }, bg: '#0d7a2c', tags: 'brutalist outline hard shadow flat illustration' },
  { name: 'Cream label', effect: 'flat', params: { fill: '#f2ebe2', outline: 5, outlineColor: '#0a0a0a', shadowOpacity: 1, shadowX: 0, shadowY: 10, shadowBlur: 0, shadowColor: '#0a0a0a' }, bg: '#0d7a2c', tags: 'brutalist pill button tag outline' },
  { name: 'Pop offset', effect: 'flat', params: { fill: '#ff4a1c', outline: 0, shadowOpacity: 1, shadowX: 10, shadowY: 10, shadowBlur: 0, shadowColor: '#1b1bff' }, bg: '#f4f1ea', tags: 'offset shadow flat pop colour' },
  { name: 'Riso orange + green', effect: 'riso', params: { ink: '#ff7a1a', ink2: '#1a8a6a', offsetX: -6, offsetY: 6 }, bg: '#f4f1ea', tags: 'risograph print overprint poster' },
  { name: 'Distressed', effect: 'distressed', params: {}, bg: '#0b0b0b', tags: 'grunge print' },
  { name: 'Neon pink', effect: 'neon', params: {}, bg: '#07030d', tags: 'glow' },
  { name: 'Neon cyan', effect: 'neon', params: { color: '#28f0ff', core: '#f0ffff' }, bg: '#02070b', tags: 'glow' },
  { name: 'Flat', effect: 'flat', params: {}, bg: '#141414', tags: 'solid' },
  { name: 'Flat ink', effect: 'flat', params: { fill: '#0a0a0a' }, bg: '#7b4dff', tags: 'solid black' },
  { name: 'Peach gradient', effect: 'flat', params: { fill: '#ffb36b', fill2: '#ff3d7f', gradient: 1 }, bg: '#130f1a', tags: 'gradient' },
  { name: 'Electric gradient', effect: 'flat', params: { fill: '#45f3ff', fill2: '#7b4dff', gradient: 1, angle: 135 }, bg: '#08080c', tags: 'gradient blue' },
  { name: 'Frosted glass', effect: 'frost', params: {}, bg: '#1b1d2a', tags: 'glass blur backdrop ui card' },
  { name: 'Frosted indigo', effect: 'frost', params: { tint: '#dfe3ff', tint2: '#3542d6', gradient: 0.85, tintAmount: 0.4, blur: 30 }, bg: '#14151c', tags: 'glass blur gradient folder' },
  { name: 'Clear lens', effect: 'lens', params: {}, bg: '#eef0f0', tags: 'glass refraction bubble water drop' },
  { name: 'Prism lens', effect: 'lens', params: { dispersion: 1.2, iridescence: 1.1, refraction: 0.9, magnify: 0.1 }, bg: '#000000', tags: 'glass crystal rainbow iridescent cube' },
  { name: 'Magnifier drop', effect: 'lens', params: { refraction: 1.3, dispersion: 2, magnify: 0.3, edgeBend: 0.7, iridescence: 0, highlight: 0, film: 0.85, rim: 0.4, blur: 1, bevel: 130, softness: 50, tintAmount: 0 }, bg: '#eef0f0', tags: 'glass lens drop water magnify chromatic aberration' },
  { name: 'Crystal block', effect: 'lens', params: { chamfer: 1, bevel: 50, softness: 6, refraction: 1.6, dispersion: 2, magnify: 0.35, rainbow: 1.6, rainbowWidth: 0.7, rainbowShift: 0.3, thickness: 1, highlight: 0.6, rim: 1, iridescence: 0, tintAmount: 0 }, bg: '#000000', tags: 'glass crystal cube prism rainbow facets chamfer' },
  { name: 'Sunburst', effect: 'pattern', params: { kind: 4, ink: '#111111', paper: '#ff5a1f', rays: 24, weight: 0.5 }, bg: '#000000', tags: 'pattern rays radial stripes retro' },
  { name: 'Truchet', effect: 'pattern', params: { kind: 8, ink: '#111111', paper: '#ffb703', scale: 36, weight: 0.22 }, bg: '#000000', tags: 'pattern maze arcs tiles generative' },
  { name: 'Houndstooth', effect: 'pattern', params: { kind: 10, ink: '#111111', paper: '#f4f1ea', scale: 40 }, bg: '#000000', tags: 'pattern fabric tweed check' },
  { name: 'Op-art', effect: 'pattern', params: { kind: 11, ink: '#111111', paper: '#f4f1ea', scale: 18, weight: 0.5, amount: 0.7, rays: 60 }, bg: '#000000', tags: 'pattern stripes bulge illusion warp' },
  { name: 'Memphis', effect: 'pattern', params: { kind: 17, ink: '#ff5a1f', paper: '#f4f1ea', scale: 56, weight: 0.6 }, bg: '#000000', tags: 'pattern squiggles confetti 80s' },
  { name: 'Gingham', effect: 'pattern', params: { kind: 19, ink: '#d62b2b', paper: '#f4f1ea', scale: 40, weight: 0.5 }, bg: '#000000', tags: 'pattern picnic check fabric' },
  { name: 'Ribbon', effect: 'ribbon', params: {}, bg: '#ffffff', tags: 'gradient along line colour flow neon tube cord' },
  { name: 'Sunset ribbon', effect: 'ribbon', params: { c1: '#ff960f', c2: '#fe517b', c3: '#fea0b6', c4: '#12a7fe', c5: '#bfe3ff', stop2: 0.29, stop3: 0.46, stop4: 0.7, shade: 0.12, gloss: 0.04 }, bg: '#ffffff', tags: 'gradient along line ribbon app icon' },
  { name: 'Thermal', effect: 'thermal', params: {}, bg: '#e8133c', tags: 'heat camera infrared map' },
  { name: 'Hot core', effect: 'thermal', params: { invert: 1, glowAmount: 0.6 }, bg: '#0b1a8f', tags: 'heat thermal' },
  { name: 'Prism light', effect: 'prism', params: {}, bg: '#000000', tags: 'rainbow streaks light rays spectrum' },
  { name: 'Colour dots', effect: 'colordots', params: {}, bg: '#000000', tags: 'halftone gradient dot screen led' },
  { name: 'Plush pink', effect: 'plush', params: {}, bg: '#3ecf3e', tags: 'fuzzy toy fabric fur' },
  { name: 'Plush moss', effect: 'plush', params: { color: '#5ccf3a', shade: '#1f6b12' }, bg: '#151515', tags: 'fuzzy toy fabric fur green' },
];
