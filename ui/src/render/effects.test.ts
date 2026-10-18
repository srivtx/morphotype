import { describe, expect, it } from 'vitest';
import { EFFECTS, PRESETS, defaultParams, effectById } from './effects';

describe('effects', () => {
  it('uses every parameter, in the shader or in the height pass', () => {
    for (const e of EFFECTS) {
      // Record which keys the height pass reads.
      const read = new Set<string>();
      const params = defaultParams(e);
      e.height?.(new Proxy(params, { get: (t, k: string) => (read.add(k), t[k]) }));
      for (const p of e.params) {
        if (read.has(p.key)) continue;
        expect(e.glsl, `${e.id}.${p.key}`).toMatch(new RegExp(`\\bu_${p.key}\\b`));
      }
    }
  });

  it('keeps defaults inside slider ranges', () => {
    for (const e of EFFECTS) {
      for (const p of e.params) {
        if (p.type === 'number') {
          expect(p.default, `${e.id}.${p.key}`).toBeGreaterThanOrEqual(p.min);
          expect(p.default, `${e.id}.${p.key}`).toBeLessThanOrEqual(p.max);
        } else {
          expect(p.default).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('presets only set parameters their effect has', () => {
    for (const preset of PRESETS) {
      const e = effectById(preset.effect);
      expect(e.id).toBe(preset.effect);
      const keys = new Set(Object.keys(defaultParams(e)));
      for (const k of Object.keys(preset.params)) expect(keys.has(k), `${preset.name}: ${k}`).toBe(true);
    }
  });
});
