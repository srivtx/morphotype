import { useEffect, useState } from 'react';
import { Dialogs } from '../components/Dialogs';
import { Inspector } from '../components/Inspector';
import { LayersPanel } from '../components/LayersPanel';
import { StylePanel } from '../components/StylePanel';
import { TopBar } from '../components/TopBar';
import { Viewport } from '../components/Viewport';
import { engine } from '../engine/client';
import { loadBundled } from '../fonts/library';
import { store, toast, useStore, undo, redo } from '../state/store';
import { textLayer } from '../state/model';
import { addLayer, duplicateLayer, engineDoc, exportPNG, importFonts, importImage, openProject, removeLayer, saveProject, updateLayer } from './actions';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

/** Rebuild geometry whenever layers change; the engine keeps only the newest request. */
function useBuildLoop() {
  const layers = useStore((s) => s.project.layers);
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    engine.build(engineDoc(store.get().project)).then(
      (b) => live && store.set({ build: b }),
      (e: Error) => toast(`Engine error: ${e.message}`, 'error'),
    );
    return () => {
      live = false;
    };
  }, [layers, ready]);
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const sel = store.get().selection;
      if (mod && k === 'z' && !isTyping(e)) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y' && !isTyping(e)) {
        e.preventDefault();
        redo();
      } else if (mod && k === 's') {
        e.preventDefault();
        void saveProject();
      } else if (mod && k === 'o') {
        e.preventDefault();
        void openProject();
      } else if (mod && k === 'e') {
        e.preventDefault();
        void exportPNG(2, store.get().previewTransparent);
      } else if (mod && k === '0') {
        e.preventDefault();
        window.dispatchEvent(new Event('mt-fit'));
      } else if (mod && k === 'd' && sel) {
        e.preventDefault();
        duplicateLayer(sel);
      } else if (isTyping(e)) {
        return;
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        removeLayer(sel);
      } else if (e.key.startsWith('Arrow') && sel) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        updateLayer(sel, (l) => ((l.x += dx), (l.y += dy)), 'nudge');
      } else if (k === 't' && !mod) {
        addLayer(textLayer('Type', store.get().fonts[0]?.id ?? 'archivo'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      else if (images.length) await importImage(images);
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
  const [tab, setTab] = useState<'layer' | 'style'>('layer');
  const ready = useStore((s) => s.ready);
  useBuildLoop();
  useShortcuts();
  const dropping = useDropFiles();

  useEffect(() => {
    loadBundled().then(
      (fonts) => store.set({ fonts, ready: true }),
      (e: Error) => toast(`Couldn't start the engine: ${e.message}`, 'error'),
    );
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="workspace">
        <aside className="panel left">
          <h3 className="panel-title">Layers</h3>
          <LayersPanel />
        </aside>
        <Viewport />
        <aside className="panel right">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'layer'} className={tab === 'layer' ? 'on' : ''} onClick={() => setTab('layer')}>
              Shape
            </button>
            <button role="tab" aria-selected={tab === 'style'} className={tab === 'style' ? 'on' : ''} onClick={() => setTab('style')}>
              Style
            </button>
          </div>
          <div className="panel-scroll">{tab === 'layer' ? <Inspector /> : <StylePanel />}</div>
        </aside>
      </main>
      {!ready && <div className="boot">Loading engine…</div>}
      {dropping && <div className="drop-hint">Drop fonts, images or a .morpho project</div>}
      <Dialogs />
      <Toasts />
    </div>
  );
}
