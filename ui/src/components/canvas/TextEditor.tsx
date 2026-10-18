// Typing on the canvas. A hidden textarea owns the text, selection and IME;
// the caret and selection are drawn from the engine's own layout, so they sit
// exactly on the rendered letters whatever the font or material. Distortions
// that move letters (warp, arc…) pause while typing and come back after.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { endTextEdit, updateLayer } from '../../app/actions';
import { engine } from '../../engine/client';
import type { Content, TextLayout } from '../../engine/types';
import { primaryColor, recolor } from '../../render/palette';
import type { Renderer } from '../../render/renderer';
import { apply, invert, type Pt, type Xform } from '../../state/geometry';
import { isGroup, type ShapeLayer, type Style } from '../../state/model';
import { commitEdit, edit, redo, store, undo, useStore } from '../../state/store';
import { ancestors, findNode, POSITIONAL, removeNodes } from '../../state/tree';
import { ColorChip } from '../ColorPicker';
import { FontPicker } from '../FontPicker';
import { Icon } from '../icons';
import { NumberBox, Segmented } from '../ui';

type TextContent = Extract<Content, { type: 'text' }>;

const xf = (l: ShapeLayer): Xform => ({ x: l.x, y: l.y, rotation: l.rotation, scale: l.scale, sx: l.sx ?? 1, sy: l.sy ?? 1 });

/** Line and x of a UTF-16 offset. */
function caretPos(layout: TextLayout, i: number) {
  let li = layout.lines.findIndex((l, k) => i >= l.start && (k === layout.lines.length - 1 || i < layout.lines[k + 1].start));
  if (li < 0) li = layout.lines.length - 1;
  const line = layout.lines[li];
  const k = Math.max(0, Math.min(line.carets.length - 1, i - line.start));
  return { line, li, x: line.carets[k] };
}

