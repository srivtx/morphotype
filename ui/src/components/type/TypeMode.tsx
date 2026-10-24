import { useEffect, useRef, useState } from 'react';
import { importImage } from '../../app/actions';
import { addCharacters, addGlyphPart, baseStyle, CHARSETS, closeTypeProject, customFontId, customizeGlyph, editType, exportFontFile, exportWebKit, installOnMac, removeCharacter, resetGlyph, setTypeBase, specOf } from '../../app/typeActions';
import { StylePicker } from './StylePicker';
import { TypeStart } from './TypeStart';
import { GlyphLayers, GlyphLook, GlyphPartPanel, PartsOverlay } from './GlyphLayers';
import { TYPE_TERMS } from './TypeGuide';
import { Tour } from '../Tour';
import { engine } from '../../engine/client';
import type { GlyphPreview, ModEntry } from '../../engine/types';
import { KerningPanel, KerningStage, type FontKerning } from './KerningEditor';
import { platform } from '../../platform';
import { uid, type TypeProject } from '../../state/model';
import { lookOf, SHAPE_RECIPES } from '../../state/recipes';
import { setSettings, store, toast, undo, useStore } from '../../state/store';
import { PathPointEditor } from '../canvas/PointEditor';
import { FontPicker } from '../FontPicker';
import { Icon } from '../icons';
import { Modifiers } from '../Inspector';
import { IconButton, Menu, MenuItem, MenuSep, Section, Segmented, Slider } from '../ui';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'upper', label: 'A–Z' },
  { value: 'lower', label: 'a–z' },
  { value: 'digits', label: '0–9' },
  { value: 'other', label: 'More' },
] as const;
type Filter = (typeof FILTERS)[number]['value'];

/** Geometry-only key: names and the sample text don't change outlines. */
function geoKey(t: TypeProject) {
  return JSON.stringify([t.base, t.axes, t.morph, t.modifiers, t.tracking, t.glyphs]);
}

/** Inputs every glyph depends on; when they change, every preview is stale. */
function globalKey(t: TypeProject) {
  return JSON.stringify([t.base, t.axes, t.morph, t.modifiers, t.tracking, t.blank]);
}

/**
 * Styled outlines of the font's characters, refreshed after edits settle.
 * Editing one glyph only rebuilds that glyph (and glyphs using it as a part).
 */
function usePreviews(t: TypeProject | undefined) {
  const [map, setMap] = useState<Map<string, GlyphPreview>>(new Map());
  const [busy, setBusy] = useState(false);
  const glyph = useStore((s) => s.glyph);
  const done = useRef<{ global: string; glyphs: Record<string, string> }>({ global: '', glyphs: {} });
  const key = t ? geoKey(t) + t.charset : '';
  useEffect(() => {
    if (!t) return;
    let live = true;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const spec = specOf(t, { quality: 80 });
        const g = globalKey(t);
        const edits = Object.fromEntries([...t.charset].map((c) => [c, JSON.stringify(t.glyphs[c] ?? null)]));
        const prev = done.current;
        const all = prev.global !== g;
        // Glyphs whose own edit changed, plus any glyph that uses one of them.
        const changed = new Set([...t.charset].filter((c) => all || prev.glyphs[c] !== edits[c]));
        for (const [c, e] of Object.entries(t.glyphs)) if (e.parts?.some((p) => p.glyph && changed.has(p.glyph))) changed.add(c);
        // The open glyph first, sharper, so the editor responds quickly.
        const first = await engine.fontPreview({ ...spec, quality: 140 }, glyph);
        if (!live) return;
        setMap((m) => new Map([...m, ...first.map((p) => [p.ch, p] as const)]));
        changed.delete(glyph);
        const rest = changed.size ? await engine.fontPreview(spec, [...changed].join('')) : [];
        if (!live) return;
        setMap((m) => {
          const next = all ? new Map<string, GlyphPreview>() : new Map(m);
          for (const p of rest) next.set(p.ch, p);
          if (first[0]) next.set(glyph, first[0]);
          if (!all) for (const c of [...next.keys()]) if (!t.charset.includes(c)) next.delete(c);
          return next;
        });
        done.current = { global: g, glyphs: edits };
      } catch (e) {
        if (live) toast((e as Error).message, 'error');
      } finally {
        if (live) setBusy(false);
      }
    }, 140);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, glyph]);
  return { map, busy };
}

