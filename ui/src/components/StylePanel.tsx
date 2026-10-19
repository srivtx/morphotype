import { useMemo, useState } from 'react';
import { applyPreset, applyStyle, pickPhoto, copyStyle, pasteStyle, selectedNodes, styleOf } from '../app/actions';
import { allImages } from '../state/assets';
import { shortcutOf } from '../app/commands';
import { engine } from '../engine/client';
import { defaultParams, EFFECTS, effectById, PRESETS, type EffectDef, type ParamValues, type Preset } from '../render/effects';
import { renderThumb, useThumb } from '../render/thumbs';
import type { SceneItem } from '../render/renderer';
import { background, fill, isGroup, pattern, textLayer, type Style } from '../state/model';
import { edit, setSettings, useStore } from '../state/store';
import { findNode } from '../state/tree';
import { ColorField } from './ColorPicker';
import { Icon } from './icons';
import { IconButton, Section, Select, Slider, Toggle } from './ui';

// One shared sample outline for every preview card.
let sample: Promise<{ d: string; bbox: [number, number, number, number] | null }> | null = null;
function sampleShape() {
  sample ??= (async () => {
    const l = textLayer('Aa', 'archivo', {}, { size: 300 });
    const out = await engine.buildExact({ layers: [{ ...l }], renders: [{ id: 's', members: [l.id] }] });
    return { d: out.renders[0]?.d ?? '', bbox: out.renders[0]?.bbox ?? null };
  })();
  return sample;
}

async function styleScene(effect: EffectDef, params: ParamValues, bg: string) {
  const s = await sampleShape();
  const items: SceneItem[] = [{ id: 's', d: s.d, bbox: s.bbox, effect, params }];
  // Glass shows what's behind it, so give it stripes to bend and blur.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) || 0);
  const ink = r * 0.3 + g * 0.59 + b * 0.11 > 128 ? '#151515' : '#f2f2f2';
  const page = effect.backdrop ? background(fill('solid', bg), { pattern: pattern('diagonal', ink, { size: 70, weight: 24, opacity: 1 }) }) : background(fill('solid', bg));
  return { items, background: page, w: 460, h: 460, px: 132 };
}

export function presetThumb(p: Preset) {
  const e = effectById(p.effect);
  return renderThumb(`preset:${p.name}`, () => styleScene(e, { ...defaultParams(e), ...p.params }, p.bg));
}

function PresetCard({ p, active, onApply }: { p: Preset; active: boolean; onApply: (alt: boolean) => void }) {
  const e = effectById(p.effect);
  const url = useThumb(`preset:${p.name}`, () => styleScene(e, { ...defaultParams(e), ...p.params }, p.bg), 1);
  return (
    <button className={`preset-card ${active ? 'on' : ''}`} onClick={(ev) => onApply(ev.altKey)} data-tip={`${p.name} · ${e.name} · ⌥-click to also set the background`}>
      <span className="preset-img" style={{ background: p.bg }}>
        {url ? <img src={url} alt="" draggable={false} /> : <span className="shimmer" />}
      </span>
      <span className="preset-name">{p.name}</span>
    </button>
  );
}

/** Small preview of a material (its default look), cached. */
export function EffectThumb({ id }: { id: string }) {
  const e = effectById(id);
  const preset = PRESETS.find((p) => p.effect === e.id);
  const url = useThumb(`effect:${e.id}`, () => styleScene(e, defaultParams(e), preset?.bg ?? '#111114'), 1);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="shimmer" />;
}

function EffectCard({ e, active, onPick }: { e: EffectDef; active: boolean; onPick: () => void }) {
  const preset = PRESETS.find((p) => p.effect === e.id);
  const url = useThumb(`effect:${e.id}`, () => styleScene(e, defaultParams(e), preset?.bg ?? '#111114'), 1);
  return (
    <button className={`effect-card ${active ? 'on' : ''}`} onClick={onPick} data-tip={e.description}>
      <span className="effect-img">{url ? <img src={url} alt="" draggable={false} /> : <span className="shimmer" />}</span>
      <span>{e.name}</span>
    </button>
  );
}

