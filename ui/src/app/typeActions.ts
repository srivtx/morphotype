import { engine } from '../engine/client';
import type { FontSpec, GlyphEdit, GlyphPart, SymbolKind } from '../engine/types';
import { registerCssFont } from '../fonts/library';
import { platform } from '../platform';
import { isGroup, SYMBOL_DEFAULTS, SYMBOL_UI, textLayer, uid, type TypeProject } from '../state/model';
import type { ModEntry } from '../engine/types';
import { allLayers } from '../state/tree';
import { edit, store, toast, undo } from '../state/store';
import { addShape, errorText, primaryNode, registerFontEntry, slug } from './actions';
import { zip } from './zip';

export const CHARSETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  punct: '.,:;!?\'"-–—()[]&@#%*/+=<>$€£©®™…',
};
export const DEFAULT_CHARSET = CHARSETS.upper + CHARSETS.lower + CHARSETS.digits + CHARSETS.punct;

export interface NewFontOptions {
  family: string;
  base: string;
  blank: boolean;
  charset: string;
  /** Modifiers to start with (a look). */
  modifiers?: ModEntry[];
  axes?: Record<string, number>;
  morph?: TypeProject['morph'];
}

/** What a new font starts from when nothing else is said: the selected text layer, if any. */
export function newFontDefaults(): NewFontOptions {
  const s = store.get();
  const n = primaryNode();
  const t = n && !isGroup(n) && n.content.type === 'text' ? n : null;
  const c = t?.content.type === 'text' ? t.content : null;
  const base = c?.font && s.fonts.some((f) => f.id === c.font && f.source !== 'custom') ? c.font : s.fonts.some((f) => f.id === 'archivo') ? 'archivo' : (s.fonts[0]?.id ?? 'archivo');
  const info = s.fonts.find((f) => f.id === base)?.info;
  return {
    family: `${(info?.family ?? 'Morpho').split(' ')[0]} ${t ? 'Morph' : 'Studio'}`,
    base,
    blank: false,
    charset: DEFAULT_CHARSET,
    modifiers: t ? structuredClone(t.modifiers.filter((m) => !['arc', 'perspective', 'warp', 'wave'].includes(m.kind))) : [],
    axes: c?.axes ?? {},
    morph: c?.morph ?? null,
  };
}

/** Start a font project. */
export function createTypeProject(o: NewFontOptions): TypeProject {
  const tp: TypeProject = {
    id: uid('f'),
    blank: o.blank || undefined,
    family: o.family.trim() || 'Untitled Sans',
    style: 'Regular',
    base: o.base,
    axes: o.axes ?? {},
    morph: o.blank ? null : (o.morph ?? null),
    modifiers: o.modifiers ?? [],
    tracking: 0,
    charset: o.charset,
    glyphs: {},
    sample: 'Sphinx of black quartz, judge my vow',
  };
  edit((p) => (p.type = tp));
  store.set({ glyph: [...o.charset][0] ?? 'A' });
  return tp;
}

/** The font being designed (created from defaults if there isn't one). */
export function ensureTypeProject(): TypeProject {
  return store.get().project.type ?? createTypeProject(newFontDefaults());
}

/** Close the current font so a new one can be started (undoable). */
export function closeTypeProject() {
  edit((p) => {
    delete p.type;
  });
}

export function editType(fn: (t: TypeProject) => void, key = '') {
  edit((p) => {
    if (p.type) fn(p.type);
  }, key ? `type:${key}` : '');
}

export function specOf(t: TypeProject, opts: { quality?: number; format?: 'ttf' | 'woff' } = {}): FontSpec {
  const glyphs: GlyphEdit[] = Object.entries(t.glyphs)
    .filter(([, g]) => g.d || g.advance !== undefined || g.modifiers?.length || g.parts?.length || g.ownLook || g.hideBase)
    .map(([ch, g]) => ({ ch, d: g.d, advance: g.advance, modifiers: g.modifiers ?? [], parts: g.parts, ownLook: g.ownLook, hideBase: g.hideBase }));
  return {
    font: t.base,
    axes: t.axes,
    morph: t.morph,
    modifiers: t.modifiers,
    family: t.family,
    style: t.style,
    charset: t.charset,
    glyphs,
    tracking: t.tracking,
    quality: opts.quality,
    format: opts.format,
    blank: t.blank,
    version: versionOf(t.revision),
  };
}

