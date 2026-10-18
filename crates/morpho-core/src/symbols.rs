//! Parametric symbols for logo building: badges, mascot bodies, cursors…
//! Every symbol fits roughly in a 1×1 box centred on the origin (y-down);
//! the layer's `size` scales it.

use crate::field::{extract, Grid};
use crate::geom::{normalize_winding, pt, Pt, Rect, Shape};
use crate::noise::noise2;
use serde::{Deserialize, Serialize};
use std::f64::consts::{PI, TAU};

fn d<const N: u32>() -> f64 {
    N as f64 / 100.0
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Symbol {
    Circle,
    Ring { #[serde(default = "d::<18>")] thickness: f64 },
    /// Superellipse: `exponent` 2 = circle, 4–5 = app-icon squircle, large = square.
    Squircle { #[serde(default = "d::<500>")] exponent: f64, #[serde(default = "d::<100>")] aspect: f64 },
    RoundRect { #[serde(default = "d::<20>")] radius: f64, #[serde(default = "d::<100>")] aspect: f64 },
    Polygon { #[serde(default = "d::<600>")] sides: f64, #[serde(default)] rounding: f64 },
    Star { #[serde(default = "d::<500>")] points: f64, #[serde(default = "d::<45>")] inner: f64, #[serde(default)] rounding: f64 },
    /// Concave four-point sparkle (✦).
    Sparkle { #[serde(default = "d::<30>")] pinch: f64 },
    /// Ring with rectangular rays, like a sun badge or gear emblem.
    Burst {
        #[serde(default = "d::<1200>")]
        rays: f64,
        #[serde(default = "d::<12>")]
        ring: f64,
        #[serde(default = "d::<10>")]
        ray_width: f64,
        #[serde(default = "d::<26>")]
        inner: f64,
    },
    /// Map-pin teardrop with one sharp corner.
    Pin { #[serde(default = "d::<300>")] corner: f64 },
    /// Mouse cursor arrow.
    Cursor,
    /// Puffy cloud / mascot body.
    Blob { #[serde(default = "d::<800>")] lobes: f64, #[serde(default = "d::<8>")] depth: f64, #[serde(default)] seed: u32, #[serde(default)] wobble: f64 },
    /// Two pill-shaped eyes (use with "cut" to punch them out of a body).
    Eyes { #[serde(default = "d::<34>")] gap: f64, #[serde(default = "d::<14>")] width: f64, #[serde(default = "d::<26>")] height: f64 },
    Heart,
    Plus { #[serde(default = "d::<30>")] thickness: f64 },
    /// Cat-ear head silhouette for mascot icons.
    CatHead { #[serde(default = "d::<30>")] ears: f64 },
    /// Chat bubble with a tail (mascot app icons).
    Bubble { #[serde(default = "d::<30>")] tail: f64, #[serde(default = "d::<260>")] roundness: f64 },
    /// Thick spiral stroke with round ends.
    Spiral { #[serde(default = "d::<250>")] turns: f64, #[serde(default = "d::<55>")] weight: f64 },
    /// Rounded petals with pinched valleys.
    Flower { #[serde(default = "d::<400>")] petals: f64, #[serde(default = "d::<35>")] depth: f64 },
    Arrow { #[serde(default = "d::<45>")] head: f64, #[serde(default = "d::<30>")] shaft: f64 },
    Bolt,
    /// Crescent; `phase` 0 = thin sliver, 1 = nearly full.
    Moon { #[serde(default = "d::<40>")] phase: f64 },
    /// A smiling mouth: a thick arc with round ends. Negative `curve` frowns.
    Smile { #[serde(default = "d::<50>")] curve: f64, #[serde(default = "d::<35>")] weight: f64 },
    /// Quarter disc filling the box; the square corner is bottom-left. Modular logos.
    Quarter,
    /// Half disc, flat side down, in a 2:1 box.
    Half,
    /// Square with a quarter circle taken out of the top-right corner (a concave fillet).
    Cove,
    /// Capsule (fully rounded ends): tags, buttons and labels.
    Pill { #[serde(default = "d::<300>")] aspect: f64 },
    /// File folder with a tab on the top left.
    Folder { #[serde(default = "d::<38>")] tab: f64, #[serde(default = "d::<5>")] corner: f64 },
    /// Spiky starburst with alternating long and short rays.
    Rays {
        #[serde(default = "d::<1200>")]
        rays: f64,
        #[serde(default = "d::<55>")]
        short: f64,
        #[serde(default = "d::<18>")]
        inner: f64,
        #[serde(default)]
        jitter: f64,
        #[serde(default)]
        seed: u32,
    },
    /// Badge with a wavy edge: smooth waves, or scallops like a cookie cutter.
    Wavy {
        #[serde(default = "d::<1800>")]
        waves: f64,
        #[serde(default = "d::<8>")]
        depth: f64,
        /// 0 = sine waves, 1 = round scallops with sharp valleys.
        #[serde(default)]
        scallop: f64,
    },
    /// Pointed oval (vesica): eyes, seeds, leaves, lens flares.
    Lens { #[serde(default = "d::<55>")] aspect: f64 },
    /// Cartoon cloud: round puffs on a flat base.
    Cloud { #[serde(default = "d::<300>")] puffs: f64, #[serde(default)] seed: u32 },
    /// Wireframe globe: outline, meridians and parallels as lines.
    Globe {
        #[serde(default = "d::<200>")]
        meridians: f64,
        #[serde(default = "d::<200>")]
        parallels: f64,
        #[serde(default = "d::<4>")]
        weight: f64,
        /// Width ÷ height; lines keep their weight when stretched.
        #[serde(default = "d::<100>")]
        aspect: f64,
    },
    /// Lines radiating from the centre with round ends (✳, sunbursts).
    Asterisk {
        #[serde(default = "d::<800>")]
        arms: f64,
        #[serde(default = "d::<12>")]
        weight: f64,
        /// Empty middle, as a fraction of the radius.
        #[serde(default)]
        inner: f64,
    },
}

const SEG: usize = 256;

fn ellipse(c: Pt, rx: f64, ry: f64, n: usize) -> Vec<Pt> {
    (0..n)
        .map(|k| {
            let a = k as f64 / n as f64 * TAU;
            pt(c.x + rx * a.cos(), c.y + ry * a.sin())
        })
        .collect()
}

fn reversed(mut v: Vec<Pt>) -> Vec<Pt> {
    v.reverse();
    v
}

/// Polygon with rounded corners: each corner replaced by an arc of radius `r`.
fn rounded_polygon(pts: &[Pt], r: f64) -> Vec<Pt> {
    if r <= 1e-9 {
        return pts.to_vec();
    }
    let n = pts.len();
    let mut out = Vec::new();
    for i in 0..n {
        let prev = pts[(i + n - 1) % n];
        let cur = pts[i];
        let next = pts[(i + 1) % n];
        let u = (prev - cur).normalized();
        let v = (next - cur).normalized();
        let half = u.dot(v).clamp(-1.0, 1.0).acos() * 0.5;
        if half < 1e-3 || (PI * 0.5 - half) < 1e-3 {
            out.push(cur);
            continue;
        }
        let limit = (prev.dist(cur).min(next.dist(cur))) * 0.5;
        let t = (r / half.tan()).min(limit);
        let rr = t * half.tan();
        let p0 = cur + u * t;
        let p1 = cur + v * t;
        let bis = (u + v).normalized();
        let centre = cur + bis * (rr / half.sin());
        let a0 = (p0 - centre).y.atan2((p0 - centre).x);
        let mut a1 = (p1 - centre).y.atan2((p1 - centre).x);
        // Sweep the short way round.
        let mut da = a1 - a0;
        while da > PI {
            da -= TAU;
        }
        while da < -PI {
            da += TAU;
        }
        a1 = a0 + da;
        let steps = ((da.abs() / TAU) * 64.0).ceil().max(2.0) as usize;
        for s in 0..=steps {
            let a = a0 + (a1 - a0) * s as f64 / steps as f64;
            out.push(pt(centre.x + rr * a.cos(), centre.y + rr * a.sin()));
        }
    }
    out
}

fn rect(cx: f64, cy: f64, w: f64, h: f64) -> Vec<Pt> {
    vec![pt(cx - w / 2.0, cy - h / 2.0), pt(cx + w / 2.0, cy - h / 2.0), pt(cx + w / 2.0, cy + h / 2.0), pt(cx - w / 2.0, cy + h / 2.0)]
}

fn rotated(v: &[Pt], a: f64) -> Vec<Pt> {
    let (s, c) = a.sin_cos();
    v.iter().map(|p| pt(p.x * c - p.y * s, p.x * s + p.y * c)).collect()
}

/// Build the symbol in em units.
pub fn build(sym: &Symbol) -> Shape {
    let mut s = match sym {
        Symbol::Circle => Shape::new(vec![ellipse(pt(0.0, 0.0), 0.5, 0.5, SEG)]),
        Symbol::Ring { thickness } => {
            let t = thickness.clamp(0.01, 0.49);
            Shape::new(vec![ellipse(pt(0.0, 0.0), 0.5, 0.5, SEG), reversed(ellipse(pt(0.0, 0.0), 0.5 - t, 0.5 - t, SEG))])
        }
        Symbol::Squircle { exponent, aspect } => {
            let n = exponent.clamp(1.0, 40.0);
            let (rx, ry) = aspect_radii(*aspect);
            let pts = (0..SEG)
                .map(|k| {
                    let a = k as f64 / SEG as f64 * TAU;
                    let (s, c) = a.sin_cos();
                    pt(rx * c.signum() * c.abs().powf(2.0 / n), ry * s.signum() * s.abs().powf(2.0 / n))
                })
                .collect();
            Shape::new(vec![pts])
        }
        Symbol::RoundRect { radius, aspect } => {
            let (rx, ry) = aspect_radii(*aspect);
            let r = radius.clamp(0.0, rx.min(ry));
            Shape::new(vec![rounded_polygon(&rect(0.0, 0.0, rx * 2.0, ry * 2.0), r)])
        }
        Symbol::Polygon { sides, rounding } => {
            let n = (sides.round() as usize).clamp(3, 64);
            let pts: Vec<Pt> = (0..n)
                .map(|k| {
                    let a = -PI / 2.0 + k as f64 / n as f64 * TAU;
                    pt(0.5 * a.cos(), 0.5 * a.sin())
                })
                .collect();
            Shape::new(vec![rounded_polygon(&pts, rounding.clamp(0.0, 0.5) * 0.5)])
        }
        Symbol::Star { points, inner, rounding } => {
            let n = (points.round() as usize).clamp(3, 64);
            let ri = inner.clamp(0.05, 0.98) * 0.5;
            let pts: Vec<Pt> = (0..n * 2)
                .map(|k| {
                    let a = -PI / 2.0 + k as f64 / (2 * n) as f64 * TAU;
                    let r = if k % 2 == 0 { 0.5 } else { ri };
                    pt(r * a.cos(), r * a.sin())
                })
                .collect();
            Shape::new(vec![rounded_polygon(&pts, rounding.clamp(0.0, 0.5) * 0.2)])
        }
        Symbol::Sparkle { pinch } => {
            let p = pinch.clamp(0.0, 0.9);
            let pts = (0..SEG)
                .map(|k| {
                    let a = k as f64 / SEG as f64 * TAU;
                    // Astroid-like curve; `pinch` pulls the sides inward.
                    let e = 3.0 + p * 4.0;
                    let (s, c) = a.sin_cos();
                    pt(0.5 * c.signum() * c.abs().powf(e), 0.5 * s.signum() * s.abs().powf(e))
                })
                .collect();
            Shape::new(vec![pts])
        }
        Symbol::Burst { rays, ring, ray_width, inner } => {
            let n = (rays.round() as usize).clamp(3, 64);
            let ring = ring.clamp(0.02, 0.3);
            let inner_r = inner.clamp(0.05, 0.45);
            let mut cs = vec![ellipse(pt(0.0, 0.0), 0.5, 0.5, SEG), reversed(ellipse(pt(0.0, 0.0), 0.5 - ring, 0.5 - ring, SEG))];
            // Inner ring.
            let ir = inner_r;
            cs.push(ellipse(pt(0.0, 0.0), ir, ir, SEG));
            cs.push(reversed(ellipse(pt(0.0, 0.0), (ir - ring).max(0.01), (ir - ring).max(0.01), SEG)));
            // Rays bridge the inner and outer rings.
            let len = 0.5 - ring * 0.5 - ir + ring * 0.5;
            let mid = ir - ring * 0.5 + len * 0.5;
            for k in 0..n {
                let a = k as f64 / n as f64 * TAU - PI / 2.0;
                let r = rect(mid, 0.0, len, ray_width.clamp(0.01, 0.3));
                cs.push(rotated(&r, a));
            }
            Shape::new(cs)
        }
        Symbol::Pin { corner } => {
            // Three-quarter circle whose bottom-right quadrant is a sharp square corner.
            let r = 0.5;
            let mut pts = Vec::new();
            let steps = 192;
            for k in 0..=steps {
                let a = PI * 0.5 + k as f64 / steps as f64 * PI * 1.5;
                pts.push(pt(r * a.cos(), r * a.sin()));
            }
            let c = corner.clamp(0.0, 0.5) * 0.1;
            pts.push(pt(r, r - c));
            if c > 0.0 {
                pts.push(pt(r - c, r));
            }
            Shape::new(vec![pts])
        }
        Symbol::Cursor => {
            let pts = vec![pt(-0.32, -0.5), pt(0.42, 0.06), pt(0.06, 0.12), pt(-0.12, 0.5)];
            Shape::new(vec![rounded_polygon(&pts, 0.06)])
        }
        Symbol::Blob { lobes, depth, seed, wobble } => {
            let n = lobes.round().clamp(2.0, 32.0);
            let dep = depth.clamp(0.0, 0.3);
            let pts = (0..SEG * 2)
                .map(|k| {
                    let a = k as f64 / (SEG * 2) as f64 * TAU;
                    // |cos| bumps give rounded lobes with soft creases between them.
                    let bump = (a * n * 0.5).cos().abs();
                    let jitter = wobble * 0.08 * noise2(a.cos() * 1.5, a.sin() * 1.5, *seed);
                    let r = 0.5 - dep + dep * bump.sqrt() + jitter;
                    pt(r * a.cos(), r * a.sin())
                })
                .collect();
            Shape::new(vec![pts])
        }
        Symbol::Eyes { gap, width, height } => {
            let w = width.clamp(0.02, 0.5);
            let h = height.clamp(0.02, 1.0);
            let g = gap.clamp(0.0, 1.0) * 0.5;
            Shape::new(vec![rounded_polygon(&rect(-g, 0.0, w, h), w * 0.5), rounded_polygon(&rect(g, 0.0, w, h), w * 0.5)])
        }
        Symbol::Heart => {
            let pts = (0..SEG)
                .map(|k| {
                    let t = k as f64 / SEG as f64 * TAU;
                    let x = 16.0 * t.sin().powi(3);
                    let y = 13.0 * t.cos() - 5.0 * (2.0 * t).cos() - 2.0 * (3.0 * t).cos() - (4.0 * t).cos();
                    pt(x / 34.0, -y / 34.0 + 0.04)
                })
                .collect();
            Shape::new(vec![pts])
        }
        Symbol::Plus { thickness } => {
            let t = thickness.clamp(0.05, 0.9) * 0.5;
            let pts = vec![
                pt(-t, -0.5),
                pt(t, -0.5),
                pt(t, -t),
                pt(0.5, -t),
                pt(0.5, t),
                pt(t, t),
                pt(t, 0.5),
                pt(-t, 0.5),
                pt(-t, t),
                pt(-0.5, t),
                pt(-0.5, -t),
                pt(-t, -t),
            ];
            Shape::new(vec![rounded_polygon(&pts, t * 0.3)])
        }
        Symbol::CatHead { ears } => {
            let e = ears.clamp(0.0, 0.6);
            let pts = vec![
                pt(-0.42, 0.45),
                pt(-0.46, -0.05),
                pt(-0.40, -0.25 - e),
                pt(-0.12, -0.28),
                pt(0.12, -0.28),
                pt(0.40, -0.25 - e),
                pt(0.46, -0.05),
                pt(0.42, 0.45),
            ];
            Shape::new(vec![rounded_polygon(&pts, 0.12)])
        }
        Symbol::Bubble { tail, roundness } => {
            let n = roundness.clamp(2.0, 8.0);
            let (rx, ry) = (0.5, 0.42);
            let cy = -0.06;
            let body = |a: f64| {
                let (s, c) = a.sin_cos();
                pt(rx * c.signum() * c.abs().powf(2.0 / n), cy + ry * s.signum() * s.abs().powf(2.0 / n))
            };
            let t = tail.clamp(0.0, 0.6);
            // One contour: the body, with its lower-left arc swapped for a tail.
            let (a1, a2) = (0.56 * PI, 0.8 * PI);
            let mut pts = Vec::new();
            let steps = SEG * 2;
            for k in 0..steps {
                let a = k as f64 / steps as f64 * TAU;
                if t > 0.01 && a > a1 && a < a2 {
                    continue;
                }
                pts.push(body(a));
                if t > 0.01 && a <= a1 && (k + 1) as f64 / steps as f64 * TAU > a1 {
                    let (p1, p2) = (body(a1), body(a2));
                    let tip = pt(-0.44 - t * 0.08, cy + ry + 0.02 + t * 0.32);
                    let c1 = pt(p1.x - 0.06, tip.y - 0.06);
                    let c2 = pt(p2.x + 0.1, p2.y + 0.1);
                    for j in 0..=20 {
                        let u = j as f64 / 20.0;
                        pts.push(p1 * ((1.0 - u) * (1.0 - u)) + c1 * (2.0 * u * (1.0 - u)) + tip * (u * u));
                    }
                    for j in 1..=20 {
                        let u = j as f64 / 20.0;
                        pts.push(tip * ((1.0 - u) * (1.0 - u)) + c2 * (2.0 * u * (1.0 - u)) + p2 * (u * u));
                    }
                }
            }
            Shape::new(vec![pts])
        }
        Symbol::Spiral { turns, weight } => {
            let turns = turns.clamp(0.5, 6.0);
            let r0 = 0.05;
            let spacing = (0.5 - r0) / (turns + 0.5);
            let half = (spacing * weight.clamp(0.1, 0.95)).min(0.2) * 0.5;
            let steps = (turns * 128.0) as usize;
            let total = turns * TAU;
            let centre = |a: f64| -> (Pt, Pt) {
                let r = r0 + half + spacing * a / TAU;
                let p = pt(r * a.cos(), r * a.sin());
                // Tangent of an Archimedean spiral.
                let dr = spacing / TAU;
                let t = pt(dr * a.cos() - r * a.sin(), dr * a.sin() + r * a.cos()).normalized();
                (p, t)
            };
            let mut left = Vec::new();
            let mut right = Vec::new();
            for k in 0..=steps {
                let a = total * k as f64 / steps as f64;
                let (p, t) = centre(a);
                let nrm = t.perp();
                left.push(p + nrm * half);
                right.push(p - nrm * half);
            }
            let cap = |p: Pt, from: Pt, out: &mut Vec<Pt>| {
                let d = from - p;
                let a0 = d.y.atan2(d.x);
                for k in 1..12 {
                    let a = a0 + PI * k as f64 / 12.0;
                    out.push(pt(p.x + half * a.cos(), p.y + half * a.sin()));
                }
            };
            let mut pts = left.clone();
            let (end, _) = centre(total);
            cap(end, *left.last().unwrap(), &mut pts);
            pts.extend(right.iter().rev());
            let (start, _) = centre(0.0);
            cap(start, right[0], &mut pts);
            Shape::new(vec![pts])
        }
        Symbol::Flower { petals, depth } => {
            let n = petals.round().clamp(2.0, 16.0);
            let dep = depth.clamp(0.0, 0.8);
            let pts = (0..SEG * 2)
                .map(|k| {
                    let a = k as f64 / (SEG * 2) as f64 * TAU - PI / 2.0;
                    let s = ((a + PI / 2.0) * n * 0.5).sin().abs();
                    let r = 0.5 * (1.0 - dep * s.powf(1.6));
                    pt(r * a.cos(), r * a.sin())
                })
                .collect();
            Shape::new(vec![pts])
        }
        Symbol::Arrow { head, shaft } => {
            let h = head.clamp(0.1, 0.9);
            let t = shaft.clamp(0.05, 0.9) * 0.5;
            let hx = 0.5 - h * 0.6;
            let pts = vec![pt(-0.5, -t), pt(hx, -t), pt(hx, -h * 0.55), pt(0.5, 0.0), pt(hx, h * 0.55), pt(hx, t), pt(-0.5, t)];
            Shape::new(vec![rounded_polygon(&pts, 0.025)])
        }
        Symbol::Bolt => {
            let pts = vec![pt(0.08, -0.5), pt(-0.3, 0.06), pt(-0.02, 0.06), pt(-0.1, 0.5), pt(0.3, -0.08), pt(0.02, -0.08)];
            Shape::new(vec![rounded_polygon(&pts, 0.02)])
        }
        Symbol::Moon { phase } => {
            // Outer circle minus a circle shifted right by `off`.
            let off = 0.12 + phase.clamp(0.0, 1.0) * 0.6;
            let r = 0.5;
            // Intersection angle on the outer circle.
            let xi = off * 0.5;
            let ai = (xi / r).clamp(-1.0, 1.0).acos();
            let mut pts = Vec::new();
            let n = 160;
            for k in 0..=n {
                let a = ai + (TAU - 2.0 * ai) * k as f64 / n as f64;
                pts.push(pt(r * a.cos(), r * a.sin()));
            }
            // Inner arc of the shifted circle, back from the bottom to the top intersection.
            let bi = ((xi - off) / r).clamp(-1.0, 1.0).acos();
            for k in 1..n {
                let a = TAU - bi - (TAU - 2.0 * bi) * k as f64 / n as f64;
                pts.push(pt(off + r * a.cos(), r * a.sin()));
            }
            Shape::new(vec![pts])
        }
        Symbol::Smile { curve, weight } => {
            let c = curve.clamp(-1.0, 1.0);
            let w = weight.clamp(0.05, 1.0) * 0.3;
            let h = (0.08 + c.abs() * 1.3).min(1.45);
            // Chord of 0.9 minus the caps, whatever the curve.
            let r = (0.45 - w / 2.0) / h.sin();
            let sag = r - r * h.cos();
            let sign = if c < 0.0 { -1.0 } else { 1.0 };
            // y-down: π/2 points at the bottom of the circle.
            let mid = if sign > 0.0 { PI / 2.0 } else { -PI / 2.0 };
            let centre = pt(0.0, -sign * (r - sag / 2.0));
            let n = 64;
            let at = |rad: f64, a: f64| pt(centre.x + rad * a.cos(), centre.y + rad * a.sin());
            let mut pts = Vec::new();
            for k in 0..=n {
                pts.push(at(r + w / 2.0, mid - h + 2.0 * h * k as f64 / n as f64));
            }
            let cap = |pts: &mut Vec<Pt>, a: f64, from_out: bool| {
                let e = at(r, a);
                let dir = if from_out { a } else { a + PI };
                for k in 1..16 {
                    let t = dir + PI * k as f64 / 16.0 * if from_out == (sign > 0.0) { 1.0 } else { -1.0 } * sign;
                    pts.push(pt(e.x + w / 2.0 * t.cos(), e.y + w / 2.0 * t.sin()));
                }
            };
            cap(&mut pts, mid + h, true);
            for k in 0..=n {
                pts.push(at(r - w / 2.0, mid + h - 2.0 * h * k as f64 / n as f64));
            }
            cap(&mut pts, mid - h, false);
            Shape::new(vec![pts])
        }
        Symbol::Quarter => {
            let mut pts = vec![pt(-0.5, 0.5)];
            for k in 0..=64 {
                let a = -PI / 2.0 + k as f64 / 64.0 * (PI / 2.0);
                pts.push(pt(-0.5 + a.cos(), 0.5 + a.sin()));
            }
            Shape::new(vec![pts])
        }
        Symbol::Half => {
            let mut pts = Vec::new();
            for k in 0..=128 {
                let a = PI + k as f64 / 128.0 * PI;
                pts.push(pt(0.5 * a.cos(), 0.25 + 0.5 * a.sin()));
            }
            Shape::new(vec![pts])
        }
        Symbol::Cove => {
            // Corners clockwise from the bottom-left; the arc bites the top-right.
            let mut pts = vec![pt(-0.5, 0.5), pt(-0.5, -0.5)];
            for k in 0..=64 {
                let a = PI + k as f64 / 64.0 * (PI / 2.0);
                pts.push(pt(0.5 + a.cos(), -0.5 - a.sin()));
            }
            pts.push(pt(0.5, 0.5));
            Shape::new(vec![pts])
        }
        Symbol::Pill { aspect } => {
            let (rx, ry) = aspect_radii(*aspect);
            Shape::new(vec![rounded_polygon(&rect(0.0, 0.0, rx * 2.0, ry * 2.0), rx.min(ry) * 0.999)])
        }
        Symbol::Folder { tab, corner } => {
            let (top, bottom, th) = (-0.39, 0.39, 0.09);
            let tw = tab.clamp(0.1, 0.8);
            let pts = [pt(-0.5, bottom), pt(-0.5, top), pt(-0.5 + tw, top), pt(-0.5 + tw + 0.08, top + th), pt(0.5, top + th), pt(0.5, bottom)];
            Shape::new(vec![rounded_polygon(&pts, corner.clamp(0.0, 0.2))])
        }
        Symbol::Rays { rays, short, inner, jitter, seed } => {
            let n = (rays.round() as usize).clamp(3, 48);
            let ri = inner.clamp(0.05, 0.45);
            let mut pts = Vec::with_capacity(n * 4);
            for k in 0..n * 2 {
                let a = -PI / 2.0 + k as f64 / (n * 2) as f64 * TAU;
                if k % 2 == 0 {
                    let long = (k / 2) % 2 == 0;
                    let j = 1.0 - jitter.clamp(0.0, 1.0) * 0.45 * (noise2(k as f64 * 1.37, 0.5, *seed) * 0.5 + 0.5);
                    let ro = if long { 0.5 } else { (ri + (0.5 - ri) * short.clamp(0.0, 1.0)).max(ri + 0.02) } * j;
                    pts.push(pt(ro.max(ri + 0.02) * a.cos(), ro.max(ri + 0.02) * a.sin()));
                } else {
                    pts.push(pt(ri * a.cos(), ri * a.sin()));
                }
            }
            Shape::new(vec![pts])
        }
        Symbol::Wavy { waves, depth, scallop } => {
            let n = waves.round().clamp(3.0, 64.0);
            let a_ = depth.clamp(0.0, 0.3) * 0.5;
            let sc = scallop.clamp(0.0, 1.0);
            let r0 = 0.5 - a_;
            let m = 1024;
            let pts = (0..m)
                .map(|k| {
                    let a = k as f64 / m as f64 * TAU - PI / 2.0;
                    let t = (a + PI / 2.0) * n;
                    let wave = t.cos() * (1.0 - sc) + (2.0 * (t * 0.5).cos().abs() - 1.0) * sc;
                    let r = r0 + a_ * wave;
                    pt(r * a.cos(), r * a.sin())
                })
                .collect();
            Shape::new(vec![pts])
        }
        Symbol::Lens { aspect } => {
            let s = (aspect.clamp(0.05, 1.0) * 0.5).max(1e-3);
            let c = 0.5;
            let r = (c * c + s * s) / (2.0 * s);
            let th = (c / r).asin();
            let n = 96;
            let mut pts = Vec::with_capacity(n * 2);
            // Right arc top to bottom, then the left arc back up.
            for k in 0..n {
                let a = -th + 2.0 * th * k as f64 / n as f64;
                pts.push(pt(s - r + r * a.cos(), r * a.sin()));
            }
            for k in 0..n {
                let a = -th + 2.0 * th * k as f64 / n as f64;
                pts.push(pt(-(s - r + r * a.cos()), -r * a.sin()));
            }
            Shape::new(vec![pts])
        }
        Symbol::Cloud { puffs, seed } => {
            let n = (puffs.round() as usize).clamp(1, 7);
            let base_y = 0.16;
            let base_h = 0.13;
            let mut circles = Vec::with_capacity(n);
            for k in 0..n {
                let t = if n == 1 { 0.5 } else { k as f64 / (n - 1) as f64 };
                let j = noise2(k as f64 * 3.7, 0.5, *seed);
                let r = 0.15 + 0.13 * (PI * (k as f64 + 0.5) / n as f64).sin() + 0.03 * j;
                let x = -0.3 + 0.6 * t + 0.04 * j;
                circles.push((pt(x, base_y + base_h - r * 1.05), r));
            }
            let f = |p: Pt| {
                // Flat-bottomed base: a pill.
                let hx = 0.5 - base_h;
                let q = pt((p.x.abs() - hx).max(0.0), p.y - base_y);
                let mut d = q.x.hypot(q.y) - base_h;
                for &(c, r) in &circles {
                    d = d.min(p.dist(c) - r);
                }
                d
            };
            let s = field_shape(Rect { x0: -0.5, y0: -0.6, x1: 0.5, y1: 0.35 }, 1.0 / 320.0, f);
            let b = s.bbox();
            let c = b.center();
            let k = 1.0 / b.width().max(b.height()).max(1e-6);
            s.transformed(&crate::geom::Affine::scale(k, k).then(crate::geom::Affine::translate(-c.x, -c.y)))
        }
        Symbol::Globe { meridians, parallels, weight, aspect } => {
            let w = weight.clamp(0.01, 0.2);
            let r = 0.5 - w / 2.0;
            let (ax, ay) = { let a = aspect.clamp(0.3, 3.0); if a >= 1.0 { (1.0, 1.0 / a) } else { (a, 1.0) } };
            let ell = |rx: f64, ry: f64| -> Vec<Pt> { (0..160).map(|k| { let a = k as f64 / 160.0 * TAU; pt(rx * a.cos() * ax, ry * a.sin() * ay) }).collect() };
            let mut lines = vec![(ell(r, r), true), (vec![pt(0.0, -r * ay), pt(0.0, r * ay)], false)];
            let m = meridians.round().clamp(0.0, 8.0) as usize;
            for k in 1..=m {
                let rx = r * (k as f64 * PI / (2.0 * (m as f64 + 1.0))).sin();
                lines.push((ell(rx, r), true));
            }
            let pn = parallels.round().clamp(0.0, 8.0) as usize;
            lines.push((vec![pt(-r * ax, 0.0), pt(r * ax, 0.0)], false));
            for k in 1..=pn {
                let y = r * (k as f64 * PI / (2.0 * (pn as f64 + 1.0))).sin();
                let half = (r * r - y * y).max(0.0).sqrt();
                for sy in [-1.0, 1.0] {
                    lines.push((vec![pt(-half * ax, sy * y * ay), pt(half * ax, sy * y * ay)], false));
                }
            }
            crate::stroke::polylines(&lines, w, 1.0 / 400.0)
        }
        Symbol::Asterisk { arms, weight, inner } => {
            let n = (arms.round() as usize).clamp(2, 64);
            let w = weight.clamp(0.005, 0.4);
            let r = 0.5 - w / 2.0;
            let ri = inner.clamp(0.0, 0.9) * r;
            let lines: Vec<(Vec<Pt>, bool)> = (0..n)
                .map(|k| {
                    let a = k as f64 / n as f64 * TAU - PI / 2.0;
                    let (s, c) = a.sin_cos();
                    (vec![pt(ri * c, ri * s), pt(r * c, r * s)], false)
                })
                .collect();
            crate::stroke::polylines(&lines, w, 1.0 / 400.0)
        }
    };
    normalize_winding(&mut s);
    s
}

/// Zero level of a distance function sampled over `bounds`.
fn field_shape(bounds: Rect, cell: f64, f: impl Fn(Pt) -> f64) -> Shape {
    let g = Grid::covering(bounds, cell * 3.0, cell);
    let mut v = vec![0f32; g.len()];
    for j in 0..g.h {
        for i in 0..g.w {
            v[j * g.w + i] = f(g.sample_pos(i, j)) as f32;
        }
    }
    extract(&v, &g, 0.0, g.cell * 0.15, g.cell * g.cell * 1.5)
}

fn aspect_radii(aspect: f64) -> (f64, f64) {
    let a = aspect.clamp(0.1, 10.0);
    if a >= 1.0 { (0.5, 0.5 / a) } else { (0.5 * a, 0.5) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_symbol_builds() {
        let all: Vec<Symbol> = serde_json::from_str(
            r#"[{"kind":"circle"},{"kind":"ring"},{"kind":"squircle"},{"kind":"roundRect"},{"kind":"polygon","rounding":0.3},
            {"kind":"star","rounding":0.2},{"kind":"sparkle"},{"kind":"burst"},{"kind":"pin"},{"kind":"cursor"},{"kind":"blob","wobble":1},
            {"kind":"eyes"},{"kind":"heart"},{"kind":"plus"},{"kind":"catHead"},{"kind":"bubble"},{"kind":"spiral"},
            {"kind":"flower"},{"kind":"arrow"},{"kind":"bolt"},{"kind":"moon"},{"kind":"moon","phase":1},
            {"kind":"smile"},{"kind":"smile","curve":-0.6},{"kind":"smile","curve":0.0},{"kind":"rays"},{"kind":"rays","jitter":1,"seed":3},{"kind":"folder"},{"kind":"quarter"},{"kind":"half"},{"kind":"cove"},{"kind":"pill"},{"kind":"pill","aspect":0.4},{"kind":"folder","corner":0},
            {"kind":"wavy"},{"kind":"wavy","scallop":1,"waves":12,"depth":0.2},{"kind":"lens"},{"kind":"cloud"},{"kind":"cloud","puffs":5,"seed":2},
            {"kind":"globe"},{"kind":"globe","aspect":1.8,"meridians":4},{"kind":"asterisk"},{"kind":"asterisk","arms":24,"weight":0.02,"inner":0.2}]"#,
        )
        .unwrap();
        for s in &all {
            let sh = build(s);
            assert!(!sh.is_empty(), "{s:?}");
            assert!(sh.area() > 0.0, "{s:?} area {}", sh.area());
            let b = sh.bbox();
            assert!(b.width() <= 1.05 && b.height() <= 1.05, "{s:?} {b:?}");
        }
    }

    #[test]
    fn line_symbols_are_one_piece() {
        // Globe lines and asterisk arms merge into single solids.
        let g = build(&Symbol::Globe { meridians: 2.0, parallels: 2.0, weight: 0.04, aspect: 1.0 });
        let outer = g.contours.iter().filter(|c| crate::geom::signed_area(c) > 0.0).count();
        assert_eq!(outer, 1, "globe solids: {outer}");
        let a = build(&Symbol::Asterisk { arms: 8.0, weight: 0.1, inner: 0.0 });
        assert_eq!(a.contours.len(), 1);
        // With an empty middle the arms come apart.
        assert_eq!(build(&Symbol::Asterisk { arms: 8.0, weight: 0.05, inner: 0.3 }).contours.len(), 8);
    }

    #[test]
    fn wavy_badge_stays_in_its_box() {
        for sc in [0.0, 1.0] {
            let b = build(&Symbol::Wavy { waves: 20.0, depth: 0.2, scallop: sc }).bbox();
            assert!(b.width() <= 1.0 + 1e-9 && b.width() > 0.97, "{b:?}");
        }
    }

    #[test]
    fn ring_area() {
        let a = build(&Symbol::Ring { thickness: 0.1 }).area();
        let exact = PI * (0.25 - 0.16);
        assert!((a - exact).abs() / exact < 0.01);
    }
}
