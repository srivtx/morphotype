//! Outline morphing between two arbitrary shapes.
//!
//! 1. Contours are split into solids and holes (winding must be normalized).
//! 2. Solids are paired with solids and holes with holes by minimum cost
//!    (centroid distance + size difference). Unpaired contours grow out of /
//!    collapse into their own centroid.
//! 3. The start point of each pair is aligned (minimum travel on uniform
//!    samples). Both contours are then sampled at a shared set of arc-length
//!    fractions that includes every original vertex of either contour, so
//!    t = 0 and t = 1 reproduce the inputs exactly, corners included.
//! 4. Points are interpolated linearly.
//!
//! [`CurveMorph`] uses the same pairing and correspondence on the curves
//! themselves: both outlines are made point-compatible and their on-curve
//! and control points are interpolated, so a morph keeps proper curves (and
//! is what variable-font export needs). It returns `None` where that fails,
//! and callers fall back to [`Morph`].

use crate::geom::{centroid, normalize_winding, perimeter, resample, signed_area, CurveContour, CurveShape, Pt, Seg, Shape};

/// Prepared contour with arc-length bookkeeping.
#[derive(Clone, Debug)]
struct Prep {
    src: Vec<Pt>,
    /// Cumulative arc length at each vertex (len = src.len() + 1).
    cum: Vec<f64>,
    /// Uniform samples used for start-point alignment.
    pts: Vec<Pt>,
    c: Pt,
    size: f64,
}

fn prep(c: &[Pt], n: usize) -> Prep {
    let m = c.len();
    let mut cum = Vec::with_capacity(m + 1);
    cum.push(0.0);
    for i in 0..m {
        let l = cum[i] + c[i].dist(c[(i + 1) % m]);
        cum.push(l);
    }
    Prep { src: c.to_vec(), cum, pts: resample(c, n), c: centroid(c), size: signed_area(c).abs().sqrt().max(perimeter(c) * 0.05) }
}

fn degenerate_at(p: Pt, n: usize) -> Prep {
    Prep { src: Vec::new(), cum: vec![0.0], pts: vec![p; n], c: p, size: 0.0 }
}

impl Prep {
    fn total(&self) -> f64 {
        *self.cum.last().unwrap_or(&0.0)
    }
    /// Arc-length fractions of the original vertices.
    fn vertex_fracs(&self) -> Vec<f64> {
        let t = self.total();
        if t <= 1e-12 {
            return Vec::new();
        }
        self.cum[..self.src.len()].iter().map(|l| l / t).collect()
    }
    /// Point at arc-length fraction `f` in [0, 1).
    fn at(&self, f: f64) -> Pt {
        let m = self.src.len();
        let t = self.total();
        if m == 0 || t <= 1e-12 {
            return self.c;
        }
        let target = f.rem_euclid(1.0) * t;
        // Last vertex whose cumulative length is <= target.
        let i = match self.cum[..m].binary_search_by(|x| x.total_cmp(&target)) {
            Ok(i) => i,
            Err(i) => i.saturating_sub(1),
        };
        let seg = self.cum[i + 1] - self.cum[i];
        let u = if seg > 1e-12 { (target - self.cum[i]) / seg } else { 0.0 };
        self.src[i].lerp(self.src[(i + 1) % m], u.clamp(0.0, 1.0))
    }
}

/// Assignment between `a` and `b` (indices; `None` = unmatched).
fn assign(a: &[Prep], b: &[Prep], scale: f64) -> Vec<(Option<usize>, Option<usize>)> {
    let cost = |i: usize, j: usize| -> f64 {
        let d = a[i].c.dist(b[j].c) / scale;
        let s = (a[i].size - b[j].size).abs() / scale;
        d * d + 0.5 * s * s
    };
    let (na, nb) = (a.len(), b.len());
    let k = na.min(nb);
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    if k > 0 && na.max(nb) <= 7 {
        // Exact: try every injective map from the smaller set into the larger.
        let (small, large, swapped) = if na <= nb { (na, nb, false) } else { (nb, na, true) };
        let mut best = f64::INFINITY;
        let mut best_perm: Vec<usize> = Vec::new();
        let mut perm: Vec<usize> = Vec::with_capacity(small);
        let mut used = vec![false; large];
        fn rec(
            depth: usize,
            small: usize,
            large: usize,
            perm: &mut Vec<usize>,
            used: &mut Vec<bool>,
            acc: f64,
            best: &mut f64,
            best_perm: &mut Vec<usize>,
            cost: &dyn Fn(usize, usize) -> f64,
        ) {
            if acc >= *best {
                return;
            }
            if depth == small {
                *best = acc;
                *best_perm = perm.clone();
                return;
            }
            for j in 0..large {
                if !used[j] {
                    used[j] = true;
                    perm.push(j);
                    let c = cost(depth, j);
                    rec(depth + 1, small, large, perm, used, acc + c, best, best_perm, cost);
                    perm.pop();
                    used[j] = false;
                }
            }
        }
        let oriented = |i: usize, j: usize| if swapped { cost(j, i) } else { cost(i, j) };
        rec(0, small, large, &mut perm, &mut used, 0.0, &mut best, &mut best_perm, &oriented);
        for (i, &j) in best_perm.iter().enumerate() {
            pairs.push(if swapped { (j, i) } else { (i, j) });
        }
    } else if k > 0 {
        // Greedy on sorted costs for very busy shapes.
        let mut all: Vec<(f64, usize, usize)> = Vec::with_capacity(na * nb);
        for i in 0..na {
            for j in 0..nb {
                all.push((cost(i, j), i, j));
            }
        }
        all.sort_by(|x, y| x.0.total_cmp(&y.0));
        let mut ua = vec![false; na];
        let mut ub = vec![false; nb];
        for (_, i, j) in all {
            if !ua[i] && !ub[j] {
                ua[i] = true;
                ub[j] = true;
                pairs.push((i, j));
            }
        }
    }
    let mut out: Vec<(Option<usize>, Option<usize>)> = pairs.iter().map(|&(i, j)| (Some(i), Some(j))).collect();
    for i in 0..na {
        if !pairs.iter().any(|p| p.0 == i) {
            out.push((Some(i), None));
        }
    }
    for j in 0..nb {
        if !pairs.iter().any(|p| p.1 == j) {
            out.push((None, Some(j)));
        }
    }
    out
}

