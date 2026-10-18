import type { ModifierKind, SymbolKind } from '../engine/types';
import { MODIFIER_DEFAULTS, MODIFIER_UI, SYMBOL_DEFAULTS, SYMBOL_UI, uid } from '../state/model';
import { useStore } from '../state/store';
import { useShape, viewBoxOf } from '../render/thumbs';

function SymbolThumb({ kind }: { kind: SymbolKind }) {
  const shape = useShape(`sym:${kind}`, () => ({
    layers: [{ id: 's', visible: true, op: 'add', x: 0, y: 0, rotation: 0, scale: 1, sx: 1, sy: 1, modifiers: [], content: { type: 'symbol', symbol: SYMBOL_DEFAULTS[kind], size: 100 } }],
  }));
  return (
    <svg viewBox={shape ? viewBoxOf(shape.box, 0.12) : '-50 -50 100 100'} className="thumb-svg" aria-hidden>
      {shape && <path d={shape.d} />}
    </svg>
  );
}

/** Grid of shapes grouped by kind, each drawn by the engine. */
export function ShapePicker({ onPick }: { onPick: (k: SymbolKind) => void }) {
  const groups = ['Basic', 'Badge', 'Mascot'] as const;
  return (
    <div className="picker">
      {groups.map((g) => (
        <div key={g}>
          <div className="picker-label">{g}</div>
          <div className="picker-grid">
            {(Object.keys(SYMBOL_UI) as SymbolKind[])
              .filter((k) => SYMBOL_UI[k].group === g)
              .map((k) => (
                <button key={k} role="menuitem" className="pick" onClick={() => onPick(k)} data-tip={SYMBOL_UI[k].label}>
                  <SymbolThumb kind={k} />
                  <span>{SYMBOL_UI[k].label}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const SAMPLE_MOD: Partial<Record<ModifierKind, object>> = {
  weight: { amount: 0.05 },
  round: { radius: 0.05 },
  outline: { width: 0.05 },
  wave: { amplitude: 0.1, wavelength: 1.4, phase: 0 },
  arc: { bend: 0.6 },
  warp: { style: 'arch', bend: 0.6, points: [] },
  ink: { amount: 0.03, scale: 0.4, seed: 2 },
  melt: { amount: 0.5, scale: 0.35, seed: 3 },
  wobble: { amount: 0.05, scale: 0.4, seed: 1 },
  slice: { count: 6, gap: 0.07 },
  repeat: { count: 5, radius: 0.75 },
  fuse: { amount: 0.16 },
  echo: { count: 2, spacing: 0.08, width: 0.03 },
  pixelate: { size: 0.07, shape: 'square', gap: 0.12, dissolve: 0.7 },
  foam: { amount: 0.8, size: 0.2, wall: 0.015 },
  isometric: { face: 'left' },
};

function ModThumb({ kind, font }: { kind: ModifierKind; font: string }) {
  const shape = useShape(`mod:${kind}:${font}`, () => ({
    layers: [
      {
        id: 'm',
        visible: true,
        op: 'add',
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1,
        sx: 1,
        sy: 1,
        modifiers: [{ ...MODIFIER_DEFAULTS[kind], ...(SAMPLE_MOD[kind] ?? {}), on: true, uid: uid('m') } as never],
        content: { type: 'text', text: 'Ag', font, size: 100, tracking: 0, lineHeight: 1, align: 'center', axes: {}, morph: null, ligatures: true },
      },
    ],
  }));
  return (
    <svg viewBox={shape ? viewBoxOf(shape.box, 0.1) : '-50 -50 100 100'} className="thumb-svg" aria-hidden>
      {shape && <path d={shape.d} />}
    </svg>
  );
}

/** Modifier cards with a live "Ag" preview of each. */
export function ModifierPicker({ onPick }: { onPick: (k: ModifierKind) => void }) {
  const font = useStore((s) => (s.fonts.some((f) => f.id === 'archivo') ? 'archivo' : (s.fonts[0]?.id ?? 'archivo')));
  const groups = ['Shape', 'Distort', 'Texture'] as const;
  return (
    <div className="picker">
      {groups.map((g) => (
        <div key={g}>
          <div className="picker-label">{g}</div>
          <div className="picker-grid wide">
            {(Object.keys(MODIFIER_UI) as ModifierKind[])
              .filter((k) => MODIFIER_UI[k].group === g)
              .map((k) => (
                <button key={k} role="menuitem" className="pick card" onClick={() => onPick(k)}>
                  <ModThumb kind={k} font={font} />
                  <span className="pick-text">
                    <strong>{MODIFIER_UI[k].label}</strong>
                    <small>{MODIFIER_UI[k].blurb}</small>
                  </span>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
