// Motion recipes: an entrance, a loop and a way out for several layers in one
// go (`--enter rise --stagger 0.15`), as assignments on today's motion model,
// so nobody writes keyframe JSON or works out delays by hand. On a looping
// clock everything that enters also leaves before the clock ends (unless told
// not to), so the loop joins without the entrance replaying as a jump.
import { timelineOf } from '../state/clock';
import { ENTER_UI, FEELS, LEAVE_UI, LOOP_UI, settleTime, type EnterKind, type LeaveKind, type LoopKind, type Transition } from '../state/motion';
import { isGroup, type Node, type Project } from '../state/model';
import { rowsOf } from '../state/tracks';
import { num } from './describe';
import { applyEdits } from './edit';
import { allNodes, EditError, findNode } from './find';

export interface MoveSpec {
  /** Layer names or ids, in the order they move; or "all" (top-level layers, bottom up), "text", "shapes". */
  layers?: string[] | string;
  /** A named recipe (see RECIPES); the other fields override it. */
  recipe?: string;
  enter?: EnterKind;
  /** "auto" (the default on a looping clock): the entrance's way out; "none" stays. */
  leave?: LeaveKind | 'auto';
  loop?: LoopKind;
  /** Seconds between one layer and the next. */
  stagger?: number;
  /** When the first one starts, s. */
  start?: number;
  /** Smooth, Snappy, Bouncy or Slow. */
  feel?: string;
  /** Seconds each entrance takes. */
  duration?: number;
  distance?: number;
  /** Text moves letter by letter (or word by word), `letterStagger` s apart. */
  letters?: boolean | 'letters' | 'words';
  letterStagger?: number;
  period?: number;
  amount?: number;
  /** Loops: phase step from one layer to the next (0…1), so they move out of step. */
  spread?: number;
  /** When leaving starts, s (default: as late as still ends before the clock). */
  leaveAt?: number;
}

export const RECIPES: Record<string, { blurb: string; spec: MoveSpec }> = {
  cascade: { blurb: 'each rises in, one after another', spec: { enter: 'rise', stagger: 0.15, feel: 'Smooth' } },
  pop: { blurb: 'each grows in with a spring', spec: { enter: 'grow', stagger: 0.1, feel: 'Bouncy' } },
  'type-on': { blurb: 'text fades in letter by letter', spec: { enter: 'fade', letters: 'letters', letterStagger: 0.05, stagger: 0.3 } },
  'slide-in': { blurb: 'each slides in from the left', spec: { enter: 'left', stagger: 0.12, feel: 'Snappy' } },
  drop: { blurb: 'each drops in from above with a bounce', spec: { enter: 'drop', stagger: 0.12, feel: 'Bouncy' } },
  drift: { blurb: 'everything floats, out of step', spec: { loop: 'float', spread: 0.25 } },
  breathe: { blurb: 'everything pulses gently, out of step', spec: { loop: 'pulse', amount: 6, spread: 0.2 } },
};

/** The way out that continues an entrance. */
const OUT: Partial<Record<EnterKind, LeaveKind>> = { rise: 'rise', drop: 'drop', left: 'right', right: 'left', grow: 'shrink' };

/** Gap left at the end of a looping clock, s: everything has gone before it starts over. */
const PAD = 0.15;
/** Least time to stay still between arriving and leaving, s. */
const HOLD = 0.4;

function targetsOf(p: Project, layers: MoveSpec['layers']): Node[] {
  if (layers === undefined || layers === 'all') return p.layers.filter((n) => n.visible);
  if (layers === 'text') return allNodes(p.layers).filter((n) => !isGroup(n) && n.content.type === 'text');
  if (layers === 'shapes') return allNodes(p.layers).filter((n) => !isGroup(n) && n.content.type !== 'text');
  const list = typeof layers === 'string' ? layers.split(',').map((s) => s.trim()).filter(Boolean) : layers;
  return list.map((t) => findNode(p, t));
}

function feelOf(name: string | undefined, duration: number | undefined): Transition | undefined {
  if (!name && duration === undefined) return undefined;
  const f = name ? FEELS.find((x) => x.label.toLowerCase() === name.toLowerCase()) : FEELS[0];
  if (!f) throw new EditError(`No feel "${name}". Feels: ${FEELS.map((x) => x.label).join(', ')}`);
  return { ...f.value, ...(duration !== undefined ? { duration } : {}) };
}

