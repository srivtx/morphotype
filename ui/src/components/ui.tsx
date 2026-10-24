import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';
import { beginGesture, commitEdit } from '../state/store';

// ---------- popover ----------

type Anchor = HTMLElement | { x: number; y: number } | null;

function rectOf(a: Anchor): DOMRect | null {
  if (!a) return null;
  if (a instanceof HTMLElement) return a.getBoundingClientRect();
  return new DOMRect(a.x, a.y, 0, 0);
}

/**
 * Floating panel rendered in a portal. It opens below (or above, when there
 * isn't room) its anchor, never leaves the window, and scrolls internally
 * when its content is taller than the space available.
 */
export function Popover({
  anchor,
  onClose,
  children,
  placement = 'bottom-start',
  className = '',
  width,
  autoFocus = true,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'right-start' | 'left-start' | 'top-start';
  className?: string;
  width?: number;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  const place = useCallback(() => {
    const r = rectOf(anchor);
    const el = ref.current;
    if (!r || !el) return;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const natural = el.scrollHeight;
    let left: number;
    let top: number;
    let maxHeight: number;
    if (!(anchor instanceof HTMLElement)) {
      // A point (context menu): open down-right, shifting to stay on screen.
      maxHeight = vh - pad * 2;
      left = r.left + w > vw - pad ? Math.max(pad, r.left - w) : r.left;
      top = Math.max(pad, Math.min(r.top, vh - pad - Math.min(natural, maxHeight)));
    } else if (placement === 'right-start' || placement === 'left-start') {
      left = placement === 'right-start' ? r.right + 6 : r.left - w - 6;
      if (left + w > vw - pad) left = r.left - w - 6;
      if (left < pad) left = Math.min(r.right + 6, vw - w - pad);
      maxHeight = vh - pad * 2;
      top = Math.max(pad, Math.min(r.top - 4, vh - pad - Math.min(natural, maxHeight)));
    } else {
      left = placement === 'bottom-end' ? r.right - w : r.left;
      left = Math.max(pad, Math.min(left, vw - w - pad));
      const below = vh - r.bottom - pad - 6;
      const above = r.top - pad - 6;
      const up = placement === 'top-start' ? above > 120 || above > below : natural > below && above > below;
      maxHeight = Math.max(120, up ? above : below);
      top = up ? r.top - 6 - Math.min(natural, maxHeight) : r.bottom + 6;
    }
    setPos({ left, top, maxHeight });
  }, [anchor, placement]);

  useLayoutEffect(() => {
    place();
    const el = ref.current;
    const ro = new ResizeObserver(place);
    if (el) ro.observe(el);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [place]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      // Nested popovers live in their own portals.
      if ((t as Element).closest?.('.popover')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        if (anchor instanceof HTMLElement) anchor.focus();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current?.querySelector<HTMLElement>('input, [role=menuitem], button, [tabindex="0"]');
    el?.focus({ preventScroll: true });
  }, [autoFocus]);

  // Arrow keys move between menu items.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? []);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };

  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight, width }}
      onKeyDown={onKeyDown}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}

