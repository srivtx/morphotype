// Timeline: shown once anything moves. Folded, it's a bar to play, pause and
// scrub; opened, it's a dock (after DialKit's timeline) with a row for each
// layer that moves and a track for each thing that moves it, placed in time
// exactly as it plays: entrances as clips from start to settle, loops and
// moving settings as their cycles with the real curve drawn in, colours as
// the colours they pass through. Drag a clip to change when it starts, its
// end to change how long it takes, a cycle to shift it, a cycle mark to
// change its length; click to edit it. The ruler counts seconds and frames.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { exportVideo } from '../../app/actions';
import { effectById } from '../../render/effects';
import { clock, DEFAULT_TIMELINE, timelineOf, type Timeline } from '../../state/clock';
import { addStop, animatedValue, animMix, ENTER_UI, isStill, lastSlot, legsOf, LOOP_UI, motionEnd, newMotion, poseAt, progressAt, seedOf, settleTime, staggerSlot, thenTransition, type LoopKind, type Motion, type ParamAnim, type Transition } from '../../state/motion';
import { isGroup, type Node, type Project } from '../../state/model';
import { beginGesture, commitEdit, edit, select, store, useStore } from '../../state/store';
import { frameAt, loopLengthOf, rowsOf, snapTime, type Clip, type Row, type Track } from '../../state/tracks';
import { findNode } from '../../state/tree';
import { ColorField } from '../ColorPicker';
import { Icon } from '../icons';
import { AdvancedSwitch, ChildrenControls, CycleSlider, EnterControls, LoopControls, StopControls, ThenControls } from '../MotionPanel';
import { Popover, Segmented, Slider } from '../ui';

/** Frames per second: what video export renders, and what the ruler and drags count in. */
export const FPS = 30;

/** Anything on the clock: motion on a node, a moving material or moving geometry. */
export function sceneMoves(p: Project): boolean {
  const any = (ns: Node[]): boolean => ns.some((n) => !isStill(n.motion) || Object.keys(n.style.animate ?? {}).length > 0 || Object.keys(n.animate ?? {}).length > 0 || !!effectById(n.style.effect).animated?.(n.style.params) || (isGroup(n) && any(n.children)));
  return any(p.layers);
}

/** When the last entrance or Then settles, so the timeline can be fitted to it. */
function lastEntrance(ns: Node[]): number {
  return Math.max(0, ...ns.map((n) => Math.max(n.motion ? motionEnd(n.motion, isGroup(n) && !n.merge ? n.children.length : 0) : 0, isGroup(n) ? lastEntrance(n.children) : 0)));
}

/** Re-render every frame while playing, and on play / pause / seek (scrubbing while paused included). */
function useClockTime(tl: Timeline) {
  const [, tick] = useState(0);
  useSyncExternalStore(clock.subscribe, () => clock.version);
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

// ---------- remembered per viewer: open or folded, and the dock's height ----------

const PREF = 'morphotype.timeline';
function readPref(): { open: boolean; height: number } {
  try {
    const v = JSON.parse(localStorage.getItem(PREF) ?? '{}');
    return { open: !!v.open, height: Number(v.height) || 260 };
  } catch {
    return { open: false, height: 260 };
  }
}
function writePref(v: { open: boolean; height: number }) {
  try {
    localStorage.setItem(PREF, JSON.stringify(v));
  } catch {
    // Storage blocked: it just won't be remembered.
  }
}

export function TimelineBar() {
  const project = useStore((s) => s.project);
  const [pref, setPref] = useState(readPref);
  const update = (v: Partial<typeof pref>) =>
    setPref((p) => {
      const next = { ...p, ...v };
      writePref(next);
      return next;
    });
  // Nothing moves: no bar, and no per-frame clock ticking either.
  if (!sceneMoves(project)) return null;
  return pref.open ? <Dock project={project} height={pref.height} onHeight={(height) => update({ height })} onFold={() => update({ open: false })} /> : <Bar project={project} onOpen={() => update({ open: true })} />;
}

const setTl = (patch: Partial<Timeline>, key = '') =>
  edit((p) => {
    p.timeline = { ...(p.timeline ?? DEFAULT_TIMELINE), ...patch };
  }, key && `timeline.${key}`);

/** Play / pause and back to the start. */
function Transport({ tl }: { tl: Timeline }) {
  useSyncExternalStore(clock.subscribe, () => clock.playing);
  return (
    <>
      <button className="icon-btn" aria-label={clock.playing ? 'Pause' : 'Play'} data-tip={clock.playing ? 'Pause' : 'Play'} data-kbd="K" onClick={() => clock.toggle(tl)}>
        <Icon name={clock.playing ? 'pause' : 'play'} size={15} />
      </button>
      <button className="icon-btn" aria-label="Play from the start" data-tip="Play from the start" data-kbd="⇧K" onClick={() => clock.replay(tl)}>
        <Icon name="replay" size={15} />
      </button>
    </>
  );
}

/** The playhead's time (and frame), and the timeline's length to type. */
function TimeReadout({ tl, frames }: { tl: Timeline; frames?: boolean }) {
  const t = useClockTime(tl);
  return (
    <span className="timeline-time">
      {t.toFixed(frames ? 2 : 1)}
      {frames && <em data-tip="Frame (30 a second)">f{frameAt(t, FPS)}</em>}
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
  );
}

function LoopAndExport({ tl }: { tl: Timeline }) {
  return (
    <>
      <button className={`icon-btn ${tl.loop ? 'on' : ''}`} aria-pressed={tl.loop} aria-label="Loop" data-tip={tl.loop ? 'Looping: loops are adjusted to fit a whole number of times' : 'Plays once'} onClick={() => setTl({ loop: !tl.loop })}>
        <Icon name="repeat" size={15} />
      </button>
      <button className="icon-btn" aria-label="Export video" data-tip="Export video" onClick={() => void exportVideo()}>
        <Icon name="film" size={15} />
      </button>
    </>
  );
}

/** Drag on an element to seek: pauses while dragging and plays on after if it was playing. */
function useScrub(tl: Timeline) {
  const wasPlaying = useRef(false);
  const seekAt = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * tl.duration;
    clock.seek(Math.min(tl.duration, Math.round(t * FPS) / FPS));
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      wasPlaying.current = clock.playing;
      clock.pause(tl);
      seekAt(e.currentTarget, e.clientX);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.currentTarget, e.clientX);
    },
    onPointerUp: () => {
      if (wasPlaying.current) clock.play(tl);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      clock.pause(tl);
      // One frame, or a second with ⇧.
      const t = clock.time(tl);
      clock.seek(Math.max(0, Math.min(tl.duration, Math.round((t + d * (e.shiftKey ? 1 : 1 / FPS)) * FPS) / FPS)));
    },
  };
}

