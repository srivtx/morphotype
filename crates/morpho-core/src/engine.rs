//! The document engine: owns loaded fonts and caches, turns a document
//! description (JSON from the UI) into final geometry, and runs exports.

use crate::field::{extract, signed_distance, Grid};
use crate::fit::fit_shape;
use crate::font::{glyph_outline, pair_kerning, shape_line, FontData, FontInfo};
use crate::geom::{flatten_curves, normalize_winding, poly_to_curves, Affine, CurveShape, Pt, Rect, Shape};
use crate::modifiers::{apply, apply_all, apply_all_frames, Ctx, Geo, ModEntry, Modifier};
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
fn default_brush() -> f64 {
    8.0
}
fn default_line() -> f64 {
    12.0
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
    /// Pen line: path data in em units (`size` px per unit), open subpaths
    /// stroked `width` px wide with `cap` ends; closed ones stroke as loops.
    Line {
        d: String,
        #[serde(default = "default_size")]
        size: f64,
        #[serde(default = "default_line")]
        width: f64,
        #[serde(default)]
        cap: crate::stroke::LineCap,
        /// Zigzag, wave, meander, coil or scallop along the centre line.
        #[serde(default)]
        squiggle: Option<crate::along::Squiggle>,
        /// Dashes or dots along the (squiggled) line.
        #[serde(default)]
        dash: Option<crate::along::Dash>,
    },
    /// Freehand brush stroke: points `[x, y, pressure]` in layer pixels.
    Stroke {
        points: Vec<[f64; 3]>,
        #[serde(default = "default_brush")]
        width: f64,
        #[serde(default)]
        taper: f64,
        #[serde(default)]
        smooth: f64,
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
    /// Extra horizontal / vertical stretch in the layer's own frame.
    #[serde(default = "one")]
    pub sx: f64,
    #[serde(default = "one")]
    pub sy: f64,
    #[serde(default)]
    pub modifiers: Vec<ModEntry>,
    pub content: Content,
}

impl Layer {
    pub fn transform(&self) -> Affine {
        Affine::translate(self.x, self.y)
            .then(Affine::rotate(self.rotation.to_radians()))
            .then(Affine::scale(self.scale * self.sx, self.scale * self.sy))
    }
    fn scale_em(&self) -> f64 {
        (self.scale * self.sx.abs().min(self.sy.abs())).abs().max(1e-3)
    }
    fn em(&self) -> f64 {
        match &self.content {
            Content::Text { size, .. } | Content::Symbol { size, .. } | Content::Path { size, .. } | Content::Line { size, .. } => size.abs().max(1.0),
            Content::Morph { .. } => 200.0,
            // Modifiers on a stroke scale with the drawing's size.
            Content::Stroke { points, width, .. } => {
                let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
                for p in points {
                    (x0, y0, x1, y1) = (x0.min(p[0]), y0.min(p[1]), x1.max(p[0]), y1.max(p[1]));
                }
                ((x1 - x0).max(y1 - y0).max(0.0) + width.abs()).max(10.0)
            }
        }
    }
}

/// A layer in a render, optionally with its blend op overridden (a group
/// used as a cutter passes its children in with the group's op).
#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum Member {
    Id(String),
    With { id: String, op: Op },
}

impl Member {
    fn id(&self) -> &str {
        match self {
            Member::Id(id) | Member::With { id, .. } => id,
        }
    }
}

