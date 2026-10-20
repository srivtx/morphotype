// Live geometry on the scene clock. Layers whose modifier or shape settings
// have keyframes (state/geoMotion.ts) are rebuilt at the clock's time while it
// runs: only those renders go to the engine, at most ~30 times a second, one
// at a time; a frame asked for while one is building is dropped, and the next
// one built is for the time it starts at. The outlines go straight to the
// renderer (see Viewport's syncScene), never into the project, undo history
// or autosave. Designs with no moving geometry don't run any of this.
import { engine } from '../engine/client';
import type { RenderOut } from '../engine/types';
import { clock, timelineOf } from '../state/clock';
import { movingDocAt, movingIds } from '../state/geoMotion';
import type { Project } from '../state/model';
import { store } from '../state/store';

const FRAME_MS = 1000 / 30;

export type Outlines = Map<string, RenderOut>;

let overlay: Outlines | null = null;
const subs = new Set<() => void>();
/** Exports hold the live loop while they draw their own frames. */
let held = 0;
let busy = false;
/** A frame was asked for while one was building. */
let again = false;
let raf = 0;
let lastStart = -Infinity;
let moving = new Set<string>();
let seen: Project['layers'] | null = null;

/** Frame timings, for the cost readout and tests. */
export const liveStats = {
  frames: 0,
  dropped: 0,
  /** Summed engine time (worker) and request-to-renderer time, in ms. */
  buildMs: 0,
  roundMs: 0,
  reset() {
    Object.assign(liveStats, { frames: 0, dropped: 0, buildMs: 0, roundMs: 0 });
  },
};

/** Outlines of the moving renders at the current clock time (null: build output as is). */
export const liveOutlines = () => overlay;

export function onLiveOutlines(f: () => void) {
  subs.add(f);
  return () => void subs.delete(f);
}

function publish(next: Outlines | null) {
  if (next === overlay) return;
  overlay = next;
  subs.forEach((f) => f());
}

const loopOf = (p: Project) => {
  const tl = timelineOf(p);
  return { tl, loopLength: tl.loop ? tl.duration : undefined };
};

function refresh() {
  const layers = store.get().project.layers;
  if (layers !== seen) {
    seen = layers;
    moving = movingIds(store.get().project);
  }
}

/** Whether there is moving geometry to show right now. */
function active() {
  const s = store.get();
  return s.ready && moving.size > 0 && !s.settings.reduceMotion;
}

function frame() {
  if (held) return;
  refresh();
  if (!active()) return publish(null);
  if (busy) {
    if (again) liveStats.dropped++;
    again = true;
    return;
  }
  const p = store.get().project;
  const { tl, loopLength } = loopOf(p);
  const doc = movingDocAt(p, clock.time(tl), loopLength, undefined, moving);
  if (!doc) return publish(null);
  busy = true;
  const t0 = performance.now();
  lastStart = t0;
  engine
    .buildExact(doc)
    .then(
      (r) => {
        if (held) return;
        liveStats.frames++;
        liveStats.buildMs += r.ms;
        publish(new Map(r.renders.map((x) => [x.id, x])));
        liveStats.roundMs += performance.now() - t0;
      },
      (e: Error) => console.warn('Live geometry:', e.message),
    )
    .finally(() => {
      busy = false;
      if (again) {
        again = false;
        frame();
      }
    });
}

function tick() {
  raf = 0;
  if (held || !active()) return;
  const { tl } = loopOf(store.get().project);
  if (!clock.running(tl)) return frame();
  if (performance.now() - lastStart >= FRAME_MS - 2) frame();
  raf = requestAnimationFrame(tick);
}

/** Build now, and keep building while the clock runs. */
function kick() {
  frame();
  if (!raf && active()) raf = requestAnimationFrame(tick);
}

/** Follow the project and the clock; returns a stop function. */
export function startLiveGeometry() {
  let last = store.get();
  const offStore = store.subscribe(() => {
    const s = store.get();
    const changed = s.project.layers !== last.project.layers || s.project.timeline !== last.project.timeline || s.settings.reduceMotion !== last.settings.reduceMotion || s.ready !== last.ready || s.fonts !== last.fonts;
    last = s;
    if (!changed) return;
    refresh();
    if (active() || overlay) kick();
  });
  const offClock = clock.subscribe(() => {
    refresh();
    if (active()) kick();
  });
  kick();
  return () => {
    offStore();
    offClock();
    cancelAnimationFrame(raf);
    raf = 0;
  };
}

/**
 * Run an export with the live loop held. Stills draw the design at rest, so
 * the moving outlines are dropped first; video sets its own per frame.
 */
export async function holdLiveGeometry<T>(fn: (show: (o: Outlines | null) => void) => Promise<T>): Promise<T> {
  held++;
  publish(null);
  try {
    return await fn(publish);
  } finally {
    held--;
    if (!held) {
      publish(null);
      kick();
    }
  }
}

/**
 * Moving outlines for each of `times`, built ahead of a video export (null
 * when nothing in the design moves its geometry).
 */
export async function geometryFrames(p: Project, times: number[], quality?: number, progress?: (done: number) => void): Promise<(Outlines | null)[] | null> {
  const ids = movingIds(p);
  // Videos move even with motion paused in the preview, like materials do.
  if (!ids.size) return null;
  const { loopLength } = loopOf(p);
  const out: (Outlines | null)[] = [];
  for (const [i, t] of times.entries()) {
    const doc = movingDocAt(p, t, loopLength, quality, ids);
    out.push(doc ? new Map((await engine.buildExact(doc)).renders.map((x) => [x.id, x])) : null);
    progress?.(i + 1);
  }
  return out;
}
