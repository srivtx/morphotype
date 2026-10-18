import { copyPNG, exportJPG, exportPNG, exportSVG, importFonts, importImage, openProject, saveProject } from '../app/actions';
import { run, shortcutOf } from '../app/commands';
import { platform } from '../platform';
import { edit, redo, store, undo, useStore } from '../state/store';
import { Icon, Logo } from './icons';
import { IconButton, Menu, MenuItem, MenuLabel, MenuSep, Segmented } from './ui';

export function TopBar() {
  const name = useStore((s) => s.project.name);
  const mode = useStore((s) => s.mode);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const pngScale = useStore((s) => s.settings.pngScale);
  const p = platform();
  const mac = p.isMac;
  const cmd = mac ? '⌘' : 'Ctrl+';
  return (
    <header className={`topbar ${p.kind === 'desktop' && mac ? 'traffic' : ''}`} data-tauri-drag-region>
      <Menu
        buttonClass="brand"
        label={
          <>
            <Logo size={18} />
            <span>Morphotype</span>
            <Icon name="chevronDown" size={11} className="caret" />
          </>
        }
        width={250}
      >
        {(close) => (
          <div className="menu-list">
            <MenuItem icon="sparkle" label="New from template…" kbd={shortcutOf('new')} onClick={() => (close(), store.set({ dialog: { kind: 'templates' } }))} />
            <MenuItem icon="open" label="Open project…" kbd={shortcutOf('open')} onClick={() => (close(), void openProject())} />
            <MenuItem icon="save" label="Save project…" kbd={shortcutOf('save')} onClick={() => (close(), void saveProject())} />
            <MenuSep />
            <MenuItem icon="font" label="Import fonts…" onClick={() => (close(), void importFonts())} />
            <MenuItem icon="image" label="Trace an image…" kbd={shortcutOf('trace')} onClick={() => (close(), void importImage())} />
            <MenuSep />
            <MenuItem icon="settings" label="Settings…" kbd={shortcutOf('settings')} onClick={() => (close(), store.set({ dialog: { kind: 'settings' } }))} />
            <MenuItem icon="help" label="How to use Morphotype" kbd="?" onClick={() => (close(), store.set({ dialog: { kind: 'help' } }))} />
          </div>
        )}
      </Menu>
      <Segmented
        value={mode}
        options={[
          { value: 'design', label: 'Design', icon: 'design', title: `Logos, icons and posts (${shortcutOf('mode-design')})` },
          { value: 'type', label: 'Type', icon: 'type', title: `Design a font, glyph by glyph (${shortcutOf('mode-type')})` },
        ]}
        onChange={(m) => store.set({ mode: m, editing: null })}
      />
      <div className="spacer" data-tauri-drag-region />
      <input className="doc-name" value={name} aria-label="Project name" spellCheck={false} onChange={(e) => edit((d) => (d.name = e.target.value), 'name')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <div className="spacer" data-tauri-drag-region />
      <button className="search-btn" onClick={() => run('palette')} aria-label="Search commands">
        <Icon name="search" size={14} />
        <span>Search</span>
        <kbd>{cmd}K</kbd>
      </button>
      <IconButton icon="undo" title="Undo" kbd={shortcutOf('undo')} disabled={!canUndo} onClick={undo} />
      <IconButton icon="redo" title="Redo" kbd={shortcutOf('redo')} disabled={!canRedo} onClick={redo} />
      <Menu
        buttonClass="btn primary"
        placement="bottom-end"
        width={260}
        label={
          <>
            <Icon name="export" size={14} /> Export
          </>
        }
      >
        {(close) => (
          <div className="menu-list">
            <MenuLabel>Image</MenuLabel>
            {[1, 2, 4].map((s) => (
              <MenuItem key={s} label={`PNG ${s}×`} kbd={s === pngScale ? shortcutOf('export-png') : undefined} onClick={() => (close(), void exportPNG(s))} />
            ))}
            <MenuItem label="JPG 2× (social posts)" onClick={() => (close(), void exportJPG(2))} />
            <MenuItem icon="copy" label="Copy as image" kbd={shortcutOf('copy-png')} onClick={() => (close(), void copyPNG())} />
            <MenuSep />
            <MenuLabel>Vector</MenuLabel>
            <MenuItem label="SVG" kbd={shortcutOf('export-svg')} onClick={() => (close(), void exportSVG())} />
            <MenuSep />
            <MenuLabel>Font</MenuLabel>
            <MenuItem icon="type" label="Make a font from this look…" onClick={() => (close(), run('export-font'))} />
          </div>
        )}
      </Menu>
    </header>
  );
}
