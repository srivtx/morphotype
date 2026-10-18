import { useMemo, useRef, useState } from 'react';
import { beginGesture, commitEdit, store } from '../state/store';
import { walk } from '../state/tree';
import { isGroup } from '../state/model';
import { Icon } from './icons';
import { Popover } from './ui';

export const PALETTES: { name: string; colors: string[] }[] = [
  { name: 'Electric', colors: ['#7b4dff', '#4d7bff', '#00e5ff', '#c6ff00', '#ff3d7f', '#ff6a00', '#ffffff', '#0a0a0a'] },
  { name: 'Acid', colors: ['#d4ff00', '#b6ff1a', '#00ff9c', '#3dfff2', '#ff00e5', '#ff2e63', '#1a1aff', '#0b0b0f'] },
  { name: 'Sunset', colors: ['#ffd23f', '#ffb36b', '#ff6a00', '#ff3d00', '#ff3d7f', '#c2185b', '#7b2fff', '#1a0b2e'] },
  { name: 'Pastel', colors: ['#ffd6e8', '#ffe0cc', '#fff3c4', '#d9fff0', '#d6e4ff', '#e8d9ff', '#f5f0ff', '#fdfcf8'] },
  { name: 'Ocean', colors: ['#001233', '#0a1a4a', '#0b5cff', '#2b8bff', '#5cc6ff', '#9ae6ff', '#28f0ff', '#e6fbff'] },
  { name: 'Chrome Y2K', colors: ['#e6ebf5', '#c0c8d6', '#7c8aa8', '#3a4256', '#a7f0ff', '#ff9ef5', '#b3a3ff', '#fff6b3'] },
  { name: 'Earth', colors: ['#f2ebe0', '#e8dcc8', '#c8a27a', '#a8574a', '#8a5a3b', '#4a3326', '#6b7a4f', '#2f3a2a'] },
  { name: 'Neutral', colors: ['#ffffff', '#ececef', '#d9d9de', '#8b8b93', '#55555c', '#2a2a2f', '#141416', '#000000'] },
];

const RECENT_KEY = 'mt.recentColors';

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function pushRecent(c: string) {
  try {
    const next = [c, ...loadRecent().filter((x) => x !== c)].slice(0, 16);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Not important.
  }
}

/** Every colour used in the document (styles and background). */
function documentColors(): string[] {
  const p = store.get().project;
  const set = new Set<string>();
  const add = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) && set.add(v.toLowerCase());
  walk(p.layers, (n) => {
    if (!isGroup(n) || n.merge) Object.values(n.style.params).forEach(add);
  });
  p.background.fill.colors.forEach(add);
  p.background.tile?.fill.colors.forEach(add);
  return [...set].slice(0, 16);
}

export function hexToHsv(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (k: number) => {
    const kk = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1));
  };
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

