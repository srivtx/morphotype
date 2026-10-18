import { useEffect, useMemo, useState } from 'react';
import { addSystemFont } from '../app/actions';
import { platform, type SystemFont } from '../platform';
import { projectScene } from '../render/thumbs';
import { useThumb } from '../render/thumbs';
import { TEMPLATES, type Template } from '../state/templates';
import { replaceProject, store, toast, useStore } from '../state/store';
import { CommandPalette } from './CommandPalette';
import { HelpDialog } from './HelpDialog';
import { Icon } from './icons';
import { SettingsDialog } from './SettingsDialog';
import { TraceDialog } from './TraceDialog';
import { Dialog, Segmented } from './ui';

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  useEffect(() => {
    // "Export as font" lives in Type mode now.
    if (dialog?.kind === 'font') store.set({ dialog: null, mode: 'type', editing: null });
  }, [dialog]);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'trace':
      return <TraceDialog image={dialog.image} name={dialog.name} target={dialog.target ?? 'layer'} />;
    case 'templates':
      return <TemplatesDialog />;
    case 'systemFonts':
      return <SystemFontsDialog />;
    case 'settings':
      return <SettingsDialog initial={dialog.query} />;
    case 'help':
      return <HelpDialog />;
    case 'palette':
      return <CommandPalette />;
    default:
      return null;
  }
}

function TemplateCard({ t, onPick }: { t: Template; onPick: () => void }) {
  const url = useThumb(`tpl:${t.name}`, () => projectScene(t.make(), 300));
  const p = useMemo(() => t.make(), [t]);
  const aspect = p.canvas.width / p.canvas.height;
  return (
    <button className="template" onClick={onPick}>
      <span className="template-img">
        {url ? <img src={url} alt="" style={{ aspectRatio: String(aspect) }} draggable={false} /> : <span className="shimmer" />}
      </span>
      <strong>{t.name}</strong>
      <span>{t.hint}</span>
    </button>
  );
}

function TemplatesDialog() {
  const close = () => store.set({ dialog: null });
  const [cat, setCat] = useState<'All' | Template['category']>('All');
  const shown = TEMPLATES.filter((t) => cat === 'All' || t.category === cat);
  return (
    <Dialog title="Start from a template" subtitle="Every template is a normal document: change anything." onClose={close} size="xl">
      <div className="templates-head">
        <Segmented
          size="sm"
          value={cat}
          options={(['All', 'Logo', 'Icon', 'Type', 'Social'] as const).map((c) => ({ value: c, label: c }))}
          onChange={setCat}
        />
      </div>
      <div className="templates">
        <button
          className="template blank"
          onClick={() => {
            replaceProject({ ...TEMPLATES[0].make(), name: 'Untitled', layers: [] });
            close();
            window.dispatchEvent(new Event('mt-fit'));
          }}
        >
          <span className="template-img">
            <Icon name="plus" size={28} />
          </span>
          <strong>Blank canvas</strong>
          <span>Start from nothing</span>
        </button>
        {shown.map((t) => (
          <TemplateCard
            key={t.name}
            t={t}
            onPick={() => {
              replaceProject(t.make());
              close();
              window.dispatchEvent(new Event('mt-fit'));
            }}
          />
        ))}
      </div>
    </Dialog>
  );
}

function SystemFontsDialog() {
  const close = () => store.set({ dialog: null });
  const [list, setList] = useState<SystemFont[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    platform()
      .listSystemFonts?.()
      .then(setList, (e: Error) => {
        toast(e.message, 'error');
        setList([]);
      });
  }, []);
  const shown = useMemo(() => (list ?? []).filter((f) => `${f.family} ${f.style}`.toLowerCase().includes(q.toLowerCase())).slice(0, 400), [list, q]);
  return (
    <Dialog title="System fonts" subtitle="Fonts installed on this Mac. Click one to add it." onClose={close}>
      <div className="search-box">
        <Icon name="search" size={14} />
        <input autoFocus placeholder="Search installed fonts" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="sys-fonts">
        {list === null && <p className="hint">Scanning font folders…</p>}
        {shown.map((f) => (
          <button
            key={`${f.path}#${f.index}`}
            className="font-item"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(f.path);
              const entry = await addSystemFont(f.path, f.index);
              setBusy(null);
              if (entry) toast(`Added ${entry.name}`);
            }}
          >
            {f.family} <span className="dim">{f.style}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
