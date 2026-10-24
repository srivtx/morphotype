import { describe, expect, it } from 'vitest';
import { geoDrivers, hasGeoAnim, modAnimKey, nodeAt, symAnimKey } from './geoMotion';
import { anyKeys, autokey, cleanKeys, keyEdits, keyProps, lastKeyTime, parseKeys, setKey, transformKeysOf, updateKeys } from './keys';
import { migrate } from './migrate';
import { emptyProject, group, newModifier, symbolLayer, textLayer, type Project, type ShapeLayer } from './model';
import { applyMat, keyedValue, keyPose, newMotion, placement, type Key } from './motion';
import { buildScene } from './tree';

const project = (...layers: Project['layers']): Project => ({ ...emptyProject(), layers });
const lin = { type: 'easing' as const, duration: 1, ease: [0, 0, 1, 1] as [number, number, number, number], bounce: 0, stiffness: 200, damping: 20, mass: 1 };

describe('key evaluation', () => {
  it('rotates 0° at 0 s → 45° at 1 s → 30° at 2.5 s', () => {
    const keys: Key[] = [
      { t: 0, v: 0 },
      { t: 1, v: 45 },
      { t: 2.5, v: 30 },
    ];
    expect(keyedValue(keys, 0)).toBe(0);
    expect(keyedValue(keys, 1)).toBe(45);
    expect(keyedValue(keys, 2.5)).toBe(30);
    // Ease in and out by default: halfway in time is halfway in value.
    expect(keyedValue(keys, 0.5)).toBeCloseTo(22.5, 6);
    expect(keyedValue(keys, 1.75)).toBeCloseTo(37.5, 6);
    // Slow near each key.
    expect(keyedValue(keys, 0.1) as number).toBeLessThan(4.5);
  });

  it('holds the first value before the first key and the last after the last', () => {
    const keys: Key[] = [
      { t: 1, v: 10 },
      { t: 2, v: 20 },
    ];
    expect(keyedValue(keys, 0)).toBe(10);
    expect(keyedValue(keys, 5)).toBe(20);
    expect(keyedValue([{ t: 3, v: 7 }], 0)).toBe(7);
  });

  it('uses the curve into each key', () => {
    const keys: Key[] = [
      { t: 0, v: 0 },
      { t: 2, v: 100, ease: lin },
    ];
    expect(keyedValue(keys, 0.5)).toBeCloseTo(25, 6);
    // A time spring is stretched over the gap and overshoots on the way.
    const spring: Key[] = [
      { t: 0, v: 0 },
      { t: 1, v: 100, ease: { ...lin, type: 'time', bounce: 0.5 } },
    ];
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => Number(keyedValue(spring, i / 50))));
    expect(peak).toBeGreaterThan(100);
  });

  it('blends colours in RGB, as cycles do', () => {
    const keys: Key[] = [
      { t: 0, v: '#000000' },
      { t: 1, v: '#ff0000', ease: lin },
      { t: 2, v: '#ffffff', ease: lin },
    ];
    expect(keyedValue(keys, 0.5)).toBe('#800000');
    expect(keyedValue(keys, 1.5)).toBe('#ff8080');
  });
});

