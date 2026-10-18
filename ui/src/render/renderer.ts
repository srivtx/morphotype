import { BLUR_FS, FULLSCREEN_VS, HEIGHT_FS, JFA_FS, RECT_VS, SDF_FS, SEED_FS } from './passes';
import { COMMON_GLSL, type EffectDef, type HeightSpec, type ParamValues } from './effects';
import {
  bindTextures,
  formats,
  freeTarget,
  GLError,
  hexToRgb,
  program,
  setUniforms,
  target,
  texture,
  type Program,
  type Target,
  type UniformValue,
} from './gl';

const EFFECT_FS = (body: string) => /* glsl */ `#version 300 es
precision highp float;
${COMMON_GLSL}
uniform float u_transparent;
uniform float u_checker;
in vec2 v_uv;
out vec4 o;
${body}
void main() {
  vec3 bg;
  vec4 fg;
  effect(v_uv, bg, fg);
  if (u_transparent > 0.5) {
    if (u_checker > 0.5) {
      vec2 c = floor(gl_FragCoord.xy / 10.0);
      vec3 chk = mod(c.x + c.y, 2.0) < 1.0 ? vec3(0.16) : vec3(0.22);
      o = vec4(chk * (1.0 - fg.a) + fg.rgb, 1.0);
    } else {
      o = fg;
    }
  } else {
    o = vec4(bg * (1.0 - fg.a) + fg.rgb, 1.0);
  }
}`;

export interface View {
  /** Screen pixels per artboard pixel. */
  zoom: number;
  /** Artboard centre offset from the canvas centre, in CSS pixels. */
  panX: number;
  panY: number;
}

interface Field {
  w: number;
  h: number;
  mask: WebGLTexture;
  seedsA: Target;
  seedsB: Target;
  sdf: Target;
  heightA: Target;
  heightB: Target;
}

