//! Geometry primitives shared by every stage of the pipeline.
//!
//! Conventions used across the engine:
//! * Document space is y-down (like the screen and SVG).
//! * A filled region is a set of closed contours rendered with the nonzero rule.
//! * After [`normalize_winding`], solid contours have a positive signed area and
//!   holes a negative one, so the result renders identically with nonzero or
//!   even-odd fill and can be written straight into a TrueType `glyf` table.

use std::ops::{Add, AddAssign, Div, Mul, Neg, Sub};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

#[inline]
pub const fn pt(x: f64, y: f64) -> Pt {
    Pt { x, y }
}

impl Pt {
    #[inline]
    pub fn dot(self, o: Pt) -> f64 {
        self.x * o.x + self.y * o.y
    }
    #[inline]
    pub fn cross(self, o: Pt) -> f64 {
        self.x * o.y - self.y * o.x
    }
    #[inline]
    pub fn len(self) -> f64 {
        self.x.hypot(self.y)
    }
    #[inline]
    pub fn len2(self) -> f64 {
        self.x * self.x + self.y * self.y
    }
    #[inline]
    pub fn dist(self, o: Pt) -> f64 {
        (self - o).len()
    }
    #[inline]
    pub fn lerp(self, o: Pt, t: f64) -> Pt {
        self + (o - self) * t
    }
    #[inline]
    pub fn normalized(self) -> Pt {
        let l = self.len();
        if l > 1e-12 {
            self / l
        } else {
            Pt::default()
        }
    }
    /// Rotate 90° so that, for a contour with positive area in y-down space,
    /// the perpendicular of the edge direction points outward.
    #[inline]
    pub fn perp(self) -> Pt {
        pt(-self.y, self.x)
    }
    #[inline]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

impl Add for Pt {
    type Output = Pt;
    #[inline]
    fn add(self, o: Pt) -> Pt {
        pt(self.x + o.x, self.y + o.y)
    }
}
impl AddAssign for Pt {
    #[inline]
    fn add_assign(&mut self, o: Pt) {
        self.x += o.x;
        self.y += o.y;
    }
}
impl Sub for Pt {
    type Output = Pt;
    #[inline]
    fn sub(self, o: Pt) -> Pt {
        pt(self.x - o.x, self.y - o.y)
    }
}
impl Mul<f64> for Pt {
    type Output = Pt;
    #[inline]
    fn mul(self, s: f64) -> Pt {
        pt(self.x * s, self.y * s)
    }
}
impl Div<f64> for Pt {
    type Output = Pt;
    #[inline]
    fn div(self, s: f64) -> Pt {
        pt(self.x / s, self.y / s)
    }
}
impl Neg for Pt {
    type Output = Pt;
    #[inline]
    fn neg(self) -> Pt {
        pt(-self.x, -self.y)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Rect {
    pub const EMPTY: Rect = Rect {
        x0: f64::INFINITY,
        y0: f64::INFINITY,
        x1: f64::NEG_INFINITY,
        y1: f64::NEG_INFINITY,
    };
    pub fn is_empty(&self) -> bool {
        !(self.x1 >= self.x0 && self.y1 >= self.y0)
    }
    pub fn add_pt(&mut self, p: Pt) {
        self.x0 = self.x0.min(p.x);
        self.y0 = self.y0.min(p.y);
        self.x1 = self.x1.max(p.x);
        self.y1 = self.y1.max(p.y);
    }
    pub fn union(&self, o: &Rect) -> Rect {
        Rect {
            x0: self.x0.min(o.x0),
            y0: self.y0.min(o.y0),
            x1: self.x1.max(o.x1),
            y1: self.y1.max(o.y1),
        }
    }
    pub fn width(&self) -> f64 {
        if self.is_empty() { 0.0 } else { self.x1 - self.x0 }
    }
    pub fn height(&self) -> f64 {
        if self.is_empty() { 0.0 } else { self.y1 - self.y0 }
    }
    pub fn center(&self) -> Pt {
        pt((self.x0 + self.x1) * 0.5, (self.y0 + self.y1) * 0.5)
    }
}

/// 2D affine transform: `x' = a*x + c*y + e`, `y' = b*x + d*y + f`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine(pub [f64; 6]);

impl Affine {
    pub const IDENTITY: Affine = Affine([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
    pub fn translate(x: f64, y: f64) -> Affine {
        Affine([1.0, 0.0, 0.0, 1.0, x, y])
    }
    pub fn scale(sx: f64, sy: f64) -> Affine {
        Affine([sx, 0.0, 0.0, sy, 0.0, 0.0])
    }
    pub fn rotate(rad: f64) -> Affine {
        let (s, c) = rad.sin_cos();
        Affine([c, s, -s, c, 0.0, 0.0])
    }
    /// Horizontal shear used for slanting; positive leans right in y-down space.
    pub fn skew_x(k: f64) -> Affine {
        Affine([1.0, 0.0, -k, 1.0, 0.0, 0.0])
    }
    /// `self * o`: apply `o` first, then `self`.
    pub fn then(self, o: Affine) -> Affine {
        let [a, b, c, d, e, f] = o.0;
        let [a2, b2, c2, d2, e2, f2] = self.0;
        Affine([
            a2 * a + c2 * b,
            b2 * a + d2 * b,
            a2 * c + c2 * d,
            b2 * c + d2 * d,
            a2 * e + c2 * f + e2,
            b2 * e + d2 * f + f2,
        ])
    }
    #[inline]
    pub fn apply(&self, p: Pt) -> Pt {
        let [a, b, c, d, e, f] = self.0;
        pt(a * p.x + c * p.y + e, b * p.x + d * p.y + f)
    }
    pub fn determinant(&self) -> f64 {
        self.0[0] * self.0[3] - self.0[1] * self.0[2]
    }
}

/// A closed polyline. The closing edge from the last point back to the first is implicit.
pub type Poly = Vec<Pt>;

/// A filled region made of closed polylines (nonzero fill).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Shape {
    pub contours: Vec<Poly>,
}

impl Shape {
    pub fn new(contours: Vec<Poly>) -> Shape {
        Shape { contours }
    }
    pub fn is_empty(&self) -> bool {
        self.contours.iter().all(|c| c.len() < 3)
    }
    pub fn bbox(&self) -> Rect {
        let mut r = Rect::EMPTY;
        for c in &self.contours {
            for &p in c {
                r.add_pt(p);
            }
        }
        r
    }
    pub fn transform(&mut self, m: &Affine) {
        for c in &mut self.contours {
            for p in c.iter_mut() {
                *p = m.apply(*p);
            }
        }
        if m.determinant() < 0.0 {
            for c in &mut self.contours {
                c.reverse();
            }
        }
    }
    pub fn transformed(mut self, m: &Affine) -> Shape {
        self.transform(m);
        self
    }
    pub fn extend(&mut self, o: Shape) {
        self.contours.extend(o.contours);
    }
    pub fn point_count(&self) -> usize {
        self.contours.iter().map(|c| c.len()).sum()
    }
    /// Net filled area (solids minus holes once normalized).
    pub fn area(&self) -> f64 {
        self.contours.iter().map(|c| signed_area(c)).sum()
    }
    /// Remove degenerate contours, duplicate points and non-finite values.
    pub fn cleaned(mut self, min_area: f64) -> Shape {
        for c in &mut self.contours {
            c.retain(|p| p.is_finite());
            c.dedup_by(|a, b| a.dist(*b) < 1e-9);
            while c.len() > 1 && c[0].dist(c[c.len() - 1]) < 1e-9 {
                c.pop();
            }
        }
        self.contours
            .retain(|c| c.len() >= 3 && signed_area(c).abs() > min_area);
        self
    }
}

/// Shoelace signed area. Positive for visually clockwise loops in y-down space.
pub fn signed_area(c: &[Pt]) -> f64 {
    let n = c.len();
    if n < 3 {
        return 0.0;
    }
    let mut s = 0.0;
    let mut prev = c[n - 1];
    for &p in c {
        s += prev.x * p.y - p.x * prev.y;
        prev = p;
    }
    s * 0.5
}

pub fn perimeter(c: &[Pt]) -> f64 {
    let n = c.len();
    if n < 2 {
        return 0.0;
    }
    let mut s = 0.0;
    let mut prev = c[n - 1];
    for &p in c {
        s += prev.dist(p);
        prev = p;
    }
    s
}

/// Area centroid, falling back to the vertex mean for degenerate loops.
pub fn centroid(c: &[Pt]) -> Pt {
    let n = c.len();
    if n == 0 {
        return Pt::default();
    }
    let a = signed_area(c);
    if a.abs() < 1e-12 {
        let s = c.iter().fold(Pt::default(), |acc, &p| acc + p);
        return s / n as f64;
    }
    let mut cx = 0.0;
    let mut cy = 0.0;
    let mut prev = c[n - 1];
    for &p in c {
        let k = prev.x * p.y - p.x * prev.y;
        cx += (prev.x + p.x) * k;
        cy += (prev.y + p.y) * k;
        prev = p;
    }
    pt(cx / (6.0 * a), cy / (6.0 * a))
}

/// Winding number of `c` around `p` (nonzero rule: inside when != 0).
pub fn winding(c: &[Pt], p: Pt) -> i32 {
    let n = c.len();
    if n < 3 {
        return 0;
    }
    let mut w = 0;
    let mut a = c[n - 1];
    for &b in c {
        if a.y <= p.y {
            if b.y > p.y && (b - a).cross(p - a) > 0.0 {
                w += 1;
            }
        } else if b.y <= p.y && (b - a).cross(p - a) < 0.0 {
            w -= 1;
        }
        a = b;
    }
    w
}

pub fn shape_winding(s: &Shape, p: Pt) -> i32 {
    s.contours.iter().map(|c| winding(c, p)).sum()
}

/// A point strictly inside contour `c` (used for containment tests): the
/// midpoint of the longest horizontal span through the contour's vertical middle.
pub fn interior_point(c: &[Pt]) -> Pt {
    let mut r = Rect::EMPTY;
    for &p in c {
        r.add_pt(p);
    }
    // Try a few scanlines; the vertical middle works for nearly every glyph contour.
    for frac in [0.5, 0.37, 0.63, 0.25, 0.75] {
        let y = r.y0 + (r.y1 - r.y0) * frac + 1e-7;
        let mut xs: Vec<f64> = Vec::new();
        let n = c.len();
        for i in 0..n {
            let a = c[i];
            let b = c[(i + 1) % n];
            if (a.y <= y) != (b.y <= y) {
                xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
            }
        }
        xs.sort_by(|a, b| a.total_cmp(b));
        let mut best: Option<(f64, f64)> = None;
        for pair in xs.chunks(2) {
            if let [x0, x1] = pair {
                if best.map_or(true, |(bx0, bx1)| x1 - x0 > bx1 - bx0) {
                    best = Some((*x0, *x1));
                }
            }
        }
        if let Some((x0, x1)) = best {
            if x1 - x0 > 1e-9 {
                return pt((x0 + x1) * 0.5, y);
            }
        }
    }
    centroid(c)
}

/// Orient contours so solids are positive and holes negative, using nesting
/// depth (even depth = solid). Works regardless of the source font's convention.
pub fn normalize_winding(s: &mut Shape) {
    let n = s.contours.len();
    if n == 0 {
        return;
    }
    let probes: Vec<Pt> = s.contours.iter().map(|c| interior_point(c)).collect();
    let areas: Vec<f64> = s.contours.iter().map(|c| signed_area(c)).collect();
    for i in 0..n {
        let mut depth = 0;
        for j in 0..n {
            if i != j
                && areas[j].abs() > areas[i].abs()
                && winding(&s.contours[j], probes[i]) != 0
            {
                depth += 1;
            }
        }
        let want_positive = depth % 2 == 0;
        if (areas[i] > 0.0) != want_positive {
            s.contours[i].reverse();
        }
    }
}

/// Resample a closed contour into `n` points evenly spaced by arc length.
pub fn resample(c: &[Pt], n: usize) -> Vec<Pt> {
    let m = c.len();
    if m == 0 || n == 0 {
        return Vec::new();
    }
    let total = perimeter(c);
    if total < 1e-12 {
        return vec![c[0]; n];
    }
    let step = total / n as f64;
    let mut out = Vec::with_capacity(n);
    let mut seg = 0usize;
    let mut seg_start = 0.0;
    let mut seg_len = c[0].dist(c[1 % m]);
    for k in 0..n {
        let target = k as f64 * step;
        while seg_start + seg_len < target && seg < m - 1 {
            seg_start += seg_len;
            seg += 1;
            seg_len = c[seg].dist(c[(seg + 1) % m]);
        }
        let t = if seg_len > 1e-12 { ((target - seg_start) / seg_len).clamp(0.0, 1.0) } else { 0.0 };
        out.push(c[seg].lerp(c[(seg + 1) % m], t));
    }
    out
}

/// Resample to exactly `n` points, keeping every original vertex when the
/// contour has at most `n` of them (so sharp corners survive morphing);
/// the extra points are spread over edges in proportion to their length.
pub fn resample_keep(c: &[Pt], n: usize) -> Vec<Pt> {
    let m = c.len();
    if m == 0 || m > n {
        return resample(c, n);
    }
    let lens: Vec<f64> = (0..m).map(|i| c[i].dist(c[(i + 1) % m])).collect();
    let total: f64 = lens.iter().sum();
    if total < 1e-12 {
        return vec![c[0]; n];
    }
    let extra = n - m;
    let exact: Vec<f64> = lens.iter().map(|l| l / total * extra as f64).collect();
    let mut counts: Vec<usize> = exact.iter().map(|x| x.floor() as usize).collect();
    let mut left = extra - counts.iter().sum::<usize>();
    let mut order: Vec<usize> = (0..m).collect();
    order.sort_by(|&a, &b| (exact[b] - exact[b].floor()).total_cmp(&(exact[a] - exact[a].floor())));
    for &i in order.iter().cycle().take(m * 2) {
        if left == 0 {
            break;
        }
        counts[i] += 1;
        left -= 1;
    }
    let mut out = Vec::with_capacity(n);
    for i in 0..m {
        let (a, b) = (c[i], c[(i + 1) % m]);
        out.push(a);
        let k = counts[i];
        for j in 1..=k {
            out.push(a.lerp(b, j as f64 / (k + 1) as f64));
        }
    }
    out
}

/// Densify so no edge is longer than `max_len` (keeps original vertices).
pub fn densify(c: &[Pt], max_len: f64) -> Vec<Pt> {
    let n = c.len();
    let mut out = Vec::with_capacity(n * 2);
    for i in 0..n {
        let a = c[i];
        let b = c[(i + 1) % n];
        out.push(a);
        let d = a.dist(b);
        if d > max_len {
            let k = (d / max_len).ceil() as usize;
            for j in 1..k {
                out.push(a.lerp(b, j as f64 / k as f64));
            }
        }
    }
    out
}

fn perp_dist(p: Pt, a: Pt, b: Pt) -> f64 {
    let ab = b - a;
    let l2 = ab.len2();
    if l2 < 1e-18 {
        return p.dist(a);
    }
    let t = ((p - a).dot(ab) / l2).clamp(0.0, 1.0);
    p.dist(a + ab * t)
}

fn rdp_open(pts: &[Pt], eps: f64, out: &mut Vec<Pt>) {
    // Iterative Ramer–Douglas–Peucker; pushes all kept points except the last.
    let n = pts.len();
    if n < 2 {
        out.extend_from_slice(pts);
        return;
    }
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;
    let mut stack = vec![(0usize, n - 1)];
    while let Some((s, e)) = stack.pop() {
        if e <= s + 1 {
            continue;
        }
        let mut best = 0.0;
        let mut idx = s;
        for i in s + 1..e {
            let d = perp_dist(pts[i], pts[s], pts[e]);
            if d > best {
                best = d;
                idx = i;
            }
        }
        if best > eps {
            keep[idx] = true;
            stack.push((s, idx));
            stack.push((idx, e));
        }
    }
    for i in 0..n - 1 {
        if keep[i] {
            out.push(pts[i]);
        }
    }
}

/// Simplify a closed contour with Ramer–Douglas–Peucker.
pub fn simplify_closed(c: &[Pt], eps: f64) -> Vec<Pt> {
    let n = c.len();
    if n < 4 || eps <= 0.0 {
        return c.to_vec();
    }
    // Split at the vertex farthest from vertex 0 so both halves are well-posed.
    let far = (1..n)
        .max_by(|&i, &j| c[i].dist(c[0]).total_cmp(&c[j].dist(c[0])))
        .unwrap_or(n / 2);
    let mut out = Vec::new();
    rdp_open(&c[0..=far], eps, &mut out);
    let mut second: Vec<Pt> = c[far..].to_vec();
    second.push(c[0]);
    rdp_open(&second, eps, &mut out);
    if out.len() < 3 {
        return c.to_vec();
    }
    out
}

/// Chaikin corner cutting on a closed polyline, `iters` rounds.
pub fn chaikin_closed(c: &[Pt], iters: usize) -> Vec<Pt> {
    let mut cur = c.to_vec();
    for _ in 0..iters {
        let n = cur.len();
        if n < 3 {
            break;
        }
        let mut next = Vec::with_capacity(n * 2);
        for i in 0..n {
            let a = cur[i];
            let b = cur[(i + 1) % n];
            next.push(a.lerp(b, 0.25));
            next.push(a.lerp(b, 0.75));
        }
        cur = next;
    }
    cur
}

/// Curve segment used for exact outlines (font glyphs, symbols) before flattening.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Seg {
    Line(Pt),
    Quad(Pt, Pt),
    Cubic(Pt, Pt, Pt),
}

/// A closed contour made of curve segments starting at `start`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CurveContour {
    pub start: Pt,
    pub segs: Vec<Seg>,
}

pub type CurveShape = Vec<CurveContour>;

impl CurveContour {
    pub fn transform(&mut self, m: &Affine) {
        self.start = m.apply(self.start);
        for s in &mut self.segs {
            *s = match *s {
                Seg::Line(p) => Seg::Line(m.apply(p)),
                Seg::Quad(a, p) => Seg::Quad(m.apply(a), m.apply(p)),
                Seg::Cubic(a, b, p) => Seg::Cubic(m.apply(a), m.apply(b), m.apply(p)),
            };
        }
    }

