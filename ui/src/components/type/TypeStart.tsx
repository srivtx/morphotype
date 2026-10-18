// The first screen of Type mode: name the font, choose what it starts from
// (a typeface to reshape, or a blank set to draw) and, optionally, a look.
import { useMemo, useState } from 'react';
import { CHARSETS, createTypeProject, DEFAULT_CHARSET, nameClash, newFontDefaults } from '../../app/typeActions';
import type { ModEntry } from '../../engine/types';
import { uid } from '../../state/model';
import { SHAPE_RECIPES } from '../../state/recipes';
import { store, useStore } from '../../state/store';
import { Icon } from '../icons';

const LOOKS = ['Plain', 'Rounded', 'Heavy', 'Bitmap', 'Soft pixel', 'Dot matrix', 'Inline', 'Melting', 'Ink stamp', 'Italic'];

const SETS = [
  { value: CHARSETS.upper, label: 'Capitals', hint: 'A–Z · logos and headlines' },
  { value: CHARSETS.upper + CHARSETS.digits, label: 'Capitals + numbers', hint: 'A–Z 0–9 · posters and signs' },
  { value: DEFAULT_CHARSET, label: 'Full set', hint: 'A–Z a–z 0–9 and punctuation' },
];

export function TypeStart() {
  const fonts = useStore((s) => s.fonts);
  const defaults = useMemo(() => newFontDefaults(), []);
  const [family, setFamily] = useState(defaults.family);
  const [base, setBase] = useState(defaults.base);
  const [blank, setBlank] = useState(false);
  const [look, setLook] = useState(defaults.modifiers?.length ? 'From your text' : 'Plain');
  const [charset, setCharset] = useState(DEFAULT_CHARSET);
  const choices = fonts.filter((f) => f.source !== 'custom');
  const clash = nameClash({ id: '', family, base, blank, style: 'Regular', axes: {}, morph: null, modifiers: [], tracking: 0, charset, glyphs: {}, sample: '' });
  const create = () => {
    if (clash) return;
    const recipe = SHAPE_RECIPES.find((r) => r.name === look);
    const modifiers: ModEntry[] = look === 'From your text' ? (defaults.modifiers ?? []) : (recipe?.mods ?? []).map((m) => ({ ...structuredClone(m), on: true, uid: uid('m') }) as ModEntry);
    createTypeProject({ family, base, blank, charset, modifiers: blank ? [] : modifiers, axes: base === defaults.base ? defaults.axes : {}, morph: base === defaults.base ? defaults.morph : null });
    // The tour lives in the editor, which mounts after this.
    if (!store.get().settings.typeTour) setTimeout(() => window.dispatchEvent(new Event('mt-type-tour')), 300);
  };
  return (
    <main className="workspace type-start">
      <div className="type-start-inner">
        <header>
          <span className="eyebrow">Type mode</span>
          <h1>Design a font</h1>
          <p>A font is a set of glyphs that share the same lines, spacing and style. Reshape an existing typeface, or start blank and draw your own letters. You can export it, host it on the web or use it right here.</p>
        </header>

        <label className="ts-name">
          <span>Name</span>
          <input value={family} onChange={(e) => setFamily(e.target.value)} placeholder="My Font" autoFocus spellCheck={false} onKeyDown={(e) => e.key === 'Enter' && create()} />
          {clash ? <em className="warn">{clash}</em> : <em>The family name people will see in font menus.</em>}
        </label>

        <section>
          <h2>Start from</h2>
          <div className="ts-bases">
            <button className={`ts-base blank ${blank ? 'on' : ''}`} onClick={() => setBlank(true)}>
              <span className="ts-specimen">
                <Icon name="points" size={26} />
              </span>
              <strong>Blank</strong>
              <span>Draw every glyph yourself. Uses {fonts.find((f) => f.id === base)?.name ?? 'the selected font'}'s lines as a guide.</span>
            </button>
            {choices.map((f) => (
              <button key={f.id} className={`ts-base ${!blank && base === f.id ? 'on' : ''}`} onClick={() => (setBase(f.id), setBlank(false))}>
                <span className="ts-specimen" style={{ fontFamily: `"mt-${f.id}", system-ui` }}>
                  Rag
                </span>
                <strong>{f.name}</strong>
                <span>{f.source === 'bundled' ? 'Included · OFL' : f.source === 'system' ? 'From this Mac' : 'Imported'}</span>
              </button>
            ))}
          </div>
        </section>

        {!blank && (
          <section>
            <h2>
              Starting look <span className="dim">optional, change it any time</span>
            </h2>
            <div className="ts-looks">
              {(defaults.modifiers?.length ? ['From your text', ...LOOKS] : LOOKS).map((l) => (
                <button key={l} className={`chip ${look === l ? 'on' : ''}`} onClick={() => setLook(l)}>
                  {l}
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2>Characters</h2>
          <div className="ts-sets">
            {SETS.map((c) => (
              <button key={c.label} className={`ts-set ${charset === c.value ? 'on' : ''}`} onClick={() => setCharset(c.value)}>
                <strong>{c.label}</strong>
                <span>{c.hint}</span>
              </button>
            ))}
          </div>
          <p className="hint">You can add any other character later, including symbols and accents.</p>
        </section>

        <footer>
          <button className="btn" onClick={() => store.set({ dialog: { kind: 'typeGuide' } })}>
            <Icon name="help" size={14} /> Type basics
          </button>
          <span className="spacer" />
          <button className="btn" onClick={() => store.set({ mode: 'design' })}>
            Back to Design
          </button>
          <button className="btn primary" disabled={!!clash} onClick={create}>
            Create font <Icon name="chevronRight" size={13} />
          </button>
        </footer>
      </div>
    </main>
  );
}
