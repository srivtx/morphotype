import { useEffect, useRef, useState } from 'react';
import { ContextMenu } from '../components/ContextMenu';
import { Dialogs } from '../components/Dialogs';
import { Icon } from '../components/icons';
import { Inspector } from '../components/Inspector';
import { LayersPanel } from '../components/LayersPanel';
import { prewarmThumbs, StylePanel } from '../components/StylePanel';
import { TopBar } from '../components/TopBar';
import { Home } from '../components/Home';
import { TypeMode } from '../components/type/TypeMode';
import { Tooltips } from '../components/ui';
import { BrushBar } from '../components/canvas/BrushBar';
import { PenOverlay } from '../components/canvas/PenTool';
import { Viewport } from '../components/canvas/Viewport';
import { engine } from '../engine/client';
import { loadBundled } from '../fonts/library';
import { buildScene } from '../state/tree';
import { setSettings, store, toast, useStore } from '../state/store';
import { addShape, getRenderer, importFonts, importImage, onCopyEvent, onPasteEvent, openProject } from './actions';
import { Popover } from '../components/ui';
import { ShapePicker } from '../components/pickers';
import { emptyProject, symbolLayer } from '../state/model';
import { allCommands, matchKey, run } from './commands';
import { startAutosave } from './autosave';
import { newDesign, openLast } from './projects';
import { openDocument } from '../state/store';

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

/** Starting points on an empty artboard. */
function EmptyStart() {
  const [shapes, setShapes] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <div className="empty-start" role="group" aria-label="Start your design">
      <h3>Start with</h3>
      <div className="empty-start-row">
        <button onClick={() => run('tool-text')}>
          <Icon name="text" size={18} /> Text <kbd>T</kbd>
        </button>
        <button ref={btn} onClick={() => setShapes(!shapes)}>
          <Icon name="shapes" size={18} /> Shape <kbd>O</kbd>
        </button>
        <button onClick={() => run('tool-draw')}>
          <Icon name="brush" size={18} /> Draw <kbd>B</kbd>
        </button>
        <button onClick={() => void importImage()}>
          <Icon name="image" size={18} /> Image <kbd>⇧⌘I</kbd>
        </button>
        <button onClick={() => store.set({ dialog: { kind: 'templates' } })}>
          <Icon name="sparkle" size={18} /> Template
        </button>
      </div>
      {shapes && (
        <Popover anchor={btn.current} onClose={() => setShapes(false)} width={340} placement="bottom-start">
          <ShapePicker
            onPick={(k) => {
              setShapes(false);
              addShape(symbolLayer(k));
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function DesignMode() {
  const tab = useStore((s) => s.tab);
  const empty = useStore((s) => s.project.layers.length === 0);
  const editing = useStore((s) => s.editing);
  const tool = useStore((s) => s.tool);
  return (
    <main className="workspace">
      <aside className="panel left">
        <LayersPanel />
      </aside>
      <section className="center">
        <Viewport />
        {empty && tool === 'select' && !editing && <EmptyStart />}
        {tool === 'text' && !editing && (
          <div className="edit-pill" role="status">
            <Icon name="text" size={14} />
            Click anywhere to type, or click a text to edit it
            <button className="link-btn" onClick={() => store.set({ tool: 'select' })}>
              Cancel <kbd>Esc</kbd>
            </button>
          </div>
        )}
        {tool === 'draw' && <BrushBar />}
        {tool === 'pen' && <PenOverlay renderer={getRenderer()} />}
        {editing && editing.kind !== 'text' && (
          <div className="edit-pill" role="status">
            <Icon name={editing.kind === 'warp' ? 'warp' : 'points'} size={14} />
            {editing.kind === 'warp' ? 'Drag the 16 points to warp' : 'Editing points'}
            <button className="link-btn" onClick={() => store.set({ editing: null })}>
              Done <kbd>Esc</kbd>
            </button>
          </div>
        )}
      </section>
      <aside className="panel right">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'design'} className={tab === 'design' ? 'on' : ''} onClick={() => store.set({ tab: 'design' })}>
            Design
          </button>
          <button role="tab" aria-selected={tab === 'style'} className={tab === 'style' ? 'on' : ''} onClick={() => store.set({ tab: 'style' })}>
            Style
          </button>
        </div>
        <div className="panel-scroll">{tab === 'design' ? <Inspector /> : <StylePanel />}</div>
      </aside>
    </main>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const mode = useStore((s) => s.mode);
  const screen = useStore((s) => s.screen);
  useBuildLoop();
  useShortcuts();
  const dropping = useDropFiles();

  useEffect(() => {
    loadBundled().then(
      (fonts) => {
        store.set({ fonts, ready: true });
        prewarmThumbs();
        startAutosave();
        // `?editor` (tests, demos) opens straight into a scratch design.
        const q = new URLSearchParams(location.search);
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
      {screen === 'home' ? (
        <Home />
      ) : (
        <>
          <TopBar />
          {mode === 'design' ? <DesignMode /> : <TypeMode />}
        </>
      )}
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
