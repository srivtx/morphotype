// Motion: loops and entrances for layers and groups, evaluated at a time on
// the scene clock (see clock.ts). Nothing here rebuilds geometry: a pose is a
// move, turn, scale and fade about the object's centre that the renderer
// applies when it draws. Transitions follow DialKit's model (MIT, Josh
// Puckett), itself Motion's: an easing curve, a spring set by time (duration
// and bounce) or a spring set by physics (stiffness, damping, mass).

export type Bezier = [number, number, number, number];

export type TransitionType = 'easing' | 'time' | 'physics';

/** Every mode's values are kept, so switching modes gives back the last edits. */
export interface Transition {
  type: TransitionType;
  /** Seconds: the easing's length, or the time spring's visual duration. */
  duration: number;
  ease: Bezier;
  /** Time spring: 0 = no overshoot, 1 = springs forever. */
  bounce: number;
  stiffness: number;
  damping: number;
  mass: number;
}

export type LoopKind = 'none' | 'float' | 'bounce' | 'slide' | 'sway' | 'spin' | 'pulse' | 'blink' | 'wiggle' | 'orbit';
export type EnterKind = 'none' | 'fade' | 'rise' | 'drop' | 'left' | 'right' | 'grow' | 'spin';

export interface Motion {
  loop: LoopKind;
  /** Loop strength, in the unit LOOP_UI gives for the kind. */
  amount: number;
  /** Seconds per cycle. */
  period: number;
  /** 0..1 of a cycle, so neighbours can move out of step. */
  phase: number;
  enter: EnterKind;
  /** Entrance offset, in the unit ENTER_UI gives for the kind. */
  distance: number;
  /** Seconds before the entrance starts. */
  delay: number;
  transition: Transition;
  /** Groups: seconds between children. 0 moves the group as one; more moves each child about its own centre, one after another. */
  stagger: number;
}

export const EASES: { label: string; value: Bezier }[] = [
  { label: 'Ease out', value: [0.16, 1, 0.3, 1] },
  { label: 'Ease in out', value: [0.65, 0, 0.35, 1] },
  { label: 'Ease in', value: [0.7, 0, 0.84, 0] },
  { label: 'Linear', value: [0, 0, 1, 1] },
  { label: 'Back out', value: [0.34, 1.56, 0.64, 1] },
];

export const DEFAULT_TRANSITION: Transition = { type: 'time', duration: 0.6, ease: [0.16, 1, 0.3, 1], bounce: 0.25, stiffness: 200, damping: 20, mass: 1 };

export interface Range {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

/** What a loop's Amount means for each kind. */
export const LOOP_UI: Record<Exclude<LoopKind, 'none'>, Range> = {
  float: { label: 'Height', unit: 'px', min: 0, max: 200, step: 1, default: 16 },
  bounce: { label: 'Height', unit: 'px', min: 0, max: 300, step: 1, default: 40 },
  slide: { label: 'Distance', unit: 'px', min: -600, max: 600, step: 1, default: 80 },
  sway: { label: 'Angle', unit: '°', min: 0, max: 90, step: 0.5, default: 8 },
  spin: { label: 'Turns', unit: '×', min: -4, max: 4, step: 1, default: 1 },
  pulse: { label: 'Grow', unit: '%', min: 0, max: 100, step: 1, default: 10 },
  blink: { label: 'Fade', unit: '%', min: 0, max: 100, step: 1, default: 70 },
  wiggle: { label: 'Amount', unit: 'px', min: 0, max: 100, step: 1, default: 8 },
  orbit: { label: 'Radius', unit: 'px', min: 0, max: 400, step: 1, default: 30 },
};

/** What an entrance's Distance means for each kind (fade has none). */
export const ENTER_UI: Record<Exclude<EnterKind, 'none' | 'fade'>, Range> = {
  rise: { label: 'Distance', unit: 'px', min: 0, max: 1200, step: 1, default: 80 },
  drop: { label: 'Distance', unit: 'px', min: 0, max: 1200, step: 1, default: 80 },
  left: { label: 'Distance', unit: 'px', min: 0, max: 1200, step: 1, default: 120 },
  right: { label: 'Distance', unit: 'px', min: 0, max: 1200, step: 1, default: 120 },
  grow: { label: 'From', unit: '%', min: 0, max: 200, step: 1, default: 40 },
  spin: { label: 'Angle', unit: '°', min: -360, max: 360, step: 1, default: -90 },
};

export const LOOP_OPTIONS: { value: LoopKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'float', label: 'Float' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'slide', label: 'Slide' },
  { value: 'sway', label: 'Sway' },
  { value: 'spin', label: 'Spin' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'blink', label: 'Blink' },
  { value: 'wiggle', label: 'Wiggle' },
  { value: 'orbit', label: 'Orbit' },
];

export const ENTER_OPTIONS: { value: EnterKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade in' },
  { value: 'rise', label: 'Rise' },
  { value: 'drop', label: 'Drop' },
  { value: 'left', label: 'From left' },
  { value: 'right', label: 'From right' },
  { value: 'grow', label: 'Grow' },
  { value: 'spin', label: 'Spin in' },
];

