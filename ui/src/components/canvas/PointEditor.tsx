import { useEffect, useMemo, useRef, useState } from 'react';
import { updateLayer } from '../../app/actions';
import type { Renderer } from '../../render/renderer';
import { apply, invert, nearestOnSegment, parsePath, serializePath, splitSegment, toggleSmooth, type Contour, type Pt, type Xform } from '../../state/geometry';
import type { ShapeLayer } from '../../state/model';
import { beginGesture, commitEdit, store } from '../../state/store';

type Key = `${number}:${number}`;
type Part = 'node' | 'hin' | 'hout';

/** Point editor for an outline layer on the design canvas. */
export function PointEditor({ layer, toScreen, renderer }: { layer: ShapeLayer; toScreen: (p: Pt) => Pt; zoom: number; renderer: Renderer }) {
  const c = layer.content.type === 'path' || layer.content.type === 'line' ? layer.content : null;
  const t: Xform = { x: layer.x, y: layer.y, rotation: layer.rotation, scale: layer.scale, sx: layer.sx ?? 1, sy: layer.sy ?? 1 };
  const ref = useRef<SVGGElement>(null);
  if (!c) return null;
  return (
    <g ref={ref}>
      <PathPointEditor
        d={c.d}
        scale={c.size}
        lines={c.type === 'line'}
        pxPerUnit={renderer.view.zoom * layer.scale}
        toScreen={(p) => toScreen(apply(t, p))}
        toLocal={(e) => {
          const rect = (ref.current?.ownerSVGElement ?? document.body).getBoundingClientRect();
          return invert(t, renderer.toArt(e.clientX - rect.left, e.clientY - rect.top));
        }}
        onChange={(d, key) => updateLayer(layer.id, (l) => (l.content.type === 'path' || l.content.type === 'line') && (l.content.d = d), key)}
        onExit={() => store.set({ editing: null })}
        viewKey={`${renderer.view.zoom},${renderer.view.panX},${renderer.view.panY},${t.x},${t.y},${t.rotation},${t.scale},${t.sx},${t.sy}`}
      />
    </g>
  );
}

/**
 * Bezier point editing for any path. `d` is in units of `scale` (the editor
 * works in d × scale); `toScreen` / `toLocal` map that space to the overlay.
 */
