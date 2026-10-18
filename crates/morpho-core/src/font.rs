//! Font loading (TTF / OTF / TTC / WOFF), metadata, shaping and glyph outlines.

use crate::geom::{pt, CurveContour, Pt, Seg};
use rustybuzz::ttf_parser::{self, name_id, GlyphId, OutlineBuilder, Tag};
use serde::Serialize;

#[derive(Debug)]
pub struct FontError(pub String);

impl std::fmt::Display for FontError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn err<T>(msg: impl Into<String>) -> Result<T, FontError> {
    Err(FontError(msg.into()))
}

fn be_u16(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*b.get(o)?, *b.get(o + 1)?]))
}
fn be_u32(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_be_bytes([*b.get(o)?, *b.get(o + 1)?, *b.get(o + 2)?, *b.get(o + 3)?]))
}

/// Convert WOFF 1.0 to a plain sfnt; other formats are returned untouched.
pub fn to_sfnt(data: &[u8]) -> Result<Vec<u8>, FontError> {
    match data.get(0..4) {
        Some(b"wOFF") => decode_woff(data),
        Some(b"wOF2") => err("WOFF2 isn't supported yet. Import the .ttf or .otf instead."),
        Some(_) => Ok(data.to_vec()),
        None => err("The file is empty."),
    }
}

fn decode_woff(d: &[u8]) -> Result<Vec<u8>, FontError> {
    let bad = || FontError("This WOFF file is damaged.".into());
    let flavor = be_u32(d, 4).ok_or_else(bad)?;
    let num_tables = be_u16(d, 12).ok_or_else(bad)? as usize;
    let mut tables = Vec::with_capacity(num_tables);
    for i in 0..num_tables {
        let o = 44 + i * 20;
        let tag = be_u32(d, o).ok_or_else(bad)?;
        let off = be_u32(d, o + 4).ok_or_else(bad)? as usize;
        let comp_len = be_u32(d, o + 8).ok_or_else(bad)? as usize;
        let orig_len = be_u32(d, o + 12).ok_or_else(bad)? as usize;
        let checksum = be_u32(d, o + 16).ok_or_else(bad)?;
        let raw = d.get(off..off + comp_len).ok_or_else(bad)?;
        let bytes = if comp_len < orig_len {
            miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(raw, orig_len).map_err(|_| bad())?
        } else {
            raw.to_vec()
        };
        tables.push((tag, checksum, bytes));
    }
    tables.sort_by_key(|t| t.0);
    let mut out = Vec::new();
    let n = num_tables as u16;
    let mut es = 0u16;
    while (1u32 << (es + 1)) <= n as u32 {
        es += 1;
    }
    let sr = (1u16 << es) * 16;
    out.extend_from_slice(&flavor.to_be_bytes());
    out.extend_from_slice(&n.to_be_bytes());
    out.extend_from_slice(&sr.to_be_bytes());
    out.extend_from_slice(&es.to_be_bytes());
    out.extend_from_slice(&(n * 16 - sr).to_be_bytes());
    let mut offset = 12 + 16 * num_tables;
    for (tag, sum, bytes) in &tables {
        out.extend_from_slice(&tag.to_be_bytes());
        out.extend_from_slice(&sum.to_be_bytes());
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        offset += (bytes.len() + 3) & !3;
    }
    for (_, _, bytes) in &tables {
        out.extend_from_slice(bytes);
        while out.len() % 4 != 0 {
            out.push(0);
        }
    }
    Ok(out)
}

#[derive(Clone, Debug, Serialize)]
pub struct Axis {
    pub tag: String,
    pub name: String,
    pub min: f32,
    pub default: f32,
    pub max: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInfo {
    pub family: String,
    pub style: String,
    pub full_name: String,
    pub units_per_em: u16,
    pub ascender: i16,
    pub descender: i16,
    pub line_gap: i16,
    pub cap_height: i16,
    pub x_height: i16,
    pub glyph_count: u16,
    pub axes: Vec<Axis>,
    /// Number of faces in a collection (.ttc); 1 otherwise.
    pub faces: u32,
}

fn name_of(face: &ttf_parser::Face, id: u16) -> Option<String> {
    let names = face.names();
    let mut fallback = None;
    for i in 0..names.len() {
        let Some(n) = names.get(i) else { continue };
        if n.name_id != id {
            continue;
        }
        if let Some(s) = n.to_string() {
            if n.language_id == 0x0409 || n.platform_id == ttf_parser::PlatformId::Unicode {
                return Some(s);
            }
            fallback.get_or_insert(s);
        }
    }
    fallback
}

/// A loaded font: owned sfnt bytes plus face index (for collections).
#[derive(Clone)]
pub struct FontData {
    pub data: Vec<u8>,
    pub index: u32,
    pub info: FontInfo,
}

impl FontData {
    pub fn load(bytes: &[u8], index: u32) -> Result<FontData, FontError> {
        let data = to_sfnt(bytes)?;
        let faces = ttf_parser::fonts_in_collection(&data).unwrap_or(1);
        let index = index.min(faces.saturating_sub(1));
        let face = match ttf_parser::Face::parse(&data, index) {
            Ok(f) => f,
            Err(e) => return err(format!("This doesn't look like a font file ({e}).")),
        };
        let family = name_of(&face, name_id::TYPOGRAPHIC_FAMILY)
            .or_else(|| name_of(&face, name_id::FAMILY))
            .unwrap_or_else(|| "Untitled".into());
        let style = name_of(&face, name_id::TYPOGRAPHIC_SUBFAMILY)
            .or_else(|| name_of(&face, name_id::SUBFAMILY))
            .unwrap_or_else(|| "Regular".into());
        let full_name = name_of(&face, name_id::FULL_NAME).unwrap_or_else(|| format!("{family} {style}"));
        let axes = face
            .variation_axes()
            .into_iter()
            .map(|a| Axis {
                tag: a.tag.to_string(),
                name: name_of(&face, a.name_id).unwrap_or_else(|| a.tag.to_string()),
                min: a.min_value,
                default: a.def_value,
                max: a.max_value,
            })
            .collect();
        let upm = face.units_per_em();
        let info = FontInfo {
            family,
            style,
            full_name,
            units_per_em: upm,
            ascender: face.ascender(),
            descender: face.descender(),
            line_gap: face.line_gap(),
            cap_height: face.capital_height().unwrap_or((upm as f32 * 0.7) as i16),
            x_height: face.x_height().unwrap_or((upm as f32 * 0.5) as i16),
            glyph_count: face.number_of_glyphs(),
            axes,
            faces,
        };
        Ok(FontData { data, index, info })
    }

