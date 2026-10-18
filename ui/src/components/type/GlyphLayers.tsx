// Layers inside a glyph: library shapes and other glyphs (components) added
// to, cut from or masking the outline, each with its own modifiers. Modular
// letters, i-dots, ink traps and accents are built from these.
import { useRef, useState } from 'react';
import { addGlyphPart, bakeGlyph, duplicateGlyphPart, editGlyphPart, editType, removeGlyphPart, reorderGlyphPart } from '../../app/typeActions';
import type { GlyphPart, GlyphPreview, Op, SymbolKind } from '../../engine/types';
import { SYMBOL_DEFAULTS, SYMBOL_UI, type TypeProject } from '../../state/model';
import { beginGesture, commitEdit, store, useStore } from '../../state/store';
import { useShape } from '../../render/thumbs';
import { Icon } from '../icons';
import { Modifiers } from '../Inspector';
import { ShapePicker } from '../pickers';
import { NumberBox, Popover, Section, Segmented, Slider, Toggle } from '../ui';

const OPS: { value: Op; label: string }[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Cut' },
  { value: 'intersect', label: 'Mask' },
];

function partLabel(p: GlyphPart) {
  return p.name ?? (p.glyph ? `“${p.glyph}”` : p.symbol ? SYMBOL_UI[p.symbol.kind]?.label : 'Path');
}

/** A part's own outline at 100 units, for list thumbnails and the canvas. */
function usePartShape(p: GlyphPart) {
  const key = p.symbol ? `gpart:${JSON.stringify([p.symbol, p.modifiers])}` : p.d ? `gpath:${p.d.length}:${JSON.stringify(p.modifiers)}:${p.d.slice(0, 64)}` : 'gpart:none';
  return useShape(key, () => ({
    layers: [
      {
        id: 'p',
        visible: true,
        op: 'add',
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1,
        sx: 1,
        sy: 1,
        modifiers: p.modifiers,
        content: p.symbol ? { type: 'symbol', symbol: p.symbol, size: 100 } : { type: 'path', d: p.d ?? '', size: 100 },
      },
    ],
  }));
}

function PartThumb({ p, previews }: { p: GlyphPart; previews: Map<string, GlyphPreview> }) {
  const shape = usePartShape(p);
  if (p.glyph) {
    const g = previews.get(p.glyph);
    return (
      <svg viewBox={`${-0.1} -0.95 ${Math.max(0.6, (g?.advance ?? 0.6) + 0.2)} 1.15`} className="row-thumb" aria-hidden>
        {g?.d && <path d={g.d} />}
      </svg>
    );
  }
  return (
    <svg viewBox="-60 -60 120 120" className="row-thumb" aria-hidden>
      {shape && <path d={shape.d} />}
    </svg>
  );
}

