import { useSyncExternalStore } from 'react';
import { clock, timelineOf } from '../state/clock';
import { KEY_SNAP, keyAt, nextKey, onFrame, prevKey, setKey } from '../state/keys';
import { keyedValue, type Key, type ParamAnim } from '../state/motion';
import { store, useStore } from '../state/store';
import { ColorField } from './ColorPicker';
import { Icon } from './icons';
import { CycleSlider } from './MotionPanel';
import { Segmented, Slider } from './ui';

/** Turn a setting's animation on (from `init`), change it, or off (null). */
export type SetAnimOf = (fn: ((a: ParamAnim) => void) | null, init?: ParamAnim) => void;

/** Change a setting's keys: edit them in place, return new ones, or null to clear them (see keys.ts updateKeys). */
export type SetKeysOf = (fn: (keys: Key[]) => Key[] | null | void) => void;

/** The playhead: re-renders on play, pause and seek (not every frame while playing). */
export function usePlayhead(): number {
  const tl = useStore((s) => timelineOf(s.project));
  useSyncExternalStore(clock.subscribe, () => clock.version);
  return clock.time(tl);
}

/** What a setting shows: its keys' value at the playhead, or its own. */
export function useKeyed<T extends number | string>(keys: Key[] | undefined, value: T): T {
  const t = usePlayhead();
  return keys?.length ? (keyedValue(keys, t) as T) : value;
}

const pauseAt = (t: number) => {
  const tl = timelineOf(store.get().project);
  clock.pause(tl);
  clock.seek(t);
};

/**
 * ‹ ◆ › for one property, as in Figma: ◆ keys its value at the playhead (a
 * new key, or the one there), ⌥-click removes the key there; the arrows,
 * shown once it has keys, jump to the key before or after.
 */
export function KeyButtons({ label, keys, value, set }: { label: string; keys: Key[] | undefined; value: number | string; set: SetKeysOf }) {
  const t = usePlayhead();
  const keyed = !!keys?.length;
  const on = keyAt(keys, t) >= 0;
  // While playing, the playhead has moved on since this rendered: look at click time.
  const now = () => clock.time(timelineOf(store.get().project));
  const [prev, next] = clock.playing ? [true, true] : [prevKey(keys, t), nextKey(keys, t)];
  const tip = on ? `${label} has a key here: click to set it, ⌥-click to remove it` : keyed ? `Add a ${label} key at the playhead` : `Key ${label}: start keys at the playhead`;
  return (
    <span className="key-buttons">
      {keyed && (
        <button className="keyframe step" disabled={!prev} aria-label={`Previous ${label} key`} data-tip="Previous key" onClick={() => pauseAt((prevKey(keys, now()) ?? keys![0]).t)}>
          <Icon name="chevronLeft" size={10} />
        </button>
      )}
      <button
        className={`keyframe ${keyed ? 'keyed' : ''} ${on ? 'at' : ''}`}
        aria-pressed={on}
        aria-label={`Key ${label}`}
        data-tip={tip}
        onClick={(e) => {
          // Stop on the frame the key goes on, so it's the one shown.
          const at = onFrame(now());
          pauseAt(at);
          if (e.altKey && on) set((ks) => ks.filter((k) => Math.abs(k.t - at) >= KEY_SNAP));
          // Keyed, its value there (the one shown may be from a moment ago, while playing).
          else set((ks) => setKey(ks, at, keys?.length ? keyedValue(keys, at) : value));
        }}
      >
        <Icon name="keyframe" size={11} />
      </button>
      {keyed && (
        <button className="keyframe step" disabled={!next} aria-label={`Next ${label} key`} data-tip="Next key" onClick={() => pauseAt((nextKey(keys, now()) ?? keys![keys!.length - 1]).t)}>
          <Icon name="chevronRight" size={10} />
        </button>
      )}
    </span>
  );
}

/**
 * A setting that can move on the scene clock, two ways: keys (◆, see
 * KeyButtons) at any times with any values, or a cycle (↻) between its own
 * value and To, swinging back and forth, ramping round or flickering. The two
 * are exclusive: a key drops the cycle, a cycle drops the keys. Used for
 * materials, modifiers and shapes.
 */
export function Keyframed({ label, anim, from, color, range, start, set, keys, setKeys, children }: { label: string; anim: ParamAnim | undefined; from: number | string; color?: boolean; range: { min: number; max: number; step: number }; start?: Partial<ParamAnim>; set: SetAnimOf; keys?: Key[]; setKeys?: SetKeysOf; children: React.ReactNode }) {
  const shown = useKeyed(keys, from);
  const toggle = () => {
    if (anim) return set(null);
    // A sensible far end: the other half of the range, or a contrasting colour.
    const to = color ? (String(from).toLowerCase() === '#111111' ? '#f4f1ea' : '#111111') : (() => {
      const v = Number(from);
      const span = range.max - range.min;
      return Math.round((v + span * 0.25 <= range.max ? v + span * 0.25 : v - span * 0.25) / range.step) * range.step;
    })();
    set(() => undefined, { to, period: 2, phase: 0, mode: 'swing', ...start });
    clock.play(timelineOf(store.get().project));
  };
  const keyed = !!keys?.length;
  return (
    <div className={`animatable ${anim ? 'on' : ''}`}>
      <div className="animatable-row">
        {children}
        <span className="key-buttons">
          {setKeys && <KeyButtons label={label} keys={keys} value={shown} set={setKeys} />}
          <button className={`keyframe cycle ${anim ? 'on' : ''}`} aria-pressed={!!anim} aria-label={`Animate ${label}`} data-tip={anim ? `Stop ${label} cycling` : keyed ? `Cycle ${label} on its own instead of its keys` : `Cycle ${label}: to and fro on its own`} onClick={toggle}>
            <Icon name="repeat" size={11} />
          </button>
        </span>
      </div>
      {anim && (
        <div className="anim-sub">
          {color ? (
            <ColorField label="To" value={String(anim.to)} onChange={(v) => set((x) => (x.to = v))} />
          ) : (
            <Slider label="To" min={range.min} max={range.max} step={range.step} value={Number(anim.to)} onChange={(v) => set((x) => (x.to = v))} />
          )}
          <CycleSlider value={anim.period} max={20} onChange={(v) => set((x) => (x.period = v))} />
          <Slider label="Offset" min={0} max={1} step={0.01} reset={0} value={anim.phase} onChange={(v) => set((x) => (x.phase = v))} />
          <div className="dial-row">
            <span>Motion</span>
            <Segmented<ParamAnim['mode']>
              size="sm"
              value={anim.mode}
              onChange={(mode) => set((x) => (x.mode = mode))}
              options={[
                { value: 'swing', label: 'Swing', title: 'There and back, easing at each end' },
                { value: 'ramp', label: 'Ramp', title: 'Steadily to To, then round again: for angles, phases, shifts and hues' },
                { value: 'flicker', label: 'Flicker', title: 'Jumps between steps from its value to To, at random: tiles, lights, screens' },
                { value: 'hold', label: 'Hold', title: 'Waits at its value, then goes to To and comes back: a line wiping off and drawing on, a puff, a burst of debris' },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** A field with ‹ ◆ › and no cycle: the transform and opacity. */
export function KeyedField({ label, keys, value, set, children, className = 'animatable-row' }: { label: string; keys: Key[] | undefined; value: number | string; set: SetKeysOf; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      {children}
      <KeyButtons label={label} keys={keys} value={value} set={set} />
    </div>
  );
}
