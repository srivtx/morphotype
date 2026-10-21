import { engine } from '../engine/client';
import type { Box, Content, ModEntry } from '../engine/types';
import { fromBase64, importFontBytes, registerCssFont, toBase64, type FontEntry } from '../fonts/library';
import { platform } from '../platform';
import { ambientOf, backgroundCss as bgCss } from '../render/background';
import { addImage, encodeImage, imageAsset, packImages, unpackImages } from '../state/assets';
import { luminance } from '../render/palette';
import { defaultParams, effectById, type Preset } from '../render/effects';
import type { Renderer } from '../render/renderer';
import { parsePath, serializePath, type Node as GNode } from '../state/geometry';
import { brushById } from '../state/brushes';
import { migrate } from '../state/migrate';
import { clock, timelineOf } from '../state/clock';
import { isStill, type Motion } from '../state/motion';
import { anyGeoAnim } from '../state/geoMotion';
import { geometryFrames, holdLiveGeometry } from './geoMotion';
import { group, isGroup, lineLayer, newModifier, pathLayer, style, symbolLayer, textLayer, uid, type Background, type Group, type Node, type Project, type ShapeLayer, type Style } from '../state/model';
import { iconGridLayers } from '../state/icon';
import { commitEdit, edit, replaceProject, select, store, toast, undo } from '../state/store';
import { allLayers, ancestors, buildScene, childrenOf, find, findNode, layersOf, removeNodes, topmost, walk } from '../state/tree';

export const FONT_FILTER = { name: 'Fonts', extensions: ['ttf', 'otf', 'ttc', 'woff'] };
export const IMAGE_FILTER = { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] };
export const PROJECT_FILTER = { name: 'Morphotype project', extensions: ['morpho'] };