    /// Shaping face with variation coordinates applied.
    pub fn face(&self, axes: &[(String, f32)]) -> Option<rustybuzz::Face<'_>> {
        let mut f = rustybuzz::Face::from_slice(&self.data, self.index)?;
        if !axes.is_empty() {
            let vars: Vec<rustybuzz::Variation> = axes
                .iter()
                .filter_map(|(t, v)| {
                    let b = t.as_bytes();
                    (b.len() == 4).then(|| rustybuzz::Variation { tag: Tag::from_bytes(&[b[0], b[1], b[2], b[3]]), value: *v })
                })
                .collect();
            f.set_variations(&vars);
        }
        Some(f)
    }
}

/// One positioned glyph from shaping, in font units (y-up offsets).
#[derive(Clone, Copy, Debug)]
pub struct Placed {
    pub glyph: u16,
    pub cluster: u32,
    pub x_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
}

/// Shape one line of text. `ligatures` off is used when morphing so both
/// fonts produce one glyph per character.
pub fn shape_line(face: &rustybuzz::Face, text: &str, ligatures: bool) -> Vec<Placed> {
    let mut buf = rustybuzz::UnicodeBuffer::new();
    buf.push_str(text);
    buf.guess_segment_properties();
    let features: Vec<rustybuzz::Feature> = if ligatures {
        Vec::new()
    } else {
        ["liga", "clig", "dlig", "calt"]
            .iter()
            .map(|t| rustybuzz::Feature::new(Tag::from_bytes(t.as_bytes().try_into().unwrap_or(b"liga")), 0, ..))
            .collect()
    };
    let out = rustybuzz::shape(face, &features, buf);
    out.glyph_infos()
        .iter()
        .zip(out.glyph_positions())
        .map(|(i, p)| Placed {
            glyph: i.glyph_id as u16,
            cluster: i.cluster,
            x_advance: p.x_advance,
            x_offset: p.x_offset,
            y_offset: p.y_offset,
        })
        .collect()
}

struct Builder {
    contours: Vec<CurveContour>,
    cur: Option<CurveContour>,
    last: Pt,
}

impl Builder {
    // Font space is y-up; document space is y-down.
    fn p(x: f32, y: f32) -> Pt {
        pt(x as f64, -(y as f64))
    }
    fn finish(&mut self) {
        if let Some(c) = self.cur.take() {
            if !c.segs.is_empty() {
                self.contours.push(c);
            }
        }
    }
}

impl OutlineBuilder for Builder {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish();
        let p = Self::p(x, y);
        self.cur = Some(CurveContour { start: p, segs: Vec::new() });
        self.last = p;
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let p = Self::p(x, y);
        if let Some(c) = &mut self.cur {
            c.segs.push(Seg::Line(p));
        }
        self.last = p;
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let p = Self::p(x, y);
        if let Some(c) = &mut self.cur {
            c.segs.push(Seg::Quad(Self::p(x1, y1), p));
        }
        self.last = p;
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let p = Self::p(x, y);
        if let Some(c) = &mut self.cur {
            c.segs.push(Seg::Cubic(Self::p(x1, y1), Self::p(x2, y2), p));
        }
        self.last = p;
    }
    fn close(&mut self) {
        if let Some(c) = &mut self.cur {
            if self.last.dist(c.start) > 1e-9 {
                c.segs.push(Seg::Line(c.start));
            }
        }
        self.finish();
    }
}

/// Glyph outline in font units, y-down, origin at the glyph's baseline origin.
pub fn glyph_outline(face: &ttf_parser::Face, glyph: u16) -> Vec<CurveContour> {
    let mut b = Builder { contours: Vec::new(), cur: None, last: Pt::default() };
    face.outline_glyph(GlyphId(glyph), &mut b);
    b.finish();
    b.contours
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn test_font() -> Vec<u8> {
        std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../ui/public/fonts/ArchivoBlack-Regular.woff")).expect("bundled font")
    }

    #[test]
    fn loads_woff_and_shapes() {
        let f = FontData::load(&test_font(), 0).unwrap();
        assert_eq!(f.info.family, "Archivo Black");
        assert!(f.info.units_per_em > 0);
        let face = f.face(&[]).unwrap();
        let g = shape_line(&face, "AV", true);
        assert_eq!(g.len(), 2);
        let o = glyph_outline(&face, g[0].glyph);
        assert!(!o.is_empty());
    }

    #[test]
    fn rejects_garbage() {
        assert!(FontData::load(b"hello world", 0).is_err());
        assert!(FontData::load(b"wOF2....", 0).is_err());
    }
}
