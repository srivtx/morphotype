// Small WebGL2 helpers: programs, render targets, a buffer-less fullscreen pass.

export class GLError extends Error {}

export function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new GLError('Could not create shader');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '';
    gl.deleteShader(s);
    const numbered = src
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
      .join('\n');
    throw new GLError(`Shader compile failed:\n${log}\n${numbered}`);
  }
  return s;
}

export interface Program {
  prog: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
}

export function program(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const p = gl.createProgram();
  if (!p) throw new GLError('Could not create program');
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new GLError(`Program link failed: ${gl.getProgramInfoLog(p)}`);
  }
  const uniforms = new Map<string, WebGLUniformLocation>();
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    if (!info) continue;
    const loc = gl.getUniformLocation(p, info.name);
    if (loc) uniforms.set(info.name.replace(/\[0\]$/, ''), loc);
  }
  return { prog: p, uniforms };
}

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export interface Format {
  internal: number;
  format: number;
  type: number;
  filter: number;
}

export function formats(gl: WebGL2RenderingContext) {
  return {
    rg32f: { internal: gl.RG32F, format: gl.RG, type: gl.FLOAT, filter: gl.NEAREST },
    r16f: { internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT, filter: gl.LINEAR },
    rgba8: { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR },
    // Copies of the screen (whose default framebuffer has no alpha channel).
    rgb8: { internal: gl.RGB8, format: gl.RGB, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR },
  } satisfies Record<string, Format>;
}

export function texture(gl: WebGL2RenderingContext, w: number, h: number, f: Format): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new GLError('Could not create texture');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function target(gl: WebGL2RenderingContext, w: number, h: number, f: Format): Target {
  const tex = texture(gl, w, h, f);
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new GLError('Could not create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new GLError(`Framebuffer incomplete (0x${status.toString(16)}). This GPU can't render float targets.`);
  }
  return { tex, fbo, w, h };
}

export function freeTarget(gl: WebGL2RenderingContext, t: Target | null) {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

export type UniformValue = number | boolean | readonly number[] | Float32Array;

export function setUniforms(gl: WebGL2RenderingContext, p: Program, values: Record<string, UniformValue>) {
  for (const [name, v] of Object.entries(values)) {
    const loc = p.uniforms.get(name);
    if (!loc) continue;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (typeof v === 'boolean') gl.uniform1f(loc, v ? 1 : 0);
    else if (v.length === 2) gl.uniform2fv(loc, v as Float32List);
    else if (v.length === 3) gl.uniform3fv(loc, v as Float32List);
    else if (v.length === 4) gl.uniform4fv(loc, v as Float32List);
  }
}

export function bindTextures(gl: WebGL2RenderingContext, p: Program, textures: Record<string, WebGLTexture | null>) {
  let unit = 0;
  for (const [name, tex] of Object.entries(textures)) {
    const loc = p.uniforms.get(name);
    if (!loc) continue;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
    unit++;
  }
}

/** Parse "#rrggbb" into linear-ish 0..1 floats (kept in sRGB; effects are stylised). */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 0, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