let renderer: Renderer | null = null;
export function setRenderer(r: Renderer | null) {
  renderer = r;
}
export function getRenderer() {
  return renderer;
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function slug(s: string) {
  return s.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'morphotype';
}

// ---------- selection ----------

export function selectedNodes(): Node[] {
  const s = store.get();
  return s.selection.map((id) => findNode(s.project.layers, id)).filter((n): n is Node => !!n);
}

/** The node the inspector shows: the last one selected. */
export function primaryNode(): Node | undefined {
  return selectedNodes().at(-1);
}

export function selectedLayers(): ShapeLayer[] {
  const seen = new Set<string>();
  return selectedNodes()
    .flatMap(layersOf)
    .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
}

export function selectAll() {
  const s = store.get();
  const scope = s.selection.length ? find(s.project.layers, s.selection[0])?.parent : null;
  const list = scope ? scope.children : s.project.layers;
  select(list.filter((n) => n.visible && !n.locked).map((n) => n.id));
}

/** Bounding box of a node from the last build (union of its layers). */
export function nodeBox(n: Node): Box | null {
  const outs = store.get().build?.layers;
  if (!outs) return null;
  let box: Box | null = null;
  for (const l of layersOf(n)) {
    const b = outs.find((o) => o.id === l.id)?.bbox;
    if (!b) continue;
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : [...b];
  }
  return box;
}

export function unionBox(nodes: Node[]): Box | null {
  let box: Box | null = null;
  for (const n of nodes) {
    const b = nodeBox(n);
    if (!b) continue;
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  }
  return box;
}

// ---------- edits ----------

export function updateNode(id: string, fn: (n: Node) => void, key = '') {
  edit((p) => {
    const n = findNode(p.layers, id);
    if (n) fn(n);
  }, key ? `${id}:${key}` : '');
}

export function updateLayer(id: string, fn: (l: ShapeLayer) => void, key = '') {
  updateNode(id, (n) => !isGroup(n) && fn(n), key);
}

/** Apply `fn` to every selected node. */
export function updateSelected(fn: (n: Node) => void, key = '') {
  const ids = store.get().selection;
  edit((p) => {
    for (const id of ids) {
      const n = findNode(p.layers, id);
      if (n) fn(n);
    }
  }, key ? `sel:${ids.join(',')}:${key}` : '');
}

/**
 * Insert above the current selection (inside the same group), or on top. A
 * selected open, plain group is a layer you work in: new things go inside it.
 */
export function addNode(n: Node, opts: { parent?: string | null; index?: number } = {}) {
  const s = store.get();
  let parent = opts.parent;
  let index = opts.index;
  if (parent === undefined) {
    const anchor = s.selection.at(-1);
    const f = anchor ? find(s.project.layers, anchor) : null;
    if (f && isGroup(f.node) && !f.node.merge && f.node.open && !f.node.locked && n !== f.node) {
      parent = f.node.id;
      index = f.node.children.length;
    } else if (f) {
      parent = f.parent?.id ?? null;
      index = f.index + 1;
    } else parent = null;
  }
  edit((p) => {
    const list = childrenOf(p.layers, parent ?? null) ?? p.layers;
    list.splice(index ?? list.length, 0, n);
  });
  select([n.id]);
}

/**
 * Where drawn things go: into the selected layer (a plain group), or the layer
 * holding the selection, on top of it; otherwise on top of everything.
 */
function drawTarget(): { parent: string | null; index?: number } {
  const s = store.get();
  const anchor = s.selection.at(-1);
  const f = anchor ? find(s.project.layers, anchor) : null;
  if (!f) return { parent: null };
  const g = isGroup(f.node) && !f.node.merge && f.node.open ? f.node : f.parent && isGroup(f.parent) && !f.parent.merge ? f.parent : null;
  return g && !g.locked ? { parent: g.id, index: g.children.length } : { parent: null };
}

/** A new, empty layer to draw into: what you add while it's selected goes inside it. */
export function addEmptyLayer() {
  const count = (ns: Node[]): number => ns.reduce((k, x) => k + (isGroup(x) ? 1 + count(x.children) : 0), 0);
  addNode(group([], { name: `Layer ${count(store.get().project.layers) + 1}` }), { parent: null });
}

/** Text, shapes and paths get sensible defaults: centred, style of the selection if any. */
export function addShape(l: ShapeLayer) {
  const prev = primaryNode();
  if (prev && !isGroup(prev) && prev.op === 'add') l.style = structuredClone(prev.style);
  addNode(l);
}

// ---------- construction sheet ----------

const CONSTRUCTION = '#5b3fd6';

/** A path layer from artboard-space path data (normalised into the 1-unit box path layers use). */
function artPathLayer(d: string, name: string, st: Style): ShapeLayer | null {
  const b = pathBounds(d);
  if (!b) return null;
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  const size = Math.max(b[2] - b[0], b[3] - b[1], 1);
  const cs = parsePath(d);
  const map = (q: { x: number; y: number }) => ({ x: (q.x - cx) / size, y: (q.y - cy) / size });
  for (const c of cs)
    for (const n of c.nodes) {
      Object.assign(n, map(n));
      if (n.hin) n.hin = map(n.hin);
      if (n.hout) n.hout = map(n.hout);
    }
  const l = pathLayer(serializePath(cs), size, name, { x: cx, y: cy, style: st });
  return l;
}

/**
 * Turn the selection into a construction drawing, like a logo presentation:
 * a tinted copy of the outline with a stroke, a marker on every anchor point,
 * and guide lines across the artboard at its edges and (for text) at the
 * font's baseline, x-height, cap height and ascender.
 */
/** Add the app-icon grid as locked line layers at the bottom, for presentation shots. */
export function addIconGrid() {
  const { width: W, height: H } = store.get().project.canvas;
  const g = group(iconGridLayers(Math.min(W, H)), { name: 'Icon grid', locked: true, open: false });
  edit((p) => {
    p.layers.unshift(g);
  });
  toast('Added the icon grid under your artwork (locked)', 'info', { label: 'Undo', run: undo });
}

export async function constructionSheet() {
  const s = store.get();
  const ids = topmost(s.project.layers, s.selection);
  if (!ids.length) return toast('Select the logo or lettering to draw its construction.');
  const { doc } = buildScene(s.project);
  const out = await engine.exportPaths(doc);
  const paths = out.paths.filter((p) => ids.some((id) => { const n = findNode(s.project.layers, id); return !!n && (n.id === p.id || layersOf(n).some((l) => l.id === p.id) || isGroup(n) && n.id === p.id); }));
  if (!paths.length) return toast('Nothing to draw: the selection has no outline yet.');
  const W = s.project.canvas.width;
  const H = s.project.canvas.height;
  const d = paths.map((p) => p.d).join('');
  const b = pathBounds(d)!;
  const span = Math.max(b[2] - b[0], b[3] - b[1]);
  const m = Math.max(6, span * 0.012);
  const line = Math.max(1, span * 0.0018);
  // Anchor markers: one small square per on-curve point.
  const marks: string[] = [];
  const xs = new Set<number>();
  for (const c of parsePath(d)) {
    let cx0 = Infinity;
    let cx1 = -Infinity;
    for (const n of c.nodes) {
      cx0 = Math.min(cx0, n.x);
      cx1 = Math.max(cx1, n.x);
      // Show corners and curve extremes (horizontal or vertical tangent), like a type designer would.
      const h = n.hout ?? n.hin;
      if (h && n.hin && n.hout) {
        const [ax, ay] = [n.x - n.hin.x, n.y - n.hin.y];
        const [bx, by] = [n.hout.x - n.x, n.hout.y - n.y];
        const smooth = Math.abs(ax * by - ay * bx) < 0.02 * Math.hypot(ax, ay) * Math.hypot(bx, by) && ax * bx + ay * by > 0;
        const tx = h.x - n.x;
        const ty = h.y - n.y;
        const extreme = Math.abs(tx) < 0.05 * Math.abs(ty) || Math.abs(ty) < 0.05 * Math.abs(tx);
        if (smooth && !extreme) continue;
      }
      marks.push(`M${n.x - m / 2} ${n.y - m / 2}h${m}v${m}h${-m}Z`);
    }
    xs.add(Math.round(cx0));
    xs.add(Math.round(cx1));
  }
  // Guides: verticals at each contour's sides, horizontals at the box and font metrics.
  const ys = new Set<number>([Math.round(b[1]), Math.round(b[3])]);
  for (const id of ids) {
    const n = findNode(s.project.layers, id);
    if (!n || isGroup(n) || n.content.type !== 'text' || n.rotation) continue;
    const info = s.fonts.find((f) => f.id === (n.content as Extract<Content, { type: 'text' }>).font)?.info;
    if (!info) continue;
    const lay = await engine.textLayout(n.content);
    const k = n.scale * (n.sy ?? 1);
    const em = n.content.size / info.unitsPerEm;
    for (const ln of lay.lines) {
      const base = n.y + ln.baseline * k;
      for (const v of [0, info.xHeight, info.capHeight, info.ascender]) if (v) ys.add(Math.round(base - v * em * k));
      if (info.descender) ys.add(Math.round(base - info.descender * em * k));
    }
  }
  const dedupe = (v: Set<number>) => [...v].sort((a, c) => a - c).filter((x, i, a) => i === 0 || x - a[i - 1] > line * 3);
  const guides = [
    ...dedupe(xs).map((x) => `M${x - line / 2} ${-H / 2}h${line}v${H}h${-line}Z`),
    ...dedupe(ys).map((y) => `M${-W / 2} ${y - line / 2}h${W}v${line}h${-W}Z`),
  ].join('');
  const tint = (fill: string, stroke: number) => ({ ...style('flat', { fill }), stroke: { width: stroke, color: CONSTRUCTION, align: 'center' as const, opacity: 1 } });
  const layers = [
    artPathLayer(guides, 'Guides', { ...style('flat', { fill: CONSTRUCTION }), opacity: 0.45 }),
    artPathLayer(d, 'Outline', tint('#e9e4ff', line * 1.6)),
    artPathLayer(marks.join(''), 'Anchors', tint('#ffffff', line * 1.4)),
  ].filter((l): l is ShapeLayer => !!l);
  addNode(group(layers, { name: 'Construction', open: false }), { parent: null });
  toast(`Construction drawn: ${marks.length} anchors, ${dedupe(xs).length + dedupe(ys).length} guides. Hide the original or keep both.`);
}

// ---------- drawing ----------

/** Turn the live brush stroke into a layer (points relative to its centre). */
export function finishDrawing(pts: [number, number, number][]) {
  const s = store.get();
  if (!pts.length) return;
  const b = brushById(s.settings.brush);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  const cx = Math.round((x0 + x1) / 2);
  const cy = Math.round((y0 + y1) / 2);
  const points = pts.map(([x, y, p]) => [+(x - cx).toFixed(2), +(y - cy).toFixed(2), +p.toFixed(3)] as [number, number, number]);
  const l: ShapeLayer = {
    ...textLayer('', 'archivo'),
    id: uid(),
    name: undefined,
    x: cx,
    y: cy,
    content: { type: 'stroke', points, width: s.settings.brushWidth, taper: b.taper, smooth: b.smooth },
    style: b.style(s.settings.brushColor),
  };
  // Drawings stack in order and stay selected so the next stroke can be compared.
  addNode(l, drawTarget());
}

/**
 * Turn a pen path (artboard coordinates) into a layer: a filled outline when
 * it was closed, otherwise a line. Path data is stored in em units around the
 * path's centre so modifiers scale with its size.
 */
/** Turn a pen path into a layer. With `mirrorAt` (an artboard x) it gets a Mirror modifier on that line, keeping the side it was drawn on. */
export function finishPen(nodes: GNode[], closed: boolean, mirrorAt?: number) {
  if (nodes.length < 2) return;
  const s = store.get();
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const n of nodes) for (const p of [n, n.hin, n.hout]) if (p) (x0 = Math.min(x0, p.x)), (y0 = Math.min(y0, p.y)), (x1 = Math.max(x1, p.x)), (y1 = Math.max(y1, p.y));
  const cx = Math.round((x0 + x1) / 2);
  const cy = Math.round((y0 + y1) / 2);
  const size = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0)));
  const k = (p: { x: number; y: number }) => ({ x: (p.x - cx) / size, y: (p.y - cy) / size });
  const d = serializePath([{ open: !closed, nodes: nodes.map((n) => ({ ...k(n), hin: n.hin && k(n.hin), hout: n.hout && k(n.hout) })) }]);
  const ink = s.settings.penColor;
  const l = closed ? pathLayer(d, size, 'Shape', { x: cx, y: cy, style: style('flat', { fill: ink }) }) : lineLayer(d, size, s.settings.penWidth, { x: cx, y: cy, style: style('flat', { fill: ink }) });
  // Modifiers work in em around the layer's position: the line sits (mirrorAt − cx) / size em away.
  if (mirrorAt !== undefined) l.modifiers = [newModifier('mirror', { offset: (mirrorAt - cx) / size, flip: cx > mirrorAt ? 1 : 0 })];
  addNode(l, drawTarget());
}

// ---------- text ----------

