import { useEffect, useMemo, useState } from 'react';
import { addSystemFont } from '../app/actions';
import { platform, type SystemFont } from '../platform';
import { TEMPLATES } from '../state/model';
import { replaceProject, store, toast, useStore } from '../state/store';
import { Dialog } from './controls';
import { FontForgeDialog } from './FontForgeDialog';
import { TraceDialog } from './TraceDialog';

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'trace':
      return <TraceDialog image={dialog.image} name={dialog.name} />;
    case 'font':
      return <FontForgeDialog />;
    case 'templates':
      return <TemplatesDialog />;
    case 'systemFonts':
      return <SystemFontsDialog />;
  }
}

function TemplatesDialog() {
  const close = () => store.set({ dialog: null });
  return (
    <Dialog title="Start from a template" onClose={close} wide>
      <div className="templates">
        {TEMPLATES.map((t) => (
          <button
            key={t.name}
            className="template"
            onClick={() => {
              replaceProject(t.make());
              close();
              window.dispatchEvent(new Event('mt-fit'));
            }}
          >
            <strong>{t.name}</strong>
            <span>{t.hint}</span>
          </button>
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
    <Dialog title="System fonts" onClose={close}>
      <input autoFocus className="font-search" placeholder="Search installed fonts" value={q} onChange={(e) => setQ(e.target.value)} />
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