/// One rendered object: its member layers combine with their blend ops
/// (bottom to top), then the render's own modifiers run on the result.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpec {
    pub id: String,
    pub members: Vec<Member>,
    #[serde(default)]
    pub modifiers: Vec<ModEntry>,
    /// Em for the render's modifiers; defaults to the first member's.
    #[serde(default)]
    pub em: Option<f64>,
    /// Say which letter and word each outline belongs to (text moving letter by letter).
    #[serde(default)]
    pub letters: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    /// Every layer (hidden ones too, so morphs can reference them).
    #[serde(default)]
    pub layers: Vec<Layer>,
    /// Objects to produce. Without it, all visible layers form one object.
    #[serde(default)]
    pub renders: Option<Vec<RenderSpec>>,
    /// Field samples per em (preview ≈ 120, export ≈ 400).
    #[serde(default)]
    pub quality: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameOut {
    pub uid: String,
    pub bbox: [f64; 4],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerOut {
    pub id: String,
    pub bbox: Option<[f64; 4]>,
    pub error: Option<String>,
    /// The layer's own outline in document coordinates (for hit testing).
    pub d: Option<String>,
    /// Bounding box in the layer's local frame (before its transform).
    pub local: Option<[f64; 4]>,
    /// Boxes warped by the layer's warp modifiers, in the local frame.
    pub frames: Vec<FrameOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderOut {
    pub id: String,
    pub d: String,
    pub bbox: Option<[f64; 4]>,
    pub points: usize,
    /// For a single pen line: its centre line as `[x, y, t, joined]` per point,
    /// `t` the distance along the whole line (0…1) and `joined` 1 where a
    /// segment runs from the previous point. Lets materials colour along it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spine: Option<Vec<f32>>,
    /// Asked for with [`RenderSpec::letters`]: for each subpath of `d`, the
    /// letter it belongs to (letters numbered in reading order)…
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyphs: Option<Vec<u32>>,
    /// …and each letter's word.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<u32>>,
}

/// A shape's separate pieces, as contour indices: each solid contour with its
/// holes, and small pieces sitting above or below a larger one in the same
/// column (the dot of an i, accents) with it.
fn piece_groups(poly: &Shape) -> Vec<Vec<usize>> {
    let n = poly.contours.len();
    let areas: Vec<f64> = poly.contours.iter().map(|c| crate::geom::signed_area(c)).collect();
    // Each hole belongs to the smallest solid that contains it.
    let mut owner: Vec<usize> = (0..n).collect();
    for i in 0..n {
        if areas[i] >= 0.0 {
            continue;
        }
        let p = crate::geom::interior_point(&poly.contours[i]);
        let probe = poly.contours[i].first().copied().unwrap_or(p);
        let mut best: Option<usize> = None;
        for j in 0..n {
            if areas[j] <= 0.0 || crate::geom::winding(&poly.contours[j], probe) == 0 {
                continue;
            }
            if best.is_none_or(|b| areas[j] < areas[b]) {
                best = Some(j);
            }
        }
        if let Some(b) = best {
            owner[i] = b;
        }
    }
    let solids: Vec<usize> = (0..n).filter(|&i| areas[i] > 0.0).collect();
    // Union-find over solids for the dot-of-an-i rule.
    let mut parent: HashMap<usize, usize> = solids.iter().map(|&i| (i, i)).collect();
    fn find(p: &mut HashMap<usize, usize>, i: usize) -> usize {
        let q = p[&i];
        if q == i {
            return i;
        }
        let r = find(p, q);
        p.insert(i, r);
        r
    }
    let boxes: HashMap<usize, Rect> = solids.iter().map(|&i| (i, crate::geom::Shape::new(vec![poly.contours[i].clone()]).bbox())).collect();
    for (a_i, &a) in solids.iter().enumerate() {
        for &b in &solids[a_i + 1..] {
            let (ra, rb) = (boxes[&a], boxes[&b]);
            let (small, big, sa, sb) = if areas[a] < areas[b] { (ra, rb, areas[a], areas[b]) } else { (rb, ra, areas[b], areas[a]) };
            // Dots and accents are much shorter than their letter.
            if sa > sb * 0.6 || small.height() > big.height() * 0.5 {
                continue;
            }
            let overlap = small.x1.min(big.x1) - small.x0.max(big.x0);
            let gap = (small.y0 - big.y1).max(big.y0 - small.y1);
            if overlap > small.width() * 0.5 && gap < big.height() * 0.5 {
                let (x, y) = (find(&mut parent, a), find(&mut parent, b));
                parent.insert(x, y);
            }
        }
    }
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..n {
        let solid = if areas[i] > 0.0 { i } else { owner[i] };
        if areas[solid] <= 0.0 {
            continue;
        }
        let root = find(&mut parent, solid);
        groups.entry(root).or_default().push(i);
    }
    groups.into_values().collect()
}

/// Modifiers that move points but keep every contour, in order: a text's
/// glyphs can still be told apart after them.
fn moves_points_only(m: &Modifier) -> bool {
    matches!(
        m,
        Modifier::Slant { .. }
            | Modifier::Stretch { .. }
            | Modifier::Wave { .. }
            | Modifier::Arc { .. }
            | Modifier::Wobble { .. }
            | Modifier::Melt { .. }
            | Modifier::Perspective { .. }
            | Modifier::Isometric { .. }
            | Modifier::FitCircle { .. }
            | Modifier::Warp { .. }
    )
}

/// Which letter each drawn contour of `poly` belongs to (contours `poly_d`
/// skips are skipped here too), and each letter's word. With the text's own
/// glyph tags that's exact; otherwise letters are its pieces by shape, in
/// reading order, and a gap wider than a fifth of `em` starts a new word.
fn letter_parts(poly: &Shape, tags: Option<&[(usize, u32)]>, em: f64) -> (Vec<u32>, Vec<u32>) {
    let n = poly.contours.len();
    // Letter (and its word) of every contour, before renumbering.
    let mut of = vec![(0usize, 0u32); n];
    match tags {
        Some(tags) => {
            let mut at = 0;
            for (g, &(count, word)) in tags.iter().enumerate() {
                for c in of.iter_mut().skip(at).take(count) {
                    *c = (g, word);
                }
                at += count;
            }
        }
        None => {
            let groups = piece_groups(poly);
            let boxes: Vec<Rect> = groups.iter().map(|g| Shape::new(g.iter().map(|&i| poly.contours[i].clone()).collect()).bbox()).collect();
            let row = (em * 0.5).max(1e-6);
            let mut order: Vec<usize> = (0..groups.len()).collect();
            order.sort_by(|&a, &b| {
                let (ca, cb) = (boxes[a].center(), boxes[b].center());
                (ca.y / row).round().total_cmp(&(cb.y / row).round()).then(ca.x.total_cmp(&cb.x))
            });
            let mut word = 0u32;
            let mut word_of = Vec::with_capacity(order.len());
            let mut placed = vec![false; n];
            for (k, &g) in order.iter().enumerate() {
                if k > 0 {
                    let (p, q) = (boxes[order[k - 1]], boxes[g]);
                    let new_row = (p.center().y / row).round() != (q.center().y / row).round();
                    if new_row || q.x0 - p.x1 > em * 0.2 {
                        word += 1;
                    }
                }
                word_of.push(word);
                for &i in &groups[g] {
                    of[i] = (k, word);
                    placed[i] = true;
                }
            }
            // A contour in no piece (a stray hole) joins the nearest one.
            for i in (0..n).filter(|&i| !placed[i]) {
                let c = Shape::new(vec![poly.contours[i].clone()]).bbox().center();
                let near = (0..order.len()).min_by(|&a, &b| boxes[order[a]].center().dist(c).total_cmp(&boxes[order[b]].center().dist(c)));
                if let Some(k) = near {
                    of[i] = (k, word_of[k]);
                }
            }
        }
    }
    // Number the letters that draw something, and their words, from 0.
    let drawn: Vec<usize> = (0..n).filter(|&i| poly.contours[i].len() >= 3).collect();
    let mut letters: Vec<usize> = drawn.iter().map(|&i| of[i].0).collect();
    letters.sort_unstable();
    letters.dedup();
    let glyphs = drawn.iter().map(|&i| letters.binary_search(&of[i].0).unwrap_or(0) as u32).collect();
    let word_of: HashMap<usize, u32> = drawn.iter().map(|&i| of[i]).collect();
    let mut word_ids: HashMap<u32, u32> = HashMap::new();
    let words = letters
        .iter()
        .map(|g| {
            let next = word_ids.len() as u32;
            *word_ids.entry(word_of[g]).or_insert(next)
        })
        .collect();
    (glyphs, words)
}

/// Flatten centre lines into `[x, y, t, joined]` quads, at most ~384 points.
fn spine_out(lines: &[Vec<Pt>]) -> Vec<f32> {
    let total: f64 = lines.iter().map(|l| l.windows(2).map(|w| w[0].dist(w[1])).sum::<f64>()).sum::<f64>().max(1e-9);
    let n: usize = lines.iter().map(|l| l.len()).sum();
    let stride = n.div_ceil(384).max(1);
    let mut out = Vec::new();
    let mut acc = 0.0;
    for l in lines {
        let mut prev: Option<Pt> = None;
        for (i, &p) in l.iter().enumerate() {
            if let Some(q) = prev {
                acc += q.dist(p);
            }
            let keep = i % stride == 0 || i + 1 == l.len();
            if keep {
                out.extend_from_slice(&[p.x as f32, p.y as f32, (acc / total) as f32, if i == 0 { 0.0 } else { 1.0 }]);
            }
            prev = Some(p);
        }
    }
    out
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOut {
    pub renders: Vec<RenderOut>,
    pub bbox: Option<[f64; 4]>,
    pub layers: Vec<LayerOut>,
    pub points: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathOut {
    pub id: String,
    pub d: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsOut {
    pub paths: Vec<PathOut>,
    pub bbox: Option<[f64; 4]>,
}

/// A layer converted to a plain outline: `d` is in units of `size`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BakeOut {
    pub d: String,
    pub size: f64,
}

/// One piece of a broken-apart layer, positioned in document coordinates.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PieceOut {
    pub d: String,
    pub size: f64,
    pub x: f64,
    pub y: f64,
}

/// A glyph from a font in em units (y-down, baseline at 0, pen at 0).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphOut {
    pub d: String,
    pub advance: f64,
    pub exists: bool,
}

/// Preview of one glyph of a font spec: outline in em units (y-down).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphPreview {
    pub ch: String,
    pub d: String,
    pub advance: f64,
    pub edited: bool,
}

/// A positioned glyph from text layout, in em units.
struct PlacedGlyph {
    a: u16,
    b: u16,
    pen: f64,
    xo: f64,
    yo: f64,
    /// Byte offset of the glyph's cluster within its line.
    cluster: usize,
}

struct LineLayout {
    baseline: f64,
    text: String,
    glyphs: Vec<PlacedGlyph>,
    x0: f64,
    width: f64,
}

/// One line of caret positions for on-canvas text editing.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaretLine {
    /// UTF-16 offset of the line's first character in the whole text.
    pub start: usize,
    pub baseline: f64,
    /// x before each UTF-16 unit of the line, plus the end of the line.
    pub carets: Vec<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayout {
    pub lines: Vec<CaretLine>,
    pub ascent: f64,
    pub descent: f64,
    pub cap: f64,
}

/// Centre lines of single-line renders, by render id.
type Spines = HashMap<String, Vec<Vec<Pt>>>;

/// Per render asking for letters: each subpath's letter, and each letter's word.
type Letters = HashMap<String, (Vec<u32>, Vec<u32>)>;

/// A text's glyphs in outline order: how many contours each has, and its word.
type GlyphTags = Vec<(usize, u32)>;

/// Every render's geometry (with its smallest member em), per-layer info, and per-render extras.
type SceneBuild = (Vec<(String, Geo, f64)>, Vec<LayerOut>, Spines, Letters);

struct Local {
    geo: Geo,
    em: f64,
    frames: Vec<(String, Rect)>,
    /// A pen line's centre lines (after squiggles), for colour along the line.
    spine: Option<Vec<Vec<Pt>>>,
    /// Text: which contours make each glyph, while modifiers keep them apart.
    glyphs: Option<GlyphTags>,
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
    layers: HashMap<u64, Rc<Local>>,
    /// Finished font glyphs by spec, character and quality: editing one
    /// glyph or recompiling the tester only rebuilds what changed.
    font_glyphs: HashMap<u64, Option<(Geo, f64, bool)>>,
    /// Kerning measured from a font, by font, axes and character set.
    kerns: HashMap<(String, u64), Rc<Kerning>>,
}

/// Kerning between character pairs, in em.
type Kerning = HashMap<(char, char), f64>;

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
        self.font_glyphs.clear();
        self.kerns.retain(|k, _| k.0 != id);
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

    /// Shape and position every line of a text, in em units. Both the outline
    /// builder and the caret layout use this, so the caret always matches.
    #[allow(clippy::too_many_arguments)]
    fn lay_out(
        &mut self,
        text: &str,
        font: &str,
        axes: &BTreeMap<String, f32>,
        tracking: f64,
        line_height: f64,
        align: Align,
        morph: Option<&TextMorph>,
        ligatures: bool,
    ) -> Result<Vec<LineLayout>, String> {
        let info = self.font(font)?.info.clone();
        let upm_a = info.units_per_em.max(1) as f64;
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
        let mut out = Vec::with_capacity(n_lines);
        for (li, line) in lines.iter().enumerate() {
            let baseline = li as f64 * lh + y_shift;
            // (glyph a, glyph b, advance, x offset, y offset, cluster) in em.
            let mut placed: Vec<(u16, u16, f64, f64, f64, usize)> = Vec::new();
            {
                let fa = self.font(font)?;
                let face_a = fa.face(&axes_vec(axes)).ok_or("The font couldn't be opened.")?;
                let lig = ligatures && morph.is_none();
                let ga = shape_line(&face_a, line, lig);
                match morph {
                    None => {
                        for g in &ga {
                            placed.push((g.glyph, 0, g.x_advance as f64 / upm_a, g.x_offset as f64 / upm_a, g.y_offset as f64 / upm_a, g.cluster as usize));
                        }
                    }
                    Some(m) => {
                        let fb = self.font(&m.font)?;
                        let face_b = fb.face(&axes_vec(&m.axes)).ok_or("The font couldn't be opened.")?;
                        let gb = shape_line(&face_b, line, false);
                        let aligned = ga.len() == gb.len() && ga.iter().zip(&gb).all(|(x, y)| x.cluster == y.cluster);
                        if aligned {
                            for (x, y) in ga.iter().zip(&gb) {
                                // A character the target font lacks stays as it is.
                                let adv_b = if y.glyph == 0 { x.x_advance as f64 / upm_a } else { y.x_advance as f64 / upm_b };
                                let adv = x.x_advance as f64 / upm_a * (1.0 - t) + adv_b * t;
                                placed.push((x.glyph, y.glyph, adv, 0.0, 0.0, x.cluster as usize));
                            }
                        } else {
                            // Fall back to one glyph per character via cmap.
                            for (bi, ch) in line.char_indices() {
                                let a = face_a.glyph_index(ch).map_or(0, |g| g.0);
                                let b = face_b.glyph_index(ch).map_or(0, |g| g.0);
                                let aa = face_a.glyph_hor_advance(rustybuzz::ttf_parser::GlyphId(a)).unwrap_or(0) as f64 / upm_a;
                                let ab = if b == 0 { aa } else { face_b.glyph_hor_advance(rustybuzz::ttf_parser::GlyphId(b)).unwrap_or(0) as f64 / upm_b };
                                placed.push((a, b, aa * (1.0 - t) + ab * t, 0.0, 0.0, bi));
                            }
                        }
                    }
                }
            }
            let n = placed.len();
            let width: f64 = placed.iter().map(|p| p.2).sum::<f64>() + tracking * n.saturating_sub(1) as f64;
            let x0 = match align {
                Align::Left => 0.0,
                Align::Center => -width * 0.5,
                Align::Right => -width,
            };
            let mut pen = x0;
            let mut glyphs = Vec::with_capacity(n);
            for (a, b, adv, xo, yo, cluster) in placed {
                glyphs.push(PlacedGlyph { a, b, pen, xo, yo, cluster });
                pen += adv + tracking;
            }
            out.push(LineLayout { baseline, text: line.to_string(), glyphs, x0, width });
        }
        Ok(out)
    }

    /// Lay out text in em units. Returns the outline and, when no morph is
    /// involved, the exact curves too.
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
    ) -> Result<(Geo, GlyphTags), String> {
        let morph = morph.filter(|m| m.t > 1e-6 && self.fonts.contains_key(&m.font));
        let t = morph.map_or(0.0, |m| m.t.clamp(0.0, 1.0));
        let lines = self.lay_out(text, font, axes, tracking, line_height, align, morph, ligatures)?;
        let mut poly = Shape::default();
        let mut curves: Option<CurveShape> = if morph.is_none() { Some(Vec::new()) } else { None };
        let mut tags = Vec::new();
        let mut words = 0u32;
        for line in &lines {
            // Word of each byte of the line: runs of non-space, numbered on from the last line's.
            let mut word_at = vec![0u32; line.text.len() + 1];
            let mut in_word = false;
            for (bi, ch) in line.text.char_indices() {
                if !ch.is_whitespace() && !in_word {
                    words += 1;
                }
                in_word = !ch.is_whitespace();
                word_at[bi..bi + ch.len_utf8()].fill(words.saturating_sub(1));
            }
            for g in &line.glyphs {
                let start = poly.contours.len();
                let m = Affine::translate(g.pen + g.xo, line.baseline - g.yo);
                match morph {
                    None => {
                        let geo = self.glyph(font, axes, g.a)?;
                        poly.extend(geo.poly.clone().transformed(&m));
                        if let Some(cs) = &mut curves {
                            for c in &geo.curves {
                                let mut c = c.clone();
                                c.transform(&m);
                                cs.push(c);
                            }
                        }
                    }
                    Some(_) if g.b == 0 && g.a != 0 => {
                        let geo = self.glyph(font, axes, g.a)?;
                        poly.extend(geo.poly.clone().transformed(&m));
                    }
                    Some(mo) => {
                        let mm = self.glyph_morph(font, axes, g.a, &mo.font, &mo.axes, g.b)?;
                        poly.extend(mm.at(t).transformed(&m));
                    }
                }
                tags.push((poly.contours.len() - start, word_at.get(g.cluster).copied().unwrap_or(0)));
            }
        }
        Ok((Geo { poly, curves }, tags))
    }

    /// Caret positions of a text layer in its local units (before modifiers
    /// and the layer transform), for editing text on the canvas. Indices are
    /// UTF-16 offsets so they match the browser's text selection.
    pub fn text_layout(&mut self, content: &Content) -> Result<TextLayout, String> {
        let Content::Text { text, font, size, tracking, line_height, align, axes, morph, ligatures } = content else {
            return Err("Not a text layer.".into());
        };
        let morph = morph.as_ref().filter(|m| m.t > 1e-6 && self.fonts.contains_key(&m.font));
        let info = self.font(font)?.info.clone();
        let upm = info.units_per_em.max(1) as f64;
        let lines = self.lay_out(text, font, axes, *tracking, *line_height, *align, morph, *ligatures)?;
        let mut out = Vec::with_capacity(lines.len());
        let mut start16 = 0usize;
        for line in &lines {
            // Pen position at the start of each cluster (left to right).
            let mut stops: Vec<(usize, f64)> = Vec::new();
            for g in &line.glyphs {
                match stops.iter_mut().find(|s| s.0 == g.cluster) {
                    Some(s) => s.1 = s.1.min(g.pen),
                    None => stops.push((g.cluster, g.pen)),
                }
            }
            stops.sort_by_key(|s| s.0);
            let end_x = line.x0 + line.width;
            let len = line.text.len();
            let x_at = |b: usize| -> f64 {
                let i = stops.iter().rposition(|s| s.0 <= b);
                let Some(i) = i else { return stops.first().map_or(line.x0, |s| s.1) };
                let (c0, x0) = stops[i];
                let (c1, x1) = stops.get(i + 1).copied().unwrap_or((len, end_x));
                if c1 <= c0 {
                    return x0;
                }
                x0 + (x1 - x0) * (b - c0) as f64 / (c1 - c0) as f64
            };
            let mut carets = Vec::new();
            for (bi, ch) in line.text.char_indices() {
                let x = x_at(bi);
                for _ in 0..ch.len_utf16() {
                    carets.push(x * size);
                }
            }
            carets.push(if line.text.is_empty() { line.x0 * size } else { end_x * size });
            let len16 = carets.len() - 1;
            out.push(CaretLine { start: start16, baseline: line.baseline * size, carets });
            start16 += len16 + 1;
        }
        Ok(TextLayout {
            lines: out,
            ascent: info.ascender as f64 / upm * size,
            descent: -(info.descender as f64) / upm * size,
            cap: info.cap_height as f64 / upm * size,
        })
    }

    /// Local geometry of a layer (modifiers applied, transform not), cached.
    fn layer_local(&mut self, doc: &Document, layer: &Layer, quality: f64, depth: u32) -> Result<Rc<Local>, String> {
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
        let mut spine: Option<Vec<Vec<Pt>>> = None;
        let mut glyphs: Option<GlyphTags> = None;
        let (geo, em) = match &layer.content {
            Content::Text { text, font, size, tracking, line_height, align, axes, morph, ligatures } => {
                let (mut g, tags) = self.text_geo(text, font, axes, *tracking, *line_height, *align, morph.as_ref(), *ligatures)?;
                g.transform(&Affine::scale(*size, *size));
                glyphs = Some(tags);
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
            Content::Line { d, size, width, cap, squiggle, dash } => {
                let subs = svg::parse_subpaths(d)?;
                let m = Affine::scale(*size, *size);
                let tol = (width.abs() * 0.02).clamp(0.02, 1.0);
                let mut lines: Vec<(Vec<Pt>, bool)> = subs
                    .into_iter()
                    .map(|(mut c, closed)| {
                        c.transform(&m);
                        match squiggle {
                            Some(sq) => (crate::along::squiggle(&c, closed, sq, tol), closed),
                            None => (c.flatten(tol), closed),
                        }
                    })
                    .collect();
                if let Some(dd) = dash {
                    lines = lines
                        .into_iter()
                        .flat_map(|(mut l, closed)| {
                            if closed && l.first().zip(l.last()).is_some_and(|(a, b)| a.dist(*b) > 1e-9) {
                                l.push(l[0]);
                            }
                            crate::along::dashes(&l, dd).into_iter().map(|p| (p, false))
                        })
                        .collect();
                }
                // At most ~2 px cells: coarser fields show as steps along long lines.
                spine = Some(lines.iter().map(|(l, closed)| {
                    let mut l = l.clone();
                    if *closed && l.first().zip(l.last()).is_some_and(|(a, b)| a.dist(*b) > 1e-9) {
                        l.push(l[0]);
                    }
                    l
                }).collect());
                let cell = ((em + width.abs()) / quality.clamp(24.0, 1024.0) * 0.5).min(2.0 * 120.0 / quality.clamp(24.0, 1024.0)).max(0.05);
                (Geo::poly_only(crate::stroke::polylines_capped(&lines, *width, cell, *cap)), em)
            }
            Content::Stroke { points, width, taper, smooth } => {
                let cell = em / quality.clamp(24.0, 1024.0) * 0.5;
                (Geo::poly_only(crate::stroke::outline(points, *width, *taper, *smooth, cell)), em)
            }
            Content::Morph { a, b, t } => {
                let find = |id: &str| doc.layers.iter().find(|l| l.id == id).cloned();
                let la = find(a).ok_or("Pick two layers to morph between.")?;
                let lb = find(b).ok_or("Pick two layers to morph between.")?;
                let ga = self.layer_local(doc, &la, quality, depth + 1)?;
                let gb = self.layer_local(doc, &lb, quality, depth + 1)?;
                let prep = |l: &Layer, g: &Geo| -> Shape {
                    let s = g.poly.clone().transformed(&Affine::rotate(l.rotation.to_radians()).then(Affine::scale(l.scale * l.sx, l.scale * l.sy)));
                    let c = s.bbox().center();
                    s.transformed(&Affine::translate(-c.x, -c.y))
                };
                let sa = prep(&la, &ga.geo);
                let sb = prep(&lb, &gb.geo);
                let m = Morph::new(&sa, &sb, MORPH_SAMPLES);
                let em = ga.em * (1.0 - t) + gb.em * t;
                (Geo::poly_only(m.at(*t)), em)
            }
        };
        let mut frames = Vec::new();
        let geo = apply_all_frames(geo, &layer.modifiers, &Ctx { em, quality }, &mut frames);
        // Warps would bend the outline away from the centre line: no spine then.
        let spine = if layer.modifiers.iter().any(|m| m.on) { None } else { spine };
        // Glyphs stay told apart through modifiers that only move points.
        let n = geo.poly.contours.len();
        let glyphs = glyphs.filter(|g| layer.modifiers.iter().all(|m| !m.on || moves_points_only(&m.m)) && g.iter().map(|t| t.0).sum::<usize>() == n);
        let out = Rc::new(Local { geo, em, frames, spine, glyphs });
        if self.layers.len() > 256 {
            self.layers.clear();
        }
        self.layers.insert(key, out.clone());
        Ok(out)
    }

    /// Build every layer, then every render. Returns each render's geometry
    /// (with the smallest member em, for curve fitting) plus per-layer info.
    pub fn build_scene(&mut self, doc: &Document) -> (Vec<(String, Geo, f64)>, Vec<LayerOut>) {
        let (r, l, _, _) = self.build_scene_spines(doc);
        (r, l)
    }

    /// [`Engine::build_scene`] plus, per render made of a single pen line, its
    /// centre lines in document coordinates, and per render asking for
    /// letters, which letter and word each outline is.
    fn build_scene_spines(&mut self, doc: &Document) -> SceneBuild {
        let quality = doc.quality.unwrap_or(PREVIEW_QUALITY).clamp(24.0, 1024.0);
        let mut built: HashMap<&str, (Geo, f64)> = HashMap::new();
        let mut layer_glyphs: HashMap<&str, GlyphTags> = HashMap::new();
        let mut layer_spines: HashMap<&str, Vec<Vec<Pt>>> = HashMap::new();
        let mut outs = Vec::with_capacity(doc.layers.len());
        for layer in &doc.layers {
            let mut out = LayerOut { id: layer.id.clone(), bbox: None, error: None, d: None, local: None, frames: Vec::new() };
            if layer.visible {
                match self.layer_local(doc, layer, quality, 0) {
                    Ok(local) => {
                        let mut g = local.geo.clone();
                        let m = layer.transform();
                        g.transform(&m);
                        out.bbox = rect_arr(g.poly.bbox());
                        out.local = rect_arr(local.geo.poly.bbox());
                        out.d = Some(svg::poly_d(&g.poly, 1));
                        out.frames = local.frames.iter().filter_map(|(uid, r)| rect_arr(*r).map(|b| FrameOut { uid: uid.clone(), bbox: b })).collect();
                        built.insert(layer.id.as_str(), (g, local.em * layer.scale_em()));
                        if let Some(g) = &local.glyphs {
                            layer_glyphs.insert(layer.id.as_str(), g.clone());
                        }
                        if let Some(sp) = &local.spine {
                            layer_spines.insert(layer.id.as_str(), sp.iter().map(|l| l.iter().map(|p| m.apply(*p)).collect()).collect());
                        }
                    }
                    Err(e) => out.error = Some(e),
                }
            }
            outs.push(out);
        }
        let default_spec;
        let specs: &[RenderSpec] = match &doc.renders {
            Some(r) => r,
            None => {
                default_spec = [RenderSpec { id: "all".into(), members: doc.layers.iter().map(|l| Member::Id(l.id.clone())).collect(), ..Default::default() }];
                &default_spec
            }
        };
        let ops: HashMap<&str, Op> = doc.layers.iter().map(|l| (l.id.as_str(), l.op)).collect();
        let mut renders = Vec::with_capacity(specs.len());
        let mut spines = HashMap::new();
        let mut letters = HashMap::new();
        for spec in specs {
            if let ([only], false) = (&spec.members[..], spec.modifiers.iter().any(|m| m.on)) {
                if let Some(sp) = layer_spines.get(only.id()) {
                    spines.insert(spec.id.clone(), sp.clone());
                }
            }
            let mut acc = Geo { poly: Shape::default(), curves: Some(Vec::new()) };
            let mut min_em = f64::INFINITY;
            let mut first_em = None;
            for member in &spec.members {
                let id = member.id();
                let Some((g, em)) = built.get(id) else { continue };
                min_em = min_em.min(*em);
                first_em.get_or_insert(*em);
                let op = match member {
                    Member::With { op, .. } => *op,
                    Member::Id(_) => ops.get(id).copied().unwrap_or_default(),
                };
                match op {
                    Op::Add => {
                        acc.poly.extend(g.poly.clone());
                        match (&mut acc.curves, &g.curves) {
                            (Some(a), Some(b)) => a.extend(b.iter().cloned()),
                            _ => acc.curves = None,
                        }
                    }
                    op => {
                        let cell = min_em / quality;
                        acc.poly = boolean(&acc.poly, &g.poly, op, cell);
                        acc.curves = None;
                    }
                }
            }
            let min_em = if min_em.is_finite() { min_em } else { 200.0 };
            if spec.modifiers.iter().any(|m| m.on) && !acc.poly.is_empty() {
                let em = spec.em.unwrap_or(first_em.unwrap_or(min_em)).max(1.0);
                acc = apply_all(acc, &spec.modifiers, &Ctx { em, quality });
            }
            if spec.letters {
                // One added text and nothing that merges outlines: its own glyphs; otherwise pieces by shape.
                let op_of = |m: &Member| match m {
                    Member::With { op, .. } => *op,
                    Member::Id(id) => ops.get(id.as_str()).copied().unwrap_or_default(),
                };
                let tags = match &spec.members[..] {
                    [only] if op_of(only) == Op::Add && !spec.modifiers.iter().any(|m| m.on) => layer_glyphs.get(only.id()),
                    _ => None,
                };
                letters.insert(spec.id.clone(), letter_parts(&acc.poly, tags.map(|t| &t[..]), min_em));
            }
            renders.push((spec.id.clone(), acc, min_em));
        }
        (renders, outs, spines, letters)
    }

    pub fn build(&mut self, doc: &Document) -> BuildOut {
        let (renders, layers, spines, mut letters) = self.build_scene_spines(doc);
        let mut bbox = Rect::EMPTY;
        let mut points = 0;
        let renders = renders
            .into_iter()
            .map(|(id, geo, _)| {
                let b = geo.poly.bbox();
                bbox = bbox.union(&b);
                points += geo.poly.point_count();
                let spine = spines.get(&id).map(|sp| spine_out(sp));
                let (glyphs, words) = letters.remove(&id).unzip();
                RenderOut { id, d: svg::poly_d(&geo.poly, 2), bbox: rect_arr(b), points: geo.poly.point_count(), spine, glyphs, words }
            })
            .collect();
        BuildOut { renders, bbox: rect_arr(bbox), layers, points }
    }

    fn export_doc(doc: &Document) -> Document {
        let mut doc = doc.clone();
        doc.quality = Some(doc.quality.unwrap_or(EXPORT_QUALITY).max(EXPORT_QUALITY));
        doc
    }

    /// Every render as fitted curves (exact where possible).
    pub fn build_paths(&mut self, doc: &Document) -> (Vec<(String, CurveShape)>, Rect) {
        let (renders, _) = self.build_scene(&Self::export_doc(doc));
        let mut bbox = Rect::EMPTY;
        let out = renders
            .into_iter()
            .map(|(id, geo, em)| {
                bbox = bbox.union(&geo.poly.bbox());
                let curves = match geo.curves {
                    Some(c) => c,
                    None => fit_shape(&geo.poly, em / 1500.0, 50.0),
                };
                (id, curves)
            })
            .collect();
        (out, bbox)
    }

    pub fn export_paths(&mut self, doc: &Document) -> PathsOut {
        let (paths, bbox) = self.build_paths(doc);
        PathsOut { paths: paths.into_iter().map(|(id, c)| PathOut { id, d: svg::curves_d(&c, 2) }).collect(), bbox: rect_arr(bbox) }
    }

    /// Final document as one set of fitted curves.
    pub fn build_curves(&mut self, doc: &Document) -> (CurveShape, Rect) {
        let (paths, bbox) = self.build_paths(doc);
        (paths.into_iter().flat_map(|(_, c)| c).collect(), bbox)
    }

    pub fn export_svg(&mut self, doc: &Document, opts: &SvgOpts) -> String {
        let (curves, bbox) = self.build_curves(doc);
        let d = svg::curves_d(&curves, 2);
        let pad = if bbox.is_empty() { 0.0 } else { bbox.width().max(bbox.height()) * opts.padding.clamp(0.0, 1.0) };
        svg::document(&d, bbox, pad, opts.fill.as_deref().unwrap_or("#000"), opts.background.as_deref())
    }

    /// A layer's local geometry at export quality as curves, plus its em.
    fn layer_curves(&mut self, doc: &Document, id: &str) -> Result<(Layer, Shape, Option<CurveShape>, f64), String> {
        let doc = Self::export_doc(doc);
        let layer = doc.layers.iter().find(|l| l.id == id).cloned().ok_or("That layer doesn't exist.")?;
        let quality = doc.quality.unwrap_or(EXPORT_QUALITY);
        let local = self.layer_local(&doc, &layer, quality, 0)?;
        if local.geo.poly.is_empty() {
            return Err("This layer has no outline to convert.".into());
        }
        Ok((layer, local.geo.poly.clone(), local.geo.curves.clone(), local.em))
    }

    /// Convert a layer (content plus modifiers) into a plain outline.
    pub fn bake(&mut self, doc: &Document, id: &str) -> Result<BakeOut, String> {
        let (layer, poly, curves, em) = self.layer_curves(doc, id)?;
        let mut curves = curves.unwrap_or_else(|| fit_shape(&poly, em / 1500.0, 50.0));
        let em = layer.em();
        let m = Affine::scale(1.0 / em, 1.0 / em);
        for c in &mut curves {
            c.transform(&m);
        }
        Ok(BakeOut { d: svg::curves_d(&curves, 5), size: em })
    }

    /// Break a layer into separate outlines: each solid contour with its holes.
    /// Small pieces sitting above or below a larger one in the same column
    /// (the dot of an i, accents) stay with it.
    pub fn split(&mut self, doc: &Document, id: &str) -> Result<Vec<PieceOut>, String> {
        let (layer, poly, curves, _) = self.layer_curves(doc, id)?;
        let exact = curves.filter(|c| c.len() == poly.contours.len());
        let groups = piece_groups(&poly);
        if groups.is_empty() {
            return Err("This layer has no outline to break apart.".into());
        }
        let em = layer.em();
        let m = layer.transform();
        let mut out = Vec::new();
        for idx in &groups {
            let shape = Shape::new(idx.iter().map(|&i| poly.contours[i].clone()).collect());
            let c = shape.bbox().center();
            let mut cs: CurveShape = match &exact {
                Some(ex) => idx.iter().map(|&i| ex[i].clone()).collect(),
                None => fit_shape(&shape, em / 1500.0, 50.0),
            };
            let norm = Affine::scale(1.0 / em, 1.0 / em).then(Affine::translate(-c.x, -c.y));
            for k in &mut cs {
                k.transform(&norm);
            }
            let pos = m.apply(c);
            out.push(PieceOut { d: svg::curves_d(&cs, 5), size: em, x: pos.x, y: pos.y });
        }
        // Reading order: rows top to bottom, then left to right.
        out.sort_by(|a, b| (a.y / (em * layer.scale_em() * 0.5)).round().total_cmp(&(b.y / (em * layer.scale_em() * 0.5)).round()).then(a.x.total_cmp(&b.x)));
        Ok(out)
    }

    /// One character of a font as an outline in em units.
    pub fn glyph_path(&mut self, font: &str, axes: &BTreeMap<String, f32>, ch: char) -> Result<GlyphOut, String> {
        let (gid, adv) = {
            let f = self.font(font)?;
            let upm = f.info.units_per_em.max(1) as f64;
            let face = f.face(&axes_vec(axes)).ok_or("The font couldn't be opened.")?;
            match face.glyph_index(ch) {
                Some(g) => (Some(g.0), face.glyph_hor_advance(g).unwrap_or(0) as f64 / upm),
                None => (None, 0.0),
            }
        };
        let Some(gid) = gid else { return Ok(GlyphOut { d: String::new(), advance: 0.0, exists: false }) };
        let g = self.glyph(font, axes, gid)?;
        Ok(GlyphOut { d: svg::curves_d(&g.curves, 5), advance: adv, exists: true })
    }

    /// Trace an image to a path normalised to a 1-em box centred on the origin.
    pub fn trace_image(&mut self, rgba: &[u8], w: usize, h: usize, opts: &TraceOpts) -> Result<TraceOut, String> {
        let shape = trace(rgba, w, h, opts)?;
        if shape.is_empty() {
            return Err("Nothing to trace. Try a different threshold or invert.".into());
        }
        let shape_box = shape.bbox();
        let b = if opts.frame { Rect { x0: 0.0, y0: 0.0, x1: w as f64, y1: h as f64 } } else { shape_box };
        let s = 1.0 / b.width().max(b.height()).max(1e-9);
        let c = b.center();
        let norm = shape.transformed(&Affine::scale(s, s).then(Affine::translate(-c.x, -c.y)));
        let tol = if opts.pixel { 1e-5 } else { 0.0012 };
        let curves = if opts.pixel { poly_to_curves(&norm) } else { fit_shape(&norm, tol, 55.0) };
        Ok(TraceOut {
            d: svg::curves_d(&curves, 4),
            contours: norm.contours.len(),
            aspect: shape_box.width() / shape_box.height().max(1e-9),
        })
    }

    fn font_charset(spec: &FontSpec) -> Vec<char> {
        let mut v: Vec<char> = match &spec.charset {
            Some(s) if !s.trim().is_empty() => s.chars().filter(|c| !c.is_control()).collect(),
            _ => default_charset(),
        };
        v.extend(spec.glyphs.iter().filter_map(|g| g.ch.chars().next()));
        v.extend([' ', '\u{a0}']);
        v.sort();
        v.dedup();
        v
    }

    /// Advance and side-bearing changes implied by a modifier stack:
    /// (advance scale, extra advance in em, left shift in em, slant degrees).
    fn spacing_of(mods: &[ModEntry]) -> (f64, f64, f64, f64) {
        let (mut scale, mut extra, mut shift, mut slant) = (1.0, 0.0, 0.0, 0.0);
        for m in mods.iter().filter(|m| m.on) {
            match m.m {
                Modifier::Weight { amount } => {
                    extra += 2.0 * amount;
                    shift += amount;
                }
                Modifier::Outline { width } => {
                    extra += width.abs();
                    shift += width.abs() * 0.5;
                }
                Modifier::Stretch { x, .. } => scale *= x.clamp(0.05, 20.0),
                Modifier::Slant { angle } => slant += angle,
                _ => {}
            }
        }
        (scale, extra, shift, slant)
    }

    /// A glyph's outline before the font look, in font units (y-down): the
    /// base or redrawn outline plus its parts, and its advance in em.
    /// `None` when neither the fonts nor the edits define the character.
    fn glyph_raw(&mut self, spec: &FontSpec, ch: char, upm: f64, quality: f64, depth: u32) -> Result<Option<(Geo, f64)>, String> {
        if depth > 3 {
            return Err("Glyph components are nested too deeply.".into());
        }
        let edit = spec.glyphs.iter().find(|g| g.ch.starts_with(ch));
        let morph = spec.morph.as_ref().filter(|m| m.t > 1e-6);
        let t = morph.map_or(0.0, |m| m.t.clamp(0.0, 1.0));
        let base = {
            let f = self.font(&spec.font)?;
            let face = f.face(&axes_vec(&spec.axes)).ok_or("The font couldn't be opened.")?;
            let fu = f.info.units_per_em.max(1) as f64;
            // A no-break space is a space, even where the font has none.
            let g = face.glyph_index(ch).or_else(|| (ch == '\u{a0}').then(|| face.glyph_index(' ')).flatten());
            g.map(|g| (g.0, face.glyph_hor_advance(g).unwrap_or(0) as f64 / fu))
        };
        let edited_d = edit.and_then(|e| e.d.as_deref()).filter(|d| !d.trim().is_empty());
        let has_parts = edit.is_some_and(|e| e.parts.iter().any(|p| p.visible));
        let hide_base = edit.is_some_and(|e| e.hide_base);
        if spec.blank && edited_d.is_none() && !has_parts && !ch.is_whitespace() {
            return Ok(None);
        }
        let (poly, curves, mut adv) = if let Some(d) = edited_d {
            let cs = svg::parse_path(d)?;
            let mut poly = flatten_curves(&cs, 0.0006).cleaned(1e-10);
            normalize_winding(&mut poly);
            let b = poly.bbox();
            let fallback = base.map_or(if b.is_empty() { 0.5 } else { b.x1 + 0.08 }, |b| b.1);
            (poly, Some(cs), fallback)
        } else if spec.blank {
            (Shape::default(), Some(Vec::new()), base.map_or(0.6, |b| b.1))
        } else {
            match base {
                None if has_parts => (Shape::default(), Some(Vec::new()), 0.6),
                None => return Ok(None),
                Some((ga, adv_a)) => match morph {
                    None => {
                        let g = self.glyph(&spec.font, &spec.axes, ga)?;
                        (g.poly.clone(), Some(g.curves.clone()), adv_a)
                    }
                    Some(m) => {
                        let target = {
                            let f = self.font(&m.font)?;
                            let face = f.face(&axes_vec(&m.axes)).ok_or("The font couldn't be opened.")?;
                            let ub = f.info.units_per_em.max(1) as f64;
                            face.glyph_index(ch).map(|g| (g.0, face.glyph_hor_advance(g).unwrap_or(0) as f64 / ub))
                        };
                        match target {
                            Some((gb, adv_b)) => {
                                let mm = self.glyph_morph(&spec.font, &spec.axes, ga, &m.font, &m.axes, gb)?;
                                (mm.at(t), None, adv_a * (1.0 - t) + adv_b * t)
                            }
                            // The target font lacks this character: keep the base glyph
                            // rather than blending towards its .notdef box.
                            None => {
                                let g = self.glyph(&spec.font, &spec.axes, ga)?;
                                (g.poly.clone(), Some(g.curves.clone()), adv_a)
                            }
                        }
                    }
                },
            }
        };
        if let Some(a) = edit.and_then(|e| e.advance) {
            adv = a.max(0.0);
        }
        let em_to_units = Affine::scale(upm, upm);
        let mut geo = if hide_base {
            Geo { poly: Shape::default(), curves: Some(Vec::new()) }
        } else {
            Geo {
                poly: poly.transformed(&em_to_units),
                curves: curves.map(|mut cs| {
                    for c in &mut cs {
                        c.transform(&em_to_units);
                    }
                    cs
                }),
            }
        };
        for part in edit.map_or(&[][..], |e| &e.parts[..]).iter().filter(|p| p.visible) {
            let g = self.glyph_part(spec, part, upm, quality, depth)?;
            match part.op {
                Op::Add => {
                    geo.poly.extend(g.poly);
                    match (&mut geo.curves, g.curves) {
                        (Some(a), Some(b)) => a.extend(b),
                        _ => geo.curves = None,
                    }
                }
                op => {
                    geo.poly = boolean(&geo.poly, &g.poly, op, upm / quality);
                    geo.curves = None;
                }
            }
        }
        Ok(Some((geo, adv)))
    }

    /// One part of a glyph in font units, its own modifiers applied.
    fn glyph_part(&mut self, spec: &FontSpec, part: &GlyphPart, upm: f64, quality: f64, depth: u32) -> Result<Geo, String> {
        let place = Affine::translate(part.x * upm, part.y * upm).then(Affine::rotate(part.rotation.to_radians()));
        if let Some(ch) = part.glyph.as_deref().and_then(|g| g.chars().next()) {
            let Some((mut g, _)) = self.glyph_raw(spec, ch, upm, quality, depth + 1)? else {
                return Ok(Geo::default());
            };
            let k = part.size.abs().max(1e-3);
            if part.modifiers.iter().any(|m| m.on) {
                g = apply_all(g, &part.modifiers, &Ctx { em: upm, quality });
            }
            g.transform(&place.then(Affine::scale(k * part.sx, k * part.sy)));
            return Ok(g);
        }
        let size = part.size.abs().max(1e-3) * upm;
        let content = match (&part.symbol, &part.d) {
            (Some(symbol), _) => Content::Symbol { symbol: symbol.clone(), size },
            (None, Some(d)) if !d.trim().is_empty() => Content::Path { d: d.clone(), size },
            _ => return Ok(Geo::default()),
        };
        let layer = Layer {
            id: String::new(),
            visible: true,
            op: part.op,
            x: 0.0,
            y: 0.0,
            rotation: 0.0,
            scale: 1.0,
            sx: 1.0,
            sy: 1.0,
            modifiers: part.modifiers.clone(),
            content,
        };
        let local = self.layer_local(&Document::default(), &layer, quality, 0)?;
        let mut g = local.geo.clone();
        g.transform(&place.then(Affine::scale(part.sx, part.sy)));
        Ok(g)
    }

    /// Final outline of one character in font units (y-down) and its advance.
    /// `None` when neither the fonts nor the edits define the character.
    fn font_glyph(&mut self, spec: &FontSpec, ch: char, upm: f64, quality: f64) -> Result<Option<(Geo, f64, bool)>, String> {
        let edit = spec.glyphs.iter().find(|g| g.ch.starts_with(ch));
        let key = {
            let mut k = serde_json::to_string(&(&spec.font, &spec.axes, &spec.morph, &spec.modifiers, spec.tracking, spec.blank, edit)).unwrap_or_default();
            // Components depend on other glyphs' edits too.
            if edit.is_some_and(|e| e.parts.iter().any(|p| p.glyph.is_some())) {
                k.push_str(&serde_json::to_string(&spec.glyphs).unwrap_or_default());
            }
            hash_of(&(k, ch, upm.to_bits(), quality.to_bits()))
        };
        if let Some(hit) = self.font_glyphs.get(&key) {
            return Ok(hit.clone());
        }
        let out = match self.glyph_raw(spec, ch, upm, quality, 0)? {
            None => None,
            Some((geo, adv)) => {
                let own = edit.is_some_and(|e| e.own_look);
                let mut mods: Vec<ModEntry> = if own { Vec::new() } else { spec.modifiers.iter().filter(|m| m.on).cloned().collect() };
                if let Some(e) = edit {
                    mods.extend(e.modifiers.iter().filter(|m| m.on).cloned());
                }
                let (cap, xh) = self.font_zones(spec, upm)?;
                let mut geo = apply_type_mods(geo, &mods, &Ctx { em: upm, quality }, ch, cap, xh);
                let (scale, extra, shift, _) = Self::spacing_of(&mods);
                geo.transform(&Affine::translate(shift * upm, 0.0));
                let advance = (adv * scale + extra + spec.tracking) * upm;
                Some((geo, advance.max(0.0), edit.is_some()))
            }
        };
        if self.font_glyphs.len() > 4000 {
            self.font_glyphs.clear();
        }
        self.font_glyphs.insert(key, out.clone());
        Ok(out)
    }

    /// Previews of some characters of a font spec, in em units.
    pub fn font_preview(&mut self, spec: &FontSpec, chars: &str) -> Result<Vec<GlyphPreview>, String> {
        let upm = 1000.0;
        let quality = spec.quality.unwrap_or(PREVIEW_QUALITY).clamp(40.0, 400.0);
        let mut out = Vec::new();
        let back = Affine::scale(1.0 / upm, 1.0 / upm);
        for ch in chars.chars() {
            match self.font_glyph(spec, ch, upm, quality)? {
                Some((mut geo, adv, edited)) => {
                    geo.poly.transform(&back);
                    out.push(GlyphPreview { ch: ch.to_string(), d: svg::poly_d(&geo.poly, 4), advance: adv / upm, edited });
                }
                None => out.push(GlyphPreview { ch: ch.to_string(), d: String::new(), advance: 0.0, edited: false }),
            }
        }
        Ok(out)
    }

    /// A vertical metric of the font being built, in units of `upm`: the
    /// base font's, blended towards the morph target's.
    fn font_metric(&self, spec: &FontSpec, upm: f64, fa: fn(&FontInfo) -> i16) -> Result<i16, String> {
        let a = &self.font(&spec.font)?.info;
        let mut v = fa(a) as f64 / a.units_per_em.max(1) as f64;
        if let Some(m) = spec.morph.as_ref().filter(|m| m.t > 1e-6) {
            let b = &self.font(&m.font)?.info;
            let t = m.t.clamp(0.0, 1.0);
            v = v * (1.0 - t) + fa(b) as f64 / b.units_per_em.max(1) as f64 * t;
        }
        Ok((v * upm).round() as i16)
    }

    /// Cap height and x-height of the font being built, in units of `upm`.
    fn font_zones(&self, spec: &FontSpec, upm: f64) -> Result<(f64, f64), String> {
        Ok((self.font_metric(spec, upm, |i| i.cap_height)? as f64, self.font_metric(spec, upm, |i| i.x_height)? as f64))
    }

    /// A font's kerning between `chars`, in em, measured once per font,
    /// axes and character set.
    fn kerning_of(&mut self, font: &str, axes: &BTreeMap<String, f32>, chars: &[char]) -> Result<Rc<Kerning>, String> {
        let key = (font.to_string(), hash_of(&(axes_key(axes), chars)));
        if let Some(k) = self.kerns.get(&key) {
            return Ok(k.clone());
        }
        let f = self.font(font)?;
        let face = f.face(&axes_vec(axes)).ok_or("The font couldn't be opened.")?;
        let upm = f.info.units_per_em.max(1) as f64;
        let k: HashMap<(char, char), f64> = pair_kerning(&face, chars).into_iter().map(|(p, v)| (p, v as f64 / upm)).collect();
        let k = Rc::new(k);
        self.kerns.insert(key, k.clone());
        Ok(k)
    }

    /// Kerning for an exported font, in font units: the base font's pairs,
    /// blended towards the morph target's and scaled with the glyphs' width.
    /// Glyphs whose outline was redrawn or replaced keep no kerning.
    fn font_kerning(&mut self, spec: &FontSpec, chars: &[char], upm: f64) -> Result<Vec<(u32, u32, i16)>, String> {
        if spec.blank {
            return Ok(Vec::new());
        }
        let redrawn = |c: char| {
            spec.glyphs.iter().any(|g| g.ch.starts_with(c) && (g.d.as_deref().is_some_and(|d| !d.trim().is_empty()) || g.hide_base || g.parts.iter().any(|p| p.visible)))
        };
        let chars: Vec<char> = chars.iter().copied().filter(|&c| !c.is_whitespace() && !redrawn(c)).collect();
        let ka = self.kerning_of(&spec.font, &spec.axes, &chars)?;
        let morph = spec.morph.as_ref().filter(|m| m.t > 1e-6);
        let (kb, in_b) = match morph {
            Some(m) => {
                let in_b: std::collections::HashSet<char> = {
                    let f = self.font(&m.font)?;
                    let face = f.face(&axes_vec(&m.axes)).ok_or("The font couldn't be opened.")?;
                    chars.iter().copied().filter(|&c| face.glyph_index(c).is_some()).collect()
                };
                (Some(self.kerning_of(&m.font, &m.axes, &chars)?), in_b)
            }
            None => (None, Default::default()),
        };
        let t = morph.map_or(0.0, |m| m.t.clamp(0.0, 1.0));
        let mods: Vec<ModEntry> = spec.modifiers.iter().filter(|m| m.on).cloned().collect();
        let (scale, ..) = Self::spacing_of(&mods);
        let mut pairs: Vec<(char, char)> = ka.keys().chain(kb.iter().flat_map(|k| k.keys())).copied().collect();
        pairs.sort();
        pairs.dedup();
        let mut out = Vec::new();
        for (l, r) in pairs {
            let a = ka.get(&(l, r)).copied().unwrap_or(0.0);
            // Characters the target lacks keep the base glyph, so its kerning too.
            let b = match &kb {
                Some(kb) if in_b.contains(&l) && in_b.contains(&r) => kb.get(&(l, r)).copied().unwrap_or(0.0),
                _ => a,
            };
            let v = ((a * (1.0 - t) + b * t) * scale * upm).round();
            if v.abs() >= 1.0 {
                out.push((l as u32, r as u32, v.clamp(i16::MIN as f64, i16::MAX as f64) as i16));
            }
        }
        Ok(out)
    }

    pub fn export_font(&mut self, spec: &FontSpec) -> Result<Vec<u8>, String> {
        let info_a = self.font(&spec.font)?.info.clone();
        let upm = info_a.units_per_em.max(16) as f64;
        let quality = spec.quality.unwrap_or(EXPORT_QUALITY).clamp(60.0, 1024.0);
        let mut out = Vec::new();
        for ch in Self::font_charset(spec) {
            let Some((geo, advance, _)) = self.font_glyph(spec, ch, upm, quality)? else { continue };
            let contours = match geo.curves {
                Some(c) => c,
                None => fit_shape(&geo.poly, upm / 1600.0, 50.0),
            };
            out.push(OutGlyph { codepoint: Some(ch as u32), advance, contours });
        }
        if out.iter().all(|g| g.contours.is_empty()) {
            return Err("None of the requested characters exist in this font.".into());
        }
        let kern_chars: Vec<char> = out.iter().filter(|g| !g.contours.is_empty()).filter_map(|g| g.codepoint.and_then(char::from_u32)).collect();
        let kerning = self.font_kerning(spec, &kern_chars, upm)?;
        let mods: Vec<ModEntry> = spec.modifiers.iter().filter(|m| m.on).cloned().collect();
        let (_, _, _, slant) = Self::spacing_of(&mods);
        let family = clean_name(&spec.family, "Morphotype");
        let style = clean_name(&spec.style, "Regular");
        let weight = spec.weight_class.unwrap_or_else(|| {
            let w = mods.iter().fold(400.0, |acc, m| match m.m {
                Modifier::Weight { amount } => acc + amount * 4000.0,
                _ => acc,
            });
            (w / 100.0).round().clamp(1.0, 9.0) as u16 * 100
        });
        // Fonts derived from others keep their copyright notices and licence
        // (the OFL requires both); the user's own notice comes first.
        let mut sources = vec![info_a.clone()];
        if let Some(m) = spec.morph.as_ref().filter(|m| m.t > 1e-6) {
            let b = self.font(&m.font)?.info.clone();
            if b.full_name != info_a.full_name {
                sources.push(b);
            }
        }
        let own = spec.copyright.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let copyright = join_unique(own.into_iter().chain(sources.iter().map(|i| i.copyright.as_str())), "\n");
        let copyright = if copyright.is_empty() { format!("Derived from {} with Morphotype", info_a.full_name) } else { copyright };
        let meta = FontMeta {
            family,
            style,
            version: clean_version(spec.version.as_deref()),
            units_per_em: upm as u16,
            ascender: self.font_metric(spec, upm, |i| i.ascender)?,
            descender: self.font_metric(spec, upm, |i| i.descender)?,
            line_gap: self.font_metric(spec, upm, |i| i.line_gap)?,
            cap_height: self.font_metric(spec, upm, |i| i.cap_height)?,
            x_height: self.font_metric(spec, upm, |i| i.x_height)?,
            weight_class: weight,
            italic_angle: -slant,
            copyright,
            description: format!("Derived from {} with Morphotype.", sources.iter().map(|i| i.full_name.as_str()).collect::<Vec<_>>().join(" and ")),
            license: join_unique(sources.iter().map(|i| i.license.as_str()), "\n\n"),
            license_url: sources.iter().map(|i| i.license_url.trim()).find(|u| !u.is_empty()).unwrap_or_default().to_string(),
            kerning,
        };
        let ttf = write_ttf(&meta, &out);
        Ok(match spec.format.as_deref() {
            Some("woff") => crate::ttf::to_woff(&ttf),
            _ => ttf,
        })
    }
}

