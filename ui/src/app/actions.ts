import { engine } from '../engine/client';
import type { EngineDocument, Layer } from '../engine/types';
import { fromBase64, importFontBytes, toBase64, type FontEntry } from '../fonts/library';
import { platform } from '../platform';
import type { Renderer } from '../render/renderer';
import { uid, type Project } from '../state/model';
import { edit, replaceProject, store, toast } from '../state/store';

export const FONT_FILTER = { name: 'Fonts', extensions: ['ttf', 'otf', 'ttc', 'woff'] };
export const IMAGE_FILTER = { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] };
export const PROJECT_FILTER = { name: 'Morphotype project', extensions: ['morpho'] };

let renderer: Renderer | null = null;
export function setRenderer(r: Renderer | null) {
  renderer = r;
}

export function engineDoc(p: Project, quality?: number): EngineDocument {
  return { layers: p.layers, quality };
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function slug(s: string) {
  return s.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'morphotype';
}

// ---------- layers ----------

export function selectedLayer(): Layer | undefined {
  const s = store.get();
  return s.project.layers.find((l) => l.id === s.selection);
}

export function updateLayer(id: string, fn: (l: Layer) => void, key = '') {
  edit((p) => {
    const l = p.layers.find((x) => x.id === id);
    if (l) fn(l);
  }, key ? `${id}:${key}` : '');
}

export function addLayer(l: Layer) {
  edit((p) => {
    p.layers.push(l);
  });
  store.set({ selection: l.id });
}

export function removeLayer(id: string) {
  const layers = store.get().project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx < 0) return;
  edit((p) => {
    p.layers = p.layers.filter((l) => l.id !== id);
  });
  const rest = store.get().project.layers;
  store.set({ selection: rest[Math.min(idx, rest.length - 1)]?.id ?? null });
}

export function duplicateLayer(id: string) {
  const l = store.get().project.layers.find((x) => x.id === id);
  if (!l) return;
  const copy: Layer = { ...structuredClone(l), id: uid(), x: l.x + 30, y: l.y + 30 };
  edit((p) => {
    const i = p.layers.findIndex((x) => x.id === id);
    p.layers.splice(i + 1, 0, copy);
  });
  store.set({ selection: copy.id });
}

export function moveLayer(id: string, dir: -1 | 1) {
  edit((p) => {
    const i = p.layers.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.layers.length) return;
    [p.layers[i], p.layers[j]] = [p.layers[j], p.layers[i]];
  });
}

// ---------- fonts ----------

function registerFonts(entries: FontEntry[]) {
  const known = new Set(store.get().fonts.map((f) => f.id));
  const fresh = entries.filter((f) => !known.has(f.id));
  if (fresh.length) store.set({ fonts: [...store.get().fonts, ...fresh] });
}

export async function importFonts(files?: { name: string; bytes: Uint8Array }[]): Promise<FontEntry | null> {
  const picked = files ?? (await platform().open([FONT_FILTER], true));
  let last: FontEntry | null = null;
  for (const f of picked) {
    try {
      const entry = await importFontBytes(f.bytes);
      registerFonts([entry]);
      // Collections: register every face.
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

export async function importImage(files?: { name: string; bytes: Uint8Array }[]) {
  const picked = files ?? (await platform().open([IMAGE_FILTER]));
  const f = picked[0];
  if (!f) return;
  try {
    const image = await imageDataFrom(f.bytes, f.name);
    store.set({ dialog: { kind: 'trace', image, name: f.name.replace(/\.[^.]+$/, '') } });
  } catch (e) {
    toast(`Couldn't read ${f.name}: ${errorText(e)}`, 'error');
  }
}

// ---------- projects ----------

function usedImportedFonts(p: Project): string[] {
  const ids = new Set<string>();
  for (const l of p.layers) {
    if (l.content.type !== 'text') continue;
    ids.add(l.content.font);
    if (l.content.morph) ids.add(l.content.morph.font);
  }
  const fonts = store.get().fonts;
  return [...ids].filter((id) => fonts.find((f) => f.id === id && f.source !== 'bundled'));
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
    const p = JSON.parse(new TextDecoder().decode(f.bytes)) as Project;
    if (p.version !== 1 || !Array.isArray(p.layers)) throw new Error('Not a Morphotype project.');
    for (const font of p.fonts ?? []) {
      if (!font.data || store.get().fonts.some((x) => x.id === font.id)) continue;
      const info = await engine.loadFont(font.id, fromBase64(font.data));
      registerFonts([{ id: font.id, name: font.name ?? info.family, source: 'imported', info }]);
    }
    replaceProject({ ...p, fonts: [] });
    toast(`Opened ${p.name}`);
  } catch (e) {
    toast(`Couldn't open ${f.name}: ${errorText(e)}`, 'error');
  }
}

// ---------- exports ----------

export async function exportPNG(scale: number, transparent: boolean) {
  if (!renderer) return;
  try {
    const out = await engine.build(engineDoc(store.get().project));
    renderer.setGeometry(out.d, out.bbox);
    const bytes = await renderer.exportPNG(scale, transparent);
    const p = store.get().project;
    if (await platform().save(`${slug(p.name)}@${scale}x.png`, bytes, { name: 'PNG image', extensions: ['png'] })) toast('PNG exported');
  } catch (e) {
    toast(`PNG export failed: ${errorText(e)}`, 'error');
  }
}

export async function exportSVG() {
  const p = store.get().project;
  const fill = String(p.effect.params.fill ?? p.effect.params.c2 ?? p.effect.params.glyph ?? p.effect.params.ink ?? '#000000');
  try {
    const svg = await engine.exportSvg(engineDoc(p), { fill, padding: 0.04 });
    if (await platform().save(`${slug(p.name)}.svg`, svg, { name: 'SVG', extensions: ['svg'] })) toast('SVG exported');
  } catch (e) {
    toast(`SVG export failed: ${errorText(e)}`, 'error');
  }
}
