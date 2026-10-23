// The app side of the morpho CLI (scripts/morpho.mjs), on
// `await window.morphotype.agent()`: load a design, draw it at any times as
// one image (a filmstrip when there are several), draw a grid of variations,
// and check it. Everything returns text or one PNG, so a caller spends one
// image on what would otherwise be a dozen screenshots.
import { engine } from '../engine/client';
import type { Box } from '../engine/types';
import { fontId, fromBase64 } from '../fonts/library';
import { effectById } from '../render/effects';
import { getRenderer, loadProjectFonts, placeReference } from '../app/actions';
import { fitToReference, tunables, type Tunable } from '../app/compare';
import { geometryFrames, holdLiveGeometry } from '../app/geoMotion';
import { addImage, encodeImage, imageElement, packImages, unpackImages } from '../state/assets';
import { clock, timelineOf } from '../state/clock';
import { anyGeoAnim } from '../state/geoMotion';
import { migrate } from '../state/migrate';
import { isGroup, style, symbolLayer, type Node, type Project, type ShapeLayer } from '../state/model';
import { isStill } from '../state/motion';
import { replaceProject, store } from '../state/store';
import { loadedTemplates, loadTemplates } from '../state/templateCatalog';
import { buildScene } from '../state/tree';
import { catalog, findTemplate } from './catalog';
import { label, motionFindings, outside, presence, report, spread, structural, type Finding, type Pixels, diff } from './check';
import { describe, num } from './describe';
import { applyEdits, findNode } from './edit';
import { boxTable, itemsOf, layoutFindings, lookFindings } from './layout';

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
  // Embedded fonts stay in the project (the editor's own Open leaves them out), so reloads and saves keep them.
  replaceProject({ ...p, images: undefined });
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
    // Motion: runs of three frames one video frame apart, across the clock and around the seam.
    if (moves(p)) {
      const dt = 1 / 30, n = 12, D = tl.duration;
      const starts = Array.from({ length: n }, (_, i) => ((i + 0.5) * D) / n).filter((t) => t + 2 * dt <= D);
      const at = starts.flatMap((t) => [t, t + dt, t + 2 * dt]);
      if (tl.loop) at.push(D - 2 * dt, D - dt, 0, dt);
      const imgs = await frames(at, scale);
      const runs = starts.map((t, i) => ({ t: t + dt, a: diff(imgs[3 * i], imgs[3 * i + 1]), b: diff(imgs[3 * i + 1], imgs[3 * i + 2]) }));
      const k = starts.length * 3;
      const seam = tl.loop ? { a: diff(imgs[k], imgs[k + 1]), b: diff(imgs[k + 1], imgs[k + 2]), c: diff(imgs[k + 2], imgs[k + 3]) } : null;
      findings.push(...motionFindings(runs, seam, true));
    } else findings.push({ level: 'info', text: 'still design: nothing moves' });
    // What shows: the design against itself with each layer hidden, at the same quality.
    await load(p, PREVIEW_QUALITY);
    const [still] = await frames([null], scale);
    if (spread(still) < 2) findings.push({ level: 'warn', text: 'the design looks empty: one flat colour' });
    findings.push(...layoutFindings(p, itemsOf(p, store.get().build)));
    await load({ ...p, layers: [] }, PREVIEW_QUALITY);
    const [bare] = await frames([null], scale);
    findings.push(...lookFindings(still, bare));
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

/** The current design as a file would save it: imported fonts and pictures packed in. */
function saved(extraFonts: Project['fonts'] = []): Project {
  const p = structuredClone(store.get().project);
  const fonts = new Map([...(p.fonts ?? []), ...extraFonts].map((f) => [f.id, f]));
  p.fonts = [...fonts.values()];
  const images = packImages(p);
  if (images.length) p.images = images;
  return p;
}

