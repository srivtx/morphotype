import { useEffect, useMemo, useRef, useState } from 'react';
import { addShape, importImage, moveNodes, startText, toggleLocked, toggleVisible, updateNode } from '../app/actions';
import { run, shortcutOf } from '../app/commands';
import type { SymbolKind } from '../engine/types';
import { fillCss } from '../render/background';
import { viewBoxOf } from '../render/thumbs';
import { isGroup, morphLayer, nodeLabel, symbolLayer, type Group, type Node } from '../state/model';
import { edit, select, store, useStore } from '../state/store';
import { allLayers, ancestors, clipBase, find } from '../state/tree';
import { openContextMenu } from './ContextMenu';
import { Icon } from './icons';
import { ShapePicker } from './pickers';
import { IconButton, Menu, MenuItem, MenuSep, Popover } from './ui';

interface Row {
  node: Node;
  depth: number;
  parent: Group | null;
  /** Index in the parent's children (bottom → top order). */
  index: number;
  clipped: boolean;
}

function flatten(nodes: Node[], depth = 0, parent: Group | null = null): Row[] {
  const out: Row[] = [];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    out.push({ node: n, depth, parent, index: i, clipped: n.op !== 'add' && !!clipBase(nodes, i) });
    if (isGroup(n) && n.open !== false) out.push(...flatten(n.children, depth + 1, n));
  }
  return out;
}

type Drop = { row: number; where: 'above' | 'below' | 'inside' };

function Thumb({ node }: { node: Node }) {
  const outs = useStore((s) => s.build?.layers);
  if (isGroup(node)) return <Icon name={node.merge ? 'merge' : 'group'} />;
  if (node.content.type === 'text') return <Icon name="text" />;
  const o = outs?.find((x) => x.id === node.id);
  if (!o?.d || !o.bbox) return <Icon name="shapes" />;
  return (
    <svg viewBox={viewBoxOf(o.bbox, 0.06)} className="row-thumb" aria-hidden>
      <path d={o.d} />
    </svg>
  );
}

/** The artboard background as the bottom row, like a frame or background layer. */
function BackgroundRow() {
  const bg = useStore((s) => s.project.background);
  const selected = useStore((s) => s.selection.length === 0 && s.mode === 'design');
  return (
    <div
      className={`row bg-row ${selected ? 'selected' : ''}`}
      role="treeitem"
      aria-selected={selected}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        select([]);
        store.set({ tab: 'design' });
      }}
      data-tip="Background and app-icon tile"
    >
      <span className="row-caret" />
      <span className="row-kind">
        <span className="bg-swatch" style={{ background: fillCss(bg.fill) }}>
          {bg.tile && <span style={{ background: fillCss(bg.tile.fill) }} />}
        </span>
      </span>
      <span className="row-name">Background{bg.tile ? ' + tile' : ''}</span>
    </div>
  );
}