export function Menu({
  label,
  children,
  className = '',
  buttonClass = 'btn',
  placement,
  title,
  width,
  kbd,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  buttonClass?: string;
  placement?: 'bottom-start' | 'bottom-end' | 'right-start' | 'top-start';
  title?: string;
  width?: number;
  kbd?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={btn} className={`${buttonClass} ${open ? 'open' : ''} ${className}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" data-tip={title} data-kbd={kbd}>
        {label}
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={close} placement={placement} width={width} className="menu-pop">
          {children(close)}
        </Popover>
      )}
    </>
  );
}

export function MenuItem({
  icon,
  label,
  kbd,
  onClick,
  disabled,
  danger,
  checked,
}: {
  icon?: IconName;
  label: ReactNode;
  kbd?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
}) {
  return (
    <button role="menuitem" className={`menu-item ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onClick}>
      <span className="mi-icon">{checked ? <Icon name="check" /> : icon ? <Icon name={icon} /> : null}</span>
      <span className="mi-label">{label}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

export function MenuSep() {
  return <div className="menu-sep" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}

// ---------- inputs ----------

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
  onCommit?: () => void;
  /** Value restored on double-click. */
  reset?: number;
  suffix?: string;
}

/** Click snaps to the nearest step when there are few, else to a nearby tenth (DialKit's "decile magnet"). */
function snapClick(v: number, min: number, max: number, step: number) {
  if ((max - min) / step <= 10) return min + Math.round((v - min) / step) * step;
  const t = (v - min) / (max - min || 1);
  const near = Math.round(t * 10) / 10;
  return Math.abs(t - near) <= 0.03125 ? min + near * (max - min) : v;
}

/**
 * A filled bar slider, after DialKit (MIT, Josh Puckett): the label sits on
 * the left and the value on the right inside one bar. Drag anywhere to set
 * the value (⇧ for fine, relative moves), click to jump (snapping to tenths),
 * pull past an end and it stretches a little. Hover the number, or press
 * Enter, to type a value (maths works). Arrow keys step (⇧ ×10); double-click
 * resets. Ranges through zero fill from zero.
 */
export function Slider({ label, value, min, max, step, onChange, reset, suffix }: SliderProps) {
  const [text, setText] = useState<string | null>(null);
  const [active, setActive] = useState<'hover' | 'drag' | null>(null);
  const [editable, setEditable] = useState(false);
  const [stretch, setStretch] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const press = useRef<{ x: number; y: number; v: number; moved: boolean; rect: DOMRect } | null>(null);
  const hoverTimer = useRef(0);
  const d = decimals(step);
  const clampStep = (v: number) => Math.round(Math.min(max, Math.max(min, v)) / step) * step;
  const set = (v: number) => onChange(Number(clampStep(v).toFixed(d)));
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1))) * 100;
  const zero = min < 0 && max > 0 ? ((0 - min) / (max - min)) * 100 : 0;
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const at = (clientX: number, r: DOMRect) => min + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (max - min);
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || text !== null) return;
    e.preventDefault();
    bar.current!.focus({ preventScroll: true });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    beginGesture();
    press.current = { x: e.clientX, y: e.clientY, v: value, moved: false, rect: bar.current!.getBoundingClientRect() };
  };
  const onMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= 3) return;
    if (!p.moved) setActive('drag');
    p.moved = true;
    const r = p.rect;
    // Past an end the bar gives a little: up to 8 px, easing off over 200 px after a 32 px dead zone.
    const past = e.clientX < r.left ? r.left - e.clientX : e.clientX > r.right ? e.clientX - r.right : 0;
    setStretch(Math.sign(e.clientX - r.left) * 8 * Math.sqrt(Math.min(Math.max(0, past - 32) / 200, 1)) * (past > 0 ? 1 : 0));
    if (e.shiftKey) set(p.v + ((e.clientX - p.x) / r.width) * (max - min) * 0.1);
    else set(at(e.clientX, r));
  };
  const onUp = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    press.current = null;
    if (!p.moved) set(snapClick(at(e.clientX, p.rect), min, max, step));
    setStretch(0);
    setActive(bar.current?.matches(':hover') ? 'hover' : null);
    commitEdit();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const big = e.shiftKey || e.key.startsWith('Page') ? 10 : 1;
    if (['ArrowRight', 'ArrowUp', 'PageUp'].includes(e.key)) set(value + step * big);
    else if (['ArrowLeft', 'ArrowDown', 'PageDown'].includes(e.key)) set(value - step * big);
    else if (e.key === 'Home') onChange(min);
    else if (e.key === 'End') onChange(max);
    else if (e.key === 'Enter') startTyping();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const startTyping = () => {
    setText(value.toFixed(d));
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };
  const done = (keep: boolean) => {
    const v = text === null || text.trim() === '' ? NaN : Number.isFinite(Number(text)) ? Number(text) : evalMath(text);
    if (keep && Number.isFinite(v)) onChange(v);
    setText(null);
    setEditable(false);
  };
  // The handle fades back where it would cover the label or the number.
  const w = bar.current?.offsetWidth ?? 200;
  const labelEnd = labelRef.current ? ((10 + labelRef.current.offsetWidth + 8) / w) * 100 : 30;
  const valueStart = input.current ? ((w - 12 - Math.min(input.current.scrollWidth, 60) - 8) / w) * 100 : 78;
  const dodge = pct < labelEnd || pct > valueStart;
  const steps = (max - min) / step;
  const ticks = steps <= 10 ? Array.from({ length: Math.max(0, Math.round(steps) - 1) }, (_, i) => ((i + 1) / steps) * 100) : Array.from({ length: 9 }, (_, i) => (i + 1) * 10);
  return (
    <div className="slider" onDoubleClick={() => reset !== undefined && text === null && onChange(reset)}>
      <div
        ref={bar}
        className={`bar ${active ? 'active' : ''} ${active === 'drag' ? 'dragging' : ''}`}
        style={stretch ? { width: `calc(100% + ${Math.abs(stretch)}px)`, transform: stretch < 0 ? `translateX(${stretch}px)` : undefined } : undefined}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value.toFixed(d)}${suffix ?? ''}`}
        data-tip={reset !== undefined ? 'Drag · ⇧ fine · double-click resets' : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerEnter={() => !press.current && setActive('hover')}
        onPointerLeave={() => !press.current && setActive(null)}
        onKeyDown={onKey}
      >
        <div className="bar-ticks">
          {ticks.map((t) => (
            <i key={t} style={{ left: `${t}%` }} />
          ))}
        </div>
        <div className="bar-fill" style={{ left: `${Math.min(zero, pct)}%`, width: `${Math.abs(pct - zero)}%` }} />
        <div className={`bar-handle ${dodge ? 'dodge' : ''}`} style={{ left: `max(5px, calc(${pct}% - 9px))` }} />
        <span ref={labelRef} className="bar-label">
          {label}
        </span>
        <input
          ref={input}
          className={`bar-num ${editable || text !== null ? 'editable' : ''}`}
          aria-label={`${label} value`}
          value={text ?? value.toFixed(d) + (suffix ?? '')}
          size={Math.max(3, (text ?? value.toFixed(d) + (suffix ?? '')).length)}
          onPointerEnter={() => {
            clearTimeout(hoverTimer.current);
            hoverTimer.current = window.setTimeout(() => setEditable(true), 800);
          }}
          onPointerLeave={() => {
            clearTimeout(hoverTimer.current);
            if (text === null) setEditable(false);
          }}
          onPointerDown={(e) => {
            // Once it's offered for typing, clicks go to the number, not the bar.
            if (editable) e.stopPropagation();
          }}
          onFocus={() => text === null && startTyping()}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === 'Escape') {
              // Commit (or not) without letting the key do anything else.
              e.preventDefault();
              done(e.key === 'Enter');
              bar.current?.focus({ preventScroll: true });
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const v = Number(text ?? value) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              onChange(Number(v.toFixed(d)));
              setText(v.toFixed(d));
            }
          }}
        />
      </div>
    </div>
  );
}

/** Evaluate + - * / and parentheses (no eval: the app's CSP forbids it). */
export function evalMath(src: string): number {
  const s = src.replace(/\s+/g, '');
  let i = 0;
  const num = (): number => {
    if (s[i] === '(') {
      i++;
      const v = expr();
      i++;
      return v;
    }
    if (s[i] === '-') {
      i++;
      return -num();
    }
    const m = /^\d*\.?\d+(e[-+]?\d+)?/i.exec(s.slice(i));
    if (!m) return NaN;
    i += m[0].length;
    return Number(m[0]);
  };
  const term = (): number => {
    let v = num();
    while (s[i] === '*' || s[i] === '/') v = s[i++] === '*' ? v * num() : v / num();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (s[i] === '+' || s[i] === '-') v = s[i++] === '+' ? v + term() : v - term();
    return v;
  };
  const v = expr();
  return i === s.length ? v : NaN;
}

/** Number box with a scrubbable label, for X / Y / W / H rows. */
export function NumberBox({ label, value, onChange, step = 1, suffix, title, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string; title?: string; min?: number; max?: number }) {
  const [text, setText] = useState<string | null>(null);
  const scrub = useRef<{ x: number; v: number } | null>(null);
  const d = decimals(step);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const shown = Number.isFinite(value) ? (Math.abs(value) >= 1000 ? value.toFixed(0) : String(Number(value.toFixed(d)))) : '–';
  return (
    <label className="numbox" data-tip={title}>
      <span
        className="numbox-label"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, v: value };
        }}
        onPointerMove={(e) => {
          const s = scrub.current;
          if (!s) return;
          onChange(clamp(Number((s.v + (e.clientX - s.x) * step * (e.shiftKey ? 10 : 1)).toFixed(d))));
        }}
        onPointerUp={() => (scrub.current = null)}
      >
        {label}
      </span>
      <input
        value={text ?? shown + (suffix ?? '')}
        onFocus={(e) => {
          setText(shown);
          const el = e.target;
          // Select it all for typing over, unless typing has already begun (a select then would eat the first keys).
          requestAnimationFrame(() => el.value === shown && el.select());
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null) {
            // Allow simple maths: "120*2", "300+24".
            const v = evalMath(text);
            if (Number.isFinite(v)) onChange(clamp(v));
          }
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Commit without letting Enter activate anything else.
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setText(null);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clamp(Number((Number(text ?? value) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toFixed(d)));
            onChange(v);
            setText(String(v));
          }
        }}
      />
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label?: string; icon?: IconName; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  // One pill slides to the picked option (DialKit's segmented control).
  const wrap = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; slide: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const on = el.querySelector<HTMLElement>('button.on');
      // It appears in place, and slides only when the choice changes.
      setPill((p) => (on ? { x: on.offsetLeft, w: on.offsetWidth, slide: !!p } : null));
    };
    measure();
    // Buttons share the width, so the pill follows when the panel resizes.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div ref={wrap} className={`segmented ${size}`} role="radiogroup">
      {pill && <span className="segmented-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w, transition: pill.slide ? undefined : 'none' }} />}
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.label ?? o.title}
          className={o.value === value ? 'on' : ''}
          data-tip={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string }) {
  return (
    <label className="toggle-row" data-tip={hint}>
      <span>{label}</span>
      <button role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  );
}

export function Select<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label?: string }) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu
      buttonClass="select"
      label={
        <>
          <span className="select-value">{current?.label ?? String(value)}</span>
          <Icon name="chevronDown" size={12} />
        </>
      }
      title={label}
    >
      {(close) => (
        <div className="menu-list">
          {options.map((o) => (
            <MenuItem
              key={String(o.value)}
              checked={o.value === value}
              label={o.label}
              kbd={o.hint}
              onClick={() => {
                onChange(o.value);
                close();
              }}
            />
          ))}
        </div>
      )}
    </Menu>
  );
}

export function Section({
  title,
  children,
  actions,
  defaultOpen = true,
  id,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  id?: string;
}) {
  const key = id ? `mt.section.${id}` : '';
  const [open, setOpen] = useState(() => {
    try {
      const v = key ? localStorage.getItem(key) : null;
      return v === null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      if (key) localStorage.setItem(key, open ? '0' : '1');
    } catch {
      // Not important.
    }
  };
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header>
        <button className="section-toggle" onClick={toggle} aria-expanded={open}>
          <Icon name="chevronRight" size={12} className="chev" />
          {title}
        </button>
        <div className="section-actions">{actions}</div>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function IconButton({ icon, title, kbd, onClick, active, disabled, className = '', size = 16 }: { icon: IconName; title: string; kbd?: string; onClick: (e: React.MouseEvent) => void; active?: boolean; disabled?: boolean; className?: string; size?: number }) {
  return (
    <button className={`icon-btn ${active ? 'on' : ''} ${className}`} aria-label={title} data-tip={title} data-kbd={kbd} onClick={onClick} disabled={disabled} aria-pressed={active}>
      <Icon name={icon} size={size} />
    </button>
  );
}

// ---------- dialog ----------

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md',
  className = '',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, so the effect below runs once per dialog: re-running
  // it on every render would bounce focus out and back in (and a key press in
  // flight could then land on whichever button got focus).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.popover')) {
        e.stopPropagation();
        closeRef.current();
      }
      // Keep Tab inside the dialog.
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex="0"]')).filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          f.at(-1)!.focus();
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    if (!ref.current?.contains(document.activeElement)) {
      const root = ref.current;
      // Prefer an explicit autofocus, then a field, then the main button; never the close button.
      (root?.querySelector<HTMLElement>('[autofocus]') ?? root?.querySelector<HTMLElement>('input:not([type=range])') ?? root?.querySelector<HTMLElement>('button.primary') ?? root)?.focus();
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${size} ${className}`} role="dialog" aria-modal aria-label={title} tabIndex={-1}>
        <header className="dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon="close" title="Close" kbd="Esc" onClick={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Tooltips for anything with `data-tip` (and an optional `data-kbd`). */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; kbd?: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let timer = 0;
    let current: Element | null = null;
    const show = (el: Element) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 60;
      setTip({ text, kbd: el.getAttribute('data-kbd') ?? undefined, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as Element).closest?.('[data-tip]');
      if (el === current) return;
      current = el;
      clearTimeout(timer);
      setTip(null);
      if (el) timer = window.setTimeout(() => show(el), 450);
    };
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('wheel', hide, true);
    return () => {
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('wheel', hide, true);
    };
  }, []);
  if (!tip) return null;
  return createPortal(
    <div className={`tooltip ${tip.below ? 'below' : ''}`} style={{ left: tip.x, top: tip.y }}>
      {tip.text}
      {tip.kbd && <kbd>{tip.kbd}</kbd>}
    </div>,
    document.body,
  );
}
