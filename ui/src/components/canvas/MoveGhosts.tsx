// Where a Move starts and ends, on the canvas: a dashed copy of the selected
// layer's box at its start (Comes in: Move from…) and at where it goes (Then:
// Move to…), joined to its place by a dashed path. Drag a copy to set the
// position; ⇧ keeps to one axis.
import { nodeBox } from '../../app/actions';
import type { Renderer } from '../../render/renderer';
import type { Node } from '../../state/model';
import { beginGesture, commitEdit, edit, useStore } from '../../state/store';
import { findNode } from '../../state/tree';

export function MoveGhosts({ renderer: r, tick }: { renderer: Renderer; tick: number }) {
  void tick;
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const z = r.view.zoom;
  const ghosts: { node: Node; end: 'from' | 'to'; dx: number; dy: number; box: [number, number, number, number] }[] = [];
  for (const id of selection) {
    const n = findNode(project.layers, id);
    const m = n?.motion;
    const box = n && m ? nodeBox(n) : null;
    if (!n || !m || !box) continue;
    if (m.enter === 'move') ghosts.push({ node: n, end: 'from', dx: m.fromX ?? 0, dy: m.fromY ?? 0, box });
    if (m.leave === 'move') ghosts.push({ node: n, end: 'to', dx: m.toX ?? 0, dy: m.toY ?? 0, box });
  }
  if (!ghosts.length) return null;

  const drag = (g: (typeof ghosts)[number]) => (e: React.PointerEvent) => {
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
      edit((p) => {
        const m = findNode(p.layers, g.node.id)?.motion;
        if (!m) return;
        if (g.end === 'from') {
          m.fromX = Math.round(g.dx + ddx);
          m.fromY = Math.round(g.dy + ddy);
        } else {
          m.toX = Math.round(g.dx + ddx);
          m.toY = Math.round(g.dy + ddy);
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

  return (
    <div className="overlay">
      <svg className="move-path" aria-hidden>
        {ghosts.map((g) => {
          const c = r.toScreen((g.box[0] + g.box[2]) / 2, (g.box[1] + g.box[3]) / 2);
          return <line key={`${g.node.id}-${g.end}`} x1={c.x} y1={c.y} x2={c.x + g.dx * z} y2={c.y + g.dy * z} />;
        })}
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
            aria-label={g.end === 'from' ? `Where ${g.node.name} starts` : `Where ${g.node.name} goes`}
            data-tip={g.end === 'from' ? 'Drag: where it starts (⇧ keeps to one axis)' : 'Drag: where it goes (⇧ keeps to one axis)'}
          >
            <span>{g.end === 'from' ? 'Starts here' : 'Goes here'}</span>
          </div>
        );
      })}
    </div>
  );
}
