import { useMemo, useState } from 'react';
import { importFonts } from '../app/actions';
import type { FontEntry } from '../fonts/library';
import { platform } from '../platform';
import { store, useStore } from '../state/store';
import { Menu } from './controls';

const GROUPS: { source: FontEntry['source']; label: string }[] = [
  { source: 'bundled', label: 'Included' },
  { source: 'imported', label: 'Imported' },
  { source: 'system', label: 'System' },
];

/** Font menu that previews each face in itself. */
export function FontPicker({ value, onChange, allowNone }: { value: string | null; onChange: (id: string | null) => void; allowNone?: boolean }) {
  const fonts = useStore((s) => s.fonts);
  const [q, setQ] = useState('');
  const current = fonts.find((f) => f.id === value);
  const filtered = useMemo(() => fonts.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())), [fonts, q]);
  return (
    <Menu
      className="font-picker"
      label={
        <span className="font-picker-label" style={{ fontFamily: current ? `"mt-${current.id}"` : undefined }}>
          {current?.name ?? (value ? 'Missing font' : 'None')}
          <span className="caret">▾</span>
        </span>
      }
    >
      {(close) => (
        <div className="font-list">
          <input autoFocus className="font-search" placeholder="Search fonts" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="font-scroll">
            {allowNone && (
              <button
                className={`font-item ${value === null ? 'on' : ''}`}
                onClick={() => {
                  onChange(null);
                  close();
                }}
              >
                None
              </button>
            )}
            {GROUPS.map((g) => {
              const items = filtered.filter((f) => f.source === g.source);
              if (!items.length) return null;
              return (
                <div key={g.source}>
                  <div className="font-group">{g.label}</div>
                  {items.map((f) => (
                    <button
                      key={f.id}
                      className={`font-item ${f.id === value ? 'on' : ''}`}
                      style={{ fontFamily: `"mt-${f.id}", system-ui` }}
                      onClick={() => {
                        onChange(f.id);
                        close();
                      }}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="font-actions">
            <button
              className="btn small"
              onClick={async () => {
                close();
                const f = await importFonts();
                if (f) onChange(f.id);
              }}
            >
              Import font…
            </button>
            {platform().listSystemFonts && (
              <button
                className="btn small"
                onClick={() => {
                  close();
                  store.set({ dialog: { kind: 'systemFonts' } });
                }}
              >
                System fonts…
              </button>
            )}
          </div>
        </div>
      )}
    </Menu>
  );
}
