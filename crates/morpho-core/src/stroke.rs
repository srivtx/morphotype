//! Freehand brush strokes. A stroke is a polyline with a radius per point
//! (pressure and tapered ends); its outline is the zero level of the
//! distance to that "swept circle", so self-crossing scribbles, sharp turns
//! and loops always give a clean, overlapping-safe fill with round ends.

use crate::field::{extract, Grid};
use crate::geom::{pt, Pt, Rect, Shape};
use serde::{Deserialize, Serialize};

/// Chaikin corner cutting: rounds the jitter of hand-drawn input.
fn chaikin(p: &[(Pt, f64)], rounds: usize) -> Vec<(Pt, f64)> {
    let mut cur = p.to_vec();
    for _ in 0..rounds {
        if cur.len() < 3 {
            break;
        }
        let mut next = Vec::with_capacity(cur.len() * 2);
        next.push(cur[0]);
        for w in cur.windows(2) {
            let ((a, ra), (b, rb)) = (w[0], w[1]);
            next.push((a + (b - a) * 0.25, ra * 0.75 + rb * 0.25));
            next.push((a + (b - a) * 0.75, ra * 0.25 + rb * 0.75));
        }
        next.push(*cur.last().unwrap());
        cur = next;
    }
    cur
}

/// Outline of a stroke through `points` (`[x, y, pressure]`, pressure 0..1;
/// 0 means "no pressure data" and counts as full). `width` is the full
/// width, `taper` the fraction of the length that thins at each end, and
/// `smooth` 0..1 how much hand jitter to remove.
pub fn outline(points: &[[f64; 3]], width: f64, taper: f64, smooth: f64, cell_hint: f64) -> Shape {
    let r0 = (width.abs() * 0.5).max(0.05);
    let mut pts: Vec<(Pt, f64)> = Vec::with_capacity(points.len());
    for p in points {
        let q = pt(p[0], p[1]);
        if pts.last().is_some_and(|(l, _): &(Pt, f64)| l.dist(q) < 1e-6) {
            continue;
        }
        let pr = if p[2] > 0.0 { p[2].clamp(0.05, 1.0) } else { 1.0 };
        pts.push((q, pr));
    }
    if pts.is_empty() {
        return Shape::default();
    }
    // Field spacing: fine enough for the thinnest part, within the sample budget.
    let cell = (r0 / 3.0).min(cell_hint.max(r0 / 12.0)).max(1e-3);
    // Smooth, then resample to about the field spacing: denser points cost
    // stamping time but can't add detail the field can resolve.
    let smoothed = chaikin(&pts, (smooth.clamp(0.0, 1.0) * 4.0).round() as usize);
    let mut pts: Vec<(Pt, f64)> = Vec::with_capacity(smoothed.len());
    for (k, &(p, pr)) in smoothed.iter().enumerate() {
        if k + 1 == smoothed.len() || pts.last().is_none_or(|(l, _)| l.dist(p) >= cell * 0.8) {
            pts.push((p, pr));
        }
    }
    // Radius per point from pressure and the taper at both ends.
    let mut len = vec![0.0];
    for w in pts.windows(2) {
        len.push(len.last().unwrap() + w[0].0.dist(w[1].0));
    }
    let total = *len.last().unwrap();
    let t = taper.clamp(0.0, 0.5);
    let radius: Vec<f64> = pts
        .iter()
        .zip(&len)
        .map(|((_, pr), &s)| {
            let f = if t > 1e-4 && total > 0.0 {
                let e = (s / total).min(1.0 - s / total) / t;
                let e = e.clamp(0.0, 1.0);
                0.12 + 0.88 * e * e * (3.0 - 2.0 * e)
            } else {
                1.0
            };
            r0 * pr * f
        })
        .collect();
    let rmax = radius.iter().cloned().fold(0.0, f64::max);
    let mut bbox = Rect::EMPTY;
    for (p, _) in &pts {
        bbox = bbox.union(&Rect { x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
    let pad = rmax + 3.0 * cell;
    let g = Grid::covering(bbox, pad, cell);
    let far = (pad * 2.0) as f32;
    let mut v = vec![far; g.len()];
    let stamp = |v: &mut [f32], a: Pt, ra: f64, b: Pt, rb: f64| {
        let reach = ra.max(rb) + 2.0 * g.cell;
        let (x0, x1) = (a.x.min(b.x) - reach, a.x.max(b.x) + reach);
        let (y0, y1) = (a.y.min(b.y) - reach, a.y.max(b.y) + reach);
        let i0 = (((x0 - g.origin.x) / g.cell).floor().max(0.0)) as usize;
        let j0 = (((y0 - g.origin.y) / g.cell).floor().max(0.0)) as usize;
        let i1 = (((x1 - g.origin.x) / g.cell).ceil() as usize).min(g.w);
        let j1 = (((y1 - g.origin.y) / g.cell).ceil() as usize).min(g.h);
        let ab = b - a;
        let l2 = ab.dot(ab);
        for j in j0..j1 {
            for i in i0..i1 {
                let p = g.sample_pos(i, j);
                let u = if l2 > 1e-12 { ((p - a).dot(ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
                let r = ra + (rb - ra) * u;
                let k = j * g.w + i;
                // Compare squared distances first; most samples can't improve.
                let lim = v[k] as f64 + r;
                if lim <= 0.0 {
                    continue;
                }
                let q = p - (a + ab * u);
                let d2 = q.dot(q);
                if d2 < lim * lim {
                    v[k] = (d2.sqrt() - r) as f32;
                }
            }
        }
    };
    if pts.len() == 1 {
        stamp(&mut v, pts[0].0, radius[0], pts[0].0, radius[0]);
    }
    for k in 1..pts.len() {
        stamp(&mut v, pts[k - 1].0, radius[k - 1], pts[k].0, radius[k]);
    }
    extract(&v, &g, 0.0, g.cell * 0.15, g.cell * g.cell * 0.5)
}

/// How an open line ends.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineCap {
    #[default]
    Round,
    /// Cut square at the end point.
    Butt,
    /// Square, reaching half the width past the end point.
    Square,
}

/// Outline of constant-width lines with round caps and joins (`closed` lines
/// loop back to their start). Overlaps merge cleanly, so globes, asterisks
/// and line icons built from many strokes come out as one solid.
pub fn polylines(lines: &[(Vec<Pt>, bool)], width: f64, cell: f64) -> Shape {
    polylines_capped(lines, width, cell, LineCap::Round)
}

/// [`polylines`] with a choice of caps for open lines (joins stay round).
pub fn polylines_capped(lines: &[(Vec<Pt>, bool)], width: f64, cell: f64, cap: LineCap) -> Shape {
    let r = (width.abs() * 0.5).max(1e-4);
    // Square caps are butt caps on lines lengthened by half the width.
    let extended: Vec<(Vec<Pt>, bool)>;
    let lines = if cap == LineCap::Square {
        extended = lines
            .iter()
            .map(|(l, closed)| {
                let mut l = l.clone();
                if !closed && l.len() >= 2 {
                    let n = l.len();
                    let d0 = (l[0] - l[1]).normalized();
                    let d1 = (l[n - 1] - l[n - 2]).normalized();
                    l[0] = l[0] + d0 * r;
                    l[n - 1] = l[n - 1] + d1 * r;
                }
                (l, *closed)
            })
            .collect();
        &extended[..]
    } else {
        lines
    };
    let butt = cap != LineCap::Round;
    let mut bbox = Rect::EMPTY;
    for (l, _) in lines {
        for p in l {
            bbox = bbox.union(&Rect { x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }
    }
    if bbox.is_empty() {
        return Shape::default();
    }
    let cell = cell.min(r / 2.5).max(1e-4);
    let pad = r + 3.0 * cell;
    let g = Grid::covering(bbox, pad, cell);
    let mut v = vec![(pad * 2.0) as f32; g.len()];
    // `cut_a` / `cut_b`: nothing past that end of the segment (butt caps).
    let mut seg = |a: Pt, b: Pt, cut_a: bool, cut_b: bool| {
        let reach = r + 2.0 * g.cell;
        let i0 = (((a.x.min(b.x) - reach - g.origin.x) / g.cell).floor().max(0.0)) as usize;
        let j0 = (((a.y.min(b.y) - reach - g.origin.y) / g.cell).floor().max(0.0)) as usize;
        let i1 = (((a.x.max(b.x) + reach - g.origin.x) / g.cell).ceil() as usize).min(g.w);
        let j1 = (((a.y.max(b.y) + reach - g.origin.y) / g.cell).ceil() as usize).min(g.h);
        let ab = b - a;
        let l2 = ab.dot(ab);
        for j in j0..j1 {
            for i in i0..i1 {
                let p = g.sample_pos(i, j);
                let raw = if l2 > 1e-12 { (p - a).dot(ab) / l2 } else { 0.0 };
                let k = j * g.w + i;
                if (cut_a && raw < 0.0) || (cut_b && raw > 1.0) {
                    // Past a flat end: exact distance to the end of a rectangle, so the
                    // cut edge stays straight (skipping these cells left it ragged).
                    let len = l2.sqrt().max(1e-12);
                    let past = if raw < 0.0 { -raw * len } else { (raw - 1.0) * len };
                    let side = ((p - a).cross(ab) / len).abs() - r;
                    let d = if side > 0.0 && past > 0.0 { (side * side + past * past).sqrt() } else { side.max(past) };
                    if (d as f32) < v[k] {
                        v[k] = d as f32;
                    }
                    continue;
                }
                let u = raw.clamp(0.0, 1.0);
                let q = p - (a + ab * u);
                let lim = v[k] as f64 + r;
                let d2 = q.dot(q);
                if lim > 0.0 && d2 < lim * lim {
                    v[k] = (d2.sqrt() - r) as f32;
                }
            }
        }
    };
    for (l, closed) in lines {
        match l.len() {
            0 => {}
            1 => seg(l[0], l[0], false, false),
            _ => {
                // A flat end is cut across its own segment only; if that segment is
                // shorter than the radius, the round join after it would bulge past
                // the end. Merge such tiny end segments (flattened curves have many).
                let mut l = l.clone();
                if butt && !closed {
                    while l.len() > 2 && l[0].dist(l[1]) < r {
                        l.remove(1);
                    }
                    while l.len() > 2 && l[l.len() - 1].dist(l[l.len() - 2]) < r {
                        l.remove(l.len() - 2);
                    }
                }
                let n = l.len();
                for (k, w) in l.windows(2).enumerate() {
                    let open = butt && !closed;
                    seg(w[0], w[1], open && k == 0, open && k == n - 2);
                }
                if *closed {
                    seg(l[n - 1], l[0], false, false);
                }
            }
        }
    }
    extract(&v, &g, 0.0, g.cell * 0.15, g.cell * g.cell * 0.5)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn straight_stroke_is_a_capsule() {
        let s = outline(&[[0.0, 0.0, 0.0], [100.0, 0.0, 0.0]], 20.0, 0.0, 0.0, 1.0);
        assert_eq!(s.contours.len(), 1);
        let expect = 100.0 * 20.0 + std::f64::consts::PI * 100.0;
        assert!((s.area() - expect).abs() / expect < 0.02, "{}", s.area());
    }

    #[test]
    fn scribble_crossing_itself_stays_filled() {
        // A figure-eight: the crossing must not punch a hole.
        let pts: Vec<[f64; 3]> = (0..=200)
            .map(|k| {
                let a = k as f64 / 200.0 * std::f64::consts::TAU;
                [100.0 * a.sin(), 50.0 * (2.0 * a).sin(), 0.0]
            })
            .collect();
        let s = outline(&pts, 12.0, 0.0, 0.0, 1.0);
        let b = s.bbox();
        assert!(b.width() > 200.0 && b.height() > 90.0);
        // The centre point (on the crossing) is inside.
        assert!(s.contours.iter().map(|c| crate::geom::winding(c, pt(0.0, 0.0))).sum::<i32>() != 0);
    }

    #[test]
    fn crossing_lines_merge() {
        // A plus from two bars: one contour, area of two bars minus the overlap.
        let s = polylines(&[(vec![pt(-50.0, 0.0), pt(50.0, 0.0)], false), (vec![pt(0.0, -50.0), pt(0.0, 50.0)], false)], 10.0, 0.5);
        assert_eq!(s.contours.len(), 1);
        let caps = std::f64::consts::PI * 25.0;
        let expect = 2.0 * (100.0 * 10.0 + caps) - 100.0;
        assert!((s.area() - expect).abs() / expect < 0.03, "{} vs {expect}", s.area());
    }

    #[test]
    fn caps_change_the_line_length() {
        let line = [(vec![pt(0.0, 0.0), pt(100.0, 0.0)], false)];
        let w = |cap| polylines_capped(&line, 20.0, 0.25, cap).bbox().width();
        assert!((w(LineCap::Butt) - 100.0).abs() < 1.0, "{}", w(LineCap::Butt));
        assert!((w(LineCap::Square) - 120.0).abs() < 1.0);
        assert!((w(LineCap::Round) - 120.0).abs() < 1.0);
        let a = |cap| polylines_capped(&line, 20.0, 0.25, cap).area();
        assert!(a(LineCap::Round) < a(LineCap::Square) && a(LineCap::Butt) < a(LineCap::Round));
    }

    #[test]
    fn taper_thins_the_ends() {
        let flat = outline(&[[0.0, 0.0, 0.0], [200.0, 0.0, 0.0]], 20.0, 0.0, 0.0, 1.0).area();
        let tapered = outline(&[[0.0, 0.0, 0.0], [100.0, 0.0, 0.0], [200.0, 0.0, 0.0]], 20.0, 0.4, 0.0, 1.0).area();
        assert!(tapered < flat * 0.85, "{tapered} vs {flat}");
    }
}
