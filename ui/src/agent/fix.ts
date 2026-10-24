// What `check --fix` can do by itself, and what it hands back as commands.
// The mechanical fixes: text cut off by the canvas (shrink it and move it in),
// something nearly centred (centre it by its ink), an entrance that replays
// at the loop's seam (leave before the clock ends), a move the clock cuts off
// (start it earlier or make it quicker). Everything else becomes a
// ready-to-run command. Also the difference between two checks, for `set --check`.
import { timelineOf } from '../state/clock';
import { isGroup, type Node, type Project } from '../state/model';
import { rowsOf } from '../state/tracks';
import type { Finding } from './check';
import { num } from './describe';
import { applyEdits } from './edit';
import { allNodes, findNode, handle } from './find';
import { leaveEdits } from './moves';
import type { LayoutOp } from './place';

type Fix = NonNullable<Finding['fix']>;

/** Space left at the end of the clock after a retimed move, s. */
const PAD = 0.1;

const ref = (id: string) => JSON.stringify('#' + id);
const r2 = (v: number) => +v.toFixed(2);

/** The latest end of a node's entrance or exit clips (its own, or as a staggered group). */
function endOf(p: Project, id: string, kind: 'enter' | 'leave'): number {
  let end = 0;
  for (const r of rowsOf(p, [])) for (const t of r.tracks) if (t.kind === kind && t.owner === id) end = Math.max(end, t.end);
  return end;
}

/**
 * Edits that end a node's entrance (or exit) before the clock does: start it
 * earlier, then tighten its stagger, then make it quicker.
 */
export function retime(p0: Project, id: string, kind: 'enter' | 'leave'): Fix {
  const D = timelineOf(p0).duration;
  const limit = D - PAD;
  let p = p0;
  const edits: string[] = [];
  const step = (e: string[]) => {
    edits.push(...e);
    p = applyEdits(p, e).project;
  };
  const over = () => endOf(p, id, kind) - limit;
  const m = () => findNode(p, id).motion!;
  const name = findNode(p0, id).name ?? '#' + id;
  if (kind === 'enter') {
    if (over() > 0 && m().delay > 0) step([`${ref(id)}.motion.delay=${r2(Math.max(0, m().delay - over()))}`]);
  } else {
    // Not before the entrance has finished.
    const floor = endOf(p, id, 'enter');
    const at = m().leaveAt ?? 0;
    if (over() > 0 && at > floor) step([`${ref(id)}.motion.leaveAt=${r2(Math.max(floor, at - over()))}`]);
  }
  for (let i = 0; i < 4 && over() > 0 && m().stagger > 0; i++) step([`${ref(id)}.motion.stagger=${r2(m().stagger * 0.6)}`]);
  const key = kind === 'leave' && m().leaveTransition ? 'leaveTransition' : 'transition';
  for (let i = 0; i < 6 && over() > 0; i++) {
    const t = m()[key] ?? m().transition;
    step([`${ref(id)}.motion.${kind === 'leave' ? 'leaveTransition' : 'transition'}=${JSON.stringify({ ...t, type: t.type === 'physics' ? 'easing' : t.type, duration: r2(Math.max(0.12, t.duration * 0.7)) })}`]);
  }
  const start = kind === 'enter' ? m().delay : (m().leaveAt ?? 0);
  return { edits, does: `"${name}": ${kind === 'enter' ? 'entrance' : 'exit'} now ${num(r2(start))}–${num(r2(endOf(p, id, kind)))}s, inside the ${num(D)}s clock` };
}

/** Everything that enters but never leaves, on a looping clock: leave before it ends, so the entrance doesn't replay as a jump. */
export function seamFix(p: Project): Fix | null {
  const tl = timelineOf(p);
  if (!tl.loop) return null;
  const nodes = allNodes(p.layers).filter((n) => n.motion && n.motion.enter !== 'none' && (n.motion.leave ?? 'none') === 'none');
  if (!nodes.length) return null;
  const { edits, project } = leaveEdits(p, nodes);
  const at = (n: Node) => num(findNode(project, n.id).motion!.leaveAt!);
  // Worked out again when it's applied, after the other fixes have moved things in time.
  return { edits, does: `${nodes.map((n) => `"${n.name ?? n.id}" leaves (${findNode(project, n.id).motion!.leave}) at ${at(n)}s`).join(', ')}, so the loop starts over from nothing`, redo: seamFix };
}

/**
 * The fixes to apply (warnings and errors only) and what's left to do. With
 * the project, the edits are applied in turn and fixes that depend on the
 * others (the loop seam) are worked out again last.
 */
export function fixPlan(findings: Finding[], p?: Project): { edits: string[]; layout: LayoutOp[]; done: string[]; todo: Finding[] } {
  const out = { edits: [] as string[], layout: [] as LayoutOp[], done: [] as string[], todo: [] as Finding[] };
  const later: Finding[] = [];
  const take = (f: Finding, fix: NonNullable<Finding['fix']>) => {
    out.edits.push(...(fix.edits ?? []));
    out.layout.push(...(fix.layout ?? []));
    out.done.push(`${f.text} → ${fix.does}`);
  };
  for (const f of findings) {
    if (f.level === 'info') continue;
    if (f.fix?.redo && p) later.push(f);
    else if (f.fix) take(f, f.fix);
    else out.todo.push(f);
  }
  if (later.length && p) {
    const now = applyEdits(p, out.edits).project;
    for (const f of later) {
      const fix = f.fix!.redo!(now);
      if (fix) take(f, fix);
    }
  }
  return out;
}

/** What's left, as commands to run (and what can't be done by command, in words). */
export function todoText(todo: Finding[], file: string): string[] {
  const q = /^[\w./-]+$/.test(file) ? file : JSON.stringify(file);
  return todo.map((f) => (f.hint ? `morpho ${f.hint.replace(/\{file\}/g, q)}   # ${f.text}` : `# ${f.text}`));
}

/** A finding without its numbers, to tell "the same thing, changed" from "something new". */
const key = (f: Finding) => f.text.replace(/-?\d+(\.\d+)?/g, '#');
const mark = (f: Finding) => (f.level === 'error' ? '✗' : f.level === 'warn' ? '!' : '·');
const quiet = (f: Finding) => /^looked at /.test(f.text);

/** Findings that appeared (+), went away (−) or changed (~) between two checks. */
export function diffFindings(before: Finding[], after: Finding[]): string[] {
  const b = before.filter((f) => !quiet(f)), a = after.filter((f) => !quiet(f));
  const out: string[] = [];
  const left = new Map(b.map((f) => [key(f), f]));
  for (const f of a) {
    const was = left.get(key(f));
    if (!was) out.push(`+ ${mark(f)} ${f.text}`);
    else {
      left.delete(key(f));
      if (was.text !== f.text || was.level !== f.level) out.push(`~ ${mark(f)} ${f.text} (was: ${was.text})`);
    }
  }
  for (const f of left.values()) out.push(`− ${mark(f)} ${f.text}`);
  return out;
}

/** A small text colour for a layer that doesn't stand out: light on dark, dark on light. */
export function contrastHint(p: Project, n: Node, behind: number): string {
  const c = behind < 0.35 ? '#ffffff' : '#111111';
  const who = JSON.stringify(handle(p, n));
  const fill = !isGroup(n) && 'fill' in n.style.params;
  return fill ? `set {file} '${who}.fill="${c}"'` : `set {file} '${who}.effect=flat' '${who}.fill="${c}"'`;
}
