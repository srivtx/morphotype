// The app side of the morpho CLI (scripts/morpho.mjs), on
// `await window.morphotype.agent()`: load a design, draw it at any times as
// one image (a filmstrip when there are several), draw a grid of variations,
// and check it. Everything returns text or one PNG, so a caller spends one
// image on what would otherwise be a dozen screenshots.
import { engine } from '../engine/client';
import { fromBase64 } from '../fonts/library';
import { effectById } from '../render/effects';
import { getRenderer, loadProjectFonts } from '../app/actions';
import { geometryFrames, holdLiveGeometry } from '../app/geoMotion';
import { unpackImages } from '../state/assets';
import { clock, timelineOf } from '../state/clock';
import { anyGeoAnim } from '../state/geoMotion';
import { migrate } from '../state/migrate';
import { isGroup, type Node, type Project } from '../state/model';
import { isStill } from '../state/motion';
import { replaceProject, store } from '../state/store';
import { loadedTemplates, loadTemplates } from '../state/templateCatalog';
import { buildScene } from '../state/tree';
import { catalog, findTemplate } from './catalog';
import { label, motionFindings, outside, presence, report, spread, structural, type Finding, type Pixels, diff } from './check';
import { describe, num } from './describe';
import { applyEdits } from './edit';

/** Geometry quality for output (the preview builds at 120), as exports use. */
const OUTPUT_QUALITY = 360;
const PREVIEW_QUALITY = 120;

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

