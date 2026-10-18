// Pictures used by Photo materials. They live outside the project so edits
// and undo history never copy image data; the project refers to them by id,
// and .morpho files carry the ones in use.
import type { Project } from './model';
import { walk } from './tree';

export interface ImageAsset {
  id: string;
  /** Data URL (JPEG or PNG). */
  data: string;
  w: number;
  h: number;
  name?: string;
}

const assets = new Map<string, ImageAsset>();
const elements = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

/** Stable id from the data, so adding the same picture twice is a no-op. */
function hashOf(s: string): string {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(s.length / 4096));
  for (let i = 0; i < s.length; i += step) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `img-${(h >>> 0).toString(36)}-${s.length.toString(36)}`;
}

export function addImage(data: string, w: number, h: number, name?: string): string {
  const id = hashOf(data);
  if (!assets.has(id)) assets.set(id, { id, data, w, h, name });
  return id;
}

export function imageAsset(id: string | undefined | null): ImageAsset | undefined {
  return id ? assets.get(id) : undefined;
}

export function allImages(): ImageAsset[] {
  return [...assets.values()];
}

/** A decoded picture, or null while it's still loading (listeners fire when ready). */
export function imageElement(id: string): HTMLImageElement | null {
  const a = assets.get(id);
  if (!a) return null;
  let el = elements.get(id);
  if (!el) {
    el = new Image();
    el.decoding = 'async';
    el.onload = () => listeners.forEach((l) => l());
    el.src = a.data;
    elements.set(id, el);
  }
  return el.complete && el.naturalWidth > 0 ? el : null;
}

export function onImagesReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Ids of pictures a project's styles use. */
export function usedImages(p: Project): string[] {
  const ids = new Set<string>();
  walk(p.layers, (n) => {
    const id = n.style?.effect === 'photo' ? String(n.style.params.image ?? '') : '';
    if (id) ids.add(id);
  });
  return [...ids];
}

/** Pictures to embed when saving. */
export function packImages(p: Project): ImageAsset[] {
  return usedImages(p).flatMap((id) => (assets.has(id) ? [assets.get(id)!] : []));
}

export function unpackImages(list: ImageAsset[] | undefined) {
  for (const a of list ?? []) if (a?.id && a.data && !assets.has(a.id)) assets.set(a.id, a);
}

/** Encode a picture for storage, capped at `max` px on the long side. */
export function encodeImage(img: CanvasImageSource & { width: number; height: number }, opaque: boolean, max = 2400): { data: string; w: number; h: number } {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')?.drawImage(img, 0, 0, w, h);
  return { data: opaque ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png'), w, h };
}
