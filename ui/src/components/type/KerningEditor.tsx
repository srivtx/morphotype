import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { classLabel, classOf, editEntry, entriesFor, kernOf, pairChars, resolveKerning, suggestClasses, type KernEntry } from '../../app/kerning';
import { addKernClasses, editKernClass, kernPair, putInKernClass, removeKernClass, setKerning } from '../../app/typeActions';
import type { GlyphPreview } from '../../engine/types';
import type { KernClass, TypeProject } from '../../state/model';
import { beginGesture, commitEdit, store, toast, undo, useStore } from '../../state/store';
import { Icon } from '../icons';
import { IconButton, Menu, MenuItem, MenuSep, Section, Segmented, Toggle } from '../ui';

/** The font's own kerning (overrides left out): pairs ("AV") in em, and its units per em. */
export interface FontKerning {
  upm: number;
  pairs: Map<string, number>;
}

export interface Metrics {
  asc: number;
  desc: number;
  cap: number;
  x: number;
}

// ---------- Simple / Advanced ----------
// Simple kerns pairs. Advanced adds kerning classes: groups of letters that
// kern alike, edited once, with exceptions for single pairs.

const ADV = 'morphotype.kernAdvanced';
let advanced = (() => {
  try {
    return localStorage.getItem(ADV) === '1';
  } catch {
    return false;
  }
})();
const advSubs = new Set<() => void>();
function setKernAdvanced(v: boolean) {
  advanced = v;
  try {
    localStorage.setItem(ADV, v ? '1' : '0');
  } catch {
    // Not remembered, still works.
  }
  advSubs.forEach((f) => f());
}
const useKernAdvanced = () =>
  useSyncExternalStore(
    (f) => {
      advSubs.add(f);
      return () => void advSubs.delete(f);
    },
    () => advanced,
  );

/** One unit and, with ⇧, ten. */
const stepOf = (shift: boolean) => (shift ? 10 : 1);

/** A pair's kerning now, in em, and the entry that sets it. */
function kernNow(t: TypeProject, k: FontKerning | null, l: string, r: string) {
  return kernOf(t, l, r, k?.pairs.get(l + r) ?? 0);
}

/** Kern the open pair by `du` font units, changing what editing it changes (its class pair, unless "Only this pair"). */
function nudge(t: TypeProject, k: FontKerning, du: number) {
  const c = pairChars(store.get().kernPair);
  if (!c) return;
  const units = Math.round(kernNow(t, k, c[0], c[1]).value * k.upm);
  setKerning(editEntry(t, c[0], c[1], store.get().kernOnly).key, (units + du) / k.upm);
}

/** What sets a pair's kerning, in words. */
function entryText(t: TypeProject, e: KernEntry | null, covered: boolean) {
  if (!e) return 'The font’s own kerning';
  if (e.scope === 'pair') return covered ? 'An exception: just this pair' : 'Set by hand';
  const [a, b] = e.key.split(' ');
  const side = (s: string) => {
    const c = s.startsWith('@') && [...s].length > 1 ? t.kernClasses?.find((x) => x.id === s.slice(1)) : undefined;
    return c ? `[${classLabel(c)}]` : s;
  };
  return `Class kerning: ${side(a)} against ${side(b)}`;
}

/** Neighbours a pair is judged against: straight-sided letters of its case. */
function kernContext(ch: string) {
  if (/\p{Ll}/u.test(ch)) return 'n';
  if (/\p{Nd}/u.test(ch)) return '0';
  return 'H';
}

interface Placed {
  ch: string;
  x: number;
  adv: number;
  d: string;
}

/** Lay out characters with their outlines and kerning, in em. */
function layout(chars: string[], previews: Map<string, GlyphPreview>, kern: (l: string, r: string) => number): Placed[] {
  const out: Placed[] = [];
  let x = 0;
  chars.forEach((ch, i) => {
    if (i > 0 && chars[i - 1].trim() && ch.trim()) x += kern(chars[i - 1], ch);
    const p = previews.get(ch);
    const adv = p?.advance || (ch.trim() ? 0.5 : 0.26);
    out.push({ ch, x, adv, d: p?.d ?? '' });
    x += adv;
  });
  return out;
}

