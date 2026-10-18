import { useEffect, useRef, useState } from 'react';
import { addLayer } from '../app/actions';
import { engine } from '../engine/client';
import type { TraceOptions, TraceOut } from '../engine/types';
import { pathLayer } from '../state/model';
import { store, toast } from '../state/store';
import { Dialog, Slider } from './controls';

export function TraceDialog({ image, name }: { image: ImageData; name: string }) {
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
  return (
    <Dialog title="Trace image" onClose={close} wide>
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
          <label className="check">
            <input type="checkbox" checked={opts.threshold === null} onChange={(e) => set({ threshold: e.target.checked ? null : 0.5 })} /> Automatic threshold
          </label>
          {opts.threshold !== null && <Slider label="Threshold" value={opts.threshold} min={0.01} max={0.99} step={0.01} onChange={(v) => set({ threshold: v })} />}
          <label className="check">
            <input type="checkbox" checked={opts.invert} onChange={(e) => set({ invert: e.target.checked })} /> Invert (trace light areas)
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.pixel} onChange={(e) => set({ pixel: e.target.checked })} /> Keep hard pixel edges
          </label>
          {!opts.pixel && <Slider label="Smoothing" value={opts.smooth} min={0} max={12} step={0.1} onChange={(v) => set({ smooth: v })} />}
          <Slider label="Ignore specks" value={opts.despeckle} min={0} max={2000} step={1} suffix="px²" onChange={(v) => set({ despeckle: v })} />
          <div className="dialog-actions">
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!result}
              onClick={() => {
                if (!result) return;
                addLayer(pathLayer(result.d, 640, name));
                toast(`Traced ${name}`);
                close();
              }}
            >
              Add as layer
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
