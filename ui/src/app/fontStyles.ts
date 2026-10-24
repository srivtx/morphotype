// Font style names (the subfamily, "Bold Italic") and the weight class and
// italic flag they stand for in an exported font.
import type { ModEntry } from '../engine/types';

export const WEIGHTS: { weight: number; name: string }[] = [
  { weight: 100, name: 'Thin' },
  { weight: 200, name: 'ExtraLight' },
  { weight: 300, name: 'Light' },
  { weight: 400, name: 'Regular' },
  { weight: 500, name: 'Medium' },
  { weight: 600, name: 'SemiBold' },
  { weight: 700, name: 'Bold' },
  { weight: 800, name: 'ExtraBold' },
  { weight: 900, name: 'Black' },
];

export interface FontStyle {
  weight: number;
  italic: boolean;
}

/** The standard name of a weight and slope: "Regular", "Italic", "Light Italic". */
export function styleName({ weight, italic }: FontStyle): string {
  const w = WEIGHTS.find((x) => x.weight === weight)?.name ?? 'Regular';
  if (!italic) return w;
  return w === 'Regular' ? 'Italic' : `${w} Italic`;
}

/** Every standard style, uprights first. */
export const STANDARD_STYLES: string[] = [false, true].flatMap((italic) => WEIGHTS.map((w) => styleName({ weight: w.weight, italic })));

export const isStandardStyle = (name: string) => STANDARD_STYLES.includes(name);

// Longer words first, so "ExtraBold" isn't read as Bold.
const WEIGHT_WORDS: [RegExp, number][] = [
  [/(extra|ultra)light/, 200],
  [/(extra|ultra)bold/, 800],
  [/(semi|demi)bold/, 600],
  [/thin|hairline/, 100],
  [/light/, 300],
  [/medium/, 500],
  [/bold/, 700],
  [/black|heavy/, 900],
  [/regular|normal|book|roman/, 400],
];

/**
 * The weight and slope a style name stands for, also for spellings like
 * "Semi Bold" or "Heavy Oblique". Null when it names neither (a custom
 * style such as "Display").
 */
export function parseStyle(name: string): FontStyle | null {
  const s = name.toLowerCase().replace(/[\s_-]+/g, '');
  const italic = /italic|oblique/.test(s);
  const weight = WEIGHT_WORDS.find(([re]) => re.test(s))?.[1];
  if (weight === undefined && !italic) return null;
  return { weight: weight ?? 400, italic };
}

/** The standard spelling of a style name ("semi bold italic" → "SemiBold Italic"), or the name as it is. */
export function canonicalStyle(name: string): string {
  const p = parseStyle(name);
  const compact = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '').replace(/^regular(?=italic)/, '');
  return p && compact(styleName(p)) === compact(name) ? styleName(p) : name.trim();
}

/**
 * The weight a font look adds up to, as the engine reckons it when the
 * style doesn't say: `from` (400) plus 4000 per em of Weight, to the
 * nearest 100.
 */
export function lookWeight(mods: ModEntry[], from = 400): number {
  const w = mods.reduce((acc, m) => (m.on && m.kind === 'weight' ? acc + m.amount * 4000 : acc), from);
  return Math.min(9, Math.max(1, Math.round(w / 100))) * 100;
}
