import { defaultParams, EFFECTS, effectById, PRESETS } from '../render/effects';
import { edit, useStore } from '../state/store';
import { ColorField, Section, Slider } from './controls';

export function StylePanel() {
  const effect = useStore((s) => s.project.effect);
  const def = effectById(effect.id);
  const applyPreset = (i: number) => {
    const p = PRESETS[i];
    edit((d) => {
      d.effect = { id: p.effect, params: { ...defaultParams(effectById(p.effect)), ...p.params } };
    });
  };
  return (
    <div className="style-panel">
      <Section title="Presets">
        <div className="presets">
          {PRESETS.map((p, i) => (
            <button key={p.name} className="preset" onClick={() => applyPreset(i)} title={p.name}>
              <span className="swatch" style={{ background: `linear-gradient(135deg, ${p.swatch.join(', ')})` }} />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Effect">
        <label className="field">
          <span>Type</span>
          <select
            value={effect.id}
            onChange={(e) =>
              edit((d) => {
                const next = effectById(e.target.value);
                // Keep colours/values that share a key (e.g. background).
                const params = defaultParams(next);
                for (const k of Object.keys(params)) if (k in d.effect.params && k === 'background') params[k] = d.effect.params[k];
                d.effect = { id: next.id, params };
              })
            }
          >
            {EFFECTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{def.description}</p>
        {def.params.map((p) =>
          p.type === 'color' ? (
            <ColorField
              key={p.key}
              label={p.label}
              value={String(effect.params[p.key] ?? p.default)}
              onChange={(v) => edit((d) => (d.effect.params[p.key] = v), `fx-${p.key}`)}
            />
          ) : (
            <Slider
              key={p.key}
              label={p.label}
              min={p.min}
              max={p.max}
              step={p.step}
              reset={p.default}
              value={Number(effect.params[p.key] ?? p.default)}
              onChange={(v) => edit((d) => (d.effect.params[p.key] = v), `fx-${p.key}`)}
            />
          ),
        )}
      </Section>
    </div>
  );
}