function metricsOf(t: TypeProject) {
  const info = store.get().fonts.find((f) => f.id === t.base)?.info;
  const upm = info?.unitsPerEm ?? 1000;
  return {
    asc: (info?.ascender ?? 800) / upm,
    desc: (info?.descender ?? -200) / upm,
    cap: (info?.capHeight ?? 700) / upm,
    x: (info?.xHeight ?? 500) / upm,
  };
}

export function TypeMode() {
  const type = useStore((s) => s.project.type);
  const ready = useStore((s) => s.ready);
  const tab = useStore((s) => s.typeTab);
  const { map, busy } = usePreviews(type);
  // Compiled only once the engine has the fonts it needs.
  const family = useCompiledFont(ready ? type : undefined);
  const kerning = useKerningTable(ready ? type : undefined, tab === 'kerning');
  if (!ready) return <div className="workspace type-mode" />;
  if (!type) return <TypeStart />;
  return (
    <main className="workspace type-mode">
      <aside className="panel left">
        <GlyphGrid t={type} previews={map} />
      </aside>
      <section className="type-center">
        {tab === 'kerning' ? <KerningStage t={type} previews={map} table={kerning} m={metricsOf(type)} /> : <GlyphCanvas t={type} previews={map} busy={busy} />}
        <Tester t={type} family={family} />
      </section>
      <aside className="panel right">
        <FontPanel t={type} previews={map} family={family} kerning={kerning} />
      </aside>
      <TypeTour />
    </main>
  );
}

function GlyphGrid({ t, previews }: { t: TypeProject; previews: Map<string, GlyphPreview> }) {
  const glyph = useStore((s) => s.glyph);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState('');
  const m = metricsOf(t);
  const chars = [...t.charset].filter((c) => {
    if (filter === 'all') return true;
    if (filter === 'other') return !CHARSETS.upper.includes(c) && !CHARSETS.lower.includes(c) && !CHARSETS.digits.includes(c);
    return CHARSETS[filter].includes(c);
  });
  const top = -m.asc - 0.05;
  const h = m.asc - m.desc + 0.1;
  return (
    <div className="glyphs">
      <div className="panel-head">
        <h3>Glyphs</h3>
        <span className="dim small">{[...t.charset].length}</span>
      </div>
      <div className="pad-x">
        <Segmented size="sm" value={filter} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} onChange={setFilter} />
      </div>
      <div
        className="glyph-grid"
        role="grid"
        tabIndex={0}
        onKeyDown={(e) => {
          const all = [...t.charset];
          const i = all.indexOf(glyph);
          const cols = 4;
          const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : 0;
          if (d) {
            e.preventDefault();
            e.stopPropagation();
            store.set({ glyph: all[Math.max(0, Math.min(all.length - 1, i + d))] });
          }
        }}
      >
        {chars.map((c) => {
          const p = previews.get(c);
          const adv = p?.advance || 0.6;
          const w = Math.max(adv, h * 0.8);
          return (
            <button key={c} className={`glyph-cell ${c === glyph ? 'on' : ''} ${p && !p.d ? 'missing' : ''}`} onClick={() => store.set({ glyph: c })} aria-label={`Glyph ${c}`}>
              <svg viewBox={`${adv / 2 - w / 2} ${top} ${w} ${h}`} aria-hidden>
                {p?.d && <path d={p.d} />}
              </svg>
              <span className="glyph-char">{c}</span>
              {t.glyphs[c] && <span className="glyph-dot" data-tip="Edited" />}
            </button>
          );
        })}
      </div>
      <form
        className="add-chars"
        onSubmit={(e) => {
          e.preventDefault();
          const v = adding.trim();
          const cp = /^u\+([0-9a-f]{2,6})$/i.exec(v);
          addCharacters(cp ? String.fromCodePoint(parseInt(cp[1], 16)) : v);
          setAdding('');
        }}
      >
        <input placeholder="Add characters: ★ é ß or U+2605" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <button className="icon-btn" aria-label="Add characters" type="submit">
          <Icon name="plus" />
        </button>
      </form>
    </div>
  );
}