/// Rotate `b` so its start best matches `a` (comparing centroid-relative shapes).
fn best_shift(a: &Prep, b: &Prep) -> usize {
    let n = a.pts.len();
    if n == 0 || b.size == 0.0 || a.size == 0.0 {
        return 0;
    }
    let ra: Vec<Pt> = a.pts.iter().map(|&p| (p - a.c) / a.size).collect();
    let rb: Vec<Pt> = b.pts.iter().map(|&p| (p - b.c) / b.size).collect();
    let mut best = f64::INFINITY;
    let mut shift = 0;
    // Coarse pass every 4th shift, then refine around the winner.
    let coarse = 4.min(n);
    let score = |s: usize| -> f64 { (0..n).step_by(2).map(|i| (ra[i] - rb[(i + s) % n]).len2()).sum() };
    for s in (0..n).step_by(coarse) {
        let v = score(s);
        if v < best {
            best = v;
            shift = s;
        }
    }
    for d in 1..coarse {
        for s in [(shift + d) % n, (shift + n - d) % n] {
            let v = score(s);
            if v < best {
                best = v;
                shift = s;
            }
        }
    }
    shift
}

/// Dynamic-time-warping correspondence between uniform samples of `a` and
/// `b` (rotated by `shift`). Returns monotone (fraction in a, fraction in b
/// relative to the shift) knots from (0, 0) to (1, 1).
fn warp_path(a: &Prep, b: &Prep, shift: usize) -> Vec<(f64, f64)> {
    let n = a.pts.len();
    if n < 4 || a.src.is_empty() || b.src.is_empty() || b.pts.len() != n {
        return vec![(0.0, 0.0), (1.0, 1.0)];
    }
    let norm = |p: &Prep, k: usize| (p.pts[k % n] - p.c) / p.size.max(1e-12);
    let tangent = |p: &Prep, k: usize| (p.pts[(k + 1) % n] - p.pts[(k + n - 1) % n]).normalized();
    let ra: Vec<(Pt, Pt)> = (0..n).map(|i| (norm(a, i), tangent(a, i))).collect();
    let rb: Vec<(Pt, Pt)> = (0..n).map(|j| (norm(b, j + shift), tangent(b, j + shift))).collect();
    let band = (n / 3).max(2) as isize;
    let pen = 0.004f64;
    let inf = f64::INFINITY;
    let mut dp = vec![inf; n * n];
    let mut from = vec![0u8; n * n];
    for i in 0..n {
        let lo = (i as isize - band).max(0) as usize;
        let hi = ((i as isize + band) as usize).min(n - 1);
        for j in lo..=hi {
            let (pa, ta) = ra[i];
            let (pb, tb) = rb[j];
            let c = (pa - pb).len2() + 0.05 * (1.0 - ta.dot(tb));
            if i == 0 && j == 0 {
                dp[0] = c;
                continue;
            }
            let mut best = inf;
            let mut dir = 0u8;
            if i > 0 && j > 0 && dp[(i - 1) * n + j - 1] < best {
                best = dp[(i - 1) * n + j - 1];
                dir = 0;
            }
            if i > 0 && dp[(i - 1) * n + j] + pen < best {
                best = dp[(i - 1) * n + j] + pen;
                dir = 1;
            }
            if j > 0 && dp[i * n + j - 1] + pen < best {
                best = dp[i * n + j - 1] + pen;
                dir = 2;
            }
            dp[i * n + j] = best + c;
            from[i * n + j] = dir;
        }
    }
    let (mut i, mut j) = (n - 1, n - 1);
    let mut knots = vec![(1.0, 1.0)];
    loop {
        knots.push((i as f64 / n as f64, j as f64 / n as f64));
        if i == 0 && j == 0 {
            break;
        }
        match from[i * n + j] {
            0 if i > 0 && j > 0 => {
                i -= 1;
                j -= 1;
            }
            1 if i > 0 => i -= 1,
            2 if j > 0 => j -= 1,
            _ => {
                // Out of band (shouldn't happen): walk diagonally home.
                i = i.saturating_sub(1);
                j = j.saturating_sub(1);
            }
        }
    }
    knots.reverse();
    knots
}

/// Warp-path parameter u in [0, segs] where one side's fraction reaches `f`
/// (knot k sits at u = k).
fn path_invert(path: &[(f64, f64)], f: f64, pick: fn(&(f64, f64)) -> f64) -> f64 {
    let segs = path.len() - 1;
    let k = path.partition_point(|p| pick(p) <= f).clamp(1, segs);
    let (f0, f1) = (pick(&path[k - 1]), pick(&path[k]));
    let t = if f1 - f0 > 1e-12 { ((f - f0) / (f1 - f0)).clamp(0.0, 1.0) } else { 0.0 };
    (k - 1) as f64 + t
}

/// Both sides' fractions at warp-path parameter `u`.
fn path_eval(path: &[(f64, f64)], u: f64) -> (f64, f64) {
    let segs = path.len() - 1;
    let k = (u.floor() as usize).min(segs - 1);
    let t = u - k as f64;
    let (p, q) = (path[k], path[k + 1]);
    (p.0 + (q.0 - p.0) * t, p.1 + (q.1 - p.1) * t)
}

/// Sample both contours along the warp path at a shared parameter set that
/// contains every original vertex of either contour.
fn sample_along(a: &Prep, b: &Prep, path: &[(f64, f64)], sigma: f64, n: usize) -> (Vec<Pt>, Vec<Pt>) {
    let segs = path.len() - 1;
    let mut us: Vec<f64> = (0..n).map(|k| k as f64 * segs as f64 / n as f64).collect();
    us.extend(a.vertex_fracs().into_iter().map(|f| path_invert(path, f, |p| p.0)));
    us.extend(b.vertex_fracs().into_iter().map(|f| path_invert(path, (f - sigma).rem_euclid(1.0), |p| p.1)));
    us.retain(|u| *u < segs as f64);
    us.sort_by(|p, q| p.total_cmp(q));
    us.dedup_by(|p, q| (*p - *q).abs() < 1e-9);
    let mut pa = Vec::with_capacity(us.len());
    let mut pb = Vec::with_capacity(us.len());
    for u in us {
        let (fa, fb) = path_eval(path, u);
        pa.push(a.at(fa));
        pb.push(b.at(fb + sigma));
    }
    (pa, pb)
}