describe('transform keys', () => {
  it('pose away from rest: the layer as if it had the keyed values', () => {
    const l = symbolLayer('star', 200, { x: 100, rotation: 10, keys: { rotation: [{ t: 0, v: 10 }, { t: 1, v: 100, ease: lin }], x: [{ t: 0, v: 100 }, { t: 1, v: 300, ease: lin }] } });
    const k = transformKeysOf(l)!;
    expect(k.origin).toEqual([100, 0]);
    expect(keyPose(k, 0)).toEqual({ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 });
    const p = keyPose(k, 0.5);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.rotate).toBeCloseTo(45, 6);
  });

  it('composes with the motion pose: it floats and follows its keys', () => {
    const l = symbolLayer('star', 200, { motion: newMotion({ loop: 'float', amount: 20, period: 2 }), keys: { x: [{ t: 0, v: 0 }, { t: 2, v: 400, ease: lin }] } });
    const { objects } = buildScene(project(l));
    const links = objects[0].motion!;
    // Its own motion first, then its keys around it.
    expect(links.map((x) => !!x.keys)).toEqual([false, true]);
    const placed = links.map((x) => ({ motion: x.motion, pivot: x.keys?.origin ?? ([0, 0] as [number, number]), offset: x.offset, keys: x.keys }));
    const [X, Y] = applyMat(placement(placed, 0.5).m, 0, 0);
    expect(X).toBeCloseTo(100, 6);
    expect(Y).toBeCloseTo(-20, 6);
  });

  it('turns about the layer origin, like its own rotation', () => {
    const l = symbolLayer('star', 200, { x: 50, y: 50, keys: { rotation: [{ t: 0, v: 90 }] } });
    const k = transformKeysOf(l)!;
    const m = placement([{ motion: newMotion(), pivot: k.origin!, offset: 0, keys: k }], 0).m;
    const [X, Y] = applyMat(m, 150, 50);
    expect(X).toBeCloseTo(50, 6);
    expect(Y).toBeCloseTo(150, 6);
  });

  it('a group keys offsets from rest and fades its children', () => {
    const g = group([symbolLayer('star')], { keys: { y: [{ t: 0, v: 0 }, { t: 1, v: -80, ease: lin }], opacity: [{ t: 0, v: 0 }, { t: 1, v: 1, ease: lin }] } });
    const k = transformKeysOf(g)!;
    const p = keyPose(k, 0.25);
    expect(p.y).toBeCloseTo(-20, 6);
    expect(p.opacity).toBeCloseTo(0.25, 6);
    // Handed down to the child's object like a group's motion.
    expect(buildScene(project(g)).objects[0].motion?.[0].keys?.tracks).toEqual(k.tracks);
  });

  it("a layer's opacity keys go to its object, not its pose", () => {
    const l = symbolLayer('star', 200, { keys: { opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } });
    expect(transformKeysOf(l)).toBeNull();
    expect(buildScene(project(l)).objects[0].opacityKeys).toHaveLength(2);
  });
});

describe('setting keys', () => {
  it('drive modifier and shape settings, and win over a cycle', () => {
    const wave = newModifier('wave', { amplitude: 0.1, wavelength: 2, phase: 0 } as never);
    const k = modAnimKey(wave.uid, 'amplitude');
    const l = symbolLayer('star', 200, {
      modifiers: [wave],
      animate: { [k]: { to: 0.5, period: 2, phase: 0, mode: 'swing' } },
      keys: { [k]: [{ t: 0, v: 0 }, { t: 1, v: 0.2, ease: lin }], [symAnimKey('points')]: [{ t: 0, v: 3 }, { t: 1, v: 9, ease: lin }] },
    });
    expect(hasGeoAnim(l)).toBe(true);
    expect(geoDrivers(l)?.[k]).toBe(l.keys![k]);
    const at = nodeAt(l, 0.5);
    expect((at.modifiers[0] as unknown as Record<string, number>).amplitude).toBeCloseTo(0.1, 6);
    // Whole-number fields step.
    expect(at.content.type === 'symbol' && at.content.symbol).toMatchObject({ points: 6 });
  });

  it('a layer with only keys moves geometry too', () => {
    const l = symbolLayer('star', 200, { keys: { [symAnimKey('inner')]: [{ t: 0, v: 0.2 }, { t: 2, v: 0.8 }] } });
    expect(hasGeoAnim(l)).toBe(true);
    expect(anyKeys([group([l])])).toBe(true);
    expect(lastKeyTime([group([l])])).toBe(2);
  });

  it('a key replaces a cycle on the same setting', () => {
    const l = symbolLayer('star', 200, { style: { effect: 'flat', params: { fill: '#000000' }, animate: { fill: { to: '#ffffff', period: 2, phase: 0, mode: 'swing' } } } });
    updateKeys(l, 'style', 'fill', (k) => setKey(k, 0.5, '#ff0000'));
    expect(l.style.animate).toBeUndefined();
    expect(l.style.keys?.fill).toEqual([{ t: 0.5, v: '#ff0000' }]);
    updateKeys(l, 'style', 'fill', () => null);
    expect(l.style.keys).toBeUndefined();
  });
});

