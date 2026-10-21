// The scene clock: one time for everything that moves — animated materials
// and layer motion — so playing, pausing, scrubbing and video export agree.
// The timeline's length and looping are saved with the project; whether it's
// playing and where the playhead sits are not.
import type { Project } from './model';

export interface Timeline {
  /** Seconds. */
  duration: number;
  loop: boolean;
}

export const DEFAULT_TIMELINE: Timeline = { duration: 6, loop: true };

export const timelineOf = (p: Project): Timeline => p.timeline ?? DEFAULT_TIMELINE;

let playing = true;
/** Playhead when paused, or where playing started from. */
let base = 0;
let started = performance.now();
/** Bumped on every play, pause and seek, so views can tell the playhead moved. */
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  subs.forEach((f) => f());
};

const raw = () => (playing ? base + (performance.now() - started) / 1000 : base);

/** Clock time on a timeline: wraps when looping, otherwise stops at the end. */
export function timeOn(t: number, tl: Timeline): number {
  const d = Math.max(0.1, tl.duration);
  return tl.loop ? ((t % d) + d) % d : Math.min(Math.max(0, t), d);
}

export const clock = {
  get playing() {
    return playing;
  },
  get version() {
    return version;
  },
  time: (tl: Timeline) => timeOn(raw(), tl),
  /** Still moving: playing, and either looping or not at the end yet. */
  running: (tl: Timeline) => playing && (tl.loop || raw() < tl.duration),
  play(tl: Timeline) {
    if (playing) return;
    base = !tl.loop && base >= tl.duration ? 0 : base;
    started = performance.now();
    playing = true;
    emit();
  },
  pause(tl: Timeline) {
    if (!playing) return;
    base = timeOn(raw(), tl);
    playing = false;
    emit();
  },
  toggle(tl: Timeline) {
    if (playing) clock.pause(tl);
    else clock.play(tl);
  },
  seek(t: number) {
    base = Math.max(0, t);
    started = performance.now();
    emit();
  },
  /** From the top: entrances run again. */
  replay(tl: Timeline) {
    clock.seek(0);
    clock.play(tl);
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};