export function StylePanel() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const advanced = useStore((s) => s.settings.advanced);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const nodes = selection.map((id) => findNode(project.layers, id)).filter((n) => !!n);
  const primary = nodes.at(-1);
  const st = primary ? styleOf(primary) : undefined;
  const presets = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? PRESETS.filter((p) => `${p.name} ${p.effect} ${p.tags ?? ''} ${effectById(p.effect).name}`.toLowerCase().includes(t)) : PRESETS;
  }, [q]);

  if (!primary || !st) {
    return (
      <div className="style-panel">
        <div className="empty-note">
          <Icon name="sparkle" size={22} />
          <p>Select a layer to give it a style.</p>
          <p className="dim">Every layer has its own material: chrome, glass, puffy, sticker, aura and more. The canvas background is set in the Design tab when nothing is selected.</p>
        </div>
      </div>
    );
  }
  const clipOnly = nodes.every((n) => n.op !== 'add');
  const def = effectById(st.effect);
  const setParam = (k: string, v: number | string) =>
    edit((p) => {
      for (const n of selectedNodes()) {
        const target = findNode(p.layers, n.id);
        if (!target) continue;
        const targets = isGroup(target) && !target.merge ? collect(target) : [target];
        for (const t of targets) if (t.style.effect === st.effect) t.style.params[k] = v;
      }
    }, `fx:${selection.join()}:${k}`);
  const matches = (p: Preset) => p.effect === st.effect && Object.entries(p.params).every(([k, v]) => st.params[k] === v);
  const visible = showAll || q ? presets : presets.slice(0, 12);
  return (
    <div className="style-panel">
      {clipOnly && <div className="layer-error soft">Cut and Mask layers don't draw on their own. They shape the layer below, which keeps its style.</div>}
      <Section
        title="Presets"
        id="presets"
        actions={
          <>
            <IconButton icon="copy" title="Copy style" kbd={shortcutOf('copy-style')} onClick={copyStyle} size={14} className="tiny" />
            <IconButton icon="droplet" title="Paste style" kbd={shortcutOf('paste-style')} onClick={pasteStyle} size={14} className="tiny" />
          </>
        }
      >
        <div className="search-box small">
          <Icon name="search" size={13} />
          <input placeholder="Search looks: chrome, glass, sticker…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="preset-grid">
          {visible.map((p) => (
            <PresetCard key={p.name} p={p} active={matches(p)} onApply={(alt) => applyPreset(p, alt)} />
          ))}
        </div>
        {!q && presets.length > 12 && (
          <button className="link-btn" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${presets.length} presets`}
          </button>
        )}
      </Section>
      <Section title="Material" id="effect">
        <div className="effect-grid">
          {EFFECTS.map((e) => (
            <EffectCard
              key={e.id}
              e={e}
              active={e.id === st.effect}
              onPick={() => {
                if (e.id === st.effect) return;
                const next: Style = { effect: e.id, params: defaultParams(e) };
                if (e.photo) {
                  // Reuse the latest picture, or ask for one.
                  void (async () => {
                    const id = allImages().at(-1)?.id ?? (await pickPhoto());
                    if (!id) return;
                    applyStyle({ ...next, params: { ...next.params, image: id } });
                  })();
                  return;
                }
                applyStyle(next);
              }}
            />
          ))}
        </div>
        <p className="hint">{def.description}</p>
      </Section>
      <Section
        title={def.name}
        id="params"
        actions={
          <button className="link-btn" onClick={() => setSettings({ advanced: !advanced })} data-tip="Simple or advanced controls" data-kbd={shortcutOf('advanced')}>
            {advanced ? 'Simple' : 'Advanced'}
          </button>
        }
      >
        {def.photo && <PhotoPicker value={String(st.params.image ?? '')} onPick={(id) => setParam('image', id)} />}
        {def.params
          .filter((p) => advanced || !p.advanced)
          .map((p) =>
            p.type === 'color' ? (
              <ColorField key={p.key} label={p.label} value={String(st.params[p.key] ?? p.default)} onChange={(v) => setParam(p.key, v)} />
            ) : p.options ? (
              <div className="field" key={p.key}>
                <span>{p.label}</span>
                <Select value={Math.round(Number(st.params[p.key] ?? p.default))} options={p.options.map((label, value) => ({ value, label }))} onChange={(v) => setParam(p.key, v)} />
              </div>
            ) : p.min === 0 && p.max === 1 && p.step === 1 ? (
              <Toggle key={p.key} label={p.label} checked={Number(st.params[p.key] ?? p.default) > 0.5} onChange={(v) => setParam(p.key, v ? 1 : 0)} />
            ) : (
              <Slider key={p.key} label={p.label} min={p.min} max={p.max} step={p.step} reset={p.default} value={Number(st.params[p.key] ?? p.default)} onChange={(v) => setParam(p.key, v)} />
            ),
          )}
        <button className="link-btn" onClick={() => applyStyle({ effect: st.effect, params: defaultParams(def) })}>
          Reset to defaults
        </button>
      </Section>
    </div>
  );
}

function collect(g: import('../state/model').Group): { style: Style }[] {
  return g.children.flatMap((c) => (isGroup(c) && !c.merge ? collect(c) : [c]));
}

/** Warm the preset thumbnails in idle time so the Style tab opens instantly. */
export function prewarmThumbs() {
  const idle = (cb: () => void) => ((window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200)))(cb);
  idle(() => PRESETS.slice(0, 12).forEach((p) => void presetThumb(p)));
}

/** Pictures in this session, plus a button to add one. */
function PhotoPicker({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const images = allImages();
  return (
    <div className="photo-picker">
      {images.map((a) => (
        <button key={a.id} className={`photo-thumb ${a.id === value ? 'on' : ''}`} onClick={() => onPick(a.id)} data-tip={a.name ?? 'Picture'} aria-label={a.name ?? 'Picture'}>
          <img src={a.data} alt="" draggable={false} />
        </button>
      ))}
      <button className="photo-thumb add" onClick={() => void pickPhoto().then((id) => id && onPick(id))} data-tip="Add a picture" aria-label="Add a picture">
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
