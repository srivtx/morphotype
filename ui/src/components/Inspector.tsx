import { updateLayer } from '../app/actions';
import type { Content, Layer, ModEntry, ModifierKind, SymbolKind } from '../engine/types';
import { MODIFIER_UI, newModifier, SYMBOL_DEFAULTS, SYMBOL_UI, layerLabel } from '../state/model';
import { useStore } from '../state/store';
import { FontPicker } from './FontPicker';
import { Menu, Section, Segmented, Slider } from './controls';

type Of<T extends Content['type']> = Extract<Content, { type: T }>;

export function Inspector() {
  const layer = useStore((s) => s.project.layers.find((l) => l.id === s.selection));
  const error = useStore((s) => s.build?.layers.find((l) => l.id === s.selection)?.error ?? null);
  if (!layer) return <div className="empty-note">Select a layer to edit it.</div>;
  const set = (fn: (l: Layer) => void, key = '') => updateLayer(layer.id, fn, key);
  return (
    <div className="inspector">
      {error && <div className="layer-error">{error}</div>}
      <Section title="Layer">
        <label className="field">
          <span>Name</span>
          <input value={layer.name ?? ''} placeholder={layerLabel(layer)} onChange={(e) => set((l) => (l.name = e.target.value || undefined), 'name')} />
        </label>
        <div className="field">
          <span>Blend</span>
          <Segmented
            value={layer.op}
            options={[
              { value: 'add', label: 'Add', title: 'Union with the layers below' },
              { value: 'subtract', label: 'Cut', title: 'Punch this shape out of the layers below' },
              { value: 'intersect', label: 'Mask', title: 'Keep only where this overlaps the layers below' },
            ]}
            onChange={(op) => set((l) => (l.op = op))}
          />
        </div>
        <Slider label="X" value={layer.x} min={-1000} max={1000} step={1} reset={0} onChange={(v) => set((l) => (l.x = v), 'x')} />
        <Slider label="Y" value={layer.y} min={-1000} max={1000} step={1} reset={0} onChange={(v) => set((l) => (l.y = v), 'y')} />
        <Slider label="Rotate" value={layer.rotation} min={-180} max={180} step={0.5} reset={0} suffix="°" onChange={(v) => set((l) => (l.rotation = v), 'rot')} />
        <Slider label="Scale" value={layer.scale} min={0.05} max={4} step={0.01} reset={1} onChange={(v) => set((l) => (l.scale = v), 'scale')} />
      </Section>
      <ContentEditor layer={layer} set={set} />
      <Modifiers layer={layer} set={set} />
    </div>
  );
}

function ContentEditor({ layer, set }: { layer: Layer; set: (fn: (l: Layer) => void, key?: string) => void }) {
  const c = layer.content;
  const setC = <T extends Content['type']>(fn: (c: Of<T>) => void, key = '') => set((l) => fn(l.content as Of<T>), key);
  switch (c.type) {
    case 'text':
      return <TextEditor c={c} setC={setC} />;
    case 'symbol':
      return (
        <Section title="Symbol">
          <label className="field">
            <span>Shape</span>
            <select
              value={c.symbol.kind}
              onChange={(e) => setC<'symbol'>((x) => (x.symbol = { ...SYMBOL_DEFAULTS[e.target.value as SymbolKind] }))}
            >
              {Object.entries(SYMBOL_UI).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <Slider label="Size" value={c.size} min={10} max={1200} step={1} onChange={(v) => setC<'symbol'>((x) => (x.size = v), 'size')} />
          {SYMBOL_UI[c.symbol.kind].fields.map((f) => (
            <Slider
              key={f.key}
              label={f.label}
              min={f.min}
              max={f.max}
              step={f.step}
              value={Number((c.symbol as unknown as Record<string, number>)[f.key] ?? 0)}
              reset={Number((SYMBOL_DEFAULTS[c.symbol.kind] as unknown as Record<string, number>)[f.key])}
              onChange={(v) => setC<'symbol'>((x) => ((x.symbol as unknown as Record<string, number>)[f.key] = f.integer ? Math.round(v) : v), f.key)}
            />
          ))}
        </Section>
      );
    case 'path':
      return (
        <Section title="Traced shape">
          <Slider label="Size" value={c.size} min={10} max={1600} step={1} onChange={(v) => setC<'path'>((x) => (x.size = v), 'size')} />
        </Section>
      );
    case 'morph':
      return <MorphLayerEditor c={c} self={layer.id} setC={setC} />;
  }
}

function TextEditor({ c, setC }: { c: Of<'text'>; setC: <T extends Content['type']>(fn: (c: Of<T>) => void, key?: string) => void }) {
  const fonts = useStore((s) => s.fonts);
  const info = fonts.find((f) => f.id === c.font)?.info;
  const morphInfo = c.morph ? fonts.find((f) => f.id === c.morph?.font)?.info : undefined;
  return (
    <>
      <Section title="Text">
        <textarea className="text-input" value={c.text} rows={Math.min(5, c.text.split('\n').length + 1)} onChange={(e) => setC<'text'>((x) => (x.text = e.target.value), 'text')} />
        <div className="field">
          <span>Font</span>
          <FontPicker value={c.font} onChange={(id) => id && setC<'text'>((x) => ((x.font = id), (x.axes = {})))} />
        </div>
        <Slider label="Size" value={c.size} min={8} max={800} step={1} onChange={(v) => setC<'text'>((x) => (x.size = v), 'size')} />
        <Slider label="Tracking" value={c.tracking} min={-0.3} max={1} step={0.005} reset={0} onChange={(v) => setC<'text'>((x) => (x.tracking = v), 'track')} />
        <Slider label="Leading" value={c.lineHeight} min={0.5} max={3} step={0.01} reset={1} onChange={(v) => setC<'text'>((x) => (x.lineHeight = v), 'lead')} />
        <div className="field">
          <span>Align</span>
          <Segmented
            value={c.align}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(a) => setC<'text'>((x) => (x.align = a))}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={c.ligatures} onChange={(e) => setC<'text'>((x) => (x.ligatures = e.target.checked))} /> Ligatures
        </label>
        {info?.axes.map((a) => (
          <Slider
            key={a.tag}
            label={a.name}
            min={a.min}
            max={a.max}
            step={(a.max - a.min) / 200}
            value={c.axes[a.tag] ?? a.default}
            reset={a.default}
            onChange={(v) => setC<'text'>((x) => (x.axes = { ...x.axes, [a.tag]: v }), `axis-${a.tag}`)}
          />
        ))}
      </Section>
      <Section title="Morph to font">
        <div className="field">
          <span>Target</span>
          <FontPicker
            allowNone
            value={c.morph?.font ?? null}
            onChange={(id) => setC<'text'>((x) => (x.morph = id ? { font: id, t: x.morph?.t ?? 0.5, axes: {} } : null))}
          />
        </div>
        {c.morph && (
          <>
            <Slider label="Blend" value={c.morph.t} min={0} max={1} step={0.005} onChange={(v) => setC<'text'>((x) => x.morph && (x.morph.t = v), 'morph-t')} />
            {morphInfo?.axes.map((a) => (
              <Slider
                key={a.tag}
                label={`Target ${a.name}`}
                min={a.min}
                max={a.max}
                step={(a.max - a.min) / 200}
                value={c.morph?.axes[a.tag] ?? a.default}
                reset={a.default}
                onChange={(v) => setC<'text'>((x) => x.morph && (x.morph.axes = { ...x.morph.axes, [a.tag]: v }), `maxis-${a.tag}`)}
              />
            ))}
          </>
        )}
      </Section>
    </>
  );
}

