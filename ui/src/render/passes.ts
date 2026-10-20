// GLSL for the geometry passes: mask → jump-flood SDF → height map.
// All intermediate targets live in "artboard texture space": row 0 is the top
// of the artboard and every pass reads texels 1:1 with gl_FragCoord.

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Quad covering `u_rect` (clip space x0,y0,x1,y1) with artboard uv (v down). */
export const RECT_VS = /* glsl */ `#version 300 es
uniform vec4 u_rect;
out vec2 v_uv;
const vec2 C[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 0), vec2(1, 1), vec2(0, 1));
void main() {
  vec2 a = C[gl_VertexID];
  v_uv = vec2(a.x, 1.0 - a.y);
  gl_Position = vec4(mix(u_rect.xy, u_rect.zw, a), 0.0, 1.0);
}`;

// The same quad moved by an object's motion: u_xf (a 2×2, columns) and u_xfT map clip space to clip space.
export const MOVED_RECT_VS = /* glsl */ `#version 300 es
uniform vec4 u_rect, u_xf;
uniform vec2 u_xfT;
out vec2 v_uv;
/** Where the moved pixel falls in the resting quad: clipping frames stay put while their contents move. */
out vec2 v_clipUv;
const vec2 C[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 0), vec2(1, 1), vec2(0, 1));
void main() {
  vec2 a = C[gl_VertexID];
  v_uv = vec2(a.x, 1.0 - a.y);
  vec2 p = mat2(u_xf.xy, u_xf.zw) * mix(u_rect.xy, u_rect.zw, a) + u_xfT;
  vec2 r = (p - u_rect.xy) / (u_rect.zw - u_rect.xy);
  v_clipUv = vec2(r.x, 1.0 - r.y);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Seeds: pixels straddling the outline, with a sub-pixel estimate of where the
// 50% coverage edge lies (from the anti-aliased mask and its gradient).
export const SEED_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_mask;
out vec4 o;
float m(ivec2 p) {
  ivec2 s = textureSize(u_mask, 0);
  return texelFetch(u_mask, clamp(p, ivec2(0), s - 1), 0).a;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float c = m(p);
  float l = m(p + ivec2(-1, 0)), r = m(p + ivec2(1, 0)), d = m(p + ivec2(0, -1)), u = m(p + ivec2(0, 1));
  bool inside = c >= 0.5;
  bool edge = (c > 0.02 && c < 0.98) || inside != (l >= 0.5) || inside != (r >= 0.5) || inside != (d >= 0.5) || inside != (u >= 0.5);
  if (!edge) { o = vec4(-1.0, -1.0, 0.0, 0.0); return; }
  vec2 g = vec2(r - l, u - d) * 0.5;
  float gl = length(g);
  vec2 pos = gl_FragCoord.xy;
  if (gl > 1e-3) {
    // g points toward higher coverage (inside); the 0.5 iso-line is (c - 0.5) / |g| away.
    float off = clamp((c - 0.5) / gl, -1.0, 1.0);
    pos -= normalize(g) * off;
  }
  o = vec4(pos, 0.0, 0.0);
}`;

export const JFA_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_seeds;
uniform float u_step;
uniform vec2 u_size;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 s = ivec2(u_size);
  vec2 best = vec2(-1.0);
  float bd = 1e20;
  int st = int(u_step);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 q = p + ivec2(x, y) * st;
      if (q.x < 0 || q.y < 0 || q.x >= s.x || q.y >= s.y) continue;
      vec2 seed = texelFetch(u_seeds, q, 0).xy;
      if (seed.x < 0.0) continue;
      vec2 dv = seed - gl_FragCoord.xy;
      float dd = dot(dv, dv);
      if (dd < bd) { bd = dd; best = seed; }
    }
  }
  o = vec4(best, 0.0, 0.0);
}`;

/** Signed distance in texture pixels (negative inside). */
export const SDF_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_seeds;
uniform sampler2D u_mask;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 seed = texelFetch(u_seeds, p, 0).xy;
  float c = texelFetch(u_mask, p, 0).a;
  float d = seed.x < 0.0 ? 4096.0 : distance(seed, gl_FragCoord.xy);
  o = vec4(c >= 0.5 ? -d : d, 0.0, 0.0, 0.0);
}`;

/**
 * Height field from the SDF. Profiles: 0 round (circular bulge), 1 linear
 * chamfer, 2 smooth (s-curve). `u_bevel` is in texture pixels.
 */
export const HEIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_sdf;
uniform float u_bevel;
uniform float u_profile;
out vec4 o;
void main() {
  float d = texelFetch(u_sdf, ivec2(gl_FragCoord.xy), 0).r;
  float x = clamp(-d / max(u_bevel, 1.0), 0.0, 1.0);
  float h;
  if (u_profile < 0.5) h = sqrt(max(1.0 - (1.0 - x) * (1.0 - x), 0.0));
  else if (u_profile < 1.5) h = x;
  else h = x * x * (3.0 - 2.0 * x);
  o = vec4(h, 0.0, 0.0, 0.0);
}`;

/** Separable Gaussian, 25 taps with a stride so large radii stay cheap. */
export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_dir;
uniform float u_radius;
out vec4 o;
void main() {
  vec2 size = vec2(textureSize(u_src, 0));
  vec2 uv = gl_FragCoord.xy / size;
  if (u_radius < 0.5) { o = texture(u_src, uv); return; }
  float sigma = u_radius * 0.5;
  float stride = max(u_radius / 12.0, 1.0);
  float total = 0.0;
  float acc = 0.0;
  for (int i = -12; i <= 12; i++) {
    float x = float(i) * stride;
    float w = exp(-0.5 * x * x / (sigma * sigma));
    acc += texture(u_src, uv + u_dir * x / size).r * w;
    total += w;
  }
  o = vec4(acc / total, 0.0, 0.0, 0.0);
}`;

/** Separable Gaussian for colour (backdrop blur); samples by normalised uv so it can also downsample. */
export const BLUR_RGBA_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_dir;
uniform vec2 u_outSize;
uniform float u_radius;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_outSize;
  vec2 texel = 1.0 / vec2(textureSize(u_src, 0));
  if (u_radius < 0.5) { o = texture(u_src, uv); return; }
  float sigma = u_radius * 0.5;
  float stride = max(u_radius / 12.0, 1.0);
  float total = 0.0;
  vec4 acc = vec4(0.0);
  for (int i = -12; i <= 12; i++) {
    float x = float(i) * stride;
    float w = exp(-0.5 * x * x / (sigma * sigma));
    acc += texture(u_src, uv + u_dir * x * texel) * w;
    total += w;
  }
  o = acc / total;
}`;