/** Font version for a revision: 1.000, 1.001, 1.002… */
export const versionOf = (revision = 0) => (1 + revision / 1000).toFixed(3);

/**
 * Give the next file out a new version, so installing it replaces the
 * previous one instead of macOS serving the cached copy. Not an undo step.
 */
function bumpVersion() {
  const { project } = store.get();
  if (!project.type) return;
  store.set({ project: { ...project, type: { ...project.type, revision: (project.type.revision ?? 0) + 1 } } });
}

/** A plain block to start drawing from, sized to the font's lines. */
function starterShape(ch: string, cap: number, x: number) {
  const h = /[a-z]/.test(ch) && !/[bdfhklt]/.test(ch) ? x : cap;
  const w = Math.max(0.3, h * 0.7);
  const f = (v: number) => Number(v.toFixed(4));
  return { d: `M0.08 0L0.08 ${f(-h)}L${f(0.08 + w)} ${f(-h)}L${f(0.08 + w)} 0Z`, advance: f(w + 0.16) };
}

/**
 * Start customising a glyph. `from` = 'base' copies the base font's outline;
 * 'scratch' starts from a plain block (the base outline stays as a guide).
 */
export async function customizeGlyph(ch: string, from: 'base' | 'scratch' = store.get().project.type?.blank ? 'scratch' : 'base') {
  const t = store.get().project.type;
  if (!t) return;
  if (t.glyphs[ch]?.d) return;
  try {
    const g = await engine.glyphPath(t.base, t.axes, ch);
    const info = store.get().fonts.find((f) => f.id === t.base)?.info;
    const upm = info?.unitsPerEm ?? 1000;
    const starter = starterShape(ch, (info?.capHeight ?? 700) / upm, (info?.xHeight ?? 500) / upm);
    const useBase = from === 'base' && g.exists;
    editType((tp) => {
      tp.glyphs[ch] = { ...(tp.glyphs[ch] ?? {}), d: useBase ? g.d : starter.d, advance: tp.glyphs[ch]?.advance ?? (useBase ? g.advance : g.exists ? g.advance : starter.advance) };
    });
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

export function resetGlyph(ch: string) {
  editType((tp) => {
    delete tp.glyphs[ch];
  });
}

export function addCharacters(text: string) {
  const chars = [...new Set([...text].filter((c) => c.trim() && !/\p{C}/u.test(c)))];
  if (!chars.length) return;
  editType((tp) => {
    for (const c of chars) if (!tp.charset.includes(c)) tp.charset += c;
  });
  store.set({ glyph: chars[0] });
}

export function removeCharacter(ch: string) {
  editType((tp) => {
    tp.charset = [...tp.charset].filter((c) => c !== ch).join('');
    delete tp.glyphs[ch];
  });
}

function fileBase(t: TypeProject) {
  return `${slug(t.family).replace(/-/g, '')}-${slug(t.style).replace(/-/g, '')}`;
}

async function compile(format: 'ttf' | 'woff', quality?: number) {
  const t = store.get().project.type;
  if (!t) throw new Error('No font yet.');
  if (!t.family.trim()) throw new Error('Give the font a family name first.');
  return engine.exportFont(specOf(t, { format, quality }));
}

export async function exportFontFile(format: 'ttf' | 'woff') {
  const t = store.get().project.type!;
  try {
    bumpVersion();
    const bytes = await compile(format);
    const name = `${fileBase(t)}.${format}`;
    if (await platform().save(name, bytes, { name: format === 'ttf' ? 'TrueType font' : 'Web font', extensions: [format] })) toast(`Exported ${name} (${(bytes.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    toast(`Font export failed: ${errorText(e)}`, 'error');
  }
}

export function fontFaceCss(t: TypeProject, base: string) {
  const weight = t.style.match(/thin|light|regular|medium|semi|bold|black|heavy/i)?.[0]?.toLowerCase();
  const w = { thin: 100, light: 300, regular: 400, medium: 500, semi: 600, bold: 700, black: 900, heavy: 900 }[weight ?? 'regular'] ?? 400;
  return `@font-face {
  font-family: "${t.family}";
  src: url("${base}.woff") format("woff"),
       url("${base}.ttf") format("truetype");
  font-weight: ${w};
  font-style: ${/italic|oblique/i.test(t.style) ? 'italic' : 'normal'};
  font-display: swap;
}
`;
}

/** Zip with TTF + WOFF + CSS + a specimen page, ready to host. */
export async function exportWebKit() {
  const t = store.get().project.type!;
  try {
    bumpVersion();
    const [ttf, woff] = [await compile('ttf'), await compile('woff')];
    const base = fileBase(t);
    const css = fontFaceCss(t, base);
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.family} ${t.style}</title>
<link rel="stylesheet" href="${base}.css">
<style>body{margin:0;padding:48px;background:#0d0d10;color:#f2f0ea;font-family:"${t.family}",system-ui}h1{font-size:15vw;line-height:.9;margin:0 0 32px}p{font-size:40px;margin:0 0 24px;word-break:break-all}small{font-family:system-ui;color:#888}</style>
</head><body>
<h1>${t.family}</h1>
<p>${[...t.charset].map((c) => (c === '<' ? '&lt;' : c === '&' ? '&amp;' : c)).join('')}</p>
<p>${t.sample.replace(/</g, '&lt;')}</p>
<small>Made with Morphotype. Use it with: font-family: "${t.family}";</small>
</body></html>
`;
    const bytes = zip([
      { name: `${base}/${base}.ttf`, data: ttf },
      { name: `${base}/${base}.woff`, data: woff },
      { name: `${base}/${base}.css`, data: css },
      { name: `${base}/index.html`, data: html },
    ]);
    if (await platform().save(`${base}-webfont.zip`, bytes, { name: 'Zip archive', extensions: ['zip'] })) toast('Web font kit exported: TTF, WOFF, CSS and a specimen page');
  } catch (e) {
    toast(`Font export failed: ${errorText(e)}`, 'error');
  }
}

export async function installOnMac() {
  const t = store.get().project.type!;
  const p = platform();
  if (!p.installFont) return;
  try {
    bumpVersion();
    const bytes = await compile('ttf');
    const where = await p.installFont(`${fileBase(t)}.ttf`, bytes);
    toast(`Installed ${t.family}. ${where}`);
  } catch (e) {
    toast(`Couldn't install: ${errorText(e)}`, 'error');
  }
}

/** Id of the font in Design mode's font list. */
export function customFontId(t: TypeProject) {
  return `custom-${t.id ?? slug(t.family).toLowerCase()}`;
}

/** Plain-language list of what makes this font different from its base. */
export function fontChanges(t: TypeProject): string[] {
  const base = store.get().fonts.find((f) => f.id === t.base)?.name ?? t.base;
  const out: string[] = [];
  if (t.blank) out.push(`Drawn from scratch, using ${base}'s line heights`);
  else out.push(`Built on ${base}`);
  if (t.morph) out.push(`Blended ${Math.round(t.morph.t * 100)}% towards ${store.get().fonts.find((f) => f.id === t.morph?.font)?.name ?? t.morph.font}`);
  const looks = t.modifiers.filter((m) => m.on).map((m) => m.kind);
  if (looks.length) out.push(`Look on every glyph: ${[...new Set(looks)].join(', ')}`);
  const drawn = Object.entries(t.glyphs).filter(([, g]) => g.d).map(([c]) => c);
  if (drawn.length) out.push(`${drawn.length} glyph${drawn.length > 1 ? 's' : ''} ${t.blank ? 'drawn' : 'redrawn'}: ${drawn.slice(0, 12).join(' ')}${drawn.length > 12 ? ' …' : ''}`);
  const widths = Object.values(t.glyphs).filter((g) => g.advance !== undefined && !g.d).length;
  if (widths) out.push(`${widths} custom width${widths > 1 ? 's' : ''}`);
  const own = Object.values(t.glyphs).filter((g) => g.modifiers?.length).length;
  if (own) out.push(`${own} glyph${own > 1 ? 's' : ''} with their own modifiers`);
  if (Math.abs(t.tracking) > 1e-4) out.push(`Spacing ${t.tracking > 0 ? '+' : ''}${t.tracking.toFixed(3)} em`);
  if (out.length === 1 && !t.blank) out.push('No changes yet: it will look exactly like the base font');
  return out;
}

/** Names an OFL font reserves in its copyright notice ("with Reserved Font Name 'X'"). */
export function reservedNames(copyright = ''): string[] {
  const out: string[] = [];
  for (const m of copyright.matchAll(/Reserved Font Names?\s*:?\s*((?:["'“‘][^"'”’]+["'”’](?:\s*(?:,|and)\s*)?)+)/gi)) {
    for (const n of m[1].matchAll(/["'“‘]([^"'”’]+)["'”’]/g)) out.push(n[1].trim());
  }
  return out;
}

/** Whether a family name is too close to the base font's (OFL fonts reserve their names). */
export function nameClash(t: TypeProject, family = t.family): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const fonts = store.get().fonts;
  const base = fonts.find((f) => f.id === t.base)?.info;
  const baseFamily = base?.family ?? '';
  if (!family.trim()) return 'Give the font a name.';
  if (baseFamily && !t.blank && norm(family).startsWith(norm(baseFamily)) && norm(baseFamily).length > 2) return `Pick a name that doesn't start with “${baseFamily}”. Modified fonts need their own name, and OFL fonts reserve theirs.`;
  const sources = [base, t.morph ? fonts.find((f) => f.id === t.morph?.font)?.info : undefined];
  const reserved = t.blank ? [] : sources.flatMap((i) => reservedNames(i?.copyright));
  const hit = reserved.find((r) => norm(r).length > 2 && norm(family).includes(norm(r)));
  if (hit) return `“${hit}” is a Reserved Font Name of the font you started from. Pick a name without it.`;
  return null;
}

export type UseMode = 'list' | 'add' | 'replace';

/**
 * Compile the font into Design mode's font list. `replace` switches text set
 * in the base font to it; `add` adds a text layer set in it.
 */
export async function useInDesign(mode: UseMode = 'list') {
  const t = store.get().project.type!;
  try {
    const bytes = await compile('ttf', 200);
    const id = customFontId(t);
    const info = await engine.loadFont(id, bytes);
    registerCssFont(id, bytes);
    registerFontEntry({ id, name: `${t.family} ${t.style}`.trim(), source: 'custom', info });
    // Text already using this font picks up the new outlines on the next build.
    edit((p) => {
      if (!p.type) return;
      p.type.id ??= t.id ?? slug(t.family).toLowerCase();
    });
    if (mode === 'replace') {
      let n = 0;
      edit((p) => {
        for (const l of allLayers(p.layers)) if (l.content.type === 'text' && l.content.font === t.base) (l.content.font = id), (l.content.axes = {}), n++;
      });
      store.set({ mode: 'design', editing: null });
      toast(n ? `${t.family} now sets ${n} text layer${n > 1 ? 's' : ''}` : `${t.family} is in your font list`);
    } else if (mode === 'add') {
      store.set({ mode: 'design', editing: null });
      addShape(textLayer(t.family.split(' ')[0] || 'Type', id));
      toast(`${t.family} is ready in Design mode`);
    } else {
      toast(`${t.family} is in your font list`, 'info', { label: 'Type with it', run: () => void useInDesign('add') });
    }
  } catch (e) {
    toast(`Couldn't build the font: ${errorText(e)}`, 'error');
  }
}

// ---------- glyph layers ----------

function fontMetrics(t: TypeProject) {
  const info = store.get().fonts.find((f) => f.id === t.base)?.info;
  const upm = info?.unitsPerEm ?? 1000;
  return { cap: (info?.capHeight ?? 700) / upm, x: (info?.xHeight ?? 500) / upm };
}

/** Add a layer to a glyph (a library shape or another glyph) and select it. */
export function addGlyphPart(ch: string, what: { symbol: SymbolKind } | { glyph: string }, advance = 0.6) {
  const t = store.get().project.type;
  if (!t) return;
  const m = fontMetrics(t);
  const lower = /[a-z]/.test(ch);
  const part: GlyphPart =
    'symbol' in what
      ? {
          id: uid('gp'),
          name: SYMBOL_UI[what.symbol]?.label,
          symbol: structuredClone(SYMBOL_DEFAULTS[what.symbol]),
          op: 'add',
          x: advance / 2,
          y: -(lower ? m.x : m.cap) / 2,
          size: (lower ? m.x : m.cap) * 0.45,
          rotation: 0,
          sx: 1,
          sy: 1,
          modifiers: [],
          visible: true,
        }
      : { id: uid('gp'), name: `“${what.glyph}”`, glyph: what.glyph, op: 'add', x: 0, y: 0, size: 1, rotation: 0, sx: 1, sy: 1, modifiers: [], visible: true };
  editType((tp) => {
    const g = (tp.glyphs[ch] ??= {});
    g.parts = [...(g.parts ?? []), part];
  });
  store.set({ glyphPart: part.id });
  return part.id;
}

export function editGlyphPart(ch: string, id: string, fn: (p: GlyphPart) => void, key = '') {
  editType((tp) => {
    const p = tp.glyphs[ch]?.parts?.find((x) => x.id === id);
    if (p) fn(p);
  }, key ? `part:${id}:${key}` : '');
}

export function removeGlyphPart(ch: string, id: string) {
  editType((tp) => {
    const g = tp.glyphs[ch];
    if (g?.parts) g.parts = g.parts.filter((p) => p.id !== id);
  });
  if (store.get().glyphPart === id) store.set({ glyphPart: null });
}

export function duplicateGlyphPart(ch: string, id: string) {
  const src = store.get().project.type?.glyphs[ch]?.parts?.find((p) => p.id === id);
  if (!src) return;
  const copy: GlyphPart = { ...structuredClone(src), id: uid('gp'), x: src.x + 0.05, y: src.y - 0.05 };
  editType((tp) => {
    const g = tp.glyphs[ch];
    if (!g?.parts) return;
    g.parts.splice(g.parts.findIndex((p) => p.id === id) + 1, 0, copy);
  });
  store.set({ glyphPart: copy.id });
}

/** Move a layer up (toward the top, +1) or down in its glyph's stack. */
export function reorderGlyphPart(ch: string, id: string, dir: 1 | -1) {
  editType((tp) => {
    const parts = tp.glyphs[ch]?.parts;
    if (!parts) return;
    const i = parts.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= parts.length) return;
    [parts[i], parts[j]] = [parts[j], parts[i]];
  });
}

/**
 * Turn the finished glyph (layers, look and all) into one editable outline,
 * so its points can be reshaped by hand. The glyph then has its own look.
 */
export async function bakeGlyph(ch: string) {
  const t = store.get().project.type;
  if (!t) return;
  try {
    const [p] = await engine.fontPreview(specOf(t, { quality: 320 }), ch);
    if (!p?.d) return toast(`“${ch}” is empty, so there's nothing to bake.`, 'error');
    // Fit curves so the outline has few, editable points.
    const baked = await engine.bake({ layers: [{ id: 'g', visible: true, op: 'add', x: 0, y: 0, rotation: 0, scale: 1, sx: 1, sy: 1, modifiers: [], content: { type: 'path', d: p.d, size: 1 } }] }, 'g');
    editType((tp) => {
      tp.glyphs[ch] = { d: baked.d, advance: Math.max(0, p.advance - tp.tracking), ownLook: true };
    });
    store.set({ glyphPart: null });
    toast(`Baked “${ch}” into points`, 'info', { label: 'Undo', run: undo });
  } catch (e) {
    toast(errorText(e), 'error');
  }
}
