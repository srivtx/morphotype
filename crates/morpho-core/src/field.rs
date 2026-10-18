//! Signed distance fields over a regular grid.
//!
//! Every "non-local" shape operation (weight, rounding, outlines, ink bleed,
//! boolean cut-outs) goes through the same robust path:
//! shape → narrow-band exact signed distance → per-sample function → iso-contour.
//! Contour extraction never self-intersects, merges overlapping strokes
//! correctly and is independent of the source font's winding conventions.

use crate::geom::{pt, signed_area, simplify_closed, Pt, Rect, Shape};

/// Sample `(i, j)` lives at `origin + ((i + 0.5) * cell, (j + 0.5) * cell)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub origin: Pt,
    pub cell: f64,
}

/// Hard cap on samples per field so a huge layer can't stall the engine.
pub const MAX_SAMPLES: usize = 4_000_000;

impl Grid {
    /// Grid covering `bbox` grown by `pad`, with roughly `cell` spacing.
    /// The cell grows if the sample budget would be exceeded.
    pub fn covering(bbox: Rect, pad: f64, cell: f64) -> Grid {
        let mut cell = cell.max(1e-6);
        let x0 = bbox.x0 - pad;
        let y0 = bbox.y0 - pad;
        let bw = (bbox.width() + 2.0 * pad).max(cell);
        let bh = (bbox.height() + 2.0 * pad).max(cell);
        let cells = (bw / cell) * (bh / cell);
        if cells > MAX_SAMPLES as f64 {
            cell *= (cells / MAX_SAMPLES as f64).sqrt();
        }
        let w = ((bw / cell).ceil() as usize + 2).max(3);
        let h = ((bh / cell).ceil() as usize + 2).max(3);
        Grid { w, h, origin: pt(x0 - cell, y0 - cell), cell }
    }
    #[inline]
    pub fn sample_pos(&self, i: usize, j: usize) -> Pt {
        pt(
            self.origin.x + (i as f64 + 0.5) * self.cell,
            self.origin.y + (j as f64 + 0.5) * self.cell,
        )
    }
    pub fn len(&self) -> usize {
        self.w * self.h
    }
}

/// Nonzero-winding rasterization sampled at cell centres. 1 = inside.
pub fn rasterize(s: &Shape, g: &Grid) -> Vec<u8> {
    let mut rows: Vec<Vec<(f64, i32)>> = vec![Vec::new(); g.h];
    let inv = 1.0 / g.cell;
    for c in &s.contours {
        let n = c.len();
        if n < 3 {
            continue;
        }
        for k in 0..n {
            let a = c[k];
            let b = c[(k + 1) % n];
            if a.y == b.y {
                continue;
            }
            let (lo, hi, dir) = if a.y < b.y { (a, b, 1) } else { (b, a, -1) };
            // Rows whose centre y is in [lo.y, hi.y).
            let j0 = ((lo.y - g.origin.y) * inv - 0.5).ceil().max(0.0) as usize;
            let j1f = ((hi.y - g.origin.y) * inv - 0.5).ceil();
            if j1f <= 0.0 {
                continue;
            }
            let j1 = (j1f as usize).min(g.h);
            let slope = (hi.x - lo.x) / (hi.y - lo.y);
            for j in j0..j1 {
                let y = g.origin.y + (j as f64 + 0.5) * g.cell;
                rows[j].push((lo.x + (y - lo.y) * slope, dir));
            }
        }
    }
    let mut out = vec![0u8; g.len()];
    for (j, row) in rows.iter_mut().enumerate() {
        if row.is_empty() {
            continue;
        }
        row.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut wind = 0;
        for k in 0..row.len() {
            wind += row[k].1;
            if wind != 0 && k + 1 < row.len() {
                let xa = (row[k].0 - g.origin.x) * inv - 0.5;
                let xb = (row[k + 1].0 - g.origin.x) * inv - 0.5;
                let i0 = xa.ceil().max(0.0) as usize;
                let i1 = (xb.ceil().max(0.0) as usize).min(g.w);
                if i0 < i1 {
                    out[j * g.w + i0..j * g.w + i1].fill(1);
                }
            }
        }
    }
    out
}

