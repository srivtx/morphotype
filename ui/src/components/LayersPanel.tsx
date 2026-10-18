import { addLayer, duplicateLayer, importImage, moveLayer, removeLayer, updateLayer } from '../app/actions';
import type { SymbolKind } from '../engine/types';
import { layerLabel, morphLayer, SYMBOL_UI, symbolLayer, textLayer } from '../state/model';
import { store, useStore } from '../state/store';
import { Menu } from './controls';

const OP_BADGE = { add: '', subtract: 'cut', intersect: 'mask' } as const;

export function LayersPanel() {
  const layers = useStore((s) => s.project.layers);
  const selection = useStore((s) => s.selection);
  const results = useStore((s) => s.build?.layers);
  const firstFont = useStore((s) => s.fonts[0]?.id ?? 'archivo');
  return (
    <div className="layers">
      <div className="layers-add">
        <button className="btn" onClick={() => addLayer(textLayer('Type', firstFont))} title="Add text (T)">
          Text
        </button>
        <Menu label="Shape">
          {(close) => (
            <div className="menu-list grid">
              {(Object.keys(SYMBOL_UI) as SymbolKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    addLayer(symbolLayer(k));
                    close();
                  }}
                >
                  {SYMBOL_UI[k].label}
                </button>
              ))}
            </div>
          )}
        </Menu>
        <button className="btn" onClick={() => importImage()} title="Trace an image into a shape">
          Image
        </button>
        <button
          className="btn"
          title="Blend two layers' outlines"
          onClick={() => {
            const ls = store.get().project.layers.filter((l) => l.content.type !== 'morph');
            const a = ls.at(-2)?.id ?? '';
            const b = ls.at(-1)?.id ?? '';
            for (const id of [a, b]) if (id) updateLayer(id, (l) => (l.visible = false));
            addLayer(morphLayer(a, b));
          }}
        >
          Morph
        </button>
      </div>
      <ol className="layer-list">
        {[...layers].reverse().map((l) => {
          const err = results?.find((r) => r.id === l.id)?.error;
          return (
            <li
              key={l.id}
              className={`layer ${l.id === selection ? 'selected' : ''} ${l.visible ? '' : 'hidden'}`}
              onClick={() => store.set({ selection: l.id })}
            >
              <button
                className="icon-btn eye"
                title={l.visible ? 'Hide' : 'Show'}
                onClick={(e) => {
                  e.stopPropagation();
                  updateLayer(l.id, (x) => (x.visible = !x.visible));
                }}
              >
                {l.visible ? '●' : '○'}
              </button>
              <span className="layer-kind">{l.content.type === 'text' ? 'T' : l.content.type === 'symbol' ? '◆' : l.content.type === 'path' ? '✎' : '⇄'}</span>
              <span className="layer-name">{layerLabel(l)}</span>
              {err && (
                <span className="layer-warn" title={err}>
                  !
                </span>
              )}
              {OP_BADGE[l.op] && <span className={`badge ${l.op}`}>{OP_BADGE[l.op]}</span>}
              <span className="layer-tools">
                <button className="icon-btn" title="Move up" onClick={(e) => (e.stopPropagation(), moveLayer(l.id, 1))}>
                  ↑
                </button>
                <button className="icon-btn" title="Move down" onClick={(e) => (e.stopPropagation(), moveLayer(l.id, -1))}>
                  ↓
                </button>
                <button className="icon-btn" title="Duplicate" onClick={(e) => (e.stopPropagation(), duplicateLayer(l.id))}>
                  ⧉
                </button>
                <button className="icon-btn" title="Delete" onClick={(e) => (e.stopPropagation(), removeLayer(l.id))}>
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      {layers.length === 0 && <p className="hint pad">Add text, a shape or an image to start.</p>}
    </div>
  );
}