/// One paired contour: both sides prepared, start-aligned and warped onto a
/// shared parameter. Unpaired contours are paired with a point at their own
/// centroid. `ia`/`ib` index the input contours.
struct PairPlan {
    ia: Option<usize>,
    ib: Option<usize>,
    x: Prep,
    y: Prep,
    sigma: f64,
    path: Vec<(f64, f64)>,
    n: usize,
}

impl PairPlan {
    fn samples(&self) -> (Vec<Pt>, Vec<Pt>) {
        sample_along(&self.x, &self.y, &self.path, self.sigma, self.n)
    }
}

/// Pair the contours of two winding-normalized shapes (solids with solids,
/// holes with holes) and build each pair's correspondence.
fn plan(a: &[Vec<Pt>], b: &[Vec<Pt>], samples: usize) -> Vec<PairPlan> {
    let n = samples.clamp(16, 1024);
    let bbox = |cs: &[Vec<Pt>]| Shape::new(cs.to_vec()).bbox();
    let (ba, bb) = (bbox(a), bbox(b));
    let scale = (ba.width().max(ba.height()) + bb.width().max(bb.height())).max(1e-6) * 0.5;
    let mut plans = Vec::new();
    for solid in [true, false] {
        let pick = |s: &[Vec<Pt>]| -> (Vec<usize>, Vec<Prep>) {
            s.iter().enumerate().filter(|(_, c)| c.len() >= 3 && (signed_area(c) > 0.0) == solid).map(|(i, c)| (i, prep(c, n))).unzip()
        };
        let (ka, pa) = pick(a);
        let (kb, pb) = pick(b);
        for (ia, ib) in assign(&pa, &pb, scale) {
            let (x, y) = match (ia, ib) {
                (Some(i), Some(j)) => (pa[i].clone(), pb[j].clone()),
                (Some(i), None) => (pa[i].clone(), degenerate_at(pa[i].c, n)),
                (None, Some(j)) => (degenerate_at(pb[j].c, n), pb[j].clone()),
                (None, None) => continue,
            };
            let shift = best_shift(&x, &y);
            let path = warp_path(&x, &y, shift);
            plans.push(PairPlan { ia: ia.map(|i| ka[i]), ib: ib.map(|j| kb[j]), x, y, sigma: shift as f64 / n as f64, path, n });
        }
    }
    plans
}

/// Precomputed correspondence between two shapes; cheap to evaluate at any `t`.
#[derive(Clone, Debug)]
pub struct Morph {
    pairs: Vec<(Vec<Pt>, Vec<Pt>)>,
}

impl Morph {
    pub fn new(a: &Shape, b: &Shape, samples: usize) -> Morph {
        let mut a = a.clone();
        let mut b = b.clone();
        normalize_winding(&mut a);
        normalize_winding(&mut b);
        Morph { pairs: plan(&a.contours, &b.contours, samples).iter().map(PairPlan::samples).collect() }
    }

    pub fn at(&self, t: f64) -> Shape {
        let t = t.clamp(0.0, 1.0);
        Shape::new(
            self.pairs
                .iter()
                .map(|(a, b)| a.iter().zip(b).map(|(&p, &q)| p.lerp(q, t)).collect::<Vec<Pt>>())
                .filter(|c| signed_area(c).abs() > 1e-9)
                .collect(),
        )
    }
}

// ---------------------------------------------------------------------------
// Curve morph: the same correspondence, but on the curves themselves.
//
// Both contours of a pair are cut at each other's nodes (segment ends,
// mapped through the warp path; nodes that land close together are matched
// instead), so they get the same number of pieces. Corners, explicit points
// both sides share and shared extremes stay on-curve points; each run of
// pieces between them is refit, on both sides, as one TrueType spline (off-
// curve points with implied on-curve points between them) with as few spans
// as fit both within a tolerance, or kept piece by piece where none does.
// Matching segments have the same degree, so on-curve and control points are
// interpolated directly. The result keeps about the denser source's point
// structure instead of a dense polyline, which is also what a variable font
// needs.

/// Control points of a segment that starts at `p0`.
fn ctrl(p0: Pt, s: &Seg) -> Vec<Pt> {
    match *s {
        Seg::Line(p) => vec![p0, p],
        Seg::Quad(a, p) => vec![p0, a, p],
        Seg::Cubic(a, b, p) => vec![p0, a, b, p],
    }
}

fn seg_of(c: &[Pt]) -> Seg {
    match c.len() {
        2 => Seg::Line(c[1]),
        3 => Seg::Quad(c[1], c[2]),
        _ => Seg::Cubic(c[1], c[2], c[3]),
    }
}

/// De Casteljau split of a Bézier at `t`.
fn split(c: &[Pt], t: f64) -> (Vec<Pt>, Vec<Pt>) {
    let mut left = vec![c[0]];
    let mut right = vec![c[c.len() - 1]];
    let mut row = c.to_vec();
    while row.len() > 1 {
        row = row.windows(2).map(|w| w[0].lerp(w[1], t)).collect();
        left.push(row[0]);
        right.push(row[row.len() - 1]);
    }
    right.reverse();
    (left, right)
}

/// The part of a Bézier between parameters `t0` <= `t1`.
fn sub(c: &[Pt], t0: f64, t1: f64) -> Vec<Pt> {
    let (left, _) = split(c, t1);
    if t1 <= 1e-12 {
        return vec![c[0]; c.len()];
    }
    split(&left, (t0 / t1).clamp(0.0, 1.0)).1
}

/// Raise a Bézier to `deg` (1 = line, 2 = quadratic, 3 = cubic).
fn elevate(c: &[Pt], deg: usize) -> Vec<Pt> {
    match (c.len() - 1, deg) {
        (1, 2) => vec![c[0], c[0].lerp(c[1], 0.5), c[1]],
        (1, 3) => vec![c[0], c[0].lerp(c[1], 1.0 / 3.0), c[0].lerp(c[1], 2.0 / 3.0), c[1]],
        (2, 3) => vec![c[0], c[0].lerp(c[1], 2.0 / 3.0), c[2].lerp(c[1], 2.0 / 3.0), c[2]],
        _ => c.to_vec(),
    }
}