/** Embed a font file (base64) in the design; returns its id for content.font. */
async function importFont(b64: string) {
  const bytes = fromBase64(b64);
  const id = await fontId(bytes);
  await loadProjectFonts([{ id, bytes }]);
  const name = store.get().fonts.find((f) => f.id === id)?.name ?? id;
  return { project: saved([{ id, name, data: b64 }]), change: `embedded font "${name}" as ${id} (use: --font ${id})` };
}

async function decode(b64: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(`data:image/*;base64,${b64}`)).blob());
}

/** A picture (base64) as a Photo-filled rectangle, or inside an existing layer. */
async function importImage(b64: string, name: string, target?: string) {
  const bmp = await decode(b64);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  const enc = encodeImage(c as unknown as HTMLCanvasElement, !/\.(png|webp|svg)$/i.test(name));
  const id = addImage(enc.data, enc.w, enc.h, name);
  let change: string;
  if (target) {
    // The picture isn't a listed setting of the Photo material, so it's set here rather than through an edit.
    const project = structuredClone(store.get().project);
    const n = findNode(project, target);
    const was = n.style.effect;
    n.style = { ...style('photo', { image: id }), stroke: n.style.stroke, depth: n.style.depth, opacity: n.style.opacity };
    await load(project);
    change = `"${n.name ?? n.id}": material ${was} → photo, filled with a ${enc.w}×${enc.h} picture`;
  } else {
    const p = store.get().project;
    const side = Math.min(p.canvas.width, p.canvas.height) * 0.7;
    const l = symbolLayer('roundRect', side, { name: name.replace(/\.[a-z]+$/i, ''), style: style('photo', { image: id }) }, { radius: 0, aspect: enc.w / enc.h });
    await load({ ...p, layers: [...p.layers, l] });
    change = `added "${l.name}" #${l.id}: a ${enc.w}×${enc.h} picture in a rectangle (shape roundRect, material photo)`;
  }
  return { project: saved(), change };
}

const EDGES: Record<string, { axis: 0 | 1; at: (b: Box) => number }> = {
  left: { axis: 0, at: (b) => b[0] },
  right: { axis: 0, at: (b) => b[2] },
  centre: { axis: 0, at: (b) => (b[0] + b[2]) / 2 },
  top: { axis: 1, at: (b) => b[1] },
  bottom: { axis: 1, at: (b) => b[3] },
  middle: { axis: 1, at: (b) => (b[1] + b[3]) / 2 },
};

/**
 * Line layers up by what they draw (not their anchors): each edge of `edges`
 * (left, right, centre, top, bottom, middle) of each target meets the same
 * edge of `to` (the canvas, or another layer).
 */
async function align(targets: string[], to: string, edges: string[]) {
  const p = store.get().project;
  const { width: W, height: H } = p.canvas;
  const boxOf = (id: string) => store.get().build?.layers.find((l) => l.id === id)?.bbox ?? null;
  const ref = to === 'canvas' ? ([-W / 2, -H / 2, W / 2, H / 2] as Box) : boxOf(findNode(p, to).id);
  if (!ref) throw new Error(`${to} has no outline to align to`);
  const edits: string[] = [];
  for (const t of targets) {
    const n = findNode(p, t);
    if (isGroup(n)) throw new Error(`align moves layers; ${n.name ?? n.id} is a group (align its layers)`);
    const b = boxOf(n.id);
    if (!b) throw new Error(`${n.name ?? n.id} has no outline to align`);
    const move = [0, 0];
    for (const e of edges) {
      const E = EDGES[e === 'center' ? 'centre' : e];
      if (!E) throw new Error(`align edges are ${Object.keys(EDGES).join(', ')}; not "${e}"`);
      move[E.axis] = E.at(ref) - E.at(b);
    }
    const id = JSON.stringify('#' + n.id);
    if (Math.abs(move[0]) > 0.01) edits.push(`${id}.x=${+(n.x + move[0]).toFixed(2)}`);
    if (Math.abs(move[1]) > 0.01) edits.push(`${id}.y=${+(n.y + move[1]).toFixed(2)}`);
  }
  const { project, changes } = applyEdits(p, edits);
  await load(project);
  return { project: saved(), change: changes.length ? changes.join('\n') : 'already aligned' };
}

