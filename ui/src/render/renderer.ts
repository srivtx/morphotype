import { BLUR_FS, BLUR_RGBA_FS, FULLSCREEN_VS, HEIGHT_FS, JFA_FS, MOVED_RECT_VS, RECT_VS, SDF_FS, SEED_FS } from './passes';
import { COMMON_GLSL, effectById, type EffectDef, type HeightSpec, type ParamValues } from './effects';
import { ambientOf, backgroundUniforms, BG_FS } from './background';
import type { Background, BlendMode, Depth, Stroke, Style } from '../state/model';
import { imageAsset, imageElement, onImagesReady } from '../state/assets';
import { clock, DEFAULT_TIMELINE, type Timeline } from '../state/clock';
import { animatedValue, applyMat, compose, keyedNumber, keyedValue, placement, type Key, type KeyedTransform, type Mat, type Motion, type ParamAnim } from '../state/motion';
import { bindTextures, formats, freeTarget, GLError, hexToRgb, program, setUniforms, target, texture, type Program, type Target, type UniformValue } from './gl';

const EFFECT_FS = (body: string) => /* glsl */ `#version 300 es
precision highp float;
${COMMON_GLSL}
in vec2 v_uv;
in vec2 v_clipUv;
out vec4 o;
${body}
uniform float u_strokeW, u_strokeAlign, u_strokeOpacity, u_opacity, u_hasClip;
uniform sampler2D u_clipMask;
uniform vec3 u_strokeColor;
uniform float u_sideDepth, u_sideAngle, u_sideShade;
uniform vec3 u_sideColor;
/** Solid extrusion: the outline swept back along a direction, darker toward the back. */
vec4 depthSide(vec2 uv) {
  vec2 dir = vec2(sin(u_sideAngle), -cos(u_sideAngle));
  float steps = clamp(ceil(u_sideDepth * u_k / 1.25), 4.0, 96.0);
  float best = 1e9;
  float bt = 0.0;
  for (int i = 1; i <= 96; i++) {
    if (float(i) > steps) break;
    float t = u_sideDepth * float(i) / steps;
    float d = sdfPx(uv - offsetUv(dir * t));
    if (d < best) { best = d; bt = t; }
    // The nearest slice covering this pixel decides its shade.
    if (d < -1.5) break;
  }
  float a = clamp(0.5 - best, 0.0, 1.0);
  float k = 1.0 - u_sideShade * bt / u_sideDepth;
  return vec4(u_sideColor * k * a, a);
}
void main() {
  o = effect(v_uv);
  if (u_strokeW > 0.0) {
    // A stroke for any material: outside (0), centred (1) or inside (2) the outline.
    float d = sdfPx(v_uv);
    float w = u_strokeW * u_k;
    float lo = u_strokeAlign < 0.5 ? 0.0 : u_strokeAlign < 1.5 ? -0.5 * w : -w;
    float a = (cover(d - lo - w) - cover(d - lo)) * u_strokeOpacity;
    o = over(vec4(u_strokeColor * a, a), o);
  }
  if (u_sideDepth > 0.0) o = over(o, depthSide(v_uv));
  if (u_hasClip > 0.5) {
    vec2 c = v_clipUv;
    o *= texture(u_clipMask, c).a * step(0.0, c.x) * step(c.x, 1.0) * step(0.0, c.y) * step(c.y, 1.0);
  }
  o *= u_opacity;
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
  stroke?: Stroke | null;
  opacity?: number;
  blend?: BlendMode;
  depth?: Depth | null;
  soften?: number;
  /** Outline (artboard coordinates) this object is clipped to. */
  clipD?: string | null;
  /** Reference layers draw on the canvas but not in exports or previews. */
  guide?: boolean;
  /** A pen line's centre line, for materials that colour along it. */
  spine?: number[] | null;
  /** Motions moving it at draw time (its own first), each about a rest centre in artboard coordinates, with any transform keys. */
  motion?: { motion: Motion; pivot: [number, number]; offset: number; keys?: KeyedTransform }[];
  /** Material settings that change over time. */
  anim?: Record<string, ParamAnim>;
  /** Material settings keyed on the clock (they win over `anim`). */
  keys?: Record<string, Key[]>;
  /** Its opacity, keyed on the clock. */
  opacityKeys?: Key[];
  /** How far (px) motion carries it from rest: a clipped object's field covers that much more, so its frame can stay still. */
  motionReach?: number;
  /** Its outline is rebuilt on the scene clock: the field's area snaps to a coarse grid so its textures are reused from frame to frame. */
  live?: boolean;
  /** The box its material is laid out in, when that isn't its own: a letter moving on its own keeps its text's, so a gradient still runs across the word. */
  frame?: Box | null;
}

/** The scene item for one built object and its style. */
export function sceneItem(id: string, out: { d: string; bbox: Box | null; spine?: number[] }, st: Style, guide?: boolean, clipD?: string | null): SceneItem {
  return { id, d: out.d, bbox: out.bbox, clipD, spine: out.spine ?? null, effect: effectById(st.effect), params: st.params, anim: st.animate, keys: st.keys, stroke: st.stroke, opacity: st.opacity, blend: st.blend, depth: st.depth, soften: st.soften, guide };
}

interface Field {
  w: number;
  h: number;
  mask: WebGLTexture;
  /** Coverage of the clipping outline, when the object is clipped. */
  clip: WebGLTexture | null;
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
  clipPath: Path2D | null;
  field: Field | null;
  /** Field density the field was built at, and for which region. */
  fieldKey: string;
  heightKey: string;
  region: Region | null;
  /** Uploaded centre line and the array it came from. */
  spine: { tex: WebGLTexture; n: number; src: number[] } | null;
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
  private progs: Record<'seed' | 'jfa' | 'sdf' | 'height' | 'blur' | 'blurRgba' | 'bg', Program>;
  /** What's behind a glass object: sharp copy and two blur targets (half size). */
  private bd: { sharp: WebGLTexture; w: number; h: number; a: Target; b: Target } | null = null;
  private effects = new Map<string, Program>();
  private objs: Obj[] = [];
  private seeds: { a: Target; b: Target; w: number; h: number } | null = null;
  private maskCanvas = document.createElement('canvas');
  private maskCtx: CanvasRenderingContext2D | null = null;
  /** GL limits are asked once: a query can wait on the GPU. */
  private maxTexture = 0;
  private art = { w: 1200, h: 1200 };
  private bg: Background | null = null;
  private resolution = 1024;
  /** Field density for exports, in texels per output px (1 = quick drafts). */
  exportSupersample = 2;
  private raf = 0;
  view: View = { zoom: 0.5, panX: 0, panY: 0 };
  checker = true;
  /** Reduce motion: everything holds still at rest. */
  paused = false;
  timeline: Timeline = DEFAULT_TIMELINE;
  /** Exports pin the clock to the frame being drawn (null: everything at rest). */
  private pinned: { t: number | null } | null = null;
  /** Open export sessions: the preview doesn't draw (it would rebuild their fields at its own density). */
  private exporting = 0;
  /** Bumped whenever the scene changes, so an export session rebuilds changed fields. */
  private version = 0;
  onError: ((e: Error) => void) | null = null;
  /** GPU copies of Photo pictures, by asset id. */
  private photos = new Map<string, WebGLTexture>();
  private offImages: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new GLError('WebGL 2 is not available on this device.');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new GLError('This GPU cannot render to float textures (EXT_color_buffer_float).');
    }
    this.gl = gl;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.progs = {
      seed: program(gl, FULLSCREEN_VS, SEED_FS),
      jfa: program(gl, FULLSCREEN_VS, JFA_FS),
      sdf: program(gl, FULLSCREEN_VS, SDF_FS),
      height: program(gl, FULLSCREEN_VS, HEIGHT_FS),
      blur: program(gl, FULLSCREEN_VS, BLUR_FS),
      blurRgba: program(gl, FULLSCREEN_VS, BLUR_RGBA_FS),
      bg: program(gl, RECT_VS, BG_FS),
    };
    gl.bindVertexArray(gl.createVertexArray());
    // Redraw once a picture finishes decoding.
    this.offImages = onImagesReady(() => this.invalidate());
  }

  /** Texture for a Photo picture (uploaded once, mipmapped for clean downscaling). */
  private photoTexture(id: string): WebGLTexture | null {
    const cached = this.photos.get(id);
    if (cached) return cached;
    const el = imageElement(id);
    if (!el) return null;
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) return null;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.photos.set(id, t);
    return t;
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
        if ((prev.item.clipD ?? null) !== (item.clipD ?? null)) {
          prev.clipPath = item.clipD ? new Path2D(item.clipD) : null;
          prev.fieldKey = '';
        }
        if (prev.item.effect !== item.effect) prev.heightKey = '';
        prev.item = item;
        next.push(prev);
      } else {
        next.push({ item, path: item.d ? new Path2D(item.d) : null, clipPath: item.clipD ? new Path2D(item.clipD) : null, field: null, fieldKey: '', heightKey: '', region: null, spine: null });
      }
    }
    for (const o of old.values()) this.freeField(o);
    this.objs = next;
    this.version++;
    this.invalidate();
  }

  /** Texture resolution used for previews (longest artboard side, in texels). */
  setPreviewResolution(px: number) {
    const r = Math.max(256, Math.min(Math.round(px), 3072, this.maxTexture));
    if (Math.abs(r - this.resolution) / this.resolution < 0.2) return;
    this.resolution = r;
    this.invalidate();
  }

  /** Request a redraw on the next animation frame. */
  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.exporting) return;
      try {
        this.draw();
      } catch (e) {
        this.onError?.(e as Error);
        return;
      }
      if (!this.paused && clock.running(this.timeline) && this.moving()) this.invalidate();
    });
  }

  /** Anything that changes with time: animated materials or motion. */
  moving() {
    return this.objs.some((o) => o.item.motion?.length || (o.item.anim && Object.keys(o.item.anim).length) || (o.item.keys && Object.keys(o.item.keys).length) || o.item.opacityKeys?.length || o.item.effect.animated?.(o.item.params));
  }

  /** Seconds on the scene clock for this frame; null holds everything at rest. */
  private now(): number | null {
    if (this.pinned) return this.pinned.t;
    return this.paused ? null : clock.time(this.timeline);
  }

  /** An object's own opacity now: its style's, or its keys'. */
  private opacityOf(o: Obj): number {
    const t = this.now();
    return t === null ? (o.item.opacity ?? 1) : keyedNumber(o.item.opacityKeys, t, o.item.opacity ?? 1);
  }

  /** Where motion puts an object now (artboard map), and its fade. */
  private placed(o: Obj): { m: Mat; opacity: number } | null {
    const t = this.now();
    const links = o.item.motion;
    if (t === null || !links?.length) return null;
    return placement(links, t, this.timeline.loop ? this.timeline.duration : undefined);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.offImages();
    for (const t of this.photos.values()) this.gl.deleteTexture(t);
    this.photos.clear();
    for (const o of this.objs) this.freeField(o);
    this.objs = [];
    if (this.seeds) {
      freeTarget(this.gl, this.seeds.a);
      freeTarget(this.gl, this.seeds.b);
      this.seeds = null;
    }
    this.freeBackdrop();
  }

  private freeBackdrop() {
    if (!this.bd) return;
    this.gl.deleteTexture(this.bd.sharp);
    freeTarget(this.gl, this.bd.a);
    freeTarget(this.gl, this.bd.b);
    this.bd = null;
  }

  /**
   * Copy what's drawn so far under a backdrop object's quad (clip rect `r`)
   * and blur it by `blurPx` framebuffer pixels. Returns the uniforms that
   * map the object's uv onto the copy.
   */
  private captureBackdrop(r: [number, number, number, number], fb: { fbo: WebGLFramebuffer | null; w: number; h: number }, blurPx: number): Record<string, UniformValue> | null {
    const gl = this.gl;
    const px = (c: number, size: number) => ((c + 1) / 2) * size;
    const rx0 = px(Math.min(r[0], r[2]), fb.w);
    const rx1 = px(Math.max(r[0], r[2]), fb.w);
    const ryb = px(Math.min(r[1], r[3]), fb.h);
    const ryt = px(Math.max(r[1], r[3]), fb.h);
    const x0 = Math.max(0, Math.floor(rx0));
    const x1 = Math.min(fb.w, Math.ceil(rx1));
    const y0 = Math.max(0, Math.floor(ryb));
    const y1 = Math.min(fb.h, Math.ceil(ryt));
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (cw < 1 || ch < 1) return null;
    if (!this.bd || this.bd.w !== cw || this.bd.h !== ch) {
      this.freeBackdrop();
      const F = formats(gl);
      const hw = Math.max(1, Math.ceil(cw / 2));
      const hh = Math.max(1, Math.ceil(ch / 2));
      this.bd = { sharp: texture(gl, cw, ch, F.rgb8), w: cw, h: ch, a: target(gl, hw, hh, F.rgba8), b: target(gl, hw, hh, F.rgba8) };
    }
    const bd = this.bd;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
    gl.bindTexture(gl.TEXTURE_2D, bd.sharp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, x0, y0, cw, ch);
    let blurred: WebGLTexture = bd.sharp;
    if (blurPx >= 0.5) {
      gl.disable(gl.BLEND);
      const p = this.progs.blurRgba;
      const out = [bd.a.w, bd.a.h];
      this.pass(p, bd.a, bd.a.w, bd.a.h, { u_src: bd.sharp }, { u_dir: [1, 0], u_radius: blurPx, u_outSize: out });
      this.pass(p, bd.b, bd.b.w, bd.b.h, { u_src: bd.a.tex }, { u_dir: [0, 1], u_radius: blurPx / 2, u_outSize: out });
      this.pass(p, bd.a, bd.a.w, bd.a.h, { u_src: bd.b.tex }, { u_dir: [1, 0], u_radius: blurPx / 2, u_outSize: out });
      this.pass(p, bd.b, bd.b.w, bd.b.h, { u_src: bd.a.tex }, { u_dir: [0, 1], u_radius: blurPx / 2, u_outSize: out });
      blurred = bd.b.tex;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
      gl.viewport(0, 0, fb.w, fb.h);
      gl.enable(gl.BLEND);
    }
    this.bdBlur = blurred;
    return { u_hasBackdrop: 1, u_bdMap: [(rx1 - rx0) / cw, -(ryt - ryb) / ch, (rx0 - x0) / cw, (ryt - y0) / ch] };
  }
  private bdBlur: WebGLTexture | null = null;

  private freeField(o: Obj) {
    if (o.spine) {
      this.gl.deleteTexture(o.spine.tex);
      o.spine = null;
    }
    const f = o.field;
    if (!f) return;
    const gl = this.gl;
    gl.deleteTexture(f.mask);
    if (f.clip) gl.deleteTexture(f.clip);
    for (const t of [f.sdf, f.heightA, f.heightB]) freeTarget(gl, t);
    o.field = null;
    o.fieldKey = '';
  }

  /** The object's centre line as a 1-row float texture (re-uploaded when it changes). */
  private spineTexture(o: Obj) {
    const src = o.item.spine;
    if (!src || src.length < 8) return null;
    if (o.spine && o.spine.src === src) return o.spine;
    const gl = this.gl;
    const n = Math.min(src.length >> 2, Math.min(this.maxTexture, 4096));
    if (o.spine) gl.deleteTexture(o.spine.tex);
    const tex = texture(gl, n, 1, formats(gl).rgba32f);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RGBA, gl.FLOAT, new Float32Array(src.slice(0, n * 4)));
    o.spine = { tex, n, src };
    return o.spine;
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
    const fb = o.item.frame ?? b;
    const size = { w: fb[2] - fb[0], h: fb[3] - fb[1] };
    const st = o.item.stroke;
    const stroke = st && st.width > 0 ? st.width * (st.align === 'outside' ? 1 : st.align === 'center' ? 0.5 : 0) : 0;
    const dp = o.item.depth && o.item.depth.amount > 0 ? o.item.depth.amount : 0;
    const m = Math.max(0, o.item.effect.reach(o.item.params, size)) + stroke + dp + (o.item.soften ?? 0) * 1.5 + 3 + (o.item.clipD ? (o.item.motionReach ?? 0) : 0);
    const q = o.item.live ? 16 : 1;
    const x0 = Math.max(0, Math.floor((b[0] + W / 2 - m) / q) * q);
    const y0 = Math.max(0, Math.floor((b[1] + H / 2 - m) / q) * q);
    const x1 = Math.min(W, Math.ceil((b[2] + W / 2 + m) / q) * q);
    const y1 = Math.min(H, Math.ceil((b[3] + H / 2 + m) / q) * q);
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
    const max = Math.min(this.maxTexture, 8192);
    k = Math.min(k, max / Math.max(region.w, region.h));
    const key = `${k.toFixed(5)}:${region.x},${region.y},${region.w},${region.h}`;
    if (o.field && o.fieldKey === key) return;
    const w = Math.max(1, Math.round(region.w * k));
    const h = Math.max(1, Math.round(region.h * k));
    const gl = this.gl;
    if (!o.field || o.field.w !== w || o.field.h !== h) {
      this.freeField(o);
      const F = formats(gl);
      o.field = { w, h, mask: texture(gl, w, h, F.rgba8), clip: null, sdf: target(gl, w, h, F.r16f), heightA: target(gl, w, h, F.r16f), heightB: target(gl, w, h, F.r16f) };
    }
    const f = o.field;
    const c = this.maskCanvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = (this.maskCtx ??= c.getContext('2d', { willReadFrequently: false }));
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
    // The clipping outline, rasterised into the same frame.
    if (o.clipPath) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(sx, 0, 0, sy, (this.art.w / 2 - region.x) * sx, (this.art.h / 2 - region.y) * sy);
      ctx.fill(o.clipPath, 'nonzero');
      if (!f.clip) f.clip = texture(gl, w, h, formats(gl).rgba8);
      gl.bindTexture(gl.TEXTURE_2D, f.clip);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
    } else if (f.clip) {
      gl.deleteTexture(f.clip);
      f.clip = null;
    }

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
      p = program(this.gl, MOVED_RECT_VS, EFFECT_FS(def.glsl));
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
      u_time: this.now() ?? 0,
      u_loopLength: this.timeline.loop ? this.timeline.duration : 0,
      u_bevelTex: this.heightSpec(o).bevel * kk,
      u_ambient: this.bg ? ambientOf(this.bg) : [0.1, 0.1, 0.1],
    };
    const b = o.item.frame ?? o.item.bbox!;
    u.u_bbox = [(b[0] + W / 2 - r.x) / r.w, (b[1] + H / 2 - r.y) / r.h, (b[2] + W / 2 - r.x) / r.w, (b[3] + H / 2 - r.y) / r.h];
    const t = this.now();
    const loopLength = this.timeline.loop ? this.timeline.duration : undefined;
    for (const def of o.item.effect.params) {
      const base = o.item.params[def.key] ?? def.default;
      const a = o.item.anim?.[def.key];
      const k = o.item.keys?.[def.key];
      const v = t === null ? base : k?.length ? keyedValue(k, t) : a ? animatedValue(base, a, t, loopLength) : base;
      u[`u_${def.key}`] = def.type === 'color' ? hexToRgb(String(v)) : Number(v);
    }
    const st = o.item.stroke;
    u.u_strokeW = st && st.opacity > 0 ? st.width : 0;
    u.u_strokeAlign = st?.align === 'center' ? 1 : st?.align === 'inside' ? 2 : 0;
    u.u_strokeOpacity = st?.opacity ?? 1;
    u.u_strokeColor = hexToRgb(st?.color ?? '#000000');
    u.u_opacity = Math.max(0, Math.min(1, this.opacityOf(o)));
    u.u_soften = Math.max(0, o.item.soften ?? 0);
    const dp = o.item.depth;
    u.u_sideDepth = dp && dp.amount > 0 ? dp.amount : 0;
    u.u_sideAngle = ((dp?.angle ?? 135) * Math.PI) / 180;
    u.u_sideShade = Math.max(0, Math.min(1, dp?.shade ?? 0.3));
    u.u_sideColor = hexToRgb(dp?.color ?? '#000000');
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

  /** Artboard point at the middle of the visible canvas. */
  viewCentre() {
    return this.toArt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
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
  private composite(k: number, rectOf: (r: Region) => [number, number, number, number], transparent: boolean, checker: boolean, fb: { fbo: WebGLFramebuffer | null; w: number; h: number; pxPerArt: number; guides: boolean; scissor?: [number, number, number, number] }, fieldK = k) {
    const gl = this.gl;
    // Artboard → clip space is a scale and offset per axis; motion maps compose with it.
    const [ax0, ayb, ax1, ayt] = rectOf({ x: 0, y: 0, w: this.art.w, h: this.art.h });
    const sx = (ax1 - ax0) / this.art.w;
    const sy = (ayb - ayt) / this.art.h;
    const toClip: Mat = [sx, 0, 0, sy, ax0 + (sx * this.art.w) / 2, ayt + (sy * this.art.h) / 2];
    const fromClip: Mat = [1 / sx, 0, 0, 1 / sy, -toClip[4] / sx, -toClip[5] / sy];
    const objs = fb.guides ? this.objs : this.objs.filter((o) => !o.item.guide);
    for (const o of objs) {
      this.buildField(o, fieldK);
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
      // Things moving off the artboard are cut at its edge, as in exports.
      if (fb.scissor) {
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(...fb.scissor);
      }
      for (const o of objs) {
        if (!o.field || !o.region) continue;
        const at = this.placed(o);
        if (at && at.opacity <= 0.002) continue;
        const xf = at ? compose(toClip, compose(at.m, fromClip)) : null;
        let rect = rectOf(o.region);
        if (xf) {
          // The moved quad's bounds, for what glass sees behind it.
          const cs = [applyMat(xf, rect[0], rect[1]), applyMat(xf, rect[2], rect[1]), applyMat(xf, rect[0], rect[3]), applyMat(xf, rect[2], rect[3])];
          rect = [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))];
        }
        // Glass and lenses see what's drawn so far.
        // (Blurring the copy draws to other targets: no scissor there.)
        if (fb.scissor) gl.disable(gl.SCISSOR_TEST);
        const bdu = o.item.effect.backdrop ? this.captureBackdrop(rect, fb, Number(o.item.params.blur ?? 0) * fb.pxPerArt) : null;
        if (fb.scissor) gl.enable(gl.SCISSOR_TEST);
        const p = this.effectProgram(o.item.effect);
        gl.useProgram(p.prog);
        const pic = o.item.effect.photo ? String(o.item.params.image ?? '') : '';
        const photo = pic ? this.photoTexture(pic) : null;
        const sp = o.item.effect.spine ? this.spineTexture(o) : null;
        bindTextures(gl, p, {
          ...(o.item.effect.spine ? { u_spine: sp?.tex ?? o.field.mask } : {}),
          u_mask: o.field.mask,
          u_sdf: o.field.sdf.tex,
          u_height: o.field.heightA.tex,
          u_clipMask: o.field.clip ?? o.field.mask,
          ...(o.item.effect.photo ? { u_photo: photo } : {}),
          ...(o.item.effect.backdrop ? { u_backdrop: bdu ? this.bd!.sharp : null, u_backdropBlur: bdu ? this.bdBlur : null } : {}),
        });
        const meta = imageAsset(pic);
        setUniforms(gl, p, {
          ...(o.item.effect.spine ? { u_spineN: sp?.n ?? 0 } : {}),
          ...this.effectUniforms(o),
          u_rect: rectOf(o.region),
          u_xf: xf ? [xf[0], xf[1], xf[2], xf[3]] : [1, 0, 0, 1],
          u_xfT: xf ? [xf[4], xf[5]] : [0, 0],
          ...(at ? { u_opacity: Math.max(0, Math.min(1, this.opacityOf(o) * at.opacity)) } : {}),
          u_hasClip: o.field.clip ? 1 : 0,
          ...(o.item.effect.photo ? { u_hasPhoto: photo ? 1 : 0, u_imgAspect: meta ? meta.w / meta.h : 1 } : {}),
          ...(o.item.effect.backdrop ? (bdu ?? { u_hasBackdrop: 0 }) : {}),
        });
        // Premultiplied blending; multiply and screen keep alpha "over" so transparent exports work.
        const b = o.item.blend ?? 'normal';
        if (b === 'multiply') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else if (b === 'screen') gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
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
    // Scissor box in device pixels, bottom-up.
    const sc: [number, number, number, number] = [Math.floor(ar.x * dpr), Math.floor((this.canvas.clientHeight - ar.y - ar.h) * dpr), Math.ceil(ar.w * dpr), Math.ceil(ar.h * dpr)];
    const paint = this.composite(k, rectOf, false, this.checker, { fbo: null, w: cw, h: ch, pxPerArt: z * dpr, guides: true, scissor: sc });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.043, 0.043, 0.051, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    paint();
  }

  /**
   * Render the artboard at `scale` × its size and return straight-alpha RGBA
   * rows top-to-bottom. Stills show the design at rest: no motion, materials
   * at time 0. Preview fields are rebuilt afterwards.
   */
  renderPixels(scale: number, transparent: boolean): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
    const s = this.exportFrames(scale, transparent);
    try {
      return s.frame(null);
    } finally {
      s.close();
    }
  }

  /**
   * Frames for an animation export: fields are built once at export density,
   * then each frame only redraws at its time on the clock. Call `close` when
   * done so the preview rebuilds its own fields.
   */
  exportFrames(scale: number, transparent: boolean) {
    const gl = this.gl;
    const max = Math.min(this.maxTexture, 8192);
    const W = Math.max(1, Math.min(Math.round(this.art.w * scale), max));
    const Hh = Math.max(1, Math.min(Math.round(this.art.h * scale), max));
    const k = W / this.art.w;
    const out = target(gl, W, Hh, formats(gl).rgba8);
    const { w: AW, h: AH } = this.art;
    const rectOf = (r: Region): [number, number, number, number] => [(r.x / AW) * 2 - 1, 1 - ((r.y + r.h) / AH) * 2, ((r.x + r.w) / AW) * 2 - 1, 1 - (r.y / AH) * 2];
    // Fields at up to 2 texels per artboard px: at 1:1 thin bars and hairlines
    // pick up half-pixel steps from the distance transform.
    const prepare = () => this.composite(k, rectOf, transparent, false, { fbo: out.fbo, w: W, h: Hh, pxPerArt: k, guides: false }, Math.max(k, Math.min(this.exportSupersample * k, this.exportSupersample)));
    let paint: () => void;
    try {
      paint = prepare();
    } catch (e) {
      freeTarget(gl, out);
      throw e;
    }
    let version = this.version;
    this.exporting++;
    const raw = new Uint8Array(W * Hh * 4);
    return {
      width: W,
      height: Hh,
      frame: (t: number | null): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } => {
        // Moving geometry swaps outlines between frames: rebuild just those fields.
        if (version !== this.version) {
          paint = prepare();
          version = this.version;
        }
        this.pinned = { t };
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
          gl.viewport(0, 0, W, Hh);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          paint();
          gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        } finally {
          this.pinned = null;
        }
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
      },
      close: () => {
        freeTarget(gl, out);
        this.exporting--;
        for (const o of this.objs) o.fieldKey = '';
        this.invalidate();
      },
    };
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
