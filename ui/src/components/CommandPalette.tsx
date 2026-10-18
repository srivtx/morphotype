import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { allCommands, keyLabel, type Command } from '../app/commands';
import { SETTING_DEFS } from '../state/settings';
import { setSettings, store } from '../state/store';
import { Icon } from './icons';

interface Entry {
  id: string;
  title: string;
  group: string;
  icon?: Command['icon'];
  kbd?: string;
  run: () => void;
  enabled: boolean;
  hay: string;
}

/** Fuzzy-ish score: all words must appear; earlier and title matches rank higher. */
function score(e: Entry, words: string[]): number {
  let s = 0;
  const title = e.title.toLowerCase();
  for (const w of words) {
    const i = title.indexOf(w);
    if (i >= 0) s += 10 - Math.min(i, 9) + (i === 0 || title[i - 1] === ' ' ? 5 : 0);
    else if (e.hay.includes(w)) s += 2;
    else return -1;
  }
  return s + (e.enabled ? 1 : -3);
}

/** ⌘K: search and run any command, toggle settings, apply presets. */
export function CommandPalette() {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = () => store.set({ dialog: null });
  const entries = useMemo<Entry[]>(() => {
    const cmds = allCommands()
      .filter((c) => !c.hidden)
      .map((c) => ({
        id: c.id,
        title: c.title,
        group: c.group,
        icon: c.icon,
        kbd: c.keys?.[0] ? keyLabel(c.keys[0]) : undefined,
        run: c.run,
        enabled: !c.when || c.when(),
        hay: `${c.title} ${c.group} ${c.keywords ?? ''}`.toLowerCase(),
      }));
    const settings = SETTING_DEFS.filter((d) => d.type === 'toggle').map((d) => {
      const on = Boolean(store.get().settings[d.key]);
      return {
        id: `setting-${d.key}`,
        title: `${on ? 'Turn off' : 'Turn on'}: ${d.label}`,
        group: 'Settings',
        icon: 'settings' as const,
        run: () => setSettings({ [d.key]: !on }),
        enabled: true,
        hay: `${d.label} ${d.hint} ${d.keywords ?? ''} setting preference`.toLowerCase(),
      };
    });
    return [...cmds, ...settings];
  }, []);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      const pinned = ['new', 'export-png', 'export-svg', 'mode-type', 'trace', 'add-text', 'group', 'merge', 'points', 'add-warp', 'settings', 'help'];
      return pinned.map((id) => entries.find((e) => e.id === id)).filter((e): e is Entry => !!e);
    }
    return entries
      .map((e) => ({ e, s: score(e, words) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.e);
  }, [q, entries]);
  useEffect(() => setI(0), [q]);
  useEffect(() => {
    list.current?.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [i]);
  const go = (e: Entry | undefined) => {
    if (!e || !e.enabled) return;
    close();
    // Let the palette close before running (dialogs may open).
    requestAnimationFrame(() => e.run());
  };
  return createPortal(
    <div className="scrim top" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="pal-search">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="Search commands, shapes, styles, settings…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setI((x) => Math.min(shown.length - 1, x + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setI((x) => Math.max(0, x - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(shown[i]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
              e.stopPropagation();
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="pal-list" ref={list} role="listbox">
          {!q && <div className="menu-label">Suggested</div>}
          {shown.map((e, k) => (
            <button key={e.id} role="option" aria-selected={k === i} className={`pal-item ${k === i ? 'on' : ''} ${e.enabled ? '' : 'disabled'}`} onPointerMove={() => setI(k)} onClick={() => go(e)}>
              <span className="mi-icon">{e.icon && <Icon name={e.icon} />}</span>
              <span className="pal-title">{e.title}</span>
              <span className="pal-group">{e.group}</span>
              {e.kbd && <kbd>{e.kbd}</kbd>}
            </button>
          ))}
          {!shown.length && <p className="hint pad">Nothing matches “{q}”.</p>}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to run
          </span>
          <span className="dim">Everything in Morphotype is in here.</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