export function PathPointEditor({
  d: source,
  scale: size,
  lines = false,
  pxPerUnit,
  toScreen: S,
  toLocal,
  onChange,
  onExit,
  viewKey,
}: {
  d: string;
  scale: number;
  /** Open subpaths stay open (pen lines); otherwise every contour is a closed outline. */
  lines?: boolean;
  pxPerUnit: number;
  toScreen: (p: Pt) => Pt;
  toLocal: (e: { clientX: number; clientY: number }) => Pt;
  onChange: (d: string, key: string) => void;
  onExit: () => void;
  viewKey: string;
}) {
  const parse = (d: string) => scaled(parsePath(d), size).map((c) => (lines ? c : { ...c, open: false }));
  const [contours, setContours] = useState<Contour[]>(() => parse(source));
  const [sel, setSel] = useState<Set<Key>>(new Set());
  const dragging = useRef<null | { part: Part; key: Key; start: Pt; base: Contour[]; moved: boolean }>(null);
  const svgRef = useRef<SVGGElement>(null);

  // Pick up outside changes (undo, inspector edits) when not dragging.
  const lastWritten = useRef(source);
  useEffect(() => {
    if (dragging.current || source === lastWritten.current) return;
    lastWritten.current = source;
    setContours(parse(source));
  }, [source, size]);

  const write = (cs: Contour[], key: string) => {
    const d = serializePath(scaled(cs, 1 / size));
    lastWritten.current = d;
    onChange(d, key);
  };

  const begin = (e: React.PointerEvent, part: Part, key: Key) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    if (part === 'node') {
      if (e.shiftKey) {
        const next = new Set(sel);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setSel(next);
      } else if (!sel.has(key)) setSel(new Set([key]));
    }
    dragging.current = { part, key, start: toLocal(e), base: structuredClone(contours), moved: false };
    beginGesture();
  };

  const move = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    const p = toLocal(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) * pxPerUnit < 2) return;
    d.moved = true;
    const next = structuredClone(d.base);
    const [ci, ni] = d.key.split(':').map(Number);
    if (d.part === 'node') {
      const keys = sel.has(d.key) ? sel : new Set([d.key]);
      for (const k of keys) {
        const [a, b] = k.split(':').map(Number);
        const n = next[a]?.nodes[b];
        if (!n) continue;
        n.x += dx;
        n.y += dy;
        if (n.hin) n.hin = { x: n.hin.x + dx, y: n.hin.y + dy };
        if (n.hout) n.hout = { x: n.hout.x + dx, y: n.hout.y + dy };
      }
    } else {
      const n = next[ci].nodes[ni];
      const h = n[d.part]!;
      const moved = { x: h.x + dx, y: h.y + dy };
      n[d.part] = moved;
      const other = d.part === 'hin' ? 'hout' : 'hin';
      const o = d.base[ci].nodes[ni][other];
      const orig = d.base[ci].nodes[ni][d.part]!;
      // Keep smooth nodes smooth: mirror the direction, keep the other length.
      if (o && !e.altKey && isSmooth(n, orig, o)) {
        const len = Math.hypot(o.x - n.x, o.y - n.y);
        const vx = moved.x - n.x;
        const vy = moved.y - n.y;
        const vl = Math.hypot(vx, vy) || 1;
        n[other] = { x: n.x - (vx / vl) * len, y: n.y - (vy / vl) * len };
      }
    }
    setContours(next);
    write(next, 'points-drag');
  };

  const end = () => {
    dragging.current = null;
    commitEdit();
  };

  // Keyboard: delete points, nudge, leave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onExit();
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && sel.size) {
        e.preventDefault();
        e.stopPropagation();
        const next = structuredClone(contours)
          .map((cc, ci) => ({ nodes: cc.nodes.filter((_, ni) => !sel.has(`${ci}:${ni}`)) }))
          .filter((cc) => cc.nodes.length >= 2);
        setSel(new Set());
        setContours(next);
        write(next, '');
        return;
      }
      if (e.key.startsWith('Arrow') && sel.size) {
        e.preventDefault();
        e.stopPropagation();
        const step = (e.shiftKey ? 10 : 1) / Math.max(1e-6, pxPerUnit);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const next = structuredClone(contours);
        for (const k of sel) {
          const [a, b] = k.split(':').map(Number);
          const n = next[a]?.nodes[b];
          if (!n) continue;
          n.x += dx;
          n.y += dy;
          if (n.hin) n.hin = { x: n.hin.x + dx, y: n.hin.y + dy };
          if (n.hout) n.hout = { x: n.hout.x + dx, y: n.hout.y + dy };
        }
        setContours(next);
        write(next, 'points-nudge');
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();
        setSel(new Set(contours.flatMap((cc, ci) => cc.nodes.map((_, ni) => `${ci}:${ni}` as Key))));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const insertAt = (e: React.MouseEvent, ci: number) => {
    e.stopPropagation();
    const p = toLocal(e);
    const cc = contours[ci];
    let best = { k: 0, t: 0, d: Infinity };
    for (let k = 0; k < (cc.open ? cc.nodes.length - 1 : cc.nodes.length); k++) {
      const r = nearestOnSegment(cc, k, p);
      if (r.d < best.d) best = { k, t: r.t, d: r.d };
    }
    const next = structuredClone(contours);
    splitSegment(next[ci], best.k, best.t);
    setContours(next);
    setSel(new Set([`${ci}:${best.k + 1}` as Key]));
    write(next, '');
  };

  const paths = useMemo(
    () =>
      contours.map((cc) => {
        const n = cc.nodes.length;
        let d = '';
        cc.nodes.forEach((a, k) => {
          const pa = S(a);
          if (k === 0) d += `M${pa.x} ${pa.y}`;
          if (cc.open && k === n - 1) return;
          const b = cc.nodes[(k + 1) % n];
          const c1 = S(a.hout ?? a);
          const c2 = S(b.hin ?? b);
          const pb = S(b);
          d += `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${pb.x} ${pb.y}`;
        });
        return cc.open ? d : d + 'Z';
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contours, viewKey],
  );

  return (
    <g ref={svgRef} className="point-editor" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {paths.map((d, ci) => (
        <path key={ci} className="pe-path" d={d} onDoubleClick={(e) => insertAt(e, ci)} onPointerDown={(e) => (e.stopPropagation(), setSel(new Set()))} />
      ))}
      {contours.map((cc, ci) =>
        cc.nodes.map((n, ni) => {
          const key = `${ci}:${ni}` as Key;
          const on = sel.has(key);
          const p = S(n);
          return (
            <g key={key}>
              {on &&
                (['hin', 'hout'] as const).map((h) => {
                  const hp = n[h];
                  if (!hp) return null;
                  const q = S(hp);
                  return (
                    <g key={h}>
                      <line className="pe-arm" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
                      <circle className="pe-handle" cx={q.x} cy={q.y} r={3.5} onPointerDown={(e) => begin(e, h, key)} onPointerMove={move} onPointerUp={end} />
                    </g>
                  );
                })}
              <rect
                className={`pe-node ${on ? 'on' : ''} ${n.hin || n.hout ? 'smooth' : ''}`}
                x={p.x - 4}
                y={p.y - 4}
                width={8}
                height={8}
                rx={n.hin || n.hout ? 4 : 1.5}
                onPointerDown={(e) => begin(e, 'node', key)}
                onPointerMove={move}
                onPointerUp={end}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const next = structuredClone(contours);
                  toggleSmooth(next[ci], ni);
                  setContours(next);
                  write(next, '');
                }}
              />
            </g>
          );
        }),
      )}
    </g>
  );
}

function scaled(cs: Contour[], k: number): Contour[] {
  const s = (p: Pt) => ({ x: p.x * k, y: p.y * k });
  return cs.map((c) => ({ open: c.open, nodes: c.nodes.map((n) => ({ ...s(n), hin: n.hin && s(n.hin), hout: n.hout && s(n.hout) })) }));
}

function isSmooth(n: Pt, h: Pt, o: Pt) {
  const a = Math.atan2(h.y - n.y, h.x - n.x);
  const b = Math.atan2(o.y - n.y, o.x - n.x);
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return Math.abs(d - Math.PI) < 0.2;
}
