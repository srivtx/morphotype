import { useSyncExternalStore } from 'react';
import type { BuildResult } from '../engine/client';
import type { FontEntry } from '../fonts/library';
import { emptyProject, uid, type Project } from './model';
import { loadSettings, saveSettings, type Settings } from './settings';
import { find } from './tree';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export type Dialog =
  | { kind: 'trace'; image: ImageData; name: string; target?: 'layer' | 'glyph' }
  | { kind: 'font' }
  | { kind: 'templates' }
  | { kind: 'systemFonts' }
  | { kind: 'settings'; query?: string }
  | { kind: 'help' }
  | { kind: 'palette' }
  | { kind: 'canvas' }
  | { kind: 'typeGuide'; topic?: string }
  | { kind: 'useFont' }
  | { kind: 'welcome' };

/** On-canvas sub-editors. */
export type EditMode =
  | null
  | { kind: 'points'; id: string }
  | { kind: 'warp'; id: string; uid: string }
  /** Typing on the canvas. `select` is the initial selection (UTF-16 offsets). */
  | { kind: 'text'; id: string; select?: [number, number]; at?: { x: number; y: number } };

export interface State {
  project: Project;
  /** Library id of the open project (null until it's started). */
  projectId: string | null;
  /** Home lists projects; the editor works on one. */
  screen: 'home' | 'editor';
  /** Selected node ids (layers or groups). */
  selection: string[];
  hover: string | null;
  mode: 'design' | 'type';
  /** Glyph open in Type mode. */
  glyph: string;
  /** Selected layer of the open glyph (null: its outline). */
  glyphPart: string | null;
  editing: EditMode;
  fonts: FontEntry[];
  build: BuildResult | null;
  ready: boolean;
  toasts: Toast[];
  past: Project[];
  future: Project[];
  dialog: Dialog | null;
  settings: Settings;
  /** Right panel tab. */
  tab: 'design' | 'style';
  tool: 'select' | 'hand' | 'text' | 'draw';
}

type Listener = () => void;

const HISTORY_LIMIT = 200;
const COALESCE_MS = 700;

function initial(): State {
  const project = emptyProject();
  return {
    project,
    projectId: null,
    screen: 'home',
    selection: project.layers[0] ? [project.layers[0].id] : [],
    hover: null,
    mode: 'design',
    glyph: 'A',
    glyphPart: null,
    editing: null,
    fonts: [],
    build: null,
    ready: false,
    toasts: [],
    past: [],
    future: [],
    dialog: null,
    settings: loadSettings(),
    tab: 'design',
    tool: 'select',
  };
}

let state: State = initial();
const listeners = new Set<Listener>();
let lastKey = '';
let lastTime = 0;
/** Inside a pointer gesture every edit with the same key is one undo step. */
let gesture = false;

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
  const coalesce = key !== '' && key === lastKey && (gesture || now - lastTime < COALESCE_MS);
  lastKey = key;
  lastTime = now;
  store.set({
    project: draft,
    past: coalesce ? state.past : [...state.past.slice(-HISTORY_LIMIT + 1), before],
    future: [],
  });
}

/** Start a drag: its edits collapse into one undo step until `commitEdit`. */
export function beginGesture() {
  gesture = true;
  lastKey = '';
}

/** End the current gesture / coalescing window (e.g. on pointer up). */
export function commitEdit() {
  gesture = false;
  lastKey = '';
}

const beforeOpen = new Set<() => void>();
/** Run just before another project replaces the open one (autosave flushes). */
export function onBeforeOpen(fn: () => void) {
  beforeOpen.add(fn);
  return () => beforeOpen.delete(fn);
}

/**
 * Start working on a project (new, template, opened file or from the
 * library). It gets its own library entry and history, so undo never
 * crosses into another project.
 */
export function openDocument(p: Project, opts: { id?: string; mode?: State['mode'] } = {}) {
  beforeOpen.forEach((fn) => fn());
  lastKey = '';
  const top = p.layers.at(-1);
  store.set({
    project: p,
    projectId: opts.id ?? uid('p'),
    screen: 'editor',
    mode: opts.mode ?? (p.type && !p.layers.length ? 'type' : 'design'),
    past: [],
    future: [],
    selection: top ? [top.id] : [],
    editing: null,
    glyphPart: null,
    tool: 'select',
  });
}

/** Replace the whole project (opened file, template): a new library entry. */
export function replaceProject(p: Project) {
  openDocument(p);
}

export function undo() {
  const prev = state.past.at(-1);
  if (!prev) return;
  lastKey = '';
  store.set({ project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future], selection: keepSelection(prev), editing: keepEditing(prev) });
}

export function redo() {
  const next = state.future[0];
  if (!next) return;
  lastKey = '';
  store.set({ project: next, past: [...state.past, state.project], future: state.future.slice(1), selection: keepSelection(next), editing: keepEditing(next) });
}

function keepSelection(p: Project) {
  return state.selection.filter((id) => find(p.layers, id));
}

function keepEditing(p: Project): EditMode {
  return state.editing && find(p.layers, state.editing.id) ? state.editing : null;
}

export function select(ids: string[]) {
  const editing = state.editing && ids.length === 1 && ids[0] === state.editing.id ? state.editing : null;
  store.set({ selection: ids, editing });
}

export function setSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  saveSettings(settings);
  store.set({ settings });
}

let toastId = 0;
export function toast(message: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const t: Toast = { id: ++toastId, message, kind, action };
  store.set({ toasts: [...state.toasts.slice(-3), t] });
  setTimeout(() => store.set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 7000 : action ? 6000 : 3500);
}
