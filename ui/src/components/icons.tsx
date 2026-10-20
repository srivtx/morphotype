// Morphotype's own icon set: 16 × 16, 1.5 px strokes with round joins.
// Kept as path data so they inherit colour and stay crisp at any size.

const P: Record<string, string> = {
  select: 'M3.5 2.5 12.5 7.4 8.4 8.6 6.6 12.8Z',
  hand: 'M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7V4a1 1 0 0 1 2 0v5.2c0 2.6-1.7 4.3-4.1 4.3-1.6 0-2.6-.7-3.5-2L2.6 9.2a1 1 0 0 1 1.6-1.1l1.3 1.4',
  text: 'M3 4V3h10v1M8 3v10M6 13h4',
  pen: 'M8.5 2.5 13.5 7.5 9.6 11.6 3 13l1.4-6.6Z M3 13l4.1-4.1 M8.3 7.7h.01',
  brush: 'M13 2.8 7.6 8.4M7.6 8.4 9.4 10.2M9.4 10.2 14.2 4.6a1.3 1.3 0 0 0-1.2-1.8M7.6 8.4C5.6 7.9 4 9.3 4.1 11.1c.1 1.2-.6 2-1.6 2.1 1.6.9 4 .9 5.6-.4 1-.8 1.3-1.8 1.3-2.6',
  shapes: 'M2.5 9.5a3 3 0 1 0 6 0 3 3 0 1 0-6 0ZM8.5 2.5h3.3c.95 0 1.7.75 1.7 1.7v3.3c0 .95-.75 1.7-1.7 1.7H8.5Z',
  image: 'M2.5 4.2c0-.94.76-1.7 1.7-1.7h7.6c.94 0 1.7.76 1.7 1.7v7.6c0 .94-.76 1.7-1.7 1.7H4.2c-.94 0-1.7-.76-1.7-1.7ZM2.8 11l3.4-3.3 2.6 2.4 1.6-1.4 2.8 2.6M10.2 5.8h.01',
  morph: 'M2.5 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0ZM9.5 5l4 3-4 3M6 8h7',
  points: 'M3 12.5C4 7 7.5 3.5 13 3M2 11.5h2v2H2ZM12 2h2v2h-2ZM3 12.5 7 6.8M13 3 8.2 5.2',
  warp: 'M2.5 3.5c3.5 1.5 7.5 1.5 11 0v9c-3.5-1.5-7.5-1.5-11 0ZM2.8 8c3.4-1 7-1 10.4 0M6.2 3.9v8.3M9.8 3.9v8.3',
  group: 'M2.5 4.5v-2h2M11.5 2.5h2v2M13.5 11.5v2h-2M4.5 13.5h-2v-2M5 5h3.5v3.5H5ZM7.5 7.5H11V11H7.5Z',
  ungroup: 'M3 3h4.5v4.5H3ZM8.5 8.5H13V13H8.5Z',
  merge: 'M3 6.2a3.2 3.2 0 0 1 6.2-1.1A3.2 3.2 0 1 1 9.9 11 3.2 3.2 0 1 1 3 6.2Z',
  cut: 'M2.5 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0ZM8 4.3a4 4 0 1 1 0 7.4',
  mask: 'M2.5 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0ZM5.5 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0ZM8 4.9a4 4 0 0 1 0 6.2 4 4 0 0 1 0-6.2Z',
  eye: 'M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8ZM6.2 8a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0Z',
  eyeOff: 'M2.5 2.5l11 11M6.6 4C7 3.9 7.5 3.8 8 3.8c4 0 6.2 4.2 6.2 4.2a10.6 10.6 0 0 1-1.6 2.2M10.6 11.6c-.8.4-1.7.6-2.6.6-4 0-6.2-4.2-6.2-4.2a10.7 10.7 0 0 1 2.4-2.8',
  lock: 'M4 7.5h8v5.5H4ZM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2',
  unlock: 'M4 7.5h8v5.5H4ZM5.5 7.5V5.5a2.5 2.5 0 0 1 4.9-.7',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  duplicate: 'M5.5 5.5h7v7h-7ZM10.5 5.5V3.5h-7v7h2',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  chevronRight: 'M6 3.5 10.5 8 6 12.5',
  chevronDown: 'M3.5 6 8 10.5 12.5 6',
  close: 'M4 4l8 8M12 4l-8 8',
  undo: 'M5.5 3.5 2.5 6.5 5.5 9.5M2.5 6.5h6.8a3.7 3.7 0 0 1 0 7.4H7',
  redo: 'M10.5 3.5l3 3-3 3M13.5 6.5H6.7a3.7 3.7 0 0 0 0 7.4H9',
  search: 'M2.8 7a4.2 4.2 0 1 0 8.4 0 4.2 4.2 0 1 0-8.4 0ZM10.2 10.2 13.5 13.5',
  settings: 'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M8.5 3v3M5.5 10v3',
  help: 'M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM6.2 6.2a1.9 1.9 0 0 1 3.7.6c0 1.3-1.9 1.7-1.9 2.9M8 11.5h.01',
  export: 'M8 10V2.5M5 5.5l3-3 3 3M3 9.5v3.2c0 .45.35.8.8.8h8.4c.45 0 .8-.35.8-.8V9.5',
  font: 'M2 12.5 5.2 3.5h.6l3.2 9M3.2 9.5h4.6M10.5 8.2c.5-.6 1.1-.9 1.8-.9 1.1 0 1.7.7 1.7 1.8v3.4M14 10.2c-1.5 0-3.4.3-3.4 1.4 0 .6.5 1 1.2 1 1.1 0 2.2-.8 2.2-2.2',
  design: 'M8 2.5 13.5 8 8 13.5 2.5 8ZM8 5.5v5M5.5 8h5',
  alignLeft: 'M2.5 2v12M5 4.5h8v2.5H5ZM5 9h5v2.5H5Z',
  alignHCenter: 'M8 2v12M4 4.5h8v2.5H4ZM5.5 9h5v2.5h-5Z',
  alignRight: 'M13.5 2v12M3 4.5h8v2.5H3ZM6 9h5v2.5H6Z',
  alignTop: 'M2 2.5h12M4.5 5v8h2.5V5ZM9 5v5h2.5V5Z',
  alignVCenter: 'M2 8h12M4.5 4v8h2.5V4ZM9 5.5v5h2.5v-5Z',
  alignBottom: 'M2 13.5h12M4.5 3v8h2.5V3ZM9 6v5h2.5V6Z',
  distributeH: 'M2.5 2v12M13.5 2v12M6.5 5h3v6h-3Z',
  distributeV: 'M2 2.5h12M2 13.5h12M5 6.5h6v3H5Z',
  flipH: 'M8 2v12M6 4.5 2.5 11.5H6ZM10 4.5l3.5 7H10Z',
  flipV: 'M2 8h12M4.5 6l7-3.5V6ZM4.5 10l7 3.5V10Z',
  rotate: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.4h-2.4',
  fit: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3',
  zoomIn: 'M2.8 7a4.2 4.2 0 1 0 8.4 0 4.2 4.2 0 1 0-8.4 0ZM10.2 10.2l3.3 3.3M7 5v4M5 7h4',
  zoomOut: 'M2.8 7a4.2 4.2 0 1 0 8.4 0 4.2 4.2 0 1 0-8.4 0ZM10.2 10.2l3.3 3.3M5 7h4',
  sparkle: 'M8 1.8c.4 3.2 1.8 4.6 5 5-3.2.4-4.6 1.8-5 5-.4-3.2-1.8-4.6-5-5 3.2-.4 4.6-1.8 5-5ZM12.8 11.2c.15 1.1.6 1.6 1.7 1.7-1.1.15-1.6.6-1.7 1.7-.15-1.1-.6-1.6-1.7-1.7 1.1-.15 1.6-.6 1.7-1.7Z',
  droplet: 'M8 2.2s4.2 4.3 4.2 7.3a4.2 4.2 0 0 1-8.4 0C3.8 6.5 8 2.2 8 2.2Z',
  pipette: 'M10.2 2.8a1.8 1.8 0 0 1 2.5 2.5l-1.4 1.4-2.5-2.5ZM9.6 5.6 4 11.2 3.2 13l1.8-.8 5.6-5.6',
  grid: 'M2.5 5.5h11M2.5 10.5h11M5.5 2.5v11M10.5 2.5v11',
  magnet: 'M3.5 2.5v5.2a4.5 4.5 0 0 0 9 0V2.5h-3v5.2a1.5 1.5 0 0 1-3 0V2.5ZM3.5 5h3M9.5 5h3',
  layers: 'M8 2.5 13.5 5.5 8 8.5 2.5 5.5ZM2.5 8.2 8 11.2l5.5-3M2.5 10.8 8 13.8l5.5-3',
  tile: 'M2.5 8c0-4.4 1.1-5.5 5.5-5.5s5.5 1.1 5.5 5.5-1.1 5.5-5.5 5.5S2.5 12.4 2.5 8ZM6 8.5a2 2 0 0 0 4 0',
  check: 'M3 8.5l3 3 7-7',
  warning: 'M8 2.5 14 13H2ZM8 6.5v3M8 11.3h.01',
  open: 'M2.5 4.2c0-.4.3-.7.7-.7h3l1.3 1.5h5.3c.4 0 .7.3.7.7v6.8c0 .4-.3.7-.7.7H3.2c-.4 0-.7-.3-.7-.7Z',
  save: 'M3 3h8l2 2v8H3ZM5.5 3v3h4V3M5 13V9.5h6V13',
  copy: 'M5.5 5.5h7v7h-7ZM10.5 5.5V3.5h-7v7h2',
  scissors: 'M3 4.5a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0ZM3 11.5a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0ZM6.2 5.6 13 12.5M6.2 10.4 13 3.5',
  outline: 'M3 13C3 7 6 3 13 3M3 13h3M3 13v-3',
  keyboard: 'M1.8 4.5h12.4v7H1.8ZM4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6',
  command: 'M6 6V4.5A1.5 1.5 0 1 0 4.5 6H6Zm0 0h4m-4 0v4m4-4V4.5A1.5 1.5 0 1 1 11.5 6H10Zm0 0v4m0 0v1.5a1.5 1.5 0 1 0 1.5-1.5H10Zm0 0H6m0 0H4.5A1.5 1.5 0 1 0 6 11.5V10Z',
  reset: 'M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.4h2.4',
  wand: 'M3 13 10.5 5.5M9 4l1.5 1.5M11.5 1.8l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4ZM13 7.5l.3.8.8.3-.8.3-.3.8-.3-.8-.8-.3.8-.3Z',
  stack: 'M3 5h10M3 8h10M3 11h10',
  canvas: 'M2.5 3.5h11v9h-11ZM2.5 10l3-2.5 2.5 2 2-1.5 3.5 3',
  bold: 'M4.5 3h4.2a2.4 2.4 0 0 1 0 4.8H4.5ZM4.5 7.8h5a2.6 2.6 0 0 1 0 5.2h-5Z',
  type: 'M3 13V3h4.5M3 8h3.5M9.5 13V7.5M9.5 5.6v-.1M12 13V9a1.6 1.6 0 0 1 3 0',
  pixel: 'M3 3h3v3H3ZM6.5 6.5h3v3h-3ZM10 3h3v3h-3ZM3 10h3v3H3ZM10 10h3v3h-3Z',
  dots: 'M4 4h.01M8 4h.01M12 4h.01M4 8h.01M8 8h.01M12 8h.01M4 12h.01M8 12h.01M12 12h.01',
  wave: 'M2 8c1.5-3 3-3 4.5 0s3 3 4.5 0 2.5-2 3-1',
  drop: 'M8 2.5c2 2.8 3.8 4.7 3.8 7a3.8 3.8 0 0 1-7.6 0c0-2.3 1.8-4.2 3.8-7Z',
  play: 'M5 3.3v9.4a.5.5 0 0 0 .76.43l7.4-4.7a.5.5 0 0 0 0-.86l-7.4-4.7A.5.5 0 0 0 5 3.3Z',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  keyframe: 'M8 2.5 13.5 8 8 13.5 2.5 8Z',
  repeat: 'M3 7V6a2 2 0 0 1 2-2h7.5M10.5 2 12.5 4l-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2',
  replay: 'M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.5h2.5',
  motion: 'M2.5 12.5C5 12.5 6 3.5 9 3.5c1.6 0 2.4 1.4 4.5 1.4M9.5 10h4M11 12.5h2.5',
  film: 'M2.5 4.2c0-.94.76-1.7 1.7-1.7h7.6c.94 0 1.7.76 1.7 1.7v7.6c0 .94-.76 1.7-1.7 1.7H4.2c-.94 0-1.7-.76-1.7-1.7ZM5 2.5v11M11 2.5v11M2.5 6h2.5M2.5 10h2.5M11 6h2.5M11 10h2.5',
};

const FILLED = new Set(['more', 'dots']);

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className = '', title }: { name: IconName; size?: number; className?: string; title?: string }) {
  const filled = FILLED.has(name);
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={filled ? 2.4 : 1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={P[name]} />
    </svg>
  );
}

/** The app mark: a half-filled squircle morphing into a circle. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="mt-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b9a8ff" />
          <stop offset="1" stopColor="#6f5bff" />
        </linearGradient>
      </defs>
      <path d="M3 12c0-7.2 1.8-9 9-9s9 1.8 9 9-1.8 9-9 9-9-1.8-9-9Z" fill="url(#mt-logo)" />
      <path d="M12 5.5a6.5 6.5 0 0 1 0 13Z" fill="#0d0b16" opacity="0.85" />
    </svg>
  );
}
