// Home: start something new, or pick up any design or font you've made.
// Everything here reads the library's small metadata records only, so it
// opens instantly however many projects there are.
import { useEffect, useMemo, useRef, useState } from 'react';
import { importFonts, openProject } from '../app/actions';
import { deleteFromLibrary, duplicateFromLibrary, newDesign, newFont, openFromLibrary, renameInLibrary, startTemplate } from '../app/projects';
import { platform } from '../platform';
import { listProjects, onLibraryChange, type ProjectMeta } from '../state/library';
import { setSettings, store, useStore } from '../state/store';
import { TEMPLATES, type Template } from '../state/templates';
import { INTENTS, startIntent, TemplateCard } from './Dialogs';
import { Icon, Logo, type IconName } from './icons';
import { IconButton, Menu, MenuItem, MenuSep, Segmented } from './ui';

type View = 'home' | 'designs' | 'fonts' | 'templates';

function useLibrary() {
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void listProjects().then((l) => live && setList(l));
    load();
    const off = onLibraryChange(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  return list;
}

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function useBlobUrl(b: Blob | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!b) return setUrl(null);
    const u = URL.createObjectURL(b);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [b]);
  return url;
}

function Preview({ m }: { m: ProjectMeta }) {
  const url = useBlobUrl(m.thumb);
  if (m.kind === 'font') {
    const s = m.sample;
    return (
      <span className="home-thumb font">
        {s ? (
          <svg viewBox={`${-0.08} -0.9 ${Math.max(0.5, s.w) + 0.16} 1.1`} aria-hidden>
            {s.paths.map((p, i) => (
              <path key={i} d={p.d} transform={`translate(${p.x} 0)`} />
            ))}
          </svg>
        ) : (
          <span className="home-font-ph">Aa</span>
        )}
      </span>
    );
  }
  return (
    <span className="home-thumb" style={{ aspectRatio: `${m.w} / ${m.h}`, background: url ? undefined : m.bg }}>
      {url && <img src={url} alt="" draggable={false} />}
    </span>
  );
}

function ProjectCard({ m, current }: { m: ProjectMeta; current: boolean }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className={`home-card ${current ? 'current' : ''}`}>
      <button className="home-card-open" onClick={() => void openFromLibrary(m.id)} onDoubleClick={(e) => e.preventDefault()} aria-label={`Open ${m.name}`}>
        <span className="home-thumb-wrap">
          <Preview m={m} />
        </span>
      </button>
      <div className="home-card-meta">
        {renaming ? (
          <input
            className="home-rename"
            autoFocus
            defaultValue={m.name}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={(e) => {
              setRenaming(false);
              if (e.target.value.trim() !== m.name) void renameInLibrary(m.id, e.target.value);
            }}
          />
        ) : (
          <strong onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {m.name}
          </strong>
        )}
        <span className="dim small">
          <Icon name={m.kind === 'font' ? 'type' : 'design'} size={11} /> {m.kind === 'font' ? 'Font' : `${m.w} × ${m.h}`} · {ago(m.updated)}
        </span>
        <Menu buttonClass="icon-btn tiny home-card-more" label={<Icon name="more" size={14} />} title="More" placement="bottom-end" width={190}>
          {(close) => (
            <div className="menu-list">
              <MenuItem icon="open" label="Open" onClick={() => (close(), void openFromLibrary(m.id))} />
              <MenuItem icon="duplicate" label="Duplicate" onClick={() => (close(), void duplicateFromLibrary(m.id))} />
              <MenuItem icon="text" label="Rename" onClick={() => (close(), setRenaming(true))} />
              <MenuSep />
              <MenuItem icon="trash" label="Delete" onClick={() => (close(), void deleteFromLibrary(m.id))} />
            </div>
          )}
        </Menu>
      </div>
    </div>
  );
}

const SIZES: { label: string; w: number; h: number }[] = [
  { label: 'Square', w: 1080, h: 1080 },
  { label: 'Portrait', w: 1080, h: 1350 },
  { label: 'Story', w: 1080, h: 1920 },
  { label: 'Landscape', w: 1920, h: 1080 },
  { label: 'Poster', w: 1200, h: 1800 },
];

