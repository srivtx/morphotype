import { describe, expect, it } from 'vitest';
import { isChoice, newModifier, SYMBOL_DEFAULTS, SYMBOL_UI } from '../state/model';
import { clusterBoxes, variationsOf } from './assists';

// A fixed sequence, so the test sees the same variations every run.
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe('variationsOf', () => {
  it('keeps every value in its slider range and every choice valid', () => {
    for (const kind of ['blob', 'flower', 'star', 'smile'] as const) {
      const vs = variationsOf(SYMBOL_DEFAULTS[kind], [], 8, seeded(7));
      expect(vs).toHaveLength(8);
      for (const v of vs) {
        expect(v.symbol.kind).toBe(kind);
        const vals = v.symbol as unknown as Record<string, number | string>;
        for (const f of SYMBOL_UI[kind].fields) {
          if (isChoice(f)) expect(f.options.map((o) => o.value)).toContain(vals[f.key]);
          else if (f.key !== 'seed') {
            expect(vals[f.key]).toBeGreaterThanOrEqual(f.min);
            expect(vals[f.key]).toBeLessThanOrEqual(f.max);
          }
        }
      }
      // They differ from each other.
      expect(new Set(vs.map((v) => JSON.stringify(v.symbol))).size).toBeGreaterThan(4);
    }
  });

  it('rerolls modifier seeds and leaves other modifiers alone', () => {
    const mods = [newModifier('wobble'), newModifier('round')];
    const [v] = variationsOf(SYMBOL_DEFAULTS.blob, mods, 1, seeded(3));
    expect(v.modifiers[1]).toEqual(mods[1]);
    expect(v.modifiers[0]).toMatchObject({ kind: 'wobble', amount: (mods[0] as { amount: number }).amount });
    expect((v.modifiers[0] as { seed: number }).seed).not.toBe((mods[0] as { seed: number }).seed);
  });
});

describe('clusterBoxes', () => {
  it('keeps a face or a dot with the shape it sits on', () => {
    const flower: [number, number, number, number] = [0, 0, 100, 100];
    const face: [number, number, number, number] = [40, 40, 60, 60];
    const other: [number, number, number, number] = [200, 0, 300, 50];
    const dot: [number, number, number, number] = [240, 20, 260, 30];
    expect(clusterBoxes([face, flower, other, dot])).toEqual([[1, 0], [2, 3]]);
  });
});
