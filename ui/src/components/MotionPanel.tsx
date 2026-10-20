// Motion controls: a layer's loop and entrance, the transition editor
// (easing, time spring, physics spring) with its curve, after DialKit's
// (MIT, Josh Puckett).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { selectedNodes, updateSelected } from '../app/actions';
import { clock, timelineOf } from '../state/clock';
import { isGroup, type Node } from '../state/model';
import { addStop, EASES, ENTER_OPTIONS, ENTER_UI, entersFading, entranceEnd, feelOf, FEELS, isStill, lastSlot, LEAVE_OPTIONS, LEAVE_UI, leaveEnd, leavesFading, legsOf, LOOP_OPTIONS, LOOP_UI, loopPeriod, newMotion, progressAt, settleTime, STAGGER_ORDERS, thenTransition, type Bezier, type EnterKind, type LeaveKind, type LetterMode, type LoopKind, type Motion, type SlideDir, type StaggerOrder, type Stop, type Transition, type TransitionType } from '../state/motion';
import { edit, store, useStore } from '../state/store';
import { LETTER_ORDERS, pieceCount } from '../state/letters';
import { allLayers, findNode } from '../state/tree';
import { Icon, type IconName } from './icons';
import { NumberBox, Section, Segmented, Select, Slider, Toggle } from './ui';

const W = 256;
const H = 150;

