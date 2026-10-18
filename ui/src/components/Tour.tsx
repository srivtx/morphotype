// Coach marks: a few short steps that point at parts of the screen.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TourStep {
  target: string;
  title: string;
  text: string;
}

export function Tour({ steps, event, onDone }: { steps: TourStep[]; event: string; onDone: () => void }) {
  const [i, setI] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const start = () => setTimeout(() => setI(0), 250);
    window.addEventListener(event, start);
    const resize = () => setTick((n) => n + 1);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener(event, start);
      window.removeEventListener('resize', resize);
    };
  }, [event]);
  useEffect(() => {
    if (i === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, (x ?? 0) - 1));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  if (i === null) return null;
  const step = steps[i];
  const el = document.querySelector(step.target);
  const r = el?.getBoundingClientRect();
  const finish = () => {
    setI(null);
    onDone();
  };
  const next = () => (i < steps.length - 1 ? setI(i + 1) : finish());
  // Card beside the target, on whichever side has room.
  const W = 300;
  let left = 24;
  let top = 24;
  if (r) {
    const right = r.right + 16 + W < window.innerWidth;
    left = right ? r.right + 16 : Math.max(16, r.left - W - 16);
    if (r.width > window.innerWidth * 0.4) left = Math.min(window.innerWidth - W - 16, Math.max(16, r.left + r.width / 2 - W / 2));
    top = Math.min(window.innerHeight - 200, Math.max(16, r.top + 12));
  }
  return createPortal(
    <div className="tour" role="dialog" aria-label={step.title}>
      {r && <div className="tour-hole" style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 }} />}
      <div className="tour-card" style={{ left, top, width: W }}>
        <span className="dim small">
          {i + 1} of {steps.length}
        </span>
        <h4>{step.title}</h4>
        <p>{step.text}</p>
        <div className="tour-actions">
          <button className="link-btn" onClick={finish}>
            Skip
          </button>
          <button className="btn small primary" onClick={next} autoFocus>
            {i < steps.length - 1 ? 'Next' : 'Got it'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
