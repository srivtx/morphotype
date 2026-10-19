//! Polyline → Bézier curve fitting (Schneider's algorithm with corner
//! detection) and cubic → quadratic conversion for TrueType output.

use crate::geom::{CurveContour, CurveShape, Pt, Seg, Shape};

/// Fit every contour of `s` with cubic Béziers within `tol` (document units).
pub fn fit_shape(s: &Shape, tol: f64, corner_deg: f64) -> CurveShape {
    s.contours
        .iter()
        .filter(|c| c.len() >= 3)
        .map(|c| fit_closed(c, tol, corner_deg))
        .collect()
}

/// Indices kept by RDP on the closed polyline (always includes 0).
fn rdp_indices(c: &[Pt], eps: f64) -> Vec<usize> {
    let n = c.len();
    let mut keep = vec![false; n + 1];
    keep[0] = true;
    keep[n] = true;
    let at = |i: usize| c[i % n];
    let mut stack = vec![(0usize, n)];
    while let Some((s, e)) = stack.pop() {
        if e <= s + 1 {
            continue;
        }
        let (a, b) = (at(s), at(e));
        let ab = b - a;
        let l2 = ab.len2();
        let mut best = -1.0;
        let mut idx = s;
        for i in s + 1..e {
            let p = at(i);
            let d = if l2 < 1e-18 {
                p.dist(a)
            } else {
                let t = ((p - a).dot(ab) / l2).clamp(0.0, 1.0);
                p.dist(a + ab * t)
            };
            if d > best {
                best = d;
                idx = i;
            }
        }
        // Closed loop: the first split must always happen even if a == b.
        if best > eps || (s == 0 && e == n) {
            keep[idx] = true;
            stack.push((s, idx));
            stack.push((idx, e));
        }
    }
    (0..n).filter(|&i| keep[i]).collect()
}

fn turn_angle(a: Pt, b: Pt, c: Pt) -> f64 {
    let u = (b - a).normalized();
    let v = (c - b).normalized();
    u.cross(v).atan2(u.dot(v)).abs()
}

/// Fit one closed polyline.
pub fn fit_closed(c: &[Pt], tol: f64, corner_deg: f64) -> CurveContour {
    // Long straight runs carry few points, and a cubic could bulge between them
    // unseen by the error check: give every edge samples at most ~4 tol apart.
    let step = (tol * 4.0).max(1e-6);
    let mut dense: Vec<Pt> = Vec::with_capacity(c.len());
    for i in 0..c.len() {
        let (a, b) = (c[i], c[(i + 1) % c.len()]);
        dense.push(a);
        let k = (a.dist(b) / step).floor() as usize;
        for j in 1..k.min(4096) {
            dense.push(a.lerp(b, j as f64 / k as f64));
        }
    }
    let c = &dense[..];
    let n = c.len();
    let key = rdp_indices(c, tol * 0.5);
    let m = key.len();
    let corner_rad = corner_deg.to_radians();
    let mut corners: Vec<usize> = Vec::new();
    if m >= 3 {
        for k in 0..m {
            let a = c[key[(k + m - 1) % m]];
            let b = c[key[k]];
            let d = c[key[(k + 1) % m]];
            if turn_angle(a, b, d) > corner_rad {
                corners.push(key[k]);
            }
        }
    }
    let smooth_loop = corners.is_empty();
    if smooth_loop {
        corners.push(0);
        if n > 6 {
            corners.push(n / 2);
        }
    }
    let k = corners.len();
    let mut segs: Vec<Seg> = Vec::new();
    for ci in 0..k {
        let s = corners[ci];
        let e = if ci + 1 < k { corners[ci + 1] } else { corners[0] + n };
        let pts: Vec<Pt> = (s..=e).map(|i| c[i % n]).collect();
        if pts.len() < 2 {
            continue;
        }
        let (t1, t2) = if smooth_loop {
            // Tangent continuity across the artificial split points.
            let ts = (c[(s + 1) % n] - c[(s + n - 1) % n]).normalized();
            let te = (c[(e + n - 1) % n] - c[(e + 1) % n]).normalized();
            (ts, te)
        } else {
            (left_tangent(&pts), right_tangent(&pts))
        };
        fit_cubic(&pts, t1, t2, tol, &mut segs, 0);
    }
    CurveContour { start: c[corners[0] % n], segs }
}

fn left_tangent(p: &[Pt]) -> Pt {
    // Average a couple of samples for robustness on noisy traces.
    let far = 3.min(p.len() - 1);
    ((p[1] - p[0]).normalized() + (p[far] - p[0]).normalized()).normalized()
}