export function normalizeHex(v: string): string | null {
  let t = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/i.test(t) ? `#${t.toLowerCase()}` : null;
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

function Picker({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: () => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const sv = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);
  const recent = useMemo(loadRecent, []);
  const docColors = useMemo(documentColors, []);
  const set = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    const hex = hsvToHex(h, s, v);
    setText(hex);
    onChange(hex);
  };
  const pick = (hex: string) => {
    setHsv(hexToHsv(hex));
    setText(hex);
    onChange(hex);
    pushRecent(hex);
  };
  const dragSv = (e: React.PointerEvent) => {
    const r = sv.current!.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    set(hsv[0], s, v);
  };
  const dragHue = (e: React.PointerEvent) => {
    const r = hue.current!.getBoundingClientRect();
    set(Math.max(0, Math.min(359.9, ((e.clientX - r.left) / r.width) * 360)), hsv[1], hsv[2]);
  };
  const ED = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const swatches = (list: string[]) => (
    <div className="swatches">
      {list.map((c) => (
        <button key={c} className={`swatch ${c === value ? 'on' : ''}`} style={{ background: c }} aria-label={c} data-tip={c} onClick={() => pick(c)} />
      ))}
    </div>
  );
  return (
    <div className="color-picker" onPointerUp={() => pushRecent(text)}>
      <div
        ref={sv}
        className="cp-sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hsv[0], 1, 1)})` }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          beginGesture();
          dragSv(e);
        }}
        onPointerUp={commitEdit}
        onPointerMove={(e) => e.buttons === 1 && dragSv(e)}
        tabIndex={0}
        role="slider"
        aria-label="Saturation and brightness"
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.1 : 0.02;
          if (e.key === 'ArrowRight') set(hsv[0], Math.min(1, hsv[1] + d), hsv[2]);
          else if (e.key === 'ArrowLeft') set(hsv[0], Math.max(0, hsv[1] - d), hsv[2]);
          else if (e.key === 'ArrowUp') set(hsv[0], hsv[1], Math.min(1, hsv[2] + d));
          else if (e.key === 'ArrowDown') set(hsv[0], hsv[1], Math.max(0, hsv[2] - d));
          else if (e.key === 'Enter') onDone();
          else return;
          e.preventDefault();
        }}
      >
        <span className="cp-thumb" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: value }} />
      </div>
      <div
        ref={hue}
        className="cp-hue"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          beginGesture();
          dragHue(e);
        }}
        onPointerUp={commitEdit}
        onPointerMove={(e) => e.buttons === 1 && dragHue(e)}
        tabIndex={0}
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv[0])}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 15 : 3;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set((hsv[0] + d) % 360, hsv[1], hsv[2]);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set((hsv[0] - d + 360) % 360, hsv[1], hsv[2]);
          else return;
          e.preventDefault();
        }}
      >
        <span className="cp-thumb" style={{ left: `${(hsv[0] / 360) * 100}%`, background: hsvToHex(hsv[0], 1, 1) }} />
      </div>
      <div className="cp-row">
        <span className="cp-preview" style={{ background: value }} />
        <input
          className="cp-hex"
          value={text}
          aria-label="Hex colour"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            const h = normalizeHex(e.target.value);
            if (h) {
              setHsv(hexToHsv(h));
              onChange(h);
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && onDone()}
        />
        {ED && (
          <button
            className="icon-btn"
            aria-label="Pick a colour from the screen"
            data-tip="Eyedropper"
            onClick={async () => {
              try {
                const r = await new ED().open();
                pick(r.sRGBHex);
              } catch {
                // Cancelled.
              }
            }}
          >
            <Icon name="pipette" />
          </button>
        )}
      </div>
      <div className="cp-scroll">
        {docColors.length > 0 && (
          <>
            <div className="cp-label">In this design</div>
            {swatches(docColors)}
          </>
        )}
        {recent.length > 0 && (
          <>
            <div className="cp-label">Recent</div>
            {swatches(recent.slice(0, 8))}
          </>
        )}
        {PALETTES.map((p) => (
          <div key={p.name}>
            <div className="cp-label">{p.name}</div>
            {swatches(p.colors)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Colour row: label, swatch button that opens the picker, and hex. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <div className="color-field">
      <span className="slider-label">{label}</span>
      <button ref={btn} className={`color-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-label={`${label}: ${value}`}>
        <span className="chip" style={{ background: value }} />
        <span className="hex">{value.toUpperCase()}</span>
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} placement="left-start" width={248} className="cp-pop">
          <Picker value={value} onChange={onChange} onDone={() => setOpen(false)} />
        </Popover>
      )}
    </div>
  );
}

/** Just the swatch (for compact rows such as gradient stops). */
export function ColorChip({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} className="color-chip" style={{ background: value }} aria-label={`${label}: ${value}`} data-tip={`${label} · ${value}`} onClick={() => setOpen(!open)} />
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} placement="left-start" width={248} className="cp-pop">
          <Picker value={value} onChange={onChange} onDone={() => setOpen(false)} />
        </Popover>
      )}
    </>
  );
}
