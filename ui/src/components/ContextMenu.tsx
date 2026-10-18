import { useEffect, useState } from 'react';
import { primaryNode, selectedNodes } from '../app/actions';
import { commandById, run, shortcutOf } from '../app/commands';
import { isGroup } from '../state/model';
import { useStore } from '../state/store';
import { MenuItem, MenuSep, Popover } from './ui';

let openFn: ((x: number, y: number) => void) | null = null;

export function openContextMenu(x: number, y: number) {
  openFn?.(x, y);
}

const SECTIONS: string[][] = [
  ['cut', 'copy', 'paste', 'duplicate', 'delete'],
  ['group', 'merge', 'ungroup'],
  ['front', 'forward', 'backward', 'back'],
  ['points', 'add-warp', 'outline', 'break', 'construction'],
  ['copy-style', 'paste-style'],
  ['flip-h', 'flip-v', 'lock', 'hide'],
];

/** Right-click menu for the canvas and the layers panel. */
export function ContextMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const hasSel = useStore((s) => s.selection.length > 0);
  useEffect(() => {
    openFn = (x, y) => setAt({ x, y });
    return () => {
      openFn = null;
    };
  }, []);
  if (!at) return null;
  const close = () => setAt(null);
  const sections = hasSel ? SECTIONS : [['paste', 'select-all'], ['new', 'trace', 'canvas']];
  const n = primaryNode();
  const labelFor = (id: string) => {
    if (id === 'points' && n && !isGroup(n) && n.content.type !== 'path') return 'Edit points (converts to outline)';
    if (id === 'lock' && selectedNodes().every((x) => x.locked)) return 'Unlock';
    if (id === 'hide' && selectedNodes().every((x) => !x.visible)) return 'Show';
    return commandById(id)?.title ?? id;
  };
  return (
    <Popover anchor={at} onClose={close} width={250} className="context-menu">
      <div className="menu-list">
        {sections.map((ids, i) => {
          const items = ids.map((id) => commandById(id)).filter((c) => c && (!c.when || c.when()));
          if (!items.length) return null;
          return (
            <div key={i}>
              {i > 0 && <MenuSep />}
              {items.map((c) => (
                <MenuItem
                  key={c!.id}
                  icon={c!.icon}
                  label={labelFor(c!.id)}
                  kbd={shortcutOf(c!.id)}
                  danger={c!.id === 'delete'}
                  onClick={() => {
                    close();
                    run(c!.id);
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