/** Ink that reads on the current background: near-black on light, cream on dark. */
export function defaultInk(p: Project = store.get().project): string {
  const [r, g, b] = ambientOf(p.background);
  const hex = `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
  return luminance(hex) > 0.35 ? '#0a0a0a' : '#f4f1ea';
}

/** Where new things go: the middle of what's on screen, inside the artboard. */
export function placementPoint(): { x: number; y: number } {
  const r = getRenderer();
  const { width: W, height: H } = store.get().project.canvas;
  const c = r?.viewCentre() ?? { x: 0, y: 0 };
  const clamp = (v: number, lim: number) => Math.round(Math.max(-lim * 0.45, Math.min(lim * 0.45, v)));
  return { x: clamp(c.x, W), y: clamp(c.y, H) };
}

/**
 * Add a text layer and start typing into it. Without a point it goes in the
 * middle of the view with its placeholder selected, so typing replaces it.
 */
export function startText(at?: { x: number; y: number }) {
  const s = store.get();
  const { width: W, height: H } = s.project.canvas;
  const prev = primaryNode();
  const inherit = prev && !isGroup(prev) && prev.op === 'add' && prev.content.type === 'text' ? prev : null;
  const font = inherit?.content.type === 'text' ? inherit.content.font : (s.fonts[0]?.id ?? 'archivo');
  const size = Math.round(Math.max(24, Math.min(W, H) * 0.14));
  const p = at ?? placementPoint();
  const text = at ? '' : 'Text';
  const l = textLayer(text, font, { x: p.x, y: p.y, style: inherit ? structuredClone(inherit.style) : style('flat', { fill: defaultInk(s.project) }) }, { size, align: at ? 'left' : 'center' });
  addNode(l);
  store.set({ editing: { kind: 'text', id: l.id, select: [0, text.length] }, tool: 'select' });
}

/** Type into an existing text layer, with the caret nearest `at` (artboard point). */
export function editText(id: string, at?: { x: number; y: number }, selectAll = false) {
  const n = findNode(store.get().project.layers, id);
  if (!n || isGroup(n) || n.content.type !== 'text' || n.locked) return;
  commitEdit();
  store.set({ selection: [id], editing: { kind: 'text', id, at, select: selectAll ? [0, n.content.text.length] : undefined } });
}

/** Leave on-canvas typing. A text left empty is removed. */
export function endTextEdit() {
  const e = store.get().editing;
  if (e?.kind !== 'text') return;
  commitEdit();
  const n = findNode(store.get().project.layers, e.id);
  store.set({ editing: null });
  if (n && !isGroup(n) && n.content.type === 'text' && !n.content.text.trim()) {
    edit((p) => {
      removeNodes(p.layers, new Set([e.id]));
    });
    select([]);
  }
}

export function removeSelected() {
  const ids = new Set(store.get().selection);
  if (!ids.size) return;
  const first = find(store.get().project.layers, [...ids][0]);
  edit((p) => {
    removeNodes(p.layers, ids);
  });
  const sib = first ? (childrenOf(store.get().project.layers, first.parent?.id ?? null) ?? []) : [];
  const next = sib[Math.min(first?.index ?? 0, sib.length - 1)] ?? first?.parent;
  select(next ? [next.id] : []);
}

function cloneWithIds(n: Node, map: Map<string, string>): Node {
  const c = structuredClone(n);
  const rec = (x: Node) => {
    const id = isGroup(x) ? uid('g') : uid();
    map.set(x.id, id);
    x.id = id;
    if (isGroup(x)) x.children.forEach(rec);
    else x.modifiers.forEach((m) => (m.uid = uid('m')));
  };
  rec(c);
  return c;
}

/** Point morph layers inside copied nodes at the copies of their sources. */
function remapMorphs(nodes: Node[], map: Map<string, string>) {
  walk(nodes, (n) => {
    if (!isGroup(n) && n.content.type === 'morph') {
      n.content.a = map.get(n.content.a) ?? n.content.a;
      n.content.b = map.get(n.content.b) ?? n.content.b;
    }
  });
}

function offsetNode(n: Node, dx: number, dy: number) {
  for (const l of layersOf(n)) {
    l.x += dx;
    l.y += dy;
  }
}

/** Where each copy of the last duplicate came from (copy id → its original's position). */
let lastDuplicate: Map<string, { x: number; y: number }> | null = null;

const positionOf = (n: Node) => {
  const l = layersOf(n)[0];
  return l ? { x: l.x, y: l.y } : null;
};

/**
 * Duplicate the selection `offset` px down and right. Duplicate, move the
 * copy, duplicate again: the new copy takes the same step (rows of circles,
 * stacks of pills), like Illustrator's Transform Again.
 */
export function duplicateSelected(offset = 24) {
  const s = store.get();
  const ids = topmost(s.project.layers, s.selection);
  if (!ids.length) return;
  let step = { x: offset, y: offset };
  if (lastDuplicate && ids.length === lastDuplicate.size && ids.every((id) => lastDuplicate!.has(id))) {
    const n = findNode(s.project.layers, ids[0]);
    const now = n && positionOf(n);
    const was = lastDuplicate.get(ids[0]);
    if (now && was && (now.x !== was.x || now.y !== was.y)) step = { x: now.x - was.x, y: now.y - was.y };
  }
  const made: string[] = [];
  const sources = new Map<string, { x: number; y: number }>();
  edit((p) => {
    const map = new Map<string, string>();
    const copies: { at: Node[]; index: number; node: Node }[] = [];
    for (const id of ids) {
      const f = find(p.layers, id);
      if (!f) continue;
      const c = cloneWithIds(f.node, map);
      const from = positionOf(f.node);
      if (from) sources.set(c.id, from);
      offsetNode(c, step.x, step.y);
      copies.push({ at: f.siblings, index: f.index, node: c });
    }
    remapMorphs(
      copies.map((c) => c.node),
      map,
    );
    // Insert from the end so indices stay valid.
    copies.sort((a, b) => b.index - a.index);
    for (const c of copies) {
      c.at.splice(c.index + 1, 0, c.node);
      made.push(c.node.id);
    }
  });
  lastDuplicate = sources;
  select(made);
}

export function groupSelected(merge = false) {
  const s = store.get();
  const ids = topmost(s.project.layers, s.selection);
  if (!ids.length) return;
  const first = find(s.project.layers, ids[0]);
  if (!first) return;
  const primary = findNode(s.project.layers, ids.at(-1));
  const g = group([], { merge, name: merge ? 'Merged shape' : undefined, style: primary && !isGroup(primary) ? structuredClone(primary.style) : undefined });
  if (!g.style) g.style = { effect: 'flat', params: defaultParams(effectById('flat')) };
  edit((p) => {
    // The group goes where the topmost selected node was.
    const target = childrenOf(p.layers, first.parent?.id ?? null) ?? p.layers;
    const all = new Set(ids);
    let index = 0;
    target.forEach((n, i) => all.has(n.id) && (index = i));
    const removedBefore = target.slice(0, index).filter((n) => all.has(n.id)).length;
    g.children = removeNodes(p.layers, all);
    target.splice(Math.min(index - removedBefore, target.length), 0, g);
  });
  select([g.id]);
}

export function ungroupSelected() {
  const groups = selectedNodes().filter(isGroup);
  if (!groups.length) return;
  const freed: string[] = [];
  edit((p) => {
    for (const g of groups) {
      const f = find(p.layers, g.id);
      if (!f || !isGroup(f.node)) continue;
      const kids = f.node.children;
      // A merged group's look lives on the group: hand it to the children.
      if (f.node.merge) for (const l of allLayers(kids)) l.style = structuredClone(f.node.style);
      if (f.node.op !== 'add') for (const k of kids) k.op = f.node.op;
      f.siblings.splice(f.index, 1, ...kids);
      freed.push(...kids.map((k) => k.id));
    }
  });
  select(freed);
}

export type Arrange = 'forward' | 'backward' | 'front' | 'back';

export function arrangeSelected(how: Arrange) {
  const ids = topmost(store.get().project.layers, store.get().selection);
  edit((p) => {
    const order = how === 'forward' || how === 'front' ? [...ids].reverse() : ids;
    for (const id of order) {
      const f = find(p.layers, id);
      if (!f) continue;
      const list = f.siblings;
      const [n] = list.splice(f.index, 1);
      const to = how === 'forward' ? Math.min(f.index + 1, list.length) : how === 'backward' ? Math.max(f.index - 1, 0) : how === 'front' ? list.length : 0;
      list.splice(to, 0, n);
    }
  });
}

/** Move nodes into `parent` (null = root) at `index` (in the list before removal). */
export function moveNodes(ids: string[], parent: string | null, index: number) {
  const s = store.get();
  const tops = topmost(s.project.layers, ids);
  // Can't drop a group into itself.
  if (parent && tops.some((id) => id === parent || ancestors(s.project.layers, parent).some((g) => g.id === id))) return;
  edit((p) => {
    const target = childrenOf(p.layers, parent);
    if (!target) return;
    const before = target.slice(0, index).filter((n) => tops.includes(n.id)).length;
    const moved = removeNodes(p.layers, new Set(tops));
    target.splice(Math.max(0, Math.min(index - before, target.length)), 0, ...moved);
  });
  select(tops);
}

export function translateSelected(dx: number, dy: number, key = '') {
  const ids = topmost(store.get().project.layers, store.get().selection);
  edit((p) => {
    for (const id of ids) {
      const n = findNode(p.layers, id);
      if (n && !n.locked) offsetNode(n, dx, dy);
    }
  }, key);
}

export function nudge(dx: number, dy: number) {
  translateSelected(dx, dy, 'nudge');
}

export function toggleLocked(ids = store.get().selection) {
  const s = store.get();
  const lock = !ids.every((id) => findNode(s.project.layers, id)?.locked);
  edit((p) => ids.forEach((id) => {
    const n = findNode(p.layers, id);
    if (n) n.locked = lock || undefined;
  }));
}

export function toggleVisible(ids = store.get().selection) {
  const s = store.get();
  const show = !ids.every((id) => findNode(s.project.layers, id)?.visible);
  edit((p) => ids.forEach((id) => {
    const n = findNode(p.layers, id);
    if (n) n.visible = show;
  }));
}

export function flipSelected(axis: 'x' | 'y') {
  const nodes = selectedNodes();
  const box = unionBox(nodes);
  if (!box) return;
  const c = axis === 'x' ? (box[0] + box[2]) / 2 : (box[1] + box[3]) / 2;
  const ids = topmost(store.get().project.layers, store.get().selection);
  edit((p) => {
    for (const id of ids) {
      const n = findNode(p.layers, id);
      if (!n) continue;
      for (const l of layersOf(n)) {
        if (axis === 'x') {
          l.x = 2 * c - l.x;
          l.sx = -(l.sx ?? 1);
        } else {
          l.y = 2 * c - l.y;
          l.sy = -(l.sy ?? 1);
        }
        l.rotation = -l.rotation;
      }
    }
  });
}

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Align to each other, or to the artboard when only one thing is selected. */
export function alignSelected(kind: AlignKind) {
  const s = store.get();
  const ids = topmost(s.project.layers, s.selection);
  const nodes = ids.map((id) => findNode(s.project.layers, id)).filter((n): n is Node => !!n);
  if (!nodes.length) return;
  const { width: W, height: H } = s.project.canvas;
  const ref: Box = nodes.length === 1 ? [-W / 2, -H / 2, W / 2, H / 2] : (unionBox(nodes) ?? [0, 0, 0, 0]);
  const moves = new Map<string, [number, number]>();
  for (const n of nodes) {
    const b = nodeBox(n);
    if (!b) continue;
    let dx = 0;
    let dy = 0;
    if (kind === 'left') dx = ref[0] - b[0];
    if (kind === 'right') dx = ref[2] - b[2];
    if (kind === 'hcenter') dx = (ref[0] + ref[2]) / 2 - (b[0] + b[2]) / 2;
    if (kind === 'top') dy = ref[1] - b[1];
    if (kind === 'bottom') dy = ref[3] - b[3];
    if (kind === 'vcenter') dy = (ref[1] + ref[3]) / 2 - (b[1] + b[3]) / 2;
    moves.set(n.id, [dx, dy]);
  }
  edit((p) => {
    for (const [id, [dx, dy]] of moves) {
      const n = findNode(p.layers, id);
      if (n) offsetNode(n, dx, dy);
    }
  });
}

/** Even gaps between three or more nodes along an axis. */
export function distributeSelected(axis: 'x' | 'y') {
  const s = store.get();
  const nodes = topmost(s.project.layers, s.selection)
    .map((id) => findNode(s.project.layers, id))
    .filter((n): n is Node => !!n)
    .map((n) => ({ n, b: nodeBox(n) }))
    .filter((x): x is { n: Node; b: Box } => !!x.b);
  if (nodes.length < 3) {
    toast('Select three or more layers to distribute.');
    return;
  }
  const lo = axis === 'x' ? 0 : 1;
  const hi = axis === 'x' ? 2 : 3;
  nodes.sort((a, b) => a.b[lo] - b.b[lo]);
  const total = nodes.reduce((sum, x) => sum + (x.b[hi] - x.b[lo]), 0);
  const span = nodes.at(-1)!.b[hi] - nodes[0].b[lo];
  const gap = (span - total) / (nodes.length - 1);
  let cursor = nodes[0].b[lo];
  const moves = nodes.map((x) => {
    const d = cursor - x.b[lo];
    cursor += x.b[hi] - x.b[lo] + gap;
    return [x.n.id, d] as const;
  });
  edit((p) => {
    for (const [id, d] of moves) {
      const n = findNode(p.layers, id);
      if (n) offsetNode(n, axis === 'x' ? d : 0, axis === 'y' ? d : 0);
    }
  });
}

// ---------- styles ----------

/** Give nodes a style. A style without a `stroke` key (a material or preset) keeps each node's own stroke. */
export function applyStyle(st: Style, ids = store.get().selection) {
  const put = (n: { style: Style }) => {
    const prev = n.style;
    n.style = structuredClone(st);
    if (!('stroke' in st) && prev?.stroke) n.style.stroke = prev.stroke;
    if (!('opacity' in st) && prev?.opacity !== undefined) n.style.opacity = prev.opacity;
    if (!('blend' in st) && prev?.blend) n.style.blend = prev.blend;
    if (!('depth' in st) && prev?.depth) n.style.depth = prev.depth;
  };
  edit((p) => {
    for (const id of ids) {
      const n = findNode(p.layers, id);
      if (!n) continue;
      // A plain group passes the style to every child; merged groups own it.
      if (isGroup(n) && !n.merge) for (const l of allLayers(n.children)) put(l);
      else put(n);
    }
  });
}

export function applyPreset(preset: Preset, withBackground = false) {
  const st: Style = { effect: preset.effect, params: { ...defaultParams(effectById(preset.effect)), ...preset.params } };
  if (!store.get().selection.length) {
    toast('Select a layer to style it.');
    return;
  }
  applyStyle(st);
  if (withBackground) setBackground((b) => (b.fill = { kind: 'solid', colors: [preset.bg], angle: 180 }));
}

/** The style shown for a node: its own, or its first child's for plain groups. */
export function styleOf(n: Node): Style | undefined {
  if (!isGroup(n) || n.merge) return n.style;
  return allLayers(n.children)[0]?.style;
}

let styleClipboard: Style | null = null;
export function copyStyle() {
  const n = primaryNode();
  const st = n && styleOf(n);
  if (st) {
    // Carry the stroke explicitly so pasting also copies (or clears) it.
    styleClipboard = { ...structuredClone(st), stroke: st.stroke ? structuredClone(st.stroke) : null, opacity: st.opacity ?? 1, blend: st.blend ?? 'normal', depth: st.depth ? structuredClone(st.depth) : null };
    toast('Style copied');
  }
}
export function pasteStyle() {
  if (styleClipboard) applyStyle(styleClipboard);
}

// Motion: how it comes in, Then, its loop and its stagger, from one layer to others.
let motionClipboard: Motion | null = null;
export function copyMotion() {
  const m = primaryNode()?.motion;
  if (!m || isStill(m)) return toast('Nothing to copy: this layer has no motion yet.');
  motionClipboard = structuredClone(m);
  toast('Motion copied');
}
export function pasteMotion() {
  if (!motionClipboard) return toast('Copy a layer’s motion first (⌥⇧⌘C).');
  const m = motionClipboard;
  updateSelected((n) => {
    n.motion = structuredClone(m);
  });
  clock.replay(timelineOf(store.get().project));
}

export function setBackground(fn: (b: Background) => void, key = '') {
  edit((p) => fn(p.background), key ? `bg:${key}` : '');
}

// ---------- clipboard ----------

let clipboard: Node[] = [];
const CLIP_MIME = 'application/x-morphotype';

function copiedNodes(): Node[] {
  const s = store.get();
  return topmost(s.project.layers, s.selection).map((id) => structuredClone(findNode(s.project.layers, id)!));
}

/** Menu / palette copy: in-app clipboard plus best-effort system clipboard. */
export function copySelected() {
  clipboard = copiedNodes();
  if (clipboard.length) void navigator.clipboard?.writeText(JSON.stringify({ morphotype: 1, nodes: clipboard })).catch(() => undefined);
}

export function cutSelected() {
  copySelected();
  removeSelected();
}

/** Native copy event (⌘C): no permission prompts. */
export function onCopyEvent(e: ClipboardEvent, cut = false) {
  const nodes = copiedNodes();
  if (!nodes.length || !e.clipboardData) return;
  e.preventDefault();
  clipboard = nodes;
  const json = JSON.stringify({ morphotype: 1, nodes });
  e.clipboardData.setData('text/plain', json);
  e.clipboardData.setData(CLIP_MIME, json);
  if (cut) removeSelected();
}

function insertNodes(nodes: Node[]) {
  if (!nodes.length) return;
  const map = new Map<string, string>();
  const copies = nodes.map((n) => cloneWithIds(n, map));
  remapMorphs(copies, map);
  copies.forEach((c) => offsetNode(c, 24, 24));
  edit((p) => p.layers.push(...copies));
  select(copies.map((c) => c.id));
}

function parseNodes(text: string | undefined): Node[] | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { morphotype?: number; nodes?: Node[] };
    return parsed?.morphotype === 1 && Array.isArray(parsed.nodes) ? parsed.nodes : null;
  } catch {
    return null;
  }
}

/** Native paste event (⌘V): layers, images (traced) or plain text (a new text layer). */
export async function onPasteEvent(e: ClipboardEvent) {
  const dt = e.clipboardData;
  if (!dt) return;
  const nodes = parseNodes(dt.getData(CLIP_MIME) || dt.getData('text/plain'));
  if (nodes) {
    e.preventDefault();
    insertNodes(nodes);
    return;
  }
  const file = Array.from(dt.files).find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    await importImage([{ name: file.name || 'Pasted image.png', bytes: new Uint8Array(await file.arrayBuffer()) }], store.get().mode === 'type' ? 'glyph' : 'layer');
    return;
  }
  const text = dt.getData('text/plain').trim();
  if (text && store.get().mode === 'design') {
    e.preventDefault();
    const font = store.get().fonts[0]?.id ?? 'archivo';
    addShape(textLayer(text.slice(0, 400), font));
  }
}

/** Menu / palette paste: the in-app clipboard. */
export async function paste() {
  insertNodes(clipboard);
}

// ---------- outlines ----------

export function engineDoc(p: Project, quality?: number) {
  return buildScene(p, quality).doc;
}

/** Turn a layer's content (with its modifiers) into an editable outline. */
export async function convertToOutline(id: string): Promise<boolean> {
  const p = store.get().project;
  const l = findNode(p.layers, id);
  if (!l || isGroup(l)) return false;
  if (l.content.type === 'path' && l.modifiers.length === 0) return true;
  try {
    const out = await engine.bake(engineDoc(p), id);
    const name = l.name ?? (l.content.type === 'text' ? l.content.text.replace(/\s+/g, ' ').trim().slice(0, 24) : undefined);
    updateLayer(id, (x) => {
      x.content = { type: 'path', d: out.d, size: out.size, name } as Content;
      x.modifiers = [];
      x.name = name;
    });
    return true;
  } catch (e) {
    toast(`Couldn't convert: ${errorText(e)}`, 'error');
    return false;
  }
}

