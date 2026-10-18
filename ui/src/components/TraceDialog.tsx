import { useEffect, useRef, useState } from 'react';
import { addShape } from '../app/actions';
import { engine } from '../engine/client';
import type { TraceOptions, TraceOut } from '../engine/types';
import { parsePath, serializePath } from '../state/geometry';
import { pathLayer, style } from '../state/model';
import { edit, store, toast } from '../state/store';
import { Dialog, Slider, Toggle } from './ui';

/** Fit a traced outline (1 em box, centred) onto the baseline of a glyph. */
export function placeOnBaseline(d: string, aspect: number, height = 0.7): { d: string; advance: number } {
  const cs = parsePath(d);
  // Traced paths fit a unit box centred on 0; scale so the height is `height` em.
  const h = aspect >= 1 ? 1 / aspect : 1;
  const w = aspect >= 1 ? 1 : aspect;
  const k = height / h;
  const side = 0.06;
  const map = (p: { x: number; y: number }) => ({ x: (p.x + w / 2) * k + side, y: (p.y - h / 2) * k });
  for (const c of cs)
    for (const n of c.nodes) {
      Object.assign(n, map(n));
      if (n.hin) n.hin = map(n.hin);
      if (n.hout) n.hout = map(n.hout);
    }
  return { d: serializePath(cs), advance: w * k + side * 2 };
}

export function TraceDialog({ image, name, target }: { image: ImageData; name: string; target: 'layer' | 'glyph' }) {
  const [opts, setOpts] = useState<TraceOptions>({ threshold: null, invert: false, smooth: 1.5, despeckle: 24, pixel: false });
  const [result, setResult] = useState<TraceOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const srcRef = useRef<HTMLCanvasElement>(null);
  const close = () => store.set({ dialog: null });

  useEffect(() => {
    const c = srcRef.current;
    if (!c) return;
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d')?.putImageData(image, 0, 0);
  }, [image]);

  useEffect(() => {
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      engine
        .trace(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength), image.width, image.height, opts)
        .then(
          (r) => {
            if (!live) return;
            setResult(r);
            setError(null);
          },
          (e: Error) => live && (setResult(null), setError(e.message)),
        )
        .finally(() => live && setBusy(false));
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [image, opts]);

  const set = (patch: Partial<TraceOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const accept = () => {
    if (!result) return;
    if (target === 'glyph') {
      const ch = store.get().glyph;
      const placed = placeOnBaseline(result.d, result.aspect);
      edit((p) => {
        if (!p.type) return;
        p.type.glyphs[ch] = { ...(p.type.glyphs[ch] ?? {}), d: placed.d, advance: placed.advance };
        if (!p.type.charset.includes(ch)) p.type.charset += ch;
      });
      toast(`Traced into “${ch}”`);
    } else {
      addShape(pathLayer(result.d, 640, name, { style: style('flat') }));
      toast(`Traced ${name}. Break apart (⇧⌘B) to get one layer per letter.`);
    }
    close();
  };
  return (
    <Dialog
      title="Trace image"
      subtitle={target === 'glyph' ? `Becomes the outline of “${store.get().glyph}”.` : 'Turns dark areas of the picture into a smooth vector outline.'}
      onClose={close}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!result} onClick={accept}>
            {target === 'glyph' ? 'Use as glyph' : 'Add as layer'}
          </button>
        </>
      }
    >
      <div className="trace">
        <div className="trace-previews">
          <figure>
            <canvas ref={srcRef} />
            <figcaption>Original</figcaption>
          </figure>
          <figure>
            <svg viewBox="-0.55 -0.55 1.1 1.1" className={busy ? 'busy' : ''}>
              {result && <path d={result.d} fill="currentColor" fillRule="nonzero" />}
            </svg>
            <figcaption>{error ?? (result ? `${result.contours} contours` : 'Tracing…')}</figcaption>
          </figure>
        </div>
        <div className="trace-controls">
          <Toggle label="Automatic threshold" checked={opts.threshold === null} onChange={(v) => set({ threshold: v ? null : 0.5 })} />
          {opts.threshold !== null && <Slider label="Threshold" value={opts.threshold} min={0.01} max={0.99} step={0.01} onChange={(v) => set({ threshold: v })} />}
          <Toggle label="Invert (trace light areas)" checked={opts.invert} onChange={(v) => set({ invert: v })} />
          <Toggle label="Keep hard pixel edges" checked={opts.pixel} onChange={(v) => set({ pixel: v })} />
          {!opts.pixel && <Slider label="Smoothing" value={opts.smooth} min={0} max={12} step={0.1} onChange={(v) => set({ smooth: v })} />}
          <Slider label="Ignore specks" value={opts.despeckle} min={0} max={2000} step={1} suffix="px²" onChange={(v) => set({ despeckle: v })} />
        </div>
      </div>
    </Dialog>
  );
}
