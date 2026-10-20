// Motion controls: a layer's loop and entrance, the transition editor
// (easing, time spring, physics spring) with its curve, after DialKit's
// (MIT, Josh Puckett).
import { useEffect, useRef, useState } from 'react';
import { selectedNodes, updateSelected } from '../app/actions';
import { clock, timelineOf } from '../state/clock';
import { isGroup, type Node } from '../state/model';
import { EASES, ENTER_OPTIONS, ENTER_UI, isStill, LOOP_OPTIONS, LOOP_UI, newMotion, progressAt, settleTime, type Bezier, type EnterKind, type LoopKind, type Motion, type Transition, type TransitionType } from '../state/motion';
import { edit, store } from '../state/store';
import { allLayers, findNode } from '../state/tree';
import { Icon } from './icons';
import { Section, Segmented, Select, Slider } from './ui';

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

/** Loop and entrance for the selection (shown for the last one picked). */
export function MotionSection({ nodes }: { nodes: Node[] }) {
  const primary = nodes.at(-1)!;
  const m = primary.motion ?? newMotion();
  const group = isGroup(primary) && !primary.merge;
  const set = (fn: (m: Motion) => void, key = '') =>
    updateSelected((n) => {
      n.motion = n.motion ?? newMotion();
      fn(n.motion);
      if (isStill(n.motion)) delete n.motion;
    }, key && `motion.${key}`);
  const replay = () => clock.replay(timelineOf(store.get().project));
  const loop = m.loop !== 'none' ? LOOP_UI[m.loop] : null;
  const enter = m.enter !== 'none' && m.enter !== 'fade' ? ENTER_UI[m.enter] : null;
  return (
    <Section
      title="Motion"
      id="motion"
      defaultOpen={!isStill(primary.motion)}
      actions={
        !isStill(primary.motion) && (
          <button className="icon-btn" aria-label="Play from the start" data-tip="Play from the start" onClick={replay}>
            <Icon name="replay" size={14} />
          </button>
        )
      }
    >
      <div className="dial-row">
        <span>Loop</span>
        <Select<LoopKind>
          value={m.loop}
          options={LOOP_OPTIONS}
          onChange={(v) =>
            set((x) => {
              x.loop = v;
              if (v !== 'none') x.amount = LOOP_UI[v].default;
            })
          }
        />
      </div>
      {loop && (
        <>
          <Slider label={loop.label} value={m.amount} min={loop.min} max={loop.max} step={loop.step} suffix={loop.unit === 'px' ? '' : loop.unit} reset={loop.default} onChange={(v) => set((x) => (x.amount = v), 'amount')} />
          <Slider label="Cycle" value={m.period} min={0.2} max={12} step={0.1} suffix="s" reset={2} onChange={(v) => set((x) => (x.period = v), 'period')} />
          <Slider label="Offset" value={m.phase} min={0} max={1} step={0.01} reset={0} onChange={(v) => set((x) => (x.phase = v), 'phase')} />
        </>
      )}
      <div className="dial-row">
        <span>Enter</span>
        <Select<EnterKind>
          value={m.enter}
          options={ENTER_OPTIONS}
          onChange={(v) => {
            set((x) => {
              x.enter = v;
              if (v !== 'none' && v !== 'fade') x.distance = ENTER_UI[v].default;
            });
            if (v !== 'none') replay();
          }}
        />
      </div>
      {m.enter !== 'none' && (
        <>
          {enter && <Slider label={enter.label} value={m.distance} min={enter.min} max={enter.max} step={enter.step} suffix={enter.unit === 'px' ? '' : enter.unit} reset={enter.default} onChange={(v) => set((x) => (x.distance = v), 'distance')} />}
          <Slider label="Delay" value={m.delay} min={0} max={10} step={0.05} suffix="s" reset={0} onChange={(v) => set((x) => (x.delay = v), 'delay')} />
          <TransitionEditor value={m.transition} onChange={(t, key) => set((x) => (x.transition = t), key && `tr.${key}`)} />
        </>
      )}
      {group && !isStill(primary.motion) && <Slider label="Stagger" value={m.stagger} min={0} max={1} step={0.01} suffix="s" reset={0} onChange={(v) => set((x) => (x.stagger = v), 'stagger')} />}
      {group && !isStill(primary.motion) && <p className="hint">{m.stagger > 0 ? 'Each child moves on its own, one after another: a wave across rows of bars, a deal of cards.' : 'The group moves as one. Stagger moves each child in turn.'}</p>}
      {nodes.length > 1 && anyMoving(nodes) && (
        <div className="button-row">
          <button className="btn" onClick={() => staggerSelection('ripple')} data-tip="Start each selected layer a little later than the one before: a ripple across them">
            <Icon name="wave" /> Ripple
          </button>
          <button className="btn" onClick={() => staggerSelection('shuffle')} data-tip="Put each selected layer out of step at random: a flicker across a grid of tiles">
            <Icon name="dots" /> Shuffle
          </button>
        </div>
      )}
      {isStill(primary.motion) && <p className="hint">A loop repeats for as long as the timeline plays; an entrance plays once each time round.</p>}
    </Section>
  );
}