    /// Flatten to a polyline with maximum deviation roughly `tol`.
    pub fn flatten(&self, tol: f64) -> Poly {
        let mut out = vec![self.start];
        let mut cur = self.start;
        let tol = tol.max(1e-6);
        for s in &self.segs {
            match *s {
                Seg::Line(p) => out.push(p),
                Seg::Quad(a, p) => {
                    let dd = (cur - a * 2.0 + p).len();
                    let n = ((dd / (8.0 * tol)).sqrt().ceil() as usize).clamp(1, 256);
                    for i in 1..=n {
                        let t = i as f64 / n as f64;
                        let mt = 1.0 - t;
                        out.push(cur * (mt * mt) + a * (2.0 * mt * t) + p * (t * t));
                    }
                }
                Seg::Cubic(a, b, p) => {
                    let dd = (cur - a * 2.0 + b).len().max((a - b * 2.0 + p).len());
                    let n = ((3.0 * dd / (4.0 * tol)).sqrt().ceil() as usize).clamp(1, 256);
                    for i in 1..=n {
                        let t = i as f64 / n as f64;
                        let mt = 1.0 - t;
                        out.push(
                            cur * (mt * mt * mt)
                                + a * (3.0 * mt * mt * t)
                                + b * (3.0 * mt * t * t)
                                + p * (t * t * t),
                        );
                    }
                }
            }
            cur = match *s {
                Seg::Line(p) | Seg::Quad(_, p) | Seg::Cubic(_, _, p) => p,
            };
        }
        if out.len() > 1 && out[0].dist(out[out.len() - 1]) < 1e-9 {
            out.pop();
        }
        out
    }

