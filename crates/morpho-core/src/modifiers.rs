//! Non-destructive shape modifiers. A layer's modifier stack runs in order.
//!
//! All lengths are expressed as fractions of the layer's em (its font size or
//! symbol size), so a stack looks the same at any size and can be reused for
//! font export where the em is the font's units-per-em.

use crate::field::{block_contours, extract, rasterize, signed_distance, Grid};
use crate::geom::{densify, Affine, CurveShape, Pt, Rect, Shape};
use crate::noise::fbm;
use serde::{Deserialize, Serialize};

fn one() -> f64 {
    1.0
}
fn yes() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Modifier {
    /// Grow (+) or shrink (−) strokes by `amount` em.
    Weight { #[serde(default)] amount: f64 },
    /// Round both convex and concave corners with `radius` em.
    Round { #[serde(default)] radius: f64 },
    /// Replace the fill by an outline `width` em wide.
    Outline { #[serde(default)] width: f64 },
    /// Organic ink spread: noisy edges, `amount` em deep at `scale` em features.
    Ink { #[serde(default)] amount: f64, #[serde(default = "one")] scale: f64, #[serde(default)] seed: u32 },
    /// Oblique angle in degrees (positive leans right).
    Slant { #[serde(default)] angle: f64 },
    /// Scale horizontally / vertically around the layer origin.
    Stretch { #[serde(default = "one")] x: f64, #[serde(default = "one")] y: f64 },
    /// Sine-wave baseline.
    Wave {
        #[serde(default)]
        amplitude: f64,
        #[serde(default = "one")]
        wavelength: f64,
        #[serde(default)]
        phase: f64,
    },
    /// Bend along a circular arc; 1 = upper half circle, −1 = lower.
    Arc { #[serde(default)] bend: f64 },
    /// Smooth random displacement of the outline.
    Wobble { #[serde(default)] amount: f64, #[serde(default = "one")] scale: f64, #[serde(default)] seed: u32 },
    /// Downward drips, stronger toward the bottom of the shape.
    Melt { #[serde(default)] amount: f64, #[serde(default = "one")] scale: f64, #[serde(default)] seed: u32 },
    /// Snap to a grid with cells `size` em wide. Cells become squares, dots or
    /// rounded squares; `gap` (fraction of a cell) separates them.
    Pixelate {
        #[serde(default)]
        size: f64,
        #[serde(default)]
        shape: PixelShape,
        #[serde(default)]
        gap: f64,
    },
    /// Bezier envelope warp over the shape's bounding box: a preset `style`
    /// scaled by `bend`, plus 16 free control-point offsets (row-major, as
    /// fractions of the box) for hand-made warps.
    Warp {
        #[serde(default)]
        style: WarpStyle,
        #[serde(default)]
        bend: f64,
        #[serde(default)]
        points: Vec<[f64; 2]>,
    },
    /// Keystone: narrows the top (+) or the bottom (−).
    Perspective { #[serde(default)] amount: f64 },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PixelShape {
    #[default]
    Square,
    Dot,
    Rounded,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WarpStyle {
    #[default]
    Custom,
    Arch,
    Arc,
    ArcLower,
    Bulge,
    Flag,
    Rise,
    Fish,
    Inflate,
    Squeeze,
    Twist,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ModEntry {
    #[serde(default = "yes")]
    pub on: bool,
    /// UI identity; reported back with warp frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    #[serde(flatten)]
    pub m: Modifier,
}

/// Geometry flowing through the pipeline. `curves` is kept only while every
/// operation so far was affine, so exports can stay exact.
#[derive(Clone, Debug, Default)]
pub struct Geo {
    pub poly: Shape,
    pub curves: Option<CurveShape>,
}

impl Geo {
    pub fn transform(&mut self, m: &Affine) {
        self.poly.transform(m);
        if let Some(cs) = &mut self.curves {
            for c in cs.iter_mut() {
                c.transform(m);
            }
            if m.determinant() < 0.0 {
                for c in cs.iter_mut() {
                    *c = c.reversed();
                }
            }
        }
    }
    pub fn poly_only(poly: Shape) -> Geo {
        Geo { poly, curves: None }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Ctx {
    /// Size of one em in the shape's units.
    pub em: f64,
    /// Field samples per em for field-based operations.
    pub quality: f64,
}

impl Ctx {
    fn cell(&self) -> f64 {
        self.em / self.quality.clamp(24.0, 1024.0)
    }
}

/// Evaluate `f(position, signed distance)` over a field and re-extract the zero level.
/// `monotone`: `f` keeps the sign of samples farther than `reach` from the
/// outline (true for offsets, false for e.g. outlines), so they can be skipped.
fn field_map(s: &Shape, ctx: &Ctx, reach: f64, monotone: bool, f: impl Fn(Pt, f32) -> f32) -> Shape {
    if s.is_empty() {
        return Shape::default();
    }
    let cell = ctx.cell();
    let band = reach.abs() + 3.0 * cell;
    let g = Grid::covering(s.bbox(), band, cell);
    let mut v = signed_distance(s, &g, band);
    // Samples beyond the band can't change sign (|reach| < band), so skip them.
    let limit = if monotone { (band - 0.5 * cell) as f32 } else { f32::INFINITY };
    for j in 0..g.h {
        for i in 0..g.w {
            let k = j * g.w + i;
            if v[k].abs() < limit {
                v[k] = f(g.sample_pos(i, j), v[k]);
            }
        }
    }
    extract(&v, &g, 0.0, g.cell * 0.15, g.cell * g.cell * 1.5)
}

pub fn offset(s: &Shape, d: f64, ctx: &Ctx) -> Shape {
    let d32 = d as f32;
    field_map(s, ctx, d, true, |_, v| v - d32)
}

fn densified(s: &Shape, max_len: f64) -> Shape {
    Shape::new(s.contours.iter().map(|c| densify(c, max_len)).collect())
}

fn map_points(s: &Shape, f: impl Fn(Pt) -> Pt) -> Shape {
    Shape::new(s.contours.iter().map(|c| c.iter().map(|&p| f(p)).collect()).collect())
}

/// Apply one modifier.
pub fn apply(geo: Geo, m: &Modifier, ctx: &Ctx) -> Geo {
    let em = ctx.em;
    let bbox = geo.poly.bbox();
    let fine = em / 48.0;
    match *m {
        Modifier::Slant { angle } => {
            let mut g = geo;
            g.transform(&Affine::skew_x(angle.clamp(-80.0, 80.0).to_radians().tan()));
            g
        }
        Modifier::Stretch { x, y } => {
            let mut g = geo;
            g.transform(&Affine::scale(x.clamp(0.05, 20.0), y.clamp(0.05, 20.0)));
            g
        }
        Modifier::Weight { amount } => {
            if amount.abs() < 1e-6 {
                return geo;
            }
            Geo::poly_only(offset(&geo.poly, amount * em, ctx))
        }
        Modifier::Round { radius } => {
            let r = radius.abs() * em;
            if r < 1e-6 {
                return geo;
            }
            // Opening rounds convex corners, closing rounds concave ones.
            let opened = offset(&offset(&geo.poly, -r, ctx), r, ctx);
            let closed = offset(&offset(&opened, r, ctx), -r, ctx);
            Geo::poly_only(closed)
        }
        Modifier::Outline { width } => {
            let w = (width.abs() * em * 0.5) as f32;
            if w < 1e-6 {
                return geo;
            }
            Geo::poly_only(field_map(&geo.poly, ctx, w as f64, false, |_, v| v.abs() - w))
        }
        Modifier::Ink { amount, scale, seed } => {
            let a = amount * em;
            if a.abs() < 1e-6 {
                return geo;
            }
            let freq = 1.0 / (scale.max(0.01) * em * 0.25);
            Geo::poly_only(field_map(&geo.poly, ctx, a * 1.25, true, |p, v| {
                // Mostly-outward spread with a few bites taken out of the edge.
                let n = fbm(p.x * freq, p.y * freq, seed, 4);
                v - (a * (0.35 + 0.9 * n)) as f32
            }))
        }
        Modifier::Wave { amplitude, wavelength, phase } => {
            let a = amplitude * em;
            if a.abs() < 1e-6 {
                return geo;
            }
            let k = std::f64::consts::TAU / (wavelength.max(0.05) * em);
            let s = densified(&geo.poly, fine);
            Geo::poly_only(map_points(&s, |p| Pt { x: p.x, y: p.y + a * (p.x * k + phase).sin() }))
        }
        Modifier::Arc { bend } => {
            let b = bend.clamp(-1.0, 1.0);
            if b.abs() < 1e-3 || bbox.is_empty() {
                return geo;
            }
            let w = bbox.width().max(1e-6);
            let theta = b * std::f64::consts::PI;
            let r = w / theta;
            let cx = bbox.center().x;
            let yb = bbox.center().y;
            let center = Pt { x: cx, y: yb + r };
            let s = densified(&geo.poly, fine);
            Geo::poly_only(map_points(&s, |p| {
                let ang = (p.x - cx) / r;
                let rr = r + (yb - p.y);
                Pt { x: center.x + ang.sin() * rr, y: center.y - ang.cos() * rr }
            }))
        }
        Modifier::Wobble { amount, scale, seed } => {
            let a = amount * em;
            if a.abs() < 1e-6 {
                return geo;
            }
            let freq = 1.0 / (scale.max(0.01) * em * 0.5);
            let s = densified(&geo.poly, fine * 0.5);
            Geo::poly_only(map_points(&s, |p| Pt {
                x: p.x + a * fbm(p.x * freq, p.y * freq, seed, 3),
                y: p.y + a * fbm(p.x * freq + 31.7, p.y * freq - 12.3, seed.wrapping_add(7), 3),
            }))
        }
        Modifier::Melt { amount, scale, seed } => {
            let a = amount * em;
            if a.abs() < 1e-6 || bbox.is_empty() {
                return geo;
            }
            let h = bbox.height().max(1e-6);
            let freq = 1.0 / (scale.max(0.01) * em * 0.3);
            let s = densified(&geo.poly, fine * 0.5);
            Geo::poly_only(map_points(&s, |p| {
                let t = ((p.y - bbox.y0) / h).clamp(0.0, 1.0);
                let drip = (fbm(p.x * freq, 0.5, seed, 2) * 1.6).max(0.0).powf(1.5);
                Pt { x: p.x, y: p.y + a * drip * t * t * t }
            }))
        }
        Modifier::Perspective { amount } => {
            let a = amount.clamp(-0.95, 0.95);
            if a.abs() < 1e-4 || bbox.is_empty() {
                return geo;
            }
            let h = bbox.height().max(1e-6);
            let cx = bbox.center().x;
            let s = densified(&geo.poly, fine);
            Geo::poly_only(map_points(&s, |p| {
                let up = ((bbox.y1 - p.y) / h).clamp(0.0, 1.0);
                Pt { x: cx + (p.x - cx) * (1.0 - a * up), y: p.y }
            }))
        }
        Modifier::Pixelate { size, shape, gap } => {
            let cell = size.abs() * em;
            if cell < em / 400.0 || bbox.is_empty() {
                return geo;
            }
            // Align the grid to the shape origin so neighbouring glyphs share it.
            let ox = (bbox.x0 / cell).floor() * cell - cell;
            let oy = (bbox.y0 / cell).floor() * cell - cell;
            let w = ((bbox.x1 - ox) / cell).ceil() as usize + 2;
            let h = ((bbox.y1 - oy) / cell).ceil() as usize + 2;
            if w * h > crate::field::MAX_SAMPLES {
                return geo;
            }
            let g = Grid { w, h, origin: Pt { x: ox, y: oy }, cell };
            let mask = rasterize(&geo.poly, &g);
            let gap = gap.clamp(0.0, 0.9);
            if shape == PixelShape::Square && gap < 1e-4 {
                return Geo::poly_only(block_contours(&mask, w, h, g.origin, cell));
            }
            let side = cell * (1.0 - gap);
            let mut cs = Vec::new();
            for j in 0..h {
                for i in 0..w {
                    if mask[j * w + i] == 0 {
                        continue;
                    }
                    let c = Pt { x: ox + (i as f64 + 0.5) * cell, y: oy + (j as f64 + 0.5) * cell };
                    cs.push(match shape {
                        PixelShape::Dot => circle(c, side * 0.5, 20),
                        PixelShape::Rounded => rounded_square(c, side, side * 0.28),
                        PixelShape::Square => square_at(c, side),
                    });
                }
            }
            Geo::poly_only(Shape::new(cs))
        }
        Modifier::Warp { style, bend, ref points } => {
            if bbox.is_empty() {
                return geo;
            }
            let net = warp_net(style, bend, points);
            if net.iter().all(|o| o[0].abs() < 1e-9 && o[1].abs() < 1e-9) {
                return geo;
            }
            let (w, h) = (bbox.width().max(1e-9), bbox.height().max(1e-9));
            let s = densified(&geo.poly, fine * 0.75);
            Geo::poly_only(map_points(&s, |p| {
                let u = (p.x - bbox.x0) / w;
                let v = (p.y - bbox.y0) / h;
                let o = eval_net(&net, u, v);
                Pt { x: p.x + o[0] * w, y: p.y + o[1] * h }
            }))
        }
    }
}

fn circle(c: Pt, r: f64, n: usize) -> Vec<Pt> {
    (0..n)
        .map(|k| {
            let a = k as f64 / n as f64 * std::f64::consts::TAU;
            Pt { x: c.x + r * a.cos(), y: c.y + r * a.sin() }
        })
        .collect()
}

fn square_at(c: Pt, side: f64) -> Vec<Pt> {
    let h = side * 0.5;
    vec![Pt { x: c.x - h, y: c.y - h }, Pt { x: c.x + h, y: c.y - h }, Pt { x: c.x + h, y: c.y + h }, Pt { x: c.x - h, y: c.y + h }]
}

fn rounded_square(c: Pt, side: f64, r: f64) -> Vec<Pt> {
    let h = side * 0.5;
    let r = r.min(h);
    let mut out = Vec::with_capacity(24);
    // Corner centres, clockwise in y-down space starting top-right.
    let corners = [(h - r, -h + r, -0.5), (h - r, h - r, 0.0), (-h + r, h - r, 0.5), (-h + r, -h + r, 1.0)];
    for (cx, cy, start) in corners {
        for k in 0..=5 {
            let a = (start + k as f64 / 5.0 * 0.5) * std::f64::consts::PI;
            out.push(Pt { x: c.x + cx + r * a.cos(), y: c.y + cy + r * a.sin() });
        }
    }
    out
}

/// Control-net offsets (16 points, row-major, fractions of the box) for a warp.
pub fn warp_net(style: WarpStyle, bend: f64, points: &[[f64; 2]]) -> [[f64; 2]; 16] {
    let b = bend.clamp(-2.0, 2.0);
    let mut o = [[0.0f64; 2]; 16];
    let mid = |i: usize| i == 1 || i == 2;
    for j in 0..4 {
        for i in 0..4 {
            let k = j * 4 + i;
            let (u, v) = (i as f64 / 3.0, j as f64 / 3.0);
            o[k] = match style {
                WarpStyle::Custom => [0.0, 0.0],
                WarpStyle::Arch => [0.0, if mid(i) { -0.42 * b } else { 0.0 }],
                WarpStyle::Arc => [0.0, if mid(i) && j == 0 { -0.55 * b } else if mid(i) && j == 1 { -0.2 * b } else { 0.0 }],
                WarpStyle::ArcLower => [0.0, if mid(i) && j == 3 { 0.55 * b } else if mid(i) && j == 2 { 0.2 * b } else { 0.0 }],
                WarpStyle::Bulge => [0.0, if mid(i) { (v - 0.5) * 1.0 * b } else { 0.0 }],
                WarpStyle::Flag => [0.0, if i == 1 { -0.38 * b } else if i == 2 { 0.38 * b } else { 0.0 }],
                WarpStyle::Rise => [0.0, if i < 2 { 0.22 * b } else { -0.22 * b }],
                WarpStyle::Fish => [
                    0.0,
                    if j == 0 && mid(i) {
                        -0.4 * b
                    } else if j == 3 && mid(i) {
                        0.4 * b
                    } else if i == 3 {
                        (v - 0.5) * -0.45 * b
                    } else {
                        0.0
                    },
                ],
                WarpStyle::Inflate => {
                    if mid(i) && mid(j) {
                        [(u - 0.5) * 0.9 * b, (v - 0.5) * 0.9 * b]
                    } else if mid(i) || mid(j) {
                        [(u - 0.5) * 0.35 * b * (mid(j) as u8 as f64), (v - 0.5) * 0.35 * b * (mid(i) as u8 as f64)]
                    } else {
                        [0.0, 0.0]
                    }
                }
                WarpStyle::Squeeze => [if mid(j) { (0.5 - u) * 0.7 * b } else { 0.0 }, 0.0],
                WarpStyle::Twist => [(0.5 - v) * 0.45 * b, (u - 0.5) * 0.3 * b],
            };
            if let Some(p) = points.get(k) {
                o[k][0] += p[0];
                o[k][1] += p[1];
            }
        }
    }
    o
}

fn bern(t: f64) -> [f64; 4] {
    let s = 1.0 - t;
    [s * s * s, 3.0 * s * s * t, 3.0 * s * t * t, t * t * t]
}

/// Offset of the Bezier patch at (u, v). Uniform control points reproduce the
/// identity, so only the offsets need evaluating.
pub fn eval_net(net: &[[f64; 2]; 16], u: f64, v: f64) -> [f64; 2] {
    let bu = bern(u.clamp(0.0, 1.0));
    let bv = bern(v.clamp(0.0, 1.0));
    let mut out = [0.0, 0.0];
    for j in 0..4 {
        for i in 0..4 {
            let w = bu[i] * bv[j];
            out[0] += w * net[j * 4 + i][0];
            out[1] += w * net[j * 4 + i][1];
        }
    }
    // Points outside the box (e.g. from earlier modifiers) extend linearly.
    out
}

/// Run a full modifier stack.
pub fn apply_all(geo: Geo, mods: &[ModEntry], ctx: &Ctx) -> Geo {
    apply_all_frames(geo, mods, ctx, &mut Vec::new())
}

/// Run a stack and record, for each warp modifier with a uid, the box it
/// warped (so the UI can draw its control net).
pub fn apply_all_frames(mut geo: Geo, mods: &[ModEntry], ctx: &Ctx, frames: &mut Vec<(String, Rect)>) -> Geo {
    for e in mods.iter().filter(|e| e.on) {
        if let (Modifier::Warp { .. }, Some(uid)) = (&e.m, &e.uid) {
            frames.push((uid.clone(), geo.poly.bbox()));
        }
        geo = apply(geo, &e.m, ctx);
        if geo.poly.is_empty() {
            break;
        }
    }
    geo
}

/// Whether a stack only contains operations that make sense per glyph
/// (used by font export to warn about layout-level modifiers).
pub fn is_layout_level(m: &Modifier) -> bool {
    matches!(m, Modifier::Arc { .. } | Modifier::Perspective { .. })
}

/// Bounding box helper re-exported for callers that only hold a Geo.
pub fn bbox(g: &Geo) -> Rect {
    g.poly.bbox()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::pt;

    fn square(s: f64) -> Shape {
        Shape::new(vec![vec![pt(0.0, 0.0), pt(s, 0.0), pt(s, s), pt(0.0, s)]])
    }

    const CTX: Ctx = Ctx { em: 100.0, quality: 200.0 };

    #[test]
    fn weight_grows_area() {
        let g = apply(Geo::poly_only(square(100.0)), &Modifier::Weight { amount: 0.1 }, &CTX);
        // 120x120 with rounded corners: 14400 - (4 - pi) * 100.
        let expect = 14400.0 - (4.0 - std::f64::consts::PI) * 100.0;
        assert!((g.poly.area() - expect).abs() / expect < 0.01, "{}", g.poly.area());
    }

    #[test]
    fn outline_makes_ring() {
        let g = apply(Geo::poly_only(square(100.0)), &Modifier::Outline { width: 0.1 }, &CTX);
        assert_eq!(g.poly.contours.len(), 2);
    }

    #[test]
    fn pixelate_is_axis_aligned() {
        let circle: Vec<Pt> = (0..100)
            .map(|k| {
                let a = k as f64 / 100.0 * std::f64::consts::TAU;
                pt(50.0 * a.cos(), 50.0 * a.sin())
            })
            .collect();
        let g = apply(Geo::poly_only(Shape::new(vec![circle])), &Modifier::Pixelate { size: 0.1, shape: PixelShape::Square, gap: 0.0 }, &CTX);
        for c in &g.poly.contours {
            for i in 0..c.len() {
                let d = c[(i + 1) % c.len()] - c[i];
                assert!(d.x.abs() < 1e-9 || d.y.abs() < 1e-9);
            }
        }
        assert!(g.poly.area() > 6000.0 && g.poly.area() < 9500.0);
    }

    #[test]
    fn dot_pixels_are_separate_circles() {
        let g = apply(Geo::poly_only(square(100.0)), &Modifier::Pixelate { size: 0.2, shape: PixelShape::Dot, gap: 0.1 }, &CTX);
        assert_eq!(g.poly.contours.len(), 25);
        let r = 0.2 * 100.0 * 0.9 * 0.5;
        let expect = 25.0 * std::f64::consts::PI * r * r;
        assert!((g.poly.area() - expect).abs() / expect < 0.03, "{}", g.poly.area());
    }

    #[test]
    fn warp_identity_and_arch() {
        let net = warp_net(WarpStyle::Custom, 0.0, &[]);
        assert_eq!(eval_net(&net, 0.3, 0.7), [0.0, 0.0]);
        let g = apply(Geo::poly_only(square(100.0)), &Modifier::Warp { style: WarpStyle::Arch, bend: 0.5, points: vec![] }, &CTX);
        let b = g.poly.bbox();
        // Middle rises, corners stay.
        assert!(b.y0 < -10.0, "{b:?}");
        assert!((b.x0 - 0.0).abs() < 1e-6 && (b.x1 - 100.0).abs() < 1e-6);
    }

    #[test]
    fn warp_frames_are_reported() {
        let mods: Vec<ModEntry> = serde_json::from_str(r#"[{"kind":"warp","style":"flag","bend":0.4,"uid":"w1"}]"#).unwrap();
        let mut frames = Vec::new();
        apply_all_frames(Geo::poly_only(square(50.0)), &mods, &CTX, &mut frames);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].0, "w1");
        assert!((frames[0].1.width() - 50.0).abs() < 1e-9);
    }

    #[test]
    fn slant_keeps_curves() {
        let mut g = Geo::poly_only(square(10.0));
        g.curves = Some(crate::geom::poly_to_curves(&g.poly));
        let g = apply(g, &Modifier::Slant { angle: 12.0 }, &CTX);
        assert!(g.curves.is_some());
    }

    #[test]
    fn modifiers_deserialize_with_defaults() {
        let m: Vec<ModEntry> = serde_json::from_str(r#"[{"kind":"weight","amount":0.05},{"kind":"stretch","x":1.2,"on":false}]"#).unwrap();
        assert!(m[0].on);
        assert_eq!(m[1].m, Modifier::Stretch { x: 1.2, y: 1.0 });
    }
}
