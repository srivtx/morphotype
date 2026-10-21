import { useEffect, useState } from 'react';
import { ContextMenu } from '../components/ContextMenu';
import { Dialogs } from '../components/Dialogs';
import { Icon } from '../components/icons';
import { Home } from '../components/Home';
import { Tooltips } from '../components/ui';
import { engine } from '../engine/client';
import { loadBundled } from '../fonts/library';
import { buildScene } from '../state/tree';
import { setSettings, store, toast, useStore } from '../state/store';
import { importFonts, importImage, onCopyEvent, onPasteEvent, openProject } from './actions';
import { emptyProject } from '../state/model';
import { loadTemplates } from '../state/templateCatalog';
import { allCommands, matchKey } from './commands';
import { startAutosave } from './autosave';
import { startLiveGeometry } from './geoMotion';
import { onDemand, whenIdle } from './onDemand';
import { newDesign, openLast } from './projects';
import { openDocument } from '../state/store';

// The editor (canvas, panels, timeline, Type mode) loads in its own chunk, so
// Home paints without it; it preloads while Home is up.
const Editor = onDemand(() => import('./Editor').then((m) => m.Editor));

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' && <Icon name="warning" size={14} />}
          <span>{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                store.set({ toasts: store.get().toasts.filter((x) => x.id !== t.id) });
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Rebuild geometry whenever layers change; the engine keeps only the newest request. */
function useBuildLoop() {
  const layers = useStore((s) => s.project.layers);
  const ready = useStore((s) => s.ready);
  const fonts = useStore((s) => s.fonts);
  const typing = useStore((s) => (s.editing?.kind === 'text' ? s.editing.id : null));
  useEffect(() => {
    if (!ready) return;
    let live = true;
    engine.build(buildScene(store.get().project, undefined, typing).doc).then(
      (b) => live && store.set({ build: b }),
      (e: Error) => toast(`Engine error: ${e.message}`, 'error'),
    );
    return () => {
      live = false;
    };
  }, [layers, ready, fonts, typing]);
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button'].includes(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}

/** Keys that still work while typing in a field. */
const GLOBAL_WHILE_TYPING = new Set(['mod+s', 'mod+o', 'mod+k', 'mod+p', 'mod+,', 'mod+e', 'shift+mod+e', 'mod+n', 'mod+1', 'mod+2']);

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = store.get();
      // Dialogs handle their own keys (palette, settings…).
      if (s.dialog && s.dialog.kind !== 'trace') {
        const combo = matchKey(e);
        if (combo !== 'mod+k' && combo !== 'mod+,') return;
      }
      const combo = matchKey(e);
      const typing = isTyping(e);
      if (typing && !GLOBAL_WHILE_TYPING.has(combo)) return;
      // Let the browser fire native copy / cut / paste events (handled below).
      if (combo === 'mod+c' || combo === 'mod+x' || combo === 'mod+v') return;
      // Tab moves focus through the UI unless the canvas has it.
      const onCanvas = e.target === document.body || (e.target as HTMLElement).closest?.('.viewport');
      if ((combo === 'tab' || combo === 'shift+tab') && !onCanvas) return;
      // Inside a focused list or menu, arrows and Enter belong to it.
      const t = e.target as HTMLElement;
      if (t.closest?.('.popover, [role=tree], [role=grid]') && /^(arrow|enter|space|tab|shift\+tab)/.test(combo)) return;
      // Home: only app-level commands.
      if (s.screen === 'home' && !/^(palette|settings|help|new|open|home|mode-)/.test(allCommands().find((c) => c.keys?.includes(combo))?.id ?? '')) return;
      // Type mode: canvas-only commands don't apply.
      const designOnly = /^(nudge|align|distribute|flip|group|ungroup|merge|forward|backward|front|back|points|add-|tool-|outline|break|lock|hide|duplicate|delete|cut|copy$|paste$|select-all|copy-style|paste-style|next-layer|prev-layer|zoom|fit)/;
      for (const c of allCommands()) {
        if (!c.keys?.includes(combo)) continue;
        if (s.mode === 'type' && designOnly.test(c.id)) continue;
        if (c.when && !c.when()) continue;
        e.preventDefault();
        c.run();
        return;
      }
    };
    const editable = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t as HTMLElement | null)?.isContentEditable;
    const onCopy = (e: ClipboardEvent) => !editable(e.target) && store.get().mode === 'design' && onCopyEvent(e);
    const onCut = (e: ClipboardEvent) => !editable(e.target) && store.get().mode === 'design' && onCopyEvent(e, true);
    const onPaste = (e: ClipboardEvent) => !editable(e.target) && void onPasteEvent(e);
    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}

/** Drop fonts, images or .morpho projects anywhere on the window. */
function useDropFiles() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const onOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setOver(false);
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      const files = await Promise.all(Array.from(e.dataTransfer?.files ?? []).map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      const ext = (n: string) => n.split('.').pop()?.toLowerCase() ?? '';
      const fonts = files.filter((f) => ['ttf', 'otf', 'ttc', 'woff', 'woff2'].includes(ext(f.name)));
      const projects = files.filter((f) => ext(f.name) === 'morpho');
      const images = files.filter((f) => ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext(f.name)));
      if (fonts.length) await importFonts(fonts);
      if (projects.length) await openProject(projects);
      else if (images.length) await importImage(images, store.get().mode === 'type' ? 'glyph' : 'layer');
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return over;
}

export function App() {
  const ready = useStore((s) => s.ready);
  const mode = useStore((s) => s.mode);
  const screen = useStore((s) => s.screen);
  useBuildLoop();
  useShortcuts();
  const dropping = useDropFiles();

  useEffect(() => {
    // `?editor` (tests, demos) opens straight into a scratch design.
    const q = new URLSearchParams(location.search);
    // Opening straight into a design: fetch the editor while the engine loads.
    if (q.has('editor') || q.has('new') || store.get().settings.launch === 'last') void Editor.preload();
    loadBundled().then(
      (fonts) => {
        store.set({ fonts, ready: true });
        whenIdle(() => {
          loadTemplates().catch(() => {});
          void Editor.preload();
          import('./Editor').then((m) => m.prewarmThumbs(), () => {});
        });
        startAutosave();
        startLiveGeometry();
        if (q.has('editor')) openDocument(emptyProject());
        else if (q.has('new')) newDesign();
        else if (store.get().settings.launch === 'last') void openLast();
        if (!store.get().settings.welcomed) setSettings({ welcomed: true });
      },
      (e: Error) => toast(`Couldn't start the engine: ${e.message}`, 'error'),
    );
  }, []);

  return (
    <div className={`app mode-${mode} screen-${screen}`}>
      {screen === 'home' ? <Home /> : <Editor />}
      {!ready && (
        <div className="boot">
          <span className="spinner" /> Loading engine…
        </div>
      )}
      {dropping && <div className="drop-hint">Drop fonts, images or a .morpho project</div>}
      <Dialogs />
      <ContextMenu />
      <Toasts />
      <Tooltips />
    </div>
  );
}