function GlyphCanvas({ t, previews, busy }: { t: TypeProject; previews: Map<string, GlyphPreview>; busy: boolean }) {
  const glyph = useStore((s) => s.glyph);
  const partSel = useStore((s) => s.glyphPart);
  const fonts = useStore((s) => s.fonts);
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 600, h: 500 });
  const [base, setBase] = useState<{ d: string; advance: number; exists: boolean } | null>(null);
  const [term, setTerm] = useState<{ key: string; x: number; y: number } | null>(null);
  const edit = t.glyphs[glyph];
  const p = previews.get(glyph);
  const m = metricsOf(t);
  const baseName = fonts.find((f) => f.id === t.base)?.name ?? 'the base font';
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    engine.glyphPath(t.base, t.axes, glyph).then((g) => live && setBase(g), () => live && setBase(null));
    return () => {
      live = false;
    };
  }, [t.base, JSON.stringify(t.axes), glyph]);
  const adv = edit?.advance ?? p?.advance ?? base?.advance ?? 0.6;
  // Fit ascender..descender and the advance with margins.
  const spanY = m.asc - m.desc + 0.5;
  const spanX = Math.max(adv, 0.4) + 0.8;
  const k = Math.max(40, Math.min(size.h / spanY, size.w / spanX));
  const ox = size.w / 2 - (adv / 2) * k;
  const oy = size.h / 2 + ((m.asc + m.desc) / 2) * k;
  const S = (q: { x: number; y: number }) => ({ x: ox + q.x * k, y: oy + q.y * k });
  const line = (y: number, label: string, key: string, cls = '') => (
    <g className={`metric ${cls}`}>
      <line x1={0} x2={size.w} y1={oy + y * k} y2={oy + y * k} />
      <text
        x={8}
        y={oy + y * k - 5}
        className="metric-label"
        onClick={(e) => setTerm(term?.key === key ? null : { key, x: e.nativeEvent.offsetX, y: oy + y * k })}
      >
        {label} ⓘ
      </text>
    </g>
  );
  const all = [...t.charset];
  const idx = all.indexOf(glyph);
  const drawn = !!edit?.d;
  const part = edit?.parts?.find((x) => x.id === partSel) ?? null;
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k };
  };
  const empty = !drawn && p && !p.d;
  // In a blank font the base outline is only a guide to trace over.
  const guide = base?.exists && (t.blank || drawn);
  return (
    <div className="glyph-stage">
      <div className="glyph-toolbar">
        <IconButton icon="chevronRight" className="flip" title="Previous glyph" onClick={() => store.set({ glyph: all[(idx - 1 + all.length) % all.length] })} />
        <span className="glyph-title">
          <strong>{glyph}</strong>
          <span className="dim">U+{glyph.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}</span>
          {!t.blank && !base?.exists && !drawn && <span className="badge mask">Not in base font</span>}
          {drawn && <span className="badge merge">{t.blank ? 'Drawn' : 'Edited'}</span>}
        </span>
        <IconButton icon="chevronRight" title="Next glyph" onClick={() => store.set({ glyph: all[(idx + 1) % all.length] })} />
        <span className="spacer" />
        {busy && <span className="dim small">Updating…</span>}
        {!drawn ? (
          !empty && (
            <button className="btn small" onClick={() => void customizeGlyph(glyph, 'base')}>
              <Icon name="points" size={13} /> Edit points
            </button>
          )
        ) : (
          <button
            className="btn small"
            onClick={() => {
              resetGlyph(glyph);
              toast(t.blank ? `Cleared “${glyph}”` : `Reset “${glyph}”`, 'info', { label: 'Undo', run: undo });
            }}
          >
            <Icon name="reset" size={13} /> {t.blank ? 'Clear' : 'Reset'}
          </button>
        )}
        <button className="btn small" onClick={() => void importImage(undefined, 'glyph')}>
          <Icon name="image" size={13} /> Trace image
        </button>
      </div>
      <div className="glyph-canvas" ref={ref}>
        <svg ref={svgRef} width={size.w} height={size.h} onPointerDown={(e) => e.target === e.currentTarget && part && store.set({ glyphPart: null })}>
          {line(m.desc * -1, 'Descender', 'descender', 'soft')}
          {line(0, 'Baseline', 'baseline', 'base')}
          {line(-m.x, 'x-height', 'xheight', 'soft')}
          {line(-m.cap, 'Cap height', 'cap')}
          {line(-m.asc, 'Ascender', 'ascender', 'soft')}
          <line className="metric side" x1={ox} x2={ox} y1={0} y2={size.h} />
          <line className="metric side" x1={ox + adv * k} x2={ox + adv * k} y1={0} y2={size.h} />
          <text className="metric-label adv-label" x={ox + (adv * k) / 2} y={size.h - 34} textAnchor="middle" onClick={(e) => setTerm(term?.key === 'advance' ? null : { key: 'advance', x: e.nativeEvent.offsetX, y: size.h - 150 })}>
            Width {adv.toFixed(2)} em ⓘ
          </text>
          <g transform={`matrix(${k},0,0,${k},${ox},${oy})`}>
            {guide && <path className="glyph-base" d={base!.d} />}
            {p?.d && <path className="glyph-fill" d={p.d} />}
            {!!edit?.parts?.length && <PartsOverlay t={t} glyph={glyph} previews={previews} k={k} toLocal={toLocal} />}
          </g>
          {drawn && !part && !edit?.hideBase && (
            <PathPointEditor
              key={glyph}
              d={edit!.d!}
              scale={1}
              pxPerUnit={k}
              toScreen={S}
              toLocal={toLocal}
              onChange={(d, key) => editType((tp) => (tp.glyphs[glyph] = { ...(tp.glyphs[glyph] ?? {}), d }), key ? `${glyph}:${key}` : '')}
              onExit={() => undefined}
              viewKey={`${k},${ox},${oy}`}
            />
          )}
        </svg>
        {term && (
          <div className="term-tip" style={{ left: Math.min(term.x, size.w - 280), top: term.y + 10 }} role="note">
            <strong>{TYPE_TERMS[term.key].name}</strong>
            <p>{TYPE_TERMS[term.key].text}</p>
            <button className="link-btn" onClick={() => (setTerm(null), store.set({ dialog: { kind: 'typeGuide', topic: term.key === 'advance' ? 'spacing' : 'anatomy' } }))}>
              Learn more
            </button>
          </div>
        )}
        {empty && (
          <div className="glyph-empty">
            <p>{t.blank ? `“${glyph}” isn't drawn yet.` : `“${glyph}” isn't in ${baseName}.`}</p>
            <div className="button-row">
              <button className="btn primary" onClick={() => void customizeGlyph(glyph, 'scratch')}>
                <Icon name="points" size={13} /> Start from a block
              </button>
              <button className="btn" onClick={() => addGlyphPart(glyph, { symbol: 'circle' }, adv)} data-tip="Build the glyph from circles, quarters, pills and other shapes">
                <Icon name="shapes" size={13} /> Build from shapes
              </button>
              {base?.exists && (
                <button className="btn" onClick={() => void customizeGlyph(glyph, 'base')} data-tip={`Copy ${baseName}'s outline and reshape it`}>
                  Copy the guide
                </button>
              )}
            </div>
            {t.blank && base?.exists && <p className="dim small">The grey letter is {baseName}'s, as a guide. It isn't part of your font.</p>}
          </div>
        )}
      </div>
      {part ? (
        <p className="glyph-hint">Drag the layer to move it · drag its corner to resize · ⇧ keeps it on one axis · click empty space for the outline</p>
      ) : (
        drawn && <p className="glyph-hint">Drag points · double-click a line to add one · double-click a point for smooth/sharp · ⌫ deletes · ⌘A selects all</p>
      )}
    </div>
  );
}

