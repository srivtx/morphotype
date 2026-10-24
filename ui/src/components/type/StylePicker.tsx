// The font's style name: the standard styles by weight, upright and italic,
// or a name of your own. A standard style sets the weight class and italic
// flags apps use to group a family.
import { useState } from 'react';
import { isStandardStyle, lookWeight, parseStyle, styleName, WEIGHTS } from '../../app/fontStyles';
import type { ModEntry } from '../../engine/types';
import { Icon } from '../icons';
import { Menu } from '../ui';

export function StylePicker({ value, onChange, base, mods }: { value: string; onChange: (style: string) => void; base?: string; mods: ModEntry[] }) {
  const [naming, setNaming] = useState(false);
  const custom = naming || !isStandardStyle(value);
  const parsed = parseStyle(value);
  const look = lookWeight(mods);
  // A look that thickens or thins the base suggests the style it lands on.
  const weighted = lookWeight(mods, parseStyle(base ?? '')?.weight ?? 400);
  const thickens = mods.some((m) => m.on && m.kind === 'weight' && m.amount !== 0);
  const suggest = parsed && !custom && thickens && Math.abs(weighted - parsed.weight) >= 200 ? styleName({ weight: weighted, italic: parsed.italic }) : null;
  const item = (name: string, close: () => void) => (
    <button
      key={name}
      role="menuitemradio"
      aria-checked={!custom && value === name}
      className="menu-item"
      onClick={() => {
        setNaming(false);
        onChange(name);
        close();
      }}
    >
      <span className="mi-icon">{!custom && value === name && <Icon name="check" />}</span>
      <span className="mi-label">{name}</span>
      {name === base && <span className="style-base">base</span>}
    </button>
  );
  return (
    <>
      <div className="field">
        <span>Style</span>
        <Menu
          buttonClass="select style-select"
          placement="bottom-end"
          width={340}
          title="The style name apps list under the family"
          label={
            <>
              <span className="select-value">{custom ? 'Custom' : value}</span>
              {parsed && <span className="style-num">{parsed.weight}</span>}
              <Icon name="chevronDown" size={12} />
            </>
          }
        >
          {(close) => (
            <div className="menu-list style-menu" role="menu">
              <div className="style-grid">
                <span />
                <span className="menu-label">Upright</span>
                <span className="menu-label">Italic</span>
                {WEIGHTS.map((w) => (
                  <div key={w.weight} className="style-row">
                    <span className="style-weight">{w.weight}</span>
                    {item(styleName({ weight: w.weight, italic: false }), close)}
                    {item(styleName({ weight: w.weight, italic: true }), close)}
                  </div>
                ))}
              </div>
              <div className="menu-sep" role="separator" />
              <button
                role="menuitemradio"
                aria-checked={custom}
                className="menu-item"
                onClick={() => {
                  setNaming(true);
                  close();
                }}
              >
                <span className="mi-icon">{custom ? <Icon name="check" /> : <Icon name="text" />}</span>
                <span className="mi-label">Custom name…</span>
              </button>
            </div>
          )}
        </Menu>
      </div>
      {custom && (
        <label className="field">
          <span>Name</span>
          <input className="text-field style-name" value={value} placeholder="Display" autoFocus={naming} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        </label>
      )}
      <p className="hint">
        {!parsed
          ? `A custom name. Its weight comes from the look (${look}) and it's italic if the look slants.`
          : `${custom ? 'Reads as' : 'Exports as'} weight ${parsed.weight}, ${parsed.italic ? 'italic' : 'upright'}. Apps group a family's styles by these.`}
        {suggest && (
          <>
            {' '}
            Your look is closer to {suggest}.{' '}
            <button className="link-btn inline" onClick={() => onChange(suggest)}>
              Use {suggest}
            </button>
          </>
        )}
      </p>
    </>
  );
}