/// A closed curve contour flattened finely, with the curve parameter of
/// every vertex.
struct Flat {
    curve: CurveContour,
    pts: Vec<Pt>,
    /// Global curve parameter (segment index + t) of each vertex.
    par: Vec<f64>,
    /// Vertex index of each segment's start.
    node: Vec<usize>,
}

fn flat(c: &CurveContour, tol: f64) -> Flat {
    let mut curve = c.clone();
    if curve.end().dist(curve.start) > 1e-12 {
        curve.segs.push(Seg::Line(curve.start));
    }
    let mut pts = vec![curve.start];
    let mut par = vec![0.0];
    let mut node = Vec::with_capacity(curve.segs.len());
    let mut cur = curve.start;
    for (k, s) in curve.segs.iter().enumerate() {
        node.push(pts.len() - 1);
        let c = ctrl(cur, s);
        let steps = match c.len() {
            2 => 1,
            _ => {
                let dd = c.windows(3).map(|w| (w[0] - w[1] * 2.0 + w[2]).len()).fold(0.0, f64::max);
                ((dd / (8.0 * tol)).sqrt().ceil() as usize).clamp(4, 128)
            }
        };
        for i in 1..=steps {
            let t = i as f64 / steps as f64;
            pts.push(split(&c, t).0[c.len() - 1]);
            par.push(k as f64 + t);
        }
        cur = c[c.len() - 1];
    }
    // The last vertex closes the loop onto the start.
    pts.pop();
    par.pop();
    Flat { curve, pts, par, node }
}

impl Flat {
    fn nodes(&self) -> Vec<Pt> {
        let mut out = vec![self.curve.start];
        let n = self.curve.segs.len();
        out.extend(self.curve.segs[..n - 1].iter().map(|s| match *s {
            Seg::Line(p) | Seg::Quad(_, p) | Seg::Cubic(_, _, p) => p,
        }));
        out
    }

    /// Whether node `k` is the midpoint of its two neighbouring quadratic
    /// controls (a TrueType implied on-curve point).
    fn implied(&self, k: usize) -> bool {
        let n = self.curve.segs.len();
        match (self.curve.segs[(k + n - 1) % n], self.curve.segs[k]) {
            (Seg::Quad(a, p), Seg::Quad(b, _)) => p.dist(a.lerp(b, 0.5)) <= 1e-9 + 1e-6 * a.dist(b),
            _ => false,
        }
    }

    /// Unit tangents into and out of node `k`.
    fn tangents(&self, k: usize) -> Option<(Pt, Pt)> {
        let n = self.curve.segs.len();
        let nodes = self.nodes();
        let into = ctrl(nodes[(k + n - 1) % n], &self.curve.segs[(k + n - 1) % n]);
        let out = ctrl(nodes[k], &self.curve.segs[k]);
        let p = nodes[k];
        let a = into.iter().rev().find(|q| q.dist(p) > 1e-9)?;
        let b = out.iter().find(|q| q.dist(p) > 1e-9)?;
        Some(((p - *a).normalized(), (*b - p).normalized()))
    }

    /// Whether the outline turns sharply at node `k`.
    fn corner(&self, k: usize) -> bool {
        self.tangents(k).is_some_and(|(u, v)| u.cross(v).atan2(u.dot(v)).abs() > CORNER_DEG.to_radians())
    }

    /// The axis (0 = x, 1 = y) along which the outline runs through node `k`
    /// if it is smooth and axis-aligned there: an extreme in the other axis.
    fn extreme(&self, k: usize) -> Option<usize> {
        let (u, v) = self.tangents(k)?;
        let d = (u + v).normalized();
        let s = (1.0f64).to_radians().sin();
        if self.corner(k) {
            None
        } else if d.y.abs() <= s {
            Some(0)
        } else if d.x.abs() <= s {
            Some(1)
        } else {
            None
        }
    }

    /// Curve parameter at arc-length fraction `f`, using the prepared arc lengths.
    fn param_at(&self, cum: &[f64], f: f64) -> f64 {
        let m = self.pts.len();
        let target = f.rem_euclid(1.0) * cum[m];
        let i = cum[..m].partition_point(|&x| x <= target).saturating_sub(1);
        let len = cum[i + 1] - cum[i];
        let u = if len > 1e-15 { ((target - cum[i]) / len).clamp(0.0, 1.0) } else { 0.0 };
        let next = if i + 1 < m { self.par[i + 1] } else { self.curve.segs.len() as f64 };
        self.par[i] + (next - self.par[i]) * u
    }

    /// Cut the contour at ascending (cyclic) curve parameters; each piece must
    /// lie within one segment.
    fn pieces(&self, pos: &[f64]) -> Option<Vec<Piece>> {
        let ns = self.curve.segs.len();
        let nodes = self.nodes();
        let mut out = Vec::with_capacity(pos.len());
        let mut sum = 0.0;
        for i in 0..pos.len() {
            let s0 = pos[i];
            let mut ds = (pos[(i + 1) % pos.len()] - s0).rem_euclid(ns as f64);
            if ds > ns as f64 - 1e-9 {
                ds = 0.0;
            }
            sum += ds;
            let k = ((s0 + 1e-9).floor().max(0.0) as usize).min(ns - 1);
            let t0 = (s0 - k as f64).clamp(0.0, 1.0);
            let t1 = t0 + ds;
            if t1 > 1.0 + 1e-6 {
                return None;
            }
            out.push((sub(&ctrl(nodes[k], &self.curve.segs[k]), t0, t1.min(1.0)), ds));
        }
        ((sum - ns as f64).abs() < 1e-6).then_some(out)
    }
}

/// Part of a contour between two cuts: its control points and how much
/// curve parameter it spans.
type Piece = (Vec<Pt>, f64);

/// Turns sharper than this at a node make it a corner.
const CORNER_DEG: f64 = 4.0;

/// Nodes of either contour closer than this (as a fraction of each
/// perimeter) are matched to each other rather than split in two.
const NODE_MATCH: f64 = 0.05;

