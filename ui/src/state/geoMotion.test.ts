import { describe, expect, it } from 'vitest';
import { anyGeoAnim, contentAt, hasGeoAnim, modAnimKey, modifiersAt, MORPH_KEY, movingDocAt, movingIds, nodeAt, projectAt, pruneGeoAnims, symAnimKey } from './geoMotion';
import { emptyProject, group, lineLayer, morphLayer, newModifier, symbolLayer, textLayer, type Project, type ShapeLayer } from './model';

const wave = () => newModifier('wave', { amplitude: 0.1, wavelength: 2, phase: 0 } as never);

function waveLine(): ShapeLayer {
  const m = wave();
  return lineLayer('M0 0 L1 0', 400, 8, { modifiers: [m], animate: { [modAnimKey(m.uid, 'phase')]: { to: 6.283, period: 2, phase: 0, mode: 'ramp' } } });
}

const project = (...layers: Project['layers']): Project => ({ ...emptyProject(), layers });
const field = (l: ShapeLayer, k: string) => (l.modifiers[0] as unknown as Record<string, number>)[k];

describe('animated geometry settings', () => {
  it('ramps a wave phase round with the clock', () => {
    const l = waveLine();
    expect(field(nodeAt(l, 0), 'phase')).toBeCloseTo(0, 6);
    expect(field(nodeAt(l, 0.5), 'phase')).toBeCloseTo(6.283 / 4, 6);
    expect(field(nodeAt(l, 1.5), 'phase')).toBeCloseTo((6.283 * 3) / 4, 6);
    // Round again after a cycle.
    expect(field(nodeAt(l, 2.5), 'phase')).toBeCloseTo(6.283 / 4, 6);
    // Untouched settings keep their value.
    expect(field(nodeAt(l, 0.7), 'amplitude')).toBe(0.1);
  });

  it('never changes the saved layer', () => {
    const l = waveLine();
    const before = structuredClone(l);
    const moved = nodeAt(l, 0.9);
    expect(moved).not.toBe(l);
    expect(moved.modifiers).not.toBe(l.modifiers);
    expect(l).toEqual(before);
  });

  it('swings there and back, fitted to a looping timeline', () => {
    const m = wave();
    const anims = { [modAnimKey(m.uid, 'amplitude')]: { to: 0.3, period: 2.2, phase: 0, mode: 'swing' as const } };
    const amp = (t: number, loop?: number) => (modifiersAt([m], anims, t, loop)[0] as unknown as { amplitude: number }).amplitude;
    expect(amp(0)).toBeCloseTo(0.1, 6);
    expect(amp(1.1)).toBeCloseTo(0.3, 6);
    // A 6 s loop holds 3 whole 2 s cycles, so the end meets the start.
    expect(amp(6, 6)).toBeCloseTo(amp(0, 6), 6);
    expect(amp(1, 6)).toBeCloseTo(0.3, 6);
  });

  it('steps whole-number fields', () => {
    const m = newModifier('repeat', { count: 3 } as never);
    const anims = { [modAnimKey(m.uid, 'count')]: { to: 12, period: 1, phase: 0, mode: 'ramp' as const } };
    for (let t = 0; t < 1; t += 0.07) expect(Number.isInteger((modifiersAt([m], anims, t)[0] as unknown as { count: number }).count)).toBe(true);
    const star = symbolLayer('star', 400, {}, { points: 5 } as never);
    const c = contentAt(star.content, { [symAnimKey('points')]: { to: 9, period: 1, phase: 0, mode: 'ramp' }, [symAnimKey('inner')]: { to: 0.8, period: 1, phase: 0, mode: 'ramp' } }, 0.5);
    expect(c.type === 'symbol' && (c.symbol as unknown as { points: number }).points).toBe(7);
    expect(c.type === 'symbol' && (c.symbol as unknown as { inner: number }).inner).toBeCloseTo(0.45 + (0.8 - 0.45) / 2, 6);
  });

  it('moves a font morph and a morph layer between their two shapes', () => {
    const swing = { [MORPH_KEY]: { to: 1, period: 2, phase: 0, mode: 'swing' as const } };
    const text = textLayer('Morph', 'archivo', { animate: swing }, { morph: { font: 'pacifico', t: 0, axes: {} } });
    const blend = (t: number) => {
      const c = nodeAt(text, t).content;
      return c.type === 'text' ? c.morph!.t : NaN;
    };
    expect(blend(0)).toBeCloseTo(0, 6);
    expect(blend(1)).toBeCloseTo(1, 6);
    expect(blend(0.5)).toBeGreaterThan(0);
    expect(blend(0.5)).toBeLessThan(1);
    expect(text.content.type === 'text' && text.content.morph!.t).toBe(0);
    const m = morphLayer('a', 'b');
    m.animate = { [MORPH_KEY]: { to: 0, period: 2, phase: 0, mode: 'swing' } };
    const c = nodeAt(m, 1).content;
    expect(c.type === 'morph' && c.t).toBeCloseTo(0, 6);
    // Text with no morph has no blend to move.
    expect(hasGeoAnim(textLayer('Plain', 'archivo', { animate: swing }))).toBe(false);
  });

  it('ignores keyframes that no longer apply', () => {
    const l = waveLine();
    l.animate!['mod:gone:phase'] = { to: 1, period: 1, phase: 0, mode: 'swing' };
    l.animate![modAnimKey(l.modifiers[0].uid, 'nosuch')] = { to: 1, period: 1, phase: 0, mode: 'swing' };
    l.animate![symAnimKey('points')] = { to: 1, period: 1, phase: 0, mode: 'swing' };
    expect(() => nodeAt(l, 0.3)).not.toThrow();
    // Only keyframes that still apply make a layer move.
    const stale = waveLine();
    stale.modifiers = [];
    expect(movingIds(project(stale)).size).toBe(0);
    expect(nodeAt(l, 0.3).content).toBe(l.content);
    l.modifiers = [];
    pruneGeoAnims(l);
    expect(Object.keys(l.animate ?? {})).toEqual([symAnimKey('points')]);
  });

  it('copies only the nodes that move', () => {
    const still = symbolLayer('circle');
    const moving = waveLine();
    const g = group([still, moving]);
    const p = project(symbolLayer('ring'), g);
    const at = projectAt(p, 0.4);
    expect(at.layers[0]).toBe(p.layers[0]);
    expect(at.layers[1]).not.toBe(g);
    expect((at.layers[1] as typeof g).children[0]).toBe(still);
    // Nothing animated: the very same project.
    const plain = project(symbolLayer('ring'));
    expect(projectAt(plain, 1)).toBe(plain);
    expect(anyGeoAnim(plain.layers)).toBe(false);
    expect(anyGeoAnim(p.layers)).toBe(true);
  });
});

