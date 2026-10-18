import { describe, expect, it } from 'vitest';
import { MODIFIER_DEFAULTS, MODIFIER_UI, SYMBOL_DEFAULTS, SYMBOL_UI, TEMPLATES, newModifier } from './model';

describe('model', () => {
  it('has UI for every modifier and symbol default', () => {
    for (const [kind, m] of Object.entries(MODIFIER_DEFAULTS)) {
      expect(m.kind).toBe(kind);
      for (const f of MODIFIER_UI[m.kind].fields) expect(m, `${kind}.${f.key}`).toHaveProperty(f.key);
    }
    for (const [kind, s] of Object.entries(SYMBOL_DEFAULTS)) {
      expect(s.kind).toBe(kind);
      for (const f of SYMBOL_UI[s.kind].fields) expect(s, `${kind}.${f.key}`).toHaveProperty(f.key);
    }
  });

  it('gives modifiers unique ids', () => {
    expect(newModifier('weight').uid).not.toBe(newModifier('weight').uid);
  });

  it('builds every template with resolvable cut layers', () => {
    for (const t of TEMPLATES) {
      const p = t.make();
      expect(p.layers.length, t.name).toBeGreaterThan(0);
      expect(p.layers[0].op, `${t.name}: bottom layer must add`).toBe('add');
      expect(new Set(p.layers.map((l) => l.id)).size).toBe(p.layers.length);
    }
  });
});
