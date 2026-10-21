// Morphotype site. No dependencies: the hero morphs signed distance fields of
// our bundled fonts on the CPU and draws them as a grid of pixels.

import { deck } from './deck.js';
import { stepper } from './stepper.js';
import { timeline } from './timeline.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/* ---------- Distance fields ---------- */

const INF = 1e20;

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
function dt1(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared distance to the nearest zero cell, in place. */
function edt(g, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
}

const SS = 3; // supersampling per cell
const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { willReadFrequently: true });

/**
 * Signed distance (in cells, negative inside) from each cell centre to the
 * outline of `word` set in `font`, fitted to a cols × rows grid.
 */
function wordField(word, font, cols, rows, fit) {
  const W = cols * SS, H = rows * SS;
  scratch.width = W;
  scratch.height = H;
  sctx.clearRect(0, 0, W, H);
  sctx.font = `${font.weight} 100px ${font.family}`;
  const m = sctx.measureText(word);
  const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const k = Math.min((W * fit.w) / inkW, (H * fit.h) / inkH);
  sctx.font = `${font.weight} ${100 * k}px ${font.family}`;
  sctx.fillStyle = '#000';
  const x = W / 2 - ((m.actualBoundingBoxRight - m.actualBoundingBoxLeft) * k) / 2;
  const y = H * fit.y + ((m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) * k) / 2;
  sctx.fillText(word, x, y);
  const a = sctx.getImageData(0, 0, W, H).data;
  const outside = new Float64Array(W * H), inside = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const ink = a[i * 4 + 3] > 127;
    outside[i] = ink ? 0 : INF;
    inside[i] = ink ? INF : 0;
  }
  edt(outside, W, H);
  edt(inside, W, H);
  const out = new Float32Array(cols * rows);
  const c = SS >> 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const p = (j * SS + c) * W + i * SS + c;
      out[j * cols + i] = (Math.sqrt(outside[p]) - Math.sqrt(inside[p])) / SS;
    }
  return out;
}

/* ---------- The pixel field ---------- */

const FONTS = [
  { family: 'Bricolage', weight: 800, name: 'Bricolage' },
  { family: 'Playfair', weight: 900, name: 'Playfair' },
  { family: 'Pacifico', weight: 400, name: 'Pacifico' },
  { family: '"Rubik Mono"', weight: 400, name: 'Rubik Mono' },
  { family: 'Anton', weight: 400, name: 'Anton' },
  { family: 'Unbounded', weight: 800, name: 'Unbounded' },
  { family: 'Silkscreen', weight: 400, name: 'Silkscreen' },
  { family: '"Caveat Brush"', weight: 400, name: 'Caveat Brush' },
  { family: '"Dela Gothic"', weight: 400, name: 'Dela Gothic' },
  { family: 'Bungee', weight: 400, name: 'Bungee' },
];

const NEON = [[255, 79, 184], [214, 92, 255], [138, 123, 255], [64, 224, 255]];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

