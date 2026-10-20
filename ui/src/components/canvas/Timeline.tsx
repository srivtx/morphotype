// Timeline bar: shown once anything moves. Play and pause, scrub, the
// timeline's length and looping, and video export.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { exportVideo } from '../../app/actions';
import { effectById } from '../../render/effects';
import { clock, DEFAULT_TIMELINE, timelineOf, type Timeline } from '../../state/clock';
import { entranceEnd, isStill } from '../../state/motion';
import { isGroup, type Node, type Project } from '../../state/model';
import { edit, useStore } from '../../state/store';
import { Icon } from '../icons';

/** Anything on the clock: motion on a node, a moving material or moving geometry. */
export function sceneMoves(p: Project): boolean {
  const any = (ns: Node[]): boolean => ns.some((n) => !isStill(n.motion) || Object.keys(n.style.animate ?? {}).length > 0 || Object.keys(n.animate ?? {}).length > 0 || !!effectById(n.style.effect).animated?.(n.style.params) || (isGroup(n) && any(n.children)));
  return any(p.layers);
}

/** Latest entrance end, so the timeline can be fitted to it. */
function lastEntrance(ns: Node[]): number {
  return Math.max(0, ...ns.map((n) => Math.max(n.motion ? entranceEnd(n.motion) + (isGroup(n) ? n.motion.stagger * Math.max(0, n.children.length - 1) : 0) : 0, isGroup(n) ? lastEntrance(n.children) : 0)));
}

/** Re-render every frame while playing, and on play / pause / seek. */
function useClockTime(tl: Timeline) {
  const [, tick] = useState(0);
  useSyncExternalStore(clock.subscribe, () => clock.playing);
  useEffect(() => {
    if (!clock.playing) return;
    let raf = 0;
    const loop = () => {
      tick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
  return clock.time(tl);
}

export function TimelineBar() {
  const project = useStore((s) => s.project);
  // Nothing moves: no bar, and no per-frame clock ticking either.
  return sceneMoves(project) ? <Bar project={project} /> : null;
}

function Bar({ project }: { project: Project }) {
  const tl = timelineOf(project);
  const t = useClockTime(tl);
  const track = useRef<HTMLDivElement>(null);
  const wasPlaying = useRef(false);
  const setTl = (patch: Partial<Timeline>, key = '') =>
    edit((p) => {
      p.timeline = { ...(p.timeline ?? DEFAULT_TIMELINE), ...patch };
    }, key && `timeline.${key}`);
  const seekAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    clock.seek(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * tl.duration);
  };
  const fit = useMemo(() => lastEntrance(project.layers), [project.layers]);
  return (
    <div className="timeline" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" aria-label={clock.playing ? 'Pause' : 'Play'} data-tip={clock.playing ? 'Pause' : 'Play'} data-kbd="K" onClick={() => clock.toggle(tl)}>
        <Icon name={clock.playing ? 'pause' : 'play'} size={15} />
      </button>
      <button className="icon-btn" aria-label="Play from the start" data-tip="Play from the start" data-kbd="⇧K" onClick={() => clock.replay(tl)}>
        <Icon name="replay" size={15} />
      </button>
      <div
        ref={track}
        className="timeline-track"
        role="slider"
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={tl.duration}
        aria-valuenow={+t.toFixed(2)}
        tabIndex={0}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          wasPlaying.current = clock.playing;
          clock.pause(tl);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seekAt(e.clientX)}
        onPointerUp={() => wasPlaying.current && clock.play(tl)}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          e.stopPropagation();
          clock.pause(tl);
          clock.seek(Math.max(0, Math.min(tl.duration, t + d * (e.shiftKey ? 1 : 1 / 30))));
        }}
      >
        {Array.from({ length: Math.floor(tl.duration) + 1 }, (_, i) => (
          <i key={i} className="tick" style={{ left: `${(i / tl.duration) * 100}%` }} />
        ))}
        {fit > 0 && fit < tl.duration && <i className="settle" style={{ left: `${(fit / tl.duration) * 100}%` }} data-tip="Last entrance settles here" />}
        <div className="timeline-fill" style={{ width: `${(t / tl.duration) * 100}%` }} />
        <div className="timeline-head" style={{ left: `${(t / tl.duration) * 100}%` }} />
      </div>
      <span className="timeline-time">
        {t.toFixed(1)}
        <span> / </span>
        <input
          aria-label="Timeline length in seconds"
          data-tip="Timeline length (seconds)"
          defaultValue={tl.duration}
          key={tl.duration}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0.5) setTl({ duration: Math.min(120, Math.round(v * 10) / 10) });
            else e.target.value = String(tl.duration);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        s
      </span>
      <button className={`icon-btn ${tl.loop ? 'on' : ''}`} aria-pressed={tl.loop} aria-label="Loop" data-tip={tl.loop ? 'Looping: loops are adjusted to fit a whole number of times' : 'Plays once'} onClick={() => setTl({ loop: !tl.loop })}>
        <Icon name="repeat" size={15} />
      </button>
      <button className="icon-btn" aria-label="Export video" data-tip="Export video" onClick={() => void exportVideo()}>
        <Icon name="film" size={15} />
      </button>
    </div>
  );
}