/**
 * GPU renderer. Geometry arrives as SVG path data; the renderer rasterises it,
 * builds a signed distance field with jump flooding, derives a blurred height
 * map, and shades the result with the active effect.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private progs: Record<'seed' | 'jfa' | 'sdf' | 'height' | 'blur', Program>;
  private effects = new Map<string, Program>();
  private field: Field | null = null;
  private maskCanvas = document.createElement('canvas');
  private art = { w: 1200, h: 1200 };
  private path: Path2D | null = null;
  private bbox: [number, number, number, number] | null = null;
  private effect: EffectDef | null = null;
  private params: ParamValues = {};
  private fieldDirty = true;
  private heightDirty = true;
  private lastHeight = '';
  private resolution = 1024;
  private start = performance.now();
  private raf = 0;
  view: View = { zoom: 0.5, panX: 0, panY: 0 };
  transparentPreview = false;
  onError: ((e: Error) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new GLError('WebGL 2 is not available on this device.');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new GLError('This GPU cannot render to float textures (EXT_color_buffer_float).');
    }
    this.gl = gl;
    this.progs = {
      seed: program(gl, FULLSCREEN_VS, SEED_FS),
      jfa: program(gl, FULLSCREEN_VS, JFA_FS),
      sdf: program(gl, FULLSCREEN_VS, SDF_FS),
      height: program(gl, FULLSCREEN_VS, HEIGHT_FS),
      blur: program(gl, FULLSCREEN_VS, BLUR_FS),
    };
    gl.bindVertexArray(gl.createVertexArray());
  }

  setArtboard(w: number, h: number) {
    if (w === this.art.w && h === this.art.h) return;
    this.art = { w, h };
    this.fieldDirty = true;
    this.invalidate();
  }

  get artboard() {
    return this.art;
  }

  setGeometry(d: string, bbox: [number, number, number, number] | null) {
    this.path = d ? new Path2D(d) : null;
    this.bbox = bbox;
    this.fieldDirty = true;
    this.invalidate();
  }

  setEffect(def: EffectDef, params: ParamValues) {
    this.effect = def;
    this.params = params;
    this.invalidate();
  }

  /** Texture resolution used for previews (longest artboard side, in texels). */
  setPreviewResolution(px: number) {
    const r = Math.max(256, Math.min(Math.round(px), 2048, this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number));
    if (Math.abs(r - this.resolution) / this.resolution < 0.2) return;
    this.resolution = r;
    this.fieldDirty = true;
    this.invalidate();
  }

  /** Request a redraw on the next animation frame. */
  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      try {
        this.draw();
      } catch (e) {
        this.onError?.(e as Error);
        return;
      }
      if (this.effect?.animated?.(this.params)) this.invalidate();
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.freeField();
  }

  private freeField() {
    const f = this.field;
    if (!f) return;
    const gl = this.gl;
    gl.deleteTexture(f.mask);
    for (const t of [f.seedsA, f.seedsB, f.sdf, f.heightA, f.heightB]) freeTarget(gl, t);
    this.field = null;
  }

  private fieldSize(res: number) {
    const s = res / Math.max(this.art.w, this.art.h);
    return { w: Math.max(1, Math.round(this.art.w * s)), h: Math.max(1, Math.round(this.art.h * s)) };
  }

  private ensureField(w: number, h: number) {
    if (this.field && this.field.w === w && this.field.h === h) return this.field;
    this.freeField();
    const gl = this.gl;
    const F = formats(gl);
    this.field = {
      w,
      h,
      mask: texture(gl, w, h, F.rgba8),
      seedsA: target(gl, w, h, F.rg32f),
      seedsB: target(gl, w, h, F.rg32f),
      sdf: target(gl, w, h, F.r16f),
      heightA: target(gl, w, h, F.r16f),
      heightB: target(gl, w, h, F.r16f),
    };
    return this.field;
  }

  private pass(p: Program, out: Target | null, w: number, h: number, tex: Record<string, WebGLTexture | null>, u: Record<string, UniformValue> = {}) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.prog);
    bindTextures(gl, p, tex);
    setUniforms(gl, p, u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Rasterise the path and rebuild the distance field at `res`. */
  private buildField(res: number) {
    const { w, h } = this.fieldSize(res);
    const f = this.ensureField(w, h);
    const gl = this.gl;
    const c = this.maskCanvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new GLError('2D canvas unavailable');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.path) {
      const s = w / this.art.w;
      ctx.setTransform(s, 0, 0, s, w / 2, h / 2);
      ctx.fillStyle = '#000';
      ctx.fill(this.path, 'nonzero');
    }
    gl.bindTexture(gl.TEXTURE_2D, f.mask);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);

    this.pass(this.progs.seed, f.seedsA, w, h, { u_mask: f.mask });
    let src = f.seedsA;
    let dst = f.seedsB;
    let step = 1;
    while (step * 2 < Math.max(w, h)) step *= 2;
    for (; step >= 1; step = Math.floor(step / 2)) {
      this.pass(this.progs.jfa, dst, w, h, { u_seeds: src.tex }, { u_step: step });
      [src, dst] = [dst, src];
    }
    // One extra 1-step pass cleans up the classic JFA errors.
    this.pass(this.progs.jfa, dst, w, h, { u_seeds: src.tex }, { u_step: 1 });
    this.pass(this.progs.sdf, f.sdf, w, h, { u_seeds: dst.tex, u_mask: f.mask });
    this.heightDirty = true;
  }

  private heightSpec(): HeightSpec | null {
    return this.effect?.height?.(this.params) ?? null;
  }

  private buildHeight(k: number) {
    const f = this.field;
    if (!f) return;
    const spec = this.heightSpec() ?? { profile: 0, bevel: 8, softness: 0 };
    const key = JSON.stringify(spec) + k;
    if (!this.heightDirty && key === this.lastHeight) return;
    this.lastHeight = key;
    this.heightDirty = false;
    const bevel = spec.bevel * k;
    const radius = spec.softness * k;
    this.pass(this.progs.height, f.heightA, f.w, f.h, { u_sdf: f.sdf.tex }, { u_bevel: bevel, u_profile: spec.profile });
    if (radius >= 0.5) {
      for (let i = 0; i < 2; i++) {
        this.pass(this.progs.blur, f.heightB, f.w, f.h, { u_src: f.heightA.tex }, { u_dir: [1, 0], u_radius: radius });
        this.pass(this.progs.blur, f.heightA, f.w, f.h, { u_src: f.heightB.tex }, { u_dir: [0, 1], u_radius: radius });
      }
    }
  }

  private effectProgram(def: EffectDef): Program {
    let p = this.effects.get(def.id);
    if (!p) {
      p = program(this.gl, RECT_VS, EFFECT_FS(def.glsl));
      this.effects.set(def.id, p);
    }
    return p;
  }

  private effectUniforms(k: number, f: Field): Record<string, UniformValue> {
    const u: Record<string, UniformValue> = {
      u_texSize: [f.w, f.h],
      u_art: [this.art.w, this.art.h],
      u_k: k,
      u_time: (performance.now() - this.start) / 1000,
      u_bevelTex: (this.heightSpec()?.bevel ?? 8) * k,
    };
    const b = this.bbox;
    const { w, h } = this.art;
    u.u_bbox = b ? [(b[0] + w / 2) / w, (b[1] + h / 2) / h, (b[2] + w / 2) / w, (b[3] + h / 2) / h] : [0.5, 0.5, 0.5, 0.5];
    for (const def of this.effect?.params ?? []) {
      const v = this.params[def.key] ?? def.default;
      u[`u_${def.key}`] = def.type === 'color' ? hexToRgb(String(v)) : Number(v);
    }
    return u;
  }

  /** Artboard rect in CSS pixels relative to the canvas. */
  artRect() {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const w = this.art.w * this.view.zoom;
    const h = this.art.h * this.view.zoom;
    const x = cw / 2 + this.view.panX - w / 2;
    const y = ch / 2 + this.view.panY - h / 2;
    return { x, y, w, h };
  }

  /** CSS pixel (relative to canvas) → artboard coordinates (origin at centre). */
  toArt(px: number, py: number) {
    const r = this.artRect();
    return { x: (px - r.x) / this.view.zoom - this.art.w / 2, y: (py - r.y) / this.view.zoom - this.art.h / 2 };
  }

  draw() {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    if (this.fieldDirty || !this.field) {
      this.buildField(this.resolution);
      this.fieldDirty = false;
    }
    const f = this.field!;
    const k = f.w / this.art.w;
    this.buildHeight(k);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.075, 0.075, 0.082, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.effect) return;
    const r = this.artRect();
    const toClip = (x: number, y: number): [number, number] => [(x / this.canvas.clientWidth) * 2 - 1, 1 - (y / this.canvas.clientHeight) * 2];
    const [x0, y1] = toClip(r.x, r.y + r.h);
    const [x1, y0] = toClip(r.x + r.w, r.y);
    const p = this.effectProgram(this.effect);
    gl.useProgram(p.prog);
    bindTextures(gl, p, { u_mask: f.mask, u_sdf: f.sdf.tex, u_height: f.heightA.tex });
    setUniforms(gl, p, {
      ...this.effectUniforms(k, f),
      u_rect: [x0, y1, x1, y0],
      u_transparent: this.transparentPreview,
      u_checker: true,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Render the artboard at `scale` × its size and return straight-alpha RGBA
   * rows top-to-bottom. The preview field is rebuilt afterwards.
   */
  renderPixels(scale: number, transparent: boolean): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
    const gl = this.gl;
    const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, 8192);
    const long = Math.min(Math.round(Math.max(this.art.w, this.art.h) * scale), max);
    this.buildField(long);
    const f = this.field!;
    const k = f.w / this.art.w;
    this.lastHeight = '';
    this.buildHeight(k);
    const out = target(gl, f.w, f.h, formats(gl).rgba8);
    try {
      const p = this.effectProgram(this.effect!);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.viewport(0, 0, f.w, f.h);
      gl.useProgram(p.prog);
      bindTextures(gl, p, { u_mask: f.mask, u_sdf: f.sdf.tex, u_height: f.heightA.tex });
      setUniforms(gl, p, { ...this.effectUniforms(k, f), u_rect: [-1, -1, 1, 1], u_transparent: transparent, u_checker: false });
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const raw = new Uint8Array(f.w * f.h * 4);
      gl.readPixels(0, 0, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      // Flip rows (GL is bottom-up) and un-premultiply for PNG.
      const data = new Uint8ClampedArray(raw.length);
      const row = f.w * 4;
      for (let y = 0; y < f.h; y++) {
        const src = (f.h - 1 - y) * row;
        const dst = y * row;
        for (let i = 0; i < row; i += 4) {
          const a = raw[src + i + 3];
          if (transparent && a > 0 && a < 255) {
            const m = 255 / a;
            data[dst + i] = raw[src + i] * m;
            data[dst + i + 1] = raw[src + i + 1] * m;
            data[dst + i + 2] = raw[src + i + 2] * m;
          } else {
            data[dst + i] = raw[src + i];
            data[dst + i + 1] = raw[src + i + 1];
            data[dst + i + 2] = raw[src + i + 2];
          }
          data[dst + i + 3] = transparent ? a : 255;
        }
      }
      return { data, width: f.w, height: f.h };
    } finally {
      freeTarget(gl, out);
      this.fieldDirty = true;
      this.lastHeight = '';
      this.invalidate();
    }
  }

  async exportPNG(scale: number, transparent: boolean): Promise<Uint8Array> {
    const { data, width, height } = this.renderPixels(scale, transparent);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new GLError('2D canvas unavailable');
    ctx.putImageData(new ImageData(data, width, height), 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!blob) throw new GLError('PNG encoding failed');
    return new Uint8Array(await blob.arrayBuffer());
  }
}