class PixelField {
  constructor(canvas, { cell, fit, mode = 'pixel' }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellFor = cell;
    this.fit = fit;
    this.mode = mode;
    this.word = 'Morphotype';
    this.cache = new Map();
    this.mouse = { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4, on: false };
    this.colors = { ink: '#17151c', accent: '#6c4cff' };
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      if (!this.mouse.on) Object.assign(this.mouse, { sx: this.mouse.x, sy: this.mouse.y, on: true });
    });
    canvas.addEventListener('pointerleave', () => (this.mouse.on = false));
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cs = this.cellFor(r.width);
    this.cols = Math.max(8, Math.floor(r.width / this.cs));
    this.rows = Math.max(4, Math.floor(r.height / this.cs));
    this.ox = (r.width - this.cols * this.cs) / 2;
    this.oy = (r.height - this.rows * this.cs) / 2;
    const n = this.cols * this.rows;
    this.noise = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      this.noise[i] = (s - Math.floor(s)) * 2 - 1;
    }
    this.bg = null;
  }

  field(fi) {
    const key = `${this.word}|${this.cols}x${this.rows}|${fi}`;
    let f = this.cache.get(key);
    if (!f) {
      if (this.cache.size > 40) this.cache.clear();
      f = wordField(this.word, FONTS[fi], this.cols, this.rows, this.fit);
      this.cache.set(key, f);
    }
    return f;
  }

  /** A faint dot grid behind lit pixels, drawn once per size and colour. */
  backdrop(color, alpha) {
    const key = `${this.cols}x${this.rows}|${color}|${alpha}`;
    if (this.bg?.key === key) return this.bg.canvas;
    const c = document.createElement('canvas');
    const dpr = this.canvas.width / this.w;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = color;
    g.globalAlpha = alpha;
    const s = Math.max(1.2, this.cs * 0.16);
    for (let j = 0; j < this.rows; j++)
      for (let i = 0; i < this.cols; i++) g.fillRect(this.ox + i * this.cs + this.cs / 2 - s / 2, this.oy + j * this.cs + this.cs / 2 - s / 2, s, s);
    this.bg = { key, canvas: c };
    return c;
  }

  /**
   * Draw the blend of fonts a → b at `e` (0..1). `scatter` jitters cells (in
   * cells), `time` animates materials, `glow` lights cells near the pointer.
   */
  draw(a, b, e, { scatter = 0, time = 0, fade = null } = {}) {
    const { ctx, cols, rows, cs, ox, oy, noise, mode } = this;
    const fa = this.field(a), fb = a === b ? fa : this.field(b);
    const m = this.mouse;
    m.sx += ((m.on ? m.x : -1e4) - m.sx) * (m.on ? 0.25 : 1);
    m.sy += ((m.on ? m.y : -1e4) - m.sy) * (m.on ? 0.25 : 1);
    const R = cs * 9, R2 = R * R;
    const wobble = Math.sin(Math.PI * e);
    ctx.clearRect(0, 0, this.w, this.h);

    const ink = this.colors.ink, accent = this.colors.accent;
    const paths = new Map();
    const path = (style) => {
      let p = paths.get(style);
      if (!p) paths.set(style, (p = new Path2D()));
      return p;
    };

    if (mode === 'pixel' && !fade) ctx.drawImage(this.backdrop(ink, 0.09), 0, 0, this.w, this.h);
    if (mode === 'neon') ctx.drawImage(this.backdrop('#ffffff', 0.05), 0, 0, this.w, this.h);

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const nz = noise[idx];
        let d = fa[idx] + (fb[idx] - fa[idx]) * e + nz * wobble * 0.8;
        if (d > 7) continue;
        let x = ox + i * cs, y = oy + j * cs;
        if (scatter) {
          x += nz * scatter * cs * 1.5;
          y += noise[(idx * 7) % noise.length] * scatter * cs * 1.5;
        }
        let near = 0;
        const dx = x + cs / 2 - m.sx, dy = y + cs / 2 - m.sy;
        const q = dx * dx + dy * dy;
        if (q < R2) {
          const dist = Math.sqrt(q) || 1;
          near = (1 - dist / R) ** 2;
          x += (dx / dist) * near * cs * 2.2;
          y += (dy / dist) * near * cs * 2.2;
        }
        const alpha = fade ? fade(j / rows) : 1;
        if (alpha <= 0.01) continue;

        if (mode === 'pixel') {
          const cov = 0.5 - d;
          if (cov <= 0.05) continue;
          const g = cs * 0.08;
          const style = near > 0.12 ? accent : cov < 0.5 ? 'soft' : ink;
          path(alpha < 1 ? `${style}|${Math.round(alpha * 10)}` : style).rect(x + g, y + g, cs - 2 * g, cs - 2 * g);
        } else if (mode === 'halftone') {
          let s = clamp(0.5 - d / 2.6, 0, 1);
          s *= 0.72 + 0.28 * Math.sin(i * 0.11 + j * 0.07 - time * 1.6);
          if (s <= 0.04) continue;
          const r = (cs / 2) * Math.sqrt(s) * 1.08 * (1 + near * 0.6);
          const p = path(near > 0.15 ? accent : ink);
          p.moveTo(x + cs / 2 + r, y + cs / 2);
          p.arc(x + cs / 2, y + cs / 2, r, 0, Math.PI * 2);
        } else if (mode === 'dither') {
          // Solid rim, dithered body, and a dithered drop shadow.
          const th = BAYER[(j & 3) * 4 + (i & 3)];
          let on = false;
          if (d < 0.5) on = (d > -1.6 ? 1 : 0.56) > th;
          else {
            const si = i - 3, sj = j - 3;
            if (si >= 0 && sj >= 0) {
              const k = sj * cols + si;
              const ds = fa[k] + (fb[k] - fa[k]) * e;
              on = ds < 0.5 && 0.3 > th;
            }
          }
          if (near > 0.2 && d < 2) on = true;
          if (on) path(near > 0.2 ? accent : ink).rect(x, y, cs, cs);
        } else if (mode === 'neon') {
          // A tube just inside the outline, a halo outside, a faint haze within.
          const t = d + 0.7;
          const tube = Math.exp(-(t * t) / 0.45);
          const halo = d > 0 ? Math.exp(-d / 2.2) * 0.42 : 0.1;
          const flick = 0.88 + 0.12 * Math.sin(time * 23 + j * 0.3) * Math.sin(time * 3.1);
          const v = (tube + halo + near * 0.5) * flick;
          if (v < 0.07) continue;
          const level = Math.min(8, Math.round(v * 8));
          const hue = clamp(Math.floor((i / cols + 0.08 * Math.sin(time * 0.8 + j * 0.05)) * 4), 0, 3);
          path(`neon|${hue}|${level}`).rect(x + 0.5, y + 0.5, cs - 1, cs - 1);
        }
      }
    }

    for (const [style, p] of paths) {
      if (style.startsWith('neon|')) {
        const [, hue, level] = style.split('|');
        const l = Number(level) / 8;
        const rgb = NEON[Number(hue)];
        ctx.fillStyle = l >= 0.99 ? `rgb(${rgb.map((c) => Math.round(c + (255 - c) * 0.75)).join(',')})` : `rgba(${rgb.join(',')}, ${l})`;
      } else {
        const [s, a] = style.split('|');
        ctx.fillStyle = s === 'soft' ? ink : s;
        ctx.globalAlpha = (s === 'soft' ? 0.32 : 1) * (a ? Number(a) / 10 : 1);
      }
      ctx.fill(p);
      ctx.globalAlpha = 1;
    }
  }
}