fn right_tangent(p: &[Pt]) -> Pt {
    let n = p.len();
    let near = n.saturating_sub(2);
    let far = n.saturating_sub(4);
    ((p[near] - p[n - 1]).normalized() + (p[far] - p[n - 1]).normalized()).normalized()
}

fn bezier(b: &[Pt; 4], t: f64) -> Pt {
    let mt = 1.0 - t;
    b[0] * (mt * mt * mt) + b[1] * (3.0 * mt * mt * t) + b[2] * (3.0 * mt * t * t) + b[3] * (t * t * t)
}

fn bezier_d1(b: &[Pt; 4], t: f64) -> Pt {
    let mt = 1.0 - t;
    (b[1] - b[0]) * (3.0 * mt * mt) + (b[2] - b[1]) * (6.0 * mt * t) + (b[3] - b[2]) * (3.0 * t * t)
}

fn bezier_d2(b: &[Pt; 4], t: f64) -> Pt {
    (b[2] - b[1] * 2.0 + b[0]) * (6.0 * (1.0 - t)) + (b[3] - b[2] * 2.0 + b[1]) * (6.0 * t)
}

fn chord_params(p: &[Pt]) -> Vec<f64> {
    let mut u = Vec::with_capacity(p.len());
    u.push(0.0);
    for i in 1..p.len() {
        let prev = u[i - 1];
        u.push(prev + p[i].dist(p[i - 1]));
    }
    let total = *u.last().unwrap_or(&1.0);
    if total > 0.0 {
        for x in &mut u {
            *x /= total;
        }
    }
    u
}

fn generate(p: &[Pt], u: &[f64], t1: Pt, t2: Pt) -> [Pt; 4] {
    let n = p.len();
    let (first, last) = (p[0], p[n - 1]);
    let mut c = [[0.0f64; 2]; 2];
    let mut x = [0.0f64; 2];
    for i in 0..n {
        let t = u[i];
        let mt = 1.0 - t;
        let b1 = 3.0 * mt * mt * t;
        let b2 = 3.0 * mt * t * t;
        let a1 = t1 * b1;
        let a2 = t2 * b2;
        c[0][0] += a1.dot(a1);
        c[0][1] += a1.dot(a2);
        c[1][1] += a2.dot(a2);
        let base = first * (mt * mt * mt + b1) + last * (b2 + t * t * t);
        let tmp = p[i] - base;
        x[0] += a1.dot(tmp);
        x[1] += a2.dot(tmp);
    }
    c[1][0] = c[0][1];
    let det = c[0][0] * c[1][1] - c[1][0] * c[0][1];
    let seg_len = first.dist(last);
    let (mut al, mut ar) = if det.abs() > 1e-12 {
        ((x[0] * c[1][1] - x[1] * c[0][1]) / det, (c[0][0] * x[1] - c[1][0] * x[0]) / det)
    } else {
        (0.0, 0.0)
    };
    let eps = 1e-6 * seg_len;
    // Handles longer than the chord loop or overshoot (typically at sharp
    // inner corners); fall back so the caller splits instead.
    if al < eps || ar < eps || al > seg_len * 1.5 || ar > seg_len * 1.5 || al + ar > seg_len * 2.0 {
        al = seg_len / 3.0;
        ar = seg_len / 3.0;
    }
    [first, first + t1 * al, last + t2 * ar, last]
}

fn max_error(p: &[Pt], b: &[Pt; 4], u: &[f64]) -> (f64, usize) {
    let mut best = 0.0;
    let mut idx = p.len() / 2;
    for i in 1..p.len() - 1 {
        let d = bezier(b, u[i]).dist(p[i]);
        if d > best {
            best = d;
            idx = i;
        }
    }
    (best, idx)
}

fn reparameterize(p: &[Pt], b: &[Pt; 4], u: &mut [f64]) {
    for i in 0..p.len() {
        let t = u[i];
        let d = bezier(b, t) - p[i];
        let d1 = bezier_d1(b, t);
        let d2 = bezier_d2(b, t);
        let num = d.dot(d1);
        let den = d1.dot(d1) + d.dot(d2);
        if den.abs() > 1e-12 {
            u[i] = (t - num / den).clamp(0.0, 1.0);
        }
    }
}

fn is_straight(b: &[Pt; 4], tol: f64) -> bool {
    let ab = b[3] - b[0];
    let l = ab.len();
    if l < 1e-12 {
        return true;
    }
    let d1 = (b[1] - b[0]).cross(ab).abs() / l;
    let d2 = (b[2] - b[0]).cross(ab).abs() / l;
    d1 < tol * 0.25 && d2 < tol * 0.25
}

