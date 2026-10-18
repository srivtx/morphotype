import { engine } from '../engine/client';
import type { FontSpec, GlyphEdit } from '../engine/types';
import { registerCssFont } from '../fonts/library';
import { platform } from '../platform';
import { isGroup, textLayer, uid, type TypeProject } from '../state/model';
import type { ModEntry } from '../engine/types';
import { allLayers } from '../state/tree';
import { edit, store, toast } from '../state/store';
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
    .filter(([, g]) => g.d || g.advance !== undefined || g.modifiers?.length)
    .map(([ch, g]) => ({ ch, d: g.d, advance: g.advance, modifiers: g.modifiers ?? [] }));
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
  };
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

/** Whether a family name is too close to the base font's (OFL fonts reserve their names). */
export function nameClash(t: TypeProject, family = t.family): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const baseFamily = store.get().fonts.find((f) => f.id === t.base)?.info.family ?? '';
  if (!family.trim()) return 'Give the font a name.';
  if (baseFamily && !t.blank && norm(family).startsWith(norm(baseFamily)) && norm(baseFamily).length > 2) return `Pick a name that doesn't start with “${baseFamily}”. Modified fonts need their own name, and OFL fonts reserve theirs.`;
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
