import type { KernClass, TypeProject } from '../state/model';

/**
 * Kerning by pair and by class. A pair is kerned by the most specific entry
 * set for it: the pair itself ("To", an exception when classes cover it),
 * then a character against a class ("T @id"), a class against a character
 * ("@id o"), and a class against a class ("@id @id"). With no entry, the
 * font's own kerning applies. The export expands every entry into pairs and
 * the engine packs them back into class (format 2) GPOS subtables.
 */

type Kerned = Pick<TypeProject, 'kerning' | 'kernClasses' | 'classKerning'>;

export type KernScope = 'pair' | 'glyph-class' | 'class-glyph' | 'class';

export interface KernEntry {
  scope: KernScope;
  /** "To" for a pair, else both sides with classes as "@id", e.g. "@a1 @b2". */
  key: string;
}

/** The two characters of a pair like "AV" (whole code points), or null. */
export function pairChars(p: string): [string, string] | null {
  const c = [...p];
  return c.length === 2 ? [c[0], c[1]] : null;
}

/** The class a character is in on one side ('right' for the first of a pair), if any. */
export function classOf(t: Kerned, ch: string, side: KernClass['side']): KernClass | undefined {
  return t.kernClasses?.find((c) => c.side === side && [...c.members].includes(ch));
}

/** A class as people read it: its members, spaced. */
export function classLabel(c: KernClass) {
  return [...c.members].join(' ');
}

/** Entries that can kern the pair l r, most specific first. */
export function entriesFor(t: Kerned, l: string, r: string): KernEntry[] {
  const L = classOf(t, l, 'right');
  const R = classOf(t, r, 'left');
  const out: KernEntry[] = [{ scope: 'pair', key: l + r }];
  if (R) out.push({ scope: 'glyph-class', key: `${l} @${R.id}` });
  if (L) out.push({ scope: 'class-glyph', key: `@${L.id} ${r}` });
  if (L && R) out.push({ scope: 'class', key: `@${L.id} @${R.id}` });
  return out;
}

const isPairKey = (key: string) => !key.includes(' ');

/** An entry's value in em, if it is set. */
export function entryValue(t: Kerned, e: KernEntry | string): number | undefined {
  const key = typeof e === 'string' ? e : e.key;
  return isPairKey(key) ? t.kerning[key] : t.classKerning?.[key];
}

/** A pair's kerning in em and the entry that sets it (null: the font's own, `measured`). */
export function kernOf(t: Kerned, l: string, r: string, measured: number): { value: number; entry: KernEntry | null } {
  for (const e of entriesFor(t, l, r)) {
    const v = entryValue(t, e);
    if (v !== undefined) return { value: v, entry: e };
  }
  return { value: measured, entry: null };
}

/**
 * The entry editing a pair changes: the one in effect, else the broadest
 * that covers it, so kerning "To" kerns T V W against o c e at once.
 * `only` edits just this pair, making an exception.
 */
export function editEntry(t: Kerned, l: string, r: string, only = false): KernEntry {
  const all = entriesFor(t, l, r);
  if (only) return all[0];
  return all.find((e) => entryValue(t, e) !== undefined) ?? all[all.length - 1];
}

/** Set one entry in em, or clear it with null. */
export function setEntry(t: Kerned, e: KernEntry | string, value: number | null) {
  const key = typeof e === 'string' ? e : e.key;
  const map = isPairKey(key) ? t.kerning : (t.classKerning ??= {});
  if (value === null) delete map[key];
  else map[key] = value;
}

/** The members a side of an entry key stands for: a character, or a class's members. */
function sideMembers(t: Kerned, token: string): string[] {
  if (token.startsWith('@') && [...token].length > 1) {
    const c = t.kernClasses?.find((k) => k.id === token.slice(1));
    return c ? [...c.members] : [];
  }
  return [token];
}

/**
 * Every entry expanded to pairs ("AV" → em), as the export writes them over
 * the font's own kerning; 0 removes a pair's kerning.
 */
export function resolveKerning(t: Kerned): Record<string, number> {
  const out: Record<string, number> = {};
  const rank: Record<string, number> = { '@@': 0, '@c': 1, 'c@': 2 };
  const entries = Object.entries(t.classKerning ?? {})
    .map(([key, v]) => ({ sides: key.split(' '), v }))
    .filter((e) => e.sides.length === 2)
    .map((e) => ({ ...e, rank: rank[e.sides.map((s) => (s.startsWith('@') && [...s].length > 1 ? '@' : 'c')).join('')] ?? 3 }))
    .sort((a, b) => a.rank - b.rank);
  // Broadest first, so the more specific entries overwrite them.
  for (const { sides, v } of entries) {
    for (const l of sideMembers(t, sides[0])) for (const r of sideMembers(t, sides[1])) out[l + r] = v;
  }
  for (const [p, v] of Object.entries(t.kerning)) if (pairChars(p)) out[p] = v;
  return out;
}