/* ---------- Hero ---------- */

const MODES = [
  { id: 'pixel', label: 'Pixel' },
  { id: 'halftone', label: 'Halftone' },
  { id: 'dither', label: 'Dither' },
  { id: 'neon', label: 'Neon' },
];

async function hero() {
  const stage = $('.stage');
  const canvas = $('.morph', stage);
  // Narrow screens get smaller pixels, so a long word keeps enough rows to read.
  const pf = new PixelField(canvas, { cell: (w) => clamp(w / 120, 3.4, 10), fit: { w: 0.86, h: 0.56, y: 0.5 } });
  const readA = $('[data-font-a]'), readB = $('[data-font-b]'), readBlend = $('[data-blend]');

  const setColors = () => {
    const cs = getComputedStyle(stage);
    pf.colors.ink = cs.getPropertyValue('--stage-ink').trim() || '#17151c';
    pf.colors.accent = pf.mode === 'halftone' ? '#ff4fb8' : pf.mode === 'dither' ? '#6c4cff' : getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  };
  const modes = stepper($('[data-modes]'), MODES.length, {
    duration: () => 6000,
    labels: MODES.map((m) => m.label),
    onChange: (i) => {
      pf.mode = MODES[i].id;
      stage.dataset.mode = pf.mode;
      setColors();
    },
  });
  setColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setColors);

  await document.fonts.load('800 100px Bricolage');
  const loads = FONTS.map((f) => document.fonts.load(`${f.weight} 100px ${f.family}`));

  const HOLD = reduced ? 3200 : 1700, MORPH = reduced ? 1 : 1100;
  let a = 0, b = 1, t0 = performance.now(), visible = true, raf = 0;
  const start = performance.now();
  let last = '';

  const frame = (now) => {
    raf = 0;
    const t = now - t0;
    let e = 0;
    if (t > HOLD) e = ease(clamp((t - HOLD) / MORPH, 0, 1));
    if (t > HOLD + MORPH) {
      a = b;
      b = (b + 1) % FONTS.length;
      t0 = now;
      e = 0;
    }
    const intro = reduced ? 0 : Math.max(0, 1 - (now - start) / 1400);
    pf.draw(a, b, e, { scatter: ease(intro) * 6, time: now / 1000 });
    const text = `${FONTS[a].name}|${FONTS[b].name}|${Math.round(e * 100)}`;
    if (text !== last) {
      last = text;
      readA.textContent = FONTS[a].name;
      readB.textContent = FONTS[b].name;
      readBlend.textContent = `${Math.round(e * 100)}%`;
    }
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  // Every face has to be loaded before its field is measured.
  await Promise.all(loads);
  kick();
  if (!reduced) modes.play();

  new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    if (visible) {
      kick();
      if (!reduced && !modes.playing) modes.play();
    } else modes.pause();
  }).observe(stage);
  document.addEventListener('visibilitychange', kick);
  let rt = 0;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      pf.resize();
      kick();
    }, 120);
  });

  const input = $('[data-word]');
  input.addEventListener('input', () => {
    const w = input.value.replace(/[^\p{L}\p{N}&!?' .-]/gu, '').trim();
    pf.word = w || 'Morphotype';
    kick();
  });
}

/* ---------- Footer wordmark: same field, faded, lit by the pointer ---------- */

async function wordmark() {
  const canvas = $('.wordmark');
  await document.fonts.load('800 100px Bricolage');
  const pf = new PixelField(canvas, { cell: (w) => clamp(w / 150, 4, 9), fit: { w: 0.98, h: 0.92, y: 0.56 } });
  const ink = () => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  pf.colors = { ink: ink(), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() };
  const fade = (y) => 0.16 * (1 - y) ** 1.3 + 0.02;
  let raf = 0;
  const paint = () => {
    raf = 0;
    pf.draw(0, 0, 0, { fade });
    const m = pf.mouse;
    if (m.on && (Math.abs(m.x - m.sx) > 0.5 || Math.abs(m.y - m.sy) > 0.5)) raf = requestAnimationFrame(paint);
    else if (!m.on && m.sx > -1e3) raf = requestAnimationFrame(paint);
  };
  const kick = () => raf || (raf = requestAnimationFrame(paint));
  canvas.addEventListener('pointermove', kick);
  canvas.addEventListener('pointerleave', kick);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    pf.colors.ink = ink();
    pf.bg = null;
    kick();
  });
  addEventListener('resize', () => {
    pf.resize();
    kick();
  });
  kick();
}