function Bar({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const tl = timelineOf(project);
  const t = useClockTime(tl);
  const scrub = useScrub(tl);
  const fit = useMemo(() => lastEntrance(project.layers), [project.layers]);
  return (
    <div className="timeline" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <Transport tl={tl} />
      <div className="timeline-track" role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={tl.duration} aria-valuenow={+t.toFixed(2)} tabIndex={0} {...scrub}>
        {Array.from({ length: Math.floor(tl.duration) + 1 }, (_, i) => (
          <i key={i} className="tick" style={{ left: `${(i / tl.duration) * 100}%` }} />
        ))}
        {fit > 0 && fit < tl.duration && <i className="settle" style={{ left: `${(fit / tl.duration) * 100}%` }} data-tip="Everything has arrived here" />}
        <div className="timeline-fill" style={{ width: `${(t / tl.duration) * 100}%` }} />
        <div className="timeline-head" style={{ left: `${(t / tl.duration) * 100}%` }} />
      </div>
      <TimeReadout tl={tl} />
      <LoopAndExport tl={tl} />
      <button className="icon-btn" aria-label="Open the timeline" data-tip="Open the timeline: see when everything moves" onClick={onOpen}>
        <Icon name="chevronUp" size={15} />
      </button>
    </div>
  );
}

// ---------- the dock ----------

/** Which clip's editor is open: found again in the fresh rows after each edit. */
interface Editing {
  row: string;
  id: string;
  anchor: HTMLElement;
  /** Then with stops: which step of the path (0 is Move to… itself). */
  step?: number;
}

const trackId = (k: Track) => (k.kind === 'param' ? `${k.kind}:${k.scope}:${k.key}` : (k.kind === 'enter' || k.kind === 'leave') && k.index !== undefined ? `${k.kind}:inherited` : k.kind);

function Dock({ project, height, onHeight, onFold }: { project: Project; height: number; onHeight: (h: number) => void; onFold: () => void }) {
  const tl = timelineOf(project);
  const selection = useStore((s) => s.selection);
  const rows = useMemo(() => rowsOf(project, selection), [project, selection]);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [laneW, setLaneW] = useState(600);
  // The canvas makes room above the dock, so what's animating stays in view.
  useLayoutEffect(() => {
    const c = dock.current?.parentElement;
    c?.style.setProperty('--dock-space', `${height + 20}px`);
    return () => void c?.style.removeProperty('--dock-space');
  }, [height]);
  const scrub = useScrub(tl);
  useLayoutEffect(() => {
    const el = ruler.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Rows inside a folded group drop out.
  const shown = useMemo(() => {
    const out: Row[] = [];
    let skipBelow = Infinity;
    for (const r of rows) {
      if (r.depth > skipBelow) continue;
      skipBelow = folded.has(r.node.id) ? r.depth : Infinity;
      out.push(r);
    }
    return out;
  }, [rows, folded]);
  // Keep the picked layer's row in view.
  useEffect(() => {
    const id = selection.at(-1);
    const el = id ? body.current?.querySelector(`[data-row="${CSS.escape(id)}"]`) : null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selection]);
  const resize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) => onHeight(Math.round(Math.max(140, Math.min(window.innerHeight * 0.7, h0 + y0 - ev.clientY))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const toggleFold = useMemo(() => (id: string) => setFolded((f) => (f.has(id) ? new Set([...f].filter((x) => x !== id)) : new Set([...f, id]))), []);
  const open = editing ? rows.find((r) => r.node.id === editing.row) : null;
  const openTrack = open?.tracks.find((k) => trackId(k) === editing!.id);
  return (
    <div ref={dock} className="tl-dock" style={{ height }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="tl-resize" onPointerDown={resize} aria-hidden />
      <div className="tl-header">
        <span className="tl-title">Timeline</span>
        <Transport tl={tl} />
        <TimeReadout tl={tl} frames />
        <span className="tl-spacer" />
        <LoopAndExport tl={tl} />
        <button className="icon-btn" aria-label="Fold the timeline" data-tip="Fold the timeline" onClick={onFold}>
          <Icon name="chevronDown" size={15} />
        </button>
      </div>
      <div className="tl-body" ref={body}>
        <div className="tl-grid">
          <div className="tl-row tl-ruler-row">
            <div className="tl-label tl-hint">Layer</div>
            <div ref={ruler} className="tl-ruler" role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={tl.duration} tabIndex={0} {...scrub}>
              <Ruler duration={tl.duration} width={laneW} />
            </div>
          </div>
          <Rows rows={shown} tl={tl} laneW={laneW} selection={selection} folded={folded} onFold={toggleFold} onEdit={setEditing} />
          {!rows.length && <p className="tl-empty">Select a layer to give it an entrance or a loop. To move a colour or any setting, click ◆ next to it in the panel.</p>}
          <Playhead tl={tl} />
        </div>
      </div>
      {editing && open && openTrack && (
        <Popover anchor={editing.anchor} onClose={() => setEditing(null)} placement="top-start" width={300} className="tl-editor" autoFocus={false}>
          <ClipEditor row={open.node} track={openTrack} step={editing.step} onDone={() => setEditing(null)} />
        </Popover>
      )}
    </div>
  );
}

/** Seconds along the top, with half seconds, tenths and (when there's room) frames between. */
function Ruler({ duration, width }: { duration: number; width: number }) {
  const pxPerS = width / Math.max(0.1, duration);
  const step = pxPerS / FPS >= 6 ? 1 / FPS : pxPerS / 10 >= 6 ? 0.1 : pxPerS / 2 >= 8 ? 0.5 : 1;
  const ticks: { t: number; cls: string }[] = [];
  const n = Math.floor(duration / step + 1e-6);
  for (let i = 0; i <= n; i++) {
    const t = i * step;
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    const half = Math.abs(t * 2 - Math.round(t * 2)) < 1e-6;
    ticks.push({ t, cls: whole ? 'major' : half ? 'medium' : 'fine' });
  }
  // Label every second, or every few when they'd crowd.
  const every = pxPerS >= 36 ? 1 : pxPerS >= 14 ? 5 : 10;
  return (
    <>
      {ticks.map(({ t, cls }) => (
        <i key={t.toFixed(4)} className={`tl-tick ${cls}`} style={{ left: `${(t / duration) * 100}%` }}>
          {cls === 'major' && Math.round(t) % every === 0 && <span>{Math.round(t)}s</span>}
        </i>
      ))}
    </>
  );
}

/** The playhead across the ruler and every row, with its time and frame on a flag. */
function Playhead({ tl }: { tl: Timeline }) {
  const t = useClockTime(tl);
  return (
    <div className="tl-playhead" style={{ '--at': t / tl.duration } as React.CSSProperties}>
      <span className="tl-flag">
        {t.toFixed(2)} <em>f{frameAt(t, FPS)}</em>
      </span>
    </div>
  );
}

interface RowsProps {
  rows: Row[];
  tl: Timeline;
  laneW: number;
  selection: string[];
  folded: Set<string>;
  onFold: (id: string) => void;
  onEdit: (e: Editing) => void;
}

/** The rows don't depend on the playhead, so they only re-render when the design or selection changes. */
const Rows = memo(function Rows({ rows, tl, laneW, selection, folded, onFold, onEdit }: RowsProps) {
  const all = rows.flatMap((r) => r.tracks);
  // Clip edges anything can snap to.
  const edges = [0, ...all.flatMap((k) => (k.kind === 'enter' || k.kind === 'leave' ? [k.start, k.end, ...(k.steps ?? []).flatMap((p) => [p.start, p.end])] : []))];
  const ctx: LaneCtx = { tl, laneW, edges, onEdit };
  return (
    <>
      {rows.map((r) => {
        const sel = selection.includes(r.node.id);
        const pick = (e: React.MouseEvent) => select(e.shiftKey || e.metaKey ? (sel ? selection.filter((x) => x !== r.node.id) : [...selection, r.node.id]) : [r.node.id]);
        // One track sits on the layer's own row; more get a row each under it.
        const own = r.tracks.length === 1 ? r.tracks : [];
        const subs = r.tracks.length > 1 ? r.tracks : [];
        return (
          <div key={r.node.id} className={`tl-layer ${sel ? 'selected' : ''}`} data-row={r.node.id}>
            <div className="tl-row">
              <div className="tl-label" style={{ paddingLeft: 6 + r.depth * 12 }} onClick={pick} data-tip={r.node.name}>
                {r.parent || subs.length ? (
                  <button
                    className={`tl-disclose ${folded.has(r.node.id) ? 'folded' : ''}`}
                    aria-label={folded.has(r.node.id) ? `Show inside ${r.node.name}` : `Hide inside ${r.node.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFold(r.node.id);
                    }}
                  >
                    <Icon name="chevronDown" size={10} />
                  </button>
                ) : (
                  <i className="tl-disclose-gap" />
                )}
                <span className="tl-name">{r.node.name}</span>
                {sel && <AddMenu node={r.node} />}
              </div>
              <div className="tl-lane">
                {own.map((k) => (
                  <TrackView key={trackId(k)} row={r.node} track={k} ctx={ctx} />
                ))}
                {subs.length > 0 && <Overview tracks={subs} tl={tl} />}
                {!r.tracks.length && sel && <span className="tl-lane-hint">Not moving yet: press + to make it come in, move on or loop</span>}
              </div>
            </div>
            {!folded.has(r.node.id) &&
              subs.map((k) => (
                <div key={trackId(k)} className="tl-row tl-sub">
                  <div className="tl-label" style={{ paddingLeft: 6 + r.depth * 12 + 18 }} onClick={pick}>
                    <span className="tl-name">{trackName(k)}</span>
                  </div>
                  <div className="tl-lane">
                    <TrackView row={r.node} track={k} ctx={ctx} />
                  </div>
                </div>
              ))}
          </div>
        );
      })}
    </>
  );
});

const trackName = (k: Track) => (k.kind === 'enter' ? 'Comes in' : k.kind === 'leave' ? 'Then' : k.kind === 'loop' ? 'Loop' : k.kind === 'flow' ? 'Pattern' : k.label);

/** A layer's tracks summed up on its own row: where each one is busy. */
function Overview({ tracks, tl }: { tracks: Track[]; tl: Timeline }) {
  const d = tl.duration;
  return (
    <div className="tl-overview">
      {tracks.map((k) => {
        const [a, b] = k.kind === 'enter' || k.kind === 'leave' ? [Math.min(k.start, d), Math.min(k.end, d)] : [0, d];
        return <i key={trackId(k)} style={{ left: pct(a, d), width: pct(b - a, d) }} />;
      })}
    </div>
  );
}

/** + on the picked layer: give it an entrance or a loop. */
function AddMenu({ node }: { node: Node }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const m = node.motion;
  const add = (fn: (m: Motion) => void) => {
    editNode(node.id, (n) => {
      n.motion = n.motion ?? newMotion();
      fn(n.motion);
    });
    setOpen(false);
    clock.replay(timelineOf(store.get().project));
  };
  return (
    <>
      <button
        ref={btn}
        className="tl-add"
        aria-label={`Add motion to ${node.name}`}
        data-tip="Add how it comes in, moves on, or loops"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <Icon name="plus" size={11} />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} placement="top-start" className="menu-pop" width={240}>
          <button
            role="menuitem"
            className="menu-item"
            disabled={!!m && m.enter !== 'none'}
            onClick={() =>
              add((x) => {
                x.enter = 'rise';
                x.distance = ENTER_UI.rise.default;
              })
            }
          >
            <span className="mi-label">Comes in</span>
            <kbd>a clip</kbd>
          </button>
          <button
            role="menuitem"
            className="menu-item"
            disabled={!!m && m.loop !== 'none'}
            onClick={() =>
              add((x) => {
                x.loop = 'float';
                x.amount = LOOP_UI.float.default;
              })
            }
          >
            <span className="mi-label">Loop</span>
            <kbd>cycles</kbd>
          </button>
          <button
            role="menuitem"
            className="menu-item"
            disabled={!!m && (m.leave ?? 'none') !== 'none'}
            onClick={() =>
              add((x) => {
                x.leave = 'move';
                x.toX = 200;
                x.toY = 0;
                x.leaveAt = Math.round((x.enter !== 'none' ? x.delay + settleTime(x.transition) + 1 : 1) * 20) / 20;
              })
            }
          >
            <span className="mi-label">Then move on</span>
            <kbd>a clip</kbd>
          </button>
          <button role="menuitem" className="menu-item" disabled={m?.leave !== 'move'} onClick={() => add((x) => void addStop(x))}>
            <span className="mi-label">Add a stop</span>
            <kbd>after Then</kbd>
          </button>
          <p className="menu-note">To move a colour or any setting, click ◆ next to it in the Design or Style panel.</p>
        </Popover>
      )}
    </>
  );
}

const editNode = (id: string, fn: (n: Node) => void, key = '') =>
  edit((p) => {
    const n = findNode(p.layers, id);
    if (n) fn(n);
  }, key);

interface LaneCtx {
  tl: Timeline;
  laneW: number;
  edges: number[];
  onEdit: (e: Editing) => void;
}

/**
 * Press, then either drag (`move` gets the seconds moved so far) or let go
 * without moving: a click, which opens the editor.
 */
function dragger(ctx: LaneCtx, onClick: (el: HTMLElement) => void, move: (ds: number) => void) {
  return (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget;
    const x0 = e.clientX;
    const perPx = ctx.tl.duration / Math.max(1, ctx.laneW);
    let moved = false;
    beginGesture();
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      document.body.classList.add('tl-dragging');
      move((ev.clientX - x0) * perPx);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('tl-dragging');
      commitEdit();
      if (!moved) onClick(el);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
}

const pct = (t: number, d: number) => `${(t / d) * 100}%`;
const r2 = (v: number) => Math.round(v * 100) / 100;

function TrackView({ row, track: k, ctx }: { row: Node; track: Track; ctx: LaneCtx }) {
  const { tl } = ctx;
  const open = (el: HTMLElement, step?: number) => {
    select([row.id]);
    ctx.onEdit({ row: row.id, id: trackId(k), anchor: el, step });
  };
  // Snap to frames, the playhead and other clips' edges within 6 px.
  const snap = (t: number) => snapTime(t, FPS, [...ctx.edges, clock.time(tl)], (6 * tl.duration) / Math.max(1, ctx.laneW));
  if (k.kind === 'enter' || k.kind === 'leave') return <EnterClip k={k} ctx={ctx} open={open} snap={snap} />;
  if (k.kind === 'flow')
    return (
      <div className="tl-clip tl-flow" onPointerDown={dragger(ctx, open, () => {})} data-tip="A pattern with Speed: it moves the whole time, a whole number of times round each loop">
        <span className="tl-clip-label">{k.label}</span>
      </div>
    );
  return <CycleClip row={row} k={k} ctx={ctx} open={open} />;
}

/** An entrance or Then: a clip from start to settle with its curve drawn in. */
function EnterClip({ k, ctx, open, snap }: { k: Clip & { kind: 'enter' | 'leave' }; ctx: LaneCtx; open: (el: HTMLElement, step?: number) => void; snap: (t: number) => number }) {
  const d = ctx.tl.duration;
  const leave = k.kind === 'leave';
  const m = k.motion;
  const tr = leave ? (m.leaveTransition ?? m.transition) : m.transition;
  const base = leave ? (m.leaveAt ?? 0) : m.delay;
  const settle = settleTime(tr);
  const physics = tr.type === 'physics';
  const len = k.end - k.start;
  // Body: when it starts. A staggered child moves its group's stagger (it starts slot × stagger after the first).
  const body = dragger(ctx, open, (ds) =>
    editNode(
      k.owner,
      (n) => {
        if (!n.motion) return;
        const t = snap(k.start + ds);
        if (k.index) n.motion.stagger = r2(Math.max(0, (t - base) / k.index));
        else if (leave) n.motion.leaveAt = Math.max(0, r2(t));
        else n.motion.delay = Math.max(0, r2(t));
      },
      `tl:${k.owner}:${k.kind}:${k.index ? 'stagger' : 'at'}`,
    ),
  );
  // End: how long it takes (on a staggered group's clip, how far apart the children are).
  const end = dragger(
    ctx,
    () => {},
    (ds) =>
      editNode(
        k.owner,
        (n) => {
          if (!n.motion) return;
          const want = Math.max(1 / 30, snap(k.end + ds) - k.start);
          const slots = k.children ? lastSlot(n.motion.order, k.children) : 0;
          if (slots > 0) n.motion.stagger = r2(Math.max(0, (want - settle) / slots));
          else {
            // Settle time grows in step with the duration, so scale it.
            const next = { ...tr, duration: Math.max(0.05, r2(tr.duration * (want / Math.max(1e-3, settle)))) };
            if (leave) n.motion.leaveTransition = next;
            else n.motion.transition = next;
          }
        },
        `tl:${k.owner}:${k.kind}:${k.children ? 'stagger' : 'duration'}`,
      ),
  );
  // The curve: progress 0 → 1 over the settle time (Then's runs down).
  const path = useMemo(() => curvePath(tr, settle, leave), [tr, settle, leave]);
  const what = leave ? 'Then' : 'Comes in';
  const tip = `${what}: ${k.label}${k.from ? ` (set on ${k.from}, ${m.stagger.toFixed(2)} s apart)` : ''}. Starts at ${k.start.toFixed(2)} s (frame ${frameAt(k.start, FPS)}), settles at ${k.end.toFixed(2)} s (frame ${frameAt(k.end, FPS)})`;
  const resizable = k.children ? k.children > 1 : !physics;
  const seed = useMemo(() => seedOf(k.owner), [k.owner]);
  const steps = !k.children && k.steps && k.steps.length > 1 ? k.steps : null;
  return (
    <div className={`tl-clip tl-enter ${leave ? 'leave' : ''} ${steps ? 'steps' : ''} ${k.index !== undefined ? 'inherited' : ''}`} style={{ left: pct(Math.min(k.start, d), d), width: pct(Math.max(0, Math.min(k.end, d) - Math.min(k.start, d)), d) }} onPointerDown={body} data-tip={tip}>
      {steps ? (
        steps.map((_, i) => <StepSegment key={i} k={k} i={i} steps={steps} ctx={ctx} open={open} snap={snap} moveStart={body} />)
      ) : k.children ? (
        Array.from({ length: k.children }, (_, i) => <i key={i} className="tl-stagger" style={{ left: `${((staggerSlot(m.order, i, k.children!, seed) * m.stagger) / Math.max(1e-3, len)) * 100}%` }} />)
      ) : (
        <svg className="tl-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <path d={path} />
        </svg>
      )}
      <span className="tl-clip-label">{k.label}</span>
      <span className="tl-clip-dur">
        {physics && !k.children ? '~' : ''}
        {len.toFixed(2)}s
      </span>
      {resizable && !steps && <i className="tl-clip-handle" onPointerDown={end} data-tip={k.children ? 'Drag to spread the children out' : 'Drag to change how long it takes'} />}
    </div>
  );
}

/** Progress 0 → 1 over a transition's settle time, as a path across a 100 × 100 box (overshoot included). */
function curvePath(tr: Transition, settle: number, down = false): string {
  const N = 48;
  const v = Array.from({ length: N + 1 }, (_, i) => progressAt(tr, (i / N) * settle));
  const lo = Math.min(0, ...v);
  const hi = Math.max(1, ...v);
  return v.map((y, i) => `${i ? 'L' : 'M'}${((i / N) * 100).toFixed(2)} ${(down ? 8 + ((y - lo) / (hi - lo)) * 84 : 92 - ((y - lo) / (hi - lo)) * 84).toFixed(2)}`).join(' ');
}

/**
 * One step of Then's path in its clip: Move to… (0) or a stop. Drag it to
 * change when it sets off (the first moves the whole of Then; a stop, how
 * long it waits first), drag its end to retime it, click to edit it.
 */
function StepSegment({ k, i, steps, ctx, open, snap, moveStart }: { k: Clip; i: number; steps: { start: number; end: number }[]; ctx: LaneCtx; open: (el: HTMLElement, step?: number) => void; snap: (t: number) => number; moveStart: (e: React.PointerEvent<HTMLElement>) => void }) {
  const m = k.motion;
  const legs = legsOf(m);
  const leg = legs[i];
  const d = ctx.tl.duration;
  // The clip is cut off at the timeline's end: place steps on what's shown.
  const len = Math.max(1e-3, Math.min(k.end, d) - Math.min(k.start, d));
  const [a, b] = [steps[i].start, steps[i].end];
  const tr = leg?.transition ?? thenTransition(m);
  const path = useMemo(() => curvePath(tr, Math.max(1e-3, b - a), true), [tr, a, b]);
  if (!leg) return null;
  const key = `tl:${k.owner}:step${i}`;
  // The first step moves the whole of Then, as the clip does (a click opens Then).
  const body =
    i === 0
      ? moveStart
      : dragger(
          ctx,
          (el) => open(el, i),
          (ds) =>
            editNode(
              k.owner,
              (n) => {
                const s = n.motion?.stops?.[i - 1];
                if (s) s.hold = Math.max(0, r2(snap(a + ds) - steps[i - 1].end));
              },
              `${key}:hold`,
            ),
        );
  const end = dragger(
    ctx,
    () => {},
    (ds) =>
      editNode(
        k.owner,
        (n) => {
          const x = n.motion;
          if (!x) return;
          const want = Math.max(1 / 30, snap(b + ds) - a);
          const next = { ...tr, duration: Math.max(0.05, r2(tr.duration * (want / Math.max(1e-3, b - a)))) };
          if (i === 0) {
            // Stops that followed Then's curve keep it: only this step changes.
            for (const s of x.stops ?? []) s.transition ??= { ...tr };
            x.leaveTransition = next;
          } else {
            const s = x.stops?.[i - 1];
            if (s) s.transition = next;
          }
        },
        `${key}:duration`,
      ),
  );
  const tip = `${i === 0 ? 'Move to…' : `Stop ${i + 1}`}: sets off at ${a.toFixed(2)} s (frame ${frameAt(a, FPS)}), there by ${b.toFixed(2)} s (frame ${frameAt(b, FPS)}). Drag to ${i === 0 ? 'move Then' : 'change how long it waits first'}, drag its end to retime it, click to edit`;
  return (
    <div className="tl-step" style={{ left: pct(a - k.start, len), width: pct(b - a, len) }} onPointerDown={body} data-tip={tip} aria-label={i === 0 ? 'Move to…' : `Stop ${i + 1}`} role="button">
      <svg className="tl-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path d={path} />
      </svg>
      <em>{i + 1}</em>
      {tr.type !== 'physics' && <i className="tl-clip-handle" onPointerDown={end} data-tip="Drag to retime this step" />}
    </div>
  );
}

/** What a loop moves most: its height, sideways shift, angle, size or fade. */
function loopSignal(m: Motion, t: number, L?: number): number {
  const p = poseAt({ ...m, enter: 'none' }, t, L);
  switch (m.loop) {
    case 'float':
    case 'bounce':
      return -p.y;
    case 'sway':
    case 'spin':
      return p.rotate;
    case 'pulse':
      return p.scale;
    case 'blink':
      return p.opacity;
    default:
      return p.x;
  }
}

/** A loop or a moving setting: its cycles across the timeline, with the curve it really follows. */
function CycleClip({ row, k, ctx, open }: { row: Node; k: Extract<Track, { kind: 'loop' | 'param' }>; ctx: LaneCtx; open: (el: HTMLElement) => void }) {
  const { tl } = ctx;
  const d = tl.duration;
  const L = loopLengthOf(tl);
  const phase = k.kind === 'loop' ? k.motion.phase : k.anim.phase;
  const P = k.period;
  const stored = k.kind === 'loop' ? k.motion.period : k.anim.period;
  const set = (fn: (target: { phase: number; period: number }) => void, field: string) =>
    editNode(
      row.id,
      (n) => {
        const target = k.kind === 'loop' ? n.motion : k.scope === 'style' ? n.style.animate?.[k.key] : n.animate?.[k.key];
        if (target) fn(target);
      },
      `tl:${row.id}:${trackId(k)}:${field}`,
    );
  // Body: slide the cycles along (the offset).
  const body = dragger(ctx, open, (ds) => set((x) => (x.phase = r2((((phase - ds / P) % 1) + 1) % 1)), 'phase'));
  // Cycle i ends where t / P + phase = i.
  const marks: { t: number; i: number }[] = [];
  for (let i = Math.ceil(phase + 1e-6); (i - phase) * P < d - 1e-6; i++) marks.push({ t: (i - phase) * P, i });
  const mark = (i: number) =>
    dragger(
      ctx,
      () => {},
      (ds) => {
        const t = (i - phase) * P + ds;
        // The cycle length that puts this mark where it's dragged; looping fits it to the timeline again.
        if (t > 0.05) set((x) => (x.period = Math.max(0.2, Math.min(20, r2(t / (i - phase))))), 'period');
      },
    );
  const { path, gradient } = useMemo(() => {
    const N = k.kind === 'param' && k.anim.mode === 'flicker' ? 480 : 240;
    const v = Array.from({ length: N + 1 }, (_, i) => {
      const t = (i / N) * d;
      return k.kind === 'loop' ? loopSignal(k.motion, t, L) : animMix(k.anim, t, L);
    });
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    const path = v.map((y, i) => `${i ? 'L' : 'M'}${((i / N) * 1000).toFixed(1)} ${(88 - ((y - lo) / (hi - lo || 1)) * 76).toFixed(2)}`).join(' ');
    const gradient = k.kind === 'param' && k.color ? `linear-gradient(90deg, ${Array.from({ length: 41 }, (_, i) => `${animatedValue(k.from, k.anim, (i / 40) * d, L)} ${(i / 40) * 100}%`).join(', ')})` : undefined;
    return { path, gradient };
  }, [k, d, L]);
  const cycles = d / P;
  const fitted = Math.abs(stored - P) > 0.005;
  const tip = `${k.label}: ${P.toFixed(2)} s a cycle${fitted ? ` (you set ${stored.toFixed(2)} s; fitted to the loop)` : ''}. Drag to shift it, drag a mark to change the cycle, click to edit`;
  const unit = k.kind === 'loop' ? (LOOP_UI[k.motion.loop as Exclude<LoopKind, 'none'>]?.unit ?? '') : '';
  const arrow = k.kind === 'loop' && k.motion.loop === 'slide' ? ` ${{ left: '←', right: '→', up: '↑', down: '↓' }[k.motion.dir ?? 'right']}${k.motion.oneWay ? ' one way' : ''}` : '';
  const what = k.kind === 'loop' ? `${k.label}${arrow} ${+Math.abs(k.motion.amount).toFixed(1)}${unit}` : `${k.anim.mode === 'swing' ? 'Swing' : k.anim.mode === 'ramp' ? 'Ramp' : 'Flicker'} to ${typeof k.anim.to === 'number' ? +k.anim.to.toFixed(2) : k.anim.to}`;
  return (
    <div className={`tl-clip tl-cycle ${gradient ? 'colour' : ''}`} style={{ background: gradient }} onPointerDown={body} data-tip={tip}>
      <svg className="tl-wave" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
        <path d={path} />
      </svg>
      {marks.map(({ t, i }) => (
        <i key={i} className="tl-cycle-mark" style={{ left: pct(t, d) }} onPointerDown={mark(i)} />
      ))}
      <span className="tl-clip-label">{what}</span>
      <span className="tl-clip-dur">
        {P.toFixed(2)}s × {+cycles.toFixed(1)}
      </span>
    </div>
  );
}

/** The editor that opens on a clip: everything about that one track, with the same controls as the Motion panel. */
function ClipEditor({ row, track: k, step, onDone }: { row: Node; track: Track; step?: number; onDone: () => void }) {
  const owner = k.owner;
  const setMotion = (fn: (m: Motion) => void, key = '') =>
    editNode(
      owner,
      (n) => {
        n.motion = n.motion ?? newMotion();
        fn(n.motion);
        if (isStill(n.motion)) delete n.motion;
      },
      key && `tl:${owner}:${key}`,
    );
  const ownerNode = findNode(store.get().project.layers, owner);
  const head = (title: string) => (
    <header>
      <b>{title}</b>
      <span>{k.kind !== 'param' && k.kind !== 'flow' && 'index' in k && k.index !== undefined ? `set on ${ownerNode?.name ?? 'the group'}` : row.name}</span>
      <AdvancedSwitch />
    </header>
  );
  const remove = (label: string, fn: (m: Motion) => void) => (
    <button
      className="btn tl-remove"
      onClick={() => {
        setMotion(fn);
        onDone();
      }}
    >
      {label}
    </button>
  );
  const children = ownerNode && isGroup(ownerNode) && !ownerNode.merge ? ownerNode.children.length : 0;
  if (k.kind === 'leave' && step && k.motion.stops?.[step - 1]) {
    return (
      <div className="tl-edit">
        {head(`Stop ${step + 1}`)}
        <StopControls m={k.motion} index={step - 1} set={setMotion} onRemove={onDone} />
      </div>
    );
  }
  if (k.kind === 'enter' || k.kind === 'leave') {
    const m = k.motion;
    return (
      <div className="tl-edit">
        {head(k.kind === 'enter' ? 'Comes in' : 'Then')}
        {k.kind === 'enter' ? <EnterControls m={m} set={setMotion} /> : <ThenControls m={m} set={setMotion} stops={!k.steps} />}
        {children > 0 && <ChildrenControls m={m} set={setMotion} count={children} />}
        {k.kind === 'enter' ? remove('Remove entrance', (x) => (x.enter = 'none')) : remove('Remove Then', (x) => (x.leave = 'none'))}
      </div>
    );
  }
  if (k.kind === 'loop') {
    return (
      <div className="tl-edit">
        {head('Loop')}
        <LoopControls m={k.motion} set={setMotion} />
        {remove('Remove loop', (x) => (x.loop = 'none'))}
      </div>
    );
  }
  if (k.kind === 'flow') {
    const speed = Number(row.style.params.speed ?? 0);
    return (
      <div className="tl-edit">
        <header>
          <b>Pattern</b>
          <span>{row.name}</span>
        </header>
        <Slider label="Speed" value={speed} min={-4} max={4} step={0.05} reset={0} onChange={(v) => editNode(row.id, (n) => (n.style.params.speed = v), `tl:${row.id}:speed`)} />
        <p className="hint">Moves a whole number of times round each loop, so it never jumps.</p>
      </div>
    );
  }
  const setAnim = (fn: ((a: ParamAnim) => void) | null, key = '') =>
    editNode(
      row.id,
      (n) => {
        const bag = k.scope === 'style' ? n.style.animate : n.animate;
        if (!bag?.[k.key]) return;
        if (fn) fn(bag[k.key]);
        else delete bag[k.key];
      },
      key && `tl:${row.id}:${k.key}:${key}`,
    );
  return (
    <div className="tl-edit">
      <header>
        <b>{k.label}</b>
        <span>{row.name}</span>
        <AdvancedSwitch />
      </header>
      {k.color ? <ColorField label="To" value={String(k.anim.to)} onChange={(v) => setAnim((x) => (x.to = v), 'to')} /> : <Slider label="To" min={k.range.min} max={k.range.max} step={k.range.step} value={Number(k.anim.to)} onChange={(v) => setAnim((x) => (x.to = v), 'to')} />}
      <CycleSlider value={k.anim.period} max={20} onChange={(v) => setAnim((x) => (x.period = v), 'period')} />
      <ParamAdvanced anim={k.anim} set={setAnim} />
      <button
        className="btn tl-remove"
        onClick={() => {
          setAnim(null);
          onDone();
        }}
      >
        Stop animating
      </button>
    </div>
  );
}

/** A keyframed setting's offset and kind of motion (Advanced). */
function ParamAdvanced({ anim, set }: { anim: ParamAnim; set: (fn: (a: ParamAnim) => void, key?: string) => void }) {
  return (
    <>
      <div className="dial-row">
        <span>Motion</span>
        <Segmented<ParamAnim['mode']>
          size="sm"
          value={anim.mode}
          onChange={(mode) => set((x) => (x.mode = mode))}
          options={[
            { value: 'swing', label: 'Swing', title: 'There and back, easing at each end' },
            { value: 'ramp', label: 'Ramp', title: 'Steadily to To, then round again' },
            { value: 'flicker', label: 'Flicker', title: 'Jumps between steps at random' },
          ]}
        />
      </div>
      <Slider label="Offset" min={0} max={1} step={0.01} reset={0} value={anim.phase} onChange={(v) => set((x) => (x.phase = v), 'phase')} />
    </>
  );
}