function StartRow() {
  const page = useStore((s) => s.settings.newPage);
  return (
    <section className="home-start">
      <div className="home-new main">
        <button className="home-new-hit" onClick={() => newDesign()}>
          <span className="home-new-icon">
            <Icon name="plus" size={20} />
          </span>
          <strong>New design</strong>
          <span className="dim small">Logos, posters, posts, stickers</span>
        </button>
        <div className="home-sizes">
          <span className="home-page" aria-label="Page">
            <Segmented
              size="sm"
              value={page}
              options={[
              { value: 'white', label: 'White', title: 'Start on a white page' },
              { value: 'transparent', label: 'Clear', title: 'Start on a transparent page' },
              { value: 'dark', label: 'Dark', title: 'Start on a dark page' },
            ]}
              onChange={(v) => setSettings({ newPage: v })}
            />
          </span>
          {SIZES.map((s) => (
            <button key={s.label} className="chip" onClick={() => newDesign(s.w, s.h)} data-tip={`${s.w} × ${s.h}`}>
              <span className="size-glyph" style={{ aspectRatio: `${s.w} / ${s.h}` }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <button className="home-new" onClick={newFont}>
        <span className="home-new-icon type">Aa</span>
        <strong>New font</strong>
        <span className="dim small">Draw glyphs, export TTF and web fonts</span>
      </button>
      <div className="home-new list">
        {INTENTS.filter((i) => !i.font)
          .slice(0, 4)
          .map((i) => (
            <button key={i.label} className="home-intent" onClick={() => startIntent(i)}>
              <Icon name={i.icon as IconName} size={15} />
              <span>{i.label}</span>
              <span className="dim small">{i.hint}</span>
            </button>
          ))}
        <button className="home-intent" onClick={() => void openProject()}>
          <Icon name="open" size={15} />
          <span>Open a file…</span>
          <span className="dim small">.morpho</span>
        </button>
      </div>
    </section>
  );
}

function Templates({ limit, onAll }: { limit?: number; onAll?: () => void }) {
  const [cat, setCat] = useState<'All' | Template['category']>('All');
  const shown = TEMPLATES.filter((t) => cat === 'All' || t.category === cat).slice(0, limit);
  return (
    <section className="home-section">
      <div className="home-section-head">
        <h2>Templates</h2>
        {!limit && (
          <Segmented size="sm" value={cat} options={(['All', 'Learn', 'Logo', 'Icon', 'Type', 'Social', 'Print'] as const).map((c) => ({ value: c, label: c }))} onChange={setCat} />
        )}
        <span className="spacer" />
        {onAll && (
          <button className="link-btn" onClick={onAll}>
            All {TEMPLATES.length} templates
          </button>
        )}
      </div>
      <div className="templates home-templates">
        {shown.map((t) => (
          <TemplateCard key={t.name} t={t} onPick={() => startTemplate(t)} />
        ))}
      </div>
    </section>
  );
}

export function Home() {
  const list = useLibrary();
  const current = useStore((s) => s.projectId);
  const [view, setView] = useState<View>('home');
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const p = platform();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const shown = useMemo(() => {
    const all = list ?? [];
    const kind = view === 'designs' ? 'design' : view === 'fonts' ? 'font' : null;
    const needle = q.trim().toLowerCase();
    return all.filter((m) => (!kind || m.kind === kind) && (!needle || m.name.toLowerCase().includes(needle)));
  }, [list, view, q]);
  const counts = { designs: list?.filter((m) => m.kind === 'design').length ?? 0, fonts: list?.filter((m) => m.kind === 'font').length ?? 0 };
  const nav: { id: View; label: string; icon: IconName; n?: number }[] = [
    { id: 'home', label: 'Home', icon: 'grid' },
    { id: 'designs', label: 'Designs', icon: 'design', n: counts.designs },
    { id: 'fonts', label: 'Fonts', icon: 'type', n: counts.fonts },
    { id: 'templates', label: 'Templates', icon: 'sparkle', n: TEMPLATES.length },
  ];
  const recent = view === 'home' ? shown.slice(0, 12) : shown;
  return (
    <div className="home">
      <header className={`home-top ${p.kind === 'desktop' && p.isMac ? 'traffic' : ''}`} data-tauri-drag-region>
        <span className="brand static">
          <Logo size={18} />
          <span>Morphotype</span>
        </span>
        <span className="spacer" data-tauri-drag-region />
        <label className="home-search">
          <Icon name="search" size={14} />
          <input ref={search} placeholder="Search your designs and fonts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        </label>
        <span className="spacer" data-tauri-drag-region />
        <IconButton icon="help" title="How to use Morphotype" onClick={() => store.set({ dialog: { kind: 'help' } })} />
        <IconButton icon="settings" title="Settings" onClick={() => store.set({ dialog: { kind: 'settings' } })} />
      </header>
      <div className="home-body">
        <nav className="home-nav" aria-label="Library">
          {nav.map((n) => (
            <button key={n.id} className={`home-nav-item ${view === n.id ? 'on' : ''}`} onClick={() => setView(n.id)} aria-current={view === n.id}>
              <Icon name={n.icon} size={15} />
              <span>{n.label}</span>
              {!!n.n && <span className="dim small">{n.n}</span>}
            </button>
          ))}
          <span className="spacer" />
          <button className="home-nav-item" onClick={() => void openProject()}>
            <Icon name="open" size={15} />
            <span>Open a file…</span>
          </button>
          <button className="home-nav-item" onClick={() => void importFonts()}>
            <Icon name="font" size={15} />
            <span>Import fonts…</span>
          </button>
        </nav>
        <main className="home-main">
          {view === 'home' && (
            <>
              <h1 className="home-hello">What are you making today?</h1>
              <StartRow />
            </>
          )}
          {view !== 'templates' && (
            <section className="home-section">
              <div className="home-section-head">
                <h2>{view === 'home' ? 'Recent' : view === 'designs' ? 'Designs' : 'Fonts'}</h2>
                <span className="dim small">{shown.length || ''}</span>
                <span className="spacer" />
                {view === 'home' && shown.length > 12 && (
                  <button className="link-btn" onClick={() => setView('designs')}>
                    See all
                  </button>
                )}
              </div>
              {list !== null && !shown.length ? (
                <div className="home-empty">
                  {q ? (
                    <p>Nothing called “{q}”.</p>
                  ) : view === 'fonts' ? (
                    <>
                      <p>No fonts yet. Start one from any typeface, or draw every glyph yourself.</p>
                      <button className="btn primary" onClick={newFont}>
                        New font
                      </button>
                    </>
                  ) : (
                    <p>Your designs and fonts appear here. They save on this device as you work, so there's no need to save.</p>
                  )}
                </div>
              ) : (
                <div className="home-grid">
                  {recent.map((m) => (
                    <ProjectCard key={m.id} m={m} current={m.id === current} />
                  ))}
                </div>
              )}
            </section>
          )}
          {(view === 'home' || view === 'templates') && <Templates limit={view === 'home' ? 8 : undefined} onAll={view === 'home' ? () => setView('templates') : undefined} />}
        </main>
      </div>
    </div>
  );
}
