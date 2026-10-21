import { describe, expect, it } from 'vitest';
import { kernPair, reservedNames, specOf, versionOf } from './typeActions';
import type { TypeProject } from '../state/model';

describe('font naming', () => {
  it('reads Reserved Font Names from a copyright notice', () => {
    const playfair = 'Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display), with Reserved Font Name "Playfair Display".';
    expect(reservedNames(playfair)).toEqual(['Playfair Display']);
    expect(reservedNames("Copyright 2010 Foo, with Reserved Font Names 'Foo' and 'Foo Sans'.")).toEqual(['Foo', 'Foo Sans']);
    expect(reservedNames('Copyright 2015 Google Inc. All Rights Reserved.')).toEqual([]);
    expect(reservedNames(undefined)).toEqual([]);
  });

  it('numbers versions by revision', () => {
    expect(versionOf()).toBe('1.000');
    expect(versionOf(4)).toBe('1.004');
    expect(versionOf(1234)).toBe('2.234');
  });
});

describe('kerning', () => {
  it('reads a pair from typed text', () => {
    expect(kernPair('AV')).toBe('AV');
    expect(kernPair(' T o ')).toBe('To');
    expect(kernPair('Type')).toBe('Ty');
    expect(kernPair('A')).toBeNull();
    expect(kernPair('')).toBeNull();
    expect(kernPair('★é')).toBe('★é');
    expect(kernPair('𝒜V')).toBe('𝒜V');
  });

  it('passes overrides to the engine', () => {
    const t: TypeProject = { family: 'K', style: 'Regular', base: 'inter', axes: {}, morph: null, modifiers: [], tracking: 0, charset: 'AV', glyphs: {}, kerning: { AV: -0.1 }, sample: '' };
    expect(specOf(t).kerning).toEqual({ AV: -0.1 });
  });

  it('expands class kerning for the engine, exceptions on top', () => {
    const t: TypeProject = {
      family: 'K',
      style: 'Regular',
      base: 'inter',
      axes: {},
      morph: null,
      modifiers: [],
      tracking: 0,
      charset: 'TVoe',
      glyphs: {},
      kerning: { Ve: 0 },
      kernClasses: [
        { id: 'a', side: 'right', members: 'TV' },
        { id: 'b', side: 'left', members: 'oe' },
      ],
      classKerning: { '@a @b': -0.08 },
      sample: '',
    };
    expect(specOf(t).kerning).toEqual({ To: -0.08, Te: -0.08, Vo: -0.08, Ve: 0 });
  });
});
