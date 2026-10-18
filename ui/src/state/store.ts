import { useSyncExternalStore } from 'react';
import type { BuildResult } from '../engine/client';
import type { FontEntry } from '../fonts/library';
import { emptyProject, type Project } from './model';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

export interface State {
  project: Project;
  selection: string | null;
  fonts: FontEntry[];
  build: BuildResult | null;
  ready: boolean;
  toasts: Toast[];
  previewTransparent: boolean;
  past: Project[];
  future: Project[];
  /** Open dialog, if any. */
  dialog: null | { kind: 'trace'; image: ImageData; name: string } | { kind: 'font' } | { kind: 'templates' } | { kind: 'systemFonts' };
}

type Listener = () => void;

const HISTORY_LIMIT = 200;
const COALESCE_MS = 700;

function initial(): State {
  const project = emptyProject();
  return {
    project,
    selection: project.layers[0]?.id ?? null,
    fonts: [],
    build: null,
    ready: false,
    toasts: [],
    previewTransparent: false,
    past: [],
    future: [],
    dialog: null,
  };
}

let state: State = initial();
const listeners = new Set<Listener>();
let lastKey = '';
let lastTime = 0;

export const store = {
  get: () => state,
  set(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state));
}

/**
 * Apply an edit to the project. Edits sharing `key` within a short window
 * (e.g. one slider drag) collapse into a single undo step.
 */
export function edit(fn: (draft: Project) => void, key = '') {
  const before = state.project;
  const draft = structuredClone(before);
  fn(draft);
  const now = performance.now();
  const coalesce = key !== '' && key === lastKey && now - lastTime < COALESCE_MS;
  lastKey = key;
  lastTime = now;
  store.set({
    project: draft,
    past: coalesce ? state.past : [...state.past.slice(-HISTORY_LIMIT + 1), before],
    future: [],
  });
}

/** Replace the whole project (open file, template) as one undoable step. */
export function replaceProject(p: Project) {
  lastKey = '';
  store.set({ project: p, past: [...state.past, state.project], future: [], selection: p.layers.at(-1)?.id ?? null });
}

export function undo() {
  const prev = state.past.at(-1);
  if (!prev) return;
  lastKey = '';
  store.set({ project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future], selection: keepSelection(prev) });
}

export function redo() {
  const next = state.future[0];
  if (!next) return;
  lastKey = '';
  store.set({ project: next, past: [...state.past, state.project], future: state.future.slice(1), selection: keepSelection(next) });
}

function keepSelection(p: Project) {
  return p.layers.some((l) => l.id === state.selection) ? state.selection : (p.layers.at(-1)?.id ?? null);
}

let toastId = 0;
export function toast(message: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++toastId, message, kind };
  store.set({ toasts: [...state.toasts, t] });
  setTimeout(() => store.set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 7000 : 3500);
}