/** Curve of a transition over its settle time, with a dot riding it in real time. */
export function CurveGraph({ t, onEase }: { t: Transition; onEase?: (e: Bezier) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const [drag, setDrag] = useState<0 | 1 | null>(null);
  const span = Math.min(4, Math.max(0.3, settleTime(t) * 1.1));
  const samples = Array.from({ length: 121 }, (_, i) => {
    const s = (i / 120) * span;
    return [s, progressAt(t, s)] as const;
  });
  // Values (overshoot included) fill the middle of the height.
  const lo = Math.min(0, ...samples.map((p) => p[1]), t.type === 'easing' ? Math.min(t.ease[1], t.ease[3]) : 0);
  const hi = Math.max(1, ...samples.map((p) => p[1]), t.type === 'easing' ? Math.max(t.ease[1], t.ease[3]) : 1);
  const pad = 14;
  const X = (s: number) => pad + (s / span) * (W - 2 * pad);
  const Y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const d = samples.map(([s, v], i) => `${i ? 'L' : 'M'}${X(s).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');

  // The dot: plays the transition, waits a beat, again.
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      const s = (((performance.now() - start) / 1000) % (span + 0.6)) - 0.3;
      const c = Math.max(0, Math.min(span, s));
      dot.current?.setAttribute('cx', String(X(c)));
      dot.current?.setAttribute('cy', String(Y(progressAt(t, c))));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  // Easing: handles sit on the same axes as the curve (x = share of the duration).
  const ease = t.type === 'easing' ? t.ease : null;
  const dur = Math.max(0.05, t.duration);
  const hx = (x: number) => X(x * dur);
  const toEase = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    const x = Math.max(0, Math.min(1, (((px - pad) / (W - 2 * pad)) * span) / dur));
    const y = lo + ((H - pad - py) / (H - 2 * pad)) * (hi - lo);
    return [Math.round(x * 100) / 100, Math.round(Math.max(-1, Math.min(2, y)) * 100) / 100];
  };
  return (
    <svg
      ref={svg}
      className="curve-graph"
      viewBox={`0 0 ${W} ${H}`}
      onPointerMove={(e) => {
        if (drag === null || !ease || !onEase) return;
        const [x, y] = toEase(e);
        onEase(drag === 0 ? [x, y, ease[2], ease[3]] : [ease[0], ease[1], x, y]);
      }}
      onPointerUp={() => setDrag(null)}
    >
      {[1, 2, 3].map((i) => (
        <g key={i} className="grid">
          <line x1={(W / 4) * i} y1={0} x2={(W / 4) * i} y2={H} />
          <line x1={0} y1={(H / 4) * i} x2={W} y2={(H / 4) * i} />
        </g>
      ))}
      <line className="target" x1={0} x2={W} y1={Y(1)} y2={Y(1)} />
      <line className="target" x1={0} x2={W} y1={Y(0)} y2={Y(0)} />
      {ease && (
        <g className="handles">
          <line x1={X(0)} y1={Y(0)} x2={hx(ease[0])} y2={Y(ease[1])} />
          <line x1={hx(1)} y1={Y(1)} x2={hx(ease[2])} y2={Y(ease[3])} />
        </g>
      )}
      <path className="curve" d={d} />
      <circle ref={dot} className="dot" r={4} cx={X(0)} cy={Y(0)} />
      {ease &&
        onEase &&
        ([0, 1] as const).map((k) => (
          <circle
            key={k}
            className={`knob ${drag === k ? 'on' : ''}`}
            r={5}
            cx={hx(ease[k * 2])}
            cy={Y(ease[k * 2 + 1])}
            onPointerDown={(e) => {
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              setDrag(k);
            }}
          />
        ))}
    </svg>
  );
}

const fmt = (e: Bezier) => e.map((v) => +v.toFixed(2)).join(', ');

/** Easing, time spring or physics spring, with a live curve. */
export function TransitionEditor({ value, onChange }: { value: Transition; onChange: (t: Transition, key: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const set = (patch: Partial<Transition>, key: string) => onChange({ ...value, ...patch }, key);
  const preset = EASES.find((e) => fmt(e.value) === fmt(value.ease));
  return (
    <div className="transition-editor">
      <CurveGraph t={value} onEase={(ease) => set({ ease }, 'ease')} />
      <div className="dial-row">
        <span>Type</span>
        <Segmented<TransitionType>
          size="sm"
          value={value.type}
          onChange={(type) => set({ type }, '')}
          options={[
            { value: 'easing', label: 'Easing', title: 'A curve over a set time' },
            { value: 'time', label: 'Time', title: 'A spring set by how long it takes and how much it bounces' },
            { value: 'physics', label: 'Physics', title: 'A spring set by stiffness, damping and mass' },
          ]}
        />
      </div>
      {value.type === 'easing' && (
        <>
          <div className="dial-row">
            <span>Curve</span>
            <Select value={preset ? fmt(preset.value) : 'custom'} options={[...EASES.map((e) => ({ value: fmt(e.value), label: e.label })), ...(preset ? [] : [{ value: 'custom', label: 'Custom' }])]} onChange={(v) => v !== 'custom' && set({ ease: EASES.find((e) => fmt(e.value) === v)!.value }, '')} />
          </div>
          <div className="dial-row">
            <span>Ease</span>
            <input
              className="dial-text"
              aria-label="Bézier points"
              spellCheck={false}
              value={text ?? fmt(value.ease)}
              onFocus={() => setText(fmt(value.ease))}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                const n = (text ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
                if (n.length === 4 && n.every(Number.isFinite)) set({ ease: [Math.max(0, Math.min(1, n[0])), n[1], Math.max(0, Math.min(1, n[2])), n[3]] }, '');
                setText(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </>
      )}
      {value.type !== 'physics' && <Slider label="Duration" value={value.duration} min={0.05} max={3} step={0.05} suffix="s" reset={0.6} onChange={(duration) => set({ duration }, 'duration')} />}
      {value.type === 'time' && <Slider label="Bounce" value={value.bounce} min={0} max={1} step={0.05} reset={0.25} onChange={(bounce) => set({ bounce }, 'bounce')} />}
      {value.type === 'physics' && (
        <>
          <Slider label="Stiffness" value={value.stiffness} min={1} max={1000} step={1} reset={200} onChange={(stiffness) => set({ stiffness }, 'stiffness')} />
          <Slider label="Damping" value={value.damping} min={0} max={100} step={0.5} reset={20} onChange={(damping) => set({ damping }, 'damping')} />
          <Slider label="Mass" value={value.mass} min={0.1} max={10} step={0.1} reset={1} onChange={(mass) => set({ mass }, 'mass')} />
        </>
      )}
      <p className="hint">Settles in {settleTime(value).toFixed(2)} s</p>
    </div>
  );
}

/**
 * Put the selection out of step: each layer's motion and animated material
 * and shape settings start a little after the one before (in order, a ripple), or at
 * random (shuffle: a flicker across a grid of tiles).
 */
export function staggerSelection(order: 'ripple' | 'shuffle' = 'ripple', step = 0.08) {
  const ids = selectedNodes().map((n) => n.id);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  edit((p) => {
    ids.forEach((id, i) => {
      const n = findNode(p.layers, id);
      if (!n) return;
      const f = order === 'shuffle' ? Math.random() : i / ids.length;
      if (n.motion) {
        n.motion.delay = r2(order === 'shuffle' ? f * step * ids.length : i * step);
        n.motion.phase = r2(f);
      }
      const targets = isGroup(n) && !n.merge ? allLayers(n.children) : [n];
      for (const t of targets) for (const a of [...Object.values(t.style.animate ?? {}), ...Object.values(t.animate ?? {})]) a.phase = r2(f);
    });
  });
}

/** Any selected layer (or one inside a selected group) that moves or has animated settings. */
const anyMoving = (nodes: Node[]) => nodes.some((n) => !isStill(n.motion) || Object.keys(n.animate ?? {}).length > 0 || (isGroup(n) ? allLayers(n.children) : [n]).some((l) => Object.keys(l.style.animate ?? {}).length > 0 || Object.keys(l.animate ?? {}).length > 0));

// ---------- Simple / Advanced ----------
// Simple shows what most motion needs: what it does, how far, when, and a
// named feel. Advanced adds curves and springs, offsets, fades and order.
// The choice is remembered per viewer and shared by every motion control.

const ADV = 'morphotype.motionAdvanced';
let advanced = (() => {
  try {
    return localStorage.getItem(ADV) === '1';
  } catch {
    return false;
  }
})();
const advSubs = new Set<() => void>();
export function setMotionAdvanced(v: boolean) {
  advanced = v;
  try {
    localStorage.setItem(ADV, v ? '1' : '0');
  } catch {
    // Not remembered, still works.
  }
  advSubs.forEach((f) => f());
}
export const useMotionAdvanced = () =>
  useSyncExternalStore(
    (f) => {
      advSubs.add(f);
      return () => void advSubs.delete(f);
    },
    () => advanced,
  );

/** The Simple / Advanced switch. */
export function AdvancedSwitch() {
  const adv = useMotionAdvanced();
  return (
    <button className={`adv-chip ${adv ? 'on' : ''}`} aria-pressed={adv} onClick={() => setMotionAdvanced(!adv)} data-tip={adv ? 'Hide curves, springs, offsets and order' : 'Show curves, springs, offsets and order'}>
      Advanced
    </button>
  );
}

/**
 * A cycle length. On a looping timeline only whole numbers of cycles fit, so
 * the slider steps through those (6 s loop: 6, 3, 2, 1.5 s…) and shows the
 * cycle that really plays: every move changes what you see.
 */
export function CycleSlider({ value, onChange, label = 'Cycle', max = 12, reset = 2 }: { value: number; onChange: (v: number) => void; label?: string; max?: number; reset?: number }) {
  const tl = useStore((s) => timelineOf(s.project));
  const L = tl.loop ? tl.duration : undefined;
  const fit = (v: number) => Math.round(loopPeriod(v, L) * 1000) / 1000;
  return <Slider label={label} value={fit(value)} min={0.2} max={L ? Math.min(max, L) : max} step={0.01} suffix="s" reset={fit(reset)} onChange={(v) => onChange(fit(v))} />;
}

/** Simple timing: a named feel and how long it takes. */
export function FeelPicker({ value, onChange }: { value: Transition; onChange: (t: Transition, key: string) => void }) {
  const feel = feelOf(value);
  return (
    <>
      <div className="dial-row">
        <span>Feel</span>
        <Segmented<string>
          size="sm"
          value={feel ?? ''}
          options={FEELS.map((f) => ({ value: f.label, label: f.label, title: f.title }))}
          onChange={(label) => {
            const f = FEELS.find((x) => x.label === label)!;
            onChange({ ...f.value }, '');
          }}
        />
      </div>
      {!feel && <p className="hint">A custom curve: switch on Advanced to edit it.</p>}
      {value.type !== 'physics' && <Slider label="Takes" value={value.duration} min={0.05} max={3} step={0.05} suffix="s" reset={0.6} onChange={(duration) => onChange({ ...value, duration }, 'duration')} />}
    </>
  );
}

type SetMotion = (fn: (m: Motion) => void, key?: string) => void;

/** Seconds and frame: "1.20 s · f36". */
const at = (t: number) => `${t.toFixed(2)} s · frame ${Math.round(t * 30)}`;

/** Entrance: what it does, from where, when and how. */
export function EnterControls({ m, set, onPick }: { m: Motion; set: SetMotion; onPick?: () => void }) {
  const adv = useMotionAdvanced();
  const ui = m.enter !== 'none' && m.enter !== 'fade' && m.enter !== 'move' ? ENTER_UI[m.enter] : null;
  return (
    <>
      <div className="dial-row">
        <span>Enter</span>
        <Select<EnterKind>
          value={m.enter}
          options={ENTER_OPTIONS}
          onChange={(v) => {
            set((x) => {
              x.enter = v;
              if (v !== 'none' && v !== 'fade' && v !== 'move') x.distance = ENTER_UI[v].default;
              // Move: start a little to the left, so there's something to see and drag.
              if (v === 'move' && !x.fromX && !x.fromY) x.fromX = -200;
            });
            if (v !== 'none') onPick?.();
          }}
        />
      </div>
      {m.enter === 'move' && (
        <>
          <div className="xy-row">
            <span>From</span>
            <NumberBox label="X" value={m.fromX ?? 0} onChange={(v) => set((x) => (x.fromX = v), 'fromX')} title="Where it starts, across from its place (px)" />
            <NumberBox label="Y" value={m.fromY ?? 0} onChange={(v) => set((x) => (x.fromY = v), 'fromY')} title="Where it starts, down from its place (px)" />
          </div>
          <p className="hint">It ends where it is in the design. Drag the dashed copy on the canvas to set where it starts.</p>
        </>
      )}
      {ui && <Slider label={ui.label} value={m.distance} min={ui.min} max={ui.max} step={ui.step} suffix={ui.unit === 'px' ? '' : ui.unit} reset={ui.default} onChange={(v) => set((x) => (x.distance = v), 'distance')} />}
      {m.enter !== 'none' && (
        <>
          <Slider label="Starts at" value={m.delay} min={0} max={10} step={0.05} suffix="s" reset={0} onChange={(v) => set((x) => (x.delay = v), 'delay')} />
          {adv ? <TransitionEditor value={m.transition} onChange={(t, key) => set((x) => (x.transition = t), key && `tr.${key}`)} /> : <FeelPicker value={m.transition} onChange={(t, key) => set((x) => (x.transition = t), key && `tr.${key}`)} />}
          {adv && m.enter !== 'fade' && <Toggle label="Fade in too" checked={entersFading(m)} onChange={(v) => set((x) => (x.fade = v))} />}
          <p className="hint">In place by {at(entranceEnd(m))}.</p>
        </>
      )}
    </>
  );
}

/** Then: after arriving, it moves on or leaves; a Move to… can go on through more stops (`stops`: list them here). */
export function ThenControls({ m, set, onPick, stops = true }: { m: Motion; set: SetMotion; onPick?: () => void; stops?: boolean }) {
  const adv = useMotionAdvanced();
  const kind = m.leave ?? 'none';
  const ui = kind !== 'none' && kind !== 'fade' && kind !== 'move' ? LEAVE_UI[kind] : null;
  const own = !!m.leaveTransition;
  const tr = m.leaveTransition ?? m.transition;
  const setTr = (t: Transition, key: string) => set((x) => (own || x.enter === 'none' ? (own ? (x.leaveTransition = t) : (x.transition = t)) : (x.leaveTransition = t)), key && `then.${key}`);
  return (
    <>
      <div className="dial-row">
        <span>Then</span>
        <Select<LeaveKind>
          value={kind}
          options={LEAVE_OPTIONS}
          onChange={(v) => {
            set((x) => {
              x.leave = v;
              if (v !== 'none' && v !== 'fade' && v !== 'move') x.leaveDistance = LEAVE_UI[v].default;
              if (v === 'move' && !x.toX && !x.toY) x.toX = 200;
              // A beat after it has arrived.
              if (v !== 'none' && x.leaveAt === undefined) x.leaveAt = Math.round((entranceEnd(x) + 1) * 20) / 20;
            });
            if (v !== 'none') onPick?.();
          }}
        />
      </div>
      {kind === 'move' && (
        <>
          <div className="xy-row">
            <span>To</span>
            <NumberBox label="X" value={m.toX ?? 0} onChange={(v) => set((x) => (x.toX = v), 'toX')} title="Where it goes, across from its place (px)" />
            <NumberBox label="Y" value={m.toY ?? 0} onChange={(v) => set((x) => (x.toY = v), 'toY')} title="Where it goes, down from its place (px)" />
          </div>
          <p className="hint">{m.stops?.length ? 'Then on through each stop below.' : 'It stays there.'} Drag the dashed copy on the canvas to move where it goes.</p>
        </>
      )}
      {ui && <Slider label={ui.label} value={m.leaveDistance ?? ui.default} min={ui.min} max={ui.max} step={ui.step} suffix={ui.unit === 'px' ? '' : ui.unit} reset={ui.default} onChange={(v) => set((x) => (x.leaveDistance = v), 'leaveDistance')} />}
      {kind !== 'none' && (
        <>
          <Slider label="At" value={m.leaveAt ?? 0} min={0} max={20} step={0.05} suffix="s" reset={Math.round((entranceEnd(m) + 1) * 20) / 20} onChange={(v) => set((x) => (x.leaveAt = v), 'leaveAt')} />
          {/* Simple: Then shares the entrance's feel unless there's no entrance. */}
          {adv ? (
            <>
              {m.enter !== 'none' && <Toggle label="Its own curve" checked={own} onChange={(v) => set((x) => (v ? (x.leaveTransition = { ...x.transition }) : delete x.leaveTransition))} hint="Off: it moves with the entrance's curve" />}
              {(own || m.enter === 'none') && <TransitionEditor value={tr} onChange={setTr} />}
              {kind !== 'fade' && <Toggle label="Fade out too" checked={leavesFading(m)} onChange={(v) => set((x) => (x.leaveFade = v))} />}
            </>
          ) : (
            m.enter === 'none' && <FeelPicker value={tr} onChange={setTr} />
          )}
          <p className="hint">Done by {at(leaveEnd(m))}.</p>
        </>
      )}
      {kind === 'move' && (
        <>
          {stops && m.stops?.map((_, i) => <StopControls key={i} m={m} index={i} set={set} />)}
          <button className="btn small add-stop" onClick={() => set((x) => void addStop(x))} data-tip="Then move on again, to one more spot">
            <Icon name="plus" size={12} /> Add a stop
          </button>
        </>
      )}
    </>
  );
}

/** One stop after Then's Move to…: where, how long it waits first, and how it gets there (`onRemove`: on its own, in the timeline's editor). */
export function StopControls({ m, index: i, set, onRemove }: { m: Motion; index: number; set: SetMotion; onRemove?: () => void }) {
  const adv = useMotionAdvanced();
  const s = m.stops?.[i];
  if (!s) return null;
  const tr = s.transition ?? thenTransition(m);
  const leg = legsOf(m)[i + 1];
  const setStop = (fn: (s: Stop) => void, key = '') => set((x) => x.stops?.[i] && fn(x.stops[i]), key && `stop${i}.${key}`);
  const remove = () => {
    set((x) => {
      x.stops?.splice(i, 1);
      if (!x.stops?.length) delete x.stops;
    });
    onRemove?.();
  };
  return (
    <div className="stop-controls">
      {!onRemove && (
        <h4 className="motion-step">
          Stop {i + 2}
          <button className="icon-btn" aria-label={`Remove stop ${i + 2}`} data-tip="Remove this stop" onClick={remove}>
            <Icon name="close" size={12} />
          </button>
        </h4>
      )}
      <div className="xy-row">
        <span>To</span>
        <NumberBox label="X" value={s.x} onChange={(v) => setStop((t) => (t.x = v), 'x')} title="Where it goes next, across from its place (px)" />
        <NumberBox label="Y" value={s.y} onChange={(v) => setStop((t) => (t.y = v), 'y')} title="Where it goes next, down from its place (px)" />
      </div>
      <Slider label="Waits" value={s.hold ?? 0} min={0} max={5} step={0.05} suffix="s" reset={0} onChange={(v) => setStop((t) => (t.hold = v), 'hold')} />
      {adv ? (
        <>
          <Toggle label="Its own curve" checked={!!s.transition} onChange={(v) => setStop((t) => (v ? (t.transition = { ...thenTransition(m) }) : delete t.transition))} hint="Off: it moves with Then's curve" />
          {s.transition && <TransitionEditor value={tr} onChange={(t, key) => setStop((x) => (x.transition = t), key && `tr.${key}`)} />}
        </>
      ) : (
        <FeelPicker value={tr} onChange={(t, key) => setStop((x) => (x.transition = t), key && `tr.${key}`)} />
      )}
      {leg && <p className="hint">Sets off at {at(leg.start)}, there by {at(leg.end)}.</p>}
      {onRemove && (
        <button className="btn tl-remove" onClick={remove}>
          Remove stop
        </button>
      )}
    </div>
  );
}

const DIRS: { value: SlideDir; label?: string; icon: IconName; title: string }[] = [
  { value: 'left', icon: 'arrowLeft', title: 'To the left' },
  { value: 'right', icon: 'arrowRight', title: 'To the right' },
  { value: 'up', icon: 'arrowUp', title: 'Up' },
  { value: 'down', icon: 'arrowDown', title: 'Down' },
];

/** Loop: what it does, how much and how often. */
export function LoopControls({ m, set }: { m: Motion; set: SetMotion }) {
  const adv = useMotionAdvanced();
  const ui = m.loop !== 'none' ? LOOP_UI[m.loop] : null;
  const slide = m.loop === 'slide';
  return (
    <>
      <div className="dial-row">
        <span>Loop</span>
        <Select<LoopKind>
          value={m.loop}
          options={LOOP_OPTIONS}
          onChange={(v) =>
            set((x) => {
              x.loop = v;
              if (v !== 'none') x.amount = LOOP_UI[v].default;
              // A new slide goes one way, left: a conveyor (Back and forth is one click away).
              if (v === 'slide' && x.dir === undefined) {
                x.dir = 'left';
                x.oneWay = true;
              }
            })
          }
        />
      </div>
      {slide && (
        <>
          <div className="dial-row">
            <span>Way</span>
            <Segmented<SlideDir> size="sm" value={m.dir ?? 'right'} options={DIRS} onChange={(dir) => set((x) => (x.dir = dir))} />
          </div>
          <div className="dial-row">
            <span>Style</span>
            <Segmented<'one' | 'both'>
              size="sm"
              value={m.oneWay ? 'one' : 'both'}
              options={[
                { value: 'one', label: 'One way', title: 'Goes Distance along, then starts again from its place: a conveyor, a ticker' },
                { value: 'both', label: 'Back & forth', title: 'There and back again, easing at each end' },
              ]}
              onChange={(v) => set((x) => (x.oneWay = v === 'one'))}
            />
          </div>
        </>
      )}
      {ui && <Slider label={ui.label} value={slide ? Math.abs(m.amount) : m.amount} min={slide ? 0 : ui.min} max={ui.max} step={ui.step} suffix={ui.unit === 'px' ? '' : ui.unit} reset={ui.default} onChange={(v) => set((x) => {
        // Older slides used a negative distance for the other way: turn that into a direction.
        if (slide && x.amount < 0) x.dir = x.dir === 'left' ? 'right' : x.dir === 'up' ? 'down' : x.dir === 'down' ? 'up' : 'left';
        x.amount = v;
      }, 'amount')} />}
      {ui && <CycleSlider value={m.period} onChange={(v) => set((x) => (x.period = v), 'period')} />}
      {slide && m.oneWay && <p className="hint">For a seamless conveyor, set Distance to the gap between repeating items.</p>}
      {ui && adv && <Slider label="Offset" value={m.phase} min={0} max={1} step={0.01} reset={0} onChange={(v) => set((x) => (x.phase = v), 'phase')} />}
      {slide && m.oneWay && adv && <Toggle label="Ease each pass" checked={!!m.easePass} onChange={(v) => set((x) => (x.easePass = v))} hint="Off: a steady glide" />}
    </>
  );
}

/** Groups: move as one, or each child in turn. */
export function ChildrenControls({ m, set, count }: { m: Motion; set: SetMotion; count: number }) {
  const adv = useMotionAdvanced();
  const turn = m.stagger > 0;
  return (
    <>
      <div className="dial-row">
        <span>Children</span>
        <Segmented<'one' | 'turn'>
          size="sm"
          value={turn ? 'turn' : 'one'}
          options={[
            { value: 'one', label: 'Together', title: 'The group moves as one' },
            { value: 'turn', label: 'One by one', title: 'Each child moves on its own, a little after the one before: a deal of cards, a wave across bars' },
          ]}
          onChange={(v) => set((x) => (x.stagger = v === 'turn' ? x.stagger || 0.1 : 0), 'stagger')}
        />
      </div>
      {turn && (
        <>
          <Slider label="Gap" value={m.stagger} min={0.01} max={1} step={0.01} suffix="s" reset={0.1} onChange={(v) => set((x) => (x.stagger = v), 'stagger')} />
          {adv && (
            <div className="dial-row">
              <span>Order</span>
              <Segmented<StaggerOrder> size="sm" value={m.order ?? 'first'} options={STAGGER_ORDERS} onChange={(order) => set((x) => (x.order = order))} />
            </div>
          )}
          <p className="hint">
            {count} children, {m.stagger.toFixed(2)} s apart: the last starts {(m.stagger * lastSlot(m.order, count)).toFixed(2)} s after the first.
          </p>
        </>
      )}
    </>
  );
}

/** Text: move as one, or each letter or word in turn about its own centre. */
export function LettersControls({ m, set, text }: { m: Motion; set: SetMotion; text: string }) {
  const adv = useMotionAdvanced();
  const count = m.letters ? pieceCount(text, m.letters) : 0;
  const what = m.letters === 'words' ? (count === 1 ? 'word' : 'words') : count === 1 ? 'letter' : 'letters';
  return (
    <>
      {/* Under the Letters heading, the whole width: three choices with longer names. */}
      <Segmented<'together' | LetterMode>
        size="sm"
        value={m.letters ?? 'together'}
        options={[
          { value: 'together', label: 'Together', title: 'The text moves as one' },
          { value: 'letters', label: 'One by one', title: 'Each letter comes in, moves on and loops on its own, about its own centre, a little after the one before' },
          { value: 'words', label: 'Word by word', title: 'Each word moves on its own, a little after the one before' },
        ]}
        onChange={(v) =>
          set((x) => {
            if (v === 'together') delete x.letters;
            else {
              x.letters = v;
              x.stagger = x.stagger || (v === 'words' ? 0.2 : 0.06);
            }
          }, 'letters')
        }
      />
      {m.letters && adv && (
        <>
          <Slider label="Gap" value={m.stagger} min={0} max={1} step={0.01} suffix="s" reset={m.letters === 'words' ? 0.2 : 0.06} onChange={(v) => set((x) => (x.stagger = v), 'stagger')} />
          <div className="dial-row">
            <span>Order</span>
            <Segmented<StaggerOrder> size="sm" value={m.order ?? 'first'} options={LETTER_ORDERS} onChange={(order) => set((x) => (x.order = order))} />
          </div>
        </>
      )}
      {m.letters && (
        <p className="hint">
          {count} {what}, {m.stagger.toFixed(2)} s apart: the last starts {(m.stagger * lastSlot(m.order, count)).toFixed(2)} s after the first.
        </p>
      )}
    </>
  );
}

/** Loop, entrance, Then and (for groups) children, for the selection (shown for the last one picked). */
export function MotionSection({ nodes }: { nodes: Node[] }) {
  const primary = nodes.at(-1)!;
  const m = primary.motion ?? newMotion();
  const group = isGroup(primary) && !primary.merge;
  const text = !isGroup(primary) && primary.content.type === 'text' ? primary.content.text : null;
  const set: SetMotion = (fn, key = '') =>
    updateSelected((n) => {
      n.motion = n.motion ?? newMotion();
      fn(n.motion);
      if (isStill(n.motion)) delete n.motion;
    }, key && `motion.${key}`);
  const replay = () => clock.replay(timelineOf(store.get().project));
  return (
    <Section
      title="Motion"
      id="motion"
      defaultOpen={!isStill(primary.motion)}
      actions={
        <>
          <AdvancedSwitch />
          {!isStill(primary.motion) && (
            <button className="icon-btn" aria-label="Play from the start" data-tip="Play from the start" onClick={replay}>
              <Icon name="replay" size={14} />
            </button>
          )}
        </>
      }
    >
      <h4 className="motion-step">Comes in</h4>
      <EnterControls m={m} set={set} onPick={replay} />
      <h4 className="motion-step">Then</h4>
      <ThenControls m={m} set={set} onPick={replay} />
      <h4 className="motion-step">Keeps moving</h4>
      <LoopControls m={m} set={set} />
      {group && !isStill(primary.motion) && (
        <>
          <h4 className="motion-step">Children</h4>
          <ChildrenControls m={m} set={set} count={primary.children.length} />
        </>
      )}
      {text !== null && !isStill(primary.motion) && (
        <>
          <h4 className="motion-step">Letters</h4>
          <LettersControls m={m} set={set} text={text} />
        </>
      )}
      {nodes.length > 1 && anyMoving(nodes) && (
        <>
          <h4 className="motion-step">Out of step</h4>
          <div className="button-row">
            <button className="btn" onClick={() => staggerSelection('ripple')} data-tip="Start each selected layer a little later than the one before: a ripple across them">
              <Icon name="wave" /> One by one
            </button>
            <button className="btn" onClick={() => staggerSelection('shuffle')} data-tip="Put each selected layer out of step at random: a flicker across a grid of tiles">
              <Icon name="dots" /> Random
            </button>
          </div>
        </>
      )}
      {isStill(primary.motion) && <p className="hint">Comes in and Then play once each time round; a loop repeats as long as the timeline plays. Group layers to move them one by one.</p>}
    </Section>
  );
}