/** Nearest caret offset to a local point. */
function indexAt(layout: TextLayout, p: Pt): number {
  let best = layout.lines[0];
  let bd = Infinity;
  for (const l of layout.lines) {
    const d = Math.abs(p.y - (l.baseline - layout.cap / 2));
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  let k = 0;
  let kd = Infinity;
  best.carets.forEach((x, j) => {
    const d = Math.abs(x - p.x);
    if (d < kd) {
      kd = d;
      k = j;
    }
  });
  return best.start + k;
}

function wordAt(text: string, i: number): [number, number] {
  const isWord = (c: string) => /[\p{L}\p{N}_'’-]/u.test(c);
  let a = i;
  let b = i;
  if (!isWord(text[i] ?? '') && isWord(text[i - 1] ?? '')) a = b = i - 1;
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  return b > a ? [a, b] : [i, Math.min(text.length, i + 1)];
}

/** Where a layer's look lives: itself, or the merged group it belongs to. */
function styleOwner(id: string): { id: string; style: Style } | null {
  const p = store.get().project;
  const merged = [...ancestors(p.layers, id)].reverse().find((g) => isGroup(g) && g.merge);
  const n = merged ?? findNode(p.layers, id);
  return n ? { id: n.id, style: n.style } : null;
}

export function TextEditor({ renderer: r, tick }: { renderer: Renderer; tick: number }) {
  const editing = useStore((s) => s.editing);
  const layer = useStore((s) => (s.editing?.kind === 'text' ? findNode(s.project.layers, s.editing.id) : undefined));
  if (editing?.kind !== 'text' || !layer || isGroup(layer) || layer.content.type !== 'text') return null;
  return <Editing key={layer.id} layer={layer} content={layer.content} renderer={r} tick={tick} initial={editing} />;
}

function Editing({
  layer,
  content: c,
  renderer: r,
  tick,
  initial,
}: {
  layer: ShapeLayer;
  content: TextContent;
  renderer: Renderer;
  tick: number;
  initial: { select?: [number, number]; at?: Pt };
}) {
  void tick;
  const ta = useRef<HTMLTextAreaElement>(null);
  const [layout, setLayout] = useState<TextLayout | null>(null);
  const [sel, setSel] = useState<[number, number]>(initial.select ?? [c.text.length, c.text.length]);
  const pending = useRef(initial);
  const drag = useRef<{ anchor: number } | null>(null);
  const clicks = useRef({ t: 0, n: 0, x: 0, y: 0 });
  const paused = layer.modifiers.some((m) => m.on && POSITIONAL.has(m.kind));
  useStore((s) => s.project);
  const owner = styleOwner(layer.id);

  const layoutKey = JSON.stringify(c);
  useEffect(() => {
    let live = true;
    engine.textLayout(c).then(
      (l) => live && setLayout(l),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  // Place the caret where the user clicked once the first layout arrives.
  useEffect(() => {
    const p = pending.current;
    if (!layout || !p.at) return;
    const i = indexAt(layout, invert(xf(layer), p.at));
    setRange(...wordAt(c.text, i));
    pending.current = {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useLayoutEffect(() => {
    const focus = () => {
      const el = ta.current;
      if (!el || document.activeElement === el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(sel[0], sel[1]);
    };
    focus();
    // A click that started editing may move focus after this runs.
    const raf = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // However editing ends (Esc, another tool, undo…), don't leave an empty text behind.
  useEffect(
    () => () => {
      commitEdit();
      queueMicrotask(() => {
        const n = findNode(store.get().project.layers, layer.id);
        if (n && !isGroup(n) && n.content.type === 'text' && !n.content.text.trim() && store.get().editing?.id !== layer.id) {
          edit((p) => {
            removeNodes(p.layers, new Set([layer.id]));
          });
          store.set({ selection: store.get().selection.filter((x) => x !== layer.id) });
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const readSel = () => {
    const el = ta.current;
    if (el) setSel([el.selectionStart, el.selectionEnd]);
  };
  const setRange = (a: number, b: number) => {
    const el = ta.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (a <= b) el.setSelectionRange(a, b, 'forward');
    else el.setSelectionRange(b, a, 'backward');
    setSel([Math.min(a, b), Math.max(a, b)]);
  };

  useEffect(() => {
    const on = () => document.activeElement === ta.current && readSel();
    document.addEventListener('selectionchange', on);
    return () => document.removeEventListener('selectionchange', on);
  }, []);

  // ---------- geometry ----------

  const z = r.view.zoom;
  const ar = r.artRect();
  const tx = ar.x + (r.artboard.w / 2) * z;
  const ty = ar.y + (r.artboard.h / 2) * z;
  const t = xf(layer);
  const S = (p: Pt) => {
    const a = apply(t, p);
    return { x: tx + a.x * z, y: ty + a.y * z };
  };
  const toLocal = (e: { clientX: number; clientY: number }, el: Element) => {
    const rect = (el.closest('.viewport') ?? el).getBoundingClientRect();
    const art = { x: (e.clientX - rect.left - tx) / z, y: (e.clientY - rect.top - ty) / z };
    return invert(t, art);
  };
  const quad = (x0: number, y0: number, x1: number, y1: number) =>
    [S({ x: x0, y: y0 }), S({ x: x1, y: y0 }), S({ x: x1, y: y1 }), S({ x: x0, y: y1 })].map((p) => `${p.x},${p.y}`).join(' ');

  const frame = useMemo(() => {
    if (!layout) return null;
    const xs = layout.lines.flatMap((l) => [l.carets[0], l.carets.at(-1)!]);
    const pad = 6 / (z * t.scale);
    return {
      x0: Math.min(...xs) - pad,
      x1: Math.max(...xs) + pad,
      y0: layout.lines[0].baseline - layout.ascent - pad,
      y1: layout.lines.at(-1)!.baseline + layout.descent + pad,
    };
  }, [layout, z, t.scale]);

  const caretHead = layout ? caretPos(layout, sel[1]) : null;

  // ---------- pointer ----------

  const onDown = (e: React.PointerEvent<SVGPolygonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (!layout || e.button !== 0) return;
    const now = performance.now();
    const k = clicks.current;
    k.n = now - k.t < 400 && Math.hypot(e.clientX - k.x, e.clientY - k.y) < 6 ? k.n + 1 : 1;
    Object.assign(k, { t: now, x: e.clientX, y: e.clientY });
    const i = indexAt(layout, toLocal(e, e.currentTarget));
    if (k.n === 2) {
      setRange(...wordAt(c.text, i));
      return;
    }
    if (k.n >= 3) {
      const { line } = caretPos(layout, i);
      setRange(line.start, line.start + line.carets.length - 1);
      return;
    }
    const anchor = e.shiftKey ? (ta.current?.selectionDirection === 'backward' ? sel[1] : sel[0]) : i;
    setRange(anchor, i);
    drag.current = { anchor };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<SVGPolygonElement>) => {
    if (!drag.current || !layout) return;
    setRange(drag.current.anchor, indexAt(layout, toLocal(e, e.currentTarget)));
  };
  const onUp = () => {
    drag.current = null;
  };

  // ---------- typing ----------

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' || (e.key === 'Enter' && mod)) {
      e.preventDefault();
      e.stopPropagation();
      endTextEdit();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      return;
    }
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.code === 'KeyY') {
      e.preventDefault();
      redo();
      return;
    }
    requestAnimationFrame(readSel);
  };

  const setC = (fn: (x: TextContent) => void, key = '') => updateLayer(layer.id, (l) => l.content.type === 'text' && fn(l.content), key);
  const refocus = () => requestAnimationFrame(() => ta.current?.focus({ preventScroll: true }));

  // ---------- render ----------

  const selRects: string[] = [];
  if (layout && sel[0] !== sel[1]) {
    for (const l of layout.lines) {
      const end = l.start + l.carets.length - 1;
      const a = Math.max(sel[0], l.start);
      const b = Math.min(sel[1], end);
      // A line break inside the selection shows as a sliver at the line end.
      const wraps = sel[1] > end && sel[0] <= end;
      if (a >= b && !wraps) continue;
      const xa = l.carets[a - l.start];
      const xb = (a < b ? l.carets[b - l.start] : xa) + (wraps ? layout.cap * 0.2 : 0);
      selRects.push(quad(xa, l.baseline - layout.ascent, xb, l.baseline + layout.descent));
    }
  }
  const caret = caretHead && layout ? [S({ x: caretHead.x, y: caretHead.line.baseline - layout.ascent }), S({ x: caretHead.x, y: caretHead.line.baseline + layout.descent })] : null;
  const top = frame ? [S({ x: frame.x0, y: frame.y0 }), S({ x: frame.x1, y: frame.y0 }), S({ x: frame.x1, y: frame.y1 }), S({ x: frame.x0, y: frame.y1 })] : null;
  const barY = top ? Math.min(...top.map((p) => p.y)) - 52 : 0;
  const barX = top ? (Math.min(...top.map((p) => p.x)) + Math.max(...top.map((p) => p.x))) / 2 : 0;
  const fontPx = Math.max(8, Math.min(400, c.size * t.scale * Math.abs(t.sy) * z));
  const color = owner ? primaryColor(owner.style) : null;

  return (
    <div className="text-edit">
      <svg className="text-edit-svg" width="100%" height="100%">
        {top && <polygon className="text-frame" points={top.map((p) => `${p.x},${p.y}`).join(' ')} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} style={{ cursor: 'text' }} />}
        {selRects.map((q, i) => (
          <polygon key={i} className="text-sel" points={q} />
        ))}
        {caret && sel[0] === sel[1] && <line key={`${sel[1]}-${c.text.length}`} className="text-caret" x1={caret[0].x} y1={caret[0].y} x2={caret[1].x} y2={caret[1].y} />}
      </svg>
      <div className="text-ime" style={{ left: caret?.[0].x ?? 0, top: caret?.[0].y ?? 0 }}>
        <textarea
          ref={ta}
          value={c.text}
          aria-label="Text"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          style={{ fontFamily: `"mt-${c.font}", system-ui`, fontSize: fontPx, lineHeight: c.lineHeight }}
          onChange={(e) => {
            const v = e.target.value;
            const a = e.target.selectionStart;
            const b = e.target.selectionEnd;
            setC((x) => (x.text = v), 'inline-text');
            setSel([a, b]);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={readSel}
          onSelect={readSel}
        />
      </div>
      {top && (
        <div
          className="text-bar"
          style={{ left: barX, top: Math.max(8, barY) }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          role="toolbar"
          aria-label="Text"
        >
          <FontPicker value={c.font} onChange={(id) => id && (setC((x) => ((x.font = id), (x.axes = {}))), refocus())} />
          <div className="text-bar-size">
            <NumberBox label="Aa" value={c.size} min={4} max={2000} title="Font size" onChange={(v) => setC((x) => (x.size = Math.max(4, v)), 'size')} />
          </div>
          {owner && color && (
            <ColorChip
              label="Text colour"
              value={color}
              onChange={(v) => edit((p) => {
                const n = findNode(p.layers, owner.id);
                if (n) n.style = recolor(n.style, v);
              }, `inline-colour:${owner.id}`)}
            />
          )}
          <Segmented
            size="sm"
            value={c.align}
            options={[
              { value: 'left', icon: 'alignLeft', title: 'Align left' },
              { value: 'center', icon: 'alignHCenter', title: 'Centre' },
              { value: 'right', icon: 'alignRight', title: 'Align right' },
            ]}
            onChange={(a) => (setC((x) => (x.align = a)), refocus())}
          />
          <button className="btn small primary" onClick={() => endTextEdit()} data-tip="Finish" data-kbd="Esc">
            <Icon name="check" size={13} /> Done
          </button>
        </div>
      )}
      {paused && <div className="text-paused">Warp and other distortions are paused while you type</div>}
    </div>
  );
}
