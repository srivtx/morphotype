// When everything moves, as a text chart: one row per moving layer (the
// timeline dock's rows, top first) with entrances and exits as bars on the
// clock, loops and keyframes as their cycles, and a few notes on rhythm: many
// things starting at once, or long stretches where nothing happens.
import { timelineOf } from '../state/clock';
import { feelOf, HOLD_GO, HOLD_IN, HOLD_OUT } from '../state/motion';
import type { Project } from '../state/model';
import { nodeLabel } from '../state/model';
import { rowsOf, type Track } from '../state/tracks';
import { num } from './describe';

const COLS = 48;

function bar(a: number, b: number, D: number, steps?: { start: number; end: number }[]): string {
  const cell = (t: number) => Math.max(0, Math.min(COLS - 1, Math.floor((t / D) * COLS)));
  const out = Array<string>(COLS).fill('·');
  for (let i = cell(a); i <= cell(Math.min(b, D - 1e-6)); i++) out[i] = '█';
  for (const s of steps?.slice(1) ?? []) out[cell(s.start)] = '▌';
  return out.join('');
}

function cycles(period: number, D: number, ch: string): string {
  const out = Array<string>(COLS).fill(ch);
  for (let t = 0; t <= D + 1e-6; t += Math.max(period, D / COLS)) out[Math.min(COLS - 1, Math.round((t / D) * COLS))] = '|';
  return out.join('');
}

/** A hold keyframe across the clock: _ at rest, / going, ‾ at To, \ coming back. */
function holds(period: number, phase: number, D: number): string {
  return Array.from({ length: COLS }, (_, i) => {
    const u = ((i + 0.5) / COLS) * (D / period) + phase;
    const f = u - Math.floor(u);
    return f < HOLD_GO ? '_' : f < HOLD_IN ? '/' : f < HOLD_OUT ? '‾' : '\\';
  }).join('');
}

function trackLine(t: Track, D: number): [string, string, string] {
  switch (t.kind) {
    case 'enter':
    case 'leave': {
      const feel = feelOf(t.motion.transition);
      const how = feel ?? t.motion.transition.type;
      return [`${t.kind === 'enter' ? 'in' : 'out'} ${t.label}`.toLowerCase(), bar(t.start, t.end, D, t.steps), `${num(t.start)}–${num(t.end)}s ${how}${t.from ? ` (from group "${t.from}")` : ''}`];
    }
    case 'loop':
      return [`loop ${t.label}`.toLowerCase(), cycles(t.period, D, '~'), `every ${num(t.period)}s, ${num(t.motion.amount)}`];
    case 'param':
      return [t.label.toLowerCase(), t.anim.mode === 'hold' ? holds(t.period, t.anim.phase, D) : cycles(t.period, D, t.anim.mode === 'ramp' ? '/' : t.anim.mode === 'flicker' ? ':' : '∿'), `${t.anim.mode} ${String(t.from)}→${String(t.anim.to)} every ${num(t.period)}s`];
    case 'flow':
      return [t.title.toLowerCase(), '═'.repeat(COLS), t.label];
  }
}

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

export function timing(p: Project): string {
  const tl = timelineOf(p);
  const D = Math.max(0.1, tl.duration);
  const rows = rowsOf(p, []);
  if (!rows.length) return `"${p.name}": nothing moves.`;
  const ruler = Array<string>(COLS).fill(' ');
  const marks = Math.min(8, Math.floor(D));
  for (let s = 0; s <= marks; s++) {
    const t = (s * D) / marks;
    const label = `${num(t)}s`;
    const at = Math.min(COLS - label.length, Math.round((t / D) * COLS));
    for (let i = 0; i < label.length; i++) ruler[at + i] = label[i];
  }
  const out = [`"${p.name}" clock ${num(D)}s${tl.loop ? ' loop' : ''} · █ in/out, | cycle starts, ∿ swing, / ramp, : flicker, hold _/‾\\ (rest, go, at To, back)`, `${' '.repeat(24 + 24)}${ruler.join('')}`];
  for (const r of rows) {
    const name = `${'  '.repeat(r.depth)}${nodeLabel(r.node)}`;
    if (!r.tracks.length) out.push(pad(name, 24));
    r.tracks.forEach((t, i) => {
      const [kind, b, note] = trackLine(t, D);
      out.push(`${pad(i === 0 ? name : '', 24)}${pad(kind, 24)}${b}  ${note}`);
    });
  }
  out.push(...rhythm(rows.flatMap((r) => r.tracks), D, tl.loop));
  return out.join('\n');
}

/** Notes on how the moves sit together in time. */
export function rhythm(tracks: Track[], D: number, loop: boolean): string[] {
  const notes: string[] = [];
  const clips = tracks.filter((t): t is Extract<Track, { kind: 'enter' | 'leave' }> => t.kind === 'enter' || t.kind === 'leave');
  const starts = clips.filter((c) => c.kind === 'enter').map((c) => c.start).sort((a, b) => a - b);
  for (let i = 0; i < starts.length; ) {
    let j = i;
    while (j + 1 < starts.length && starts[j + 1] - starts[i] < 0.05) j++;
    if (j - i + 1 >= 3) notes.push(`· ${j - i + 1} entrances start together at ${num(starts[i])}s: a stagger gives them rhythm`);
    i = j + 1;
  }
  const always = tracks.some((t) => t.kind === 'loop' || t.kind === 'param' || t.kind === 'flow');
  if (clips.length && !always) {
    const spans = clips.map((c) => [c.start, c.end] as const).sort((a, b) => a[0] - b[0]);
    let edge = 0;
    const gaps: [number, number][] = [];
    for (const [a, b] of spans) {
      if (a - edge > D * 0.3) gaps.push([edge, a]);
      edge = Math.max(edge, b);
    }
    if (D - edge > D * 0.3) gaps.push([edge, D]);
    for (const [a, b] of gaps) notes.push(`· nothing moves from ${num(a)}s to ${num(b)}s${loop && b === D ? ' (then it loops)' : ''}`);
  }
  const late = clips.filter((c) => c.end > D + 1e-3);
  for (const c of late) notes.push(`! a move ends at ${num(c.end)}s, after the ${num(D)}s clock: it gets cut off`);
  return notes;
}
