// "Use in Design": confirm the font's own name, see what makes it different
// from its base, and choose what happens to text set in the base font.
import { useState } from 'react';
import { customFontId, editType, fontChanges, nameClash, useInDesign, type UseMode } from '../../app/typeActions';
import { allLayers } from '../../state/tree';
import { store, useStore } from '../../state/store';
import { Icon } from '../icons';
import { Dialog } from '../ui';

export function UseFontDialog() {
  const t = useStore((s) => s.project.type);
  const fonts = useStore((s) => s.fonts);
  const layers = useStore((s) => s.project.layers);
  const [family, setFamily] = useState(t?.family ?? '');
  const [style, setStyle] = useState(t?.style ?? 'Regular');
  const [mode, setMode] = useState<UseMode>('add');
  const [busy, setBusy] = useState(false);
  if (!t) return null;
  const close = () => store.set({ dialog: null });
  const base = fonts.find((f) => f.id === t.base);
  const already = fonts.some((f) => f.id === customFontId(t));
  const usingBase = allLayers(layers).filter((l) => l.content.type === 'text' && l.content.font === t.base).length;
  const clash = nameClash({ ...t, family }, family);
  const go = async () => {
    if (clash || busy) return;
    setBusy(true);
    editType((tp) => ((tp.family = family.trim()), (tp.style = style.trim() || 'Regular')));
    await useInDesign(mode);
    setBusy(false);
    close();
  };
  const options: { value: UseMode; label: string; hint: string; disabled?: boolean }[] = [
    { value: 'add', label: 'Add a text layer in it', hint: 'Switches to Design with a new text set in your font.' },
    { value: 'replace', label: `Switch text set in ${base?.name ?? 'the base font'}`, hint: usingBase ? `${usingBase} text layer${usingBase > 1 ? 's' : ''} will use your font instead.` : 'No text uses the base font right now.', disabled: !usingBase },
    { value: 'list', label: 'Just add it to the font list', hint: 'Pick it later from any font menu.' },
  ];
  return (
    <Dialog
      title={already ? 'Update your font in Design' : 'Use your font in Design'}
      subtitle="Your font becomes its own family, separate from the font it started from."
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!!clash || busy} onClick={() => void go()}>
            {busy ? 'Building…' : already ? 'Update font' : 'Use font'}
          </button>
        </>
      }
    >
      <div className="use-font">
        <div className="grid2">
          <label className="ts-name">
            <span>Family name</span>
            <input value={family} onChange={(e) => setFamily(e.target.value)} autoFocus spellCheck={false} onKeyDown={(e) => e.key === 'Enter' && void go()} />
          </label>
          <label className="ts-name">
            <span>Style</span>
            <input value={style} onChange={(e) => setStyle(e.target.value)} spellCheck={false} />
          </label>
        </div>
        {clash && <p className="warn">{clash}</p>}
        <div className="font-diff">
          <div className="font-diff-col">
            <span className="dim small">Started from</span>
            <strong style={{ fontFamily: base ? `"mt-${base.id}", system-ui` : undefined }}>{t.blank ? 'Blank' : (base?.name ?? t.base)}</strong>
          </div>
          <Icon name="chevronRight" />
          <div className="font-diff-col">
            <span className="dim small">Your font</span>
            <strong>
              {family || 'Untitled'} <span className="dim">{style}</span>
            </strong>
          </div>
        </div>
        <ul className="changes">
          {fontChanges(t).map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="use-modes" role="radiogroup">
          {options.map((o) => (
            <button key={o.value} role="radio" aria-checked={mode === o.value} disabled={o.disabled} className={`use-mode ${mode === o.value ? 'on' : ''}`} onClick={() => setMode(o.value)}>
              <span className="radio" />
              <span>
                <strong>{o.label}</strong>
                <span className="dim">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="hint">Text using {base?.name ?? 'the base font'} stays as it is unless you switch it. When you edit the font later, use Update and every text set in it refreshes.</p>
      </div>
    </Dialog>
  );
}
