import { useEffect, useMemo, useRef, useState } from 'react';
import { addNode, addShape, placePhoto, placeReference, setBackground } from '../app/actions';
import { engine } from '../engine/client';
import type { TraceOptions, TraceOut } from '../engine/types';
import { parsePath, serializePath } from '../state/geometry';
import { group, pathLayer, style } from '../state/model';
import { colorPath, drawPixelArt, drawQuantized, fitGradient, maskBounds, PALETTES, pixelArt, quantize, stackedMasks, type PixelArtOptions } from '../state/pixelArt';
import { edit, store, toast } from '../state/store';
import { Dialog, Segmented, Select, Slider, Toggle } from './ui';

/** Fit a traced outline (1 em box, centred) onto the baseline of a glyph. */
export function placeOnBaseline(d: string, aspect: number, height = 0.7): { d: string; advance: number } {
  const cs = parsePath(d);
  // Traced paths fit a unit box centred on 0; scale so the height is `height` em.
  const h = aspect >= 1 ? 1 / aspect : 1;
  const w = aspect >= 1 ? 1 : aspect;
  const k = height / h;
  const side = 0.06;
  const map = (p: { x: number; y: number }) => ({
    x: (p.x + w / 2) * k + side,
    y: (p.y - h / 2) * k,
  });
  for (const c of cs)
    for (const n of c.nodes) {
      Object.assign(n, map(n));
      if (n.hin) n.hin = map(n.hin);
      if (n.hout) n.hout = map(n.hout);
    }
  return { d: serializePath(cs), advance: w * k + side * 2 };
}