async function until(ok: () => boolean, what: string, ms = 30_000) {
  const end = performance.now() + ms;
  while (!ok()) {
    if (performance.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** Open a project (a .morpho file's JSON or a Project) and wait until it's drawn. */
async function load(raw: unknown, quality = OUTPUT_QUALITY): Promise<{ ms: number }> {
  const t0 = performance.now();
  await until(() => store.get().ready, 'the app to start', 60_000);
  const p = migrate(raw);
  await loadProjectFonts((p.fonts ?? []).flatMap((f) => (f.data ? [{ id: f.id, name: f.name, bytes: fromBase64(f.data) }] : [])));
  unpackImages(p.images);
  replaceProject({ ...p, fonts: [], images: undefined });
  store.set({ selection: [], toasts: [] });
  // Let the app's build loop ask for its (preview) build first: the engine
  // answers every waiting caller with the newest result, so ours wins.
  await nextFrame();
  await nextFrame();
  const build = await engine.build(buildScene(store.get().project, quality).doc);
  store.set({ build });
  await until(() => store.get().build === build, 'the engine');
  await nextFrame();
  await nextFrame();
  return { ms: Math.round(performance.now() - t0) };
}

async function template(name: string): Promise<Project> {
  return findTemplate(await loadTemplates(), name).make();
}

/** Run `fn` with fields at preview density: sheets and checks don't need 2× supersampling. */
async function draft<T>(fn: () => Promise<T>): Promise<T> {
  const r = getRenderer();
  const was = r?.exportSupersample;
  if (r) r.exportSupersample = 1;
  try {
    return await fn();
  } finally {
    if (r && was !== undefined) r.exportSupersample = was;
  }
}

/** The current design at each time (null: at rest, as a still export draws it). */
async function frames(times: (number | null)[], scale: number, transparent = false): Promise<Pixels[]> {
  const r = getRenderer();
  if (!r) throw new Error('The GPU preview isn’t available (WebGL2 failed to start).');
  const p = store.get().project;
  const moving = times.some((t) => t !== null) ? await geometryFrames(p, times.map((t) => t ?? 0), OUTPUT_QUALITY) : null;
  return holdLiveGeometry(async (show) => {
    const f = r.exportFrames(scale, transparent);
    try {
      return times.map((t, i) => {
        show(t === null ? null : (moving?.[i] ?? null));
        const img = f.frame(t);
        return { data: img.data, width: img.width, height: img.height };
      });
    } finally {
      f.close();
    }
  });
}

async function png(c: OffscreenCanvas): Promise<string> {
  const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function toCanvas(p: Pixels): OffscreenCanvas {
  const c = new OffscreenCanvas(p.width, p.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return c;
}

/** Cells in a grid with a caption under each, on a dark sheet. */
async function sheet(cells: { img: Pixels; label: string }[], cols: number): Promise<{ png: string; width: number; height: number }> {
  const w = Math.max(...cells.map((c) => c.img.width)), h = Math.max(...cells.map((c) => c.img.height));
  const gap = 8, cap = cells.some((c) => c.label) ? 22 : 0;
  const rows = Math.ceil(cells.length / cols);
  const W = cols * w + (cols + 1) * gap, H = rows * (h + cap) + (rows + 1) * gap;
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#161616';
  g.fillRect(0, 0, W, H);
  g.font = '13px ui-monospace, Menlo, monospace';
  g.textBaseline = 'middle';
  cells.forEach((cell, i) => {
    const x = gap + (i % cols) * (w + gap), y = gap + Math.floor(i / cols) * (h + cap + gap);
    g.drawImage(toCanvas(cell.img), x, y);
    if (!cap) return;
    g.fillStyle = '#d8d8d8';
    let text = cell.label;
    while (text.length > 4 && g.measureText(text).width > w - 8) text = text.slice(0, -2) + '…';
    g.fillText(text, x + 4, y + h + cap / 2);
  });
  return { png: await png(c), width: W, height: H };
}

const gridCols = (n: number) => (n <= 3 ? n : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 6);

/** Output scale that keeps each cell's long side near `px`. */
const fit = (p: Project, px: number) => Math.min(4, px / Math.max(p.canvas.width, p.canvas.height));

interface RenderOpts {
  /** Seconds on the clock; null (or absent) draws the design at rest. */
  at?: (number | null)[];
  scale?: number;
  /** Long side of each cell in px, when no scale is given (sheets default to 360). */
  size?: number;
  transparent?: boolean;
  cols?: number;
}

async function render(o: RenderOpts = {}) {
  const p = store.get().project;
  const at = o.at?.length ? o.at : [null];
  const scale = o.scale ?? (at.length > 1 ? fit(p, o.size ?? 360) : o.size ? fit(p, o.size) : 1);
  const imgs = await frames(at, scale, o.transparent);
  if (imgs.length === 1) return { png: await png(toCanvas(imgs[0])), width: imgs[0].width, height: imgs[0].height };
  return sheet(
    imgs.map((img, i) => ({ img, label: at[i] === null ? 'rest' : `${num(at[i]!)}s` })),
    o.cols ?? Math.min(at.length, 6),
  );
}

/** One image of `variants`, each a list of edits on the current design, at one time. */
async function vary(variants: { label: string; edits: string[] }[], o: { at?: number | null; size?: number; cols?: number } = {}) {
  return draft(() => varyCells(variants, o));
}

async function varyCells(variants: { label: string; edits: string[] }[], o: { at?: number | null; size?: number; cols?: number }) {
  const base = structuredClone(store.get().project);
  const cells: { img: Pixels; label: string }[] = [];
  try {
    for (const v of variants) {
      // Cells are small: the preview's outlines are fine and much quicker.
      await load(applyEdits(base, v.edits).project, PREVIEW_QUALITY);
      const [img] = await frames([o.at ?? null], fit(base, o.size ?? 360));
      cells.push({ img, label: v.label });
    }
  } finally {
    await load(base);
  }
  return sheet(cells, o.cols ?? gridCols(cells.length));
}

function shrink(p: Pixels, side: number): Pixels {
  const k = Math.min(1, side / Math.max(p.width, p.height));
  if (k === 1) return p;
  const w = Math.max(1, Math.round(p.width * k)), h = Math.max(1, Math.round(p.height * k));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.drawImage(toCanvas(p), 0, 0, w, h);
  return { data: g.getImageData(0, 0, w, h).data, width: w, height: h };
}

/**
 * The design against a reference picture (PNG or JPEG, base64), drawn at the
 * reference's size: scores in words, and one image of reference, render and
 * where they differ.
 */
async function compare(ref: string, o: { at?: number | null; size?: number } = {}) {
  const bmp = await createImageBitmap(await (await fetch(`data:image/*;base64,${ref}`)).blob());
  const p = store.get().project;
  const [img] = await frames([o.at ?? null], bmp.width / p.canvas.width);
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0, img.width, img.height);
  const want: Pixels = { data: g.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height };
  const heat = new Uint8ClampedArray(img.data.length);
  let clear = 0;
  for (let i = 0; i < heat.length; i += 4) {
    const d = Math.abs(img.data[i] - want.data[i]) + Math.abs(img.data[i + 1] - want.data[i + 1]) + Math.abs(img.data[i + 2] - want.data[i + 2]);
    if (d > 60) clear++;
    heat[i] = heat[i + 1] = heat[i + 2] = Math.min(255, d * 2);
    heat[i + 3] = 255;
  }
  // Layout: the same comparison on 24-px-wide thumbnails, where only big shapes and colour areas survive.
  const layout = diff(shrink(img, 24), shrink(want, 24));
  const aspect = bmp.width / bmp.height / (p.canvas.width / p.canvas.height);
  const side = o.size ?? 480;
  const out = await sheet(
    [
      { img: shrink(want, side), label: 'reference' },
      { img: shrink(img, side), label: o.at == null ? 'design' : `design at ${num(o.at)}s` },
      { img: shrink({ data: heat, width: img.width, height: img.height }, side), label: 'difference' },
    ],
    3,
  );
  const lines = [
    `colour difference ${num(diff(img, want))}/255 per channel · ${num((clear / (heat.length / 4)) * 100)}% of pixels clearly differ · layout difference ${num(layout)}/255 (big shapes and colour areas)`,
    ...(Math.abs(aspect - 1) > 0.02 ? [`! the reference is ${bmp.width}×${bmp.height}, a different shape from the ${p.canvas.width}×${p.canvas.height} canvas: it was stretched to fit`] : []),
  ];
  return { ...out, text: lines.join('\n') };
}

function moves(p: Project): boolean {
  let any = anyGeoAnim(p.layers);
  const walk = (ns: Node[]) =>
    ns.forEach((n) => {
      if (!isStill(n.motion) || Object.keys(n.style.animate ?? {}).length || effectById(n.style.effect).animated?.(n.style.params)) any = true;
      if (isGroup(n)) walk(n.children);
    });
  walk(p.layers);
  return any;
}

/** Leaf layers (and merged groups) that draw something of their own. */
function drawn(nodes: Node[], out: Node[] = []): Node[] {
  for (const n of nodes) {
    if (!n.visible) continue;
    if (isGroup(n) && !n.merge) drawn(n.children, out);
    else if (isGroup(n) || !n.guide) out.push(n);
  }
  return out;
}

function hide(p: Project, id: string): Project {
  const q = structuredClone(p);
  const go = (ns: Node[]) =>
    ns.forEach((n) => {
      if (n.id === id) n.visible = false;
      else if (isGroup(n)) go(n.children);
    });
  go(q.layers);
  return q;
}

/** Every check, as a short report. `layers` caps how many layers get the (slower) visibility check. */
async function check(o: { size?: number; layers?: number } = {}): Promise<string> {
  return draft(() => checkAll(o));
}

async function checkAll(o: { size?: number; layers?: number }): Promise<string> {
  const p = structuredClone(store.get().project);
  const findings: Finding[] = structural(p, store.get().build);
  const scale = fit(p, o.size ?? 360);
  const tl = timelineOf(p);
  try {
    // Motion: pairs of frames one video frame apart, across the clock and over the seam.
    if (moves(p)) {
      const dt = 1 / 30, n = 12, D = tl.duration;
      const starts = Array.from({ length: n }, (_, i) => ((i + 0.5) * D) / n).filter((t) => t + dt <= D);
      const at = starts.flatMap((t) => [t, t + dt]);
      if (tl.loop) at.push(D - dt, 0);
      const imgs = await frames(at, scale);
      const steps = starts.map((t, i) => ({ t, d: diff(imgs[2 * i], imgs[2 * i + 1]) }));
      findings.push(...motionFindings(steps, tl.loop ? diff(imgs[imgs.length - 2], imgs[imgs.length - 1]) : null, true));
    } else findings.push({ level: 'info', text: 'still design: nothing moves' });
    // What shows: the design against itself with each layer hidden, at the same quality.
    await load(p, PREVIEW_QUALITY);
    const [still] = await frames([null], scale);
    if (spread(still) < 2) findings.push({ level: 'warn', text: 'the design looks empty: one flat colour' });
    const all = drawn(p.layers);
    const cap = o.layers ?? 16;
    const picked = [...all.filter((n) => !isGroup(n) && n.content.type === 'text'), ...all.filter((n) => isGroup(n) || n.content.type !== 'text')].slice(0, cap);
    const boxes = new Map([...(store.get().build?.layers ?? []), ...(store.get().build?.renders ?? [])].map((l) => [l.id, l.bbox]));
    for (const n of picked) {
      const b = boxes.get(n.id);
      if (b && outside(b, p.canvas.width, p.canvas.height).share > 0.995) continue;
      await load(hide(p, n.id), PREVIEW_QUALITY);
      const [without] = await frames([null], scale);
      const s = presence(still, without);
      // Unseen: next to nothing changes, for its size (tiny marks and hairlines count too).
      const area = b ? Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) * scale * scale : 0;
      if (s.px < Math.max(1, Math.min(area * 0.02, 40))) findings.push({ level: 'warn', text: `${label(n)}: can't be seen at rest (covered, transparent, off the canvas or still to enter)` });
      else if (!isGroup(n) && n.content.type === 'text' && s.contrast < 2) findings.push({ level: 'warn', text: `${label(n)}: low contrast, ${num(s.contrast)}:1 against what's behind it` });
    }
    findings.push({ level: 'info', text: `looked at ${picked.length} of ${all.length} layers${picked.length < all.length ? ' (raise --layers to see the rest)' : ''}` });
  } finally {
    await load(p);
  }
  return report(`"${p.name}" ${p.canvas.width}×${p.canvas.height}${moves(p) ? `, ${num(tl.duration)}s${tl.loop ? ' loop' : ''}` : ''}`, findings);
}

/**
 * Hold the editor's live preview still while the agent works: its animation
 * loop and moving outlines compete for the main thread and the engine, and
 * make every step several times slower.
 */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const playing = clock.playing;
  clock.pause(timelineOf(store.get().project));
  try {
    return await holdLiveGeometry(() => fn());
  } finally {
    if (playing) clock.play(timelineOf(store.get().project));
  }
}

export const agent = {
  quietly,
  load: (raw: unknown) => load(raw),
  template,
  async open(name: string) {
    return load(await template(name));
  },
  project: () => store.get().project,
  describe: () => describe(store.get().project),
  catalog: async (q = '') => catalog(q, loadedTemplates() ?? (await loadTemplates())),
  async edit(assignments: string[]) {
    const { project, changes } = applyEdits(store.get().project, assignments);
    await load(project);
    return changes;
  },
  render,
  vary,
  check,
  compare,
};