/* ---------- Pixel icons ---------- */

const ICONS = {
  morph: ['............', '.###....oo..', '#...#..o..o.', '#...#..o..o.', '#####..oooo.', '#...#..o..o.', '#...#..o..o.', '............', '..##....oo..', '...###oo....', '.....##.....', '............'],
  motion: ['.##########.', '#..........#', '#....#.....#', '#....##....#', '#....###...#', '#....##....#', '#....#.....#', '#..........#', '.##########.', '............', 'oooooo#.....', '......#.....'],
  spark: ['.....#......', '.....#......', '....###.....', '..#######...', '....###.....', '.....#....o.', '.....#...ooo', '..........o.', '..o.........', '.ooo........', '..o.........', '............'],
  pen: ['..........##', '.........###', '........###.', '.......###..', '......###...', '.....###....', '....###.....', '...o##......', '..oo#.......', '.ooo........', 'oo..........', '............'],
  font: ['.#########..', '.#.......##.', '.#.ooooo..#.', '.#.o......#.', '.#.oooo...#.', '.#.o......#.', '.#.o......#.', '.#........#.', '.#........#.', '.#........#.', '.##########.', '............'],
  kern: ['............', '..##...#...#', '.#..#..#...#', '.#..#..#...#', '.####...#.#.', '.#..#...#.#.', '.#..#....#..', '............', '..o......o..', 'oooo....oooo', '..o......o..', '............'],
  photo: ['############', '#..........#', '#.......oo.#', '#.......oo.#', '#..........#', '#...#......#', '#..###..#..#', '#.#####.###.', '###########.', '#..........#', '############', '............'],
  export: ['.....##.....', '.....##.....', '.....##.....', '.....##.....', '..#..##..#..', '...#.##.#...', '....####....', '.....##.....', '............', 'o..........o', 'oooooooooooo', '............'],
  mac: ['......o.....', '.....o......', '..###.###...', '.#########..', '#########...', '#########...', '#########...', '##########..', '.##########.', '..########..', '...##..##...', '............'],
  win: ['............', '.####.#####.', '.####.#####.', '.####.#####.', '.####.#####.', '............', '.####.ooooo.', '.####.ooooo.', '.####.ooooo.', '.####.ooooo.', '............', '............'],
  web: ['...######...', '.##..#...##.', '#...#.#....#', '#..#...#...#', '############', '#..#...#...#', '#..#...#...#', '############', '#...#.#....#', '.##..#...##.', '...######...', '............'],
};