describe('editing keyed properties', () => {
  const keyed = () => project(symbolLayer('star', 200, { keys: { x: [{ t: 0, v: 0 }, { t: 2, v: 200, ease: lin }] } }));
  const star = (p: Project) => p.layers[0] as ShapeLayer;

  it('a drag moves the key at the playhead by as much as it moved the layer', () => {
    const before = keyed();
    const after = structuredClone(before);
    star(after).x += 30;
    keyEdits(before, after, 1, false, false);
    // At 1 s the keys put it at 100; dragged 30 further.
    expect(star(after).keys!.x).toEqual([
      { t: 0, v: 0 },
      { t: 1, v: 130 },
      { t: 2, v: 200, ease: lin },
    ]);
  });

  it('updates a key already at the playhead', () => {
    const before = keyed();
    const after = structuredClone(before);
    star(after).x = -50;
    keyEdits(before, after, 2, false);
    expect(star(after).keys!.x.map((k) => k.v)).toEqual([0, 150]);
    // Not mid-drag: its own x follows, so its outline is where it's drawn.
    expect(star(after).x).toBe(150);
  });

  it('leaves unkeyed properties alone unless autokey is on', () => {
    const before = keyed();
    const after = structuredClone(before);
    star(after).rotation = 30;
    keyEdits(before, after, 1, false);
    expect(star(after).keys!.rotation).toBeUndefined();
    keyEdits(before, after, 1, true);
    expect(star(after).keys!.rotation).toEqual([
      { t: 0, v: 0 },
      { t: 1, v: 30 },
    ]);
  });

  it('autokey keys materials (absolute) and snaps to frames', () => {
    const before = project(symbolLayer('star'));
    const after = structuredClone(before);
    star(after).style.params.fill = '#ff0000';
    keyEdits(before, after, 0.51, true);
    const k = star(after).style.keys!.fill;
    expect(k[1]).toEqual({ t: 0.5, v: '#ff0000' });
    expect(String(k[0].v).toLowerCase()).toBe(String(star(before).style.params.fill).toLowerCase());
  });

  it("doesn't autokey a setting that cycles", () => {
    const before = project(symbolLayer('star', 200, { style: { effect: 'flat', params: { fill: '#000000' }, animate: { fill: { to: '#ffffff', period: 2, phase: 0, mode: 'swing' } } } }));
    const after = structuredClone(before);
    star(after).style.params.fill = '#ff0000';
    keyEdits(before, after, 1, true);
    expect(star(after).style.keys).toBeUndefined();
  });

  it('lists transform, material, modifier and shape settings', () => {
    const l = symbolLayer('star', 200, { modifiers: [newModifier('wave')] });
    const keys = keyProps(l).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['x', 'y', 'rotation', 'scale', 'opacity', 'fill', `mod:${l.modifiers[0].uid}:amplitude`, 'sym:points']));
    expect(keyProps(group([l])).map((p) => p.key)).toEqual([]);
  });

  it('autokey is off until switched on', () => {
    expect(autokey.on).toBe(false);
  });
});

describe('reading keys', () => {
  it('parses the short form agents write', () => {
    const k = parseKeys([
      [2.5, 30],
      [0, 0],
      [1, 45, 'linear'],
    ]);
    expect(k.map((x) => x.t)).toEqual([0, 1, 2.5]);
    expect(k[1].ease?.ease).toEqual([0, 0, 1, 1]);
    expect(parseKeys([{ t: 0, v: '#ffffff', ease: 'bouncy' }])[0].ease?.type).toBe('time');
    expect(() => parseKeys([[0, 0, 'wobbly']])).toThrow(/no curve/);
    expect(() => parseKeys({ t: 0 })).toThrow(/list/);
  });

  it('old files load unchanged; keys are sorted and cleaned', () => {
    const old = { version: 2, name: 'Old', canvas: { width: 800, height: 800 }, layers: [textLayer('Hi')], fonts: [] };
    const p = migrate(structuredClone(old));
    expect(p.layers[0].keys).toBeUndefined();
    expect(p.layers[0].style.keys).toBeUndefined();
    const withKeys = structuredClone(old);
    Object.assign(withKeys.layers[0], { keys: { rotation: [{ t: 2, v: 30 }, { t: 0, v: 0 }, { t: 'x', v: 1 }], x: [] } });
    Object.assign(withKeys.layers[0].style, { keys: { fill: [{ t: 0, v: '#ffffff', ease: 'nope' }] } });
    const q = migrate(withKeys);
    expect(q.layers[0].keys).toEqual({ rotation: [{ t: 0, v: 0 }, { t: 2, v: 30 }] });
    expect(q.layers[0].style.keys).toEqual({ fill: [{ t: 0, v: '#ffffff' }] });
    expect(cleanKeys({})).toBeUndefined();
  });
});
