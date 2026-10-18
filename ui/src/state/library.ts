// The project library: every design and font is saved on this device as you
// work (IndexedDB), so nothing is lost and the Home screen can list them.
// Metadata, documents and pictures live in separate stores: the Home screen
// reads only the small metadata records, and a picture used by several
// projects is stored once.
import { unpackImages, usedImages, imageAsset, type ImageAsset } from './assets';
import type { Project } from './model';

export interface ProjectMeta {
  id: string;
  name: string;
  kind: 'design' | 'font';
  created: number;
  updated: number;
  /** Artboard size (designs). */
  w: number;
  h: number;
  layers: number;
  /** PNG preview of a design. */
  thumb?: Blob;
  /** Font sample: glyph outlines in em units placed at their pen x, and the width. */
  sample?: { paths: { d: string; x: number }[]; w: number };
  /** CSS colour behind the preview. */
  bg?: string;
  /** Mode to reopen in. */
  mode?: 'design' | 'type';
}

interface DocRecord {
  id: string;
  project: Project;
  images: string[];
  /** Imported fonts the project uses (bytes in the fonts store). */
  fonts?: string[];
}

/** An imported font kept with the library, so projects reopen with it. */
export interface StoredFont {
  id: string;
  name?: string;
  bytes: Uint8Array;
}

const DB = 'morphotype';
let dbp: Promise<IDBDatabase | null> | null = null;
/** Without IndexedDB (private windows, some previews) the library lives in memory. */
const memory = { meta: new Map<string, ProjectMeta>(), docs: new Map<string, DocRecord>(), images: new Map<string, ImageAsset>(), fonts: new Map<string, StoredFont>() };

