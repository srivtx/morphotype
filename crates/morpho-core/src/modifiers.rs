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
fn d180() -> f64 {
    180.0
}
fn eight() -> f64 {
    8.0
}
fn six() -> f64 {
    6.0
}
fn three() -> f64 {
    3.0
}
fn slice_gap() -> f64 {
    0.035
}
fn half() -> f64 {
    0.5
}
fn full_turn() -> f64 {
    360.0
}
fn echo_gap() -> f64 {
    0.06
}
fn echo_width() -> f64 {
    0.02
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
    /// Bend along a circular arc; 1 = upper half circle, 2 = a full circle, −1/−2 below.
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
        /// Drop cells toward one side, 0 = none, 1 = across the whole shape.
        #[serde(default)]
        dissolve: f64,
        /// Direction the dissolve fades toward, in degrees (180 = down).
        #[serde(default = "d180")]
        angle: f64,
        #[serde(default)]
        seed: u32,
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
    /// Cut straight gaps `gap` em wide outward from the centre, like a sliced
    /// pie or sun rays. `ring` adds a circular gap at that fraction of the
    /// half size (rays start there); `hole` removes a disc from the centre.
    Slice {
        #[serde(default = "eight")]
        count: f64,
        #[serde(default = "slice_gap")]
        gap: f64,
        #[serde(default)]
        angle: f64,
        #[serde(default)]
        ring: f64,
        #[serde(default)]
        hole: f64,
        #[serde(default)]
        jitter: f64,
        #[serde(default)]
        seed: u32,
        /// Round the pieces' corners by this many em without closing the gaps.
        #[serde(default)]
        soften: f64,
        /// Move the centre, as a fraction of the half size (+x right, +y down).
        #[serde(default)]
        x: f64,
        #[serde(default)]
        y: f64,
    },
    /// Copies around a circle (radial) or in a grid, centred on the original.
    Repeat {
        #[serde(default)]
        mode: RepeatMode,
        /// Radial: number of copies.
        #[serde(default = "six")]
        count: f64,
        /// Radial: circle radius in em.
        #[serde(default = "half")]
        radius: f64,
        /// Radial: degrees covered (360 = all the way round).
        #[serde(default = "full_turn")]
        sweep: f64,
        /// Radial: 1 turns each copy to face outward, 0 keeps it upright.
        #[serde(default = "one")]
        orient: f64,
        /// Grid: columns and rows.
        #[serde(default = "three")]
        cols: f64,
        #[serde(default = "one")]
        rows: f64,
        /// Grid: space between copies in em.
        #[serde(default, rename = "gapX")]
        gap_x: f64,
        #[serde(default, rename = "gapY")]
        gap_y: f64,
        /// Trail: step between copies in em, scale per step and turn per step (degrees).
        #[serde(default)]
        dx: f64,
        #[serde(default)]
        dy: f64,
        #[serde(default = "one")]
        grow: f64,
        #[serde(default)]
        spin: f64,
    },
    /// Concentric outline rings around the shape ("echo" lines).
    Echo {
        #[serde(default = "three")]
        count: f64,
        /// Distance between rings in em.
        #[serde(default = "echo_gap")]
        spacing: f64,
        /// Ring thickness in em.
        #[serde(default = "echo_width")]
        width: f64,
    },
    /// Close gaps narrower than `amount` em, fusing nearby letters or shapes
    /// into one solid form while keeping the outside shape.
    Fuse { #[serde(default)] amount: f64 },
    /// Squeeze the shape's box into an ellipse (a circle for a square box),
    /// like lettering filling a round badge. `amount` blends 0..1.
    FitCircle { #[serde(default = "one")] amount: f64 },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RepeatMode {
    #[default]
    Radial,
    Grid,
    /// Copies stepping away from the original, each moved, scaled and turned a little more.
    Trail,
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
            let b = bend.clamp(-2.0, 2.0);
            if b.abs() < 1e-3 || bbox.is_empty() {
                return geo;
            }
            let w = bbox.width().max(1e-6);
            let theta = b * std::f64::consts::PI;
            let r = w / theta;
            let cx = bbox.center().x;
            let yb = bbox.center().y;
            // Past a half circle the ring drifts toward the text's centre, so a
            // full circle (|bend| = 2) is centred where the text was.
            let center = Pt { x: cx, y: yb + r - r * (b.abs() - 1.0).max(0.0) };
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
        Modifier::Pixelate { size, shape, gap, dissolve, angle, seed } => {
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
            let mut mask = rasterize(&geo.poly, &g);
            if dissolve > 1e-4 {
                dissolve_cells(&mut mask, &g, bbox, dissolve.min(1.0), angle, seed);
            }
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
        Modifier::Slice { count, gap, angle, ring, hole, jitter, seed, soften, x, y } => {
            let cut = slice(geo, ctx, count, gap, angle, ring, hole, jitter, seed, (x, y));
            // Opening only: rounds every piece's corners but can't bridge a gap.
            let r = soften.abs().min(gap.abs() * 2.0) * em;
            if r < 1e-6 {
                return cut;
            }
            Geo::poly_only(offset(&offset(&cut.poly, -r, ctx), r, ctx))
        }
        Modifier::Echo { count, spacing, width } => {
            let n = (count.round() as usize).clamp(0, 40);
            let (sp, hw) = (spacing.abs().max(0.002) * em, (width.abs() * em * 0.5).max(1e-6));
            if n == 0 {
                return geo;
            }
            let (sp32, hw32, n32) = (sp as f32, hw as f32, n as f32);
            // Rings only need sampling fine enough for their own width, which
            // matters when they spread far beyond a small shape.
            let fine = Ctx { em, quality: em / ctx.cell().max(hw * 0.55) };
            Geo::poly_only(field_map(&geo.poly, &fine, sp * n as f64 + hw, false, move |_, v| {
                if v <= 0.0 {
                    return v;
                }
                let k = (v / sp32).round().clamp(1.0, n32);
                v.min((v - k * sp32).abs() - hw32)
            }))
        }
        Modifier::Repeat { mode, count, radius, sweep, orient, cols, rows, gap_x, gap_y, dx, dy, grow, spin } => {
            if bbox.is_empty() {
                return geo;
            }
            let c = bbox.center();
            let mut xf = Vec::new();
            match mode {
                RepeatMode::Radial => {
                    let n = (count.round() as usize).clamp(1, 120);
                    let r = radius * em;
                    let sw = sweep.clamp(-360.0, 360.0).to_radians();
                    // A full turn spaces copies evenly without doubling the first one.
                    let step = if (sw.abs() - std::f64::consts::TAU).abs() < 1e-6 || n == 1 { sw / n as f64 } else { sw / (n - 1) as f64 };
                    let start = if (sw.abs() - std::f64::consts::TAU).abs() < 1e-6 { 0.0 } else { -sw * 0.5 };
                    for k in 0..n {
                        let a = start + step * k as f64;
                        let spin = Affine::translate(c.x, c.y).then(Affine::rotate(a * orient.clamp(0.0, 1.0))).then(Affine::translate(-c.x, -c.y));
                        // Copy 0 sits at the top; the ring is centred on the original.
                        xf.push(Affine::translate(r * a.sin(), -r * a.cos()).then(spin));
                    }
                }
                RepeatMode::Trail => {
                    let n = (count.round() as usize).clamp(1, 120);
                    for k in 0..n {
                        let f = k as f64;
                        let s = grow.clamp(0.2, 3.0).powf(f);
                        let local = Affine::translate(c.x, c.y).then(Affine::rotate((spin * f).to_radians())).then(Affine::scale(s, s)).then(Affine::translate(-c.x, -c.y));
                        xf.push(Affine::translate(dx * em * f, dy * em * f).then(local));
                    }
                }
                RepeatMode::Grid => {
                    let (nc, nr) = ((cols.round() as usize).clamp(1, 60), (rows.round() as usize).clamp(1, 60));
                    let (sx, sy) = (bbox.width() + gap_x * em, bbox.height() + gap_y * em);
                    for j in 0..nr {
                        for i in 0..nc {
                            let dx = (i as f64 - (nc - 1) as f64 * 0.5) * sx;
                            let dy = (j as f64 - (nr - 1) as f64 * 0.5) * sy;
                            xf.push(Affine::translate(dx, dy));
                        }
                    }
                }
            }
            if xf.len() * geo.poly.contours.len() > 20000 {
                return geo;
            }
            let mut out = Geo { poly: Shape::default(), curves: geo.curves.as_ref().map(|_| Vec::new()) };
            for m in &xf {
                let mut g = geo.clone();
                g.transform(m);
                out.poly.contours.extend(g.poly.contours);
                if let (Some(dst), Some(src)) = (&mut out.curves, g.curves) {
                    dst.extend(src);
                }
            }
            out
        }
        Modifier::Fuse { amount } => {
            let r = amount.abs() * em * 0.5;
            if r < 1e-6 {
                return geo;
            }
            Geo::poly_only(offset(&offset(&geo.poly, r, ctx), -r, ctx))
        }
        Modifier::FitCircle { amount } => {
            let t = amount.clamp(0.0, 1.5);
            if t < 1e-4 || bbox.is_empty() {
                return geo;
            }
            let c = bbox.center();
            let (hw, hh) = (bbox.width().max(1e-9) * 0.5, bbox.height().max(1e-9) * 0.5);
            let s = densified(&geo.poly, fine * 0.75);
            Geo::poly_only(map_points(&s, |p| {
                // Elliptical grid mapping: the box's edges land on the ellipse.
                let u = ((p.x - c.x) / hw).clamp(-1.5, 1.5);
                let v = ((p.y - c.y) / hh).clamp(-1.5, 1.5);
                let mu = u * (1.0 - v * v * 0.5).max(0.0).sqrt();
                let mv = v * (1.0 - u * u * 0.5).max(0.0).sqrt();
                Pt { x: c.x + (u + (mu - u) * t) * hw, y: c.y + (v + (mv - v) * t) * hh }
            }))
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

#[inline]
fn cell_hash(i: i64, j: i64, seed: u32) -> f64 {
    let mut h = (i as u32).wrapping_mul(0x8da6_b343) ^ (j as u32).wrapping_mul(0xd816_3841) ^ seed.wrapping_mul(0xcb1a_b31f).wrapping_add(0x9e37_79b9);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297a_2d39);
    h ^= h >> 15;
    h as f64 / u32::MAX as f64
}

/// Randomly clear pixel cells, more of them toward the `angle` side of the box.
fn dissolve_cells(mask: &mut [u8], g: &Grid, bbox: Rect, amount: f64, angle: f64, seed: u32) {
    let a = angle.to_radians();
    let dir = Pt { x: a.sin(), y: -a.cos() };
    let c = bbox.center();
    let ext = (0.5 * (dir.x.abs() * bbox.width() + dir.y.abs() * bbox.height())).max(1e-9);
    // Hash by absolute cell index so neighbouring glyphs dissolve consistently.
    let (bi, bj) = ((g.origin.x / g.cell).round() as i64, (g.origin.y / g.cell).round() as i64);
    for j in 0..g.h {
        for i in 0..g.w {
            let k = j * g.w + i;
            if mask[k] == 0 {
                continue;
            }
            let p = Pt { x: g.origin.x + (i as f64 + 0.5) * g.cell, y: g.origin.y + (j as f64 + 0.5) * g.cell };
            let t = (((p.x - c.x) * dir.x + (p.y - c.y) * dir.y) / ext * 0.5 + 0.5).clamp(0.0, 1.0);
            let drop = ((t - (1.0 - amount)) / amount).clamp(0.0, 1.0);
            if cell_hash(bi + i as i64, bj + j as i64, seed) < drop {
                mask[k] = 0;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn slice(geo: Geo, ctx: &Ctx, count: f64, gap: f64, angle: f64, ring: f64, hole: f64, jitter: f64, seed: u32, shift: (f64, f64)) -> Geo {
    let bbox = geo.poly.bbox();
    let g = (gap.abs() * ctx.em * 0.5) as f32;
    let n = (count.round() as usize).clamp(0, 64);
    if bbox.is_empty() || (n == 0 && ring <= 0.0 && hole <= 0.0) {
        return geo;
    }
    let half = bbox.width().min(bbox.height()) * 0.5;
    let c = Pt { x: bbox.center().x + shift.0.clamp(-1.0, 1.0) * half, y: bbox.center().y + shift.1.clamp(-1.0, 1.0) * half };
    let rr = ring.clamp(0.0, 2.0) * half;
    let rh = hole.clamp(0.0, 2.0) * half;
    let r0 = rr.max(rh);
    let base = angle.to_radians() - std::f64::consts::FRAC_PI_2;
    let dirs: Vec<Pt> = (0..n)
        .map(|k| {
            let j = jitter.clamp(0.0, 1.0) * 0.45 * crate::noise::noise2(k as f64 * 1.73 + 0.3, 0.7, seed);
            let a = base + (k as f64 + j) / n as f64 * std::f64::consts::TAU;
            Pt { x: a.cos(), y: a.sin() }
        })
        .collect();
    Geo::poly_only(field_map(&geo.poly, ctx, g as f64, false, |p, v| {
        let q = Pt { x: p.x - c.x, y: p.y - c.y };
        let r = (q.x * q.x + q.y * q.y).sqrt();
        // Signed distance to the cut region (negative inside a cut).
        let mut cut = f64::INFINITY;
        for u in &dirs {
            let t = q.x * u.x + q.y * u.y;
            let d = if t >= r0 { (q.x * u.y - q.y * u.x).abs() } else { ((q.x - u.x * r0).powi(2) + (q.y - u.y * r0).powi(2)).sqrt() };
            cut = cut.min(d);
        }
        let mut cut = cut as f32 - g;
        if rr > 0.0 {
            cut = cut.min((r - rr).abs() as f32 - g);
        }
        if rh > 0.0 {
            cut = cut.min((r - rh) as f32);
        }
        v.max(-cut)
    }))
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
        let g = apply(Geo::poly_only(Shape::new(vec![circle])), &Modifier::Pixelate { size: 0.1, shape: PixelShape::Square, gap: 0.0, dissolve: 0.0, angle: 180.0, seed: 0 }, &CTX);
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
        let g = apply(Geo::poly_only(square(100.0)), &Modifier::Pixelate { size: 0.2, shape: PixelShape::Dot, gap: 0.1, dissolve: 0.0, angle: 180.0, seed: 0 }, &CTX);
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
    fn slice_cuts_pieces() {
        // Four cuts through a square leave four separate quarters.
        let g = apply(Geo::poly_only(square(100.0)), &Modifier::Slice { count: 4.0, gap: 0.06, angle: 0.0, ring: 0.0, hole: 0.0, jitter: 0.0, seed: 0, soften: 0.0, x: 0.0, y: 0.0 }, &CTX);
        assert_eq!(g.poly.contours.len(), 4, "{}", g.poly.contours.len());
        let lost = 10000.0 - g.poly.area();
        // Two 6-unit gaps across a 100-unit square, minus the overlap.
        assert!((lost - (2.0 * 6.0 * 100.0 - 36.0)).abs() < 60.0, "{lost}");
        // A ring and a hole: a central disc is removed and the rest split.
        let g = apply(Geo::poly_only(square(100.0)), &Modifier::Slice { count: 6.0, gap: 0.04, angle: 0.0, ring: 0.0, hole: 0.4, jitter: 0.0, seed: 0, soften: 0.03, x: 0.0, y: 0.0 }, &CTX);
        assert_eq!(g.poly.contours.len(), 6);
        assert!(g.poly.area() < 10000.0 - std::f64::consts::PI * 400.0);
    }

    #[test]
    fn repeat_radial_and_grid() {
        let mut g = Geo::poly_only(square(10.0));
        g.curves = Some(crate::geom::poly_to_curves(&g.poly));
        let r = apply(g.clone(), &Modifier::Repeat { mode: RepeatMode::Radial, count: 8.0, radius: 0.5, sweep: 360.0, orient: 1.0, cols: 1.0, rows: 1.0, gap_x: 0.0, gap_y: 0.0, dx: 0.0, dy: 0.0, grow: 1.0, spin: 0.0 }, &CTX);
        assert_eq!(r.poly.contours.len(), 8);
        assert!(r.curves.as_ref().map(|c| c.len()) == Some(8), "affine copies keep curves");
        // Centred on the original square's centre (5, 5).
        let c = r.poly.bbox().center();
        assert!((c.x - 5.0).abs() < 1e-6 && (c.y - 5.0).abs() < 1e-6, "{c:?}");
        let gr = apply(g, &Modifier::Repeat { mode: RepeatMode::Grid, count: 1.0, radius: 0.0, sweep: 360.0, orient: 0.0, cols: 3.0, rows: 2.0, gap_x: 0.1, gap_y: 0.0, dx: 0.0, dy: 0.0, grow: 1.0, spin: 0.0 }, &CTX);
        assert_eq!(gr.poly.contours.len(), 6);
        let b = gr.poly.bbox();
        assert!((b.width() - 50.0).abs() < 1e-6 && (b.height() - 20.0).abs() < 1e-6, "{b:?}");
    }

    #[test]
    fn trail_steps_and_echo_rings() {
        let t = apply(Geo::poly_only(square(10.0)), &Modifier::Repeat { mode: RepeatMode::Trail, count: 4.0, radius: 0.0, sweep: 360.0, orient: 0.0, cols: 1.0, rows: 1.0, gap_x: 0.0, gap_y: 0.0, dx: 0.1, dy: 0.0, grow: 1.0, spin: 0.0 }, &CTX);
        assert_eq!(t.poly.contours.len(), 4);
        assert!((t.poly.bbox().width() - 40.0).abs() < 1e-6);
        let e = apply(Geo::poly_only(square(100.0)), &Modifier::Echo { count: 3.0, spacing: 0.1, width: 0.02 }, &CTX);
        // The shape plus three rings, each an outer and inner contour.
        assert_eq!(e.poly.contours.len(), 7, "{}", e.poly.contours.len());
        assert!((e.poly.bbox().width() - 162.0).abs() < 3.0, "{:?}", e.poly.bbox());
    }

    #[test]
    fn fuse_bridges_gaps() {
        let two = Shape::new(vec![square(40.0).contours[0].clone(), square(40.0).transformed(&Affine::translate(46.0, 0.0)).contours[0].clone()]);
        let g = apply(Geo::poly_only(two), &Modifier::Fuse { amount: 0.1 }, &CTX);
        assert_eq!(g.poly.contours.len(), 1);
        assert!(g.poly.area() > 2.0 * 1600.0 + 200.0);
    }

    #[test]
    fn fit_circle_rounds_the_box() {
        let g = apply(Geo::poly_only(square(100.0)), &Modifier::FitCircle { amount: 1.0 }, &CTX);
        let circle = std::f64::consts::PI * 2500.0;
        assert!((g.poly.area() - circle).abs() / circle < 0.02, "{}", g.poly.area());
        let b = g.poly.bbox();
        assert!((b.width() - 100.0).abs() < 1.0);
    }

    #[test]
    fn dissolve_drops_cells_toward_the_bottom() {
        let full = apply(Geo::poly_only(square(100.0)), &Modifier::Pixelate { size: 0.05, shape: PixelShape::Square, gap: 0.1, dissolve: 0.0, angle: 180.0, seed: 1 }, &CTX);
        let g = apply(Geo::poly_only(square(100.0)), &Modifier::Pixelate { size: 0.05, shape: PixelShape::Square, gap: 0.1, dissolve: 0.6, angle: 180.0, seed: 1 }, &CTX);
        assert!(g.poly.contours.len() < full.poly.contours.len());
        let top = g.poly.contours.iter().filter(|c| c[0].y < 30.0).count();
        let bottom = g.poly.contours.iter().filter(|c| c[0].y > 70.0).count();
        assert!(top > bottom * 2, "top {top} bottom {bottom}");
    }

    #[test]
    fn full_circle_arc() {
        let wide = Shape::new(vec![vec![pt(0.0, 0.0), pt(600.0, 0.0), pt(600.0, 20.0), pt(0.0, 20.0)]]);
        let g = apply(Geo::poly_only(wide), &Modifier::Arc { bend: 2.0 }, &CTX);
        let b = g.poly.bbox();
        // 600 units around a full turn: radius ≈ 95, so roughly square,
        // and centred where the text was (y = 10).
        assert!((b.width() - b.height()).abs() < 10.0, "{b:?}");
        assert!((b.center().y - 10.0).abs() < 6.0, "{b:?}");
    }

    #[test]
    fn modifiers_deserialize_with_defaults() {
        let m: Vec<ModEntry> = serde_json::from_str(r#"[{"kind":"weight","amount":0.05},{"kind":"stretch","x":1.2,"on":false}]"#).unwrap();
        assert!(m[0].on);
        assert_eq!(m[1].m, Modifier::Stretch { x: 1.2, y: 1.0 });
        // Older projects' pixel modifiers have no dissolve fields.
        let p: Modifier = serde_json::from_str(r#"{"kind":"pixelate","size":0.1,"shape":"dot"}"#).unwrap();
        assert!(matches!(p, Modifier::Pixelate { dissolve, angle, .. } if dissolve == 0.0 && angle == 180.0));
        let r: Modifier = serde_json::from_str(r#"{"kind":"repeat","mode":"grid","cols":4,"gapX":0.1}"#).unwrap();
        assert!(matches!(r, Modifier::Repeat { mode: RepeatMode::Grid, gap_x, .. } if gap_x == 0.1));
    }
}
