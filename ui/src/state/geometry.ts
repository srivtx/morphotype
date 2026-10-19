// Geometry helpers shared by the canvas overlays: layer transforms, the warp
// control net (mirrors modifiers.rs) and an editable bezier path model.
import type { Box, WarpStyle } from '../engine/types';

export interface Pt {
  x: number;
  y: number;
}

export interface Xform {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  sx: number;
  sy: number;
}

/** Layer-local point → document point (translate · rotate · scale). */
export function apply(t: Xform, p: Pt): Pt {
  const a = (t.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = p.x * t.scale * t.sx;
  const y = p.y * t.scale * t.sy;
  return { x: t.x + x * c - y * s, y: t.y + x * s + y * c };
}

/** Document point → layer-local point. */
export function invert(t: Xform, p: Pt): Pt {
  const a = (t.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  const x = dx * c + dy * s;
  const y = -dx * s + dy * c;
  return { x: x / (t.scale * t.sx || 1e-9), y: y / (t.scale * t.sy || 1e-9) };
}

export function boxCorners(b: Box): Pt[] {
  return [
    { x: b[0], y: b[1] },
    { x: b[2], y: b[1] },
    { x: b[2], y: b[3] },
    { x: b[0], y: b[3] },
  ];
}

// ---------- warp ----------

/** Control-net offsets (fractions of the box), row-major 4 × 4. Must match `warp_net` in Rust. */
export function warpNet(style: WarpStyle, bend: number, points: [number, number][]): [number, number][] {
  const b = Math.max(-2, Math.min(2, bend));
  const out: [number, number][] = [];
  const mid = (i: number) => i === 1 || i === 2;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const u = i / 3;
      const v = j / 3;
      let o: [number, number];
      switch (style) {
        case 'arch':
          o = [0, mid(i) ? -0.42 * b : 0];
          break;
        case 'arc':
          o = [0, mid(i) && j === 0 ? -0.55 * b : mid(i) && j === 1 ? -0.2 * b : 0];
          break;
        case 'arcLower':
          o = [0, mid(i) && j === 3 ? 0.55 * b : mid(i) && j === 2 ? 0.2 * b : 0];
          break;
        case 'bulge':
          o = [0, mid(i) ? (v - 0.5) * b : 0];
          break;
        case 'flag':
          o = [0, i === 1 ? -0.38 * b : i === 2 ? 0.38 * b : 0];
          break;
        case 'rise':
          o = [0, i < 2 ? 0.22 * b : -0.22 * b];
          break;
        case 'fish':
          o = [0, j === 0 && mid(i) ? -0.4 * b : j === 3 && mid(i) ? 0.4 * b : i === 3 ? (v - 0.5) * -0.45 * b : 0];
          break;
        case 'inflate':
          if (mid(i) && mid(j)) o = [(u - 0.5) * 0.9 * b, (v - 0.5) * 0.9 * b];
          else if (mid(i) || mid(j)) o = [(u - 0.5) * 0.35 * b * (mid(j) ? 1 : 0), (v - 0.5) * 0.35 * b * (mid(i) ? 1 : 0)];
          else o = [0, 0];
          break;
        case 'squeeze':
          o = [mid(j) ? (0.5 - u) * 0.7 * b : 0, 0];
          break;
        case 'twist':
          o = [(0.5 - v) * 0.45 * b, (u - 0.5) * 0.3 * b];
          break;
        default:
          o = [0, 0];
      }
      const p = points[j * 4 + i];
      if (p) o = [o[0] + p[0], o[1] + p[1]];
      out.push(o);
    }
  }
  return out;
}

/** Positions of the 16 control points in the layer's local frame. */
export function warpControls(frame: Box, net: [number, number][]): Pt[] {
  const w = frame[2] - frame[0];
  const h = frame[3] - frame[1];
  return net.map((o, k) => ({ x: frame[0] + (((k % 4) / 3) + o[0]) * w, y: frame[1] + (Math.floor(k / 4) / 3 + o[1]) * h }));
}

// ---------- editable paths ----------

export interface Node {
  x: number;
  y: number;
  /** Incoming / outgoing handles (absolute). Missing = sharp, straight. */
  hin?: Pt;
  hout?: Pt;
}

export interface Contour {
  nodes: Node[];
  /** An open line (no closing segment), drawn by the pen and stroked. */
  open?: boolean;
}

