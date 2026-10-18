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

use crate::geom::{centroid, normalize_winding, perimeter, resample, signed_area, Pt, Shape};

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

/// Sample both contours along the warp path at a shared parameter set that
/// contains every original vertex of either contour.
fn sample_along(a: &Prep, b: &Prep, path: &[(f64, f64)], sigma: f64, n: usize) -> (Vec<Pt>, Vec<Pt>) {
    let segs = path.len() - 1;
    // Parameter u in [0, segs]; knot k sits at u = k.
    let invert = |f: f64, pick: fn(&(f64, f64)) -> f64| -> f64 {
        let k = path.partition_point(|p| pick(p) <= f).clamp(1, segs);
        let (f0, f1) = (pick(&path[k - 1]), pick(&path[k]));
        let t = if f1 - f0 > 1e-12 { ((f - f0) / (f1 - f0)).clamp(0.0, 1.0) } else { 0.0 };
        (k - 1) as f64 + t
    };
    let mut us: Vec<f64> = (0..n).map(|k| k as f64 * segs as f64 / n as f64).collect();
    us.extend(a.vertex_fracs().into_iter().map(|f| invert(f, |p| p.0)));
    us.extend(b.vertex_fracs().into_iter().map(|f| invert((f - sigma).rem_euclid(1.0), |p| p.1)));
    us.retain(|u| *u < segs as f64);
    us.sort_by(|p, q| p.total_cmp(q));
    us.dedup_by(|p, q| (*p - *q).abs() < 1e-9);
    let eval = |u: f64| -> (f64, f64) {
        let k = (u.floor() as usize).min(segs - 1);
        let t = u - k as f64;
        let (p, q) = (path[k], path[k + 1]);
        (p.0 + (q.0 - p.0) * t, p.1 + (q.1 - p.1) * t)
    };
    let mut pa = Vec::with_capacity(us.len());
    let mut pb = Vec::with_capacity(us.len());
    for u in us {
        let (fa, fb) = eval(u);
        pa.push(a.at(fa));
        pb.push(b.at(fb + sigma));
    }
    (pa, pb)
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
        let n = samples.clamp(16, 1024);
        let ba = a.bbox();
        let bb = b.bbox();
        let scale = (ba.width().max(ba.height()) + bb.width().max(bb.height())).max(1e-6) * 0.5;
        let mut pairs = Vec::new();
        for solid in [true, false] {
            let pick = |s: &Shape| -> Vec<Prep> {
                s.contours.iter().filter(|c| c.len() >= 3 && (signed_area(c) > 0.0) == solid).map(|c| prep(c, n)).collect()
            };
            let pa = pick(&a);
            let pb = pick(&b);
            for (ia, ib) in assign(&pa, &pb, scale) {
                let (x, y) = match (ia, ib) {
                    (Some(i), Some(j)) => (pa[i].clone(), pb[j].clone()),
                    (Some(i), None) => (pa[i].clone(), degenerate_at(pa[i].c, n)),
                    (None, Some(j)) => (degenerate_at(pb[j].c, n), pb[j].clone()),
                    (None, None) => continue,
                };
                let shift = best_shift(&x, &y);
                let sigma = shift as f64 / n as f64;
                let path = warp_path(&x, &y, shift);
                let (pa, pb) = sample_along(&x, &y, &path, sigma, n);
                pairs.push((pa, pb));
            }
        }
        Morph { pairs }
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
}
