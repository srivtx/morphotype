import { useEffect, useRef, useState, type ReactNode } from 'react';

function decimals(step: number) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Value restored on double-click. */
  reset?: number;
  suffix?: string;
}

/** Range slider with an editable number. Values outside the range can be typed. */
export function Slider({ label, value, min, max, step, onChange, reset, suffix }: SliderProps) {
  const [text, setText] = useState<string | null>(null);
  const d = decimals(step);
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1))) * 100;
  return (
    <label className="slider" onDoubleClick={() => reset !== undefined && onChange(reset)} title={reset !== undefined ? 'Double-click to reset' : undefined}>
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        className="slider-num"
        value={text ?? value.toFixed(d)}
        onFocus={(e) => {
          setText(value.toFixed(d));
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number(text);
          if (text !== null && text.trim() !== '' && Number.isFinite(v)) onChange(v);
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {suffix && <span className="slider-suffix">{suffix}</span>}
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="color-field">
      <span className="slider-label">{label}</span>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      <input
        className="hex"
        value={text ?? value}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = (text ?? '').trim();
          const hex = v.startsWith('#') ? v : `#${v}`;
          if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(hex.toLowerCase());
          setText(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, actions, defaultOpen = true }: { title: string; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header>
        <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="chev">▸</span>
          {title}
        </button>
        <div className="section-actions">{actions}</div>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Menu({ label, children, className = '' }: { label: ReactNode; children: (close: () => void) => ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={`menu ${className}`} ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}
      </button>
      {open && <div className="menu-pop">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
