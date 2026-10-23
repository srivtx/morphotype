// Problems in a design, said in words so nobody has to spot them in a
// screenshot. The structural checks read the project and the engine's build;
// the pixel checks (page.ts renders the frames) look at what actually shows:
// layers that can't be seen, text with too little contrast, blank frames, a
// loop that jumps at the seam, and sudden pops in the motion.
import type { BuildResult } from '../engine/client';
import type { Box } from '../engine/types';
import { effectById, EFFECTS } from '../render/effects';
import { timelineOf } from '../state/clock';
import { isChoice, isGroup, MODIFIER_UI, SYMBOL_UI, type Node, type Project } from '../state/model';
import { MORPH_KEY } from '../state/geoMotion';
import { num } from './describe';

export interface Finding {
  level: 'error' | 'warn' | 'info';
  text: string;
}

export const label = (n: Node) => (n.name ? `"${n.name}" #${n.id}` : `#${n.id}`);

function walk(nodes: Node[], f: (n: Node, hidden: boolean, merged: boolean) => void, hidden = false, merged = false) {
  for (const n of nodes) {
    f(n, hidden || !n.visible, merged);
    if (isGroup(n)) walk(n.children, f, hidden || !n.visible, merged || n.merge);
  }
}

/** Share of `b` outside the artboard (centred at 0,0), and on which sides. */
export function outside(b: Box, w: number, h: number): { share: number; sides: string[] } {
  const [x0, y0, x1, y1] = b;
  const area = Math.max(1e-6, (x1 - x0) * (y1 - y0));
  const ix = Math.max(0, Math.min(x1, w / 2) - Math.max(x0, -w / 2));
  const iy = Math.max(0, Math.min(y1, h / 2) - Math.max(y0, -h / 2));
  const sides = [x0 < -w / 2 && 'left', x1 > w / 2 && 'right', y0 < -h / 2 && 'top', y1 > h / 2 && 'bottom'].filter((s): s is string => !!s);
  return { share: 1 - (ix * iy) / area, sides };
}

/** What can be told from the project and its build, without drawing anything. */
export function structural(p: Project, build: BuildResult | null): Finding[] {
  const out: Finding[] = [];
  const { width: W, height: H } = p.canvas;
  const tl = timelineOf(p);
  const outs = new Map((build?.layers ?? []).map((l) => [l.id, l]));
  walk(p.layers, (n, hidden, merged) => {
    const who = label(n);
    // Material.
    if (!merged || isGroup(n)) {
      if (!EFFECTS.some((e) => e.id === n.style.effect)) out.push({ level: 'error', text: `${who}: unknown material "${n.style.effect}" (drawn as flat)` });
      const e = effectById(n.style.effect);
      for (const [k, v] of Object.entries(n.style.params)) {
        const d = e.params.find((x) => x.key === k);
        if (!d) continue;
        if (d.type === 'number' && typeof v === 'number' && (v < d.min || v > d.max)) out.push({ level: 'warn', text: `${who}: ${e.id}.${k} = ${num(v)} is outside ${d.min}…${d.max}` });
        if (d.type === 'color' && (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))) out.push({ level: 'error', text: `${who}: ${e.id}.${k} = ${JSON.stringify(v)} is not a colour like #ff3366` });
      }
      for (const k of Object.keys(n.style.animate ?? {})) if (!e.params.some((x) => x.key === k)) out.push({ level: 'warn', text: `${who}: keyframe on "${k}" does nothing; ${e.id} has no such setting` });
    }
    // Modifiers.
    for (const m of n.modifiers) {
      for (const f of MODIFIER_UI[m.kind]?.fields ?? []) {
        const v = (m as unknown as Record<string, unknown>)[f.key];
        if (!isChoice(f) && typeof v === 'number' && (v < f.min || v > f.max)) out.push({ level: 'warn', text: `${who}: ${m.kind}.${f.key} = ${num(v)} is outside ${f.min}…${f.max}` });
      }
    }
    if (!isGroup(n) && n.content.type === 'symbol') {
      const s = n.content.symbol as unknown as Record<string, unknown>;
      for (const f of SYMBOL_UI[n.content.symbol.kind]?.fields ?? []) {
        const v = s[f.key];
        if (!isChoice(f) && typeof v === 'number' && (v < f.min || v > f.max)) out.push({ level: 'warn', text: `${who}: ${n.content.symbol.kind}.${f.key} = ${num(v)} is outside ${f.min}…${f.max}` });
      }
    }
    // Geometry keyframes that no longer point at anything.
    for (const k of Object.keys(n.animate ?? {})) {
      const m = /^mod:([^:]+):(.+)$/.exec(k);
      const dead = m
        ? typeof (n.modifiers.find((x) => x.uid === m[1]) as unknown as Record<string, unknown> | undefined)?.[m[2]] !== 'number'
        : k === MORPH_KEY
          ? isGroup(n) || !(n.content.type === 'morph' || (n.content.type === 'text' && n.content.morph))
          : k.startsWith('line:')
            ? isGroup(n) || n.content.type !== 'line'
            : k.startsWith('sym:')
              ? isGroup(n) || n.content.type !== 'symbol' || typeof (n.content.symbol as unknown as Record<string, unknown>)[k.slice(4)] !== 'number'
              : true;
      if (dead) out.push({ level: 'warn', text: `${who}: keyframe "${k}" points at nothing and does nothing` });
    }
    // Timing.
    const mo = n.motion;
    if (mo && mo.enter !== 'none' && mo.delay >= tl.duration) out.push({ level: 'warn', text: `${who}: enters at ${num(mo.delay)}s, after the ${num(tl.duration)}s clock ends` });
    if (mo?.leave && mo.leave !== 'none' && (mo.leaveAt ?? 0) >= tl.duration) out.push({ level: 'warn', text: `${who}: leaves at ${num(mo.leaveAt ?? 0)}s, after the ${num(tl.duration)}s clock ends` });
    // Geometry.
    if (isGroup(n) || hidden || merged || (!isGroup(n) && n.guide)) return;
    const o = outs.get(n.id);
    if (!o) return;
    if (o.error) out.push({ level: 'error', text: `${who}: the engine couldn't build it: ${o.error}` });
    else if (!o.bbox) out.push({ level: 'warn', text: `${who}: has no outline (empty text or shape?)` });
    else {
      const { share, sides } = outside(o.bbox, W, H);
      if (share > 0.995) out.push({ level: 'error', text: `${who}: entirely outside the canvas (box ${o.bbox.map(num).join(', ')})` });
      else if (share > 0.02) out.push({ level: 'warn', text: `${who}: ${Math.round(share * 100)}% off the ${sides.join(' and ')} edge${sides.length > 1 ? 's' : ''}` });
      const tall = o.bbox[3] - o.bbox[1];
      if (n.content.type === 'text' && tall < Math.min(W, H) * 0.012) out.push({ level: 'warn', text: `${who}: text is only ${num(tall)}px tall on a ${W}×${H} canvas` });
    }
  });
  return out;
}

