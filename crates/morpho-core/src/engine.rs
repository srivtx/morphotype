//! The document engine: owns loaded fonts and caches, turns a document
//! description (JSON from the UI) into final geometry, and runs exports.

use crate::field::{extract, signed_distance, Grid};
use crate::fit::fit_shape;
use crate::font::{glyph_outline, shape_line, FontData, FontInfo};
use crate::geom::{flatten_curves, normalize_winding, poly_to_curves, Affine, CurveShape, Pt, Rect, Shape};
use crate::modifiers::{apply_all, Ctx, Geo, ModEntry, Modifier};
use crate::morph::Morph;
use crate::svg;
use crate::symbols::{self, Symbol};
use crate::trace::{trace, TraceOpts};
use crate::ttf::{write_ttf, FontMeta, OutGlyph};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap};
use std::hash::{Hash, Hasher};
use std::rc::Rc;

fn one() -> f64 {
    1.0
}
fn yes() -> bool {
    true
}
fn default_size() -> f64 {
    200.0
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Op {
    #[default]
    Add,
    Subtract,
    Intersect,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    Left,
    #[default]
    Center,
    Right,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMorph {
    pub font: String,
    #[serde(default)]
    pub t: f64,
    #[serde(default)]
    pub axes: BTreeMap<String, f32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Content {
    #[serde(rename_all = "camelCase")]
    Text {
        text: String,
        font: String,
        #[serde(default = "default_size")]
        size: f64,
        /// Extra letter spacing in em.
        #[serde(default)]
        tracking: f64,
        /// Baseline-to-baseline distance in em.
        #[serde(default = "one")]
        line_height: f64,
        #[serde(default)]
        align: Align,
        #[serde(default)]
        axes: BTreeMap<String, f32>,
        #[serde(default)]
        morph: Option<TextMorph>,
        #[serde(default = "yes")]
        ligatures: bool,
    },
    Symbol {
        symbol: Symbol,
        #[serde(default = "default_size")]
        size: f64,
    },
    /// Arbitrary outline (traced image or imported SVG) in em units.
    Path {
        d: String,
        #[serde(default = "default_size")]
        size: f64,
    },
    /// Morph between two other layers' shapes.
    Morph {
        a: String,
        b: String,
        #[serde(default)]
        t: f64,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub op: Op,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// Degrees, clockwise.
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "one")]
    pub scale: f64,
    #[serde(default)]
    pub modifiers: Vec<ModEntry>,
    pub content: Content,
}

impl Layer {
    fn transform(&self) -> Affine {
        Affine::translate(self.x, self.y)
            .then(Affine::rotate(self.rotation.to_radians()))
            .then(Affine::scale(self.scale, self.scale))
    }
    fn em(&self) -> f64 {
        match &self.content {
            Content::Text { size, .. } | Content::Symbol { size, .. } | Content::Path { size, .. } => size.abs().max(1.0),
            Content::Morph { .. } => 200.0,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(default)]
    pub layers: Vec<Layer>,
    /// Field samples per em (preview ≈ 120, export ≈ 400).
    #[serde(default)]
    pub quality: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerOut {
    pub id: String,
    pub bbox: Option<[f64; 4]>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOut {
    /// Final outline as SVG path data in document coordinates (nonzero fill).
    pub d: String,
    pub bbox: Option<[f64; 4]>,
    pub layers: Vec<LayerOut>,
    pub points: usize,
}

fn rect_arr(r: Rect) -> Option<[f64; 4]> {
    (!r.is_empty()).then_some([r.x0, r.y0, r.x1, r.y1])
}

/// Cached glyph in em units (1 em = 1.0).
struct GlyphGeo {
    curves: CurveShape,
    poly: Shape,
}

#[derive(Default)]
pub struct Engine {
    fonts: HashMap<String, FontData>,
    glyphs: HashMap<(String, u64, u16), Rc<GlyphGeo>>,
    morphs: HashMap<(String, u64, u16, String, u64, u16), Rc<Morph>>,
    layers: HashMap<u64, Rc<(Geo, f64)>>,
}

const PREVIEW_QUALITY: f64 = 120.0;
const EXPORT_QUALITY: f64 = 360.0;
const MORPH_SAMPLES: usize = 192;

fn hash_of<T: Hash + ?Sized>(v: &T) -> u64 {
    let mut h = DefaultHasher::new();
    v.hash(&mut h);
    h.finish()
}

fn axes_vec(a: &BTreeMap<String, f32>) -> Vec<(String, f32)> {
    a.iter().map(|(k, v)| (k.clone(), *v)).collect()
}

fn axes_key(a: &BTreeMap<String, f32>) -> u64 {
    hash_of(&a.iter().map(|(k, v)| (k.as_str(), v.to_bits())).collect::<Vec<_>>())
}

impl Engine {
    pub fn new() -> Engine {
        Engine::default()
    }

    pub fn load_font(&mut self, id: &str, bytes: &[u8], index: u32) -> Result<FontInfo, String> {
        let f = FontData::load(bytes, index).map_err(|e| e.0)?;
        let info = f.info.clone();
        self.unload_font(id);
        self.fonts.insert(id.to_string(), f);
        Ok(info)
    }

    pub fn unload_font(&mut self, id: &str) {
        self.fonts.remove(id);
        self.glyphs.retain(|k, _| k.0 != id);
        self.morphs.retain(|k, _| k.0 != id && k.3 != id);
        self.layers.clear();
    }

    pub fn has_font(&self, id: &str) -> bool {
        self.fonts.contains_key(id)
    }

    fn font(&self, id: &str) -> Result<&FontData, String> {
        self.fonts.get(id).ok_or_else(|| format!("Font \"{id}\" isn't loaded."))
    }

    fn glyph(&mut self, font: &str, axes: &BTreeMap<String, f32>, gid: u16) -> Result<Rc<GlyphGeo>, String> {
        let key = (font.to_string(), axes_key(axes), gid);
        if let Some(g) = self.glyphs.get(&key) {
            return Ok(g.clone());
        }
        let f = self.font(font)?;
        let face = f.face(&axes_vec(axes)).ok_or("The font couldn't be opened.")?;
        let upm = f.info.units_per_em.max(1) as f64;
        let mut curves = glyph_outline(&face, gid);
        let s = Affine::scale(1.0 / upm, 1.0 / upm);
        for c in &mut curves {
            c.transform(&s);
        }
        let mut poly = flatten_curves(&curves, 0.0006).cleaned(1e-10);
        normalize_winding(&mut poly);
        let g = Rc::new(GlyphGeo { curves, poly });
        if self.glyphs.len() > 20_000 {
            self.glyphs.clear();
        }
        self.glyphs.insert(key, g.clone());
        Ok(g)
    }

    fn glyph_morph(&mut self, fa: &str, aa: &BTreeMap<String, f32>, ga: u16, fb: &str, ab: &BTreeMap<String, f32>, gb: u16) -> Result<Rc<Morph>, String> {
        let key = (fa.to_string(), axes_key(aa), ga, fb.to_string(), axes_key(ab), gb);
        if let Some(m) = self.morphs.get(&key) {
            return Ok(m.clone());
        }
        let a = self.glyph(fa, aa, ga)?;
        let b = self.glyph(fb, ab, gb)?;
        let m = Rc::new(Morph::new(&a.poly, &b.poly, MORPH_SAMPLES));
        if self.morphs.len() > 4_000 {
            self.morphs.clear();
        }
        self.morphs.insert(key, m.clone());
        Ok(m)
    }

    /// Lay out text in em units. Returns per-glyph (geometry, pen x, pen y) and
    /// a flag telling whether exact curves survived (no morph).
    #[allow(clippy::too_many_arguments)]
    fn text_geo(
        &mut self,
        text: &str,
        font: &str,
        axes: &BTreeMap<String, f32>,
        tracking: f64,
        line_height: f64,
        align: Align,
        morph: Option<&TextMorph>,
        ligatures: bool,
    ) -> Result<Geo, String> {
        let info = self.font(font)?.info.clone();
        let upm_a = info.units_per_em.max(1) as f64;
        let morph = morph.filter(|m| m.t > 1e-6 && self.fonts.contains_key(&m.font));
        let upm_b = match morph {
            Some(m) => self.font(&m.font)?.info.units_per_em.max(1) as f64,
            None => upm_a,
        };
        let t = morph.map_or(0.0, |m| m.t.clamp(0.0, 1.0));
        let cap = info.cap_height as f64 / upm_a;
        let lines: Vec<&str> = text.split('\n').collect();
        let n_lines = lines.len().max(1);
        let lh = if line_height.is_finite() { line_height } else { 1.0 };
        // Centre the block vertically between the first cap line and the last baseline.
        let block_top = -cap;
        let block_bottom = (n_lines - 1) as f64 * lh;
        let y_shift = -(block_top + block_bottom) * 0.5;
        let mut poly = Shape::default();
        let mut curves: Option<CurveShape> = if morph.is_none() { Some(Vec::new()) } else { None };
        for (li, line) in lines.iter().enumerate() {
            let baseline = li as f64 * lh + y_shift;
            // (glyph a, glyph b, advance in em)
            let mut placed: Vec<(u16, u16, f64, f64, f64)> = Vec::new();
            {
                let fa = self.font(font)?;
                let face_a = fa.face(&axes_vec(axes)).ok_or("The font couldn't be opened.")?;
                let lig = ligatures && morph.is_none();
                let ga = shape_line(&face_a, line, lig);
                match morph {
                    None => {
                        for g in &ga {
                            placed.push((g.glyph, 0, g.x_advance as f64 / upm_a, g.x_offset as f64 / upm_a, g.y_offset as f64 / upm_a));
                        }
                    }
                    Some(m) => {
                        let fb = self.font(&m.font)?;
                        let face_b = fb.face(&axes_vec(&m.axes)).ok_or("The font couldn't be opened.")?;
                        let gb = shape_line(&face_b, line, false);
                        let aligned = ga.len() == gb.len() && ga.iter().zip(&gb).all(|(x, y)| x.cluster == y.cluster);
                        if aligned {
                            for (x, y) in ga.iter().zip(&gb) {
                                let adv = x.x_advance as f64 / upm_a * (1.0 - t) + y.x_advance as f64 / upm_b * t;
                                placed.push((x.glyph, y.glyph, adv, 0.0, 0.0));
                            }
                        } else {
                            // Fall back to one glyph per character via cmap.
                            for ch in line.chars() {
                                let a = face_a.glyph_index(ch).map_or(0, |g| g.0);
                                let b = face_b.glyph_index(ch).map_or(0, |g| g.0);
                                let aa = face_a.glyph_hor_advance(rustybuzz::ttf_parser::GlyphId(a)).unwrap_or(0) as f64 / upm_a;
                                let ab = face_b.glyph_hor_advance(rustybuzz::ttf_parser::GlyphId(b)).unwrap_or(0) as f64 / upm_b;
                                placed.push((a, b, aa * (1.0 - t) + ab * t, 0.0, 0.0));
                            }
                        }
                    }
                }
            }
            let n = placed.len();
            let width: f64 = placed.iter().map(|p| p.2).sum::<f64>() + tracking * n.saturating_sub(1) as f64;
            let mut pen = match align {
                Align::Left => 0.0,
                Align::Center => -width * 0.5,
                Align::Right => -width,
            };
            for (ga, gb, adv, xo, yo) in placed {
                let m = Affine::translate(pen + xo, baseline - yo);
                match morph {
                    None => {
                        let g = self.glyph(font, axes, ga)?;
                        poly.extend(g.poly.clone().transformed(&m));
                        if let Some(cs) = &mut curves {
                            for c in &g.curves {
                                let mut c = c.clone();
                                c.transform(&m);
                                cs.push(c);
                            }
                        }
                    }
                    Some(mo) => {
                        let mm = self.glyph_morph(font, axes, ga, &mo.font, &mo.axes, gb)?;
                        poly.extend(mm.at(t).transformed(&m));
                    }
                }
                pen += adv + tracking;
            }
        }
        Ok(Geo { poly, curves })
    }

    /// Local geometry of a layer (modifiers applied, transform not), cached.
    fn layer_local(&mut self, doc: &Document, layer: &Layer, quality: f64, depth: u32) -> Result<Rc<(Geo, f64)>, String> {
        if depth > 4 {
            return Err("Morph layers are nested too deeply.".into());
        }
        let mut key_src = serde_json::to_string(&(&layer.content, &layer.modifiers)).unwrap_or_default();
        key_src.push_str(&quality.to_bits().to_string());
        if let Content::Morph { a, b, .. } = &layer.content {
            // Depend on the referenced layers' full state.
            for id in [a, b] {
                if let Some(l) = doc.layers.iter().find(|l| &l.id == id) {
                    key_src.push_str(&serde_json::to_string(l).unwrap_or_default());
                }
            }
        }
        let key = hash_of(&key_src);
        if let Some(g) = self.layers.get(&key) {
            return Ok(g.clone());
        }
        let em = layer.em();
        let (geo, em) = match &layer.content {
            Content::Text { text, font, size, tracking, line_height, align, axes, morph, ligatures } => {
                let mut g = self.text_geo(text, font, axes, *tracking, *line_height, *align, morph.as_ref(), *ligatures)?;
                g.transform(&Affine::scale(*size, *size));
                (g, em)
            }
            Content::Symbol { symbol, size } => {
                let s = symbols::build(symbol).transformed(&Affine::scale(*size, *size));
                (Geo::poly_only(s), em)
            }
            Content::Path { d, size } => {
                let mut cs = svg::parse_path(d)?;
                let m = Affine::scale(*size, *size);
                for c in &mut cs {
                    c.transform(&m);
                }
                let mut poly = flatten_curves(&cs, size.abs().max(1.0) / 2000.0).cleaned(1e-9);
                normalize_winding(&mut poly);
                (Geo { poly, curves: None }, em)
            }
            Content::Morph { a, b, t } => {
                let find = |id: &str| doc.layers.iter().find(|l| l.id == id).cloned();
                let la = find(a).ok_or("Pick two layers to morph between.")?;
                let lb = find(b).ok_or("Pick two layers to morph between.")?;
                let ga = self.layer_local(doc, &la, quality, depth + 1)?;
                let gb = self.layer_local(doc, &lb, quality, depth + 1)?;
                let prep = |l: &Layer, g: &Geo| -> Shape {
                    let s = g.poly.clone().transformed(&Affine::rotate(l.rotation.to_radians()).then(Affine::scale(l.scale, l.scale)));
                    let c = s.bbox().center();
                    s.transformed(&Affine::translate(-c.x, -c.y))
                };
                let sa = prep(&la, &ga.0);
                let sb = prep(&lb, &gb.0);
                let m = Morph::new(&sa, &sb, MORPH_SAMPLES);
                let em = ga.1 * (1.0 - t) + gb.1 * t;
                (Geo::poly_only(m.at(*t)), em)
            }
        };
        let geo = apply_all(geo, &layer.modifiers, &Ctx { em, quality });
        let out = Rc::new((geo, em));
        if self.layers.len() > 256 {
            self.layers.clear();
        }
        self.layers.insert(key, out.clone());
        Ok(out)
    }

    /// Build the whole document. Returns final geometry plus per-layer info.
    pub fn build_geo(&mut self, doc: &Document) -> (Geo, Vec<LayerOut>, f64) {
        let quality = doc.quality.unwrap_or(PREVIEW_QUALITY).clamp(24.0, 1024.0);
        let mut acc = Geo { poly: Shape::default(), curves: Some(Vec::new()) };
        let mut min_em = f64::INFINITY;
        let mut outs = Vec::new();
        for layer in &doc.layers {
            if !layer.visible {
                outs.push(LayerOut { id: layer.id.clone(), bbox: None, error: None });
                continue;
            }
            let local = match self.layer_local(doc, layer, quality, 0) {
                Ok(g) => g,
                Err(e) => {
                    outs.push(LayerOut { id: layer.id.clone(), bbox: None, error: Some(e) });
                    continue;
                }
            };
            let mut g = local.0.clone();
            g.transform(&layer.transform());
            let em = local.1 * layer.scale.abs().max(1e-3);
            min_em = min_em.min(em);
            outs.push(LayerOut { id: layer.id.clone(), bbox: rect_arr(g.poly.bbox()), error: None });
            match layer.op {
                Op::Add => {
                    acc.poly.extend(g.poly);
                    match (&mut acc.curves, g.curves) {
                        (Some(a), Some(b)) => a.extend(b),
                        _ => acc.curves = None,
                    }
                }
                Op::Subtract | Op::Intersect => {
                    let cell = em.min(min_em) / quality;
                    acc.poly = boolean(&acc.poly, &g.poly, layer.op, cell);
                    acc.curves = None;
                }
            }
        }
        (acc, outs, if min_em.is_finite() { min_em } else { 200.0 })
    }

    pub fn build(&mut self, doc: &Document) -> BuildOut {
        let (geo, layers, _) = self.build_geo(doc);
        BuildOut { d: svg::poly_d(&geo.poly, 2), bbox: rect_arr(geo.poly.bbox()), layers, points: geo.poly.point_count() }
    }

    /// Final document as fitted curves (exact where possible).
    pub fn build_curves(&mut self, doc: &Document) -> (CurveShape, Rect) {
        let mut doc = doc.clone();
        doc.quality = Some(doc.quality.unwrap_or(EXPORT_QUALITY).max(EXPORT_QUALITY));
        let (geo, _, em) = self.build_geo(&doc);
        let bbox = geo.poly.bbox();
        let curves = match geo.curves {
            Some(c) => c,
            None => fit_shape(&geo.poly, em / 1500.0, 50.0),
        };
        (curves, bbox)
    }

    pub fn export_svg(&mut self, doc: &Document, opts: &SvgOpts) -> String {
        let (curves, bbox) = self.build_curves(doc);
        let d = svg::curves_d(&curves, 2);
        let pad = if bbox.is_empty() { 0.0 } else { bbox.width().max(bbox.height()) * opts.padding.clamp(0.0, 1.0) };
        svg::document(&d, bbox, pad, opts.fill.as_deref().unwrap_or("#000"), opts.background.as_deref())
    }

    /// Trace an image to a path normalised to a 1-em box centred on the origin.
    pub fn trace_image(&mut self, rgba: &[u8], w: usize, h: usize, opts: &TraceOpts) -> Result<TraceOut, String> {
        let shape = trace(rgba, w, h, opts)?;
        if shape.is_empty() {
            return Err("Nothing to trace. Try a different threshold or invert.".into());
        }
        let b = shape.bbox();
        let s = 1.0 / b.width().max(b.height()).max(1e-9);
        let c = b.center();
        let norm = shape.transformed(&Affine::scale(s, s).then(Affine::translate(-c.x, -c.y)));
        let tol = if opts.pixel { 1e-5 } else { 0.0012 };
        let curves = if opts.pixel { poly_to_curves(&norm) } else { fit_shape(&norm, tol, 55.0) };
        Ok(TraceOut {
            d: svg::curves_d(&curves, 4),
            contours: norm.contours.len(),
            aspect: b.width() / b.height().max(1e-9),
        })
    }

    pub fn export_font(&mut self, spec: &FontSpec) -> Result<Vec<u8>, String> {
        let fa = self.font(&spec.font)?;
        let info_a = fa.info.clone();
        let upm = info_a.units_per_em.max(16) as f64;
        let morph = spec.morph.as_ref().filter(|m| m.t > 1e-6);
        let info_b = match morph {
            Some(m) => Some(self.font(&m.font)?.info.clone()),
            None => None,
        };
        let t = morph.map_or(0.0, |m| m.t.clamp(0.0, 1.0));
        let lerp_metric = |a: i16, ua: f64, b: Option<(i16, f64)>| -> i16 {
            let va = a as f64 / ua;
            let v = match b {
                Some((b, ub)) => va * (1.0 - t) + (b as f64 / ub) * t,
                None => va,
            };
            (v * upm).round() as i16
        };
        let ib = info_b.as_ref().map(|i| i.units_per_em.max(1) as f64);
        let metric = |fa: fn(&FontInfo) -> i16| lerp_metric(fa(&info_a), info_a.units_per_em as f64, info_b.as_ref().map(|b| (fa(b), ib.unwrap_or(1.0))));
        let charset: Vec<char> = match &spec.charset {
            Some(s) if !s.trim().is_empty() => {
                let mut v: Vec<char> = s.chars().filter(|c| !c.is_control()).collect();
                v.push(' ');
                v.sort();
                v.dedup();
                v
            }
            _ => default_charset(),
        };
        let mods: Vec<ModEntry> = spec.modifiers.iter().filter(|m| m.on).cloned().collect();
        let ctx = Ctx { em: upm, quality: spec.quality.unwrap_or(EXPORT_QUALITY).clamp(60.0, 1024.0) };
        // Advance and side-bearing changes implied by the modifier stack.
        let mut adv_scale = 1.0;
        let mut adv_extra = 0.0;
        let mut shift = 0.0;
        let mut slant = 0.0;
        for m in &mods {
            match m.m {
                Modifier::Weight { amount } => {
                    adv_extra += 2.0 * amount * upm;
                    shift += amount * upm;
                }
                Modifier::Outline { width } => {
                    adv_extra += width.abs() * upm;
                    shift += width.abs() * upm * 0.5;
                }
                Modifier::Stretch { x, .. } => adv_scale *= x.clamp(0.05, 20.0),
                Modifier::Slant { angle } => slant += angle,
                _ => {}
            }
        }
        let mut out = Vec::new();
        for ch in charset {
            let (ga, adv_a) = {
                let f = self.font(&spec.font)?;
                let face = f.face(&axes_vec(&spec.axes)).ok_or("The font couldn't be opened.")?;
                let Some(g) = face.glyph_index(ch) else { continue };
                (g.0, face.glyph_hor_advance(g).unwrap_or(0) as f64 / upm)
            };
            let (poly, curves, adv) = match morph {
                None => {
                    let g = self.glyph(&spec.font, &spec.axes, ga)?;
                    (g.poly.clone(), Some(g.curves.clone()), adv_a)
                }
                Some(m) => {
                    let (gb, adv_b) = {
                        let f = self.font(&m.font)?;
                        let face = f.face(&axes_vec(&m.axes)).ok_or("The font couldn't be opened.")?;
                        let ub = f.info.units_per_em.max(1) as f64;
                        match face.glyph_index(ch) {
                            Some(g) => (g.0, face.glyph_hor_advance(g).unwrap_or(0) as f64 / ub),
                            None => (0, adv_a),
                        }
                    };
                    let mm = self.glyph_morph(&spec.font, &spec.axes, ga, &m.font, &m.axes, gb)?;
                    (mm.at(t), None, adv_a * (1.0 - t) + adv_b * t)
                }
            };
            let em_to_units = Affine::scale(upm, upm);
            let mut geo = Geo {
                poly: poly.transformed(&em_to_units),
                curves: curves.map(|mut cs| {
                    for c in &mut cs {
                        c.transform(&em_to_units);
                    }
                    cs
                }),
            };
            geo = apply_all(geo, &mods, &ctx);
            geo.transform(&Affine::translate(shift, 0.0));
            let contours = match geo.curves {
                Some(c) => c,
                None => fit_shape(&geo.poly, upm / 1600.0, 50.0),
            };
            out.push(OutGlyph { codepoint: Some(ch as u32), advance: adv * upm * adv_scale + adv_extra, contours });
        }
        if out.iter().all(|g| g.contours.is_empty()) {
            return Err("None of the requested characters exist in this font.".into());
        }
        let family = clean_name(&spec.family, "Morphotype");
        let style = clean_name(&spec.style, "Regular");
        let weight = spec.weight_class.unwrap_or_else(|| {
            let w = mods.iter().fold(400.0, |acc, m| match m.m {
                Modifier::Weight { amount } => acc + amount * 4000.0,
                _ => acc,
            });
            (w / 100.0).round().clamp(1.0, 9.0) as u16 * 100
        });
        let meta = FontMeta {
            family,
            style,
            version: "1.000".into(),
            units_per_em: upm as u16,
            ascender: metric(|i| i.ascender),
            descender: metric(|i| i.descender),
            line_gap: metric(|i| i.line_gap),
            cap_height: metric(|i| i.cap_height),
            x_height: metric(|i| i.x_height),
            weight_class: weight,
            italic_angle: -slant,
            copyright: spec.copyright.clone().unwrap_or_else(|| format!("Derived from {} with Morphotype", info_a.full_name)),
        };
        Ok(write_ttf(&meta, &out))
    }
}

fn clean_name(s: &str, fallback: &str) -> String {
    let t: String = s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(48).collect();
    if t.is_empty() { fallback.to_string() } else { t }
}

pub fn default_charset() -> Vec<char> {
    let mut v: Vec<char> = (0x20u8..0x7f).map(|b| b as char).collect();
    v.extend("¡¢£¥©®°±´·¿×÷ÀÁÂÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÖØÙÚÛÜßàáâäåæçèéêëìíîïñòóôöøùúûüÿ–—‘’“”•…€™".chars());
    v
}

/// Boolean of two nonzero shapes via signed distance fields on a shared grid.
fn boolean(a: &Shape, b: &Shape, op: Op, cell: f64) -> Shape {
    let bounds = match op {
        Op::Intersect => {
            let (ra, rb) = (a.bbox(), b.bbox());
            Rect { x0: ra.x0.max(rb.x0), y0: ra.y0.max(rb.y0), x1: ra.x1.min(rb.x1), y1: ra.y1.min(rb.y1) }
        }
        _ => a.bbox(),
    };
    if bounds.is_empty() {
        return Shape::default();
    }
    let band = cell * 3.0;
    let g = Grid::covering(bounds, band, cell.max(1e-6));
    let fa = signed_distance(a, &g, band);
    let fb = signed_distance(b, &g, band);
    let v: Vec<f32> = match op {
        Op::Subtract => fa.iter().zip(&fb).map(|(x, y)| x.max(-y)).collect(),
        Op::Intersect => fa.iter().zip(&fb).map(|(x, y)| x.max(*y)).collect(),
        Op::Add => fa.iter().zip(&fb).map(|(x, y)| x.min(*y)).collect(),
    };
    extract(&v, &g, 0.0, g.cell * 0.15, g.cell * g.cell * 1.5)
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SvgOpts {
    pub fill: Option<String>,
    pub background: Option<String>,
    /// Padding as a fraction of the larger side.
    pub padding: f64,
}

#[derive(Debug, Serialize)]
pub struct TraceOut {
    pub d: String,
    pub contours: usize,
    pub aspect: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontSpec {
    pub font: String,
    #[serde(default)]
    pub axes: BTreeMap<String, f32>,
    #[serde(default)]
    pub morph: Option<TextMorph>,
    #[serde(default)]
    pub modifiers: Vec<ModEntry>,
    pub family: String,
    #[serde(default)]
    pub style: String,
    #[serde(default)]
    pub charset: Option<String>,
    #[serde(default)]
    pub weight_class: Option<u16>,
    #[serde(default)]
    pub quality: Option<f64>,
    #[serde(default)]
    pub copyright: Option<String>,
}

/// Convenience used by tests and the CLI: centre of a shape's bbox.
pub fn centre(s: &Shape) -> Pt {
    s.bbox().center()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::tests::test_font;

    fn engine() -> Engine {
        let mut e = Engine::new();
        e.load_font("archivo", &test_font(), 0).unwrap();
        let pf = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../ui/public/fonts/PlayfairDisplay-Black.woff")).unwrap();
        e.load_font("playfair", &pf, 0).unwrap();
        e
    }

    fn doc(json: &str) -> Document {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn builds_text_centred() {
        let mut e = engine();
        let out = e.build(&doc(r#"{"layers":[{"id":"t","content":{"type":"text","text":"MORPH","font":"archivo","size":100}}]}"#));
        let b = out.bbox.unwrap();
        assert!(!out.d.is_empty());
        assert!((b[0] + b[2]).abs() < 10.0, "horizontally centred: {b:?}");
        assert!(b[2] - b[0] > 300.0);
        assert!(out.layers[0].error.is_none());
    }

    #[test]
    fn morph_between_fonts_and_modifiers() {
        let mut e = engine();
        let d = doc(
            r#"{"layers":[{"id":"t","modifiers":[{"kind":"weight","amount":0.03},{"kind":"slant","angle":10}],
            "content":{"type":"text","text":"Ag","font":"archivo","size":100,"morph":{"font":"playfair","t":0.5}}}]}"#,
        );
        let out = e.build(&d);
        assert!(out.points > 50);
        assert!(out.layers[0].error.is_none(), "{:?}", out.layers[0].error);
    }

    #[test]
    fn missing_font_reports_error() {
        let mut e = engine();
        let out = e.build(&doc(r#"{"layers":[{"id":"t","content":{"type":"text","text":"A","font":"nope"}}]}"#));
        assert!(out.layers[0].error.as_deref().unwrap().contains("nope"));
    }

    #[test]
    fn subtract_cuts_holes() {
        let mut e = engine();
        let d = doc(
            r#"{"layers":[
              {"id":"a","content":{"type":"symbol","symbol":{"kind":"circle"},"size":100}},
              {"id":"b","op":"subtract","content":{"type":"symbol","symbol":{"kind":"circle"},"size":50}}]}"#,
        );
        let (geo, _, _) = e.build_geo(&d);
        let expect = std::f64::consts::PI * (2500.0 - 625.0);
        assert!((geo.poly.area() - expect).abs() / expect < 0.02, "{}", geo.poly.area());
    }

    #[test]
    fn morph_layer_between_text_and_symbol() {
        let mut e = engine();
        let d = doc(
            r#"{"layers":[
              {"id":"a","visible":false,"content":{"type":"text","text":"O","font":"archivo","size":100}},
              {"id":"b","visible":false,"content":{"type":"symbol","symbol":{"kind":"star"},"size":100}},
              {"id":"m","content":{"type":"morph","a":"a","b":"b","t":0.5}}]}"#,
        );
        let out = e.build(&d);
        assert!(out.layers[2].bbox.is_some(), "{:?}", out.layers[2].error);
    }

    #[test]
    fn exports_svg_with_exact_curves() {
        let mut e = engine();
        let svg = e.export_svg(&doc(r#"{"layers":[{"id":"t","content":{"type":"text","text":"S","font":"archivo","size":100}}]}"#), &SvgOpts::default());
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains('Q') || svg.contains('C'));
    }

    #[test]
    fn exports_a_working_font() {
        let mut e = engine();
        let spec: FontSpec = serde_json::from_str(
            r#"{"font":"archivo","family":"Archivo Morph","style":"Melted","charset":"ABCabc123",
            "morph":{"font":"playfair","t":0.35},"modifiers":[{"kind":"round","radius":0.02},{"kind":"slant","angle":8}]}"#,
        )
        .unwrap();
        let bytes = e.export_font(&spec).unwrap();
        let face = rustybuzz::ttf_parser::Face::parse(&bytes, 0).unwrap();
        for ch in "ABCabc123 ".chars() {
            assert!(face.glyph_index(ch).is_some(), "{ch}");
        }
        let a = face.glyph_index('A').unwrap();
        assert!(face.glyph_bounding_box(a).is_some());
        assert!(face.is_italic());
    }

    #[test]
    fn traces_image_to_path_layer() {
        let mut e = engine();
        let n = 64;
        let mut img = vec![255u8; n * n * 4];
        for j in 16..48 {
            for i in 8..56 {
                let k = (j * n + i) * 4;
                img[k] = 0;
                img[k + 1] = 0;
                img[k + 2] = 0;
            }
        }
        let t = e.trace_image(&img, n, n, &TraceOpts::default()).unwrap();
        assert!((t.aspect - 1.5).abs() < 0.1);
        let out = e.build(&doc(&format!(r#"{{"layers":[{{"id":"p","content":{{"type":"path","d":"{}","size":100}}}}]}}"#, t.d)));
        let b = out.bbox.unwrap();
        assert!((b[2] - b[0] - 100.0).abs() < 3.0, "{b:?}");
    }
}