    pub fn reversed(&self) -> CurveContour {
        let mut pts = vec![self.start];
        for s in &self.segs {
            pts.push(match *s {
                Seg::Line(p) | Seg::Quad(_, p) | Seg::Cubic(_, _, p) => p,
            });
        }
        let n = self.segs.len();
        let mut segs = Vec::with_capacity(n);
        for i in (0..n).rev() {
            let from = pts[i];
            segs.push(match self.segs[i] {
                Seg::Line(_) => Seg::Line(from),
                Seg::Quad(a, _) => Seg::Quad(a, from),
                Seg::Cubic(a, b, _) => Seg::Cubic(b, a, from),
            });
        }
        CurveContour { start: pts[n], segs }
    }
}

pub fn flatten_curves(cs: &[CurveContour], tol: f64) -> Shape {
    Shape::new(cs.iter().map(|c| c.flatten(tol)).collect())
}

/// Polylines as straight-segment curve contours (used when no exact curves exist).
pub fn poly_to_curves(s: &Shape) -> CurveShape {
    s.contours
        .iter()
        .filter(|c| c.len() >= 3)
        .map(|c| CurveContour { start: c[0], segs: c[1..].iter().map(|&p| Seg::Line(p)).chain([Seg::Line(c[0])]).collect() })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x: f64, y: f64, s: f64) -> Poly {
        vec![pt(x, y), pt(x + s, y), pt(x + s, y + s), pt(x, y + s)]
    }