/** The layer stack of the open glyph, its outline at the bottom. */
export function GlyphLayers({ t, glyph, advance, previews }: { t: TypeProject; glyph: string; advance: number; previews: Map<string, GlyphPreview> }) {
  const sel = useStore((s) => s.glyphPart);
  const g = t.glyphs[glyph];
  const parts = g?.parts ?? [];
  const [adding, setAdding] = useState<'shape' | 'glyph' | null>(null);
  const [comp, setComp] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const others = [...t.charset].filter((c) => c !== glyph && !t.glyphs[c]?.parts?.some((p) => p.glyph === glyph));
  return (
    <Section
      title="Layers"
      id="glyph-layers"
      actions={
        <button ref={btn} className={`chip-btn ${adding ? 'on' : ''}`} onClick={() => setAdding(adding ? null : 'shape')} aria-haspopup="menu">
          <Icon name="plus" size={13} /> Add
        </button>
      }
    >
      {adding && (
        <Popover anchor={btn.current} onClose={() => setAdding(null)} width={340} placement="left-start">
          <div className="pad-x glyph-add-tabs">
            <Segmented
              size="sm"
              value={adding}
              options={[
                { value: 'shape', label: 'Shape' },
                { value: 'glyph', label: 'Another glyph' },
              ]}
              onChange={setAdding}
            />
          </div>
          {adding === 'shape' ? (
            <ShapePicker
              onPick={(k: SymbolKind) => {
                addGlyphPart(glyph, { symbol: k }, advance);
                setAdding(null);
              }}
            />
          ) : (
            <div className="glyph-comp">
              <p className="hint">A component follows every change to the glyph it copies: draw the dot once, use it on i, j, ! and ?.</p>
              <div className="glyph-comp-grid">
                {others.slice(0, 80).map((c) => (
                  <button
                    key={c}
                    className={`glyph-comp-cell ${comp === c ? 'on' : ''}`}
                    onClick={() => {
                      setComp(c);
                      addGlyphPart(glyph, { glyph: c }, advance);
                      setAdding(null);
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Popover>
      )}
      <div className="glyph-layer-list" role="list">
        {[...parts].reverse().map((p) => (
          <div key={p.id} role="listitem" className={`row ${sel === p.id ? 'selected' : ''} ${p.visible ? '' : 'hidden'}`} onClick={() => store.set({ glyphPart: p.id })}>
            <span className="row-kind">
              <PartThumb p={p} previews={previews} />
            </span>
            <span className="row-name">{partLabel(p)}</span>
            {p.op === 'subtract' && <span className="badge cut">Cut</span>}
            {p.op === 'intersect' && <span className="badge mask">Mask</span>}
            <span className={`row-tools ${p.visible ? '' : 'sticky'}`}>
              <button className="icon-btn tiny" aria-label={p.visible ? 'Hide' : 'Show'} data-tip={p.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), editGlyphPart(glyph, p.id, (x) => (x.visible = !x.visible)))}>
                <Icon name={p.visible ? 'eye' : 'eyeOff'} size={13} />
              </button>
            </span>
          </div>
        ))}
        <div className={`row ${sel === null ? 'selected' : ''} ${g?.hideBase ? 'hidden' : ''}`} role="listitem" onClick={() => store.set({ glyphPart: null })}>
          <span className="row-kind">
            <Icon name="type" size={14} />
          </span>
          <span className="row-name">{g?.d ? 'Drawn outline' : t.blank ? 'Outline (empty)' : 'Base letter'}</span>
          <span className={`row-tools ${g?.hideBase ? 'sticky' : ''}`}>
            <button
              className="icon-btn tiny"
              aria-label={g?.hideBase ? 'Show the outline' : 'Hide the outline'}
              data-tip={g?.hideBase ? 'Show the outline' : 'Build the glyph from its layers only'}
              onClick={(e) => (
                e.stopPropagation(),
                editType((tp) => {
                  const x = (tp.glyphs[glyph] ??= {});
                  x.hideBase = !x.hideBase || undefined;
                })
              )}
            >
              <Icon name={g?.hideBase ? 'eyeOff' : 'eye'} size={13} />
            </button>
          </span>
        </div>
      </div>
      {!parts.length && <p className="hint">Add shapes to build modular letters, cut ink traps and counters, or reuse another glyph as a component.</p>}
    </Section>
  );
}

/** Settings of the selected glyph layer. */
export function GlyphPartPanel({ glyph, part }: { glyph: string; part: GlyphPart }) {
  const advanced = useStore((s) => s.settings.advanced);
  const [picking, setPicking] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const set = (fn: (p: GlyphPart) => void, key = '') => editGlyphPart(glyph, part.id, fn, key);
  const ui = part.symbol ? SYMBOL_UI[part.symbol.kind] : null;
  return (
    <>
      <Section title={partLabel(part)} id="glyph-part">
        <div className="field">
          <span>Blend</span>
          <Segmented size="sm" value={part.op} options={OPS} onChange={(v) => set((p) => (p.op = v))} />
        </div>
        {part.symbol && (
          <div className="field">
            <span>Shape</span>
            <button ref={btn} className={`select ${picking ? 'open' : ''}`} onClick={() => setPicking(!picking)}>
              <span className="select-value">{ui?.label}</span>
              <Icon name="chevronDown" size={12} />
            </button>
          </div>
        )}
        {picking && (
          <Popover anchor={btn.current} onClose={() => setPicking(false)} width={340} placement="left-start">
            <ShapePicker
              onPick={(k: SymbolKind) => {
                set((p) => ((p.symbol = structuredClone(SYMBOL_DEFAULTS[k])), (p.name = SYMBOL_UI[k]?.label)));
                setPicking(false);
              }}
            />
          </Popover>
        )}
        <div className="grid2">
          <NumberBox label="X" value={round(part.x)} step={0.01} onChange={(v) => set((p) => (p.x = v), 'x')} title="Across, in em" />
          <NumberBox label="Y" value={round(-part.y)} step={0.01} onChange={(v) => set((p) => (p.y = -v), 'y')} title="Up from the baseline, in em" />
        </div>
        <Slider label={part.glyph ? 'Scale' : 'Size'} value={part.size} min={0.02} max={part.glyph ? 2 : 1.6} step={0.005} reset={part.glyph ? 1 : undefined} onChange={(v) => set((p) => (p.size = v), 'size')} suffix={part.glyph ? '×' : ' em'} />
        <Slider label="Rotation" value={part.rotation} min={-180} max={180} step={1} reset={0} onChange={(v) => set((p) => (p.rotation = v), 'rot')} suffix="°" />
        <Slider label="Stretch across" value={part.sx} min={-3} max={3} step={0.01} reset={1} onChange={(v) => set((p) => (p.sx = v), 'sx')} />
        <Slider label="Stretch up" value={part.sy} min={-3} max={3} step={0.01} reset={1} onChange={(v) => set((p) => (p.sy = v), 'sy')} />
        {ui?.fields
          .filter((f) => advanced || !f.advanced)
          .map((f) => (
            <Slider
              key={f.key}
              label={f.label}
              min={f.min}
              max={f.max}
              step={f.step}
              value={Number((part.symbol as unknown as Record<string, number>)[f.key] ?? 0)}
              reset={Number((SYMBOL_DEFAULTS[part.symbol!.kind] as unknown as Record<string, number>)[f.key])}
              onChange={(v) => set((p) => ((p.symbol as unknown as Record<string, number>)[f.key] = f.integer ? Math.round(v) : v), f.key)}
            />
          ))}
        <div className="button-row">
          <button className="btn small" onClick={() => duplicateGlyphPart(glyph, part.id)}>
            <Icon name="duplicate" size={13} /> Duplicate
          </button>
          <button className="btn small" onClick={() => reorderGlyphPart(glyph, part.id, 1)} data-tip="Move up">
            ↑
          </button>
          <button className="btn small" onClick={() => reorderGlyphPart(glyph, part.id, -1)} data-tip="Move down">
            ↓
          </button>
          <button className="btn small" onClick={() => removeGlyphPart(glyph, part.id)}>
            <Icon name="trash" size={13} /> Delete
          </button>
        </div>
      </Section>
      <Modifiers mods={part.modifiers} owner={`gpart:${part.id}`} onChange={(fn, key) => set((p) => fn(p.modifiers), key ? `mod:${key}` : '')} />
    </>
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Whether this glyph follows the font's look, and baking it into points. */
export function GlyphLook({ t, glyph }: { t: TypeProject; glyph: string }) {
  const g = t.glyphs[glyph];
  return (
    <Section title="Look" id="glyph-look">
      <Toggle
        checked={!g?.ownLook}
        onChange={(v) =>
          editType((tp) => {
            const x = (tp.glyphs[glyph] ??= {});
            x.ownLook = !v || undefined;
          })
        }
        label="Use the font's look"
        hint={t.modifiers.length ? 'Off: this glyph keeps only its own modifiers below' : 'The font has no look yet'}
      />
      <button className="btn wide" onClick={() => void bakeGlyph(glyph)} data-tip="Turn the finished glyph, look and layers included, into one outline you can reshape point by point">
        <Icon name="points" size={13} /> Bake into points
      </button>
      <p className="hint">Baking freezes the look: every dot, pixel or cut becomes a point you can drag. Undo brings the layers back.</p>
    </Section>
  );
}

/** Outlines of the glyph's layers on the canvas; drag to move, corner to resize. */
export function PartsOverlay({
  t,
  glyph,
  previews,
  k,
  toLocal,
}: {
  t: TypeProject;
  glyph: string;
  previews: Map<string, GlyphPreview>;
  k: number;
  toLocal: (e: { clientX: number; clientY: number }) => { x: number; y: number };
}) {
  const sel = useStore((s) => s.glyphPart);
  const parts = t.glyphs[glyph]?.parts ?? [];
  return (
    <g className="glyph-parts">
      {parts.map((p) =>
        p.visible ? <PartOutline key={p.id} p={p} glyph={glyph} selected={sel === p.id} previews={previews} k={k} toLocal={toLocal} /> : null,
      )}
    </g>
  );
}

function PartOutline({
  p,
  glyph,
  selected,
  previews,
  k,
  toLocal,
}: {
  p: GlyphPart;
  glyph: string;
  selected: boolean;
  previews: Map<string, GlyphPreview>;
  k: number;
  toLocal: (e: { clientX: number; clientY: number }) => { x: number; y: number };
}) {
  const shape = usePartShape(p);
  // Shapes are drawn at 100 units; components in em.
  const unit = p.glyph ? p.size : p.size / 100;
  const d = p.glyph ? previews.get(p.glyph)?.d : shape?.d;
  const box = p.glyph ? null : shape?.box;
  const transform = `translate(${p.x} ${p.y}) rotate(${p.rotation}) scale(${unit * p.sx} ${unit * p.sy})`;
  const drag = (e: React.PointerEvent, mode: 'move' | 'size') => {
    e.stopPropagation();
    e.preventDefault();
    store.set({ glyphPart: p.id });
    const start = toLocal(e);
    const from = { x: p.x, y: p.y, size: p.size };
    const r0 = Math.hypot(start.x - p.x, start.y - p.y) || 1e-3;
    beginGesture();
    const move = (ev: PointerEvent) => {
      const q = toLocal(ev);
      if (mode === 'move') {
        let x = from.x + q.x - start.x;
        let y = from.y + q.y - start.y;
        if (ev.shiftKey) Math.abs(x - from.x) > Math.abs(y - from.y) ? (y = from.y) : (x = from.x);
        editGlyphPart(glyph, p.id, (pp) => ((pp.x = x), (pp.y = y)), 'drag');
      } else {
        const s = Math.max(0.01, (from.size * Math.hypot(q.x - p.x, q.y - p.y)) / r0);
        editGlyphPart(glyph, p.id, (pp) => (pp.size = s), 'drag');
      }
    };
    const up = () => {
      commitEdit();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  if (!d) return null;
  return (
    <g>
      <path className={`glyph-part ${selected ? 'on' : ''} ${p.op}`} d={d} transform={transform} vectorEffect="non-scaling-stroke" onPointerDown={(e) => drag(e, 'move')} />
      {selected && box && (
        <g transform={transform}>
          <rect className="glyph-part-box" x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} vectorEffect="non-scaling-stroke" />
          <circle
            className="glyph-part-handle"
            cx={box[2]}
            cy={box[3]}
            r={5 / (k * Math.abs(unit * Math.min(Math.abs(p.sx), Math.abs(p.sy))) || 1)}
            onPointerDown={(e) => drag(e, 'size')}
          />
        </g>
      )}
    </g>
  );
}
