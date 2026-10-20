import { clock, timelineOf } from '../state/clock';
import type { ParamAnim } from '../state/motion';
import { store } from '../state/store';
import { ColorField } from './ColorPicker';
import { Icon } from './icons';
import { Segmented, Slider } from './ui';

/** Turn a setting's animation on (from `init`), change it, or off (null). */
export type SetAnimOf = (fn: ((a: ParamAnim) => void) | null, init?: ParamAnim) => void;

/**
 * A setting with a keyframe button: turned on, the setting moves between its
 * own value and To on the scene clock, swinging back and forth, ramping round
 * or flickering. Used for materials, modifiers and shapes.
 */
export function Keyframed({ label, anim, from, color, range, start, set, children }: { label: string; anim: ParamAnim | undefined; from: number | string; color?: boolean; range: { min: number; max: number; step: number }; start?: Partial<ParamAnim>; set: SetAnimOf; children: React.ReactNode }) {
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
  return (
    <div className={`animatable ${anim ? 'on' : ''}`}>
      <div className="animatable-row">
        {children}
        <button className={`keyframe ${anim ? 'on' : ''}`} aria-pressed={!!anim} aria-label={`Animate ${label}`} data-tip={anim ? `Stop animating ${label}` : `Animate ${label}`} onClick={toggle}>
          <Icon name="keyframe" size={11} />
        </button>
      </div>
      {anim && (
        <div className="anim-sub">
          {color ? (
            <ColorField label="To" value={String(anim.to)} onChange={(v) => set((x) => (x.to = v))} />
          ) : (
            <Slider label="To" min={range.min} max={range.max} step={range.step} value={Number(anim.to)} onChange={(v) => set((x) => (x.to = v))} />
          )}
          <Slider label="Cycle" min={0.2} max={20} step={0.1} suffix="s" reset={2} value={anim.period} onChange={(v) => set((x) => (x.period = v))} />
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
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