/** Every layer's box and the layout notes, in words. */
async function layout(): Promise<string> {
  const p = store.get().project;
  const items = itemsOf(p, store.get().build);
  const notes = layoutFindings(p, items);
  return [boxTable(p, items), ...notes.map((f) => `${f.level === 'warn' ? '!' : '·'} ${f.text}`)].join('\n');
}

/**
 * A run of video frames as PNGs (base64): `count` from frame `from`, at
 * `fps`. A looping clock leaves out its last frame (it's the first again).
 */
async function frameBatch(o: { fps: number; from: number; count: number; scale?: number; size?: number }) {
  const p = store.get().project;
  const tl = timelineOf(p);
  const total = Math.max(1, Math.round(tl.duration * o.fps)) + (tl.loop ? 0 : 1);
  const times = Array.from({ length: Math.max(0, Math.min(o.count, total - o.from)) }, (_, i) => Math.min((o.from + i) / o.fps, tl.duration));
  const scale = o.scale ?? (o.size ? fit(p, o.size) : 1);
  const imgs = times.length ? await frames(times, scale) : [];
  const out: string[] = [];
  for (const img of imgs) out.push(await png(toCanvas(img)));
  return { frames: out, total, duration: tl.duration, loop: tl.loop, width: imgs[0]?.width ?? 0, height: imgs[0]?.height ?? 0 };
}

/** Where `Layer.key` lands among a layer's tunable settings. */
function tunable(n: ShapeLayer, key: string): Tunable {
  const all = tunables(n);
  const t = all.find((x) => x.key === key) ?? all.find((x) => x.key === `content.${key}`) ?? all.find((x) => x.key === `style.${key}`) ?? all.find((x) => x.key.endsWith(`.${key}`));
  if (!t) throw new Error(`fit can't tune ${n.name ?? n.id}.${key}. Numbers it can: ${all.map((x) => x.key.replace(/^(content|style)\./, '')).join(', ')}`);
  return t;
}

/**
 * Tune settings until the design matches a reference picture: each
 * `Layer.setting` in turn, searching around its value. Returns the design
 * without the reference, and before → after for each.
 */
async function fitTo(ref: string, targets: string[]) {
  const bmp = await decode(ref);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  placeReference(g.getImageData(0, 0, bmp.width, bmp.height), 'reference');
  const refLayer = store.get().project.layers[0];
  await until(() => !!imageElement(String(refLayer.style.params.image))?.complete && !!store.get().build?.layers.some((l) => l.id === refLayer.id && l.bbox), 'the reference picture');
  const lines: string[] = [];
  for (const target of targets) {
    const dot = target.lastIndexOf('.');
    if (dot < 0) throw new Error(`fit takes Layer.setting, got "${target}"`);
    const n = findNode(store.get().project, target.slice(0, dot).replace(/^"|"$/g, ''));
    if (isGroup(n)) throw new Error(`fit tunes layers, and ${n.name ?? n.id} is a group`);
    const t = tunable(n, target.slice(dot + 1));
    const r = await fitToReference(n.id, t);
    if (!r) throw new Error(`${n.name ?? n.id} doesn't overlap the reference`);
    lines.push(`${n.name ?? '#' + n.id} ${t.key}: ${num(t.get(n))} → ${num(r.value)} (difference ${num(r.before)} → ${num(r.after)})`);
  }
  const p = store.get().project;
  await load({ ...p, layers: p.layers.filter((l) => l.id !== refLayer.id) });
  return { project: saved(), text: lines.join('\n') };
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
  importFont,
  importImage,
  fit: fitTo,
  frameBatch,
  layout,
  align,
};