describe('moving engine documents', () => {
  it('has nothing to build for a still design', () => {
    expect(movingDocAt(project(symbolLayer('ring'), lineLayer('M0 0 L1 0', 400)), 1)).toBeNull();
  });

  it('builds only the moving renders, with the layers they need', () => {
    const still = symbolLayer('circle');
    const line = waveLine();
    const hole = symbolLayer('star', 100, { op: 'subtract' });
    const p = project(still, line, hole);
    const doc = movingDocAt(p, 0.5)!;
    expect(doc.renders!.map((r) => r.id)).toEqual([line.id]);
    expect(doc.layers.map((l) => l.id).sort()).toEqual([line.id, hole.id].sort());
    const built = doc.layers.find((l) => l.id === line.id)!;
    expect((built.modifiers[0] as unknown as { phase: number }).phase).toBeCloseTo(6.283 / 4, 6);
    // UI-only fields stay out of the engine document.
    expect('animate' in built).toBe(false);
  });

  it('rebuilds merged groups and morphs made from moving layers', () => {
    const line = waveLine();
    const merged = group([symbolLayer('circle'), symbolLayer('ring')], { merge: true, modifiers: [wave()] });
    merged.animate = { [modAnimKey(merged.modifiers[0].uid, 'amplitude')]: { to: 0.4, period: 1, phase: 0, mode: 'swing' } };
    const m = morphLayer(line.id, merged.children[0].id);
    const p = project(line, merged, m);
    expect([...movingIds(p)].sort()).toEqual([line.id, merged.id, m.id].sort());
    const doc = movingDocAt(p, 0.25)!;
    expect(doc.renders!.map((r) => r.id).sort()).toEqual([line.id, merged.id, m.id].sort());
    expect(doc.layers.length).toBe(4);
  });
});