export function newMotion(over: Partial<Motion> = {}): Motion {
  return { loop: 'none', amount: 16, period: 2, phase: 0, enter: 'none', distance: 80, delay: 0, transition: { ...DEFAULT_TRANSITION }, stagger: 0, ...over };
}

export const isStill = (m: Motion | undefined | null) => !m || (m.loop === 'none' && m.enter === 'none');

// ---------- transitions ----------

/** Cubic Bézier easing (CSS cubic-bezier) at progress `u` in 0..1. */
export function bezierAt([x1, y1, x2, y2]: Bezier, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const curve = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
  // Newton first; bisection when the slope flattens.
  let s = u;
  for (let i = 0; i < 8; i++) {
    const d = slope(x1, x2, s);
    if (Math.abs(d) < 1e-6) break;
    const next = s - (curve(x1, x2, s) - u) / d;
    if (next < 0 || next > 1) break;
    s = next;
  }
  if (Math.abs(curve(x1, x2, s) - u) > 1e-5) {
    let [lo, hi] = [0, 1];
    for (let i = 0; i < 40; i++) {
      s = (lo + hi) / 2;
      if (curve(x1, x2, s) < u) lo = s;
      else hi = s;
    }
  }
  return curve(y1, y2, s);
}

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

/** Physical constants for a spring transition (Motion's mapping for time springs). */
export function springOf(t: Transition): SpringParams {
  if (t.type === 'physics') return { stiffness: Math.max(1e-3, t.stiffness), damping: Math.max(0, t.damping), mass: Math.max(1e-3, t.mass) };
  const root = (2 * Math.PI) / (Math.max(0.05, t.duration) * 1.2);
  const stiffness = root * root;
  return { stiffness, damping: 2 * Math.min(1, Math.max(0.05, 1 - t.bounce)) * Math.sqrt(stiffness), mass: 1 };
}

/** A spring released at rest from 0 toward 1, at `t` seconds (closed form). */
export function springAt({ stiffness, damping, mass }: SpringParams, t: number): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 0.9999) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta <= 1.0001) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(zeta * zeta - 1);
  const [r1, r2] = [-w0 * (zeta - s), -w0 * (zeta + s)];
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

/** Seconds until the transition has (visibly) arrived. */
export function settleTime(t: Transition): number {
  if (t.type === 'easing') return Math.max(0, t.duration);
  const { stiffness, damping, mass } = springOf(t);
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const decay = zeta < 1 ? zeta * w0 : w0 * (zeta - Math.sqrt(zeta * zeta - 1));
  return Math.min(10, Math.max(0.05, Math.log(200) / Math.max(decay, 1e-3)));
}

/** Progress (0 → 1, springs may overshoot) of a transition `t` seconds after it starts. */
export function progressAt(tr: Transition, t: number): number {
  if (t <= 0) return 0;
  if (tr.type === 'easing') return tr.duration <= 0 || t >= tr.duration ? 1 : bezierAt(tr.ease, t / tr.duration);
  return springAt(springOf(tr), t);
}

// ---------- animated material settings ----------

/**
 * A material setting that changes over time: from its value to `to` and back
 * (swing), or from its value to `to` then jumping back (ramp: for angles,
 * shifts and hues that go round).
 */
export interface ParamAnim {
  to: number | string;
  /** Seconds per cycle. */
  period: number;
  phase: number;
  /** Swing there and back, ramp round and round, or flicker: hold a random in-between value, then jump. */
  mode: 'swing' | 'ramp' | 'flicker';
}

const hexRgb = (h: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** How far (0..1) between from and to a setting is at `t`. */
export function animMix(a: ParamAnim, t: number, loopLength?: number): number {
  const u = t / loopPeriod(a.period, loopLength) + a.phase;
  if (a.mode === 'ramp') return u - Math.floor(u);
  if (a.mode === 'flicker') {
    // Four holds per cycle, each a repeatable random step (0, ⅓, ⅔ or 1).
    const n = Math.floor(u * 4) + Math.round(a.phase * 997);
    const h = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return Math.floor((h - Math.floor(h)) * 4) / 3;
  }
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
}

/** The setting's value at `t`: numbers blend, colours blend in RGB. */
export function animatedValue(from: number | string, a: ParamAnim, t: number, loopLength?: number): number | string {
  const k = animMix(a, t, loopLength);
  if (typeof from === 'string' || typeof a.to === 'string') {
    const [p, q] = [hexRgb(String(from)), hexRgb(String(a.to))];
    return rgbHex(p.map((v, i) => v + (q[i] - v) * k));
  }
  return from + (a.to - from) * k;
}

// ---------- poses ----------

/** Offset from rest: move (px), turn (degrees), scale and opacity factors. */
export interface Pose {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  opacity: number;
}

export const REST: Pose = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 };

/**
 * A loop's period, adjusted so a looping timeline of `loopLength` seconds
 * holds a whole number of cycles (the end meets the start).
 */