/** Parse absolute/relative M L H V C S Q T Z path data into contours of cubic nodes. */
export function parsePath(d: string): Contour[] {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: Contour[] = [];
  let cur: Contour | null = null;
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: Pt | null = null;
  let lastQ: Pt | null = null;
  const num = () => Number(toks[i++]);
  const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
  const close = () => {
    if (cur && cur.nodes.length > 1 && C_isZ) {
      const a = cur.nodes[0];
      const b = cur.nodes[cur.nodes.length - 1];
      // Drop a duplicated closing point, keeping its incoming handle.
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) {
        if (b.hin) a.hin = b.hin;
        cur.nodes.pop();
      }
    }
  };
  let C_isZ = false;
  while (i < toks.length) {
    if (!isNum()) cmd = toks[i++];
    C_isZ = cmd.toUpperCase() === 'Z';
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'Z') {
      close();
      if (cur) cur.open = false;
      cur = null;
      x = sx;
      y = sy;
      lastC = lastQ = null;
      continue;
    }
    if (!cur && C !== 'M') {
      cur = { nodes: [{ x, y }], open: true };
      out.push(cur);
    }
    switch (C) {
      case 'M': {
        close();
        x = num() + ox;
        y = num() + oy;
        sx = x;
        sy = y;
        cur = { nodes: [{ x, y }], open: true };
        out.push(cur);
        cmd = rel ? 'l' : 'L';
        lastC = lastQ = null;
        break;
      }
      case 'L':
        x = num() + ox;
        y = num() + oy;
        cur!.nodes.push({ x, y });
        lastC = lastQ = null;
        break;
      case 'H':
        x = num() + ox;
        cur!.nodes.push({ x, y });
        lastC = lastQ = null;
        break;
      case 'V':
        y = num() + oy;
        cur!.nodes.push({ x, y });
        lastC = lastQ = null;
        break;
      case 'C':
      case 'S': {
        const prev = cur!.nodes[cur!.nodes.length - 1];
        let c1: Pt;
        if (C === 'C') c1 = { x: num() + ox, y: num() + oy };
        else c1 = lastC ? { x: 2 * x - lastC.x, y: 2 * y - lastC.y } : { x, y };
        const c2 = { x: num() + ox, y: num() + oy };
        x = num() + ox;
        y = num() + oy;
        prev.hout = c1;
        cur!.nodes.push({ x, y, hin: c2 });
        lastC = c2;
        lastQ = null;
        break;
      }
      case 'Q':
      case 'T': {
        const prev = cur!.nodes[cur!.nodes.length - 1];
        let q: Pt;
        if (C === 'Q') q = { x: num() + ox, y: num() + oy };
        else q = lastQ ? { x: 2 * x - lastQ.x, y: 2 * y - lastQ.y } : { x, y };
        const nx = num() + ox;
        const ny = num() + oy;
        prev.hout = { x: x + ((q.x - x) * 2) / 3, y: y + ((q.y - y) * 2) / 3 };
        cur!.nodes.push({ x: nx, y: ny, hin: { x: nx + ((q.x - nx) * 2) / 3, y: ny + ((q.y - ny) * 2) / 3 } });
        x = nx;
        y = ny;
        lastQ = q;
        lastC = null;
        break;
      }
      default:
        // Unsupported (arcs): skip its numbers.
        while (isNum()) i++;
    }
  }
  C_isZ = false;
  close();
  return out.filter((c) => c.nodes.length >= 2);
}

const f = (v: number) => {
  const s = v.toFixed(5);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

export function serializePath(cs: Contour[]): string {
  let d = '';
  for (const c of cs) {
    const n = c.nodes.length;
    if (n < 2) continue;
    d += `M${f(c.nodes[0].x)} ${f(c.nodes[0].y)}`;
    for (let k = 1; k <= (c.open ? n - 1 : n); k++) {
      const a = c.nodes[k - 1];
      const b = c.nodes[k % n];
      if (a.hout || b.hin) {
        const c1 = a.hout ?? a;
        const c2 = b.hin ?? b;
        d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`;
      } else if (k < n) {
        d += `L${f(b.x)} ${f(b.y)}`;
      }
    }
    if (!c.open) d += 'Z';
  }
  return d;
}

export function bezierAt(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const s = 1 - t;
  return {
    x: s * s * s * p0.x + 3 * s * s * t * c1.x + 3 * s * t * t * c2.x + t * t * t * p3.x,
    y: s * s * s * p0.y + 3 * s * s * t * c1.y + 3 * s * t * t * c2.y + t * t * t * p3.y,
  };
}

/** Nearest point on segment k (node k → k+1) to p: returns t and distance. */
export function nearestOnSegment(c: Contour, k: number, p: Pt): { t: number; d: number } {
  const n = c.nodes.length;
  const a = c.nodes[k];
  const b = c.nodes[(k + 1) % n];
  const c1 = a.hout ?? a;
  const c2 = b.hin ?? b;
  let best = { t: 0, d: Infinity };
  for (let s = 0; s <= 48; s++) {
    const t = s / 48;
    const q = bezierAt(a, c1, c2, b, t);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.d) best = { t, d };
  }
  return best;
}

/** Insert a node at t on segment k (de Casteljau), keeping the curve's shape. */
export function splitSegment(c: Contour, k: number, t: number) {
  const n = c.nodes.length;
  const a = c.nodes[k];
  const b = c.nodes[(k + 1) % n];
  if (!a.hout && !b.hin) {
    c.nodes.splice(k + 1, 0, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    return;
  }
  const p0 = a;
  const p1 = a.hout ?? a;
  const p2 = b.hin ?? b;
  const p3 = b;
  const lerp = (u: Pt, v: Pt) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const q0 = lerp(p0, p1);
  const q1 = lerp(p1, p2);
  const q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1);
  const r1 = lerp(q1, q2);
  const s = lerp(r0, r1);
  a.hout = q0;
  b.hin = q2;
  c.nodes.splice(k + 1, 0, { x: s.x, y: s.y, hin: r0, hout: r1 });
}

/** Make a node smooth (handles along the neighbours' direction) or sharp. */
export function toggleSmooth(c: Contour, k: number) {
  const nd = c.nodes[k];
  if (nd.hin || nd.hout) {
    delete nd.hin;
    delete nd.hout;
    return;
  }
  const n = c.nodes.length;
  const prev = c.nodes[(k - 1 + n) % n];
  const next = c.nodes[(k + 1) % n];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  const lin = Math.hypot(nd.x - prev.x, nd.y - prev.y) / 3;
  const lout = Math.hypot(next.x - nd.x, next.y - nd.y) / 3;
  nd.hin = { x: nd.x - (dx / len) * lin, y: nd.y - (dy / len) * lin };
  nd.hout = { x: nd.x + (dx / len) * lout, y: nd.y + (dy / len) * lout };
}
