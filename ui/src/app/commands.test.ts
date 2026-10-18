import { describe, expect, it } from 'vitest';
import { evalMath } from '../components/ui';
import { allCommands, keyLabel, matchKey } from './commands';

describe('commands', () => {
  it('never binds the same key twice', () => {
    const seen = new Map<string, string>();
    for (const c of allCommands())
      for (const k of c.keys ?? []) {
        expect(seen.get(k), `${k}: ${c.id} vs ${seen.get(k)}`).toBeUndefined();
        seen.set(k, c.id);
      }
  });

  it('matches physical keys with modifiers', () => {
    const ev = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) => ({ key, code, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...mods }) as KeyboardEvent;
    expect(matchKey(ev('g', 'KeyG', { metaKey: true, shiftKey: true }))).toBe('shift+mod+g');
    expect(matchKey(ev('å', 'KeyA', { altKey: true }))).toBe('alt+a');
    expect(matchKey(ev('?', 'Slash', { shiftKey: true }))).toBe('?');
    expect(matchKey(ev(']', 'BracketRight', { metaKey: true }))).toBe('mod+]');
    expect(keyLabel('shift+mod+g')).toMatch(/G$/);
  });

  it('evaluates simple maths in number fields', () => {
    expect(evalMath('120*2')).toBe(240);
    expect(evalMath('(10 + 5) / 3')).toBe(5);
    expect(evalMath('-4 + 1')).toBe(-3);
    expect(Number.isNaN(evalMath('alert(1)'))).toBe(true);
  });
});