/** Split a layer into one layer per piece (letters, for text and traced images). */
export async function breakApart(id: string) {
  const p = store.get().project;
  const f = find(p.layers, id);
  if (!f || isGroup(f.node)) return;
  const l = f.node;
  try {
    const pieces = await engine.split(engineDoc(p), id);
    if (pieces.length < 2) {
      toast('This is already a single piece.');
      return;
    }
    const kids: ShapeLayer[] = pieces.map((pc, i) =>
      pathLayer(pc.d, pc.size, `${l.name ?? 'Piece'} ${i + 1}`, {
        x: pc.x,
        y: pc.y,
        rotation: l.rotation,
        scale: l.scale,
        sx: l.sx,
        sy: l.sy,
        style: structuredClone(l.style),
        op: 'add',
      }),
    );
    const g: Group = group(kids, { name: l.name ?? (l.content.type === 'text' ? l.content.text.trim().slice(0, 24) : 'Pieces'), op: l.op });
    edit((d) => {
      const at = find(d.layers, id);
      if (at) at.siblings.splice(at.index, 1, g);
    });
    select([kids[0].id]);
    toast(`Split into ${kids.length} layers`, 'info', { label: 'Undo', run: undo });
  } catch (e) {
    toast(`Couldn't break apart: ${errorText(e)}`, 'error');
  }
}

