import { engine } from '../engine/client';
import type { FontInfo } from '../engine/types';

export interface FontEntry {
  id: string;
  name: string;
  source: 'bundled' | 'imported' | 'system' | 'custom';
  info: FontInfo;
}

/** Open-licensed fonts shipped with the app (see public/fonts/OFL.txt). */
export const BUNDLED: { id: string; file: string }[] = [
  { id: 'archivo', file: 'ArchivoBlack-Regular.woff' },
  { id: 'inter', file: 'Inter-Regular.woff' },
  { id: 'inter-black', file: 'Inter-Black.woff' },
  { id: 'space-grotesk', file: 'SpaceGrotesk-Bold.woff' },
  { id: 'playfair', file: 'PlayfairDisplay-Black.woff' },
  { id: 'rubik-mono', file: 'RubikMonoOne-Regular.woff' },
  { id: 'pacifico', file: 'Pacifico-Regular.woff' },
  { id: 'silkscreen', file: 'Silkscreen-Regular.woff' },
  { id: 'unbounded', file: 'Unbounded-ExtraBold.woff' },
  { id: 'bungee', file: 'Bungee-Regular.woff' },
  { id: 'dela-gothic', file: 'DelaGothicOne-Regular.woff' },
  { id: 'young-serif', file: 'YoungSerif-Regular.woff' },
  { id: 'bricolage', file: 'BricolageGrotesque-Variable.woff' },
  { id: 'caveat', file: 'Caveat-Variable.woff' },
  { id: 'caveat-brush', file: 'CaveatBrush-Regular.woff' },
  { id: 'anton', file: 'Anton-Regular.woff' },
];

/** Make the font usable in CSS (for previews in menus) as "mt-<id>". */
export function registerCssFont(id: string, bytes: Uint8Array) {
  try {
    const face = new FontFace(`mt-${id}`, bytes.slice().buffer as ArrayBuffer);
    void face.load().then((f) => document.fonts.add(f), () => undefined);
  } catch {
    // Previews are cosmetic; ignore faces the browser can't read.
  }
}

function displayName(info: FontInfo) {
  return info.style && info.style !== 'Regular' ? `${info.family} ${info.style}` : info.family;
}

export async function loadBundled(): Promise<FontEntry[]> {
  const base = import.meta.env.BASE_URL;
  const loaded = await Promise.all(
    BUNDLED.map(async (f): Promise<FontEntry | null> => {
      try {
        const res = await fetch(`${base}fonts/${f.file}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const info = await engine.loadFont(f.id, bytes);
        registerCssFont(f.id, bytes);
        return { id: f.id, name: displayName(info), source: 'bundled', info };
      } catch (e) {
        console.error(`Font ${f.file} failed to load`, e);
        return null;
      }
    }),
  );
  return loaded.filter((x): x is FontEntry => x !== null);
}

/** Stable id from the font bytes so re-importing the same file is a no-op. */
export async function fontId(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return 'u-' + Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function importFontBytes(bytes: Uint8Array, source: FontEntry['source'] = 'imported', index = 0): Promise<FontEntry> {
  const id = (await fontId(bytes)) + (index ? `-${index}` : '');
  const info = await engine.loadFont(id, bytes, index);
  if (index === 0) registerCssFont(id, bytes);
  return { id, name: displayName(info), source, info };
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
