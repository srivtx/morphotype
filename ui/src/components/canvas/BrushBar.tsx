// The draw tool's floating bar: brush, width and colour.
import { QUICK_COLORS } from '../../render/palette';
import { BRUSHES, brushById } from '../../state/brushes';
import { setSettings, store, useStore } from '../../state/store';
import { ColorChip } from '../ColorPicker';

export function BrushBar() {
  const s = useStore((x) => x.settings);
  const brush = brushById(s.brush);
  return (
    <div className="edit-pill brush-bar" role="toolbar" aria-label="Brush">
      <div className="brush-kinds">
        {BRUSHES.map((b) => (
          <button key={b.id} className={`chip ${b.id === brush.id ? 'on' : ''}`} data-tip={b.hint} onClick={() => setSettings({ brush: b.id, brushWidth: b.width })}>
            {b.label}
          </button>
        ))}
      </div>
      <label className="brush-width" data-tip="Brush width ( [ and ] )">
        <input type="range" min={1} max={120} step={0.5} value={s.brushWidth} onChange={(e) => setSettings({ brushWidth: Number(e.target.value) })} aria-label="Brush width" />
        <span>{Math.round(s.brushWidth)}</span>
      </label>
      <ColorChip label="Brush colour" value={s.brushColor} onChange={(v) => setSettings({ brushColor: v })} />
      <div className="brush-colors">
        {QUICK_COLORS.slice(0, 8).map((c) => (
          <button key={c} className="quick-color" style={{ background: c }} aria-label={`Brush ${c}`} onClick={() => setSettings({ brushColor: c })} />
        ))}
      </div>
      <button className="link-btn" onClick={() => store.set({ tool: 'select' })}>
        Done <kbd>Esc</kbd>
      </button>
    </div>
  );
}
