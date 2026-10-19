// Image → pixel art: average the picture into a grid, map every cell to a
// small palette (optionally with ordered dithering), and emit one vector path
// per colour so each ink is its own editable layer.

export interface PixelArtOptions {
  /** Cells across the longer side. */
  cells: number;
  /** Palette size when the palette comes from the image. */
  colors: number;
  /** Fixed palette, or null to pick colours from the image. */
  palette: string[] | null;
  /** Ordered dithering strength, 0..1. */
  dither: number;
  /** Cell shape. */
  shape: 'square' | 'dot';
}

export interface PixelArt {
  cols: number;
  rows: number;
  palette: string[];
  /** Palette index per cell, row-major. */
  cells: Uint8Array;
  /** How many cells use each colour. */
  counts: number[];
}

export const PALETTES: { name: string; colors: string[] | null }[] = [
  { name: 'From the image', colors: null },
  { name: 'Mint + pink', colors: ['#161616', '#1ed97a', '#ff9fd0', '#ffcdb4'] },
  { name: '1-bit', colors: ['#111111', '#f2efe8'] },
  { name: 'Game Boy', colors: ['#0f380f', '#306230', '#8bac0f', '#c4d82a'] },
  { name: 'Riso blue + pink', colors: ['#0b3fd9', '#ff4f9a', '#f4f1ea'] },
  { name: 'Acid', colors: ['#0a0a0a', '#e9ff3b', '#6b2bff'] },
];

type RGB = [number, number, number];

const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const parse = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const dist = (a: RGB, b: RGB) => {
  // Weighted RGB distance: close enough to perceptual for picking inks.
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
};

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Average colour per cell; transparent pixels count as white. */
function sample(img: ImageData, cols: number, rows: number): RGB[] {
  const out: RGB[] = [];
  const { width: W, height: H, data } = img;
  for (let j = 0; j < rows; j++) {
    const y0 = Math.floor((j * H) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * H) / rows));
    for (let i = 0; i < cols; i++) {
      const x0 = Math.floor((i * W) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * W) / cols));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      // Sparse sampling keeps big photos fast.
      const sx = Math.max(1, Math.floor((x1 - x0) / 6));
      const sy = Math.max(1, Math.floor((y1 - y0) / 6));
      for (let y = y0; y < y1; y += sy)
        for (let x = x0; x < x1; x += sx) {
          const k = (y * W + x) * 4;
          const a = data[k + 3] / 255;
          r += data[k] * a + 255 * (1 - a);
          g += data[k + 1] * a + 255 * (1 - a);
          b += data[k + 2] * a + 255 * (1 - a);
          n++;
        }
      out.push([r / n, g / n, b / n]);
    }
  }
  return out;
}

/** k-means with deterministic farthest-point seeding. */
function kmeans(px: RGB[], k: number): RGB[] {
  if (!px.length) return [[0, 0, 0]];
  const centres: RGB[] = [px[0]];
  // Start from the darkest cell so results are stable between runs.
  for (const p of px) if (p[0] + p[1] + p[2] < centres[0][0] + centres[0][1] + centres[0][2]) centres[0] = p;
  while (centres.length < k) {
    let best = px[0];
    let bd = -1;
    for (const p of px) {
      let d = Infinity;
      for (const c of centres) d = Math.min(d, dist(p, c));
      if (d > bd) (bd = d), (best = p);
    }
    if (bd <= 0) break;
    centres.push(best);
  }
  for (let it = 0; it < 12; it++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0;
      let bd = Infinity;
      centres.forEach((c, i) => {
        const d = dist(p, c);
        if (d < bd) (bd = d), (bi = i);
      });
      const s = sum[bi];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    }
    sum.forEach((s, i) => s[3] && (centres[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
  }
  return centres;
}

export function pixelArt(img: ImageData, o: PixelArtOptions): PixelArt {
  const long = Math.max(4, Math.min(240, Math.round(o.cells)));
  const cols = img.width >= img.height ? long : Math.max(1, Math.round((long * img.width) / img.height));
  const rows = img.width >= img.height ? Math.max(1, Math.round((long * img.height) / img.width)) : long;
  const px = sample(img, cols, rows);
  const pal = o.palette ? o.palette.map(parse) : kmeans(px, Math.max(2, Math.min(8, o.colors)));
  const cells = new Uint8Array(cols * rows);
  const counts = pal.map(() => 0);
  const spread = 96 * o.dither;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const p = px[j * cols + i];
      const t = spread ? (BAYER4[(j % 4) * 4 + (i % 4)] / 16 - 0.47) * spread : 0;
      const q: RGB = [p[0] + t, p[1] + t, p[2] + t];
      let bi = 0;
      let bd = Infinity;
      pal.forEach((c, k) => {
        const d = dist(q, c);
        if (d < bd) (bd = d), (bi = k);
      });
      cells[j * cols + i] = bi;
      counts[bi]++;
    }
  return { cols, rows, palette: pal.map(hex), cells, counts };
}

/**
 * Path for one palette colour, in the 1-unit box used by path layers (the
 * longer side spans −0.5..0.5). Squares merge into horizontal runs and
 * overlap their neighbours a hair so no seams show between colours.
 */
export function colorPath(art: PixelArt, index: number, shape: 'square' | 'dot'): string {
  const { cols, rows, cells } = art;
  const s = 1 / Math.max(cols, rows);
  const ox = (-cols * s) / 2;
  const oy = (-rows * s) / 2;
  const f = (v: number) => +v.toFixed(5);
  const out: string[] = [];
  for (let j = 0; j < rows; j++) {
    let i = 0;
    while (i < cols) {
      if (cells[j * cols + i] !== index) {
        i++;
        continue;
      }
      if (shape === 'dot') {
        const r = s * 0.46;
        const cx = ox + (i + 0.5) * s;
        const cy = oy + (j + 0.5) * s;
        out.push(`M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`);
        i++;
        continue;
      }
      let e = i;
      while (e < cols && cells[j * cols + e] === index) e++;
      const pad = s * 0.02;
      const x = ox + i * s - pad;
      const y = oy + j * s - pad;
      out.push(`M${f(x)} ${f(y)}h${f((e - i) * s + 2 * pad)}v${f(s + 2 * pad)}h${f(-((e - i) * s + 2 * pad))}Z`);
      i = e;
    }
  }
  return out.join('');
}

/** Draw the result into a canvas for the dialog preview. */
export function drawPixelArt(c: HTMLCanvasElement, art: PixelArt, shape: 'square' | 'dot', skip: number | null) {
  const px = Math.max(2, Math.floor(360 / Math.max(art.cols, art.rows)));
  c.width = art.cols * px;
  c.height = art.rows * px;
  const g = c.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, c.width, c.height);
  for (let j = 0; j < art.rows; j++)
    for (let i = 0; i < art.cols; i++) {
      const k = art.cells[j * art.cols + i];
      if (k === skip) continue;
      g.fillStyle = art.palette[k];
      if (shape === 'dot') {
        g.beginPath();
        g.arc((i + 0.5) * px, (j + 0.5) * px, px * 0.46, 0, Math.PI * 2);
        g.fill();
      } else g.fillRect(i * px, j * px, px, px);
    }
}