export function TraceDialog({ image, name, target }: { image: ImageData; name: string; target: 'layer' | 'glyph' }) {
  const [opts, setOpts] = useState<TraceOptions>({
    threshold: null,
    invert: false,
    smooth: 1.5,
    despeckle: 24,
    pixel: false,
  });
  const [result, setResult] = useState<TraceOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'photo' | 'outline' | 'pixel' | 'reference'>(target === 'layer' ? 'photo' : 'outline');
  const srcRef = useRef<HTMLCanvasElement>(null);
  const close = () => store.set({ dialog: null });
  // Colour tracing: more than one ink makes one vector layer per colour.
  const [inks, setInks] = useState(1);
  const [inkBg, setInkBg] = useState(true);
  const [gradients, setGradients] = useState(true);
  const quant = useMemo(() => (mode === 'outline' && inks > 1 ? quantize(image, inks) : null), [image, inks, mode]);
  const quantBg = quant ? quant.counts.indexOf(Math.max(...quant.counts)) : null;
  const quantRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (quant && quantRef.current) drawQuantized(quantRef.current, quant, inkBg ? quantBg : null);
  });

  useEffect(() => {
    const c = srcRef.current;
    if (!c) return;
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d')?.putImageData(image, 0, 0);
  }, [image]);

  useEffect(() => {
    // Only trace when the one-ink Trace view is showing.
    if (mode !== 'outline' || inks > 1) return setBusy(false);
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
      setBusy(false);
    };
  }, [image, opts, mode, inks]);

  const set = (patch: Partial<TraceOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const [pix, setPix] = useState<PixelArtOptions>({
    cells: 32,
    colors: 4,
    palette: null,
    dither: 0,
    shape: 'square',
  });
  const [paletteName, setPaletteName] = useState(PALETTES[0].name);
  const [dropBg, setDropBg] = useState(true);
  const pixRef = useRef<HTMLCanvasElement>(null);
  const art = mode === 'pixel' ? pixelArt(image, pix) : null;
  const bgIndex = art ? art.counts.indexOf(Math.max(...art.counts)) : null;
  useEffect(() => {
    if (art && pixRef.current) drawPixelArt(pixRef.current, art, pix.shape, dropBg ? bgIndex : null);
  });
  const acceptPixels = () => {
    if (!art) return;
    const p = store.get().project;
    const size = Math.min(p.canvas.width, p.canvas.height) * 0.8;
    const layers = art.palette
      .map((c, i) => ({ c, i }))
      .filter(({ i }) => art.counts[i] > 0 && !(dropBg && i === bgIndex))
      .map(({ c, i }) =>
        pathLayer(colorPath(art, i, pix.shape), size, `Ink ${c}`, {
          style: style('flat', { fill: c }),
        }),
      );
    if (dropBg && bgIndex !== null)
      setBackground(
        (b) =>
          (b.fill = {
            kind: 'solid',
            colors: [art.palette[bgIndex]],
            angle: 180,
          }),
      );
    addNode(group(layers, { name: `${name} pixels`, open: false }));
    toast(`${layers.length} ink layers, ${art.cols}×${art.rows} pixels. Recolour or restyle each one.`);
    close();
  };
  /** Trace each ink of the quantized picture into a stacked colour layer. */
  const acceptColours = async () => {
    if (!quant) return;
    setBusy(true);
    try {
      const skip = inkBg ? quantBg : null;
      const p = store.get().project;
      const size = Math.min(p.canvas.width, p.canvas.height) * 0.86;
      const layers = [];
      for (const [ci, mask] of stackedMasks(quant, skip)) {
        // A colour that's only specks (anti-aliased edges) traces to nothing: skip it.
        const r = await engine.trace(mask, quant.w, quant.h, { ...opts, threshold: 0.5, invert: false, frame: true, maxSize: 1400 }).catch(() => null);
        if (!r) continue;
        const c = quant.palette[ci];
        // Shading in the picture becomes a fitted linear gradient on the layer.
        const gr = gradients ? fitGradient(quant, ci, maskBounds(mask, quant.w, quant.h)) : null;
        layers.push(pathLayer(r.d, size, `Colour ${c}`, { style: style('flat', gr ? { fill: gr.fill, fill2: gr.fill2, gradient: 1, angle: gr.angle, gradStart: gr.gradStart, gradEnd: gr.gradEnd } : { fill: c }) }));
      }
      if (!layers.length) return toast('Nothing to trace in those colours.', 'error');
      if (skip !== null) setBackground((b) => (b.fill = { kind: 'solid', colors: [quant.palette[skip]], angle: 180 }));
      addNode(group(layers, { name: `${name} vector`, open: false }));
      toast(`${layers.length} colour layers, each a smooth editable outline`);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const accept = () => {
    if (mode === 'pixel') return acceptPixels();
    if (mode === 'outline' && inks > 1 && target === 'layer') return void acceptColours();
    if (mode === 'photo') {
      placePhoto(image, name);
      return close();
    }
    if (mode === 'reference') {
      placeReference(image, name);
      return close();
    }
    if (!result) return;
    if (target === 'glyph') {
      const ch = store.get().glyph;
      const placed = placeOnBaseline(result.d, result.aspect);
      edit((p) => {
        if (!p.type) return;
        p.type.glyphs[ch] = {
          ...(p.type.glyphs[ch] ?? {}),
          d: placed.d,
          advance: placed.advance,
        };
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
      title={target === 'glyph' ? 'Trace image' : 'Add image'}
      subtitle={target === 'glyph' ? `Becomes the outline of “${store.get().glyph}”.` : mode === 'photo' ? 'Use the picture as it is, inside any shape.' : mode === 'reference' ? 'A faded, locked picture under your artwork to trace with the pen. It never exports.' : mode === 'pixel' ? 'Turns the picture into pixel art with a few inks, one layer per colour.' : 'Turns dark areas of the picture into a smooth vector outline.'}
      onClose={close}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={mode === 'outline' && (inks > 1 ? !quant || busy : !result)} onClick={accept}>
            {target === 'glyph' ? 'Use as glyph' : mode === 'photo' ? 'Place photo' : mode === 'reference' ? 'Trace over it' : mode === 'pixel' ? 'Add pixel art' : 'Add as layer'}
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
          {mode === 'photo' || mode === 'reference' ? null : mode === 'pixel' && art ? (
            <figure>
              <canvas ref={pixRef} className="pixel-preview" />
              <figcaption>
                {art.cols}×{art.rows} · {art.palette.filter((_, i) => art.counts[i] > 0).length} inks
              </figcaption>
            </figure>
          ) : quant ? (
            <figure>
              <canvas ref={quantRef} className="pixel-preview smooth" />
              <figcaption>{error ?? (busy ? 'Tracing each colour…' : `${quant.palette.filter((_, i) => quant.counts[i] > 0 && !(inkBg && i === quantBg)).length} colour layers`)}</figcaption>
            </figure>
          ) : (
            <figure>
              <svg viewBox="-0.55 -0.55 1.1 1.1" className={busy ? 'busy' : ''}>
                {result && <path d={result.d} fill="currentColor" fillRule="nonzero" />}
              </svg>
              <figcaption>{error ?? (result ? `${result.contours} contours` : 'Tracing…')}</figcaption>
            </figure>
          )}
        </div>
        <div className="trace-side">
          {target === 'layer' && (
            <Segmented
              value={mode}
              options={[
                { value: 'photo', label: 'Photo' },
                { value: 'outline', label: 'Trace' },
                { value: 'pixel', label: 'Pixel art' },
                { value: 'reference', label: 'Reference' },
              ]}
              onChange={setMode}
            />
          )}
          {mode === 'reference' ? (
            <div className="trace-controls">
              <p className="hint">Recreate a logo or icon exactly: the picture sits under everything at 40% opacity, locked, and the pen tool turns on. Click and drag along its edges; close shapes on their first point. Delete the reference when you're done, or keep it: it never shows in PNG, SVG or project previews.</p>
            </div>
          ) : mode === 'photo' ? (
            <div className="trace-controls">
              <p className="hint">Places the picture as a rectangle with the Photo material. Swap the shape for any other (a circle, a star, your text) and the photo stays inside; Style has zoom, pan, duotone and grain.</p>
            </div>
          ) : mode === 'pixel' ? (
            <div className="trace-controls">
              <Slider label="Pixels across" value={pix.cells} min={4} max={160} step={1} onChange={(v) => setPix({ ...pix, cells: Math.round(v) })} />
              <div className="field">
                <span>Palette</span>
                <Select
                  value={paletteName}
                  options={PALETTES.map((p) => ({
                    value: p.name,
                    label: p.name,
                  }))}
                  onChange={(v) => {
                    setPaletteName(v);
                    setPix({
                      ...pix,
                      palette: PALETTES.find((p) => p.name === v)?.colors ?? null,
                    });
                  }}
                />
              </div>
              {!pix.palette && <Slider label="Colours" value={pix.colors} min={2} max={8} step={1} onChange={(v) => setPix({ ...pix, colors: Math.round(v) })} />}
              <Slider label="Dither" value={pix.dither} min={0} max={1} step={0.01} onChange={(v) => setPix({ ...pix, dither: v })} />
              <div className="field">
                <span>Cells</span>
                <Segmented
                  size="sm"
                  value={pix.shape}
                  options={[
                    { value: 'square', label: 'Squares' },
                    { value: 'dot', label: 'Dots' },
                  ]}
                  onChange={(v) =>
                    setPix({
                      ...pix,
                      shape: v,
                      cells: v === 'dot' ? Math.min(pix.cells, 90) : pix.cells,
                    })
                  }
                />
              </div>
              <Toggle label="Use the most common colour as the background" checked={dropBg} onChange={setDropBg} />
            </div>
          ) : (
            <div className="trace-controls">
              {target === 'layer' && <Slider label="Colours" value={inks} min={1} max={8} step={1} onChange={(v) => setInks(Math.round(v))} />}
              {inks > 1 ? (
                <>
                  <Toggle label="Use the most common colour as the background" checked={inkBg} onChange={setInkBg} />
                  <Toggle label="Keep shading as gradients" checked={gradients} onChange={setGradients} hint="Fit a linear gradient to each colour region from the picture (flat colours stay flat)" />
                  <p className="hint">Each colour becomes its own smooth vector layer, stacked largest first so no gaps show between them. Best for flat logos, icons and stickers.</p>
                </>
              ) : (
                <>
                  <Toggle label="Automatic threshold" checked={opts.threshold === null} onChange={(v) => set({ threshold: v ? null : 0.5 })} />
                  {opts.threshold !== null && <Slider label="Threshold" value={opts.threshold} min={0.01} max={0.99} step={0.01} onChange={(v) => set({ threshold: v })} />}
                  <Toggle label="Invert (trace light areas)" checked={opts.invert} onChange={(v) => set({ invert: v })} />
                </>
              )}
              <Toggle label="Keep hard pixel edges" checked={opts.pixel} onChange={(v) => set({ pixel: v })} />
              {!opts.pixel && <Slider label="Smoothing" value={opts.smooth} min={0} max={12} step={0.1} onChange={(v) => set({ smooth: v })} />}
              <Slider label="Ignore specks" value={opts.despeckle} min={0} max={2000} step={1} suffix="px²" onChange={(v) => set({ despeckle: v })} />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