export function loopPeriod(period: number, loopLength?: number): number {
  const p = Math.max(0.05, period);
  if (!loopLength || loopLength <= 0) return p;
  return loopLength / Math.max(1, Math.round(loopLength / p));
}

function loopPose(m: Motion, t: number, loopLength?: number): Pose {
  const A = m.amount;
  const u = t / loopPeriod(m.period, loopLength) + m.phase;
  const s = Math.sin(2 * Math.PI * u);
  const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
  const p = { ...REST };
  switch (m.loop) {
    case 'float':
      p.y = -A * s;
      break;
    case 'bounce':
      p.y = -A * Math.abs(Math.sin(Math.PI * u));
      break;
    case 'slide':
      p.x = A * s;
      break;
    case 'sway':
      p.rotate = A * s;
      break;
    case 'spin':
      p.rotate = 360 * Math.round(A) * (u - Math.floor(u));
      break;
    case 'pulse':
      p.scale = 1 + (A / 100) * wave;
      break;
    case 'blink':
      p.opacity = 1 - Math.min(1, A / 100) * wave;
      break;
    case 'wiggle': {
      // Whole-number harmonics, so it loops cleanly.
      const h = (k: number, o: number) => Math.sin(2 * Math.PI * (k * u + o));
      p.x = A * (0.6 * h(1, 0) + 0.4 * h(3, 0.21));
      p.y = A * (0.6 * h(2, 0.37) + 0.4 * h(1, 0.71));
      p.rotate = A * 0.12 * h(2, 0.53);
      break;
    }
    case 'orbit':
      p.x = A * s;
      p.y = -A * Math.cos(2 * Math.PI * u);
      break;
  }
  return p;
}

function enterPose(m: Motion, t: number): Pose {
  const k = progressAt(m.transition, t - m.delay);
  const left = 1 - k;
  const D = m.distance;
  const p = { ...REST, opacity: Math.min(1, Math.max(0, k)) };
  switch (m.enter) {
    case 'rise':
      p.y = D * left;
      break;
    case 'drop':
      p.y = -D * left;
      break;
    case 'left':
      p.x = -D * left;
      break;
    case 'right':
      p.x = D * left;
      break;
    case 'grow':
      p.scale = Math.max(0, D / 100 + (1 - D / 100) * k);
      break;
    case 'spin':
      p.rotate = D * left;
      break;
  }
  return p;
}

/** The pose `m` gives at `t` seconds on the clock. */
export function poseAt(m: Motion, t: number, loopLength?: number): Pose {
  const a = m.loop === 'none' ? REST : loopPose(m, t, loopLength);
  const b = m.enter === 'none' ? REST : enterPose(m, t);
  return { x: a.x + b.x, y: a.y + b.y, rotate: a.rotate + b.rotate, scale: a.scale * b.scale, opacity: a.opacity * b.opacity };
}

/** When the entrance has settled (0 without one). */
export const entranceEnd = (m: Motion) => (m.enter === 'none' ? 0 : m.delay + settleTime(m.transition));

// ---------- affine maps ----------

/** [a, b, c, d, e, f]: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** `outer` after `inner`. */
export function compose(outer: Mat, inner: Mat): Mat {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export const applyMat = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A pose as a map of artboard points: scale and turn about `pivot`, then move. */
export function poseMatrix(p: Pose, pivot: [number, number]): Mat {
  const r = (p.rotate * Math.PI) / 180;
  const [c, s] = [Math.cos(r) * p.scale, Math.sin(r) * p.scale];
  const [px, py] = pivot;
  return [c, s, -s, c, px + p.x - (c * px - s * py), py + p.y - (s * px + c * py)];
}

/** One motion acting on a scene object: whose centre it turns about, and how late it runs. */
export interface MotionLink {
  motion: Motion;
  /** Node whose rest centre is the pivot. */
  at: string;
  /** Seconds this object runs behind (a group's stagger). */
  offset: number;
}

/** Farthest (px) any corner of `box` travels from rest over `times`. */
export function motionReach(links: { motion: Motion; pivot: [number, number]; offset: number }[], box: [number, number, number, number], times: number[], loopLength?: number): number {
  const corners: [number, number][] = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ];
  let far = 0;
  for (const t of times) {
    const { m } = placement(links, t, loopLength);
    for (const [x, y] of corners) {
      const [X, Y] = applyMat(m, x, y);
      far = Math.max(far, Math.hypot(X - x, Y - y));
    }
  }
  return Math.ceil(far);
}

/** Where an object is drawn at `t`: its motions, innermost first, about their pivots. */
export function placement(links: { motion: Motion; pivot: [number, number]; offset: number }[], t: number, loopLength?: number): { m: Mat; opacity: number } {
  let m = IDENTITY;
  let opacity = 1;
  for (const l of links) {
    const p = poseAt(l.motion, t - l.offset, loopLength);
    m = compose(poseMatrix(p, l.pivot), m);
    opacity *= p.opacity;
  }
  return { m, opacity };
}
