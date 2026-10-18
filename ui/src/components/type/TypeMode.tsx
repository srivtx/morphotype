import { useEffect, useRef, useState } from 'react';
import { importImage } from '../../app/actions';
import { addCharacters, CHARSETS, customizeGlyph, editType, ensureTypeProject, exportFontFile, exportWebKit, installOnMac, removeCharacter, resetGlyph, specOf, useInDesign } from '../../app/typeActions';
import { engine } from '../../engine/client';
import type { GlyphPreview, ModEntry } from '../../engine/types';
import { platform } from '../../platform';
import { uid, type TypeProject } from '../../state/model';
import { SHAPE_RECIPES } from '../../state/recipes';
import { store, toast, undo, useStore } from '../../state/store';
import { PathPointEditor } from '../canvas/PointEditor';
import { FontPicker } from '../FontPicker';
import { Icon } from '../icons';
import { Modifiers } from '../Inspector';
import { IconButton, Section, Segmented, Slider } from '../ui';

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

/** Styled outlines of the font's characters, refreshed after edits settle. */
function usePreviews(t: TypeProject | undefined) {
  const [map, setMap] = useState<Map<string, GlyphPreview>>(new Map());
  const [busy, setBusy] = useState(false);
  const glyph = useStore((s) => s.glyph);
  const key = t ? geoKey(t) + t.charset : '';
  useEffect(() => {
    if (!t) return;
    let live = true;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const spec = specOf(t, { quality: 80 });
        // The open glyph first so the editor responds quickly.
        const first = await engine.fontPreview({ ...spec, quality: 140 }, glyph);
        if (!live) return;
        setMap((m) => new Map([...m, ...first.map((g) => [g.ch, g] as const)]));
        const rest = await engine.fontPreview(spec, t.charset);
        if (!live) return;
        const next = new Map(rest.map((g) => [g.ch, g] as const));
        next.set(glyph, first[0] ?? next.get(glyph)!);
        setMap(next);
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
  useEffect(() => {
    if (ready && !type) ensureTypeProject();
  }, [ready, type]);
  const { map, busy } = usePreviews(type);
  if (!type) return <div className="workspace type-mode" />;
  return (
    <main className="workspace type-mode">
      <aside className="panel left">
        <GlyphGrid t={type} previews={map} />
      </aside>
      <section className="type-center">
        <GlyphCanvas t={type} previews={map} busy={busy} />
        <Tester t={type} />
      </section>
      <aside className="panel right">
        <div className="panel-scroll">
          <FontPanel t={type} previews={map} />
        </div>
      </aside>
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
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 600, h: 500 });
  const [base, setBase] = useState<{ d: string; advance: number; exists: boolean } | null>(null);
  const edit = t.glyphs[glyph];
  const p = previews.get(glyph);
  const m = metricsOf(t);
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
  const line = (y: number, label: string, cls = '') => (
    <g className={`metric ${cls}`}>
      <line x1={0} x2={size.w} y1={oy + y * k} y2={oy + y * k} />
      <text x={8} y={oy + y * k - 5}>
        {label}
      </text>
    </g>
  );
  const all = [...t.charset];
  const idx = all.indexOf(glyph);
  return (
    <div className="glyph-stage">
      <div className="glyph-toolbar">
        <IconButton icon="chevronRight" className="flip" title="Previous glyph" onClick={() => store.set({ glyph: all[(idx - 1 + all.length) % all.length] })} />
        <span className="glyph-title">
          <strong>{glyph}</strong>
          <span className="dim">U+{glyph.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}</span>
          {!base?.exists && !edit?.d && <span className="badge mask">Not in base font</span>}
          {edit?.d && <span className="badge merge">Edited</span>}
        </span>
        <IconButton icon="chevronRight" title="Next glyph" onClick={() => store.set({ glyph: all[(idx + 1) % all.length] })} />
        <span className="spacer" />
        {busy && <span className="dim small">Updating…</span>}
        {!edit?.d ? (
          <button className="btn small" onClick={() => void customizeGlyph(glyph)}>
            <Icon name="points" size={13} /> {base?.exists ? 'Edit points' : 'Draw this glyph'}
          </button>
        ) : (
          <button
            className="btn small"
            onClick={() => {
              resetGlyph(glyph);
              toast(`Reset “${glyph}”`, 'info', { label: 'Undo', run: undo });
            }}
          >
            <Icon name="reset" size={13} /> Reset
          </button>
        )}
        <button className="btn small" onClick={() => void importImage(undefined, 'glyph')}>
          <Icon name="image" size={13} /> Trace image
        </button>
      </div>
      <div className="glyph-canvas" ref={ref}>
        <svg ref={svgRef} width={size.w} height={size.h}>
          {line(m.desc * -1, 'Descender', 'soft')}
          {line(0, 'Baseline', 'base')}
          {line(-m.x, 'x-height', 'soft')}
          {line(-m.cap, 'Cap height')}
          {line(-m.asc, 'Ascender', 'soft')}
          <line className="metric side" x1={ox} x2={ox} y1={0} y2={size.h} />
          <line className="metric side" x1={ox + adv * k} x2={ox + adv * k} y1={0} y2={size.h} />
          <g transform={`matrix(${k},0,0,${k},${ox},${oy})`}>
            {edit?.d && base?.exists && <path className="glyph-base" d={base.d} />}
            {p?.d && <path className="glyph-fill" d={p.d} />}
          </g>
          {edit?.d && (
            <PathPointEditor
              key={glyph}
              d={edit.d}
              scale={1}
              pxPerUnit={k}
              toScreen={S}
              toLocal={(e) => {
                const r = svgRef.current!.getBoundingClientRect();
                return { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k };
              }}
              onChange={(d, key) => editType((tp) => (tp.glyphs[glyph] = { ...(tp.glyphs[glyph] ?? {}), d }), key ? `${glyph}:${key}` : '')}
              onExit={() => undefined}
              viewKey={`${k},${ox},${oy}`}
            />
          )}
        </svg>
        {!edit?.d && p && !p.d && (
          <div className="glyph-empty">
            <p>
              “{glyph}” isn't in {store.get().fonts.find((f) => f.id === t.base)?.name ?? 'the base font'}.
            </p>
            <button className="btn primary" onClick={() => void customizeGlyph(glyph)}>
              Draw it
            </button>
          </div>
        )}
      </div>
      {edit?.d && <p className="glyph-hint">Drag points · double-click a line to add one · double-click a point for smooth/sharp · ⌫ deletes · ⌘A selects all</p>}
    </div>
  );
}

/** Live preview with the real compiled font. */
function Tester({ t }: { t: TypeProject }) {
  const [family, setFamily] = useState<string | null>(null);
  const [size, setSize] = useState(64);
  const counter = useRef(0);
  const key = geoKey(t) + t.charset;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const bytes = await engine.exportFont(specOf(t, { quality: 90 }));
        if (!live) return;
        const name = `mt-tester-${++counter.current}`;
        const face = new FontFace(name, bytes.slice().buffer as ArrayBuffer);
        await face.load();
        document.fonts.add(face);
        if (live) setFamily(name);
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

function FontPanel({ t, previews }: { t: TypeProject; previews: Map<string, GlyphPreview> }) {
  const glyph = useStore((s) => s.glyph);
  const g = t.glyphs[glyph];
  const desktop = !!platform().installFont;
  const looks = SHAPE_RECIPES.filter((r) => !r.mods.some((m) => m.kind === 'arc'));
  return (
    <div className="inspector">
      <div className="sel-header">
        <span className="sel-kind">Font</span>
        <input className="sel-name" value={t.family} aria-label="Family name" onChange={(e) => editType((tp) => (tp.family = e.target.value), 'family')} />
      </div>
      <Section title="Family" id="type-family">
        <label className="field">
          <span>Style</span>
          <input className="text-field" value={t.style} onChange={(e) => editType((tp) => (tp.style = e.target.value), 'style')} />
        </label>
        <div className="field">
          <span>Base font</span>
          <FontPicker value={t.base} onChange={(id) => id && editType((tp) => ((tp.base = id), (tp.axes = {})))} />
        </div>
        <div className="field">
          <span>Morph to</span>
          <FontPicker allowNone value={t.morph?.font ?? null} onChange={(id) => editType((tp) => (tp.morph = id ? { font: id, t: tp.morph?.t ?? 0.5, axes: {} } : null))} />
        </div>
        {t.morph && <Slider label="Blend" value={t.morph.t} min={0} max={1} step={0.005} onChange={(v) => editType((tp) => tp.morph && (tp.morph.t = v), 'morph')} />}
        <Slider label="Spacing" value={t.tracking} min={-0.2} max={0.5} step={0.005} reset={0} onChange={(v) => editType((tp) => (tp.tracking = v), 'tracking')} />
      </Section>
      <Section title="Look for every glyph" id="type-looks">
        <div className="looks">
          {looks.slice(0, 12).map((r) => (
            <button
              key={r.name}
              className="look text"
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
          <button className="look text" onClick={() => editType((tp) => (tp.modifiers = []))}>
            <span>Plain</span>
          </button>
        </div>
      </Section>
      <Modifiers mods={t.modifiers} owner="type" onChange={(fn, key) => editType((tp) => fn(tp.modifiers), key)} />
      <Section title={`Glyph “${glyph}”`} id="type-glyph">
        <Slider
          label="Width"
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
        <div className="button-row">
          <button className="btn small" onClick={() => removeCharacter(glyph)}>
            <Icon name="trash" size={13} /> Remove from font
          </button>
        </div>
      </Section>
      <Section title="Export" id="type-export">
        <div className="export-grid">
          <button className="btn primary" onClick={() => void useInDesign()}>
            <Icon name="design" size={14} /> Use in Design
          </button>
          {desktop && (
            <button className="btn" onClick={() => void installOnMac()}>
              <Icon name="check" size={14} /> Install on this Mac
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

