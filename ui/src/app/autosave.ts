// Saves the open project to the library as you work: shortly after edits
// settle, in idle time, with a fresh preview every few seconds at most.
import { engine } from '../engine/client';
import { backgroundCss } from '../render/background';
import { projectScene, renderSceneBlob } from '../render/thumbs';
import { saveProject, type ProjectMeta } from '../state/library';
import type { Project } from '../state/model';
import { onBeforeOpen, store } from '../state/store';
import { usedImportedFonts } from './actions';

const SETTLE_MS = 700;
const THUMB_EVERY_MS = 5000;

let saved: { id: string | null; project: Project | null } = { id: null, project: null };
let timer: ReturnType<typeof setTimeout> | undefined;
let lastThumb = 0;
let running: Promise<void> = Promise.resolve();

const idle = (fn: () => void) => ((window as unknown as { requestIdleCallback?: (f: () => void, o: object) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1)))(fn, { timeout: 1500 });

/** A blank project nobody has touched yet isn't worth listing. */
function worthSaving(p: Project) {
  return p.layers.length > 0 || !!p.type || p.name !== 'Untitled';
}

async function preview(p: Project, mode: 'design' | 'type'): Promise<Partial<ProjectMeta>> {
  if (mode === 'type' && p.type) {
    try {
      // Font code loads with Type mode, so it is already here when a font is open.
      const { specOf } = await import('./typeActions');
      const glyphs = await engine.fontPreview(specOf(p.type, { quality: 60 }), 'Aa');
      let x = 0;
      const paths = glyphs.map((g) => {
        const out = { d: g.d, x };
        x += g.advance;
        return out;
      });
      return { sample: { paths, w: x } };
    } catch {
      return {};
    }
  }
  const thumb = await renderSceneBlob(() => projectScene(p, 360));
  return thumb ? { thumb } : {};
}

/** Save now (also used before leaving the editor). `fresh` forces a new preview. */
export function flushSave(fresh = false): Promise<void> {
  clearTimeout(timer);
  // Snapshot now: by the time the queue runs another project may be open.
  const s = store.get();
  running = running.then(async () => {
    const id = s.projectId;
    if (!id || (saved.id === id && saved.project === s.project && !fresh)) return;
    if (!worthSaving(s.project) && saved.id !== id) return;
    const p = s.project;
    const mode = s.mode;
    const extra = fresh || Date.now() - lastThumb > THUMB_EVERY_MS || saved.id !== id ? await preview(p, mode) : {};
    if (extra.thumb || extra.sample) lastThumb = Date.now();
    try {
      const fonts = {
        ids: usedImportedFonts(p),
        bytes: (f: string) => {
          const bytes = engine.fontBytes(f);
          return bytes ? { id: f, name: store.get().fonts.find((x) => x.id === f)?.name, bytes } : null;
        },
      };
      await saveProject(id, p, { kind: mode === 'type' && p.type ? 'font' : 'design', mode, bg: backgroundCss(p.background, 0.2), ...extra }, fonts);
      saved = { id, project: p };
      if (store.get().projectId === id) store.set({ savedProject: p });
    } catch (e) {
      console.warn('autosave failed', e);
    }
  });
  return running;
}

export function startAutosave() {
  let last: Project | null = null;
  let lastMode = store.get().mode;
  store.subscribe(() => {
    const s = store.get();
    if (!s.projectId || s.screen !== 'editor') return;
    if (s.project === last && s.mode === lastMode) return;
    last = s.project;
    lastMode = s.mode;
    clearTimeout(timer);
    timer = setTimeout(() => idle(() => void flushSave()), SETTLE_MS);
  });
  onBeforeOpen(() => void flushSave(true));
  const leave = () => void flushSave();
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && leave());
}
