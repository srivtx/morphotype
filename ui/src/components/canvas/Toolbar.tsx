import { useRef, useState } from 'react';
import { addShape, importImage, primaryNode } from '../../app/actions';
import { run, shortcutOf } from '../../app/commands';
import { isGroup, symbolLayer, textLayer } from '../../state/model';
import { store, useStore } from '../../state/store';
import { Icon } from '../icons';
import { ShapePicker } from '../pickers';
import { IconButton, MenuItem, Popover } from '../ui';

/** Floating tool dock at the bottom of the canvas. */
export function Toolbar({ zoom, onFit, onZoom }: { zoom: number; onFit: () => void; onZoom: (z: number) => void }) {
  const tool = useStore((s) => s.tool);
  const editing = useStore((s) => s.editing);
  const canShape = useStore((s) => s.selection.length > 0) && !isGroup(primaryNode());
  const [shapes, setShapes] = useState(false);
  const [zoomMenu, setZoomMenu] = useState(false);
  const shapesBtn = useRef<HTMLButtonElement>(null);
  const zoomBtn = useRef<HTMLButtonElement>(null);
  const firstFont = useStore((s) => s.fonts[0]?.id ?? 'archivo');
  return (
    <div className="dock" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="dock-group">
        <IconButton icon="select" title="Select" kbd="V" active={tool === 'select' && !editing} onClick={() => store.set({ tool: 'select', editing: null })} />
        <IconButton icon="hand" title="Hand — or hold Space" kbd="H" active={tool === 'hand'} onClick={() => store.set({ tool: 'hand' })} />
      </div>
      <span className="dock-sep" />
      <div className="dock-group">
        <IconButton icon="text" title="Text" kbd="T" onClick={() => addShape(textLayer('Type', firstFont))} />
        <button ref={shapesBtn} className={`icon-btn ${shapes ? 'on' : ''}`} aria-label="Shapes" data-tip="Shapes" onClick={() => setShapes(!shapes)}>
          <Icon name="shapes" />
          <Icon name="chevronDown" size={10} className="caret" />
        </button>
        <IconButton icon="image" title="Trace an image" kbd={shortcutOf('trace')} onClick={() => void importImage()} />
      </div>
      <span className="dock-sep" />
      <div className="dock-group">
        <IconButton icon="points" title="Edit points" kbd="P" active={editing?.kind === 'points'} disabled={!canShape} onClick={() => run('points')} />
        <IconButton icon="warp" title="Warp" kbd="W" active={editing?.kind === 'warp'} disabled={!canShape} onClick={() => run('add-warp')} />
      </div>
      <span className="dock-sep" />
      <div className="dock-group">
        <IconButton icon="zoomOut" title="Zoom out" kbd={shortcutOf('zoom-out')} onClick={() => onZoom(zoom * 0.8)} />
        <button ref={zoomBtn} className="zoom-readout" onClick={() => setZoomMenu(!zoomMenu)} aria-label="Zoom level" data-tip="Zoom">
          {Math.round(zoom * 100)}%
        </button>
        <IconButton icon="zoomIn" title="Zoom in" kbd={shortcutOf('zoom-in')} onClick={() => onZoom(zoom * 1.25)} />
      </div>
      {shapes && (
        <Popover anchor={shapesBtn.current} onClose={() => setShapes(false)} placement="top-start" width={340}>
          <ShapePicker
            onPick={(k) => {
              addShape(symbolLayer(k));
              setShapes(false);
            }}
          />
        </Popover>
      )}
      {zoomMenu && (
        <Popover anchor={zoomBtn.current} onClose={() => setZoomMenu(false)} placement="top-start" width={180}>
          <div className="menu-list">
            <MenuItem icon="fit" label="Zoom to fit" kbd={shortcutOf('fit')} onClick={() => (onFit(), setZoomMenu(false))} />
            <MenuItem label="Zoom to selection" kbd={shortcutOf('zoom-sel')} onClick={() => (run('zoom-sel'), setZoomMenu(false))} />
            {[0.25, 0.5, 1, 2, 4].map((z) => (
              <MenuItem key={z} label={`${z * 100}%`} kbd={z === 1 ? shortcutOf('zoom-100') : undefined} onClick={() => (onZoom(z), setZoomMenu(false))} />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