fn push(b: [Pt; 4], tol: f64, out: &mut Vec<Seg>) {
    if is_straight(&b, tol) {
        out.push(Seg::Line(b[3]));
    } else {
        out.push(Seg::Cubic(b[1], b[2], b[3]));
    }
}

fn fit_cubic(p: &[Pt], t1: Pt, t2: Pt, tol: f64, out: &mut Vec<Seg>, depth: u32) {
    let n = p.len();
    if n == 2 || depth > 24 {
        out.push(Seg::Line(p[n - 1]));
        return;
    }
    let mut u = chord_params(p);
    let mut b = generate(p, &u, t1, t2);
    let (mut err, mut split) = max_error(p, &b, &u);
    if err < tol {
        push(b, tol, out);
        return;
    }
    if err < tol * 4.0 {
        for _ in 0..6 {
            reparameterize(p, &b, &mut u);
            b = generate(p, &u, t1, t2);
            let (e, s) = max_error(p, &b, &u);
            err = e;
            split = s;
            if err < tol {
                push(b, tol, out);
                return;
            }
        }
    }
    let split = split.clamp(1, n - 2);
    let mut tc = (p[split - 1] - p[split + 1]).normalized();
    if tc.len2() < 0.5 {
        tc = (p[split - 1] - p[split]).normalized();
    }
    fit_cubic(&p[..=split], t1, tc, tol, out, depth + 1);
    fit_cubic(&p[split..], -tc, t2, tol, out, depth + 1);
}

/// Approximate a cubic (p0, c1, c2, p3) by quadratics within `tol`.
/// Returns (control, end) pairs.
pub fn cubic_to_quads(p0: Pt, c1: Pt, c2: Pt, p3: Pt, tol: f64) -> Vec<(Pt, Pt)> {
    // Error of the mid-point approximation scales with |p3 - 3c2 + 3c1 - p0| / n^3.
    let d = (p3 - c2 * 3.0 + c1 * 3.0 - p0).len();
    let mut n = 1usize;
    while n < 16 && (3f64.sqrt() / 36.0) * d / (n * n * n) as f64 > tol {
        n += 1;
    }
    let b = [p0, c1, c2, p3];
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let t0 = k as f64 / n as f64;
        let t1 = (k + 1) as f64 / n as f64;
        let q0 = bezier(&b, t0);
        let q3 = bezier(&b, t1);
        let dt = t1 - t0;
        let qc1 = q0 + bezier_d1(&b, t0) * (dt / 3.0);
        let qc2 = q3 - bezier_d1(&b, t1) * (dt / 3.0);
        let ctrl = (qc1 * 3.0 - q0 + qc2 * 3.0 - q3) * 0.25;
        out.push((ctrl, q3));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::{pt, signed_area};

    #[test]
    fn circle_fits_with_few_segments() {
        let c: Vec<Pt> = (0..400)
            .map(|k| {
                let a = k as f64 / 400.0 * std::f64::consts::TAU;
                pt(100.0 * a.cos(), 100.0 * a.sin())
            })
            .collect();
        let fitted = fit_closed(&c, 0.25, 45.0);
        assert!(fitted.segs.len() <= 12, "{} segs", fitted.segs.len());
        let back = fitted.flatten(0.05);
        let ea = signed_area(&c);
        assert!((signed_area(&back) - ea).abs() / ea.abs() < 0.01);
        for p in back {
            assert!((p.len() - 100.0).abs() < 0.6);
        }
    }

    #[test]
    fn square_stays_square() {
        let mut sq = Vec::new();
        for k in 0..40 {
            sq.push(pt(k as f64, 0.0));
        }
        for k in 0..40 {
            sq.push(pt(40.0, k as f64));
        }
        for k in 0..40 {
            sq.push(pt(40.0 - k as f64, 40.0));
        }
        for k in 0..40 {
            sq.push(pt(0.0, 40.0 - k as f64));
        }
        let f = fit_closed(&sq, 0.1, 45.0);
        assert_eq!(f.segs.len(), 4);
        assert!(f.segs.iter().all(|s| matches!(s, Seg::Line(_))));
    }

    #[test]
    fn quads_approximate_cubic() {
        let (p0, c1, c2, p3) = (pt(0.0, 0.0), pt(0.0, 100.0), pt(100.0, 100.0), pt(100.0, 0.0));
        let qs = cubic_to_quads(p0, c1, c2, p3, 0.5);
        assert!(qs.len() >= 1 && qs.len() <= 6);
        assert_eq!(qs.last().unwrap().1, p3);
    }
}
