// Compare the artwork with its reference picture, and fit settings to it.
//
// The reference is the design's "Reference only" photo layer. We render the
// artwork without it (as exported), draw the reference where it sits, and
// measure, inside the reference's rectangle: the mean colour difference
// (0–255) and the share of pixels that are clearly off (Δ > 60). Fit nudges
// one numeric setting of a layer up and down, keeping each step that brings
// the picture closer, with ever finer steps (a coordinate search), all as a
// single undo step.
import { imageElement } from '../state/assets';
import { isGroup, type ShapeLayer } from '../state/model';
import { edit, store, toast } from '../state/store';
import { allLayers, findNode } from '../state/tree';
import { getRenderer } from './actions';

export interface CompareResult {
  /** Mean absolute colour difference per channel, 0–255. */
  diff: number;
  /** Percent of pixels off by more than 60 (sum of channel differences). */
  off: number;
  /** 100 − off: how much of the picture already matches. */
  match: number;
  /** Heat map of the differences over the reference area (data URL). */
  heat: string;
}

/** The design's reference picture layer, if it has one. */
export function referenceLayer(): ShapeLayer | null {
  const l = allLayers(store.get().project.layers).find((x) => x.guide && x.visible !== false && x.style.effect === 'photo' && x.style.params.image);
  return l ?? null;
}

/** The reference's rectangle in artboard pixels (origin top-left), from the last build. */
function referenceRect(ref: ShapeLayer) {
  const { width: W, height: H } = store.get().project.canvas;
  const b = store.get().build?.layers.find((x) => x.id === ref.id)?.bbox;
  if (!b) return null;
  return { x: b[0] + W / 2, y: b[1] + H / 2, w: b[2] - b[0], h: b[3] - b[1] };
}

/** Wait until the engine has built the current project (or give up after `ms`). */
function nextBuild(before: unknown, ms = 8000) {
  return new Promise<void>((done) => {
    if (store.get().build !== before) return done();
    const t = setTimeout(() => (stop(), done()), ms);
    const stop = store.subscribe(() => {
      if (store.get().build !== before) {
        clearTimeout(t);
        stop();
        // One frame for the renderer to take the new scene.
        requestAnimationFrame(() => done());
      }
    });
  });
}

interface Frame {
  ours: Uint8ClampedArray;
  theirs: Uint8ClampedArray;
  w: number;
  h: number;
}