/** When a node's entrance and exit clips end on the clock (stagger and letters included). */
function ends(p: Project, id: string): { enter: number; leave: number } {
  const out = { enter: 0, leave: 0 };
  const walk = (rows: ReturnType<typeof rowsOf>) => {
    for (const r of rows)
      for (const t of r.tracks) {
        if ((t.kind === 'enter' || t.kind === 'leave') && (t.owner === id || r.node.id === id)) out[t.kind] = Math.max(out[t.kind], t.end);
      }
  };
  walk(rowsOf(p, []));
  return out;
}

const ref = (n: Node) => JSON.stringify('#' + n.id);

/**
 * Exits for `nodes` timed to end just before a looping clock does: the
 * entrance's way out (or `kind`), as late as fits, last in last out.
 * Returns the edits and the project with them.
 */
export function leaveEdits(p: Project, nodes: Node[], kind?: LeaveKind, stagger = 0, at?: number): { edits: string[]; project: Project } {
  const D = timelineOf(p).duration;
  const edits: string[] = [];
  nodes.forEach((n, i) => {
    const m = n.motion;
    const k = kind ?? (m && OUT[m.enter]) ?? 'fade';
    edits.push(`${ref(n)}.motion.leave=${JSON.stringify(k)}`);
    const settle = settleTime(m?.leaveTransition ?? m?.transition ?? FEELS[0].value);
    edits.push(`${ref(n)}.motion.leaveAt=${+Math.max(0, at ?? D - PAD - settle - (nodes.length - 1 - i) * stagger * 0.5).toFixed(2)}`);
  });
  let q = applyEdits(p, edits).project;
  if (at !== undefined) return { edits, project: q };
  // Letters and staggered groups take longer to leave than one transition: pull those in by what overshoots.
  const fixes: string[] = [];
  for (const n of nodes) {
    const e = ends(q, n.id);
    const over = e.leave - (D - PAD);
    const leaveAt = findNode(q, n.id).motion?.leaveAt ?? 0;
    if (over > 0.005) fixes.push(`${ref(n)}.motion.leaveAt=${+Math.max(0, leaveAt - over).toFixed(2)}`);
  }
  if (fixes.length) q = applyEdits(q, fixes).project;
  // Something still entering when it should leave: bring its entrance forward so it holds still a moment.
  const early: string[] = [];
  for (const n of nodes) {
    const m = findNode(q, n.id).motion!;
    const short = ends(q, n.id).enter + HOLD - (m.leaveAt ?? 0);
    if (short > 0.005 && m.enter !== 'none' && m.delay > 0) early.push(`${ref(n)}.motion.delay=${+Math.max(0, m.delay - short).toFixed(2)}`);
  }
  if (early.length) q = applyEdits(q, early).project;
  return { edits: [...edits, ...fixes, ...early], project: q };
}