/** Modifiers that leave a path's points in place, so they can stay on while editing them. */
const POINT_SAFE = new Set(['mirror', 'round', 'weight', 'outline', 'scallop', 'fuse', 'repeat']);

export async function editPoints(id: string) {
  const l = findNode(store.get().project.layers, id);
  if (!l || isGroup(l)) return;
  // Pen lines edit as they are, also under modifiers that keep the points
  // where they are (a mirrored half stays mirrored); anything else becomes an outline first.
  const keepsPoints = l.modifiers.every((m) => !m.on || POINT_SAFE.has(m.kind));
  const needs = !((l.content.type === 'path' || l.content.type === 'line') && keepsPoints);
  if (needs) {
    const ok = await convertToOutline(id);
    if (!ok) return;
    toast('Converted to an outline so its points can be edited', 'info', { label: 'Undo', run: undo });
  }
  commitEdit();
  store.set({ editing: { kind: 'points', id }, selection: [id] });
}

export function editWarp(id: string, m: ModEntry) {
  store.set({ editing: { kind: 'warp', id, uid: m.uid }, selection: [id] });
}

// ---------- fonts ----------

function registerFonts(entries: FontEntry[]) {
  const known = new Set(store.get().fonts.map((f) => f.id));
  const fresh = entries.filter((f) => !known.has(f.id));
  if (fresh.length) store.set({ fonts: [...store.get().fonts, ...fresh] });
}

export function registerFontEntry(e: FontEntry) {
  const rest = store.get().fonts.filter((f) => f.id !== e.id);
  store.set({ fonts: [...rest, e] });
}

export async function importFonts(files?: { name: string; bytes: Uint8Array }[]): Promise<FontEntry | null> {
  const picked = files ?? (await platform().open([FONT_FILTER], true));
  let last: FontEntry | null = null;
  for (const f of picked) {
    try {
      const entry = await importFontBytes(f.bytes);
      registerFonts([entry]);
      for (let i = 1; i < entry.info.faces; i++) registerFonts([await importFontBytes(f.bytes, 'imported', i)]);
      last = entry;
      toast(`Added ${entry.name}`);
    } catch (e) {
      toast(`${f.name}: ${errorText(e)}`, 'error');
    }
  }
  return last;
}

export async function addSystemFont(path: string, index: number): Promise<FontEntry | null> {
  const p = platform();
  if (!p.readSystemFont) return null;
  try {
    const entry = await importFontBytes(await p.readSystemFont(path), 'system', index);
    registerFonts([entry]);
    return entry;
  } catch (e) {
    toast(errorText(e), 'error');
    return null;
  }
}

// ---------- images ----------

/** Bounds of a path's points (handles included, so slightly generous). */
function pathBounds(d: string): Box | null {
  let b: Box | null = null;
  for (const c of parsePath(d))
    for (const n of c.nodes)
      for (const q of [n, n.hin, n.hout]) {
        if (!q) continue;
        b = b ? [Math.min(b[0], q.x), Math.min(b[1], q.y), Math.max(b[2], q.x), Math.max(b[3], q.y)] : [q.x, q.y, q.x, q.y];
      }
  return b;
}