/**
 * The font compiled for real and registered with the page, recompiled after
 * edits settle. Returns its CSS family name once the first build is in.
 */
function useCompiledFont(t: TypeProject | undefined) {
  const [family, setFamily] = useState<string | null>(null);
  const counter = useRef(0);
  const faceRef = useRef<FontFace | null>(null);
  const key = t ? geoKey(t) + t.charset + JSON.stringify([t.kerning, t.kernClasses, t.classKerning]) : '';
  useEffect(() => {
    if (!t) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const bytes = await engine.exportFont(specOf(t, { quality: 90 }));
        if (!live) return;
        const name = `mt-tester-${++counter.current}`;
        const face = new FontFace(name, bytes.slice().buffer as ArrayBuffer);
        await face.load();
        if (!live) return;
        document.fonts.add(face);
        // Each edit compiles a new font; drop the one it replaces.
        if (faceRef.current) document.fonts.delete(faceRef.current);
        faceRef.current = face;
        setFamily(name);
      } catch {
        // Previews are best-effort; export reports real errors.
      }
    }, 550);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return family;
}

/**
 * The font's own kerning for the kerning editor, measured once the editor
 * is open and again when the look, the characters or a redrawn glyph change it.
 */
function useKerningTable(t: TypeProject | undefined, on: boolean) {
  const [table, setTable] = useState<FontKerning | null>(null);
  // Redrawn glyphs keep no kerning of the base font's.
  const key = t ? JSON.stringify([globalKey(t), t.charset, Object.entries(t.glyphs).filter(([, g]) => g.d || g.hideBase || g.parts?.some((p) => p.visible)).map(([c]) => c)]) : '';
  const done = useRef('');
  useEffect(() => {
    if (!t || !on || done.current === key) return;
    let live = true;
    const timer = setTimeout(() => {
      engine.kerningTable({ ...specOf(t), kerning: {} }).then(
        (k) => {
          if (!live) return;
          done.current = key;
          setTable({ upm: k.unitsPerEm, pairs: new Map(k.pairs) });
        },
        (e: Error) => live && toast(e.message, 'error'),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);
  return table;
}

/** Live preview with the real compiled font. */
function Tester({ t, family }: { t: TypeProject; family: string | null }) {
  const [size, setSize] = useState(64);
  return (
    <div className="tester">
      <div className="tester-head">
        <span className="dim small">Type tester · the real compiled font</span>
        <div className="tester-size">
          <Slider label="Size" value={size} min={12} max={200} step={1} onChange={setSize} />
        </div>
      </div>
      <textarea
        className="tester-text"
        value={t.sample}
        spellCheck={false}
        onChange={(e) => editType((tp) => (tp.sample = e.target.value), 'sample')}
       
        style={{ fontFamily: family ? `"${family}", system-ui` : 'system-ui', fontSize: size, opacity: family ? 1 : 0.35 }}
      />
    </div>
  );
}

function FontPanel({ t, previews, family, kerning }: { t: TypeProject; previews: Map<string, GlyphPreview>; family: string | null; kerning: FontKerning | null }) {
  const tab = useStore((s) => s.typeTab);
  const glyph = useStore((s) => s.glyph);
  const partSel = useStore((s) => s.glyphPart);
  useEffect(() => {
    if (partSel) store.set({ typeTab: 'glyph' });
  }, [partSel]);
  return (
    <>
      <div className="tabs type-tabs" role="tablist">
        {(
          [
            ['font', 'Font'],
            ['glyph', `Glyph ${glyph}`],
            ['kerning', 'Kerning'],
            ['export', 'Use & export'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => store.set({ typeTab: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        {tab === 'font' && <FontTab t={t} />}
        {tab === 'glyph' && <GlyphTab t={t} previews={previews} />}
        {tab === 'kerning' && <KerningPanel t={t} table={kerning} family={family} />}
        {tab === 'export' && <ExportTab t={t} />}
      </div>
    </>
  );
}

function FontTab({ t }: { t: TypeProject }) {
  const looks = SHAPE_RECIPES.filter((r) => !r.mods.some((m) => ['arc', 'warp', 'wave'].includes(m.kind)));
  const current = lookOf(t.modifiers, looks);
  return (
    <div className="inspector">
      <div className="sel-header">
        <span className="sel-kind">Font</span>
        <label className="sel-name-wrap" data-tip="Family name">
          <input className="sel-name" value={t.family} aria-label="Family name" onChange={(e) => editType((tp) => (tp.family = e.target.value), 'family')} />
        </label>
        <Menu buttonClass="icon-btn" label={<Icon name="more" />} title="More" placement="bottom-end" width={230}>
          {(close) => (
            <div className="menu-list">
              <MenuItem icon="help" label="Type basics" onClick={() => (close(), store.set({ dialog: { kind: 'typeGuide' } }))} />
              <MenuItem icon="sparkle" label="Show the tour again" onClick={() => (close(), window.dispatchEvent(new Event('mt-type-tour')))} />
              <MenuSep />
              <MenuItem
                icon="plus"
                label="Start a new font…"
                onClick={() => {
                  close();
                  closeTypeProject();
                  toast('Closed this font', 'info', { label: 'Undo', run: undo });
                }}
              />
            </div>
          )}
        </Menu>
      </div>
      <Section title="Look for every glyph" id="type-looks">
        <div className="looks">
          {looks.slice(0, 12).map((r) => (
            <button
              key={r.name}
              className={`look text ${current === r ? 'on' : ''}`}
              aria-pressed={current === r}
              onClick={(e) =>
                editType((tp) => {
                  const fresh = r.mods.map((m) => ({ ...structuredClone(m), on: true, uid: uid('m') }) as ModEntry);
                  tp.modifiers = e.shiftKey ? [...tp.modifiers, ...fresh] : fresh;
                })
              }
              data-tip={`${r.name} · ⇧-click to add on top`}
            >
              <span>{r.name}</span>
            </button>
          ))}
          <button className={`look text ${t.modifiers.length === 0 ? 'on' : ''}`} onClick={() => editType((tp) => (tp.modifiers = []))}>
            <span>Plain</span>
          </button>
        </div>
        <p className="hint">
          {t.modifiers.length && !current ? 'Custom look: your own modifier settings. ' : ''}One rule for every glyph keeps the font consistent. Fine-tune it under Modifiers, or give a glyph its own look in the Glyph tab.
        </p>
      </Section>
      <Section title="Spacing" id="type-spacing">
        <Slider label="Letter spacing" value={t.tracking} min={-0.2} max={0.5} step={0.005} reset={0} onChange={(v) => editType((tp) => (tp.tracking = v), 'tracking')} />
        <p className="hint">
          Space added to every glyph's width.{' '}
          <button className="link-btn inline" onClick={() => store.set({ dialog: { kind: 'typeGuide', topic: 'spacing' } })}>
            How spacing works
          </button>
        </p>
      </Section>
      <Section title={t.blank ? 'Metrics' : 'Base'} id="type-family">
        <StylePicker value={t.style} base={t.blank ? undefined : baseStyle(t.base)} mods={t.modifiers} onChange={(v) => editType((tp) => (tp.style = v), 'style')} />
        <div className="field">
          <span>{t.blank ? 'Lines from' : 'Base font'}</span>
          <FontPicker value={t.base} onChange={(id) => id && setTypeBase(id)} />
        </div>
        {!t.blank && (
          <>
            <div className="field">
              <span>Morph to</span>
              <FontPicker allowNone value={t.morph?.font ?? null} onChange={(id) => editType((tp) => (tp.morph = id ? { font: id, t: tp.morph?.t ?? 0.5, axes: {} } : null))} />
            </div>
            {t.morph && <Slider label="Blend" value={t.morph.t} min={0} max={1} step={0.005} onChange={(v) => editType((tp) => tp.morph && (tp.morph.t = v), 'morph')} />}
          </>
        )}
        <p className="hint">{t.blank ? 'Your glyphs use this font’s baseline, x-height and cap height as guides.' : 'Glyphs you haven’t redrawn come from the base font, with the look applied.'}</p>
      </Section>
      <Section title="Modifiers" id="type-mods" defaultOpen={t.modifiers.length > 0 && store.get().settings.advanced}>
        <Modifiers mods={t.modifiers} owner="type" onChange={(fn, key) => editType((tp) => fn(tp.modifiers), key)} />
      </Section>
    </div>
  );
}

function GlyphTab({ t, previews }: { t: TypeProject; previews: Map<string, GlyphPreview> }) {
  const glyph = useStore((s) => s.glyph);
  const partSel = useStore((s) => s.glyphPart);
  const g = t.glyphs[glyph];
  const part = g?.parts?.find((x) => x.id === partSel) ?? null;
  const advance = g?.advance ?? previews.get(glyph)?.advance ?? 0.6;
  return (
    <div className="inspector">
      <div className="sel-header">
        <span className="sel-kind">Glyph</span>
        <span className="glyph-badge">{glyph}</span>
        <span className="dim small">U+{glyph.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}</span>
      </div>
      <Section title="Shape" id="glyph-shape">
        <div className="button-row">
          {!g?.d ? (
            <>
              <button className="btn" onClick={() => void customizeGlyph(glyph, 'base')}>
                <Icon name="points" size={13} /> {t.blank ? 'Copy the guide' : 'Edit points'}
              </button>
              <button className="btn" onClick={() => void customizeGlyph(glyph, 'scratch')}>
                Start from a block
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => resetGlyph(glyph)}>
              <Icon name="reset" size={13} /> {t.blank ? 'Clear' : 'Back to the base glyph'}
            </button>
          )}
          <button className="btn" onClick={() => void importImage(undefined, 'glyph')}>
            <Icon name="image" size={13} /> Trace
          </button>
        </div>
      </Section>
      <Section title="Width" id="glyph-width">
        <Slider
          label="Advance width"
          value={g?.advance ?? previews.get(glyph)?.advance ?? 0.6}
          min={0}
          max={2}
          step={0.005}
          onChange={(v) => editType((tp) => (tp.glyphs[glyph] = { ...(tp.glyphs[glyph] ?? {}), advance: v }), `adv:${glyph}`)}
        />
        {g?.advance !== undefined && !g.d && (
          <button className="link-btn" onClick={() => editType((tp) => tp.glyphs[glyph] && delete tp.glyphs[glyph].advance)}>
            Use the base width
          </button>
        )}
        <p className="hint">The box the glyph takes up, including the space on each side.</p>
      </Section>
      <GlyphLayers t={t} glyph={glyph} advance={advance} previews={previews} />
      {part && <GlyphPartPanel glyph={glyph} part={part} />}
      <GlyphLook t={t} glyph={glyph} />
      <Modifiers
        mods={g?.modifiers ?? []}
        owner={`glyph:${glyph}`}
        onChange={(fn, key) =>
          editType((tp) => {
            const cur = (tp.glyphs[glyph] ??= {});
            cur.modifiers ??= [];
            fn(cur.modifiers);
          }, key)
        }
      />
      <div className="pad">
        <button className="btn small" onClick={() => removeCharacter(glyph)}>
          <Icon name="trash" size={13} /> Remove “{glyph}” from the font
        </button>
      </div>
    </div>
  );
}

function ExportTab({ t }: { t: TypeProject }) {
  const desktop = !!platform().installFont;
  const used = useStore((s) => s.fonts.some((f) => f.id === customFontId(t)));
  return (
    <div className="inspector">
      <Section title="Use it here" id="type-use">
        <button className="btn primary wide" onClick={() => store.set({ dialog: { kind: 'useFont' } })}>
          <Icon name="design" size={14} /> {used ? 'Update in Design…' : 'Use in Design…'}
        </button>
        <p className="hint">Adds {t.family || 'your font'} to the font list as its own family. Text set in the base font isn’t touched unless you choose to switch it.</p>
      </Section>
      <Section title="Install and export" id="type-export">
        <div className="export-grid">
          {desktop && (
            <button className="btn" onClick={() => void installOnMac()}>
              <Icon name="check" size={14} /> Install on this {platform().isMac ? 'Mac' : 'computer'}
            </button>
          )}
          <button className="btn" onClick={() => void exportFontFile('ttf')}>
            .ttf
          </button>
          <button className="btn" onClick={() => void exportFontFile('woff')}>
            .woff (web)
          </button>
          <button className="btn" onClick={() => void exportWebKit()}>
            <Icon name="export" size={14} /> Web font kit (.zip)
          </button>
        </div>
        <p className="hint">The web kit has TTF and WOFF files, a ready-made @font-face CSS file and a specimen page, so you can host the font anywhere. Fonts made from OFL fonts must keep a new name and the OFL licence.</p>
      </Section>
    </div>
  );
}

function TypeTour() {
  return (
    <Tour
      event="mt-type-tour"
      steps={[
        { target: '.glyphs', title: 'Your glyphs', text: 'Every character in the font. Click one to open it, use the arrow keys to move around, and add any character at the bottom.' },
        { target: '.glyph-canvas', title: 'The glyph editor', text: 'The lines show baseline, x-height and cap height. Click a label to learn what it means. Edit points to reshape the letter.' },
        { target: '.type-tabs', title: 'Font, glyph, export', text: 'Font sets the look for every glyph at once. Glyph tunes the open one. Use & export puts your font to work.' },
        { target: '.tester', title: 'The real thing', text: 'This preview uses your compiled font. Type anything to test spacing and shapes in real words.' },
      ]}
      onDone={() => setSettings({ typeTour: true })}
    />
  );
}
