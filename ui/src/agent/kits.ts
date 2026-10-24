// Style kits: a background, a palette, a font pairing and a look for each
// role (headline, accent, body), built from the bundled fonts, material
// presets and background presets. A kit gives a design a coherent start in
// one word; anything a layer sets itself wins over its kit.
import { BUNDLED } from '../fonts/library';
import { PRESETS } from '../render/effects';
import { BG_PRESETS, SHAPE_RECIPES } from '../state/recipes';
import { EditError } from './find';

export type Role = 'headline' | 'accent' | 'body';
export const ROLES: Role[] = ['headline', 'accent', 'body'];

export interface Look {
  font?: string;
  /** A material preset by name, or a flat colour. */
  preset?: string;
  color?: string;
  recipe?: string;
  /** Default size as a share of the canvas's short side (headlines fit 80% of the width instead). */
  size?: number;
  tracking?: number;
}

export interface Kit {
  name: string;
  blurb: string;
  /** A background preset's name, a colour, or "#a,#b" for a gradient. */
  background: string;
  /** Named colours: a layer's `color` can be one of these names. */
  palette: Record<string, string>;
  headline: Look;
  accent: Look;
  body: Look;
}

export const KITS: Kit[] = [
  {
    name: 'chrome-night',
    blurb: 'liquid chrome on near-black, a violet glow and clean grotesk captions: club nights, launches',
    background: 'Midnight',
    palette: { ink: '#e8e8f0', accent: '#5a17d6', hot: '#ff2e9a', paper: '#0b0b0d' },
    headline: { font: 'unbounded', preset: 'Ice chrome' },
    accent: { preset: 'Plasma' },
    body: { font: 'space-grotesk', color: '#e8e8f0', size: 0.032, tracking: 0.04 },
  },
  {
    name: 'neon-club',
    blurb: 'neon tubes on black, pink and cyan: bars, gigs, late-night signs',
    background: 'Black',
    palette: { ink: '#f4ecff', accent: '#ff2bd6', cool: '#28f0ff', paper: '#000000' },
    headline: { font: 'bungee', preset: 'Neon pink' },
    accent: { preset: 'Neon cyan' },
    body: { font: 'space-grotesk', color: '#f4ecff', size: 0.03, tracking: 0.06 },
  },
  {
    name: 'riso-zine',
    blurb: 'two-ink risograph on warm paper with a tall condensed headline: zines, gig flyers, print',
    background: 'Paper',
    palette: { ink: '#1b1b1f', accent: '#ff5aa0', cool: '#2b6bff', warm: '#ff7a1a', paper: '#f2ede4' },
    headline: { font: 'anton', preset: 'Riso pink + blue' },
    accent: { preset: 'Riso orange + green' },
    body: { font: 'space-grotesk', color: '#1b1b1f', size: 0.03 },
  },
  {
    name: 'brutal-pop',
    blurb: 'flat colour, thick outlines and hard shadows on a green grid: bold, loud, web-brutalist',
    background: 'Green grid',
    palette: { ink: '#f2ebe2', accent: '#9b4ff0', line: '#0a0a0a', paper: '#0d7a2c' },
    headline: { font: 'archivo', preset: 'Neo-brutal' },
    accent: { preset: 'Cream label' },
    body: { font: 'space-grotesk', color: '#f2ebe2', size: 0.032 },
  },
  {
    name: 'puff-sky',
    blurb: 'puffy inflated letters on a deep sky-blue gradient, pink accents: playful, friendly, kids and apps',
    background: 'Blue backdrop',
    palette: { ink: '#ffffff', accent: '#ff6fb8', sky: '#7ccfff', paper: '#2b8bff' },
    headline: { font: 'rubik-mono', preset: 'Puffy cloud' },
    accent: { preset: 'Bubblegum' },
    body: { font: 'bricolage', color: '#ffffff', size: 0.034 },
  },
  {
    name: 'editorial',
    blurb: 'black serif on paper with a red stamp: magazine covers, book jackets, quiet and classic',
    background: 'Paper',
    palette: { ink: '#141414', accent: '#e3120b', paper: '#f2ede4' },
    headline: { font: 'playfair', color: '#141414' },
    accent: { preset: 'Rubber stamp' },
    body: { font: 'eb-garamond', color: '#141414', size: 0.034 },
  },
  {
    name: 'holo-y2k',
    blurb: 'holographic foil and an acid aura on black: Y2K, fashion drops, tech',
    background: '#0b0b0f',
    palette: { ink: '#e9e4ff', accent: '#d6ff1f', violet: '#5a1fff', paper: '#0b0b0f' },
    headline: { font: 'dela-gothic', preset: 'Holo foil' },
    accent: { preset: 'Acid aura' },
    body: { font: 'space-grotesk', color: '#e9e4ff', size: 0.03, tracking: 0.05 },
  },
  {
    name: 'arcade',
    blurb: 'pixel type in chunky 3D on electric violet: games, retro tech, 8-bit',
    background: 'Electric violet',
    palette: { ink: '#e2ff2e', accent: '#1f63f0', shadow: '#23203f', paper: '#7b4dff' },
    headline: { font: 'silkscreen', preset: 'Pixel pop' },
    accent: { preset: 'Voxel blue' },
    body: { font: 'silkscreen', color: '#e2ff2e', size: 0.03 },
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

export function kitByName(name: string): Kit {
  const k = KITS.find((x) => norm(x.name) === norm(name));
  if (!k) throw new EditError(`No kit "${name}". Kits: ${KITS.map((x) => x.name).join(', ')}`);
  return k;
}

/** A kit colour by name ("accent"), or the colour itself. */
export function kitColor(kit: Kit | null, c: string): string {
  if (kit && c in kit.palette) return kit.palette[c];
  if (!/^#[0-9a-f]{6}$/i.test(c)) throw new EditError(`"${c}" isn't a colour (#rrggbb)${kit ? ` or one of ${kit.name}'s: ${Object.keys(kit.palette).join(', ')}` : ''}`);
  return c;
}

/** A kit in three lines. */
export function kitText(k: Kit): string {
  const look = (r: Role) => {
    const l = k[r];
    return [l.font, l.preset ?? l.color, l.recipe].filter(Boolean).join(' · ');
  };
  return `${k.name}: ${k.blurb}\n  background ${k.background} · palette ${Object.entries(k.palette).map(([n, c]) => `${n} ${c}`).join(', ')}\n  headline ${look('headline')} · accent ${look('accent')} · body ${look('body')}`;
}

export function kitsText(): string {
  return KITS.map(kitText).join('\n') + '\nuse: "kit": "name" in a make spec, or morpho new f.morpho --kit name; a layer\'s "color" can be a palette name, its "role" headline | accent | body';
}

/** Every kit names things that exist (a test runs this). */
export function kitProblems(): string[] {
  const out: string[] = [];
  const fonts = new Set(BUNDLED.map((f) => f.id));
  for (const k of KITS) {
    if (!/^#/.test(k.background) && !BG_PRESETS.some((b) => b.name === k.background)) out.push(`${k.name}: no background ${k.background}`);
    for (const r of ROLES) {
      const l = k[r];
      if (l.font && !fonts.has(l.font)) out.push(`${k.name}.${r}: no font ${l.font}`);
      if (l.preset && !PRESETS.some((p) => p.name === l.preset)) out.push(`${k.name}.${r}: no preset ${l.preset}`);
      if (l.recipe && !SHAPE_RECIPES.some((p) => p.name === l.recipe)) out.push(`${k.name}.${r}: no recipe ${l.recipe}`);
      if (l.color && !/^#[0-9a-f]{6}$/i.test(l.color)) out.push(`${k.name}.${r}: bad colour ${l.color}`);
    }
  }
  return out;
}