/** Place a picture as a rectangle filled with the Photo material. */
export function placePhoto(image: ImageData, name: string) {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  c.getContext('2d')?.putImageData(image, 0, 0);
  let opaque = true;
  for (let i = 3; i < image.data.length; i += 4 * 97) if (image.data[i] < 250) (opaque = false), (i = image.data.length);
  const enc = encodeImage(c, opaque);
  const id = addImage(enc.data, enc.w, enc.h, name);
  const p = store.get().project;
  const aspect = enc.w / enc.h;
  const side = Math.min(p.canvas.width, p.canvas.height) * 0.7;
  const l = symbolLayer('roundRect', side, { name, style: style('photo', { image: id }) }, { radius: 0, aspect });
  addNode(l);
  toast('Photo placed. Change its shape, or give any other layer the Photo material.');
}

/**
 * Put a picture under everything as a faded, locked reference to trace over
 * with the pen. It is drawn while designing but never exported.
 */
export function placeReference(image: ImageData, name: string) {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  c.getContext('2d')?.putImageData(image, 0, 0);
  const enc = encodeImage(c, true);
  const id = addImage(enc.data, enc.w, enc.h, name);
  const p = store.get().project;
  const aspect = enc.w / enc.h;
  // Fit the artboard (a rectangle's size is its longer side).
  const { width: W, height: H } = p.canvas;
  const side = aspect >= 1 ? Math.min(W, H * aspect) : Math.min(H, W / aspect);
  const l = symbolLayer('roundRect', side, { name: `Reference · ${name}`, locked: true, style: { ...style('photo', { image: id }), opacity: 0.4 } }, { radius: 0, aspect });
  l.guide = true;
  edit((d) => {
    d.layers.unshift(l);
  });
  store.set({ tool: 'pen', selection: [] });
  toast('Reference placed under your artwork. It won’t export. Trace it with the pen (P).', 'info', { label: 'Undo', run: undo });
}

/** Ask for a picture file and store it; returns its asset id. */
export async function pickPhoto(): Promise<string | null> {
  const f = (await platform().open([IMAGE_FILTER]))[0];
  if (!f) return null;
  try {
    const image = await imageDataFrom(f.bytes, f.name);
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d')?.putImageData(image, 0, 0);
    const enc = encodeImage(c, !/\.(png|svg|webp)$/i.test(f.name));
    return addImage(enc.data, enc.w, enc.h, f.name.replace(/\.[^.]+$/, ''));
  } catch (e) {
    toast(`Couldn't read ${f.name}: ${errorText(e)}`, 'error');
    return null;
  }
}

export async function imageDataFrom(bytes: Uint8Array, name: string): Promise<ImageData> {
  const type = name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '';
  const blob = new Blob([bytes as BlobPart], type ? { type } : {});
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || 1024;
    let h = img.naturalHeight || 1024;
    const max = 2048;
    if (Math.max(w, h) > max) {
      const s = max / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importImage(files?: { name: string; bytes: Uint8Array }[], target: 'layer' | 'glyph' = 'layer') {
  const picked = files ?? (await platform().open([IMAGE_FILTER]));
  const f = picked[0];
  if (!f) return;
  try {
    const image = await imageDataFrom(f.bytes, f.name);
    store.set({ dialog: { kind: 'trace', image, name: f.name.replace(/\.[^.]+$/, ''), target } });
  } catch (e) {
    toast(`Couldn't read ${f.name}: ${errorText(e)}`, 'error');
  }
}

// ---------- projects ----------

export function usedImportedFonts(p: Project): string[] {
  const ids = new Set<string>();
  for (const l of allLayers(p.layers)) {
    if (l.content.type !== 'text') continue;
    ids.add(l.content.font);
    if (l.content.morph) ids.add(l.content.morph.font);
  }
  if (p.type) {
    ids.add(p.type.base);
    if (p.type.morph) ids.add(p.type.morph.font);
  }
  const fonts = store.get().fonts;
  return [...ids].filter((id) => fonts.find((f) => f.id === id && f.source !== 'bundled' && f.source !== 'custom'));
}

export async function saveProject() {
  const p = structuredClone(store.get().project);
  p.fonts = usedImportedFonts(p).flatMap((id) => {
    const bytes = engine.fontBytes(id);
    const name = store.get().fonts.find((f) => f.id === id)?.name;
    return bytes ? [{ id, name, data: toBase64(bytes) }] : [];
  });
  p.images = packImages(p);
  const ok = await platform().save(`${slug(p.name)}.morpho`, JSON.stringify(p), PROJECT_FILTER);
  if (ok) toast('Project saved');
}

/** Make a project's imported fonts available (skipping ones already loaded). */
export async function loadProjectFonts(fonts: { id: string; name?: string; bytes: Uint8Array }[]) {
  for (const font of fonts) {
    if (store.get().fonts.some((x) => x.id === font.id)) continue;
    const info = await engine.loadFont(font.id, font.bytes);
    registerCssFont(font.id, font.bytes);
    registerFonts([{ id: font.id, name: font.name ?? info.family, source: 'imported', info }]);
  }
}

export async function openProject(files?: { name: string; bytes: Uint8Array }[]) {
  const picked = files ?? (await platform().open([PROJECT_FILTER]));
  const f = picked[0];
  if (!f) return;
  try {
    const p = migrate(JSON.parse(new TextDecoder().decode(f.bytes)));
    await loadProjectFonts((p.fonts ?? []).flatMap((f) => (f.data ? [{ id: f.id, name: f.name, bytes: fromBase64(f.data) }] : [])));
    unpackImages(p.images);
    replaceProject({ ...p, fonts: [], images: undefined });
    window.dispatchEvent(new Event('mt-fit'));
    toast(`Opened ${p.name}`);
  } catch (e) {
    toast(`Couldn't open ${f.name}: ${errorText(e)}`, 'error');
  }
}

// ---------- exports ----------

/** Geometry quality for exports (the engine's preview default is 120). */
const EXPORT_QUALITY = 360;

async function freshRender() {
  if (!renderer) throw new Error('The GPU preview isn’t available.');
  // Make sure the renderer has the latest geometry, built at export quality:
  // preview outlines are coarse enough to show as steps on big shapes and lines.
  const { doc } = buildScene(store.get().project, EXPORT_QUALITY);
  await engine.build(doc);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  return renderer;
}

export async function exportPNG(scale = store.get().settings.pngScale, transparent = store.get().settings.exportTransparent) {
  try {
    const r = await freshRender();
    const bytes = await holdLiveGeometry(() => r.exportPNG(scale, transparent));
    const p = store.get().project;
    if (await platform().save(`${slug(p.name)}@${scale}x.png`, bytes, { name: 'PNG image', extensions: ['png'] })) toast('PNG exported');
  } catch (e) {
    toast(`PNG export failed: ${errorText(e)}`, 'error');
  }
}

/** First recording format this browser can write: MP4 where supported (Safari, the Mac app), else WebM. */
export function videoFormat(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
  return null;
}

let recording = false;

/**
 * One pass of the timeline as a video. Fields are built once at export size
 * and each frame is drawn at its own time on the clock, so the motion is
 * exact; frames are handed to the recorder in real time (a 6 s timeline takes
 * about 6 s). Moving geometry is built for every frame first, so recording
 * only swaps outlines and rebuilds those layers' fields.
 */
export async function exportVideo(fps = 30, scale = 1) {
  const fmt = videoFormat();
  if (!fmt) return toast('This browser can’t record video. Try the Mac app, Chrome or Safari.', 'error');
  if (recording) return;
  recording = true;
  try {
    const r = await freshRender();
    const p = store.get().project;
    const tl = timelineOf(p);
    const n = Math.max(1, Math.round(tl.duration * fps));
    const times = Array.from({ length: n + 1 }, (_, i) => Math.min(i / fps, tl.duration));
    if (anyGeoAnim(p.layers)) toast('Building moving shapes for each frame…', 'info');
    const geometry = await geometryFrames(p, times, EXPORT_QUALITY);
    await holdLiveGeometry(async (show) => {
      let frames: ReturnType<Renderer['exportFrames']> | null = null;
      try {
        frames = r.exportFrames(scale, false);
        // Encoders want even sizes.
        const c = document.createElement('canvas');
        c.width = frames.width - (frames.width % 2);
        c.height = frames.height - (frames.height % 2);
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('2D canvas unavailable');
        const stream = c.captureStream(0);
        const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
        const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: Math.round(c.width * c.height * fps * 0.25) });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        const stopped = new Promise((res) => (rec.onstop = res));
        toast(`Recording ${tl.duration.toFixed(1)} s of video…`, 'info');
        rec.start();
        const t0 = performance.now();
        for (const [i, t] of times.entries()) {
          if (geometry) show(geometry[i]);
          const img = frames.frame(t);
          ctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
          track.requestFrame?.();
          const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
          if (wait > 0) await new Promise((res) => setTimeout(res, wait));
        }
        rec.stop();
        await stopped;
        const bytes = new Uint8Array(await new Blob(chunks, { type: fmt.mime }).arrayBuffer());
        if (await platform().save(`${slug(p.name)}.${fmt.ext}`, bytes, { name: fmt.ext === 'mp4' ? 'MP4 video' : 'WebM video', extensions: [fmt.ext] })) toast(`${fmt.ext.toUpperCase()} exported`);
      } finally {
        frames?.close();
      }
    });
  } catch (e) {
    toast(`Video export failed: ${errorText(e)}`, 'error');
  } finally {
    recording = false;
  }
}