/** A picture reduced to a few inks, pixel by pixel (for tracing in colour). */
export interface Quantized {
  w: number;
  h: number;
  palette: string[];
  /** Palette index per pixel. */
  index: Uint8Array;
  counts: number[];
}

/** Reduce a picture to `k` inks (k-means), at most `max` px on the long side. */
export function quantize(img: ImageData, k: number, max = 1000): Quantized {
  const f = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * f));
  const h = Math.max(1, Math.round(img.height * f));
  const cols = Math.min(120, w);
  const rows = Math.max(1, Math.round((cols * h) / w));
  const pal = kmeans(sample(img, cols, rows), Math.max(2, Math.min(8, k)));
  const index = new Uint8Array(w * h);
  const counts = pal.map(() => 0);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / f));
    for (let x = 0; x < w; x++) {
      const i = (sy * img.width + Math.min(img.width - 1, Math.floor(x / f))) * 4;
      const a = d[i + 3] / 255;
      const p: RGB = [d[i] * a + 255 * (1 - a), d[i + 1] * a + 255 * (1 - a), d[i + 2] * a + 255 * (1 - a)];
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < pal.length; c++) {
        const dd = dist(p, pal[c]);
        if (dd < bd) (bd = dd), (bi = c);
      }
      index[y * w + x] = bi;
      counts[bi]++;
    }
  }
  return { w, h, palette: pal.map(hex), index, counts };
}

/**
 * Masks for tracing a quantized picture as stacked colour layers: the
 * biggest colour first, and each layer's mask also covers every colour
 * stacked above it, so no seams show between neighbours. `skip` (the
 * background) is never inked. Returns [palette index, RGBA mask] pairs.
 */
export function stackedMasks(q: Quantized, skip: number | null): [number, Uint8Array][] {
  // Colours under 0.2% of the picture are anti-aliasing, not inks.
  const min = q.index.length * 0.002;
  const order = q.palette.map((_, i) => i).filter((i) => q.counts[i] > min && i !== skip).sort((a, b) => q.counts[b] - q.counts[a]);
  const rank = new Int16Array(q.palette.length).fill(-1);
  order.forEach((i, r) => (rank[i] = r));
  return order.map((ci, r) => {
    const m = new Uint8Array(q.w * q.h * 4);
    for (let p = 0; p < q.index.length; p++) {
      const ink = rank[q.index[p]] >= r;
      const v = ink ? 0 : 255;
      m[p * 4] = m[p * 4 + 1] = m[p * 4 + 2] = v;
      m[p * 4 + 3] = 255;
    }
    return [ci, m];
  });
}

/** Draw a quantized picture (preview). */
export function drawQuantized(c: HTMLCanvasElement, q: Quantized, skip: number | null) {
  c.width = q.w;
  c.height = q.h;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(q.w, q.h);
  const rgb = q.palette.map(parse);
  for (let p = 0; p < q.index.length; p++) {
    const k = q.index[p];
    const [r, g, b] = rgb[k];
    img.data[p * 4] = r;
    img.data[p * 4 + 1] = g;
    img.data[p * 4 + 2] = b;
    img.data[p * 4 + 3] = k === skip ? 40 : 255;
  }
  ctx.putImageData(img, 0, 0);
}
