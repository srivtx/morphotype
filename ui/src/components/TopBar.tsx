import { exportPNG, exportSVG, importFonts, importImage, openProject, saveProject } from '../app/actions';
import { platform } from '../platform';
import { edit, redo, store, undo, useStore } from '../state/store';
import { Menu } from './controls';

const SIZES: { label: string; w: number; h: number }[] = [
  { label: 'Square 1200', w: 1200, h: 1200 },
  { label: 'Wide 1600 × 900', w: 1600, h: 900 },
  { label: 'Banner 2000 × 700', w: 2000, h: 700 },
  { label: 'Portrait 1080 × 1350', w: 1080, h: 1350 },
  { label: 'Icon 1024', w: 1024, h: 1024 },
];

export function TopBar() {
  const name = useStore((s) => s.project.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const canvas = useStore((s) => s.project.canvas);
  const transparent = useStore((s) => s.previewTransparent);
  const mac = platform().isMac;
  const cmd = mac ? '⌘' : 'Ctrl+';
  return (
    <header className={`topbar ${platform().kind === 'desktop' && mac ? 'traffic' : ''}`} data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="logo">◐</span> Morphotype
      </div>
      <input className="doc-name" value={name} aria-label="Project name" onChange={(e) => edit((p) => (p.name = e.target.value), 'name')} />
      <Menu label="File">
        {(close) => (
          <div className="menu-list">
            <button onClick={() => (close(), store.set({ dialog: { kind: 'templates' } }))}>New from template…</button>
            <button onClick={() => (close(), openProject())}>Open project… <kbd>{cmd}O</kbd></button>
            <button onClick={() => (close(), saveProject())}>Save project… <kbd>{cmd}S</kbd></button>
            <hr />
            <button onClick={() => (close(), importFonts())}>Import fonts…</button>
            <button onClick={() => (close(), importImage())}>Trace image…</button>
          </div>
        )}
      </Menu>
      <Menu label={`${canvas.width} × ${canvas.height}`}>
        {(close) => (
          <div className="menu-list">
            {SIZES.map((s) => (
              <button
                key={s.label}
                onClick={() => {
                  edit((p) => (p.canvas = { width: s.w, height: s.h }));
                  close();
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </Menu>
      <div className="spacer" data-tauri-drag-region />
      <button className="icon-btn" disabled={!canUndo} onClick={undo} title={`Undo (${cmd}Z)`}>
        ↶
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={redo} title={`Redo (${mac ? '⇧⌘Z' : 'Ctrl+Y'})`}>
        ↷
      </button>
      <button className="btn" onClick={() => store.set({ dialog: { kind: 'font' } })} title="Turn the current style into an installable font">
        Make font
      </button>
      <Menu label="Export" className="export">
        {(close) => (
          <div className="menu-list">
            {[1, 2, 4].map((s) => (
              <button key={s} onClick={() => (close(), exportPNG(s, transparent))}>
                PNG {s}× {transparent ? '(transparent)' : ''} {s === 2 && <kbd>{cmd}E</kbd>}
              </button>
            ))}
            <button onClick={() => (close(), exportSVG())}>SVG (vector outline)</button>
            <button onClick={() => (close(), store.set({ dialog: { kind: 'font' } }))}>Font (.ttf)…</button>
          </div>
        )}
      </Menu>
    </header>
  );
}