/** Remove a class and every entry that uses it. */
export function deleteClass(t: Kerned, id: string) {
  t.kernClasses = (t.kernClasses ?? []).filter((c) => c.id !== id);
  for (const key of Object.keys(t.classKerning ?? {})) if (key.split(' ').includes(`@${id}`)) delete t.classKerning![key];
}

/**
 * Set a class's members, taking them out of other classes on its side;
 * a class left empty is removed with its kerning.
 */
export function setClassMembers(t: Kerned, id: string, chars: string) {
  const c = t.kernClasses?.find((k) => k.id === id);
  if (!c) return;
  const members = [...new Set([...chars].filter((ch) => ch.trim() && !/\p{C}/u.test(ch)))];
  c.members = members.join('');
  for (const other of [...(t.kernClasses ?? [])]) {
    if (other === c || other.side !== c.side) continue;
    other.members = [...other.members].filter((ch) => !members.includes(ch)).join('');
    if (!other.members) deleteClass(t, other.id);
  }
  if (!c.members) deleteClass(t, id);
}

/** Put characters in a new class on one side; returns its id (null when no characters are given). */
export function addClass(t: Kerned, side: KernClass['side'], chars: string, id: string): string | null {
  (t.kernClasses ??= []).push({ id, side, members: '' });
  setClassMembers(t, id, chars);
  return t.kernClasses.some((c) => c.id === id) ? id : null;
}

/** Take a character out of its class on one side. */
export function leaveClass(t: Kerned, ch: string, side: KernClass['side']) {
  const c = classOf(t, ch, side);
  if (c) setClassMembers(t, c.id, [...c.members].filter((m) => m !== ch).join(''));
}

/** Put a character in an existing class on that class's side. */
export function joinClass(t: Kerned, ch: string, id: string) {
  const c = t.kernClasses?.find((k) => k.id === id);
  if (c && ![...c.members].includes(ch)) setClassMembers(t, id, c.members + ch);
}

/** Pairs set by hand that disagree with a covering class entry: the class's exceptions. */
export function exceptionsOf(t: Kerned): string[] {
  return Object.keys(t.kerning).filter((p) => {
    const c = pairChars(p);
    return c && entriesFor(t, c[0], c[1]).length > 1;
  });
}

/**
 * Characters that kern (nearly) alike on one side, from the font's pairs
 * ("AV" → em): each group shares all but a few of its pairs. Characters
 * already in a class on that side, and ones with too few pairs to judge,
 * are left out.
 */
export function suggestClasses(t: Kerned, pairs: Iterable<[string, number]>, side: KernClass['side'], minPairs = 3): string[][] {
  // A character's kerning against the other side: its row (as the first of
  // a pair) or its column (as the second).
  const rows = new Map<string, Map<string, number>>();
  for (const [p, v] of pairs) {
    const c = pairChars(p);
    if (!c || !v) continue;
    const [me, other] = side === 'right' ? c : [c[1], c[0]];
    if (!rows.has(me)) rows.set(me, new Map());
    rows.get(me)!.set(other, v);
  }
  const diff = (a: Map<string, number>, b: Map<string, number>) => {
    let d = 0;
    for (const [k, v] of a) if (b.get(k) !== v) d++;
    for (const k of b.keys()) if (!a.has(k)) d++;
    return d;
  };
  const chars = [...rows.keys()].filter((ch) => rows.get(ch)!.size >= minPairs && !classOf(t, ch, side));
  chars.sort((a, b) => rows.get(b)!.size - rows.get(a)!.size || (a < b ? -1 : 1));
  const groups: { lead: Map<string, number>; members: string[] }[] = [];
  for (const ch of chars) {
    const row = rows.get(ch)!;
    // Alike: at most one pair in eight differs from the group's first member.
    const g = groups.find((g) => diff(row, g.lead) * 8 <= Math.max(g.lead.size, row.size));
    if (g) g.members.push(ch);
    else groups.push({ lead: row, members: [ch] });
  }
  return groups.filter((g) => g.members.length > 1).map((g) => g.members);
}