export function LayersPanel() {
  const layers = useStore((s) => s.project.layers);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const results = useStore((s) => s.build?.layers);
  const rows = useMemo(() => flatten(layers), [layers]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [shapes, setShapes] = useState(false);
  const shapeBtn = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { ids: string[]; y: number; active: boolean; id: string; plain: boolean }>(null);
  const anchorRef = useRef<string | null>(null);

  // Keep the selected row in view.
  useEffect(() => {
    const id = selection.at(-1);
    if (!id) return;
    listRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  const onRowDown = (e: React.PointerEvent, r: Row) => {
    if (e.button !== 0 || renaming) return;
    const id = r.node.id;
    if (e.shiftKey && anchorRef.current) {
      const a = rows.findIndex((x) => x.node.id === anchorRef.current);
      const b = rows.findIndex((x) => x.node.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const sameParent = rows.slice(lo, hi + 1).filter((x) => x.parent?.id === r.parent?.id);
      select(sameParent.map((x) => x.node.id));
    } else if (e.metaKey || e.ctrlKey) {
      select(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
      anchorRef.current = id;
    } else {
      if (!selection.includes(id)) select([id]);
      anchorRef.current = id;
    }
    dragRef.current = { ids: store.get().selection.includes(id) ? store.get().selection : [id], y: e.clientY, active: false, id, plain: !e.shiftKey && !e.metaKey && !e.ctrlKey };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const dropAt = (clientY: number): Drop | null => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>('.row:not(.bg-row)') ?? []);
    for (let i = 0; i < els.length; i++) {
      const rect = els[i].getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) continue;
      const t = (clientY - rect.top) / rect.height;
      const n = rows[i].node;
      if (isGroup(n)) return { row: i, where: t < 0.28 ? 'above' : t > 0.72 ? 'below' : 'inside' };
      return { row: i, where: t < 0.5 ? 'above' : 'below' };
    }
    if (els.length && clientY > els[els.length - 1].getBoundingClientRect().bottom) return { row: els.length - 1, where: 'below' };
    return null;
  };

  const onRowMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.active && Math.abs(e.clientY - d.y) < 4) return;
    d.active = true;
    const target = dropAt(e.clientY);
    // Not into or next to itself in a way that changes nothing.
    if (target && d.ids.some((id) => rows[target.row].node.id === id || ancestors(layers, rows[target.row].node.id).some((g) => g.id === id))) setDrop(null);
    else setDrop(target);
  };

  const onRowUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    const target = drop;
    setDrop(null);
    // A plain click on one of several selected rows selects just that row.
    if (d && !d.active && d.plain && store.get().selection.length > 1) select([d.id]);
    if (!d?.active || !target) return;
    const r = rows[target.row];
    if (target.where === 'inside' && isGroup(r.node)) {
      moveNodes(d.ids, r.node.id, r.node.children.length);
      updateNode(r.node.id, (n) => isGroup(n) && (n.open = true));
    } else {
      const parent = r.parent?.id ?? null;
      // The list is top-to-bottom; data is bottom-to-top.
      moveNodes(d.ids, parent, target.where === 'above' ? r.index + 1 : r.index);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming) return;
    const i = rows.findIndex((r) => r.node.id === selection.at(-1));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (rows[j]) {
        if (e.shiftKey) select([...new Set([...selection, rows[j].node.id])]);
        else select([rows[j].node.id]);
      }
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && rows[i] && isGroup(rows[i].node)) {
      e.preventDefault();
      e.stopPropagation();
      updateNode(rows[i].node.id, (n) => isGroup(n) && (n.open = e.key === 'ArrowRight'));
    } else if (e.key === 'Enter' && rows[i]) {
      e.preventDefault();
      e.stopPropagation();
      setRenaming(rows[i].node.id);
    }
  };

  return (
    <div className="layers">
      <div className="panel-head">
        <h3>Layers</h3>
        <div className="panel-head-tools">
          <IconButton icon="text" title="Add text" kbd="T" onClick={() => startText()} />
          <button ref={shapeBtn} className={`icon-btn ${shapes ? 'on' : ''}`} aria-label="Add shape" data-tip="Add shape" onClick={() => setShapes(!shapes)}>
            <Icon name="shapes" />
          </button>
          <Menu buttonClass="icon-btn" label={<Icon name="plus" />} title="Add…" placement="bottom-end" width={230}>
            {(close) => (
              <div className="menu-list">
                <MenuItem icon="text" label="Text" kbd="T" onClick={() => (close(), startText())} />
                <MenuItem icon="image" label="Trace an image…" kbd={shortcutOf('trace')} onClick={() => (close(), void importImage())} />
                <MenuItem
                  icon="morph"
                  label="Morph between two layers"
                  onClick={() => {
                    close();
                    const ls = allLayers(store.get().project.layers).filter((l) => l.content.type !== 'morph');
                    const a = ls.at(-2)?.id ?? '';
                    const b = ls.at(-1)?.id ?? '';
                    edit((p) => {
                      for (const id of [a, b]) {
                        const n = find(p.layers, id)?.node;
                        if (n) n.visible = false;
                      }
                    });
                    addShape(morphLayer(a, b));
                  }}
                />
                <MenuSep />
                <MenuItem icon="group" label="Group selection" kbd={shortcutOf('group')} onClick={() => (close(), run('group'))} />
                <MenuItem icon="merge" label="Merge selection into one shape" kbd={shortcutOf('merge')} onClick={() => (close(), run('merge'))} />
              </div>
            )}
          </Menu>
        </div>
      </div>
      <div className="layer-list" ref={listRef} role="tree" aria-label="Layers" tabIndex={0} onKeyDown={onKeyDown}>
        {rows.map((r, i) => {
          const n = r.node;
          const err = !isGroup(n) ? results?.find((x) => x.id === n.id)?.error : null;
          const sel = selection.includes(n.id);
          const ind = drop?.row === i ? `drop-${drop.where}` : '';
          return (
            <div
              key={n.id}
              data-id={n.id}
              role="treeitem"
              aria-selected={sel}
              aria-expanded={isGroup(n) ? n.open !== false : undefined}
              className={`row ${sel ? 'selected' : ''} ${hover === n.id ? 'hovered' : ''} ${n.visible ? '' : 'hidden'} ${n.locked ? 'locked' : ''} ${ind}`}
              style={{ paddingLeft: 8 + r.depth * 14 + (r.clipped ? 10 : 0) }}
              onPointerDown={(e) => onRowDown(e, r)}
              onPointerMove={onRowMove}
              onPointerUp={onRowUp}
              onPointerEnter={() => store.set({ hover: n.id })}
              onPointerLeave={() => store.get().hover === n.id && store.set({ hover: null })}
              onDoubleClick={() => setRenaming(n.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selection.includes(n.id)) select([n.id]);
                openContextMenu(e.clientX, e.clientY);
              }}
            >
              {isGroup(n) ? (
                <button
                  className={`row-caret ${n.open !== false ? 'open' : ''}`}
                  aria-label={n.open !== false ? 'Collapse' : 'Expand'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => updateNode(n.id, (x) => isGroup(x) && (x.open = x.open === false))}
                >
                  <Icon name="chevronRight" size={11} />
                </button>
              ) : (
                <span className="row-caret" />
              )}
              {r.clipped && <span className="clip-arrow" data-tip={n.op === 'subtract' ? 'Cuts into the layer below' : 'Masks the layer below'} />}
              <span className="row-kind">
                <Thumb node={n} />
              </span>
              {renaming === n.id ? (
                <input
                  className="row-rename"
                  autoFocus
                  defaultValue={n.name ?? nodeLabel(n)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (renaming) updateNode(n.id, (x) => (x.name = v || undefined));
                    setRenaming(null);
                    listRef.current?.focus();
                  }}
                />
              ) : (
                <span className="row-name">{nodeLabel(n)}</span>
              )}
              {err && (
                <span className="layer-warn" data-tip={err}>
                  <Icon name="warning" size={13} />
                </span>
              )}
              {n.op === 'subtract' && <span className="badge cut">Cut</span>}
              {n.op === 'intersect' && <span className="badge mask">Mask</span>}
              {isGroup(n) && n.merge && <span className="badge merge">Merged</span>}
              <span className={`row-tools ${n.locked || !n.visible ? 'sticky' : ''}`}>
                <button
                  className={`icon-btn tiny ${n.locked ? 'on' : ''}`}
                  aria-label={n.locked ? 'Unlock' : 'Lock'}
                  data-tip={n.locked ? 'Unlock' : 'Lock'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggleLocked([n.id])}
                >
                  <Icon name={n.locked ? 'lock' : 'unlock'} size={13} />
                </button>
                <button
                  className="icon-btn tiny"
                  aria-label={n.visible ? 'Hide' : 'Show'}
                  data-tip={n.visible ? 'Hide' : 'Show'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggleVisible([n.id])}
                >
                  <Icon name={n.visible ? 'eye' : 'eyeOff'} size={13} />
                </button>
              </span>
            </div>
          );
        })}
        <BackgroundRow />
        {rows.length === 0 && (
          <div className="empty-layers">
            <p>Your canvas is empty.</p>
            <p className="dim">Add text with T, pick a shape, drop in an image, or start from a template.</p>
            <button className="btn" onClick={() => store.set({ dialog: { kind: 'templates' } })}>
              <Icon name="sparkle" /> Browse templates
            </button>
          </div>
        )}
      </div>
      {shapes && (
        <Popover anchor={shapeBtn.current} onClose={() => setShapes(false)} placement="bottom-start" width={340}>
          <ShapePicker
            onPick={(k: SymbolKind) => {
              addShape(symbolLayer(k));
              setShapes(false);
            }}
          />
        </Popover>
      )}
    </div>
  );
}