/// Point-compatible versions of one contour pair, or `None` when the
/// correspondence can't be expressed segment by segment.
fn pair_curves(p: &PairPlan, fa: Option<&Flat>, fb: Option<&Flat>, tol: f64) -> Option<(CurveContour, CurveContour)> {
    struct Ev {
        u: f64,
        a: Option<usize>,
        b: Option<usize>,
    }
    let path = &p.path[..];
    let mut ev: Vec<Ev> = Vec::new();
    if let Some(f) = fa {
        ev.extend(f.node.iter().enumerate().map(|(k, &v)| Ev { u: path_invert(path, p.x.cum[v] / p.x.total(), |q| q.0), a: Some(k), b: None }));
    }
    if let Some(f) = fb {
        ev.extend(f.node.iter().enumerate().map(|(k, &v)| {
            let g = (p.y.cum[v] / p.y.total() - p.sigma).rem_euclid(1.0);
            Ev { u: path_invert(path, g, |q| q.1), a: None, b: Some(k) }
        }));
    }
    ev.sort_by(|x, y| x.u.total_cmp(&y.u));
    let e = ev.len();
    if e < 2 {
        return None;
    }
    // Match nearby nodes of opposite sides, closest first.
    let mut cand: Vec<(f64, usize)> = (0..e)
        .filter(|&i| {
            let (x, y) = (&ev[i], &ev[(i + 1) % e]);
            (x.a.is_some() && y.b.is_some() && x.b.is_none() && y.a.is_none()) || (x.b.is_some() && y.a.is_some() && x.a.is_none() && y.b.is_none())
        })
        .map(|i| {
            let (fx, fy) = (path_eval(path, ev[i].u), path_eval(path, ev[(i + 1) % e].u));
            ((fy.0 - fx.0).rem_euclid(1.0).max((fy.1 - fx.1).rem_euclid(1.0)), i)
        })
        .filter(|c| c.0 < NODE_MATCH)
        .collect();
    cand.sort_by(|x, y| x.0.total_cmp(&y.0));
    let mut gone = vec![false; e];
    let mut merged = vec![false; e];
    for (_, i) in cand {
        let j = (i + 1) % e;
        if merged[i] || merged[j] || gone[i] || gone[j] {
            continue;
        }
        ev[i].a = ev[i].a.or(ev[j].a);
        ev[i].b = ev[i].b.or(ev[j].b);
        merged[i] = true;
        gone[j] = true;
    }
    let ev: Vec<Ev> = ev.into_iter().zip(gone).filter(|(_, g)| !g).map(|(x, _)| x).collect();
    // Where each event cuts one side. A cut inside a segment of this side,
    // facing an implied node on the other side, is centred between its
    // neighbouring cuts: a quadratic cut at evenly spaced parameters has each
    // cut at the midpoint of its controls, so the blend stays implied too.
    let side = |f: Option<&Flat>, prep: &Prep, own: &dyn Fn(&Ev) -> Option<usize>, other: &dyn Fn(&Ev) -> Option<usize>, other_flat: Option<&Flat>, frac: &dyn Fn(f64) -> f64| -> Option<Vec<Piece>> {
        let Some(f) = f else { return Some(vec![(vec![prep.c; 2], 0.0); ev.len()]) };
        let mut pos: Vec<f64> = ev.iter().map(|x| own(x).map_or_else(|| f.param_at(&prep.cum, frac(x.u)), |k| k as f64)).collect();
        let free: Vec<usize> = (0..ev.len()).filter(|&i| own(&ev[i]).is_none() && other(&ev[i]).zip(other_flat).is_some_and(|(k, o)| o.implied(k))).collect();
        let (m, ns) = (pos.len(), f.curve.segs.len() as f64);
        for _ in 0..32 {
            for &i in &free {
                let prev = pos[(i + m - 1) % m];
                let span = (pos[(i + 1) % m] - prev).rem_euclid(ns);
                pos[i] = (prev + span * 0.5).rem_euclid(ns);
            }
        }
        f.pieces(&pos)
    };
    let pa = side(fa, &p.x, &|x| x.a, &|x| x.b, fb, &|u| path_eval(path, u).0)?;
    let pb = side(fb, &p.y, &|x| x.b, &|x| x.a, fa, &|u| path_eval(path, u).1 + p.sigma)?;
    // Events that stay explicit on-curve points: corners of either outline,
    // nodes both outlines draw explicitly, and extremes both share (the
    // writer would split a curve there anyway). The runs between them are
    // refit as one TrueType spline each.
    let kind = |f: Option<&Flat>, k: Option<usize>| match (f, k) {
        (Some(f), Some(k)) => (!f.implied(k), f.corner(k)),
        _ => (false, false),
    };
    let mut hard: Vec<usize> = (0..ev.len())
        .filter(|&i| {
            let ((ea, ka), (eb, kb)) = (kind(fa, ev[i].a), kind(fb, ev[i].b));
            let ext = |f: Option<&Flat>, k: Option<usize>| f.zip(k).and_then(|(f, k)| f.extreme(k));
            let shared_extreme = ext(fa, ev[i].a).is_some_and(|x| ext(fb, ev[i].b) == Some(x));
            ka || kb || (ea && eb) || shared_extreme
        })
        .collect();
    if hard.is_empty() {
        hard.push(0);
    }
    let mut ca = CurveContour { start: pa[hard[0]].0[0], segs: Vec::with_capacity(ev.len()) };
    let mut cb = CurveContour { start: pb[hard[0]].0[0], segs: Vec::with_capacity(ev.len()) };
    for (h, &i) in hard.iter().enumerate() {
        let j = hard[(h + 1) % hard.len()];
        let len = (j + ev.len() - i - 1) % ev.len() + 1;
        let run = |ps: &[Piece]| (0..len).map(|k| ps[(i + k) % ps.len()].clone()).collect::<Vec<_>>();
        let (xa, xb) = run_curves(&run(&pa), &run(&pb), tol);
        ca.segs.extend(xa);
        cb.segs.extend(xb);
    }
    Some((ca, cb))
}

/// A run of pieces sampled densely, with each sample's cumulative arc
/// length and source curve parameter.
struct Run {
    pts: Vec<Pt>,
    cum: Vec<f64>,
    par: Vec<f64>,
}

impl Run {
    fn new(pieces: &[Piece]) -> Run {
        let mut pts = vec![pieces[0].0[0]];
        let mut par = vec![0.0];
        for (c, span) in pieces {
            let k = if c.len() == 2 { 2 } else { 16 };
            let p0 = par[par.len() - 1];
            for i in 1..=k {
                let t = i as f64 / k as f64;
                pts.push(split(c, t).0[c.len() - 1]);
                par.push(p0 + span * t);
            }
        }
        let mut cum = vec![0.0];
        for w in pts.windows(2) {
            cum.push(cum[cum.len() - 1] + w[0].dist(w[1]));
        }
        Run { pts, cum, par }
    }

