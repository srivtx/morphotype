import { describe, expect, it } from 'vitest';
import { canonicalStyle, isStandardStyle, lookWeight, parseStyle, STANDARD_STYLES, styleName } from './fontStyles';
import { fontFaceCss, specOf } from './typeActions';
import type { ModEntry } from '../engine/types';
import type { TypeProject } from '../state/model';

const font = (style: string, modifiers: ModEntry[] = []): TypeProject => ({ family: 'S', style, base: 'inter', axes: {}, morph: null, modifiers, tracking: 0, charset: 'A', glyphs: {}, kerning: {}, sample: '' });
const weightMod = (amount: number, on = true) => ({ kind: 'weight', amount, on, uid: 'm' }) as ModEntry;

describe('font styles', () => {
  it('lists nine weights, upright and italic', () => {
    expect(STANDARD_STYLES).toHaveLength(18);
    expect(STANDARD_STYLES.slice(0, 9)).toEqual(['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']);
    expect(STANDARD_STYLES).toContain('Italic');
    expect(STANDARD_STYLES).toContain('Bold Italic');
    expect(STANDARD_STYLES).not.toContain('Regular Italic');
  });

  it('round-trips every standard style', () => {
    for (const name of STANDARD_STYLES) expect(styleName(parseStyle(name)!)).toBe(name);
  });

  it('maps names to weight and italic', () => {
    expect(parseStyle('Regular')).toEqual({ weight: 400, italic: false });
    expect(parseStyle('Italic')).toEqual({ weight: 400, italic: true });
    expect(parseStyle('ExtraLight')).toEqual({ weight: 200, italic: false });
    expect(parseStyle('Extra Bold Italic')).toEqual({ weight: 800, italic: true });
    expect(parseStyle('semi-bold')).toEqual({ weight: 600, italic: false });
    expect(parseStyle('Demibold')).toEqual({ weight: 600, italic: false });
    expect(parseStyle('Heavy Oblique')).toEqual({ weight: 900, italic: true });
    expect(parseStyle('Hairline')).toEqual({ weight: 100, italic: false });
    expect(parseStyle('Condensed Bold')).toEqual({ weight: 700, italic: false });
    expect(parseStyle('Display')).toBeNull();
    expect(parseStyle('')).toBeNull();
  });

  it('spells a base font style the standard way, keeping custom ones', () => {
    expect(canonicalStyle('Semi Bold')).toBe('SemiBold');
    expect(canonicalStyle('Regular Italic')).toBe('Italic');
    expect(canonicalStyle('bold italic')).toBe('Bold Italic');
    expect(canonicalStyle('Condensed Bold')).toBe('Condensed Bold');
    expect(canonicalStyle('Display')).toBe('Display');
    expect(isStandardStyle('Display')).toBe(false);
  });

  it('reckons a look weight like the engine', () => {
    expect(lookWeight([])).toBe(400);
    expect(lookWeight([weightMod(0.075)])).toBe(700);
    expect(lookWeight([weightMod(0.075, false)])).toBe(400);
    expect(lookWeight([weightMod(-1)])).toBe(100);
    expect(lookWeight([weightMod(1)])).toBe(900);
    expect(lookWeight([weightMod(0.05)], 300)).toBe(500);
  });
});

describe('style in the export', () => {
  it('sends the weight class and italic flag of a named style', () => {
    expect(specOf(font('Light Italic'))).toMatchObject({ style: 'Light Italic', weightClass: 300, italic: true });
    expect(specOf(font('Bold'))).toMatchObject({ weightClass: 700, italic: false });
  });

  it('leaves a custom style to the look', () => {
    const spec = specOf(font('Display'));
    expect(spec.weightClass).toBeUndefined();
    expect(spec.italic).toBeUndefined();
  });

  it('writes @font-face weight and style', () => {
    expect(fontFaceCss(font('ExtraLight'), 'S')).toContain('font-weight: 200;');
    expect(fontFaceCss(font('ExtraBold Italic'), 'S')).toMatch(/font-weight: 800;[\s\S]*font-style: italic;/);
    expect(fontFaceCss(font('Display', [weightMod(0.075)]), 'S')).toContain('font-weight: 700;');
  });
});
