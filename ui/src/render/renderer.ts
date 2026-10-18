import { BLUR_FS, FULLSCREEN_VS, HEIGHT_FS, JFA_FS, RECT_VS, SDF_FS, SEED_FS } from './passes';
import { COMMON_GLSL, type EffectDef, type HeightSpec, type ParamValues } from './effects';
import { ambientOf, backgroundUniforms, BG_FS } from './background';
import type { Background } from '../state/model';
import { bindTextures, formats, freeTarget, GLError, hexToRgb, program, setUniforms, target, texture, type Program, type Target, type UniformValue } from './gl';

const EFFECT_FS = (body: string) => /* glsl */ `#version 300 es
precision highp float;
${COMMON_GLSL}
in vec2 v_uv;
out vec4 o;
${body}
void main() {
  o = effect(v_uv);
}`;

export interface View {
  /** Screen pixels per artboard pixel. */
  zoom: number;
  /** Artboard centre offset from the canvas centre, in CSS pixels. */
  panX: number;
  panY: number;
}

export type Box = [number, number, number, number];

/** One styled object: outline (artboard coordinates, origin at the centre) and material. */
export interface SceneItem {
  id: string;
  d: string;
  bbox: Box | null;
  effect: EffectDef;
  params: ParamValues;
}

interface Field {
  w: number;
  h: number;
  mask: WebGLTexture;
  sdf: Target;
  heightA: Target;
  heightB: Target;
}

/** Area of the artboard (px from its top-left) an object's field covers. */
interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Obj {
  item: SceneItem;
  path: Path2D | null;
  field: Field | null;
  /** Field density the field was built at, and for which region. */
  fieldKey: string;
  heightKey: string;
  region: Region | null;
}

