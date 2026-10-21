import { describe, expect, it } from 'vitest';
import { addClass, classOf, deleteClass, editEntry, entriesFor, exceptionsOf, joinClass, kernOf, leaveClass, resolveKerning, setClassMembers, setEntry, suggestClasses } from './kerning';
import type { TypeProject } from '../state/model';

type Kerned = Pick<TypeProject, 'kerning' | 'kernClasses' | 'classKerning'>;

/** Round trip Ts and Ws against round letters, like a real font's classes. */
function font(): Kerned {
  const t: Kerned = { kerning: {} };
  addClass(t, 'right', 'TVW', 'tv');
  addClass(t, 'left', 'oce', 'oc');
  return t;
}

describe('kerning classes', () => {
  it('finds a character’s class on each side', () => {
    const t = font();
    expect(classOf(t, 'V', 'right')?.id).toBe('tv');
    expect(classOf(t, 'V', 'left')).toBeUndefined();
    expect(classOf(t, 'e', 'left')?.id).toBe('oc');
  });

  it('edits a class pair once for every member pair', () => {
    const t = font();
    const e = editEntry(t, 'T', 'o');
    expect(e).toEqual({ scope: 'class', key: '@tv @oc' });
    setEntry(t, e, -0.08);
    expect(kernOf(t, 'W', 'e', -0.02)).toEqual({ value: -0.08, entry: e });
    // A pair outside the classes keeps the font's own.
    expect(kernOf(t, 'A', 'V', -0.07)).toEqual({ value: -0.07, entry: null });
    const flat = resolveKerning(t);
    expect(Object.keys(flat).sort()).toEqual(['Tc', 'Te', 'To', 'Vc', 'Ve', 'Vo', 'Wc', 'We', 'Wo']);
    expect(new Set(Object.values(flat))).toEqual(new Set([-0.08]));
  });

  it('lets one pair be an exception', () => {
    const t = font();
    setEntry(t, '@tv @oc', -0.08);
    const only = editEntry(t, 'V', 'o', true);
    expect(only).toEqual({ scope: 'pair', key: 'Vo' });
    setEntry(t, only, 0);
    // Once set, editing that pair keeps changing the exception.
    expect(editEntry(t, 'V', 'o')).toEqual(only);
    expect(kernOf(t, 'V', 'o', -0.05).value).toBe(0);
    expect(resolveKerning(t)).toMatchObject({ Vo: 0, Ve: -0.08, To: -0.08 });
    expect(exceptionsOf(t)).toEqual(['Vo']);
    setEntry(t, only, null);
    expect(kernOf(t, 'V', 'o', -0.05).value).toBe(-0.08);
  });

  it('ranks a character against a class above class against class', () => {
    const t = font();
    setEntry(t, '@tv @oc', -0.08);
    setEntry(t, '@tv e', -0.06);
    setEntry(t, 'W @oc', -0.04);
    expect(entriesFor(t, 'W', 'e').map((e) => e.scope)).toEqual(['pair', 'glyph-class', 'class-glyph', 'class']);
    expect(kernOf(t, 'W', 'e', 0).value).toBe(-0.04);
    expect(kernOf(t, 'T', 'e', 0).value).toBe(-0.06);
    expect(kernOf(t, 'T', 'c', 0).value).toBe(-0.08);
    // The export agrees with what the editor shows, pair by pair.
    const flat = resolveKerning(t);
    for (const l of 'TVW') for (const r of 'oce') expect(flat[l + r]).toBe(kernOf(t, l, r, 0).value);
  });

  it('kerns a class against a character outside any class', () => {
    const t = font();
    expect(editEntry(t, 'T', 'a')).toEqual({ scope: 'class-glyph', key: '@tv a' });
    expect(editEntry(t, 'A', 'o')).toEqual({ scope: 'glyph-class', key: 'A @oc' });
    expect(editEntry(t, 'A', 'V')).toEqual({ scope: 'pair', key: 'AV' });
    setEntry(t, '@tv a', -0.05);
    expect(resolveKerning(t)).toEqual({ Ta: -0.05, Va: -0.05, Wa: -0.05 });
  });

  it('keeps a character in one class per side', () => {
    const t = font();
    addClass(t, 'right', 'VY', 'vy');
    expect(classOf(t, 'V', 'right')?.id).toBe('vy');
    expect(t.kernClasses?.find((c) => c.id === 'tv')?.members).toBe('TW');
    // The left side is untouched.
    joinClass(t, 'V', 'oc');
    expect(classOf(t, 'V', 'left')?.id).toBe('oc');
    expect(classOf(t, 'V', 'right')?.id).toBe('vy');
  });

  it('drops a class and its kerning once it is empty or deleted', () => {
    const t = font();
    setEntry(t, '@tv @oc', -0.08);
    setEntry(t, '@tv a', -0.05);
    setEntry(t, 'To', -0.1);
    leaveClass(t, 'o', 'left');
    expect(resolveKerning(t).Vo).toBeUndefined();
    setClassMembers(t, 'oc', '');
    expect(t.kernClasses?.map((c) => c.id)).toEqual(['tv']);
    expect(t.classKerning).toEqual({ '@tv a': -0.05 });
    deleteClass(t, 'tv');
    expect(t.classKerning).toEqual({});
    // Pairs set by hand stay.
    expect(resolveKerning(t)).toEqual({ To: -0.1 });
  });

  it('ignores spaces, repeats and stale classes', () => {
    const t: Kerned = { kerning: {} };
    expect(addClass(t, 'left', ' o o​c ', 'x')).toBe('x');
    expect(t.kernClasses?.[0].members).toBe('oc');
    expect(addClass(t, 'left', '   ', 'y')).toBeNull();
    t.classKerning = { '@gone o': -0.1, '@ @x': -0.02 };
    // "@" alone is the at sign, not a class.
    expect(resolveKerning(t)).toEqual({ '@o': -0.02, '@c': -0.02 });
  });

  it('suggests classes from glyphs that kern alike', () => {
    const t: Kerned = { kerning: {} };
    const pairs: [string, number][] = [];
    for (const l of 'TVWY') for (const r of 'oceadqgsu') pairs.push([l + r, l === 'Y' && r === 'q' ? -0.03 : -0.08]);
    for (const r of 'oce') pairs.push(['A' + r, -0.01], ['L' + r, -0.02]);
    pairs.push(['Ao', -0.01]);
    const right = suggestClasses(t, pairs, 'right');
    expect(right).toEqual([['T', 'V', 'W', 'Y']]);
    const left = suggestClasses(t, pairs, 'left');
    // q is kerned apart against Y, too much for a column of four.
    expect(left).toEqual([['c', 'e', 'o'], ['a', 'd', 'g', 's', 'u']]);
    // Characters already in a class aren't suggested again.
    addClass(t, 'right', 'TV', 'tv');
    expect(suggestClasses(t, pairs, 'right')).toEqual([['W', 'Y']]);
  });
});
