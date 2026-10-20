import { describe, expect, it } from 'vitest';
import { reservedNames, versionOf } from './typeActions';

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