function useSize(ref: React.RefObject<HTMLElement | null>, init: { w: number; h: number }) {
  const [size, setSize] = useState(init);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

const DEFAULT_STRIP = 'AVATAR Type WAVE Toyota LTA Yo, P. 74';

/**
 * The kerning editor's canvas: the open pair set large between neighbours of
 * its case, its right letter draggable, and a line of text to pick pairs from.
 */
export function KerningStage({ t, previews, table, m }: { t: TypeProject; previews: Map<string, GlyphPreview>; table: FontKerning | null; m: Metrics }) {
  const pair = useStore((s) => s.kernPair);
  const only = useStore((s) => s.kernOnly);
  const [text, setText] = useState(pair);
  const [strip, setStrip] = useState(DEFAULT_STRIP);
  const [drag, setDrag] = useState<{ x: number; units: number; key: string } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useSize(stageRef, { w: 600, h: 400 });
  const chars = pairChars(pair);
  useEffect(() => {
    setText(pair);
    // "Only this pair" is about the pair it was turned on for.
    store.set({ kernOnly: false });
  }, [pair]);
  // ← → kern the open pair (⇧ for ten units) unless a field or list has the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = store.get();
      if (s.mode !== 'type' || s.typeTab !== 'kerning' || s.dialog || !table || !s.project.type) return;
      const el = e.target as HTMLElement;
      if (el.closest?.('input, textarea, select, [contenteditable], [role=grid], [role=listbox], .popover')) return;
      e.preventDefault();
      nudge(s.project.type, table, (e.key === 'ArrowLeft' ? -1 : 1) * stepOf(e.shiftKey));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [table]);
  const kern = (l: string, r: string) => kernNow(t, table, l, r).value;
  const upm = table?.upm ?? 1000;
  const now = chars ? kernNow(t, table, chars[0], chars[1]) : null;
  const units = now ? Math.round(now.value * upm) : 0;
  const covered = chars ? entriesFor(t, chars[0], chars[1]).length > 1 : false;
  // The pair between two neighbours on each side, as far as the font has them.
  const around = (ch: string) => (previews.has(kernContext(ch)) ? [kernContext(ch), kernContext(ch)] : []);
  const before = chars ? around(chars[0]) : [];
  const run = chars ? [...before, ...chars, ...around(chars[1])] : [];
  const li = before.length;
  const placed = layout(run, previews, kern);
  const width = placed.length ? placed[placed.length - 1].x + placed[placed.length - 1].adv : 1;
  const k = Math.max(20, Math.min((size.h * 0.62) / (m.asc - m.desc), (size.w * 0.86) / width));
  const ox = size.w / 2 - (width / 2) * k;
  const oy = size.h / 2 + ((m.asc + m.desc) / 2) * k + 10;
  const L = placed[li];
  const R = placed[li + 1];
  const startDrag = (e: React.PointerEvent) => {
    if (!chars || !table) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    beginGesture();
    setDrag({ x: e.clientX, units, key: editEntry(t, chars[0], chars[1], only).key });
  };
  return (
    <div className="glyph-stage kern-stage">
      <div className="glyph-toolbar">
        <label className="kern-pair" data-tip="Type two characters">
          <span className="dim small">Pair</span>
          <input
            className="text-field"
            aria-label="Kerning pair"
            value={text}
            maxLength={8}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              const p = kernPair(e.target.value);
              if (p) store.set({ kernPair: p });
            }}
            onKeyDown={(e) => {
              if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && table) {
                e.preventDefault();
                nudge(t, table, (e.key === 'ArrowUp' ? 1 : -1) * stepOf(e.shiftKey));
              }
            }}
          />
        </label>
        <IconButton icon="minus" title="Tighter · ← (⇧ for 10 units)" disabled={!chars || !table} onClick={(e) => table && nudge(t, table, -stepOf(e.shiftKey))} />
        <output className="kern-value" aria-label="Kerning value" data-tip={now ? `${now.value.toFixed(4)} em at ${upm} units per em` : undefined}>
          {chars && table ? `${units > 0 ? '+' : units < 0 ? '−' : ''}${Math.abs(units)}` : '–'}
          <span className="dim small"> units</span>
        </output>
        <IconButton icon="plus" title="Looser · → (⇧ for 10 units)" disabled={!chars || !table} onClick={(e) => table && nudge(t, table, stepOf(e.shiftKey))} />
        <span className="spacer" />
        <span className={`badge ${now?.entry ? 'merge' : ''}`}>{chars ? entryText(t, now?.entry ?? null, covered) : 'Type a pair'}</span>
        {now?.entry && (
          <button
            className="btn small"
            onClick={() => {
              setKerning(now.entry!.key, null);
              toast(now.entry!.scope === 'pair' ? `${pair} uses ${covered ? 'its classes' : 'the font’s kerning'} again` : 'Class kerning removed', 'info', { label: 'Undo', run: undo });
            }}
          >
            <Icon name="reset" size={13} /> {now.entry.scope === 'pair' && covered ? 'Remove exception' : 'Use the font’s'}
          </button>
        )}
      </div>
      <KernStrip t={t} previews={previews} table={table} text={strip} setText={setStrip} m={m} />
      <div className="glyph-canvas kern-canvas" ref={stageRef}>
        <svg
          width={size.w}
          height={size.h}
          aria-label={chars ? `${pair} in the font` : undefined}
          onPointerMove={(e) => {
            if (!drag || !table) return;
            const du = Math.round(((e.clientX - drag.x) / k) * upm);
            setKerning(drag.key, (drag.units + du) / upm);
          }}
          onPointerUp={() => {
            if (drag) commitEdit();
            setDrag(null);
          }}
          onPointerCancel={() => {
            if (drag) commitEdit();
            setDrag(null);
          }}
        >
          <g className="metric base">
            <line x1={0} x2={size.w} y1={oy} y2={oy} />
          </g>
          <g className="metric soft">
            <line x1={0} x2={size.w} y1={oy - m.cap * k} y2={oy - m.cap * k} />
            <line x1={0} x2={size.w} y1={oy - m.x * k} y2={oy - m.x * k} />
          </g>
          {L && R && (
            <>
              <rect className={`kern-gap ${units < 0 ? 'neg' : 'pos'}`} x={ox + Math.min(L.x + L.adv, R.x) * k} width={Math.abs(R.x - L.x - L.adv) * k} y={oy - m.asc * k} height={(m.asc - m.desc) * k} />
              <text className="kern-gap-label" x={ox + (L.x + L.adv) * k} y={oy - m.desc * k + 22} textAnchor="middle">
                {units}
              </text>
            </>
          )}
          {placed.map((g, i) => (
            <g key={i} transform={`matrix(${k},0,0,${k},${ox + g.x * k},${oy})`} className={i === li || i === li + 1 ? 'kern-glyph on' : 'kern-glyph'}>
              {g.d ? <path d={g.d} /> : <rect className="kern-missing" x={0.05} y={-m.cap} width={Math.max(0.05, g.adv - 0.1)} height={m.cap} />}
              {i === li + 1 && <rect className={`kern-handle ${drag ? 'dragging' : ''}`} x={0} y={-m.asc} width={g.adv} height={m.asc - m.desc} onPointerDown={startDrag} />}
            </g>
          ))}
        </svg>
        {!chars && <div className="glyph-empty">Type two characters, or click a pair in the line above.</div>}
      </div>
      <p className="glyph-hint">Drag the right letter · ← → kern by a unit, ⇧ by ten · click two letters in the line above to open their pair</p>
    </div>
  );
}

