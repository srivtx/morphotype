import { engine } from '../engine/client';
import type { FontSpec, GlyphEdit } from '../engine/types';
import { registerCssFont } from '../fonts/library';
import { platform } from '../platform';
import { isGroup, textLayer, type TypeProject } from '../state/model';
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

/** The font being designed, created on first use from the selected text layer. */
export function ensureTypeProject(): TypeProject {
  const s = store.get();
  if (s.project.type) return s.project.type;
  const n = primaryNode();
  const t = n && !isGroup(n) && n.content.type === 'text' ? n : null;
  const c = t?.content.type === 'text' ? t.content : null;
  const base = c?.font ?? (s.fonts.some((f) => f.id === 'archivo') ? 'archivo' : (s.fonts[0]?.id ?? 'archivo'));
  const info = s.fonts.find((f) => f.id === base)?.info;
  const tp: TypeProject = {
    family: `${info?.family ?? 'Morpho'} ${t ? 'Custom' : 'Sans'}`.replace(/^(.{0,40}).*$/, '$1'),
    style: 'Regular',
    base,
    axes: c?.axes ?? {},
    morph: c?.morph ?? null,
    modifiers: t ? structuredClone(t.modifiers.filter((m) => !['arc', 'perspective', 'warp', 'wave'].includes(m.kind))) : [],
    tracking: 0,
    charset: DEFAULT_CHARSET,
    glyphs: {},
    sample: 'Sphinx of black quartz, judge my vow',
  };
  edit((p) => (p.type = tp));
  return tp;
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
  };
}

/** Start customising a glyph from its base-font outline. */
export async function customizeGlyph(ch: string) {
  const t = store.get().project.type;
  if (!t) return;
  if (t.glyphs[ch]?.d) return;
  try {
    const g = await engine.glyphPath(t.base, t.axes, ch);
    editType((tp) => {
      tp.glyphs[ch] = { ...(tp.glyphs[ch] ?? {}), d: g.exists ? g.d : 'M0.08 0L0.08 -0.7L0.52 -0.7L0.52 0Z', advance: tp.glyphs[ch]?.advance ?? (g.exists ? g.advance : 0.6) };
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

/** Compile and add the font to the font list so Design mode can use it. */
export async function useInDesign(addText = false) {
  const t = store.get().project.type!;
  try {
    const bytes = await compile('ttf', 200);
    const id = `custom-${slug(t.family).toLowerCase()}`;
    const info = await engine.loadFont(id, bytes);
    registerCssFont(id, bytes);
    registerFontEntry({ id, name: `${t.family} ${t.style}`.trim(), source: 'custom', info });
    if (addText) {
      store.set({ mode: 'design' });
      addShape(textLayer(t.family.split(' ')[0] || 'Type', id));
    }
    toast(`${t.family} is ready to use in Design mode`, 'info', addText ? undefined : { label: 'Type with it', run: () => void useInDesign(true) });
  } catch (e) {
    toast(`Couldn't build the font: ${errorText(e)}`, 'error');
  }
}
