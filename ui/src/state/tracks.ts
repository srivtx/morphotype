// What the timeline shows: one row per layer that moves (in the Layers
// panel's order, top first, nested in its groups) with a track for each
// thing that moves it, placed in time exactly as the clock plays it.
//
//   Entrance   a clip from when it starts (delay, plus the group's stagger)
//              to when it settles
//   Then       the same, with a segment for each stop on its path
//   Loop       cycles across the whole timeline, fitted to it when looping
//   Setting    a material, modifier or shape setting going to and fro
//   Pattern    a pattern with Speed, flowing the whole time
import { effectById } from '../render/effects';
import type { Timeline } from './clock';
import { textPieces } from './letters';
import { isGroup, MODIFIER_UI, SYMBOL_UI, type Group, type Node, type Project } from './model';
import { ENTER_OPTIONS, lastSlot, LEAVE_OPTIONS, leaveEnd, legsOf, loopPeriod, LOOP_OPTIONS, seedOf, settleTime, staggerSlot, type Motion, type ParamAnim } from './motion';

/** An entrance or Then: a clip from when it starts to when it settles. */
export interface Clip {
  /** The node whose motion this is (a staggered group, for its children). */
  owner: string;
  start: number;
  end: number;
  motion: Motion;
  /** Child slot in a staggered group (start = its time + slot × stagger, slot from the group's order); absent for the node's own. */
  index?: number;
  /** A staggered group's own clip: from the first child starting to the last one settling. */
  children?: number;
  /** The group a staggered child's clip is set on. */
  from?: string;
  label: string;
  /** Then with stops: each step of the path (Move to…, then each stop), placed on the clock. */
  steps?: { start: number; end: number }[];
}

export type Track =
  | (Clip & { kind: 'enter' })
  | (Clip & { kind: 'leave' })
  | { kind: 'loop'; owner: string; motion: Motion; period: number; label: string }
  | { kind: 'param'; owner: string; scope: 'style' | 'geo'; key: string; anim: ParamAnim; period: number; label: string; color: boolean; from: number | string; range: { min: number; max: number; step: number } }
  /** A material that moves by itself (a pattern's or chrome's Speed, a neon's Flicker). */
  | { kind: 'flow'; owner: string; key: string; value: number; title: string; label: string; range: { min: number; max: number; step: number } };

export interface Row {
  node: Node;
  depth: number;
  /** Has rows nested under it. */
  parent: boolean;
  tracks: Track[];
}

/** Seconds of the timeline shown and the loop length cycles are fitted to. */
export const loopLengthOf = (tl: Timeline) => (tl.loop ? tl.duration : undefined);

const optionLabel = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

/** A setting's name and range, for the row label and the To control. */
export function paramInfo(n: Node, scope: 'style' | 'geo', key: string): { label: string; color: boolean; from: number | string; range: { min: number; max: number; step: number } } {
  if (scope === 'style') {
    const p = effectById(n.style.effect).params.find((q) => q.key === key);
    const from = n.style.params[key] ?? p?.default ?? 0;
    if (p?.type === 'number') return { label: p.label, color: false, from, range: { min: p.min, max: p.max, step: p.step } };
    return { label: p?.label ?? key, color: true, from, range: { min: 0, max: 1, step: 0.01 } };
  }
  const mod = /^mod:([^:]+):(.+)$/.exec(key);
  if (mod) {
    const m = n.modifiers.find((x) => x.uid === mod[1]);
    const ui = m ? MODIFIER_UI[m.kind] : undefined;
    const f = ui?.fields.find((x) => x.key === mod[2]);
    const from = Number((m as unknown as Record<string, number> | undefined)?.[mod[2]] ?? 0);
    const range = f && 'min' in f ? { min: f.min, max: f.max, step: f.step } : { min: from - 100, max: from + 100, step: 0.01 };
    return { label: `${ui?.label ?? 'Modifier'} · ${f?.label ?? mod[2]}`, color: false, from, range };
  }
  const field = key.replace(/^sym:/, '');
  if (!isGroup(n) && n.content.type === 'symbol') {
    const f = SYMBOL_UI[n.content.symbol.kind]?.fields.find((x) => x.key === field);
    const from = Number((n.content.symbol as unknown as Record<string, number>)[field] ?? 0);
    const range = f && 'min' in f ? { min: f.min, max: f.max, step: f.step } : { min: from - 100, max: from + 100, step: 0.01 };
    return { label: `Shape · ${f?.label ?? field}`, color: false, from, range };
  }
  return { label: field, color: false, from: 0, range: { min: 0, max: 1, step: 0.01 } };
}

