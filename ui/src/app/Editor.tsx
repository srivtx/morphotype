// The editor: top bar plus Design mode (canvas, layers, inspector, timeline)
// or Type mode, which loads on first use.
import { useRef, useState } from 'react';
import { Icon } from '../components/icons';
import { Inspector } from '../components/Inspector';
import { LayersPanel } from '../components/LayersPanel';
import { StylePanel } from '../components/StylePanel';
import { TopBar } from '../components/TopBar';
import { BrushBar } from '../components/canvas/BrushBar';
import { PenOverlay } from '../components/canvas/PenTool';
import { Viewport } from '../components/canvas/Viewport';
import { TimelineBar } from '../components/canvas/Timeline';
import { setSettings, store, useStore } from '../state/store';
import { addShape, getRenderer, importImage, setBackground } from './actions';
import { Popover, Segmented } from '../components/ui';
import { ShapePicker } from '../components/pickers';
import { symbolLayer } from '../state/model';
import { run } from './commands';
import { onDemand } from './onDemand';
import { pageBackground } from './projects';

export { prewarmThumbs } from '../components/StylePanel';

const TypeMode = onDemand(() => import('../components/type/TypeMode').then((m) => m.TypeMode));

/** Starting points on an empty artboard. */
function EmptyStart() {
  const [shapes, setShapes] = useState(false);
  const page = useStore((s): 'white' | 'transparent' | 'dark' => {
    const f = s.project.background.fill;
    return f.kind === 'none' ? 'transparent' : f.kind === 'solid' && f.colors[0]?.toLowerCase() === '#ffffff' ? 'white' : f.kind === 'solid' && f.colors[0]?.toLowerCase() === '#0b0b0d' ? 'dark' : 'white';
  });
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
        <button onClick={() => run('new-layer')} data-tip="A blank, transparent layer: what you draw or add goes inside it">
          <Icon name="plus" size={18} /> Empty layer
        </button>
      </div>
      <div className="empty-start-page">
        <span className="dim small">Page</span>
        <Segmented
          size="sm"
          value={page}
          options={[
            { value: 'white', label: 'White' },
            { value: 'transparent', label: 'Clear', title: 'Transparent: exports without a background' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(v) => {
            setBackground((b) => Object.assign(b, pageBackground(v)));
            setSettings({ newPage: v });
          }}
        />
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
        <TimelineBar />
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

export function Editor() {
  const mode = useStore((s) => s.mode);
  return (
    <>
      <TopBar />
      {mode === 'design' ? <DesignMode /> : <TypeMode />}
    </>
  );
}