/** A recipe over layers, as assignments, and a line on what it does. */
export function moveEdits(p: Project, spec0: MoveSpec): { edits: string[]; project: Project; summary: string } {
  const named = spec0.recipe ? RECIPES[spec0.recipe.toLowerCase()] : undefined;
  if (spec0.recipe && !named) throw new EditError(`No motion recipe "${spec0.recipe}". Recipes: ${Object.keys(RECIPES).join(', ')}`);
  const spec: MoveSpec = { ...named?.spec, ...Object.fromEntries(Object.entries(spec0).filter(([, v]) => v !== undefined)) };
  const nodes = targetsOf(p, spec.layers);
  if (!nodes.length) throw new EditError('motion needs layers to move');
  const tl = timelineOf(p);
  const D = tl.duration;
  if (spec.enter && !(spec.enter in ENTER_UI) && spec.enter !== 'fade') throw new EditError(`No entrance "${spec.enter}". Entrances: fade, ${Object.keys(ENTER_UI).join(', ')}`);
  if (spec.loop && !(spec.loop in LOOP_UI) && spec.loop !== 'none') throw new EditError(`No loop "${spec.loop}". Loops: ${Object.keys(LOOP_UI).join(', ')}`);
  if (spec.leave && spec.leave !== 'auto' && spec.leave !== 'none' && spec.leave !== 'fade' && !(spec.leave in LEAVE_UI)) throw new EditError(`No way out "${spec.leave}". Leaves: auto, none, fade, ${Object.keys(LEAVE_UI).join(', ')}`);
  const stagger = spec.stagger ?? 0;
  const start = spec.start ?? 0;
  const tr = feelOf(spec.feel, spec.duration);
  const edits: string[] = [];
  nodes.forEach((n, i) => {
    const id = ref(n);
    if (spec.enter) {
      edits.push(`${id}.motion.enter=${JSON.stringify(spec.enter)}`, `${id}.motion.delay=${+(start + i * stagger).toFixed(3)}`);
      if (tr) edits.push(`${id}.motion.transition=${JSON.stringify(tr)}`);
      if (spec.distance !== undefined) edits.push(`${id}.motion.distance=${spec.distance}`);
      if (spec.letters && !isGroup(n) && n.content.type === 'text') edits.push(`${id}.motion.letters=${JSON.stringify(spec.letters === true ? 'letters' : spec.letters)}`, `${id}.motion.stagger=${spec.letterStagger ?? 0.05}`);
    }
    if (spec.loop) {
      edits.push(`${id}.motion.loop=${JSON.stringify(spec.loop)}`);
      if (spec.period !== undefined) edits.push(`${id}.motion.period=${spec.period}`);
      if (spec.amount !== undefined) edits.push(`${id}.motion.amount=${spec.amount}`);
      if (spec.spread) edits.push(`${id}.motion.phase=${+((i * spec.spread) % 1).toFixed(3)}`);
    }
  });
  let { project } = applyEdits(p, edits);
  const all = [...edits];
  const leave = spec.leave ?? (spec.enter && tl.loop ? 'auto' : undefined);
  let out = '';
  if (leave && leave !== 'none') {
    const fresh = nodes.map((n) => findNode(project, n.id));
    const r = leaveEdits(project, fresh, leave === 'auto' ? undefined : leave, stagger, spec.leaveAt);
    project = r.project;
    all.push(...r.edits);
    const first = Math.min(...fresh.map((n) => findNode(project, n.id).motion?.leaveAt ?? D));
    out = `, leaving from ${num(first)}s so the ${num(D)}s loop joins`;
    const tight = fresh.filter((n) => findNode(project, n.id).motion!.leaveAt! < ends(project, n.id).enter + HOLD - 0.01).map((n) => n.name ?? n.id);
    if (tight.length) out += ` (! ${tight.join(', ')} barely ${tight.length > 1 ? 'hold' : 'holds'} still: a longer clock, a shorter stagger or fewer layers)`;
  }
  const lateIn = nodes.filter((n) => ends(project, n.id).enter > D + 1e-3).map((n) => n.name ?? n.id);
  if (lateIn.length) out += ` (! ${lateIn.join(', ')} ${lateIn.length > 1 ? 'are' : 'is'} still entering when the clock ends)`;
  const what = [spec.enter && `enter ${spec.enter}${stagger ? ` ${num(stagger)}s apart` : ''}${start ? ` from ${num(start)}s` : ''}${spec.letters ? ' letter by letter' : ''}`, spec.loop && `loop ${spec.loop}${spec.spread ? ' out of step' : ''}`].filter(Boolean).join(', ');
  return { edits: all, project, summary: `motion ${spec.recipe ? `${spec.recipe}: ` : ''}${nodes.map((n) => n.name ?? n.id).join(', ')}: ${what || 'leave'}${out}` };
}

export function recipesText(): string {
  return ['motion recipes (morpho motion <file> <layers…> --recipe name, or "motion" in a make spec):', ...Object.entries(RECIPES).map(([k, r]) => `  ${k}: ${r.blurb} (${JSON.stringify(r.spec)})`), '  or by hand: --enter rise|drop|left|right|grow|spin|fade --stagger 0.15 --feel Smooth|Snappy|Bouncy|Slow --loop float --leave auto|none|fade…'].join('\n');
}