/** A line of text set with the font's kerning; clicking a letter opens it and the next as a pair. */
function KernStrip({ t, previews, table, text, setText, m }: { t: TypeProject; previews: Map<string, GlyphPreview>; table: FontKerning | null; text: string; setText: (s: string) => void; m: Metrics }) {
  const pair = useStore((s) => s.kernPair);
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref, { w: 600, h: 64 });
  const chars = [...text];
  const placed = layout(chars, previews, (l, r) => kernNow(t, table, l, r).value);
  const width = placed.length ? placed[placed.length - 1].x + placed[placed.length - 1].adv : 1;
  const k = Math.min((size.h - 16) / (m.asc - m.desc), (size.w - 24) / width);
  const ox = Math.max(12, size.w / 2 - (width / 2) * k);
  const oy = 8 + m.asc * k;
  const pick = (i: number) => {
    const j = i + 1 < chars.length && chars[i + 1].trim() ? i : i - 1;
    if (j >= 0 && chars[j].trim() && chars[j + 1]?.trim()) store.set({ kernPair: chars[j] + chars[j + 1] });
  };
  return (
    <div className="kern-strip">
      <input className="text-field kern-strip-text" aria-label="Kerning text" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
      <div className="kern-strip-line" ref={ref}>
        <svg width={size.w} height={size.h} aria-label="Click two letters to kern them">
          {placed.map((g, i) => {
            const inPair = (chars[i] + (chars[i + 1] ?? '') === pair) || (i > 0 && chars[i - 1] + chars[i] === pair);
            return (
              <g key={i} className={`kern-strip-glyph ${inPair ? 'on' : ''}`} onClick={() => pick(i)} data-ch={g.ch}>
                <rect x={ox + g.x * k} y={0} width={g.adv * k} height={size.h} className="kern-hit" />
                {g.d && <path transform={`matrix(${k},0,0,${k},${ox + g.x * k},${oy})`} d={g.d} />}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

type ListFilter = 'all' | 'hand';

/** The Kerning tab: the open pair, its classes (Advanced), and every kerned pair with search. */
export function KerningPanel({ t, table, family }: { t: TypeProject; table: FontKerning | null; family: string | null }) {
  const pair = useStore((s) => s.kernPair);
  const only = useStore((s) => s.kernOnly);
  const adv = useKernAdvanced();
  const chars = pairChars(pair);
  const covered = chars ? entriesFor(t, chars[0], chars[1]).length > 1 : false;
  const now = chars ? kernNow(t, table, chars[0], chars[1]) : null;
  const upm = table?.upm ?? 1000;
  return (
    <div className="inspector">
      <div className="sel-header">
        <span className="sel-kind">Kerning</span>
        <span className="spacer" />
        <button className={`adv-chip ${adv ? 'on' : ''}`} aria-pressed={adv} onClick={() => setKernAdvanced(!adv)} data-tip={adv ? 'Hide kerning classes' : 'Show kerning classes: letters that kern alike, edited once'}>
          Advanced
        </button>
      </div>
      <Section title="Pair" id="type-kern-pair">
        {chars ? (
          <>
            <div className="kern-pair-big" style={{ fontFamily: family ? `"${family}", system-ui` : 'system-ui', opacity: family ? 1 : 0.35 }} aria-label={`${pair} in the compiled font`}>
              {pair}
            </div>
            <p className="hint">
              {now ? `${Math.round(now.value * upm)} units (${now.value.toFixed(3)} em). ` : ''}
              {entryText(t, now?.entry ?? null, covered)}.
            </p>
            {covered && (
              <Toggle
                label="Only this pair"
                checked={only || now?.entry?.scope === 'pair'}
                hint="Kern just this pair, as an exception to its classes"
                onChange={(v) => {
                  store.set({ kernOnly: v });
                  // Turning it off takes the exception away: the pair follows its classes again.
                  if (!v && now?.entry?.scope === 'pair') {
                    setKerning(now.entry.key, null);
                    toast(`${pair} follows its classes again`, 'info', { label: 'Undo', run: undo });
                  }
                }}
              />
            )}
          </>
        ) : (
          <p className="hint">Type two characters on the canvas, or click two letters in its line of text.</p>
        )}
      </Section>
      {adv && <ClassesSection t={t} table={table} />}
      <PairList t={t} table={table} />
    </div>
  );
}

/** Which class a character is in on one side, and a menu to change it. */
function ClassPicker({ t, ch, side }: { t: TypeProject; ch: string; side: KernClass['side'] }) {
  const c = classOf(t, ch, side);
  const options = (t.kernClasses ?? []).filter((k) => k.side === side);
  return (
    <div className="kern-class-pick">
      <span className="kern-class-ch">{ch}</span>
      <span className="dim small">{side === 'right' ? 'right side' : 'left side'}</span>
      <Menu buttonClass="select" label={<><span className="select-value">{c ? classLabel(c) : 'No class'}</span><Icon name="chevronDown" size={12} /></>} title={`Class of ${ch}’s ${side} side`}>
        {(close) => (
          <div className="menu-list">
            {options.map((o) => (
              <MenuItem key={o.id} checked={o === c} label={classLabel(o)} onClick={() => (putInKernClass(ch, side, o.id), close())} />
            ))}
            {options.length > 0 && <MenuSep />}
            <MenuItem label={`New class with ${ch}`} onClick={() => (addKernClasses([{ side, chars: ch }]), close())} />
            <MenuItem label="No class" disabled={!c} onClick={() => (putInKernClass(ch, side, null), close())} />
          </div>
        )}
      </Menu>
    </div>
  );
}

/** A class's members, edited as text and applied on Enter or leaving the field. */
function ClassRow({ t, c }: { t: TypeProject; c: KernClass }) {
  const [text, setText] = useState(classLabel(c));
  useEffect(() => setText(classLabel(c)), [c.members]);
  const pairs = Object.keys(t.classKerning ?? {}).filter((k) => k.split(' ').includes(`@${c.id}`)).length;
  const apply = () => text.replace(/\s/g, '') !== c.members && editKernClass(c.id, text);
  return (
    <div className="kern-class-row">
      <input className="text-field" aria-label={`Class ${classLabel(c)}`} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
      <span className="dim small" data-tip="Class pairs kerned">{pairs || ''}</span>
      <IconButton
        icon="trash"
        title="Delete class"
        size={14}
        onClick={() => {
          removeKernClass(c.id);
          toast(`Class ${classLabel(c)} deleted`, 'info', { label: 'Undo', run: undo });
        }}
      />
    </div>
  );
}

function ClassesSection({ t, table }: { t: TypeProject; table: FontKerning | null }) {
  const pair = useStore((s) => s.kernPair);
  const chars = pairChars(pair);
  const [adding, setAdding] = useState<Record<KernClass['side'], string>>({ left: '', right: '' });
  const classes = t.kernClasses ?? [];
  const suggest = () => {
    if (!table) return;
    const charset = new Set(t.charset);
    const pairs = [...table.pairs].filter(([p]) => [...p].every((c) => charset.has(c)));
    const found = (['right', 'left'] as const).flatMap((side) => suggestClasses(t, pairs, side).map((g) => ({ side, chars: g.join('') })));
    if (!found.length) return toast('No more letters kern alike in this font', 'info');
    addKernClasses(found);
    toast(`${found.length} class${found.length > 1 ? 'es' : ''} from the font’s kerning`, 'info', { label: 'Undo', run: undo });
  };
  const group = (side: KernClass['side'], title: string, example: string) => (
    <div className="kern-class-group">
      <div className="dim small">{title}</div>
      {classes.filter((c) => c.side === side).map((c) => (
        <ClassRow key={c.id} t={t} c={c} />
      ))}
      <form
        className="kern-class-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (adding[side].trim()) addKernClasses([{ side, chars: adding[side] }]);
          setAdding({ ...adding, [side]: '' });
        }}
      >
        <input className="text-field" placeholder={`New class, e.g. ${example}`} aria-label={`New ${side}-side class`} value={adding[side]} onChange={(e) => setAdding({ ...adding, [side]: e.target.value })} />
        <button className="icon-btn" type="submit" aria-label={`Add ${side}-side class`}>
          <Icon name="plus" />
        </button>
      </form>
    </div>
  );
  return (
    <Section
      title="Classes"
      id="type-kern-classes"
      actions={
        <button className="link-btn" onClick={suggest} disabled={!table} data-tip="Group letters that already kern alike in the font">
          Suggest
        </button>
      }
    >
      <p className="hint">Letters in a class kern alike: kern one pair and the whole class follows. “Only this pair” makes an exception.</p>
      {chars && (
        <div className="kern-class-picks">
          <ClassPicker t={t} ch={chars[0]} side="right" />
          <ClassPicker t={t} ch={chars[1]} side="left" />
        </div>
      )}
      {group('right', 'Right sides · first in a pair', 'T V W')}
      {group('left', 'Left sides · second in a pair', 'o c e')}
    </Section>
  );
}

const LIST_MAX = 150;

/** Every kerned pair (the font's and yours), searchable; click one to open it. */
function PairList({ t, table }: { t: TypeProject; table: FontKerning | null }) {
  const pair = useStore((s) => s.kernPair);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');
  const upm = table?.upm ?? 1000;
  const hand = resolveKerning(t);
  const order = new Map([...t.charset].map((c, i) => [c, i]));
  const rank = (c: string) => order.get(c) ?? 1e6 + (c.codePointAt(0) ?? 0);
  const all = new Map(filter === 'all' ? table?.pairs ?? [] : []);
  for (const [p, v] of Object.entries(hand)) all.set(p, v);
  const query = q.replace(/\s/g, '');
  const rows = [...all]
    .filter(([p, v]) => (v !== 0 || p in hand) && (!query || p.includes(query)))
    .map(([p]) => {
      const [l, r] = pairChars(p)!;
      const k = kernNow(t, table, l, r);
      return { p, l, r, units: Math.round(k.value * upm), entry: k.entry, covered: entriesFor(t, l, r).length > 1 };
    })
    .sort((a, b) => rank(a.l) - rank(b.l) || rank(a.r) - rank(b.r));
  const tag = (r: (typeof rows)[number]) => (!r.entry ? '' : r.entry.scope === 'pair' ? (r.covered ? 'exception' : 'by hand') : 'class');
  return (
    <Section title="Pairs" id="type-kern-list" actions={<span className="dim small">{table ? rows.length : '…'}</span>}>
      <div className="kern-list-head">
        <input className="text-field" type="search" placeholder="Search: T, To…" aria-label="Search pairs" value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented
          size="sm"
          value={filter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'hand', label: 'Edited' },
          ]}
          onChange={setFilter}
        />
      </div>
      <div className="kern-list" role="listbox" aria-label="Kerning pairs">
        {rows.slice(0, LIST_MAX).map((r) => (
          <button key={r.p} role="option" aria-selected={r.p === pair} className={`kern-list-row ${r.p === pair ? 'on' : ''}`} onClick={() => store.set({ kernPair: r.p })}>
            <strong>{r.p}</strong>
            <span className="kern-tag">{tag(r)}</span>
            <span className="kern-units">{r.units}</span>
          </button>
        ))}
        {!rows.length && <p className="hint">{!table ? 'Measuring the font’s kerning…' : query ? 'No kerned pairs match.' : filter === 'hand' ? 'Nothing kerned by hand yet.' : 'This font has no kerning yet.'}</p>}
        {rows.length > LIST_MAX && <p className="hint">{rows.length - LIST_MAX} more: search to narrow them down.</p>}
      </div>
    </Section>
  );
}