/**
 * GPU renderer. Each object's outline is rasterised into its own field
 * (cropped to where the effect can paint), turned into a signed distance
 * field by jump flooding, then a height map, and shaded by its effect.
 * Objects composite in order over the background.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private progs: Record<'seed' | 'jfa' | 'sdf' | 'height' | 'blur' | 'bg', Program>;
  private effects = new Map<string, Program>();
  private objs: Obj[] = [];
  private seeds: { a: Target; b: Target; w: number; h: number } | null = null;
  private maskCanvas = document.createElement('canvas');
  private art = { w: 1200, h: 1200 };
  private bg: Background | null = null;
  private resolution = 1024;
  private start = performance.now();
  private raf = 0;
  view: View = { zoom: 0.5, panX: 0, panY: 0 };
  checker = true;
  paused = false;
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
      bg: program(gl, RECT_VS, BG_FS),
    };
    gl.bindVertexArray(gl.createVertexArray());
  }

  setArtboard(w: number, h: number) {
    if (w === this.art.w && h === this.art.h) return;
    this.art = { w, h };
    for (const o of this.objs) o.fieldKey = '';
    this.invalidate();
  }

  get artboard() {
    return this.art;
  }

  setBackground(bg: Background) {
    this.bg = bg;
    this.invalidate();
  }

  /** Replace the scene. Fields are kept for objects whose outline didn't change. */
  setScene(items: SceneItem[]) {
    const old = new Map(this.objs.map((o) => [o.item.id, o]));
    const next: Obj[] = [];
    for (const item of items) {
      const prev = old.get(item.id);
      if (prev) {
        old.delete(item.id);
        if (prev.item.d !== item.d) {
          prev.path = item.d ? new Path2D(item.d) : null;
          prev.fieldKey = '';
        }
        if (prev.item.effect !== item.effect) prev.heightKey = '';
        prev.item = item;
        next.push(prev);
      } else {
        next.push({ item, path: item.d ? new Path2D(item.d) : null, field: null, fieldKey: '', heightKey: '', region: null });
      }
    }
    for (const o of old.values()) this.freeField(o);
    this.objs = next;
    this.invalidate();
  }

  /** Texture resolution used for previews (longest artboard side, in texels). */
  setPreviewResolution(px: number) {
    const r = Math.max(256, Math.min(Math.round(px), 3072, this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number));
    if (Math.abs(r - this.resolution) / this.resolution < 0.2) return;
    this.resolution = r;
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
      if (!this.paused && this.objs.some((o) => o.item.effect.animated?.(o.item.params))) this.invalidate();
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const o of this.objs) this.freeField(o);
    this.objs = [];
    if (this.seeds) {
      freeTarget(this.gl, this.seeds.a);
      freeTarget(this.gl, this.seeds.b);
      this.seeds = null;
    }
  }

  private freeField(o: Obj) {
    const f = o.field;
    if (!f) return;
    const gl = this.gl;
    gl.deleteTexture(f.mask);
    for (const t of [f.sdf, f.heightA, f.heightB]) freeTarget(gl, t);
    o.field = null;
    o.fieldKey = '';
  }

  private ensureSeeds(w: number, h: number) {
    const s = this.seeds;
    if (s && s.w >= w && s.h >= h) return s;
    const gl = this.gl;
    if (s) {
      freeTarget(gl, s.a);
      freeTarget(gl, s.b);
    }
    const W = Math.max(w, s?.w ?? 0);
    const H = Math.max(h, s?.h ?? 0);
    const F = formats(gl);
    this.seeds = { a: target(gl, W, H, F.rg32f), b: target(gl, W, H, F.rg32f), w: W, h: H };
    return this.seeds;
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

  private regionOf(o: Obj): Region | null {
    const b = o.item.bbox;
    if (!b || !o.path) return null;
    const { w: W, h: H } = this.art;
    const size = { w: b[2] - b[0], h: b[3] - b[1] };
    const m = Math.max(0, o.item.effect.reach(o.item.params, size)) + 3;
    const x0 = Math.max(0, Math.floor(b[0] + W / 2 - m));
    const y0 = Math.max(0, Math.floor(b[1] + H / 2 - m));
    const x1 = Math.min(W, Math.ceil(b[2] + W / 2 + m));
    const y1 = Math.min(H, Math.ceil(b[3] + H / 2 + m));
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Rasterise an object's outline and rebuild its distance field at density `k` (texels per artboard px). */
  private buildField(o: Obj, k: number) {
    const region = this.regionOf(o);
    o.region = region;
    if (!region) {
      this.freeField(o);
      return;
    }
    const max = Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number, 8192);
    k = Math.min(k, max / Math.max(region.w, region.h));
    const key = `${k.toFixed(5)}:${region.x},${region.y},${region.w},${region.h}`;
    if (o.field && o.fieldKey === key) return;
    const w = Math.max(1, Math.round(region.w * k));
    const h = Math.max(1, Math.round(region.h * k));
    const gl = this.gl;
    if (!o.field || o.field.w !== w || o.field.h !== h) {
      this.freeField(o);
      const F = formats(gl);
      o.field = { w, h, mask: texture(gl, w, h, F.rgba8), sdf: target(gl, w, h, F.r16f), heightA: target(gl, w, h, F.r16f), heightB: target(gl, w, h, F.r16f) };
    }
    const f = o.field;
    const c = this.maskCanvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new GLError('2D canvas unavailable');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sx = w / region.w;
    const sy = h / region.h;
    ctx.setTransform(sx, 0, 0, sy, (this.art.w / 2 - region.x) * sx, (this.art.h / 2 - region.y) * sy);
    ctx.fillStyle = '#000';
    if (o.path) ctx.fill(o.path, 'nonzero');
    gl.bindTexture(gl.TEXTURE_2D, f.mask);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);

    const seeds = this.ensureSeeds(w, h);
    this.pass(this.progs.seed, seeds.a, w, h, { u_mask: f.mask });
    let src = seeds.a;
    let dst = seeds.b;
    let step = 1;
    while (step * 2 < Math.max(w, h)) step *= 2;
    for (; step >= 1; step = Math.floor(step / 2)) {
      this.pass(this.progs.jfa, dst, w, h, { u_seeds: src.tex }, { u_step: step, u_size: [w, h] });
      [src, dst] = [dst, src];
    }
    // One extra 1-step pass cleans up the classic JFA errors.
    this.pass(this.progs.jfa, dst, w, h, { u_seeds: src.tex }, { u_step: 1, u_size: [w, h] });
    this.pass(this.progs.sdf, f.sdf, w, h, { u_seeds: dst.tex, u_mask: f.mask });
    o.fieldKey = key;
    o.heightKey = '';
  }

  private heightSpec(o: Obj): HeightSpec {
    return o.item.effect.height?.(o.item.params) ?? { profile: 0, bevel: 8, softness: 0 };
  }

  private buildHeight(o: Obj, k: number) {
    const f = o.field;
    if (!f) return;
    const spec = this.heightSpec(o);
    const key = JSON.stringify(spec) + k;
    if (key === o.heightKey) return;
    o.heightKey = key;
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

  private effectUniforms(o: Obj): Record<string, UniformValue> {
    const f = o.field!;
    const r = o.region!;
    const { w: W, h: H } = this.art;
    const kk = f.w / r.w;
    const u: Record<string, UniformValue> = {
      u_texSize: [f.w, f.h],
      u_art: [W, H],
      u_region: [r.x, r.y, r.w, r.h],
      u_k: kk,
      u_time: this.paused ? 0 : (performance.now() - this.start) / 1000,
      u_bevelTex: this.heightSpec(o).bevel * kk,
      u_ambient: this.bg ? ambientOf(this.bg) : [0.1, 0.1, 0.1],
    };
    const b = o.item.bbox!;
    u.u_bbox = [(b[0] + W / 2 - r.x) / r.w, (b[1] + H / 2 - r.y) / r.h, (b[2] + W / 2 - r.x) / r.w, (b[3] + H / 2 - r.y) / r.h];
    for (const def of o.item.effect.params) {
      const v = o.item.params[def.key] ?? def.default;
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

  /** Artboard coordinates → CSS pixel relative to the canvas. */
  toScreen(x: number, y: number) {
    const r = this.artRect();
    return { x: r.x + (x + this.art.w / 2) * this.view.zoom, y: r.y + (y + this.art.h / 2) * this.view.zoom };
  }

  /** Draw background then objects into the bound framebuffer. `rect` maps the artboard to clip space. */
  private composite(k: number, rectOf: (r: Region) => [number, number, number, number], transparent: boolean, checker: boolean) {
    const gl = this.gl;
    for (const o of this.objs) {
      this.buildField(o, k);
      if (o.field) this.buildHeight(o, o.field.w / o.region!.w);
    }
    return () => {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (this.bg) {
        const bg = transparent ? { ...this.bg, fill: { ...this.bg.fill, kind: 'none' as const } } : this.bg;
        const p = this.progs.bg;
        gl.useProgram(p.prog);
        setUniforms(gl, p, { ...backgroundUniforms(bg), u_rect: rectOf({ x: 0, y: 0, w: this.art.w, h: this.art.h }), u_art: [this.art.w, this.art.h], u_checker: checker, u_k: k });
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      for (const o of this.objs) {
        if (!o.field || !o.region) continue;
        const p = this.effectProgram(o.item.effect);
        gl.useProgram(p.prog);
        bindTextures(gl, p, { u_mask: o.field.mask, u_sdf: o.field.sdf.tex, u_height: o.field.heightA.tex });
        setUniforms(gl, p, { ...this.effectUniforms(o), u_rect: rectOf(o.region) });
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disable(gl.BLEND);
    };
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
    const k = this.resolution / Math.max(this.art.w, this.art.h);
    const ar = this.artRect();
    const z = this.view.zoom;
    const toClip = (x: number, y: number): [number, number] => [(x / this.canvas.clientWidth) * 2 - 1, 1 - (y / this.canvas.clientHeight) * 2];
    const rectOf = (r: Region): [number, number, number, number] => {
      const [x0, y1] = toClip(ar.x + r.x * z, ar.y + (r.y + r.h) * z);
      const [x1, y0] = toClip(ar.x + (r.x + r.w) * z, ar.y + r.y * z);
      return [x0, y1, x1, y0];
    };
    const paint = this.composite(k, rectOf, false, this.checker);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.043, 0.043, 0.051, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    paint();
  }

  /**
   * Render the artboard at `scale` × its size and return straight-alpha RGBA
   * rows top-to-bottom. Preview fields are rebuilt afterwards.
   */
  renderPixels(scale: number, transparent: boolean): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
    const gl = this.gl;
    const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, 8192);
    const W = Math.max(1, Math.min(Math.round(this.art.w * scale), max));
    const Hh = Math.max(1, Math.min(Math.round(this.art.h * scale), max));
    const k = W / this.art.w;
    const out = target(gl, W, Hh, formats(gl).rgba8);
    const { w: AW, h: AH } = this.art;
    const rectOf = (r: Region): [number, number, number, number] => [(r.x / AW) * 2 - 1, 1 - ((r.y + r.h) / AH) * 2, ((r.x + r.w) / AW) * 2 - 1, 1 - (r.y / AH) * 2];
    try {
      const paint = this.composite(k, rectOf, transparent, false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.viewport(0, 0, W, Hh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      paint();
      const raw = new Uint8Array(W * Hh * 4);
      gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      // Flip rows (GL is bottom-up) and un-premultiply.
      const data = new Uint8ClampedArray(raw.length);
      const row = W * 4;
      for (let y = 0; y < Hh; y++) {
        const src = (Hh - 1 - y) * row;
        const dst = y * row;
        for (let i = 0; i < row; i += 4) {
          const a = raw[src + i + 3];
          const m = a > 0 && a < 255 ? 255 / a : 1;
          data[dst + i] = raw[src + i] * m;
          data[dst + i + 1] = raw[src + i + 1] * m;
          data[dst + i + 2] = raw[src + i + 2] * m;
          data[dst + i + 3] = a;
        }
      }
      return { data, width: W, height: Hh };
    } finally {
      freeTarget(gl, out);
      for (const o of this.objs) o.fieldKey = '';
      this.invalidate();
    }
  }

  async exportPNG(scale: number, transparent: boolean): Promise<Uint8Array> {
    const blob = await this.toBlob(scale, transparent);
    return new Uint8Array(await blob.arrayBuffer());
  }

  async toBlob(scale: number, transparent: boolean, type = 'image/png'): Promise<Blob> {
    const c = this.toCanvas(scale, transparent);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, type));
    if (!blob) throw new GLError('Image encoding failed');
    return blob;
  }

  toCanvas(scale: number, transparent: boolean): HTMLCanvasElement {
    const { data, width, height } = this.renderPixels(scale, transparent);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new GLError('2D canvas unavailable');
    ctx.putImageData(new ImageData(data, width, height), 0, 0);
    return c;
  }
}
