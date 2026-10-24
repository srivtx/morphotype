// A project as a short text tree: one line per layer with what it is, where it
// sits, its material and every setting that differs from the defaults, so an
// agent can read a whole design without its source or a screenshot. Names and
// ids in the output are what `set` (edit.ts) takes to address a layer.
import { defaultParams, effectById } from '../render/effects';
import { easeName } from '../state/keys';
import { feelOf, type Key, type Motion, type ParamAnim, type Transition } from '../state/motion';
import { isGroup, MODIFIER_DEFAULTS, SYMBOL_DEFAULTS, type Background, type Node, type Project, type Style } from '../state/model';
import type { ModEntry } from '../engine/types';

export const num = (v: number) => String(+v.toFixed(3));
export const val = (v: unknown): string => (typeof v === 'number' ? num(v) : typeof v === 'string' ? v : JSON.stringify(v));
const clip = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Keys of `o` whose values differ from `d` (all of them when there's no default). */
function changed(o: Record<string, unknown>, d: Record<string, unknown> | undefined, skip: string[] = []): string[] {
  return Object.keys(o)
    .filter((k) => !skip.includes(k) && o[k] !== undefined && (d === undefined || JSON.stringify(o[k]) !== JSON.stringify(d[k])))
    .map((k) => `${k} ${val(o[k])}`);
}

function anim(k: string, a: ParamAnim): string {
  return `${k}→${val(a.to)} ${a.mode} ${num(a.period)}s${a.phase ? ` @${num(a.phase)}` : ''}`;
}

/** "keys rotation 0s 0 → 1s 45 linear → 2.5s 30": each keyed property's keys, with curves that aren't the default. */
function keysLine(bag: Record<string, Key[]>): string {
  const each = Object.entries(bag).filter(([, k]) => k.length);
  return each.length ? `keys ${each.map(([k, keys]) => `${k} ${keys.map((x, i) => `${num(x.t)}s ${val(x.v)}${i && x.ease ? ` ${easeName(x.ease)}` : ''}`).join(' → ')}`).join('; ')}` : '';
}

function transition(t: Transition): string {
  const feel = feelOf(t);
  if (feel) return `${feel} ${num(t.duration)}s`;
  if (t.type === 'physics') return `spring k${num(t.stiffness)} c${num(t.damping)} m${num(t.mass)}`;
  if (t.type === 'time') return `spring ${num(t.duration)}s bounce ${num(t.bounce)}`;
  return `ease [${t.ease.map(num).join(',')}] ${num(t.duration)}s`;
}

export function motionText(m: Motion | undefined): string {
  if (!m) return '';
  const out: string[] = [];
  if (m.loop !== 'none') out.push(`loop ${m.loop} ${num(m.amount)} every ${num(m.period)}s${m.phase ? ` @${num(m.phase)}` : ''}${m.loop === 'slide' && m.dir ? ` ${m.dir}` : ''}${m.oneWay ? ' one-way' : ''}`);
  if (m.enter !== 'none') out.push(`enter ${m.enter}${m.enter === 'move' ? ` from ${num(m.fromX ?? 0)},${num(m.fromY ?? 0)}` : m.enter === 'fade' ? '' : ` ${num(m.distance)}`}${m.delay ? ` after ${num(m.delay)}s` : ''} (${transition(m.transition)})`);
  if (m.leave && m.leave !== 'none') out.push(`leave ${m.leave}${m.leave === 'move' ? ` to ${num(m.toX ?? 0)},${num(m.toY ?? 0)}` : ''} at ${num(m.leaveAt ?? 0)}s${m.stops?.length ? ` +${m.stops.length} stops` : ''}`);
  if (m.stagger) out.push(`stagger ${num(m.stagger)}s${m.order && m.order !== 'first' ? ` ${m.order}` : ''}${m.letters ? ` by ${m.letters}` : ''}`);
  return out.join(', ');
}

export function styleText(s: Style): string {
  const d = defaultParams(effectById(s.effect));
  const params = changed(s.params, d);
  const out = [`${s.effect}${params.length ? ` {${params.join(', ')}}` : ''}`];
  if (s.stroke) out.push(`stroke ${num(s.stroke.width)} ${s.stroke.color} ${s.stroke.align}`);
  if (s.depth) out.push(`depth ${num(s.depth.amount)} ${s.depth.color} ${num(s.depth.angle)}°`);
  if (s.opacity !== undefined && s.opacity !== 1) out.push(`opacity ${num(s.opacity)}`);
  if (s.blend && s.blend !== 'normal') out.push(s.blend);
  if (s.soften) out.push(`soften ${num(s.soften)}`);
  const a = Object.entries(s.animate ?? {});
  if (a.length) out.push(`animate ${a.map(([k, v]) => anim(k, v)).join('; ')}`);
  if (s.keys) out.push(keysLine(s.keys));
  return out.join(' · ');
}

function modsText(mods: ModEntry[]): string {
  return mods
    .map((m) => {
      const rest = changed(m as unknown as Record<string, unknown>, MODIFIER_DEFAULTS[m.kind] as unknown as Record<string, unknown>, ['kind', 'on', 'uid']);
      return `${m.kind}[${m.uid}]${m.on === false ? ' off' : ''}${rest.length ? `(${rest.join(', ')})` : ''}`;
    })
    .join(' ')
    .trim();
}

function contentText(n: Exclude<Node, { type: 'group' }>): string {
  const c = n.content;
  switch (c.type) {
    case 'text': {
      const extra = [c.tracking && `tracking ${num(c.tracking)}`, c.lineHeight !== 1 && c.text.includes('\n') && `leading ${num(c.lineHeight)}`, c.align !== 'center' && c.align, c.morph && `morph→${c.morph.font} ${num(c.morph.t)}`].filter(Boolean);
      return `text "${clip(c.text.replace(/\n/g, '⏎'))}" ${c.font} ${num(c.size)}px${extra.length ? ` ${extra.join(' ')}` : ''}`;
    }
    case 'symbol': {
      const f = changed(c.symbol as unknown as Record<string, unknown>, SYMBOL_DEFAULTS[c.symbol.kind] as unknown as Record<string, unknown>, ['kind']);
      return `shape ${c.symbol.kind} ${num(c.size)}px${f.length ? ` (${f.join(', ')})` : ''}`;
    }
    case 'path':
      return `outline${c.name ? ` "${c.name}"` : ''} ${num(c.size)}px (${(c.d.match(/[a-z]/gi) ?? []).length} commands)`;
    case 'line': {
      const t = c.trim;
      const extra = [c.cap !== 'round' && c.cap, c.squiggle && `squiggle ${c.squiggle.kind}`, c.dash && `dash ${num(c.dash.dash)}/${num(c.dash.gap)}`, t && (t.start !== 0 || t.end !== 1 || t.offset) && `trim ${num(t.start)}–${num(t.end)}${t.offset ? `+${num(t.offset)}` : ''}`].filter(Boolean);
      return `pen line ${num(c.width)}px wide, ${(c.d.match(/[a-z]/gi) ?? []).length} commands, ${num(c.size)}px${extra.length ? ` ${extra.join(' ')}` : ''}`;
    }
    case 'stroke':
      return `brush ${c.points.length} points ${num(c.width)}px`;
    case 'morph':
      return `morph t ${num(c.t)}`;
  }
}

function placeText(n: Node): string {
  if (isGroup(n)) return '';
  const out = [`at ${num(n.x)},${num(n.y)}`];
  if (n.rotation) out.push(`rot ${num(n.rotation)}°`);
  if (n.scale !== 1) out.push(`×${num(n.scale)}`);
  if (n.sx !== 1 || n.sy !== 1) out.push(`stretch ${num(n.sx)}×${num(n.sy)}`);
  return out.join(' ');
}

function flags(n: Node): string {
  return [!n.visible && 'hidden', n.op !== 'add' && n.op, n.locked && 'locked', !isGroup(n) && n.guide && 'guide'].filter(Boolean).join(' ');
}

function nodeLines(n: Node, depth: number, out: string[]) {
  const pad = '  '.repeat(depth);
  const name = n.name ? `"${n.name}" ` : '';
  const head = `${pad}- ${name}#${n.id}`;
  const parts: string[] = [];
  if (isGroup(n)) {
    parts.push(`group of ${n.children.length}${n.merge ? ' merged' : ''}${n.clip ? ' clipping' : ''}`);
    if (n.merge) parts.push(styleText(n.style));
  } else {
    parts.push(contentText(n), placeText(n), styleText(n.style));
  }
  const f = flags(n);
  if (f) parts.push(f);
  if (n.modifiers.length) parts.push(`mods ${modsText(n.modifiers)}`);
  const m = motionText(n.motion);
  if (m) parts.push(`motion ${m}`);
  const a = Object.entries(n.animate ?? {});
  if (a.length) parts.push(`animate ${a.map(([k, v]) => anim(k, v)).join('; ')}`);
  if (n.keys) parts.push(keysLine(n.keys));
  out.push(`${head} ${parts.filter(Boolean).join(' · ')}`);
  if (isGroup(n)) for (const c of [...n.children].reverse()) nodeLines(c, depth + 1, out);
}

export function backgroundText(b: Background): string {
  const out = [`${b.fill.kind}${b.fill.kind === 'none' ? '' : ` ${b.fill.colors.join(' ')}`}${b.fill.kind === 'linear' ? ` ${num(b.fill.angle)}°` : ''}`];
  if (b.grain) out.push(`grain ${num(b.grain)}`);
  if (b.tile) out.push(`tile ${b.tile.shape} ${b.tile.fill.colors.join(' ')}`);
  if (b.pattern) out.push(`pattern ${b.pattern.kind} ${b.pattern.color}`);
  return out.join(' · ');
}

/** The whole project, top layer first (as the layers panel lists them). */
export function describe(p: Project): string {
  const tl = p.timeline ?? { duration: 6, loop: true };
  const out = [
    `"${p.name}" ${p.canvas.width}×${p.canvas.height} · background ${backgroundText(p.background)} · clock ${num(tl.duration)}s${tl.loop ? ' loop' : ''}`,
    'layers, top first (x,y = px from the canvas centre; {…} = settings changed from the defaults):',
  ];
  for (const n of [...p.layers].reverse()) nodeLines(n, 0, out);
  if (p.fonts.length) out.push(`fonts: ${p.fonts.map((f) => f.id + (f.data ? ' (embedded)' : '')).join(', ')}`);
  return out.join('\n');
}
