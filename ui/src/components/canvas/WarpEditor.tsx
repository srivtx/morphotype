import { useEffect, useRef } from 'react';
import { updateLayer } from '../../app/actions';
import type { Box, ModEntry } from '../../engine/types';
import type { Renderer } from '../../render/renderer';
import { apply, invert, warpControls, warpNet, type Pt, type Xform } from '../../state/geometry';
import type { ShapeLayer } from '../../state/model';
import { beginGesture, commitEdit, store } from '../../state/store';

type Warp = Extract<ModEntry, { kind: 'warp' }>;

/** Draggable 4 × 4 control net for a warp modifier. */
export function WarpEditor({ layer, uid, frame, toScreen, renderer }: { layer: ShapeLayer; uid: string; frame: Box | null; toScreen: (p: Pt) => Pt; renderer: Renderer }) {
  const m = layer.modifiers.find((x) => x.uid === uid) as Warp | undefined;
  const ref = useRef<SVGGElement>(null);
  const drag = useRef<null | { k: number; start: Pt; base: [number, number][] }>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        store.set({ editing: null });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  if (!m || !frame) return null;
  const t: Xform = { x: layer.x, y: layer.y, rotation: layer.rotation, scale: layer.scale, sx: layer.sx ?? 1, sy: layer.sy ?? 1 };
  const net = warpNet(m.style, m.bend, m.points ?? []);
  const local = warpControls(frame, net);
  const pts = local.map((p) => toScreen(apply(t, p)));
  const w = frame[2] - frame[0];
  const h = frame[3] - frame[1];
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const rect = (ref.current?.ownerSVGElement ?? document.body).getBoundingClientRect();
    return invert(t, renderer.toArt(e.clientX - rect.left, e.clientY - rect.top));
  };
  const lines: string[] = [];
  for (let j = 0; j < 4; j++) lines.push(pts.slice(j * 4, j * 4 + 4).map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(''));
  for (let i = 0; i < 4; i++) lines.push([0, 1, 2, 3].map((j, k) => `${k ? 'L' : 'M'}${pts[j * 4 + i].x} ${pts[j * 4 + i].y}`).join(''));
  return (
    <g ref={ref} className="warp-editor">
      {lines.map((d, i) => (
        <path key={i} className="we-line" d={d} />
      ))}
      {pts.map((p, k) => (
        <circle
          key={k}
          className={`we-point ${k === 0 || k === 3 || k === 12 || k === 15 ? 'corner' : ''}`}
          cx={p.x}
          cy={p.y}
          r={5}
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture(e.pointerId);
            const base: [number, number][] = Array.from({ length: 16 }, (_, i) => [...(m.points?.[i] ?? [0, 0])] as [number, number]);
            drag.current = { k, start: toLocal(e), base };
            beginGesture();
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const p2 = toLocal(e);
            const next = d.base.map((x) => [...x] as [number, number]);
            next[d.k] = [d.base[d.k][0] + (p2.x - d.start.x) / w, d.base[d.k][1] + (p2.y - d.start.y) / h];
            updateLayer(layer.id, (l) => {
              const mm = l.modifiers.find((x) => x.uid === uid);
              if (mm && mm.kind === 'warp') mm.points = next;
            }, 'warp-drag');
          }}
          onPointerUp={() => {
            drag.current = null;
            commitEdit();
          }}
        />
      ))}
    </g>
  );
}