/// Run a font's modifier stack on one glyph (font units, y-down), keeping
/// the type's vertical metrics: Weight grows a shape on every side, so the
/// baseline and the x-height (lowercase) or cap height (everything else) are
/// pulled back onto their lines; Slant leans around half the x-height, so the
/// sidebearings stay balanced as in a drawn italic.
fn apply_type_mods(mut geo: Geo, mods: &[ModEntry], ctx: &Ctx, ch: char, cap: f64, xh: f64) -> Geo {
    for e in mods.iter().filter(|e| e.on) {
        geo = apply(geo, &e.m, ctx);
        match e.m {
            Modifier::Weight { amount } => {
                let a = amount * ctx.em;
                let top = if ch.is_lowercase() { xh } else { cap };
                // Grown edges sit at +a (baseline) and -(top + a); map them back
                // to 0 and -top, squeezing in between and shifting outside.
                let k = top / (top + 2.0 * a);
                if top > 0.0 && k.is_finite() && k > 0.0 {
                    for c in &mut geo.poly.contours {
                        for p in c.iter_mut() {
                            p.y = if p.y >= a {
                                p.y - a
                            } else if p.y <= -top - a {
                                p.y + a
                            } else {
                                (p.y - a) * k
                            };
                        }
                    }
                    geo.curves = None;
                }
            }
            Modifier::Slant { angle } => {
                let k = angle.clamp(-80.0, 80.0).to_radians().tan();
                geo.transform(&Affine::translate(-k * xh * 0.5, 0.0));
            }
            _ => {}
        }
        if geo.poly.is_empty() {
            break;
        }
    }
    geo
}

