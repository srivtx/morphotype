import { useMemo, useRef, useState } from 'react';
import { importFonts } from '../app/actions';
import type { FontEntry } from '../fonts/library';
import { platform } from '../platform';
import { store, useStore } from '../state/store';
import { Icon } from './icons';
import { Popover } from './ui';

const GROUPS: { source: FontEntry['source']; label: string }[] = [
  { source: 'custom', label: 'Made in Morphotype' },
  { source: 'bundled', label: 'Included' },
  { source: 'imported', label: 'Imported' },
  { source: 'system', label: 'System' },
];

/** Font menu that previews each face in itself. */
export function FontPicker({ value, onChange, allowNone }: { value: string | null; onChange: (id: string | null) => void; allowNone?: boolean }) {
  const fonts = useStore((s) => s.fonts);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const current = fonts.find((f) => f.id === value);
  const filtered = useMemo(() => fonts.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())), [fonts, q]);
  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <>
      <button ref={btn} className={`select font-select ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="listbox">
        <span className="select-value" style={{ fontFamily: current ? `"mt-${current.id}", system-ui` : undefined }}>
          {current?.name ?? (value ? 'Missing font' : 'None')}
        </span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={272} className="font-pop">
          <div className="font-list">
            <div className="search-box">
              <Icon name="search" size={14} />
              <input
                autoFocus
                placeholder="Search fonts"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered[0]) pick(filtered[0].id);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    (e.currentTarget.closest('.font-list')?.querySelector('[role=menuitem]') as HTMLElement | null)?.focus();
                  }
                }}
              />
            </div>
            <div className="font-scroll">
              {allowNone && (
                <button role="menuitem" className={`font-item ${value === null ? 'on' : ''}`} onClick={() => pick(null)}>
                  None
                </button>
              )}
              {GROUPS.map((g) => {
                const items = filtered.filter((f) => f.source === g.source);
                if (!items.length) return null;
                return (
                  <div key={g.source}>
                    <div className="menu-label">{g.label}</div>
                    {items.map((f) => (
                      <button key={f.id} role="menuitem" className={`font-item ${f.id === value ? 'on' : ''}`} style={{ fontFamily: `"mt-${f.id}", system-ui` }} onClick={() => pick(f.id)}>
                        {f.name}
                        {f.id === value && <Icon name="check" size={13} />}
                      </button>
                    ))}
                  </div>
                );
              })}
              {!filtered.length && <p className="hint pad">No fonts match “{q}”.</p>}
            </div>
            <div className="font-actions">
              <button
                className="btn small"
                onClick={async () => {
                  setOpen(false);
                  const f = await importFonts();
                  if (f) onChange(f.id);
                }}
              >
                <Icon name="plus" size={13} /> Import font…
              </button>
              {platform().listSystemFonts && (
                <button
                  className="btn small"
                  onClick={() => {
                    setOpen(false);
                    store.set({ dialog: { kind: 'systemFonts' } });
                  }}
                >
                  System fonts…
                </button>
              )}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