export async function exportJPG(scale = 2) {
  try {
    const r = await freshRender();
    const blob = await holdLiveGeometry(() => r.toBlob(scale, false, 'image/jpeg'));
    const p = store.get().project;
    if (await platform().save(`${slug(p.name)}@${scale}x.jpg`, new Uint8Array(await blob.arrayBuffer()), { name: 'JPEG image', extensions: ['jpg'] })) toast('JPG exported');
  } catch (e) {
    toast(`JPG export failed: ${errorText(e)}`, 'error');
  }
}

export async function copyPNG() {
  try {
    const r = await freshRender();
    const blob = await holdLiveGeometry(() => r.toBlob(2, store.get().settings.exportTransparent));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied image to the clipboard');
  } catch (e) {
    toast(`Couldn't copy: ${errorText(e)}`, 'error');
  }
}

/** Main flat colour of a style, for vector export. */
function svgPaint(st: Style): { fill: string; extra: string; defs: string } {
  const p = st.params;
  const c = (k: string) => String(p[k] ?? '#000000');
  switch (st.effect) {
    case 'flat':
      if (Number(p.gradient) > 0) {
        const id = `g${Math.random().toString(36).slice(2, 8)}`;
        const a = ((Number(p.angle) - 90) * Math.PI) / 180;
        const [x, y] = [Math.cos(a) / 2, Math.sin(a) / 2];
        return {
          fill: `url(#${id})`,
          extra: Number(p.outline) > 0 ? ` stroke="${c('outlineColor')}" stroke-width="${Number(p.outline) * 2}" paint-order="stroke" stroke-linejoin="round"` : '',
          defs: `<linearGradient id="${id}" x1="${0.5 - x}" y1="${0.5 - y}" x2="${0.5 + x}" y2="${0.5 + y}"><stop offset="0" stop-color="${c('fill')}"/><stop offset="1" stop-color="${c('fill2')}"/></linearGradient>`,
        };
      }
      return { fill: c('fill'), extra: Number(p.outline) > 0 ? ` stroke="${c('outlineColor')}" stroke-width="${Number(p.outline) * 2}" paint-order="stroke" stroke-linejoin="round"` : '', defs: '' };
    case 'sticker':
      return { fill: c('fill'), extra: Number(p.lineWidth) > 0 ? ` stroke="${c('line')}" stroke-width="${Number(p.lineWidth) * 2}" paint-order="stroke" stroke-linejoin="round"` : '', defs: '' };
    case 'neon':
      return { fill: 'none', extra: ` stroke="${c('color')}" stroke-width="${Number(p.tube)}"`, defs: '' };
    case 'chrome':
      return { fill: c('c3'), extra: '', defs: '' };
    case 'glass':
      return { fill: c('glow'), extra: '', defs: '' };
    case 'inflate':
      return { fill: c('body'), extra: '', defs: '' };
    case 'icon':
      return { fill: c('glyph'), extra: '', defs: '' };
    case 'aura':
      return { fill: c('c1'), extra: '', defs: '' };
    case 'holo':
      return { fill: Number(p.foil) > 0.5 ? '#d9d4ff' : c('body'), extra: '', defs: '' };
    case 'extrude':
      return { fill: c('face'), extra: Number(p.outline) > 0 ? ` stroke="${c('outlineColor')}" stroke-width="${Number(p.outline)}"` : '', defs: '' };
    case 'distressed':
    case 'halftone':
    case 'riso':
      return { fill: c('ink'), extra: '', defs: '' };
    case 'emboss':
      return { fill: c('color'), extra: '', defs: '' };
    case 'dither':
      return { fill: c('light'), extra: '', defs: '' };
    default:
      return { fill: '#000000', extra: '', defs: '' };
  }
}