/// Signed distance (negative inside) that is exact within `band` of the
/// outline and clamped to ±band beyond it.
pub fn signed_distance(s: &Shape, g: &Grid, band: f64) -> Vec<f32> {
    let mask = rasterize(s, g);
    let band = band.max(g.cell * 1.5);
    let mut d2 = vec![(band * band) as f32; g.len()];
    let inv = 1.0 / g.cell;
    for c in &s.contours {
        let n = c.len();
        if n < 2 {
            continue;
        }
        for k in 0..n {
            let a = c[k];
            let b = c[(k + 1) % n];
            let ab = b - a;
            let l2 = ab.len2();
            let i0 = (((a.x.min(b.x) - band - g.origin.x) * inv - 0.5).floor().max(0.0)) as usize;
            let i1 = (((a.x.max(b.x) + band - g.origin.x) * inv - 0.5).ceil().max(0.0) as usize).min(g.w.saturating_sub(1));
            let j0 = (((a.y.min(b.y) - band - g.origin.y) * inv - 0.5).floor().max(0.0)) as usize;
            let j1 = (((a.y.max(b.y) + band - g.origin.y) * inv - 0.5).ceil().max(0.0) as usize).min(g.h.saturating_sub(1));
            if i0 > i1 || j0 > j1 {
                continue;
            }
            // Long diagonal edges would sweep a large box; restrict each row to
            // the x-range actually within `band` of the segment.
            for j in j0..=j1 {
                let py = g.origin.y + (j as f64 + 0.5) * g.cell;
                let row = j * g.w;
                for i in i0..=i1 {
                    let p = pt(g.origin.x + (i as f64 + 0.5) * g.cell, py);
                    let ap = p - a;
                    let t = if l2 > 1e-18 { (ap.dot(ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
                    let q = ap - ab * t;
                    let dd = q.len2() as f32;
                    let slot = &mut d2[row + i];
                    if dd < *slot {
                        *slot = dd;
                    }
                }
            }
        }
    }
    d2.iter()
        .zip(mask.iter())
        .map(|(&dd, &m)| {
            let d = dd.sqrt();
            if m != 0 { -d } else { d }
        })
        .collect()
}

/// Marching squares on `v` at `level`; inside is `v < level`.
/// Output loops keep the inside on their right, i.e. solids have positive area.
pub fn iso_contours(v: &[f32], g: &Grid, level: f32) -> Shape {
    let (w, h) = (g.w, g.h);
    if w < 2 || h < 2 || v.len() < w * h {
        return Shape::default();
    }
    let val = |i: usize, j: usize| -> f32 {
        // Border samples are forced outside so every loop closes.
        if i == 0 || j == 0 || i == w - 1 || j == h - 1 {
            f32::MAX
        } else {
            v[j * w + i] - level
        }
    };
    // Edge ids: horizontal edge from (i,j) to (i+1,j) = 2*(j*w+i); vertical (i,j)-(i,j+1) = +1.
    let hid = |i: usize, j: usize| 2 * (j * w + i);
    let vid = |i: usize, j: usize| 2 * (j * w + i) + 1;
    let mut next: Vec<u32> = vec![u32::MAX; 2 * w * h];
    let mut points: Vec<Pt> = vec![Pt::default(); 2 * w * h];
    let mut starts: Vec<u32> = Vec::new();
    let interp = |pa: Pt, pb: Pt, va: f32, vb: f32| -> Pt {
        let t = (va / (va - vb)) as f64;
        pa.lerp(pb, t.clamp(0.0, 1.0))
    };
    for j in 0..h - 1 {
        for i in 0..w - 1 {
            let va = val(i, j);
            let vb = val(i + 1, j);
            let vc = val(i + 1, j + 1);
            let vd = val(i, j + 1);
            let ina = va < 0.0;
            let inb = vb < 0.0;
            let inc = vc < 0.0;
            let ind = vd < 0.0;
            if ina == inb && inb == inc && inc == ind {
                continue;
            }
            let pa = g.sample_pos(i, j);
            let pb = g.sample_pos(i + 1, j);
            let pc = g.sample_pos(i + 1, j + 1);
            let pd = g.sample_pos(i, j + 1);
            // Walk the cell clockwise (a→b→c→d) collecting crossings.
            // (edge id, point, leaving-inside?)
            let mut xs: [(usize, Pt, bool); 4] = [(0, Pt::default(), false); 4];
            let mut n = 0;
            let corners = [(ina, va, pa), (inb, vb, pb), (inc, vc, pc), (ind, vd, pd)];
            let edge_ids = [hid(i, j), vid(i + 1, j), hid(i, j + 1), vid(i, j)];
            for k in 0..4 {
                let (i0, v0, p0) = corners[k];
                let (i1, v1, p1) = corners[(k + 1) % 4];
                if i0 != i1 {
                    xs[n] = (edge_ids[k], interp(p0, p1, v0, v1), i0);
                    n += 1;
                }
            }
            let mut link = |from: usize, to: usize| {
                let (eid, p, _) = xs[from];
                let (tid, tp, _) = xs[to];
                points[eid] = p;
                points[tid] = tp;
                next[eid] = tid as u32;
                starts.push(eid as u32);
            };
            if n == 2 {
                if xs[0].2 { link(0, 1) } else { link(1, 0) }
            } else if n == 4 {
                let centre_in = (va + vb + vc + vd) * 0.25 < 0.0;
                for k in 0..4 {
                    if xs[k].2 {
                        let to = if centre_in { (k + 1) % 4 } else { (k + 3) % 4 };
                        link(k, to);
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    for &s in &starts {
        let s = s as usize;
        if next[s] == u32::MAX {
            continue;
        }
        let mut loop_pts = Vec::new();
        let mut cur = s;
        let mut guard = 0usize;
        while next[cur] != u32::MAX && guard < 4 * w * h {
            loop_pts.push(points[cur]);
            let nx = next[cur] as usize;
            next[cur] = u32::MAX;
            cur = nx;
            guard += 1;
        }
        if loop_pts.len() >= 3 {
            out.push(loop_pts);
        }
    }
    Shape::new(out)
}

/// Iso-contours simplified to `eps` and with specks smaller than `min_area` removed.
pub fn extract(v: &[f32], g: &Grid, level: f32, eps: f64, min_area: f64) -> Shape {
    let raw = iso_contours(v, g, level);
    let contours = raw
        .contours
        .into_iter()
        .filter(|c| signed_area(c).abs() >= min_area)
        .map(|c| simplify_closed(&c, eps))
        .filter(|c| c.len() >= 3)
        .collect();
    Shape::new(contours)
}

/// Axis-aligned outlines of filled cells (pixel-art tracing). Solids positive.
pub fn block_contours(mask: &[u8], w: usize, h: usize, origin: Pt, cell: f64) -> Shape {
    let filled = |i: isize, j: isize| -> bool {
        i >= 0 && j >= 0 && (i as usize) < w && (j as usize) < h && mask[j as usize * w + i as usize] != 0
    };
    let vw = w + 1;
    let vkey = |x: usize, y: usize| y * vw + x;
    // Up to two outgoing edges per vertex: (target vertex, direction index).
    let mut out_edges: Vec<[(u32, u8); 2]> = vec![[(u32::MAX, 0); 2]; vw * (h + 1)];
    let mut add = |from: usize, to: usize, dir: u8| {
        let slot = &mut out_edges[from];
        if slot[0].0 == u32::MAX {
            slot[0] = (to as u32, dir);
        } else {
            slot[1] = (to as u32, dir);
        }
    };
    // Directions: 0 east, 1 south, 2 west, 3 north (y-down).
    for j in 0..h {
        for i in 0..w {
            if mask[j * w + i] == 0 {
                continue;
            }
            let (ii, jj) = (i as isize, j as isize);
            if !filled(ii, jj - 1) {
                add(vkey(i, j), vkey(i + 1, j), 0);
            }
            if !filled(ii + 1, jj) {
                add(vkey(i + 1, j), vkey(i + 1, j + 1), 1);
            }
            if !filled(ii, jj + 1) {
                add(vkey(i + 1, j + 1), vkey(i, j + 1), 2);
            }
            if !filled(ii - 1, jj) {
                add(vkey(i, j + 1), vkey(i, j), 3);
            }
        }
    }
    let mut contours = Vec::new();
    for start in 0..out_edges.len() {
        loop {
            let first = out_edges[start].iter().position(|e| e.0 != u32::MAX);
            let Some(k) = first else { break };
            let mut verts: Vec<usize> = vec![start];
            let mut dirs: Vec<u8> = Vec::new();
            let (mut to, mut dir) = out_edges[start][k];
            out_edges[start][k].0 = u32::MAX;
            dirs.push(dir);
            let mut guard = 0;
            while to as usize != start && guard < 4 * vw * (h + 1) {
                guard += 1;
                let v = to as usize;
                verts.push(v);
                let slot = out_edges[v];
                // Prefer a right turn at ambiguous (diagonal) vertices.
                let right = (dir + 1) % 4;
                let pick = if slot[0].0 != u32::MAX && slot[1].0 != u32::MAX {
                    if slot[1].1 == right { 1 } else { 0 }
                } else if slot[0].0 != u32::MAX {
                    0
                } else if slot[1].0 != u32::MAX {
                    1
                } else {
                    break;
                };
                let e = slot[pick];
                out_edges[v][pick].0 = u32::MAX;
                to = e.0;
                dir = e.1;
                dirs.push(dir);
            }
            // Keep only vertices where the direction changes.
            let m = verts.len();
            let mut poly = Vec::new();
            for idx in 0..m {
                let din = dirs[(idx + m - 1) % m];
                let dout = dirs[idx];
                if din != dout {
                    let v = verts[idx];
                    poly.push(pt(origin.x + (v % vw) as f64 * cell, origin.y + (v / vw) as f64 * cell));
                }
            }
            if poly.len() >= 4 {
                contours.push(poly);
            }
        }
    }
    Shape::new(contours)
}

/// Separable box blur, `radius` in samples (applied `passes` times ≈ gaussian).
pub fn box_blur(v: &mut [f32], w: usize, h: usize, radius: usize, passes: usize) {
    if radius == 0 || w == 0 || h == 0 {
        return;
    }
    let mut tmp = vec![0f32; v.len()];
    let r = radius as isize;
    let norm = 1.0 / (2 * radius + 1) as f32;
    for _ in 0..passes {
        for j in 0..h {
            let row = &v[j * w..(j + 1) * w];
            let mut acc = 0f32;
            for k in -r..=r {
                acc += row[k.clamp(0, w as isize - 1) as usize];
            }
            for i in 0..w {
                tmp[j * w + i] = acc * norm;
                let add = (i as isize + r + 1).clamp(0, w as isize - 1) as usize;
                let sub = (i as isize - r).clamp(0, w as isize - 1) as usize;
                acc += row[add] - row[sub];
            }
        }
        for i in 0..w {
            let mut acc = 0f32;
            for k in -r..=r {
                acc += tmp[k.clamp(0, h as isize - 1) as usize * w + i];
            }
            for j in 0..h {
                v[j * w + i] = acc * norm;
                let add = (j as isize + r + 1).clamp(0, h as isize - 1) as usize;
                let sub = (j as isize - r).clamp(0, h as isize - 1) as usize;
                acc += tmp[add * w + i] - tmp[sub * w + i];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::Rect;

    fn circle(r: f64, n: usize) -> Shape {
        Shape::new(vec![(0..n)
            .map(|k| {
                let a = k as f64 / n as f64 * std::f64::consts::TAU;
                pt(r * a.cos(), r * a.sin())
            })
            .collect()])
    }

    #[test]
    fn raster_area_matches() {
        let s = circle(50.0, 256);
        let g = Grid::covering(s.bbox(), 2.0, 0.5);
        let m = rasterize(&s, &g);
        let area = m.iter().filter(|&&x| x != 0).count() as f64 * 0.25;
        let exact = std::f64::consts::PI * 2500.0;
        assert!((area - exact).abs() / exact < 0.01, "{area} vs {exact}");
    }

    #[test]
    fn iso_contour_of_circle_is_round_and_positive() {
        let s = circle(40.0, 360);
        let g = Grid::covering(s.bbox(), 12.0, 0.5);
        let f = signed_distance(&s, &g, 12.0);
        let grown = extract(&f, &g, 8.0, 0.05, 1.0);
        assert_eq!(grown.contours.len(), 1);
        let a = grown.area();
        let exact = std::f64::consts::PI * 48.0 * 48.0;
        assert!(a > 0.0);
        assert!((a - exact).abs() / exact < 0.01, "{a} vs {exact}");
    }

    #[test]
    fn ring_has_hole() {
        let mut s = circle(40.0, 200);
        let mut inner = circle(20.0, 200).contours.remove(0);
        inner.reverse();
        s.contours.push(inner);
        let g = Grid::covering(s.bbox(), 4.0, 0.5);
        let f = signed_distance(&s, &g, 4.0);
        let out = extract(&f, &g, 0.0, 0.05, 1.0);
        assert_eq!(out.contours.len(), 2);
        let exact = std::f64::consts::PI * (1600.0 - 400.0);
        assert!((out.area() - exact).abs() / exact < 0.01);
    }

    #[test]
    fn blocks_trace_l_shape() {
        // ##
        // #.
        let mask = [1, 1, 1, 0];
        let s = block_contours(&mask, 2, 2, pt(0.0, 0.0), 1.0);
        assert_eq!(s.contours.len(), 1);
        assert_eq!(s.contours[0].len(), 6);
        assert!((s.area() - 3.0).abs() < 1e-9);
        let _ = Rect::EMPTY;
    }

    #[test]
    fn blocks_trace_hole() {
        let mut mask = vec![1u8; 9];
        mask[4] = 0;
        let s = block_contours(&mask, 3, 3, pt(0.0, 0.0), 1.0);
        assert_eq!(s.contours.len(), 2);
        assert!((s.area() - 8.0).abs() < 1e-9);
    }
}