/** The tracks on one node: its own motion, a staggered parent's entrance, its moving settings. */
export function tracksOf(n: Node, tl: Timeline, parent?: { group: Group; index: number }): Track[] {
  const L = loopLengthOf(tl);
  const out: Track[] = [];
  const g = parent?.group;
  const leaveLabel = (m: Motion) => optionLabel(LEAVE_OPTIONS, m.leave ?? 'none') + (m.leave === 'move' && m.stops?.length ? ` · ${m.stops.length + 1} stops` : '');
  // Then, from when it sets off to when its last stop settles, shifted `off` seconds.
  const steps = (m: Motion, off: number) => (m.leave === 'move' && m.stops?.length ? legsOf(m).map((l) => ({ start: l.start + off, end: l.end + off })) : undefined);
  const gm = g && !g.merge && g.motion && g.motion.stagger > 0 ? g.motion : null;
  if (g && gm) {
    // A staggered group's entrance and Then play on each child in turn.
    const slot = staggerSlot(gm.order, parent!.index, g.children.length, seedOf(g.id));
    const off = slot * gm.stagger;
    if (gm.enter !== 'none') out.push({ kind: 'enter', owner: g.id, start: gm.delay + off, end: gm.delay + off + settleTime(gm.transition), motion: gm, index: slot, label: optionLabel(ENTER_OPTIONS, gm.enter), from: g.name });
    if (gm.leave && gm.leave !== 'none') {
      out.push({ kind: 'leave', owner: g.id, start: (gm.leaveAt ?? 0) + off, end: leaveEnd(gm) + off, motion: gm, index: slot, label: leaveLabel(gm), from: g.name, steps: steps(gm, off) });
    }
  }
  const m = n.motion;
  if (m) {
    // A staggered group's own clips span its children, from the first starting to the last settling; a text's, its letters or words.
    const k = isGroup(n) && !n.merge && m.stagger > 0 ? n.children.length : textPieces(n);
    const spread = k ? m.stagger * lastSlot(m.order, k) : 0;
    const unit = isGroup(n) ? '' : ` ${m.letters === 'words' ? 'word' : 'letter'}${k === 1 ? '' : 's'}`;
    const turn = k ? ` · ${k}${unit} in turn` : '';
    if (m.enter !== 'none') out.push({ kind: 'enter', owner: n.id, start: m.delay, end: m.delay + spread + settleTime(m.transition), motion: m, children: k || undefined, label: optionLabel(ENTER_OPTIONS, m.enter) + turn });
    if (m.leave && m.leave !== 'none') {
      out.push({ kind: 'leave', owner: n.id, start: m.leaveAt ?? 0, end: leaveEnd(m) + spread, motion: m, children: k || undefined, label: leaveLabel(m) + turn, steps: k ? undefined : steps(m, 0) });
    }
    if (m.loop !== 'none') out.push({ kind: 'loop', owner: n.id, motion: m, period: loopPeriod(m.period, L), label: optionLabel(LOOP_OPTIONS, m.loop) });
  }
  for (const [key, anim] of Object.entries(n.style.animate ?? {})) {
    const info = paramInfo(n, 'style', key);
    out.push({ kind: 'param', owner: n.id, scope: 'style', key, anim, period: loopPeriod(anim.period, L), ...info });
  }
  for (const [key, anim] of Object.entries(n.animate ?? {})) {
    const info = paramInfo(n, 'geo', key);
    out.push({ kind: 'param', owner: n.id, scope: 'geo', key, anim, period: loopPeriod(anim.period, L), ...info });
  }
  const fx = effectById(n.style.effect);
  if (fx.animated?.(n.style.params)) {
    const p = fx.params.find((q) => q.key === 'speed') ?? fx.params.find((q) => q.key === 'flicker');
    if (p?.type === 'number') {
      const value = Number(n.style.params[p.key] ?? p.default);
      out.push({ kind: 'flow', owner: n.id, key: p.key, value, title: fx.id === 'pattern' ? 'Pattern' : 'Material', label: `${fx.name} · ${p.label} ${+value.toFixed(2)}`, range: { min: p.min, max: p.max, step: p.step } });
    }
  }
  return out;
}

/**
 * Rows for the layers that move, plus any selected layer (so it can be given
 * motion here) and the groups around them.
 */
export function rowsOf(p: Project, selection: string[]): Row[] {
  const tl = p.timeline ?? { duration: 6, loop: true };
  const picked = new Set(selection);
  const walkNodes = (nodes: Node[], depth: number, parent?: Group): Row[] => {
    const rows: Row[] = [];
    // Top of the stack first, as in the Layers panel.
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const tracks = tracksOf(n, tl, parent ? { group: parent, index: i } : undefined);
      const inner = isGroup(n) && !n.merge ? walkNodes(n.children, depth + 1, n) : [];
      if (!tracks.length && !inner.length && !picked.has(n.id)) continue;
      rows.push({ node: n, depth, parent: inner.length > 0, tracks }, ...inner);
    }
    return rows;
  };
  return walkNodes(p.layers, 0);
}

/** Snap a time to whole frames, or to a nearby target (within `reach` seconds). */
export function snapTime(t: number, fps: number, targets: number[], reach: number): number {
  let best = Math.round(t * fps) / fps;
  let d = reach;
  for (const s of targets) {
    if (Math.abs(s - t) < d) {
      d = Math.abs(s - t);
      best = s;
    }
  }
  return best;
}

/** Seconds → "1.40" and the frame it falls on. */
export const frameAt = (t: number, fps: number) => Math.round(t * fps);