export async function buildSvg(transparent = store.get().settings.exportTransparent): Promise<string> {
  const p = store.get().project;
  const { doc, objects } = buildScene(p);
  const out = await engine.exportPaths(doc);
  const { width: W, height: H } = p.canvas;
  const defs: string[] = [];
  const body: string[] = [];
  const f = p.background.fill;
  if (!transparent && f.kind !== 'none') {
    if (f.kind === 'linear' && f.colors.length > 1) {
      const a = ((f.angle - 90) * Math.PI) / 180;
      const [x, y] = [Math.cos(a) / 2, Math.sin(a) / 2];
      defs.push(`<linearGradient id="bg" x1="${0.5 - x}" y1="${0.5 - y}" x2="${0.5 + x}" y2="${0.5 + y}">${f.colors.map((c, i) => `<stop offset="${i / (f.colors.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient>`);
      body.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="url(#bg)"/>`);
    } else if (f.kind === 'radial' && f.colors.length > 1) {
      defs.push(`<radialGradient id="bg">${f.colors.map((c, i) => `<stop offset="${i / (f.colors.length - 1)}" stop-color="${c}"/>`).join('')}</radialGradient>`);
      body.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="url(#bg)"/>`);
    } else {
      body.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="${f.colors[0] ?? '#000'}"/>`);
    }
  }
  const pat = p.background.pattern;
  if (!transparent && pat && pat.opacity > 0) {
    const s = Math.max(2, pat.size);
    const w = pat.weight;
    const attrs = `fill="${pat.color}" fill-opacity="${pat.opacity}"`;
    const cell =
      pat.kind === 'grid'
        ? `<rect x="${-w / 2}" y="0" width="${w}" height="${s}" ${attrs}/><rect x="0" y="${-w / 2}" width="${s}" height="${w}" ${attrs}/>`
        : pat.kind === 'lines'
          ? `<rect x="0" y="${-w / 2}" width="${s}" height="${w}" ${attrs}/>`
          : pat.kind === 'dots'
            ? `<circle cx="${s / 2}" cy="${s / 2}" r="${w}" ${attrs}/>`
            : pat.kind === 'checker'
              ? `<rect width="${s}" height="${s}" ${attrs}/><rect x="${s}" y="${s}" width="${s}" height="${s}" ${attrs}/>`
              : `<rect x="0" y="${-w / 2}" width="${s * 1.5}" height="${w}" ${attrs}/>`;
    const size = pat.kind === 'checker' ? s * 2 : pat.kind === 'doodles' ? s * 4 : s;
    const rot = pat.kind === 'diagonal' ? ` patternTransform="rotate(-45)"` : '';
    if (pat.kind === 'doodles') {
      defs.push(`<pattern id="pat" patternUnits="userSpaceOnUse" width="${size}" height="${size}">${doodleTile(s, w, pat.color, pat.opacity)}</pattern>`);
      body.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="url(#pat)"/>`);
    } else {
    // The pattern's origin is the artboard centre, as on the canvas.
      defs.push(`<pattern id="pat" patternUnits="userSpaceOnUse" width="${size}" height="${size}"${rot}>${cell}</pattern>`);
      body.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="url(#pat)"/>`);
    }
  }
  const t = p.background.tile;
  if (t) {
    const r = (t.size * Math.min(W, H)) / 2;
    const rx = t.shape === 'circle' ? r : t.shape === 'rounded' ? t.radius * r : r * (0.25 + 0.35 * t.radius);
    body.push(`<rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" rx="${rx}" fill="${t.fill.colors[0] ?? '#fff'}"/>`);
  }
  for (const path of out.paths) {
    const obj = objects.find((o) => o.id === path.id);
    const st = obj?.style;
    if (!st || !path.d || obj.guide) continue;
    const soft = (st.soften ?? 0) > 0;
    if (soft) defs.push(`<filter id="soft${defs.length}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${((st.soften ?? 0) * 0.6).toFixed(2)}"/></filter>`);
    const softId = soft ? `soft${defs.length - 1}` : '';
    const mix = (st.opacity ?? 1) < 1 || (st.blend && st.blend !== 'normal') || soft;
    const clipD = obj.clip ? out.paths.find((x) => x.id === obj.clip)?.d : null;
    if (clipD) {
      defs.push(`<clipPath id="frame${defs.length}"><path d="${clipD}"/></clipPath>`);
      body.push(`<g clip-path="url(#frame${defs.length - 1})">`);
    }
    if (mix) body.push(`<g${(st.opacity ?? 1) < 1 ? ` opacity="${st.opacity}"` : ''}${st.blend && st.blend !== 'normal' ? ` style="mix-blend-mode:${st.blend}"` : ''}${soft ? ` filter="url(#${softId})"` : ''}>`);
    emitObject(path, st);
    if (mix) body.push('</g>');
    if (clipD) body.push('</g>');
  }
  function emitObject(path: { id: string; d: string }, st: Style) {
    const dp = st.depth;
    if (dp && dp.amount > 0) {
      // Extrusion: copies of the outline stepping back, darkening toward the back.
      const a = (dp.angle * Math.PI) / 180;
      const steps = Math.min(64, Math.max(2, Math.ceil(dp.amount / 1.5)));
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(dp.color.slice(i, i + 2), 16));
      for (let i = steps; i >= 1; i--) {
        const t = (i / steps) * dp.amount;
        const k = 1 - dp.shade * (i / steps);
        body.push(`<path d="${path.d}" transform="translate(${(Math.sin(a) * t).toFixed(2)} ${(-Math.cos(a) * t).toFixed(2)})" fill="rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})"/>`);
      }
    }
    const paint = svgPaint(st);
    if (paint.defs) defs.push(paint.defs);
    const pic = st.effect === 'photo' ? imageAsset(String(st.params.image ?? '')) : undefined;
    if (pic) {
      // The picture clipped to the outline, framed like the canvas (cover, zoom, pan).
      const b = pathBounds(path.d);
      if (b) {
        const id = `ph${defs.length}`;
        // Same framing as the Photo shader: cover the box, then zoom and pan.
        const z = Math.max(1, Number(st.params.zoom ?? 1));
        const bw = b[2] - b[0];
        const bh = b[3] - b[1];
        const ba = bw / bh;
        const ia = pic.w / pic.h;
        const cx = ba < ia ? ba / ia : 1;
        const cy = ba > ia ? ia / ba : 1;
        const iw = (bw * z) / cx;
        const ih = (bh * z) / cy;
        const u0 = 0.5 - (0.5 * cx) / z + Number(st.params.x ?? 0) * 0.5 * (1 - 1 / z);
        const v0 = 0.5 - (0.5 * cy) / z + Number(st.params.y ?? 0) * 0.5 * (1 - 1 / z);
        const ix = b[0] - u0 * iw;
        const iy = b[1] - v0 * ih;
        defs.push(`<clipPath id="${id}"><path d="${path.d}"/></clipPath>`);
        body.push(`<image href="${pic.data}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" preserveAspectRatio="none" clip-path="url(#${id})"/>`);
        return;
      }
    }
    const sk = st.stroke;
    if (sk && sk.width > 0 && sk.opacity > 0) {
      // SVG strokes are centred: outside paints under the fill at twice the width, inside clips to the shape.
      const w = sk.align === 'center' ? sk.width : sk.width * 2;
      const attrs = `fill="none" stroke="${sk.color}" stroke-width="${w}" stroke-linejoin="round"${sk.opacity < 1 ? ` stroke-opacity="${sk.opacity}"` : ''}`;
      if (sk.align === 'outside') body.push(`<path d="${path.d}" ${attrs}/>`);
      body.push(`<path d="${path.d}" fill="${paint.fill}" fill-rule="nonzero"${paint.extra}/>`);
      if (sk.align === 'center') body.push(`<path d="${path.d}" ${attrs}/>`);
      if (sk.align === 'inside') {
        const id = `clip${defs.length}`;
        defs.push(`<clipPath id="${id}"><path d="${path.d}"/></clipPath>`);
        body.push(`<path d="${path.d}" ${attrs} clip-path="url(#${id})"/>`);
      }
      return;
    }
    body.push(`<path d="${path.d}" fill="${paint.fill}" fill-rule="nonzero"${paint.extra}/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" width="${W}" height="${H}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}</svg>`;
}

/** A 4×4 tile of doodles (cell `s`, line `w`) for SVG patterns, mirroring the canvas doodle set. */
function doodleTile(s: number, w: number, color: string, opacity: number) {
  const out: string[] = [];
  const line = `fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const h = rnd();
      const cx = (i + 0.5 + (rnd() - 0.5) * 0.3) * s;
      const cy = (j + 0.5 + (rnd() - 0.5) * 0.3) * s;
      const ang = rnd() * 360;
      const r = s * 0.24;
      const f = (v: number) => v.toFixed(1);
      let d: string;
      if (h < 0.24) {
        const pts = Array.from({ length: 13 }, (_, k) => {
          const x = -r * 1.3 + (k / 12) * r * 2.6;
          return `${f(x)} ${f(Math.sin((x / r) * Math.PI) * r * 0.42)}`;
        });
        d = `<path d="M${pts.join(' L')}" ${line}/>`;
      } else if (h < 0.4) d = `<path d="M${f(-r * 0.6)} ${f(-r * 0.6)}L${f(r * 0.6)} ${f(r * 0.6)}M${f(-r * 0.6)} ${f(r * 0.6)}L${f(r * 0.6)} ${f(-r * 0.6)}" ${line}/>`;
      else if (h < 0.62) d = `<circle r="${f(r * 0.32)}" fill="${color}" fill-opacity="${opacity}"/>`;
      else if (h < 0.76) d = `<circle r="${f(r * 0.55)}" ${line}/>`;
      else if (h < 0.9) d = `<path d="M${f(r * 0.7 * Math.cos(2))} ${f(-r * 0.7 * Math.sin(2))}A${f(r * 0.7)} ${f(r * 0.7)} 0 1 1 ${f(r * 0.7 * Math.cos(2))} ${f(r * 0.7 * Math.sin(2))}" ${line}/>`;
      else d = `<path d="M${f(-r * 0.6)} 0H${f(r * 0.6)}M0 ${f(-r * 0.6)}V${f(r * 0.6)}" ${line}/>`;
      out.push(`<g transform="translate(${f(cx)} ${f(cy)}) rotate(${f(ang)})">${d}</g>`);
    }
  }
  return out.join('');
}

export async function exportSVG() {
  const p = store.get().project;
  try {
    const svg = await buildSvg();
    if (await platform().save(`${slug(p.name)}.svg`, svg, { name: 'SVG', extensions: ['svg'] })) toast('SVG exported');
  } catch (e) {
    toast(`SVG export failed: ${errorText(e)}`, 'error');
  }
}

/** CSS for the artboard background (cheap previews outside the GPU). */
export function backgroundCss(b: Background) {
  return bgCss(b);
}
