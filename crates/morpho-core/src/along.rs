//! Effects along a pen line, applied to its centre line before it's stroked:
//! zigzags and waves, meanders, coils and scallops ([`Squiggle`]), and dashes
//! or dots ([`Dash`]). Ridges are spaced evenly along the line, by default
//! fitted to each segment between pen points (as print designers expect: an
//! arch drawn as two lines and two quarter arcs gets whole ridges on each).

use crate::geom::{CurveContour, Pt, Seg};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SquiggleKind {
    /// Straight legs between alternating tips; `smooth` rounds it into a wave.
    #[default]
    Zigzag,
    /// Square wave: legs straight across the line, `smooth` rounds the turns.
    Meander,
    /// A coiled cord: loops rolling along the line.
    Loops,
    /// Round bumps on one side, like a stamp or cloud edge.
    Scallop,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Squiggle {
    pub kind: SquiggleKind,
    /// Distance from the line to each tip, in px.
    pub amplitude: f64,
    /// Distance between neighbouring tips along the line, in px.
    pub spacing: f64,
    /// 0 = sharp corners, 1 = fully rounded.
    pub smooth: f64,
    /// Zigzag: radius of each turn in px (fillets that keep the tips where they are).
    pub round: f64,
    /// Coils only: how far each turn rolls back; above 1 the cord loops.
    pub loops: f64,
    /// Fit whole ridges to every segment between pen points.
    pub per_segment: bool,
    /// End with a leg straight across the line instead of at a tip.
    pub flat_ends: bool,
    /// Start on the other side of the line.
    pub flip: bool,
}

impl Default for Squiggle {
    fn default() -> Self {
        Squiggle { kind: SquiggleKind::Zigzag, amplitude: 20.0, spacing: 24.0, smooth: 0.0, round: 0.0, loops: 1.2, per_segment: true, flat_ends: false, flip: false }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Dash {
    /// Length of each dash in px; 0 with round ends draws dots.
    pub dash: f64,
    /// Space between dashes in px.
    pub gap: f64,
    /// Slide the dashes along the line, in px.
    pub offset: f64,
}

impl Default for Dash {
    fn default() -> Self {
        Dash { dash: 16.0, gap: 12.0, offset: 0.0 }
    }
}

/// A flattened line with its arc length and where each pen segment ends.
struct Track {
    pts: Vec<Pt>,
    /// Cumulative length at each point.
    acc: Vec<f64>,
    /// Arc length at the end of each pen segment.
    ends: Vec<f64>,
    closed: bool,
}

impl Track {
    fn new(c: &CurveContour, closed: bool, tol: f64) -> Track {
        let mut pts = vec![c.start];
        let mut ends = Vec::new();
        let mut cur = c.start;
        let mut segs = c.segs.clone();
        let last = segs.last().map(|s| match *s {
            Seg::Line(p) | Seg::Quad(_, p) | Seg::Cubic(_, _, p) => p,
        });
        if closed && last.is_some_and(|p| p.dist(c.start) > 1e-9) {
            segs.push(Seg::Line(c.start));
        }
        let mut acc = vec![0.0];
        for s in segs {
            let one = CurveContour { start: cur, segs: vec![s] };
            for p in one.flatten(tol).into_iter().skip(1) {
                let d = p.dist(*pts.last().unwrap());
                if d > 1e-9 {
                    acc.push(acc.last().unwrap() + d);
                    pts.push(p);
                }
            }
            cur = *pts.last().unwrap();
            ends.push(*acc.last().unwrap());
        }
        ends.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
        Track { pts, acc, ends, closed }
    }

    fn len(&self) -> f64 {
        *self.acc.last().unwrap_or(&0.0)
    }

    fn wrap(&self, s: f64) -> f64 {
        let l = self.len();
        if self.closed && l > 0.0 {
            s.rem_euclid(l)
        } else {
            s.clamp(0.0, l)
        }
    }

    fn at(&self, s: f64) -> Pt {
        let s = self.wrap(s);
        let i = self.acc.partition_point(|&a| a < s).clamp(1, self.pts.len() - 1);
        let (a0, a1) = (self.acc[i - 1], self.acc[i]);
        let t = if a1 > a0 { (s - a0) / (a1 - a0) } else { 0.0 };
        self.pts[i - 1].lerp(self.pts[i], t)
    }

    /// Unit tangent, averaged over `h` either side so corners get the bisector.
    fn tangent(&self, s: f64, h: f64) -> Pt {
        let l = self.len();
        let (a, b) = if self.closed { (s - h, s + h) } else { ((s - h).max(0.0), (s + h).min(l)) };
        let d = self.at(b) - self.at(a);
        if d.len() > 1e-12 {
            d.normalized()
        } else {
            let d = self.pts[self.pts.len().min(2) - 1] - self.pts[0];
            if d.len() > 1e-12 { d.normalized() } else { Pt { x: 1.0, y: 0.0 } }
        }
    }

    /// Stations where tips sit: whole ridges per segment (or per line).
    fn stations(&self, spacing: f64, per_segment: bool) -> Vec<f64> {
        let l = self.len();
        let spacing = spacing.max(l / 4000.0).max(0.25);
        let spans: Vec<(f64, f64)> = if per_segment && self.ends.len() > 1 {
            let mut a = 0.0;
            self.ends.iter().map(|&b| { let r = (a, b); a = b; r }).collect()
        } else {
            vec![(0.0, l)]
        };
        let mut counts: Vec<usize> = spans.iter().map(|(a, b)| (((b - a) / spacing).round() as usize).max(1)).collect();
        // A closed line needs an even number of legs to meet itself on the right side.
        if self.closed && counts.iter().sum::<usize>() % 2 == 1 {
            let k = (0..spans.len()).max_by(|&i, &j| ((spans[i].1 - spans[i].0) / counts[i] as f64).total_cmp(&((spans[j].1 - spans[j].0) / counts[j] as f64))).unwrap();
            counts[k] += 1;
        }
        let mut out = vec![0.0];
        for ((a, b), n) in spans.iter().zip(counts) {
            for i in 1..=n {
                out.push(a + (b - a) * i as f64 / n as f64);
            }
        }
        out
    }
}

/// Round every corner of a polyline: each corner is cut `t`/2 of the way
/// along its legs and replaced by a quadratic through the old corner.
fn round_quad(v: &[Pt], t: f64, closed: bool, out: &mut Vec<Pt>) {
    let n = v.len();
    let corner = |i: usize| -> bool { closed || (i > 0 && i + 1 < n) };
    let h = t.clamp(0.0, 1.0) * 0.5;
    let mut first = true;
    for i in 0..n {
        if !corner(i) {
            out.push(v[i]);
            continue;
        }
        let p = v[(i + n - 1) % n];
        let c = v[i];
        let q = v[(i + 1) % n];
        let a = c.lerp(p, h);
        let b = c.lerp(q, h);
        let steps = 10;
        for k in 0..=steps {
            if k == 0 && !first && out.last().is_some_and(|l| l.dist(a) < 1e-9) {
                continue;
            }
            let u = k as f64 / steps as f64;
            let m = 1.0 - u;
            out.push(a * (m * m) + c * (2.0 * m * u) + b * (u * u));
        }
        first = false;
    }
    if closed {
        if let Some(&f) = out.first() {
            out.push(f);
        }
    }
}

/// Round corners with circular fillets reaching `t`/2 along the shorter leg.
fn round_arc(v: &[Pt], t: f64, closed: bool, out: &mut Vec<Pt>) {
    let n = v.len();
    let h = t.clamp(0.0, 1.0) * 0.5;
    for i in 0..n {
        let inner = closed || (i > 0 && i + 1 < n);
        if !inner || h <= 0.0 {
            out.push(v[i]);
            continue;
        }
        let c = v[i];
        let p = v[(i + n - 1) % n];
        let q = v[(i + 1) % n];
        let (u, w) = (p - c, q - c);
        let (lu, lw) = (u.len(), w.len());
        if lu < 1e-9 || lw < 1e-9 {
            out.push(c);
            continue;
        }
        let (u, w) = (u * (1.0 / lu), w * (1.0 / lw));
        let cos = u.dot(w).clamp(-1.0, 1.0);
        let theta = cos.acos();
        if !(1e-3..=PI - 1e-3).contains(&theta) {
            out.push(c);
            continue;
        }
        let d = h * lu.min(lw);
        let r = d * (theta * 0.5).tan();
        let bis = (u + w).normalized();
        let centre = c + bis * (d / (theta * 0.5).cos());
        let a = c + u * d;
        let b = c + w * d;
        let (a0, a1) = ((a - centre).y.atan2((a - centre).x), (b - centre).y.atan2((b - centre).x));
        let mut da = a1 - a0;
        while da > PI {
            da -= 2.0 * PI;
        }
        while da < -PI {
            da += 2.0 * PI;
        }
        let steps = ((da.abs() / (PI / 24.0)).ceil() as usize).max(2);
        for k in 0..=steps {
            let ang = a0 + da * k as f64 / steps as f64;
            out.push(centre + Pt { x: ang.cos(), y: ang.sin() } * r);
        }
    }
    if closed {
        if let Some(&f) = out.first() {
            out.push(f);
        }
    }
}

/// A path wrapped around circles in turn (signed radius: the sign picks the
/// side it passes on), straight along their tangents between them.
fn belt(c: &[(Pt, f64)], closed: bool) -> Vec<Pt> {
    let n = c.len();
    if n < 2 {
        return c.iter().map(|x| x.0).collect();
    }
    let legs = if closed { n } else { n - 1 };
    // Tangent from circle a to circle b: points a.0 + ra·m and b.0 + rb·m, with m ⟂ the leg.
    let tangent = |a: (Pt, f64), b: (Pt, f64)| -> (Pt, Pt) {
        let d = b.0 - a.0;
        let l = d.len().max(1e-9);
        let dh = d * (1.0 / l);
        let cos = ((a.1 - b.1) / l).clamp(-1.0, 1.0);
        let sin = (1.0 - cos * cos).sqrt();
        let m = dh * cos - dh.perp() * sin;
        (a.0 + m * a.1, b.0 + m * b.1)
    };
    let segs: Vec<(Pt, Pt)> = (0..legs).map(|i| tangent(c[i], c[(i + 1) % n])).collect();
    let mut out = Vec::new();
    let arc = |out: &mut Vec<Pt>, centre: Pt, r: f64, from: Pt, to: Pt| {
        if r.abs() < 1e-9 {
            return;
        }
        let a0 = (from - centre).y.atan2((from - centre).x);
        let a1 = (to - centre).y.atan2((to - centre).x);
        // Positive radius turns one way, negative the other.
        let mut da = a1 - a0;
        if r > 0.0 {
            while da < 0.0 {
                da += 2.0 * PI;
            }
        } else {
            while da > 0.0 {
                da -= 2.0 * PI;
            }
        }
        let steps = ((da.abs() / (PI / 32.0)).ceil() as usize).max(1);
        for k in 1..steps {
            let ang = a0 + da * k as f64 / steps as f64;
            out.push(centre + Pt { x: ang.cos(), y: ang.sin() } * r.abs());
        }
    };
    if !closed {
        out.push(segs[0].0);
    }
    for i in 0..legs {
        let (p, q) = segs[i];
        if closed || i > 0 {
            out.push(p);
        }
        out.push(q);
        let j = (i + 1) % n;
        if closed || j + 1 < n {
            let next = segs[(i + 1) % legs].0;
            arc(&mut out, c[j].0, c[j].1, q, next);
        }
    }
    if closed {
        if let Some(&f) = out.first() {
            out.push(f);
        }
    }
    out
}

/// The centre line of one subpath with the squiggle applied.
pub fn squiggle(c: &CurveContour, closed: bool, sq: &Squiggle, tol: f64) -> Vec<Pt> {
    let tr = Track::new(c, closed, tol);
    let l = tr.len();
    if tr.pts.len() < 2 || l <= 1e-9 || sq.amplitude.abs() < 1e-9 {
        return tr.pts;
    }
    let amp = sq.amplitude;
    let h = (sq.spacing * 0.25).min(l * 0.05).max(1e-3);
    let side0 = if sq.flip { -1.0 } else { 1.0 };
    let normal = |s: f64| tr.tangent(s, h).perp();
    let st = tr.stations(sq.spacing, sq.per_segment);
    match sq.kind {
        SquiggleKind::Zigzag => {
            let t = if sq.round > 0.0 { 0.0 } else { sq.smooth.clamp(0.0, 1.0) };
            // Rounding pulls each tip in; push the corners out to keep the amplitude.
            let a = amp / (1.0 - t * 0.5);
            let sides: Vec<f64> = (0..st.len()).map(|k| side0 * if k % 2 == 0 { 1.0 } else { -1.0 }).collect();
            let mut at: Vec<(Pt, Pt, f64, f64)> = st.iter().zip(&sides).map(|(&s, &sd)| (tr.at(s), normal(s), sd, a)).collect();
            if sq.flat_ends && !tr.closed {
                at.insert(0, (tr.at(0.0), normal(0.0), -side0, a));
                let last = *sides.last().unwrap();
                at.push((tr.at(l), normal(l), -last, a));
            }
            if tr.closed && at.len() > 1 {
                at.pop();
            }
            let place = |at: &[(Pt, Pt, f64, f64)]| -> Vec<Pt> { at.iter().map(|&(p, nn, sd, off)| p + nn * (off * sd)).collect() };
            if sq.round > 0.0 {
                // Round turns as a belt over pulleys: each tip is a circle of radius ρ
                // whose far side touches the amplitude, joined to the next by their
                // crossing tangent. Holds on curves too, where legs fan out or run
                // parallel (fingers on an arch).
                let rho = sq.round.min(amp.abs() * 0.95);
                let n = at.len();
                let fixed_end = |i: usize| !tr.closed && (i == 0 || i + 1 == n);
                let circles: Vec<(Pt, f64)> = at
                    .iter()
                    .enumerate()
                    .map(|(i, &(p, nn, sd, _))| if fixed_end(i) { (p + nn * (amp * sd), 0.0) } else { (p + nn * ((amp - rho) * sd), -rho * sd) })
                    .collect();
                return belt(&circles, tr.closed);
            }
            let v = place(&at);
            if t <= 0.0 {
                let mut v = v;
                if tr.closed {
                    v.push(v[0]);
                }
                return v;
            }
            let mut out = Vec::new();
            round_quad(&v, t, tr.closed, &mut out);
            out
        }
        SquiggleKind::Meander => {
            let mut v = Vec::new();
            for (k, &s) in st.iter().enumerate() {
                let sd = side0 * if k % 2 == 0 { 1.0 } else { -1.0 };
                let (p, nn) = (tr.at(s), normal(s));
                let ends = k == 0 || k + 1 == st.len();
                if ends && !sq.flat_ends && !tr.closed {
                    // Ends sit on the line: half a leg across.
                    if k == 0 {
                        v.push(p);
                        v.push(p + nn * (amp * sd));
                    } else {
                        v.push(p + nn * (-amp * sd));
                        v.push(p);
                    }
                } else {
                    v.push(p + nn * (-amp * sd));
                    v.push(p + nn * (amp * sd));
                }
            }
            if tr.closed {
                v.truncate(v.len().saturating_sub(2));
            }
            let mut out = Vec::new();
            if sq.smooth > 0.0 {
                round_arc(&v, sq.smooth, tr.closed, &mut out);
            } else {
                out = v;
                if tr.closed {
                    out.push(out[0]);
                }
            }
            out
        }
        SquiggleKind::Loops => {
            let wl = sq.spacing.max(0.5) * 2.0;
            let n = ((l / wl).round().max(1.0) * 48.0) as usize;
            let k = 2.0 * PI * (l / wl).round().max(1.0) / l;
            let roll = sq.loops / k;
            let mut v: Vec<Pt> = (0..=n)
                .map(|i| {
                    let s = l * i as f64 / n as f64;
                    let tg = tr.tangent(s, h);
                    let ph = k * s;
                    // A prolate trochoid: past a roll of 1 the cord loops back over itself.
                    tr.at(s) + tg.perp() * (amp * side0 * ph.sin()) + tg * (roll * (ph.cos() - 1.0))
                })
                .collect();
            if tr.closed {
                *v.last_mut().unwrap() = v[0];
            }
            v
        }
        SquiggleKind::Scallop => {
            let mut v = vec![tr.at(0.0)];
            for w in st.windows(2) {
                let (a, b) = (w[0], w[1]);
                let steps = 16;
                for i in 1..=steps {
                    let u = i as f64 / steps as f64;
                    let s = a + (b - a) * u;
                    let bump = (1.0 - (2.0 * u - 1.0).powi(2)).max(0.0).sqrt();
                    v.push(tr.at(s) + normal(s) * (amp * side0 * bump));
                }
            }
            v
        }
    }
}

/// Cut a polyline into dashes; `dash` 0 gives dots (one-point dashes).
pub fn dashes(pts: &[Pt], d: &Dash) -> Vec<Vec<Pt>> {
    let mut acc = vec![0.0];
    for w in pts.windows(2) {
        acc.push(acc.last().unwrap() + w[0].dist(w[1]));
    }
    let l = *acc.last().unwrap_or(&0.0);
    let period = (d.dash.max(0.0) + d.gap.max(0.0)).max(0.5);
    if pts.len() < 2 || l <= 0.0 || (l / period) > 20000.0 {
        return vec![pts.to_vec()];
    }
    let at = |s: f64| -> Pt {
        let i = acc.partition_point(|&a| a < s).clamp(1, pts.len() - 1);
        let (a0, a1) = (acc[i - 1], acc[i]);
        pts[i - 1].lerp(pts[i], if a1 > a0 { (s - a0) / (a1 - a0) } else { 0.0 })
    };
    let mut out = Vec::new();
    let mut s = -d.offset.rem_euclid(period);
    while s < l + 1e-9 {
        let (a, b) = (s.max(0.0), (s + d.dash.max(0.0)).min(l));
        if (b > a || (d.dash <= 0.0 && s >= 0.0)) && b >= a {
            let mut piece = vec![at(a)];
            let i0 = acc.partition_point(|&x| x <= a);
            let i1 = acc.partition_point(|&x| x < b);
            piece.extend_from_slice(&pts[i0..i1.max(i0)]);
            piece.push(at(b));
            if b - a < 1e-6 {
                // A dot: a tiny segment along the line so round caps draw a disc.
                let i = acc.partition_point(|&x| x < a).clamp(1, pts.len() - 1);
                let dir = (pts[i] - pts[i - 1]).normalized();
                piece = vec![at(a), at(a) + dir * 1e-3];
            }
            out.push(piece);
        }
        s += period;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::pt;

    fn line(a: Pt, b: Pt) -> CurveContour {
        CurveContour { start: a, segs: vec![Seg::Line(b)] }
    }

    #[test]
    fn zigzag_tips_alternate_at_amplitude() {
        let c = line(pt(0.0, 0.0), pt(100.0, 0.0));
        let v = squiggle(&c, false, &Squiggle { amplitude: 10.0, spacing: 10.0, ..Squiggle::default() }, 0.1);
        assert_eq!(v.len(), 11);
        for (k, p) in v.iter().enumerate() {
            assert!((p.x - k as f64 * 10.0).abs() < 1e-6);
            assert!((p.y.abs() - 10.0).abs() < 1e-6);
            if k > 0 {
                assert!(p.y * v[k - 1].y < 0.0, "tips alternate sides");
            }
        }
    }

    #[test]
    fn whole_ridges_per_segment() {
        // 100 px then 50 px with spacing 30: 3 ridges then 2 ridges, tips on each corner.
        let c = CurveContour { start: pt(0.0, 0.0), segs: vec![Seg::Line(pt(100.0, 0.0)), Seg::Line(pt(100.0, 50.0))] };
        let tr = Track::new(&c, false, 0.1);
        let st = tr.stations(30.0, true);
        assert_eq!(st.len(), 6);
        assert!((st[3] - 100.0).abs() < 1e-6);
    }

    #[test]
    fn flat_ends_cross_the_line() {
        let c = line(pt(0.0, 0.0), pt(100.0, 0.0));
        let v = squiggle(&c, false, &Squiggle { amplitude: 10.0, spacing: 25.0, flat_ends: true, ..Squiggle::default() }, 0.1);
        let (a, b) = (v[v.len() - 2], v[v.len() - 1]);
        assert!((a.x - b.x).abs() < 1e-6 && (a.y + b.y).abs() < 1e-6);
    }

    #[test]
    fn closed_zigzag_has_even_legs() {
        let c = CurveContour { start: pt(0.0, 0.0), segs: vec![Seg::Line(pt(50.0, 0.0)), Seg::Line(pt(50.0, 50.0)), Seg::Line(pt(0.0, 50.0))] };
        let v = squiggle(&c, true, &Squiggle { amplitude: 4.0, spacing: 23.0, ..Squiggle::default() }, 0.1);
        assert_eq!((v.len() - 1) % 2, 0);
        assert!(v[0].dist(*v.last().unwrap()) < 1e-9);
    }

    #[test]
    fn round_turns_keep_the_tips() {
        let c = line(pt(0.0, 0.0), pt(450.0, 0.0));
        let v = squiggle(&c, false, &Squiggle { amplitude: 100.0, spacing: 45.0, round: 10.0, ..Squiggle::default() }, 0.1);
        let top = v.iter().map(|p| p.y).fold(f64::MIN, f64::max);
        let bottom = v.iter().map(|p| p.y).fold(f64::MAX, f64::min);
        assert!((top - 100.0).abs() < 1.5 && (bottom + 100.0).abs() < 1.5, "{top} {bottom}");
    }

    #[test]
    fn dots_and_dashes() {
        let pts = vec![pt(0.0, 0.0), pt(100.0, 0.0)];
        assert_eq!(dashes(&pts, &Dash { dash: 0.0, gap: 10.0, offset: 0.0 }).len(), 11);
        let d = dashes(&pts, &Dash { dash: 20.0, gap: 5.0, offset: 0.0 });
        assert_eq!(d.len(), 4);
        assert!((d[1][0].x - 25.0).abs() < 1e-9 && (d[1].last().unwrap().x - 45.0).abs() < 1e-9);
    }
}
