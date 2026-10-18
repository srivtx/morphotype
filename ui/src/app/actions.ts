import { engine } from '../engine/client';
import type { Box, Content, ModEntry } from '../engine/types';
import { fromBase64, importFontBytes, registerCssFont, toBase64, type FontEntry } from '../fonts/library';
import { platform } from '../platform';
import { fillCss } from '../render/background';
import { defaultParams, effectById, type Preset } from '../render/effects';
import type { Renderer } from '../render/renderer';
import { migrate } from '../state/migrate';
import { group, isGroup, pathLayer, textLayer, uid, type Background, type Group, type Node, type Project, type ShapeLayer, type Style } from '../state/model';
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

/** Insert above the current selection (inside the same group), or on top. */
export function addNode(n: Node, opts: { parent?: string | null; index?: number } = {}) {
  const s = store.get();
  let parent = opts.parent;
  let index = opts.index;
  if (parent === undefined) {
    const anchor = s.selection.at(-1);
    const f = anchor ? find(s.project.layers, anchor) : null;
    if (f && !(isGroup(f.node) && f.node.merge === false && false)) {
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

/** Text, shapes and paths get sensible defaults: centred, style of the selection if any. */
export function addShape(l: ShapeLayer) {
  const prev = primaryNode();
  if (prev && !isGroup(prev) && prev.op === 'add') l.style = structuredClone(prev.style);
  addNode(l);
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

export function duplicateSelected(offset = 24) {
  const s = store.get();
  const ids = topmost(s.project.layers, s.selection);
  if (!ids.length) return;
  const made: string[] = [];
  edit((p) => {
    const map = new Map<string, string>();
    const copies: { at: Node[]; index: number; node: Node }[] = [];
    for (const id of ids) {
      const f = find(p.layers, id);
      if (!f) continue;
      const c = cloneWithIds(f.node, map);
      offsetNode(c, offset, offset);
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

export function applyStyle(st: Style, ids = store.get().selection) {
  edit((p) => {
    for (const id of ids) {
      const n = findNode(p.layers, id);
      if (!n) continue;
      // A plain group passes the style to every child; merged groups own it.
      if (isGroup(n) && !n.merge) for (const l of allLayers(n.children)) l.style = structuredClone(st);
      else n.style = structuredClone(st);
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
    styleClipboard = structuredClone(st);
    toast('Style copied');
  }
}
export function pasteStyle() {
  if (styleClipboard) applyStyle(styleClipboard);
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

export async function editPoints(id: string) {
  const l = findNode(store.get().project.layers, id);
  if (!l || isGroup(l)) return;
  const needs = !(l.content.type === 'path' && l.modifiers.length === 0);
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

function usedImportedFonts(p: Project): string[] {
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
  const ok = await platform().save(`${slug(p.name)}.morpho`, JSON.stringify(p), PROJECT_FILTER);
  if (ok) toast('Project saved');
}

export async function openProject(files?: { name: string; bytes: Uint8Array }[]) {
  const picked = files ?? (await platform().open([PROJECT_FILTER]));
  const f = picked[0];
  if (!f) return;
  try {
    const p = migrate(JSON.parse(new TextDecoder().decode(f.bytes)));
    for (const font of p.fonts ?? []) {
      if (!font.data || store.get().fonts.some((x) => x.id === font.id)) continue;
      const bytes = fromBase64(font.data);
      const info = await engine.loadFont(font.id, bytes);
      registerCssFont(font.id, bytes);
      registerFonts([{ id: font.id, name: font.name ?? info.family, source: 'imported', info }]);
    }
    replaceProject({ ...p, fonts: [] });
    window.dispatchEvent(new Event('mt-fit'));
    toast(`Opened ${p.name}`);
  } catch (e) {
    toast(`Couldn't open ${f.name}: ${errorText(e)}`, 'error');
  }
}

// ---------- exports ----------

async function freshRender() {
  if (!renderer) throw new Error('The GPU preview isn’t available.');
  // Make sure the renderer has the latest geometry.
  const { doc } = buildScene(store.get().project);
  await engine.build(doc);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  return renderer;
}

export async function exportPNG(scale = store.get().settings.pngScale, transparent = store.get().settings.exportTransparent) {
  try {
    const r = await freshRender();
    const bytes = await r.exportPNG(scale, transparent);
    const p = store.get().project;
    if (await platform().save(`${slug(p.name)}@${scale}x.png`, bytes, { name: 'PNG image', extensions: ['png'] })) toast('PNG exported');
  } catch (e) {
    toast(`PNG export failed: ${errorText(e)}`, 'error');
  }
}

export async function exportJPG(scale = 2) {
  try {
    const r = await freshRender();
    const blob = await r.toBlob(scale, false, 'image/jpeg');
    const p = store.get().project;
    if (await platform().save(`${slug(p.name)}@${scale}x.jpg`, new Uint8Array(await blob.arrayBuffer()), { name: 'JPEG image', extensions: ['jpg'] })) toast('JPG exported');
  } catch (e) {
    toast(`JPG export failed: ${errorText(e)}`, 'error');
  }
}

export async function copyPNG() {
  try {
    const r = await freshRender();
    const blob = await r.toBlob(2, store.get().settings.exportTransparent);
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
      return { fill: c('ink'), extra: '', defs: '' };
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
  const t = p.background.tile;
  if (t) {
    const r = (t.size * Math.min(W, H)) / 2;
    const rx = t.shape === 'circle' ? r : t.shape === 'rounded' ? t.radius * r : r * (0.25 + 0.35 * t.radius);
    body.push(`<rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" rx="${rx}" fill="${t.fill.colors[0] ?? '#fff'}"/>`);
  }
  for (const path of out.paths) {
    const st = objects.find((o) => o.id === path.id)?.style;
    if (!st || !path.d) continue;
    const paint = svgPaint(st);
    if (paint.defs) defs.push(paint.defs);
    body.push(`<path d="${path.d}" fill="${paint.fill}" fill-rule="nonzero"${paint.extra}/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" width="${W}" height="${H}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}</svg>`;
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
  return fillCss(b.fill);
}
