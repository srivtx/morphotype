// Moving between Home and projects: new designs and fonts, opening from the
// library, and library housekeeping with undo.
import { deleteProject, duplicateProject, listProjects, loadProject, renameProject, restoreProject } from '../state/library';
import { migrate } from '../state/migrate';
import { emptyProject, uid, type Project } from '../state/model';
import { openDocument, store, toast } from '../state/store';
import type { Template } from '../state/templates';
import { errorText, loadProjectFonts } from './actions';
import { flushSave } from './autosave';

const fit = () => requestAnimationFrame(() => window.dispatchEvent(new Event('mt-fit')));

export async function goHome() {
  store.set({ dialog: null, editing: null, tool: 'select' });
  await flushSave(true);
  store.set({ screen: 'home' });
}

/** A blank artboard. */
export function newDesign(w = 1080, h = 1080, name = 'Untitled') {
  const p: Project = { ...emptyProject(), name, layers: [], canvas: { width: w, height: h } };
  openDocument(p, { mode: 'design' });
  fit();
}

/** A new font project: Type mode opens on its start screen. */
export function newFont() {
  openDocument({ ...emptyProject(), layers: [] }, { mode: 'type' });
}

export function startTemplate(t: Template) {
  openDocument(t.make(), { mode: 'design' });
  fit();
}

export async function openFromLibrary(id: string) {
  if (store.get().projectId === id && store.get().screen === 'home') {
    store.set({ screen: 'editor' });
    return fit();
  }
  try {
    const r = await loadProject(id);
    if (!r) return toast('That project is no longer in the library.', 'error');
    await loadProjectFonts(r.fonts);
    openDocument(migrate(r.project), { id, mode: r.meta.mode });
    fit();
  } catch (e) {
    toast(`Couldn't open it: ${errorText(e)}`, 'error');
  }
}

/** Reopen the most recent project (launch setting). */
export async function openLast() {
  const [last] = await listProjects();
  if (last) await openFromLibrary(last.id);
  return !!last;
}

export async function duplicateFromLibrary(id: string) {
  await duplicateProject(id, uid('p'));
}

export async function renameInLibrary(id: string, name: string) {
  const n = name.trim() || 'Untitled';
  await renameProject(id, n);
  if (store.get().projectId === id) store.set({ project: { ...store.get().project, name: n } });
}

export async function deleteFromLibrary(id: string) {
  const saved = await deleteProject(id);
  if (store.get().projectId === id) store.set({ projectId: null });
  if (saved) toast(`Deleted ${saved.meta.name}`, 'info', { label: 'Undo', run: () => void restoreProject(saved) });
}
