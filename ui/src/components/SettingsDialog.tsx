import { useMemo, useState } from 'react';
import { allCommands, keyLabel } from '../app/commands';
import { DEFAULT_SETTINGS, SETTING_DEFS, type SettingDef } from '../state/settings';
import { setSettings, store, useStore } from '../state/store';
import { Icon } from './icons';
import { Dialog, Select, Slider, Toggle } from './ui';

function matches(q: string, ...parts: (string | undefined)[]) {
  const hay = parts.join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function SettingRow({ d }: { d: SettingDef }) {
  const v = useStore((s) => s.settings[d.key]);
  if (d.type === 'toggle') return <Toggle label={<SettingLabel d={d} />} checked={Boolean(v)} onChange={(x) => setSettings({ [d.key]: x })} />;
  if (d.type === 'number')
    return (
      <div className="setting-num">
        <SettingLabel d={d} />
        <Slider label="" value={Number(v)} min={d.min} max={d.max} step={d.step} suffix={d.suffix} reset={Number(DEFAULT_SETTINGS[d.key])} onChange={(x) => setSettings({ [d.key]: x })} />
      </div>
    );
  return (
    <div className="toggle-row">
      <SettingLabel d={d} />
      <Select value={v as string | number} options={d.options} onChange={(x) => setSettings({ [d.key]: x })} />
    </div>
  );
}

function SettingLabel({ d }: { d: SettingDef }) {
  return (
    <span className="setting-label">
      <strong>{d.label}</strong>
      <small>{d.hint}</small>
    </span>
  );
}

/** Preferences with instant search across settings and keyboard shortcuts. */
export function SettingsDialog({ initial = '' }: { initial?: string }) {
  const [q, setQ] = useState(initial);
  const defs = SETTING_DEFS.filter((d) => matches(q, d.label, d.hint, d.section, d.keywords));
  const sections = [...new Set(defs.map((d) => d.section))];
  const shortcuts = useMemo(() => allCommands().filter((c) => c.keys?.length && !c.id.startsWith('nudge')), []);
  const keys = shortcuts.filter((c) => q && matches(q, c.title, c.group, c.keywords, 'shortcut keyboard key'));
  return (
    <Dialog title="Settings" subtitle="Changes apply immediately and are remembered on this device." onClose={() => store.set({ dialog: null })} size="md" className="settings-dialog">
      <div className="search-box">
        <Icon name="search" size={14} />
        <input autoFocus placeholder="Search settings and shortcuts…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="settings-scroll">
        {sections.map((s) => (
          <div key={s} className="settings-section">
            <h4>{s}</h4>
            {defs
              .filter((d) => d.section === s)
              .map((d) => (
                <SettingRow key={d.key} d={d} />
              ))}
          </div>
        ))}
        {keys.length > 0 && (
          <div className="settings-section">
            <h4>Keyboard shortcuts</h4>
            {keys.slice(0, 20).map((c) => (
              <div key={c.id} className="shortcut-row">
                <span>{c.title}</span>
                <span>
                  {c.keys!.slice(0, 2).map((k) => (
                    <kbd key={k} className="kbd">
                      {keyLabel(k)}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        {!sections.length && !keys.length && <p className="hint pad">No settings match “{q}”.</p>}
        <div className="settings-foot">
          <button className="link-btn" onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>
            Restore defaults
          </button>
          <button className="link-btn" onClick={() => store.set({ dialog: { kind: 'help' } })}>
            All keyboard shortcuts
          </button>
        </div>
      </div>
    </Dialog>
  );
}
