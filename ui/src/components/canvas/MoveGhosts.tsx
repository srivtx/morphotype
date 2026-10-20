// Where a Move starts and ends, on the canvas: a dashed copy of the selected
// layer's box at its start (Comes in: Move from…), at where it goes (Then:
// Move to…) and at each stop after that, numbered in order, joined through
// its place by a dashed path. Drag a copy to set the position; ⇧ keeps to
// one axis.
import { nodeBox } from '../../app/actions';
import type { Renderer } from '../../render/renderer';
import type { Node } from '../../state/model';
import { legsOf } from '../../state/motion';
import { beginGesture, commitEdit, edit, useStore } from '../../state/store';
import { findNode } from '../../state/tree';

/** 'from' is where it comes in from; a number is a step of Then's path (0: Move to…, then each stop). */
type End = 'from' | number;

interface Ghost {
  node: Node;
  end: End;
  dx: number;
  dy: number;
  box: [number, number, number, number];
  /** Its number on the path, when there's more than one place to go. */
  n?: number;
}

export function MoveGhosts({ renderer: r, tick }: { renderer: Renderer; tick: number }) {
  void tick;
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const z = r.view.zoom;
  const ghosts: Ghost[] = [];
  const paths: { id: string; points: [number, number][] }[] = [];
  for (const id of selection) {
    const n = findNode(project.layers, id);
    const m = n?.motion;
    const box = n && m ? nodeBox(n) : null;
    if (!n || !m || !box) continue;
    const c = r.toScreen((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    const at = (dx: number, dy: number): [number, number] => [c.x + dx * z, c.y + dy * z];
    const legs = legsOf(m);
    const points: [number, number][] = [];
    if (m.enter === 'move') {
      ghosts.push({ node: n, end: 'from', dx: m.fromX ?? 0, dy: m.fromY ?? 0, box });
      points.push(at(m.fromX ?? 0, m.fromY ?? 0));
    }
    points.push(at(0, 0));
    legs.forEach((l, i) => {
      ghosts.push({ node: n, end: i, dx: l.x, dy: l.y, box, n: legs.length > 1 ? i + 1 : undefined });
      points.push(at(l.x, l.y));
    });
    if (points.length > 1) paths.push({ id: n.id, points });
  }
  if (!ghosts.length) return null;

  const drag = (g: Ghost) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const [x0, y0] = [e.clientX, e.clientY];
    beginGesture();
    const move = (ev: PointerEvent) => {
      let ddx = (ev.clientX - x0) / z;
      let ddy = (ev.clientY - y0) / z;
      if (ev.shiftKey) {
        if (Math.abs(ddx) > Math.abs(ddy)) ddy = 0;
        else ddx = 0;
      }
      const [x, y] = [Math.round(g.dx + ddx), Math.round(g.dy + ddy)];
      edit((p) => {
        const m = findNode(p.layers, g.node.id)?.motion;
        if (!m) return;
        if (g.end === 'from') [m.fromX, m.fromY] = [x, y];
        else if (g.end === 0) [m.toX, m.toY] = [x, y];
        else {
          const s = m.stops?.[g.end - 1];
          if (s) [s.x, s.y] = [x, y];
        }
      }, `move-ghost:${g.node.id}:${g.end}`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      commitEdit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const name = (g: Ghost) => (g.end === 'from' ? `Where ${g.node.name} starts` : g.n ? `Stop ${g.n} of ${g.node.name}` : `Where ${g.node.name} goes`);
  const tip = (g: Ghost) => (g.end === 'from' ? 'Drag: where it starts' : g.n ? `Drag: stop ${g.n}, in order along its path` : 'Drag: where it goes') + ' (⇧ keeps to one axis)';
  return (
    <div className="overlay">
      <svg className="move-path" aria-hidden>
        {paths.map((p) => (
          <polyline key={p.id} points={p.points.map(([x, y]) => `${x},${y}`).join(' ')} />
        ))}
      </svg>
      {ghosts.map((g) => {
        const a = r.toScreen(g.box[0] + g.dx, g.box[1] + g.dy);
        const b = r.toScreen(g.box[2] + g.dx, g.box[3] + g.dy);
        return (
          <div
            key={`${g.node.id}-${g.end}`}
            className="move-ghost"
            style={{ left: a.x, top: a.y, width: Math.max(8, b.x - a.x), height: Math.max(8, b.y - a.y) }}
            onPointerDown={drag(g)}
            onDoubleClick={(e) => e.stopPropagation()}
            role="button"
            aria-label={name(g)}
            data-tip={tip(g)}
          >
            <span>
              {g.n ? (
                <>
                  <b>{g.n}</b>
                  {g.n === 1 ? 'Goes here' : 'Then here'}
                </>
              ) : g.end === 'from' ? (
                'Starts here'
              ) : (
                'Goes here'
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