/** Render the artwork and the reference into the same small frame over `rect` (artboard px). */
function capture(ref: ShapeLayer, scale: number, rect: { x: number; y: number; w: number; h: number }): Frame | null {
  const r = getRenderer();
  const img = imageElement(String(ref.style.params.image));
  if (!r || !img || !img.complete) return null;
  const px = r.renderPixels(scale, false);
  const k = px.width / store.get().project.canvas.width;
  const w = Math.max(1, Math.round(rect.w * k));
  const h = Math.max(1, Math.round(rect.h * k));
  const c = new OffscreenCanvas(px.width, px.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
  const ours = g.getImageData(Math.round(rect.x * k), Math.round(rect.y * k), w, h).data;
  const rc = new OffscreenCanvas(w, h);
  const rg = rc.getContext('2d', { willReadFrequently: true })!;
  const full = referenceRect(ref)!;
  // The reference picture fills its own rectangle; crop to `rect` within it.
  rg.drawImage(img, (full.x - rect.x) * k, (full.y - rect.y) * k, full.w * k, full.h * k);
  return { ours, theirs: rg.getImageData(0, 0, w, h).data, w, h };
}

function score(f: Frame) {
  let sum = 0;
  let off = 0;
  const n = f.w * f.h;
  for (let i = 0; i < f.ours.length; i += 4) {
    const d = Math.abs(f.ours[i] - f.theirs[i]) + Math.abs(f.ours[i + 1] - f.theirs[i + 1]) + Math.abs(f.ours[i + 2] - f.theirs[i + 2]);
    sum += d;
    if (d > 60) off++;
  }
  return { diff: sum / 3 / n, off: (off / n) * 100 };
}

/** Compare the whole reference area. `scale` trades speed for detail. */
export async function compareWithReference(scale = 0.5): Promise<CompareResult | null> {
  const ref = referenceLayer();
  if (!ref) return null;
  const rect = referenceRect(ref);
  if (!rect) return null;
  const f = capture(ref, scale, rect);
  if (!f) return null;
  const { diff, off } = score(f);
  // Heat map: the artwork in grey, differences in hot red on top.
  const heat = new ImageData(f.w, f.h);
  for (let i = 0; i < f.ours.length; i += 4) {
    const d = Math.abs(f.ours[i] - f.theirs[i]) + Math.abs(f.ours[i + 1] - f.theirs[i + 1]) + Math.abs(f.ours[i + 2] - f.theirs[i + 2]);
    const grey = (f.ours[i] * 0.3 + f.ours[i + 1] * 0.59 + f.ours[i + 2] * 0.11) * 0.35;
    const t = Math.min(1, d / 120);
    heat.data[i] = grey + (255 - grey) * t;
    heat.data[i + 1] = grey * (1 - t) + 60 * t;
    heat.data[i + 2] = grey * (1 - t) + 40 * t;
    heat.data[i + 3] = 255;
  }
  const c = document.createElement('canvas');
  c.width = f.w;
  c.height = f.h;
  c.getContext('2d')!.putImageData(heat, 0, 0);
  return { diff, off, match: 100 - off, heat: c.toDataURL('image/png') };
}

/** A numeric setting of a layer that Fit can tune. */
export interface Tunable {
  key: string;
  label: string;
  get: (l: ShapeLayer) => number;
  set: (l: ShapeLayer, v: number) => void;
  /** Smallest meaningful change, and how far a search may roam. */
  step: number;
  span: number;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** "gradStart" → "Grad start". */
const pretty = (k: string) => k.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`);

/** Every numeric setting of a layer: position, size, rotation, its content's numbers and its style's numbers. */
export function tunables(n: ShapeLayer): Tunable[] {
  const out: Tunable[] = [
    { key: 'x', label: 'Position X', get: (m) => m.x, set: (m, v) => (m.x = v), step: 0.25, span: 60 },
    { key: 'y', label: 'Position Y', get: (m) => m.y, set: (m, v) => (m.y = v), step: 0.25, span: 60 },
    { key: 'rotation', label: 'Rotation', get: (m) => m.rotation ?? 0, set: (m, v) => (m.rotation = v), step: 0.1, span: 20 },
    { key: 'scale', label: 'Scale', get: (m) => m.scale ?? 1, set: (m, v) => (m.scale = v), step: 0.002, span: 0.3 },
  ];
  // Content numbers, one level into nested settings (squiggle, dash…).
  const walk = (obj: Record<string, unknown>, path: string[], label: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'type' || k === 'kind') continue;
      if (num(v)) {
        const p = [...path, k];
        const scaleLike = Math.abs(v) > 2;
        out.push({
          key: `content.${p.join('.')}`,
          label: `${label}${pretty(k)}`,
          get: (m) => p.reduce<unknown>((o, kk) => (o as Record<string, unknown>)?.[kk], m.content) as number,
          set: (m, val) => {
            const target = p.slice(0, -1).reduce<Record<string, unknown>>((o, kk) => o[kk] as Record<string, unknown>, m.content as unknown as Record<string, unknown>);
            target[p.at(-1)!] = val;
          },
          step: scaleLike ? Math.max(0.05, Math.abs(v) * 0.002) : 0.002,
          span: scaleLike ? Math.max(4, Math.abs(v) * 0.3) : 0.3,
        });
      } else if (v && typeof v === 'object' && !Array.isArray(v) && path.length < 1) walk(v as Record<string, unknown>, [...path, k], `${pretty(k)} · `);
    }
  };
  walk(n.content as unknown as Record<string, unknown>, [], '');
  for (const [k, v] of Object.entries(n.style.params)) {
    if (!num(v)) continue;
    out.push({
      key: `style.${k}`,
      label: `${n.style.effect === 'flat' ? 'Fill' : pretty(n.style.effect)} · ${pretty(k)}`,
      get: (m) => Number(m.style.params[k]),
      set: (m, val) => (m.style.params[k] = val),
      step: Math.max(0.002, Math.abs(v) * 0.002),
      span: Math.max(0.3, Math.abs(v) * 0.3),
    });
  }
  return out;
}

/**
 * Tune `t` on layer `id` until the artwork matches the reference best around
 * that layer. Returns the mean difference before and after.
 */
export async function fitToReference(id: string, t: Tunable, onStep?: (v: number, diff: number) => void): Promise<{ before: number; after: number; value: number } | null> {
  const ref = referenceLayer();
  const node = findNode(store.get().project.layers, id);
  if (!ref || !node || isGroup(node)) return null;
  const full = referenceRect(ref);
  const lb = store.get().build?.layers.find((x) => x.id === id)?.bbox;
  if (!full || !lb) return null;
  const { width: W, height: H } = store.get().project.canvas;
  // Measure around the layer (with a margin), inside the reference.
  const m = Math.max(lb[2] - lb[0], lb[3] - lb[1]) * 0.15 + 8;
  const x0 = Math.max(full.x, lb[0] + W / 2 - m);
  const y0 = Math.max(full.y, lb[1] + H / 2 - m);
  const x1 = Math.min(full.x + full.w, lb[2] + W / 2 + m);
  const y1 = Math.min(full.y + full.h, lb[3] + H / 2 + m);
  if (x1 <= x0 || y1 <= y0) return null;
  const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  // Enough pixels to see a ¼ px change, few enough to stay quick.
  const scale = Math.min(1, Math.max(0.35, 500 / Math.max(rect.w, rect.h)));
  const key = `fit:${id}:${t.key}`;
  const measure = async (v: number) => {
    const before = store.get().build;
    edit((p) => {
      const n = findNode(p.layers, id);
      if (n && !isGroup(n)) t.set(n, v);
    }, key);
    await nextBuild(before);
    const f = capture(ref, scale, rect);
    return f ? score(f).diff : Infinity;
  };
  const start = t.get(node);
  let best = start;
  let bestD = await measure(start);
  const first = bestD;
  let step = t.span / 4;
  // Coordinate search: try both sides, keep what helps, halve the step.
  while (step >= t.step) {
    let moved = false;
    for (const dir of [1, -1]) {
      const v = best + dir * step;
      if (Math.abs(v - start) > t.span) continue;
      const d = await measure(v);
      onStep?.(v, d);
      if (d < bestD - 1e-4) {
        best = v;
        bestD = d;
        moved = true;
        break;
      }
    }
    if (!moved) step /= 2;
  }
  await measure(best);
  return { before: first, after: bestD, value: best };
}

/** Fit with a toast for the outcome. */
export async function fitWithFeedback(id: string, t: Tunable) {
  const r = await fitToReference(id, t);
  if (!r) return toast('Add a reference picture (File › Place reference) that overlaps this layer first.', 'error');
  const better = r.before - r.after;
  toast(better > 0.005 ? `${t.label}: ${r.value.toFixed(3)} — difference ${r.before.toFixed(2)} → ${r.after.toFixed(2)}` : `${t.label} already matches best here.`);
}