function icons() {
  for (const el of $$('.picon')) {
    const rows = ICONS[el.dataset.icon];
    if (!rows) continue;
    let rects = '';
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        const dx = ((x - 5.5) * 0.12).toFixed(2), dy = ((y - 5.5) * 0.12).toFixed(2);
        rects += `<rect x="${x}" y="${y}" width="1" height="1" class="${ch === 'o' ? 'a' : ''}" style="--dx:${dx}px;--dy:${dy}px;--d:${((x + y) * 0.012).toFixed(3)}s"/>`;
      }),
    );
    el.innerHTML = `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }
}

/* ---------- Design / Type toggle ---------- */

function modeShots() {
  const seg = $('.seg');
  const pill = $('.seg-pill', seg);
  const img = $('[data-shot-img]');
  const shots = {
    design: ['/media/editor.webp', 'The Morphotype editor with a frosted glass folder over 3D 404 lettering'],
    type: ['/media/type-mode.webp', 'Type mode, editing the glyphs of a font'],
  };
  const place = (b) => {
    pill.style.width = `${b.offsetWidth}px`;
    pill.style.transform = `translateX(${b.offsetLeft - 4}px)`;
  };
  $$('button', seg).forEach((b) =>
    b.addEventListener('click', () => {
      $$('button', seg).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      place(b);
      const [src, alt] = shots[b.dataset.shot];
      img.style.opacity = '0.2';
      const next = new Image();
      next.onload = () => {
        img.src = src;
        img.alt = alt;
        img.style.opacity = '1';
      };
      next.src = src;
    }),
  );
  document.fonts.ready.then(() => place($('[aria-selected="true"]', seg)));
}

/* ---------- Marquee of stills ---------- */

const STILLS = ['glass-lens', 'pixel-office', 'crystal-word', 'riso-zine', 'thermal-wings', 'keycap-tower', 'neon-script', 'holo-j', 'foam-letter', 'dither-signal', 'puffy-mascot', 'sun-stamp', 'chrome-cursor', 'bitmap-poster'];
const STILLS_2 = ['aura-tiles', 'font-morph', 'macro-keypad', 'frosted-404', 'pixel-wordmark', 'grain-spheres', 'night-blob', 'retro-sign', 'iso-bunny', 'pixel-garden', 'glow-glass', 'pixel-runner'];

function marquees() {
  for (const [el, list] of [[$('[data-marquee="left"]'), STILLS], [$('[data-marquee="right"]'), STILLS_2]]) {
    const imgs = [...list, ...list].map((id, i) => `<img src="/media/${id}.webp" alt="${i < list.length ? id.replace(/-/g, ' ') : ''}" loading="lazy" decoding="async"${i >= list.length ? ' aria-hidden="true"' : ''} />`);
    el.innerHTML = imgs.join('');
  }
}

/* ---------- Downloads: newest release assets, and the visitor's system first ---------- */

function detectOS() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
  if (/iphone|ipad|android/.test(navigator.userAgent.toLowerCase())) return 'web';
  if (p.includes('mac')) return 'mac';
  if (p.includes('win')) return 'win';
  return 'web';
}

async function downloads() {
  const os = detectOS();
  const labels = { mac: 'Download for macOS', win: 'Download for Windows', web: 'Get Morphotype' };
  $$('[data-os-label]').forEach((el) => (el.textContent = el.closest('.nav') ? 'Download' : labels[os]));
  $(`.platform[data-platform="${os}"]`)?.classList.add('mine');
  try {
    const r = await fetch('https://api.github.com/repos/srivtx/morphotype/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const rel = await r.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (version) {
      $$('[data-version]').forEach((el) => (el.textContent = `v${version}`));
    }
    const pick = { mac: (n) => n.endsWith('.dmg'), win: (n) => n.endsWith('.exe'), web: (n) => /web.*\.zip$/i.test(n) };
    for (const [key, test] of Object.entries(pick)) {
      const asset = rel.assets?.find((x) => test(x.name));
      const card = $(`.platform[data-platform="${key}"]`);
      if (!asset || !card) continue;
      card.href = asset.browser_download_url;
      const label = $('[data-asset-name]', card);
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = ` · ${(asset.size / 1048576).toFixed(0)} MB`;
      label.textContent = asset.name;
      label.append(size);
      if (key === os) $('[data-primary-download]').href = asset.browser_download_url;
    }
  } catch {
    // Offline or rate limited: the links still go to the releases page.
  }
}

/* ---------- Small things ---------- */

function chrome() {
  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      }),
    { rootMargin: '0px 0px -8% 0px' },
  );
  $$('.section-head, .feature-grid li, .platform, .window, .reel-frame, .changes li, .seg').forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${(i % 4) * 70}ms`;
    io.observe(el);
  });
}

icons();
chrome();
deck();
timeline();
modeShots();
marquees();
downloads();
hero();
wordmark();