/// Distinct non-empty strings, in order, joined with `sep`.
fn join_unique<'a>(items: impl Iterator<Item = &'a str>, sep: &str) -> String {
    let mut seen: Vec<&str> = Vec::new();
    for s in items.map(str::trim).filter(|s| !s.is_empty()) {
        if !seen.contains(&s) {
            seen.push(s);
        }
    }
    seen.join(sep)
}

/// A version like "1.004": digits, one dot, three decimals.
fn clean_version(v: Option<&str>) -> String {
    let v: f64 = v.and_then(|v| v.trim().parse().ok()).filter(|v: &f64| v.is_finite() && *v >= 0.0).unwrap_or(1.0);
    format!("{:.3}", v.min(32767.0))
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
    /// Hand-edited glyphs; characters not in the base font are added.
    #[serde(default)]
    pub glyphs: Vec<GlyphEdit>,
    /// Extra advance for every glyph, in em.
    #[serde(default)]
    pub tracking: f64,
    /// "ttf" (default) or "woff".
    #[serde(default)]
    pub format: Option<String>,
    /// Font version such as "1.004" (default "1.000"). Bump it on every
    /// export so an installed copy is replaced rather than cached.
    #[serde(default)]
    pub version: Option<String>,
    /// Start from nothing: only drawn glyphs (and spaces) are included; the
    /// base font only lends its metrics.
    #[serde(default)]
    pub blank: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphEdit {
    pub ch: String,
    /// Replacement outline in em units (y-down, baseline at 0).
    #[serde(default)]
    pub d: Option<String>,
    /// Advance width in em.
    #[serde(default)]
    pub advance: Option<f64>,
    /// Extra modifiers for this glyph, after the font-wide ones.
    #[serde(default)]
    pub modifiers: Vec<ModEntry>,
    /// Layers on top of the outline, combined in order (bottom to top).
    #[serde(default)]
    pub parts: Vec<GlyphPart>,
    /// Skip the font-wide modifiers: this glyph has its own look.
    #[serde(default)]
    pub own_look: bool,
    /// Leave out the base (or redrawn) outline: the glyph is only its parts.
    #[serde(default)]
    pub hide_base: bool,
}

/// One layer of a glyph: a library shape, a path or another glyph (a
/// component, which follows edits to that glyph). Units are em, y-down,
/// baseline at 0; `x`/`y` place the part's origin (a shape's centre, a
/// component's pen position).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphPart {
    #[serde(default)]
    pub symbol: Option<Symbol>,
    #[serde(default)]
    pub glyph: Option<String>,
    #[serde(default)]
    pub d: Option<String>,
    #[serde(default)]
    pub op: Op,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// A shape's size in em, or a component's or path's scale.
    #[serde(default = "one")]
    pub size: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "one")]
    pub sx: f64,
    #[serde(default = "one")]
    pub sy: f64,
    #[serde(default)]
    pub modifiers: Vec<ModEntry>,
    #[serde(default = "yes")]
    pub visible: bool,
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
        assert!(!out.renders[0].d.is_empty());
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
    fn caret_layout_matches_outline() {
        let mut e = engine();
        let c: Content = serde_json::from_str(r#"{"type":"text","text":"MO\nRPH","font":"archivo","size":100,"align":"center"}"#).unwrap();
        let l = e.text_layout(&c).unwrap();
        assert_eq!(l.lines.len(), 2);
        assert_eq!(l.lines[0].carets.len(), 3);
        assert_eq!(l.lines[1].start, 3);
        assert_eq!(l.lines[1].carets.len(), 4);
        // Carets increase left to right and the line is centred.
        let c0 = &l.lines[0].carets;
        assert!(c0[0] < c0[1] && c0[1] < c0[2]);
        assert!((c0[0] + c0[2]).abs() < 1.0, "{c0:?}");
        assert!(l.lines[1].baseline > l.lines[0].baseline);
        // The outline sits between the first and last carets.
        let out = e.build(&doc(r#"{"layers":[{"id":"t","content":{"type":"text","text":"MO","font":"archivo","size":100}}]}"#));
        let b = out.bbox.unwrap();
        assert!(b[0] >= c0[0] - 5.0 && b[2] <= c0[2] + 5.0, "{b:?} vs {c0:?}");
        // Empty text still has a caret.
        let empty: Content = serde_json::from_str(r#"{"type":"text","text":"","font":"archivo","size":100}"#).unwrap();
        assert_eq!(e.text_layout(&empty).unwrap().lines[0].carets, vec![0.0]);
    }

    #[test]
    fn blank_font_has_only_drawn_glyphs() {
        let mut e = engine();
        let spec: FontSpec = serde_json::from_str(
            r#"{"font":"archivo","family":"Blank Test","charset":"AB ","blank":true,
            "glyphs":[{"ch":"A","d":"M0.1 0L0.3 -0.7L0.5 0Z","advance":0.6}]}"#,
        )
        .unwrap();
        let prev = e.font_preview(&spec, "AB").unwrap();
        assert!(!prev[0].d.is_empty());
        assert!(prev[1].d.is_empty(), "B isn't drawn yet");
        let bytes = e.export_font(&spec).unwrap();
        e.load_font("blank", &bytes, 0).unwrap();
        let g = e.glyph_path("blank", &BTreeMap::new(), 'B').unwrap();
        assert!(!g.exists || g.d.is_empty());
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
        let (renders, _) = e.build_scene(&d);
        let geo = &renders[0].1;
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
    fn renders_are_separate_and_clip() {
        let mut e = engine();
        let d = doc(
            r#"{"layers":[
              {"id":"body","content":{"type":"symbol","symbol":{"kind":"circle"},"size":100}},
              {"id":"eye","op":"subtract","content":{"type":"symbol","symbol":{"kind":"circle"},"size":40}},
              {"id":"star","x":300,"sx":2,"content":{"type":"symbol","symbol":{"kind":"star"},"size":100}}],
              "renders":[{"id":"body","members":["body",{"id":"eye","op":"subtract"}]},{"id":"star","members":["star"],"modifiers":[{"kind":"weight","amount":0.05}]}]}"#,
        );
        let out = e.build(&d);
        assert_eq!(out.renders.len(), 2);
        assert!(out.renders.iter().all(|r| !r.d.is_empty()));
        // Stretched star is twice as wide as tall (before the weight grows it).
        let sb = out.layers[2].bbox.unwrap();
        assert!((sb[2] - sb[0]) > 1.7 * (sb[3] - sb[1]), "{sb:?}");
        assert!(out.layers[0].d.as_deref().is_some_and(|d| d.starts_with('M')));
        let (renders, _) = e.build_scene(&d);
        let expect = std::f64::consts::PI * (2500.0 - 400.0);
        assert!((renders[0].1.poly.area() - expect).abs() / expect < 0.02);
        let paths = e.export_paths(&d);
        assert_eq!(paths.paths.len(), 2);
    }

    #[test]
    fn bake_and_split() {
        let mut e = engine();
        let d = doc(r#"{"layers":[{"id":"t","x":10,"content":{"type":"text","text":"Hi!","font":"archivo","size":100}}]}"#);
        let baked = e.bake(&d, "t").unwrap();
        assert_eq!(baked.size, 100.0);
        let pd = doc(&format!(r#"{{"layers":[{{"id":"p","x":10,"content":{{"type":"path","d":"{}","size":100}}}}]}}"#, baked.d));
        let (a, b) = (e.build(&d).bbox.unwrap(), e.build(&pd).bbox.unwrap());
        for k in 0..4 {
            assert!((a[k] - b[k]).abs() < 1.0, "{a:?} vs {b:?}");
        }
        // H, i (stem + dot together), ! (bar + dot together).
        let pieces = e.split(&d, "t").unwrap();
        assert_eq!(pieces.len(), 3, "{pieces:?}");
        assert!(pieces[0].x < pieces[1].x && pieces[1].x < pieces[2].x);
    }

    #[test]
    fn letters_by_glyph_and_word() {
        let mut e = engine();
        let text_of = |s: &str, mods: &str, letters: bool| {
            doc(&format!(
                r#"{{"layers":[{{"id":"t","modifiers":[{mods}],"content":{{"type":"text","text":"{s}","font":"archivo","size":100}}}}],
                "renders":[{{"id":"t","members":["t"],"letters":{letters}}}]}}"#
            ))
        };
        let text = |mods: &str, letters: bool| text_of("Hi oB\\nij", mods, letters);
        let subpaths = |r: &RenderOut| r.d.matches('M').count();
        // Still text says nothing extra.
        let plain = e.build(&text("", false));
        assert!(plain.renders[0].glyphs.is_none() && plain.renders[0].words.is_none());
        // H, i (stem and dot), o (with its hole), B, i, j: three words over two lines.
        for mods in ["", r#"{"kind":"arc","bend":0.5},{"kind":"slant","angle":12}"#] {
            let out = e.build(&text(mods, true));
            let r = &out.renders[0];
            let (g, w) = (r.glyphs.as_ref().unwrap(), r.words.as_ref().unwrap());
            assert_eq!(g.len(), subpaths(r), "{mods}");
            assert_eq!(w, &[0, 0, 1, 1, 2, 2], "{mods}");
            assert_eq!(g.iter().filter(|&&k| k == 1).count(), 2, "the i's dot goes with it: {g:?}");
            assert!(g.windows(2).all(|p| p[0] <= p[1]), "{g:?}");
        }
        // A modifier that merges outlines: letters found by shape instead.
        let out = e.build(&text_of("Hi oB", r#"{"kind":"weight","amount":0.02}"#, true));
        let r = &out.renders[0];
        let g = r.glyphs.as_ref().unwrap();
        assert_eq!(g.len(), subpaths(r));
        assert_eq!(r.words.as_ref().unwrap(), &[0, 0, 1, 1], "{g:?}");
    }

    #[test]
    fn glyph_paths_and_font_edits() {
        let mut e = engine();
        let g = e.glyph_path("archivo", &BTreeMap::new(), 'O').unwrap();
        assert!(g.exists && g.advance > 0.4 && g.d.contains('M'));
        assert!(!e.glyph_path("archivo", &BTreeMap::new(), '☃').unwrap().exists);
        let spec: FontSpec = serde_json::from_str(
            r#"{"font":"archivo","family":"Edit Test","charset":"AB","tracking":0.05,"format":"woff",
            "modifiers":[{"kind":"pixelate","size":0.08,"shape":"dot","gap":0.1}],
            "glyphs":[{"ch":"☃","d":"M0 0L0.5 -0.7L1 0Z","advance":1.1},{"ch":"B","modifiers":[{"kind":"slant","angle":10}]}]}"#,
        )
        .unwrap();
        let prev = e.font_preview(&spec, "A☃").unwrap();
        assert!(!prev[0].d.is_empty() && prev[1].edited);
        assert!((prev[1].advance - 1.15).abs() < 1e-6);
        let woff = e.export_font(&spec).unwrap();
        assert_eq!(&woff[0..4], b"wOFF");
        let ttf = crate::font::to_sfnt(&woff).unwrap();
        let face = rustybuzz::ttf_parser::Face::parse(&ttf, 0).unwrap();
        assert!(face.glyph_index('☃').is_some());
        assert!(face.glyph_index('A').is_some());
    }

    #[test]
    fn pen_lines_stroke_open_paths() {
        let mut e = engine();
        // An open curve, 20 px wide with flat ends, in a 200 px unit box.
        let d = doc(r#"{"layers":[{"id":"l","content":{"type":"line","d":"M-0.5 0C-0.2 -0.4 0.2 -0.4 0.5 0","size":200,"width":20,"cap":"butt"}}]}"#);
        let b = e.build(&d);
        let bb = b.renders[0].bbox.unwrap();
        // Flat ends sit across the end tangents (which lean at 53°), so they
        // reach past ±100 by about r·sin 53° = 8, less than round caps would.
        assert!((bb[2] - bb[0] - 216.0).abs() < 4.0, "{bb:?}");
        assert!(b.layers[0].error.is_none());
        // A closed square path strokes as a ring with a hole.
        let d = doc(r#"{"layers":[{"id":"l","content":{"type":"line","d":"M-0.5 -0.5L0.5 -0.5L0.5 0.5L-0.5 0.5Z","size":100,"width":10}}]}"#);
        let (r, _) = e.build_scene(&d);
        assert_eq!(r[0].1.poly.contours.len(), 2);
    }

    #[test]
    fn glyph_parts_add_cut_and_components() {
        let mut e = engine();
        let spec = |glyphs: &str| -> FontSpec {
            serde_json::from_str(&format!(r#"{{"font":"archivo","family":"T","charset":"AIi","glyphs":{glyphs}}}"#)).unwrap()
        };
        let area = |e: &mut Engine, s: &FontSpec, ch: &str| -> f64 {
            let p = e.font_preview(s, ch).unwrap();
            let cs = svg::parse_path(&p[0].d).unwrap();
            flatten_curves(&cs, 0.001).area().abs()
        };
        let plain = spec("[]");
        let a0 = area(&mut e, &plain, "A");
        // A circle added above the glyph grows its area by about the circle's.
        let dot = spec(r#"[{"ch":"A","parts":[{"symbol":{"kind":"circle"},"x":0.3,"y":-1.0,"size":0.2}]}]"#);
        let a1 = area(&mut e, &dot, "A");
        let circle = std::f64::consts::PI * 0.1 * 0.1;
        assert!((a1 - a0 - circle).abs() < circle * 0.15, "{a0} {a1}");
        // Cutting a big square through it removes most of it.
        let cut = spec(r#"[{"ch":"A","parts":[{"symbol":{"kind":"roundRect","radius":0,"aspect":1},"op":"subtract","x":0.3,"y":-0.35,"size":2}]}]"#);
        assert!(area(&mut e, &cut, "A") < a0 * 0.05);
        // A glyph made only of a component of another glyph matches it, and
        // follows edits to that glyph.
        let comp = spec(r#"[{"ch":"I","hideBase":true,"parts":[{"glyph":"A"}]}]"#);
        let ai = area(&mut e, &comp, "I");
        assert!((ai - a0).abs() < a0 * 0.02, "{ai} vs {a0}");
        let comp_dot = spec(r#"[{"ch":"I","hideBase":true,"parts":[{"glyph":"A"}]},{"ch":"A","parts":[{"symbol":{"kind":"circle"},"x":0.3,"y":-1.0,"size":0.2}]}]"#);
        assert!(area(&mut e, &comp_dot, "I") > ai + circle * 0.8);
        // In a blank font, a glyph of parts alone is drawn.
        let blank: FontSpec = serde_json::from_str(r#"{"font":"archivo","family":"T","blank":true,"charset":"i","glyphs":[{"ch":"i","advance":0.4,"parts":[{"symbol":{"kind":"circle"},"x":0.2,"y":-0.3,"size":0.2}]}]}"#).unwrap();
        assert!(area(&mut e, &blank, "i") > circle * 0.8);
    }

    #[test]
    fn own_look_skips_the_font_modifiers() {
        let mut e = engine();
        let s: FontSpec = serde_json::from_str(r#"{"font":"archivo","family":"T","charset":"AB","modifiers":[{"kind":"outline","width":0.02,"on":true,"uid":"m"}],"glyphs":[{"ch":"B","ownLook":true}]}"#).unwrap();
        let plain: FontSpec = serde_json::from_str(r#"{"font":"archivo","family":"T","charset":"AB"}"#).unwrap();
        let p = e.font_preview(&s, "AB").unwrap();
        let q = e.font_preview(&plain, "AB").unwrap();
        // A is outlined (different), B kept the plain outline.
        assert_ne!(p[0].d, q[0].d);
        assert_eq!(p[1].d, q[1].d);
        // Cached results are identical to fresh ones.
        assert_eq!(e.font_preview(&s, "AB").unwrap()[0].d, p[0].d);
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

    #[test]
    fn squiggled_line_reports_its_spine() {
        let mut e = engine();
        let line = r#"{"type":"line","d":"M-1 0L1 0","size":100,"width":10,"cap":"butt","squiggle":{"kind":"zigzag","amplitude":20,"spacing":25}}"#;
        let out = e.build(&doc(&format!(r#"{{"layers":[{{"id":"l","content":{}}}]}}"#, line)));
        let r = &out.renders[0];
        let sp = r.spine.as_ref().expect("a single pen line has a spine");
        // [x, y, t, joined] quads, t running 0 → 1 along the zigzag.
        assert_eq!(sp.len() % 4, 0);
        assert_eq!(sp[2], 0.0);
        assert!((sp[sp.len() - 2] - 1.0).abs() < 1e-5);
        let b = r.bbox.unwrap();
        assert!(b[3] - b[1] > 45.0, "zigzag spans ±amplitude: {b:?}");
    }
}