export interface Pixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Mean absolute difference per channel (0…255) between two same-size images. */
export function diff(a: Pixels, b: Pixels): number {
  let s = 0;
  const n = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < n; i += 4) s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  return s / ((n / 4) * 3);
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export const luminance = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** How many pixels a layer changes, and its contrast against what's behind it there. */
export function presence(shown: Pixels, without: Pixels): { px: number; contrast: number } {
  let px = 0, fg = 0, bg = 0;
  const d = shown.data, e = without.data;
  for (let i = 0; i < d.length; i += 4) {
    // Low enough to catch text a shade off its background; drawing is deterministic, so no noise.
    if (Math.abs(d[i] - e[i]) + Math.abs(d[i + 1] - e[i + 1]) + Math.abs(d[i + 2] - e[i + 2]) < 9) continue;
    px++;
    fg += luminance(d[i], d[i + 1], d[i + 2]);
    bg += luminance(e[i], e[i + 1], e[i + 2]);
  }
  return { px, contrast: px ? contrast(fg / px, bg / px) : 1 };
}

/** Spread of brightness: near 0 means a flat, empty-looking frame. */
export function spread(p: Pixels): number {
  let s = 0, s2 = 0;
  const n = p.data.length / 4;
  for (let i = 0; i < p.data.length; i += 4) {
    const l = (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
    s += l;
    s2 += l * l;
  }
  return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
}

/**
 * Motion from runs of three frames one video frame apart: a pop is one step
 * far bigger than the steps either side of it (fast but smooth motion has
 * neighbours just as big). `seam` is the same around the loop's restart:
 * the step into it (a), across it (b) and out of it (c).
 */
export function motionFindings(runs: { t: number; a: number; b: number }[], seam: { a: number; b: number; c: number } | null, animated: boolean): Finding[] {
  const out: Finding[] = [];
  const moving = runs.some((r) => Math.max(r.a, r.b) > 0.05) || (seam && Math.max(seam.a, seam.b, seam.c) > 0.05);
  if (!moving) {
    if (animated) out.push({ level: 'warn', text: 'set to move, but nothing visibly changes over the clock' });
    return out;
  }
  const floor = 0.15;
  for (const r of runs) {
    const [big, small] = r.a > r.b ? [r.a, r.b] : [r.b, r.a];
    if (big > 2 && big > (small + floor) * 6) out.push({ level: 'warn', text: `pop at ${num(r.t)}s: one frame changes ${num(big / (small + floor))}× more than the next` });
  }
  if (seam) {
    // Across a smooth seam the last frame flows into the first like any other step, so the step before is the measure.
    const near = seam.a;
    if (seam.b > 1.5 && seam.b > (near + floor) * 4) out.push({ level: 'warn', text: `the loop jumps where it starts over: ${num(seam.b / (near + floor))}× the frames around it (something that ends differently from how it starts, like an entrance that replays)` });
    else out.push({ level: 'info', text: 'the loop joins smoothly' });
  }
  return out;
}

export function report(title: string, findings: Finding[]): string {
  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  const info = findings.filter((f) => f.level === 'info');
  const head = `${title}: ${errors.length ? `${errors.length} problem${errors.length > 1 ? 's' : ''}` : 'no problems'}, ${warns.length} warning${warns.length === 1 ? '' : 's'}`;
  return [head, ...errors.map((f) => `✗ ${f.text}`), ...warns.map((f) => `! ${f.text}`), ...info.map((f) => `· ${f.text}`)].join('\n');
}