    fn straight(&self, tol: f64) -> bool {
        let (a, b) = (self.pts[0], self.pts[self.pts.len() - 1]);
        self.pts.iter().all(|&p| seg_dist(p, a, b) <= tol)
    }
}

fn seg_dist(p: Pt, a: Pt, b: Pt) -> f64 {
    seg_project(p, a, b).1
}

/// Parameter along `a`–`b` of the point closest to `p`, and the distance.
fn seg_project(p: Pt, a: Pt, b: Pt) -> (f64, f64) {
    let ab = b - a;
    let l2 = ab.len2();
    let t = if l2 > 1e-24 { ((p - a).dot(ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
    (t, p.dist(a + ab * t))
}

fn poly_dist(p: Pt, poly: &[Pt]) -> f64 {
    poly.windows(2).map(|w| seg_dist(p, w[0], w[1])).fold(f64::INFINITY, f64::min)
}

/// Point at `u` in [0, m] on the TrueType spline from `p0` to `p1` with
/// off-curve points `c` and implied on-curve points between them.
fn spline_at(p0: Pt, p1: Pt, c: &[Pt], u: f64) -> Pt {
    let m = c.len();
    let i = (u.floor().max(0.0) as usize).min(m - 1);
    let s = (u - i as f64).clamp(0.0, 1.0);
    let a = if i == 0 { p0 } else { c[i - 1].lerp(c[i], 0.5) };
    let b = if i == m - 1 { p1 } else { c[i].lerp(c[i + 1], 0.5) };
    a * ((1.0 - s) * (1.0 - s)) + c[i] * (2.0 * s * (1.0 - s)) + b * (s * s)
}

/// Least-squares off-curve points of an `m`-span spline from `p0` to `p1`
/// through `pts` at spline parameters `us`.
fn spline_lsq(p0: Pt, p1: Pt, pts: &[Pt], us: &[f64], m: usize) -> Option<Vec<Pt>> {
    let mut nm = vec![vec![0.0; m]; m];
    let mut rx = vec![0.0; m];
    let mut ry = vec![0.0; m];
    for (&p, &u) in pts.iter().zip(us) {
        let i = (u.floor().max(0.0) as usize).min(m - 1);
        let s = (u - i as f64).clamp(0.0, 1.0);
        let (w0, w1, w2) = ((1.0 - s) * (1.0 - s), 2.0 * s * (1.0 - s), s * s);
        let mut coef: Vec<(usize, f64)> = vec![(i, w1)];
        let mut known = Pt::default();
        if i == 0 {
            known = known + p0 * w0;
        } else {
            coef.extend([(i - 1, w0 * 0.5), (i, w0 * 0.5)]);
        }
        if i == m - 1 {
            known = known + p1 * w2;
        } else {
            coef.extend([(i, w2 * 0.5), (i + 1, w2 * 0.5)]);
        }
        let r = p - known;
        for &(k, ck) in &coef {
            rx[k] += ck * r.x;
            ry[k] += ck * r.y;
            for &(l, cl) in &coef {
                nm[k][l] += ck * cl;
            }
        }
    }
    // Gaussian elimination with partial pivoting.
    for col in 0..m {
        let piv = (col..m).max_by(|&x, &y| nm[x][col].abs().total_cmp(&nm[y][col].abs()))?;
        if nm[piv][col].abs() < 1e-12 {
            return None;
        }
        nm.swap(col, piv);
        rx.swap(col, piv);
        ry.swap(col, piv);
        for row in col + 1..m {
            let f = nm[row][col] / nm[col][col];
            if f != 0.0 {
                for k in col..m {
                    nm[row][k] -= f * nm[col][k];
                }
                rx[row] -= f * rx[col];
                ry[row] -= f * ry[col];
            }
        }
    }
    let mut c = vec![Pt::default(); m];
    for row in (0..m).rev() {
        let (mut x, mut y) = (rx[row], ry[row]);
        for k in row + 1..m {
            x -= nm[row][k] * c[k].x;
            y -= nm[row][k] * c[k].y;
        }
        c[row] = crate::geom::pt(x / nm[row][row], y / nm[row][row]);
    }
    c.iter().all(|p| p.is_finite()).then_some(c)
}

/// Fit an `m`-span spline to a run within `tol` (both ways), refining the
/// sample parameters by projection a few times.
fn fit_run(r: &Run, m: usize, tol: f64) -> Option<Vec<Pt>> {
    let p0 = r.pts[0];
    let total = r.cum[r.cum.len() - 1];
    if total < 1e-12 {
        return Some(vec![p0; m]);
    }
    // Start from the source's own spline parameter (exact for a run that is
    // one TrueType chain of `m` spans), else from arc length.
    let span = r.par[r.par.len() - 1];
    let starts = [(span > 1e-9).then(|| r.par.iter().map(|v| v / span * m as f64).collect::<Vec<f64>>()), Some(r.cum.iter().map(|l| l / total * m as f64).collect())];
    starts.into_iter().flatten().find_map(|us| refine_fit(r, us, m, tol))
}

fn refine_fit(r: &Run, mut us: Vec<f64>, m: usize, tol: f64) -> Option<Vec<Pt>> {
    let (p0, p1) = (r.pts[0], r.pts[r.pts.len() - 1]);
    const DENSE: usize = 16;
    let segs = DENSE * m;
    for _ in 0..4 {
        let c = spline_lsq(p0, p1, &r.pts, &us, m)?;
        let dense: Vec<Pt> = (0..=segs).map(|j| spline_at(p0, p1, &c, j as f64 / DENSE as f64)).collect();
        // Closest point on the fit to each sample, searched within a span of
        // its current parameter (both run the same way).
        let near: Vec<(f64, f64)> = r
            .pts
            .iter()
            .zip(&us)
            .map(|(&p, &u)| {
                let j0 = (u * DENSE as f64) as usize;
                (j0.saturating_sub(DENSE)..(j0 + DENSE).min(segs))
                    .map(|j| {
                        let (t, d) = seg_project(p, dense[j], dense[j + 1]);
                        ((j as f64 + t) / DENSE as f64, d)
                    })
                    .min_by(|x, y| x.1.total_cmp(&y.1))
                    .unwrap_or((u, f64::INFINITY))
            })
            .collect();
        let mut err = near.iter().map(|n| n.1).fold(0.0, f64::max);
        if err <= tol {
            // And the other way: no part of the fit strays from the run.
            for (j, &q) in dense.iter().enumerate() {
                let u = j as f64 / DENSE as f64;
                let lo = us.partition_point(|&v| v < u - 1.0).saturating_sub(1);
                let hi = us.partition_point(|&v| v <= u + 1.0).min(us.len() - 1).max(lo + 1);
                err = err.max(poly_dist(q, &r.pts[lo..=hi]));
            }
            if err <= tol {
                return Some(c);
            }
        }
        // Move each sample's parameter to its closest point on the fit.
        for (k, n) in near.iter().enumerate() {
            us[k] = n.0;
        }
        us[0] = 0.0;
        let last = us.len() - 1;
        us[last] = m as f64;
        for k in 1..us.len() {
            us[k] = us[k].max(us[k - 1]);
        }
    }
    None
}

/// Compatible curves for one run of pieces between explicit points: a
/// straight line on both sides, else the shortest spline that fits both
/// within `tol`, else the run split in two (down to single pieces, which
/// are exact).
fn run_curves(xa: &[Piece], xb: &[Piece], tol: f64) -> (Vec<Seg>, Vec<Seg>) {
    let piecewise = || -> (Vec<Seg>, Vec<Seg>) {
        xa.iter()
            .zip(xb)
            .map(|((x, _), (y, _))| {
                let deg = (x.len() - 1).max(y.len() - 1);
                (seg_of(&elevate(x, deg)), seg_of(&elevate(y, deg)))
            })
            .unzip()
    };
    if xa.len() == 1 {
        return piecewise();
    }
    let (ra, rb) = (Run::new(xa), Run::new(xb));
    let (a1, b1) = (ra.pts[ra.pts.len() - 1], rb.pts[rb.pts.len() - 1]);
    if ra.straight(tol) && rb.straight(tol) {
        return (vec![Seg::Line(a1)], vec![Seg::Line(b1)]);
    }
    let segs = |c: &[Pt], end: Pt| -> Vec<Seg> { (0..c.len()).map(|i| Seg::Quad(c[i], if i + 1 == c.len() { end } else { c[i].lerp(c[i + 1], 0.5) })).collect() };
    for m in 1..=xa.len() + 1 {
        if let Some(ca) = fit_run(&ra, m, tol) {
            if let Some(cb) = fit_run(&rb, m, tol) {
                return (segs(&ca, a1), segs(&cb, b1));
            }
        }
    }
    let mid = xa.len() / 2;
    let (mut la, mut lb) = run_curves(&xa[..mid], &xb[..mid], tol);
    let (ra, rb) = run_curves(&xa[mid..], &xb[mid..], tol);
    la.extend(ra);
    lb.extend(rb);
    (la, lb)
}

/// Blend two contours of the same structure point by point with `mix`.
fn lerp_contour(a: &CurveContour, b: &CurveContour, mix: &dyn Fn(Pt, Pt) -> Pt) -> CurveContour {
    CurveContour {
        start: mix(a.start, b.start),
        segs: a
            .segs
            .iter()
            .zip(&b.segs)
            .map(|(x, y)| match (*x, *y) {
                (Seg::Line(p), Seg::Line(q)) => Seg::Line(mix(p, q)),
                (Seg::Quad(a, p), Seg::Quad(b, q)) => Seg::Quad(mix(a, b), mix(p, q)),
                (Seg::Cubic(a, c, p), Seg::Cubic(b, d, q)) => Seg::Cubic(mix(a, b), mix(c, d), mix(p, q)),
                _ => unreachable!("paired segments share their degree"),
            })
            .collect(),
    }
}

/// Curve-to-curve morph between two outlines whose contours could be made
/// point-compatible. Built with [`CurveMorph::new`]; every pair has the same
/// segment structure on both sides.
#[derive(Clone, Debug)]
pub struct CurveMorph {
    pairs: Vec<(CurveContour, CurveContour)>,
}

impl CurveMorph {
    /// `None` when some contour pair can't be made compatible (or comes out
    /// far from the polyline morph); use [`Morph`] then. `fit_tol` is how
    /// far refit runs may stray from either source, so t = 0 and t = 1
    /// reproduce the inputs within it.
    pub fn new(a: &[CurveContour], b: &[CurveContour], samples: usize, fit_tol: f64) -> Option<CurveMorph> {
        let size = {
            let r = Shape::new(a.iter().chain(b).map(|c| c.flatten(f64::INFINITY)).collect()).bbox();
            r.width().max(r.height()).max(1e-9)
        };
        let tol = size * 2e-4;
        let prepare = |cs: &[CurveContour]| -> Vec<Flat> {
            let mut flats: Vec<Flat> = cs.iter().filter(|c| !c.segs.is_empty()).map(|c| flat(c, tol)).filter(|f| f.pts.len() >= 3 && signed_area(&f.pts).abs() > (size * 1e-5).powi(2)).collect();
            let mut s = Shape::new(flats.iter().map(|f| f.pts.clone()).collect());
            normalize_winding(&mut s);
            for (f, c) in flats.iter_mut().zip(&s.contours) {
                if (signed_area(c) > 0.0) != (signed_area(&f.pts) > 0.0) {
                    *f = flat(&f.curve.reversed(), tol);
                }
            }
            flats
        };
        let (fa, fb) = (prepare(a), prepare(b));
        let polys = |fs: &[Flat]| fs.iter().map(|f| f.pts.clone()).collect::<Vec<_>>();
        let mut pairs = Vec::new();
        for p in plan(&polys(&fa), &polys(&fb), samples) {
            let (ca, cb) = pair_curves(&p, p.ia.map(|i| &fa[i]), p.ib.map(|j| &fb[j]), fit_tol)?;
            // A sanity check against the polyline morph of the same pairing:
            // the two correspondences differ in detail, but curves that went
            // wrong (twisted or folded) change the area far more than that.
            let (sa, sb) = p.samples();
            let scale = signed_area(&sa).abs().max(signed_area(&sb).abs());
            for t in [0.25, 0.5, 0.75] {
                let poly: Vec<Pt> = sa.iter().zip(&sb).map(|(&x, &y)| x.lerp(y, t)).collect();
                let curve = lerp_contour(&ca, &cb, &|x, y| x.lerp(y, t)).flatten(tol);
                if (signed_area(&curve) - signed_area(&poly)).abs() > 0.12 * scale + tol * tol {
                    return None;
                }
            }
            pairs.push((ca, cb));
        }
        Some(CurveMorph { pairs })
    }

    /// The outline at `t`. Points that sit within `tol` of a zone on both
    /// sides (`zones` holds each zone's y in the first and second outline)
    /// land exactly on the blended zone.
    pub fn at(&self, t: f64, zones: &[(f64, f64)], tol: f64) -> CurveShape {
        let t = t.clamp(0.0, 1.0);
        let snap = |p: Pt, q: Pt| -> Pt {
            let mut r = p.lerp(q, t);
            if let Some(&(za, zb)) = zones.iter().find(|&&(za, zb)| (p.y - za).abs() <= tol && (q.y - zb).abs() <= tol) {
                r.y = za + (zb - za) * t;
            }
            r
        };
        self.pairs
            .iter()
            .map(|(a, b)| lerp_contour(a, b, &snap))
            .filter(|c| {
                // Unpaired contours collapse to a point at t = 0 or 1.
                let s = c.start;
                c.segs.iter().any(|x| ctrl(s, x).iter().any(|p| p.dist(s) > 1e-9))
            })
            .collect()
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::pt;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Vec<Pt> {
        vec![pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)]
    }

    #[test]
    fn endpoints_reproduce_inputs() {
        let a = Shape::new(vec![rect(0.0, 0.0, 10.0, 10.0)]);
        let mut hole = rect(3.0, 3.0, 4.0, 4.0);
        hole.reverse();
        let b = Shape::new(vec![rect(0.0, 0.0, 20.0, 10.0), hole]);
        let m = Morph::new(&a, &b, 64);
        assert!((m.at(0.0).area() - 100.0).abs() < 1e-6);
        assert!((m.at(1.0).area() - 184.0).abs() < 1e-6);
        let mid = m.at(0.5).area();
        assert!(mid > 100.0 && mid < 184.0, "{mid}");
    }

    #[test]
    fn handles_empty_side() {
        let a = Shape::new(vec![rect(0.0, 0.0, 10.0, 10.0)]);
        let m = Morph::new(&a, &Shape::default(), 32);
        assert!((m.at(0.0).area() - 100.0).abs() < 1e-6);
        assert!(m.at(1.0).area().abs() < 1e-6);
    }
    fn curves(c: &[Pt]) -> CurveContour {
        CurveContour { start: c[0], segs: c[1..].iter().chain([&c[0]]).map(|&p| Seg::Line(p)).collect() }
    }

    /// A TrueType-style circle: `n` off-curve points, every on-curve implied.
    fn tt_circle(cx: f64, cy: f64, r: f64, n: usize) -> CurveContour {
        let k = r / (std::f64::consts::PI / n as f64).cos();
        let off: Vec<Pt> = (0..n).map(|i| {
            let a = std::f64::consts::TAU * (i as f64 + 0.5) / n as f64;
            pt(cx + k * a.cos(), cy + k * a.sin())
        }).collect();
        let mid = |i: usize| off[i % n].lerp(off[(i + 1) % n], 0.5);
        CurveContour { start: mid(n - 1), segs: (0..n).map(|i| Seg::Quad(off[i], mid(i))).collect() }
    }

    fn area_of(cs: &[CurveContour]) -> f64 {
        cs.iter().map(|c| signed_area(&c.flatten(1e-4))).sum::<f64>().abs()
    }

    #[test]
    fn curve_morph_reproduces_inputs_and_shares_structure() {
        let a = vec![tt_circle(0.0, 0.0, 10.0, 8)];
        let b = vec![curves(&rect(-8.0, -8.0, 16.0, 16.0))];
        let m = CurveMorph::new(&a, &b, 128, 0.01).expect("compatible");
        for (x, y) in &m.pairs {
            assert_eq!(x.segs.len(), y.segs.len());
        }
        assert!((area_of(&m.at(0.0, &[], 0.0)) - area_of(&a)).abs() < 0.5, "{}", area_of(&m.at(0.0, &[], 0.0)));
        assert!((area_of(&m.at(1.0, &[], 0.0)) - 256.0).abs() < 0.5, "{}", area_of(&m.at(1.0, &[], 0.0)));
        let mid = area_of(&m.at(0.5, &[], 0.0));
        assert!(mid > 256.0 && mid < area_of(&a), "{mid}");
    }

    #[test]
    fn curve_morph_keeps_implied_points() {
        // Two TrueType circles: the blend stays one chain of off-curve
        // points with every on-curve point implied.
        let a = vec![tt_circle(0.0, 0.0, 10.0, 8)];
        let b = vec![tt_circle(3.0, 1.0, 14.0, 8)];
        let m = CurveMorph::new(&a, &b, 128, 0.01).expect("compatible");
        let out = m.at(0.5, &[], 0.0);
        let f = flat(&out[0], 0.01);
        let explicit = (0..f.curve.segs.len()).filter(|&k| !f.implied(k)).count();
        assert!(f.curve.segs.len() <= 9 && explicit <= 1, "{} segments, {explicit} explicit", f.curve.segs.len());
    }

    #[test]
    fn curve_morph_snaps_zones_and_handles_unpaired_contours() {
        // A sits slightly below its baseline (y = 0, y-down), B slightly above;
        // B has a hole A lacks.
        let a = vec![curves(&rect(0.0, -10.0, 10.0, 10.3))];
        let mut hole = rect(3.0, -7.0, 4.0, 4.0);
        hole.reverse();
        let b = vec![curves(&rect(0.0, -12.0, 12.0, 11.8)), curves(&hole)];
        let m = CurveMorph::new(&a, &b, 64, 0.01).expect("compatible");
        let out = m.at(0.5, &[(0.0, 0.0)], 0.5);
        let bottom = out.iter().flat_map(|c| c.flatten(0.01)).map(|p| p.y).fold(f64::MIN, f64::max);
        assert!(bottom.abs() < 1e-9, "bottom at {bottom}");
        assert_eq!(out.len(), 2);
        assert_eq!(m.at(0.0, &[], 0.0).len(), 1, "the hole grows from a point");
    }
}