    #[test]
    fn area_sign_matches_convention() {
        // Visually clockwise in y-down space: right along top, down the right side.
        assert!((signed_area(&square(0.0, 0.0, 2.0)) - 4.0).abs() < 1e-12);
    }

    #[test]
    fn normalize_makes_holes_negative() {
        let mut outer = square(0.0, 0.0, 10.0);
        outer.reverse();
        let hole = square(3.0, 3.0, 4.0);
        let mut s = Shape::new(vec![outer, hole]);
        normalize_winding(&mut s);
        assert!(signed_area(&s.contours[0]) > 0.0);
        assert!(signed_area(&s.contours[1]) < 0.0);
        assert!((s.area() - 84.0).abs() < 1e-9);
        assert_eq!(shape_winding(&s, pt(5.0, 5.0)), 0);
        assert_ne!(shape_winding(&s, pt(1.0, 1.0)), 0);
    }

    #[test]
    fn resample_is_even() {
        let r = resample(&square(0.0, 0.0, 4.0), 16);
        assert_eq!(r.len(), 16);
        for i in 0..16 {
            assert!((r[i].dist(r[(i + 1) % 16]) - 1.0).abs() < 1e-9);
        }
    }

    #[test]
    fn simplify_keeps_corners() {
        let dense = densify(&square(0.0, 0.0, 10.0), 0.5);
        let s = simplify_closed(&dense, 0.01);
        assert_eq!(s.len(), 4);
    }

    #[test]
    fn curve_reverse_roundtrip() {
        let c = CurveContour {
            start: pt(0.0, 0.0),
            segs: vec![Seg::Cubic(pt(1.0, 0.0), pt(2.0, 1.0), pt(2.0, 2.0)), Seg::Line(pt(0.0, 2.0)), Seg::Line(pt(0.0, 0.0))],
        };
        assert_eq!(c.reversed().reversed(), c);
        let a = signed_area(&c.flatten(0.01));
        let b = signed_area(&c.reversed().flatten(0.01));
        assert!((a + b).abs() < 1e-6);
    }
}