function MorphLayerEditor({ c, self, setC }: { c: Of<'morph'>; self: string; setC: <T extends Content['type']>(fn: (c: Of<T>) => void, key?: string) => void }) {
  const layers = useStore((s) => s.project.layers);
  const others = layers.filter((l) => l.id !== self && l.content.type !== 'morph');
  const pick = (which: 'a' | 'b', value: string) => (
    <select value={value} onChange={(e) => setC<'morph'>((x) => (x[which] = e.target.value))}>
      <option value="">Choose a layer…</option>
      {others.map((l) => (
        <option key={l.id} value={l.id}>
          {layerLabel(l)}
        </option>
      ))}
    </select>
  );
  return (
    <Section title="Morph between layers">
      <p className="hint">Blends the outlines of two layers. Hide the source layers to see only the morph.</p>
      <label className="field">
        <span>From</span>
        {pick('a', c.a)}
      </label>
      <label className="field">
        <span>To</span>
        {pick('b', c.b)}
      </label>
      <Slider label="Blend" value={c.t} min={0} max={1} step={0.005} onChange={(v) => setC<'morph'>((x) => (x.t = v), 't')} />
    </Section>
  );
}

function Modifiers({ layer, set }: { layer: Layer; set: (fn: (l: Layer) => void, key?: string) => void }) {
  const mods = layer.modifiers;
  const patch = (uid: string, fn: (m: ModEntry) => void, key = '') =>
    set((l) => {
      const m = l.modifiers.find((x) => x.uid === uid);
      if (m) fn(m);
    }, key ? `${uid}:${key}` : '');
  return (
    <Section
      title="Modifiers"
      actions={
        <Menu className="add-mod" label="+ Add">
          {(close) => (
            <div className="menu-list">
              {(Object.keys(MODIFIER_UI) as ModifierKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    set((l) => l.modifiers.push(newModifier(k)));
                    close();
                  }}
                >
                  {MODIFIER_UI[k].label}
                </button>
              ))}
            </div>
          )}
        </Menu>
      }
    >
      {mods.length === 0 && <p className="hint">Stack modifiers to reshape the outline: weight, rounding, melt, pixelate and more. They run top to bottom.</p>}
      {mods.map((m, i) => {
        const ui = MODIFIER_UI[m.kind];
        const values = m as unknown as Record<string, number>;
        return (
          <div key={m.uid} className={`mod ${m.on ? '' : 'off'}`}>
            <div className="mod-head">
              <label className="check">
                <input type="checkbox" checked={m.on} onChange={(e) => patch(m.uid, (x) => (x.on = e.target.checked))} />
                {ui.label}
              </label>
              <div className="mod-tools">
                <button className="icon-btn" disabled={i === 0} title="Move up" onClick={() => set((l) => l.modifiers.splice(i - 1, 0, ...l.modifiers.splice(i, 1)))}>
                  ↑
                </button>
                <button
                  className="icon-btn"
                  disabled={i === mods.length - 1}
                  title="Move down"
                  onClick={() => set((l) => l.modifiers.splice(i + 1, 0, ...l.modifiers.splice(i, 1)))}
                >
                  ↓
                </button>
                <button className="icon-btn" title="Remove" onClick={() => set((l) => l.modifiers.splice(i, 1))}>
                  ✕
                </button>
              </div>
            </div>
            {ui.fields.map((f) => (
              <Slider
                key={f.key}
                label={f.label}
                min={f.min}
                max={f.max}
                step={f.step}
                value={Number(values[f.key] ?? 0)}
                onChange={(v) => patch(m.uid, (x) => ((x as unknown as Record<string, number>)[f.key] = f.integer ? Math.round(v) : v), f.key)}
              />
            ))}
          </div>
        );
      })}
    </Section>
  );
}