function open(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('docs', { keyPath: 'id' });
        db.createObjectStore('images', { keyPath: 'id' });
        db.createObjectStore('fonts', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

type StoreName = 'meta' | 'docs' | 'images' | 'fonts';

function done(tx: IDBTransaction) {
  return new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

function request<T>(r: IDBRequest<T>) {
  return new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function getOne<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory[store].get(id) as T | undefined;
  return request(db.transaction(store).objectStore(store).get(id)) as Promise<T | undefined>;
}

const listeners = new Set<() => void>();
/** Called whenever the library changes (saves, deletes). */
export function onLibraryChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((l) => l());

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await open();
  const all = db ? ((await request(db.transaction('meta').objectStore('meta').getAll())) as ProjectMeta[]) : [...memory.meta.values()];
  return all.sort((a, b) => b.updated - a.updated);
}

export function getMeta(id: string) {
  return getOne<ProjectMeta>('meta', id);
}

/**
 * Save a project. Pictures it uses are written once; `meta` fields not given
 * (like the thumbnail) keep their stored values.
 */
export async function saveProject(
  id: string,
  project: Project,
  meta: Partial<ProjectMeta> & Pick<ProjectMeta, 'kind'>,
  fonts: { ids: string[]; bytes: (id: string) => StoredFont | null } = { ids: [], bytes: () => null },
) {
  const images = usedImages(project);
  const prev = await getMeta(id);
  const now = Date.now();
  const m: ProjectMeta = {
    ...prev,
    ...meta,
    id,
    name: project.name || 'Untitled',
    created: prev?.created ?? now,
    updated: meta.updated ?? now,
    w: project.canvas.width,
    h: project.canvas.height,
    layers: project.layers.length,
  };
  const doc: DocRecord = { id, project: { ...project, images: undefined }, images, fonts: fonts.ids };
  const db = await open();
  if (!db) {
    memory.meta.set(id, m);
    memory.docs.set(id, structuredClone(doc));
    for (const i of images) {
      const a = imageAsset(i);
      if (a) memory.images.set(i, a);
    }
    for (const f of fonts.ids) {
      const b = !memory.fonts.has(f) && fonts.bytes(f);
      if (b) memory.fonts.set(f, b);
    }
    changed();
    return m;
  }
  const missing: ImageAsset[] = [];
  if (images.length) {
    const s = db.transaction('images').objectStore('images');
    const have = await Promise.all(images.map((i) => request(s.getKey(i))));
    images.forEach((i, k) => {
      const a = have[k] === undefined ? imageAsset(i) : undefined;
      if (a) missing.push(a);
    });
  }
  const newFonts: StoredFont[] = [];
  if (fonts.ids.length) {
    const s = db.transaction('fonts').objectStore('fonts');
    const have = await Promise.all(fonts.ids.map((f) => request(s.getKey(f))));
    fonts.ids.forEach((f, k) => {
      const b = have[k] === undefined ? fonts.bytes(f) : null;
      if (b) newFonts.push(b);
    });
  }
  const tx = db.transaction(['meta', 'docs', 'images', 'fonts'], 'readwrite');
  tx.objectStore('meta').put(m);
  tx.objectStore('docs').put(doc);
  for (const a of missing) tx.objectStore('images').put(a);
  for (const f of newFonts) tx.objectStore('fonts').put(f);
  await done(tx);
  changed();
  return m;
}

/** Update only metadata (a new thumbnail, a rename from Home). */
export async function updateMeta(id: string, patch: Partial<ProjectMeta>) {
  const prev = await getMeta(id);
  if (!prev) return;
  const m = { ...prev, ...patch, id };
  const db = await open();
  if (!db) memory.meta.set(id, m);
  else {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(m);
    await done(tx);
  }
  changed();
}

export async function loadProject(id: string): Promise<{ project: Project; meta: ProjectMeta; fonts: StoredFont[] } | null> {
  const [doc, meta] = await Promise.all([getOne<DocRecord>('docs', id), getMeta(id)]);
  if (!doc || !meta) return null;
  const imgs = (await Promise.all(doc.images.map((i) => getOne<ImageAsset>('images', i)))).filter((a): a is ImageAsset => !!a);
  unpackImages(imgs);
  const fonts = (await Promise.all((doc.fonts ?? []).map((f) => getOne<StoredFont>('fonts', f)))).filter((f): f is StoredFont => !!f);
  return { project: structuredClone(doc.project), meta, fonts };
}

export async function renameProject(id: string, name: string) {
  const doc = await getOne<DocRecord>('docs', id);
  if (!doc) return;
  doc.project.name = name;
  const db = await open();
  if (!db) memory.docs.set(id, doc);
  else {
    const tx = db.transaction('docs', 'readwrite');
    tx.objectStore('docs').put(doc);
    await done(tx);
  }
  await updateMeta(id, { name });
}

/** Remove a project; returns what's needed to put it back (for Undo). */
export async function deleteProject(id: string): Promise<{ meta: ProjectMeta; doc: DocRecord } | null> {
  const [doc, meta] = await Promise.all([getOne<DocRecord>('docs', id), getMeta(id)]);
  const db = await open();
  if (!db) {
    memory.meta.delete(id);
    memory.docs.delete(id);
  } else {
    const tx = db.transaction(['meta', 'docs'], 'readwrite');
    tx.objectStore('meta').delete(id);
    tx.objectStore('docs').delete(id);
    await done(tx);
  }
  changed();
  return doc && meta ? { meta, doc } : null;
}

export async function restoreProject(saved: { meta: ProjectMeta; doc: DocRecord }) {
  const db = await open();
  if (!db) {
    memory.meta.set(saved.meta.id, saved.meta);
    memory.docs.set(saved.doc.id, saved.doc);
  } else {
    const tx = db.transaction(['meta', 'docs'], 'readwrite');
    tx.objectStore('meta').put(saved.meta);
    tx.objectStore('docs').put(saved.doc);
    await done(tx);
  }
  changed();
}

export async function duplicateProject(id: string, newId: string) {
  const [doc, meta] = await Promise.all([getOne<DocRecord>('docs', id), getMeta(id)]);
  if (!doc || !meta) return null;
  const now = Date.now();
  const name = `${meta.name} copy`;
  const m: ProjectMeta = { ...meta, id: newId, name, created: now, updated: now };
  const d: DocRecord = { ...doc, id: newId, project: { ...doc.project, name } };
  const db = await open();
  if (!db) {
    memory.meta.set(newId, m);
    memory.docs.set(newId, d);
  } else {
    const tx = db.transaction(['meta', 'docs'], 'readwrite');
    tx.objectStore('meta').put(m);
    tx.objectStore('docs').put(d);
    await done(tx);
  }
  changed();
  return m;
}

/** Pictures no project uses any more (kept small by cleaning up now and then). */
export async function pruneImages() {
  const db = await open();
  if (!db) return;
  const docs = (await request(db.transaction('docs').objectStore('docs').getAll())) as DocRecord[];
  const used = new Set(docs.flatMap((d) => d.images));
  const keys = (await request(db.transaction('images').objectStore('images').getAllKeys())) as string[];
  const stale = keys.filter((k) => !used.has(k));
  if (!stale.length) return;
  const tx = db.transaction('images', 'readwrite');
  for (const k of stale) tx.objectStore('images').delete(k);
  await done(tx);
}
