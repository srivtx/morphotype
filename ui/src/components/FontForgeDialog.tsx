import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../engine/client';
import type { FontSpec, ModEntry } from '../engine/types';
import { platform } from '../platform';
import { textLayer } from '../state/model';
import { store, toast, useStore } from '../state/store';
import { Dialog, Slider } from './controls';
import { FontPicker } from './FontPicker';

const CHARSETS: Record<string, { label: string; chars: string | null }> = {
  latin1: { label: 'Latin + accents (≈190 glyphs)', chars: null },
  basic: { label: 'Basic Latin (A–Z, a–z, 0–9, punctuation)', chars: Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') },
  caps: { label: 'Capitals and figures only', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?&-' },
  custom: { label: 'Custom…', chars: '' },
};

/** Layout-level modifiers don't make sense inside single glyphs. */
const GLYPH_SAFE = (m: ModEntry) => m.on && m.kind !== 'arc' && m.kind !== 'perspective';

export function FontForgeDialog() {
  const fonts = useStore((s) => s.fonts);
  const selected = useStore((s) => s.project.layers.find((l) => l.id === s.selection));
  const fromLayer = selected?.content.type === 'text' ? selected : null;
  const textContent = fromLayer?.content.type === 'text' ? fromLayer.content : null;
  const [font, setFont] = useState(textContent?.font ?? fonts[0]?.id ?? 'archivo');
  const [morphFont, setMorphFont] = useState<string | null>(textContent?.morph?.font ?? null);
  const [t, setT] = useState(textContent?.morph?.t ?? 0.5);
  const [useMods, setUseMods] = useState(true);
  const baseInfo = fonts.find((f) => f.id === font)?.info;
  const [family, setFamily] = useState(`${baseInfo?.family ?? 'Morph'} Morph`);
  const [style, setStyle] = useState('Regular');
  const [charsetKey, setCharsetKey] = useState('latin1');
  const [custom, setCustom] = useState('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
  const [preview, setPreview] = useState('Sphinx of black quartz');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const close = () => store.set({ dialog: null });

  const modifiers = useMemo(() => (useMods && fromLayer ? fromLayer.modifiers.filter(GLYPH_SAFE) : []), [useMods, fromLayer]);
  const dropped = (fromLayer?.modifiers ?? []).filter((m) => m.on && !GLYPH_SAFE(m)).length;
  const morph = morphFont ? { font: morphFont, t, axes: {} } : null;
  const axes = textContent && textContent.font === font ? textContent.axes : {};

  useEffect(() => {
    let live = true;
    const layer = textLayer(preview || 'Aa', font, { modifiers }, { size: 100, axes, morph });
    engine.build({ layers: [layer], quality: 120 }).then((r) => {
      const c = canvasRef.current;
      if (!live || !c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth * dpr;
      const h = c.clientHeight * dpr;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      if (!r.bbox) return;
      const [x0, y0, x1, y1] = r.bbox;
      const s = Math.min((w * 0.92) / (x1 - x0), (h * 0.8) / (y1 - y0));
      ctx.setTransform(s, 0, 0, s, w / 2 - ((x0 + x1) / 2) * s, h / 2 - ((y0 + y1) / 2) * s);
      ctx.fillStyle = '#f2efe8';
      ctx.fill(new Path2D(r.d));
    });
    return () => {
      live = false;
    };
  }, [font, morphFont, t, modifiers, preview, JSON.stringify(axes)]);

  const exportFont = async (install: boolean) => {
    if (!family.trim()) {
      toast('Give the font a family name.', 'error');
      return;
    }
    const cs = CHARSETS[charsetKey];
    const spec: FontSpec = {
      font,
      axes,
      morph,
      modifiers,
      family: family.trim(),
      style: style.trim() || 'Regular',
      charset: charsetKey === 'custom' ? custom : cs.chars,
    };
    setBusy(true);
    try {
      const bytes = await engine.exportFont(spec);
      const file = `${spec.family.replace(/[^\w-]+/g, '')}-${spec.style.replace(/[^\w-]+/g, '')}.ttf`;
      const p = platform();
      if (install && p.installFont) {
        const where = await p.installFont(file, bytes);
        toast(`Installed ${spec.family} — ${where}`);
      } else if (await p.save(file, bytes, { name: 'TrueType font', extensions: ['ttf'] })) {
        toast(`Exported ${file} (${(bytes.length / 1024).toFixed(0)} KB)`);
      }
    } catch (e) {
      toast(`Font export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Export as font" onClose={close} wide>
      <div className="forge">
        <div className="forge-preview">
          <canvas ref={canvasRef} />
          <input className="preview-text" value={preview} onChange={(e) => setPreview(e.target.value)} aria-label="Preview text" />
        </div>
        <div className="forge-form">
          <div className="field">
            <span>Base font</span>
            <FontPicker value={font} onChange={(id) => id && setFont(id)} />
          </div>
          <div className="field">
            <span>Morph to</span>
            <FontPicker allowNone value={morphFont} onChange={setMorphFont} />
          </div>
          {morphFont && <Slider label="Blend" value={t} min={0} max={1} step={0.005} onChange={setT} />}
          {fromLayer && (
            <label className="check">
              <input type="checkbox" checked={useMods} onChange={(e) => setUseMods(e.target.checked)} /> Apply the selected layer's modifiers ({fromLayer.modifiers.filter(GLYPH_SAFE).length})
            </label>
          )}
          {useMods && dropped > 0 && <p className="hint">Arc and perspective work on whole lines, so they're left out of the font.</p>}
          <label className="field">
            <span>Family</span>
            <input value={family} onChange={(e) => setFamily(e.target.value)} />
          </label>
          <label className="field">
            <span>Style</span>
            <input value={style} onChange={(e) => setStyle(e.target.value)} />
          </label>
          <label className="field">
            <span>Glyphs</span>
            <select value={charsetKey} onChange={(e) => setCharsetKey(e.target.value)}>
              {Object.entries(CHARSETS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          {charsetKey === 'custom' && <textarea className="text-input" rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} />}
          <p className="hint">
            Fonts made from open-licence (OFL) fonts must use a new family name and stay under the OFL. Kerning isn't carried over yet.
          </p>
          <div className="dialog-actions">
            <button className="btn" onClick={close}>
              Cancel
            </button>
            {platform().installFont && (
              <button className="btn" disabled={busy} onClick={() => exportFont(true)}>
                Install on this Mac
              </button>
            )}
            <button className="btn primary" disabled={busy} onClick={() => exportFont(false)}>
              {busy ? 'Building…' : 'Export .ttf'}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
