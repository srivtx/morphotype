//! Minimal, spec-conformant TrueType (glyf) font writer.
//!
//! Produces an installable font with cmap (formats 4 and 12), glyf/loca, head,
//! hhea, hmtx, maxp, name, OS/2 (v4) and post (v3). Cubic curves are converted
//! to quadratics within half a font unit.

use crate::fit::cubic_to_quads;
use crate::geom::{CurveContour, Pt, Seg};

pub struct FontMeta {
    pub family: String,
    pub style: String,
    pub version: String,
    pub units_per_em: u16,
    pub ascender: i16,
    pub descender: i16,
    pub line_gap: i16,
    pub cap_height: i16,
    pub x_height: i16,
    pub weight_class: u16,
    /// Degrees, negative leans right (OpenType convention).
    pub italic_angle: f64,
    pub copyright: String,
}

/// A glyph in font units, y-down (as produced by the rest of the engine).
pub struct OutGlyph {
    pub codepoint: Option<u32>,
    pub advance: f64,
    pub contours: Vec<CurveContour>,
}

struct W(Vec<u8>);

impl W {
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn u16(&mut self, v: u16) {
        self.0.extend_from_slice(&v.to_be_bytes());
    }
    fn i16(&mut self, v: i16) {
        self.0.extend_from_slice(&v.to_be_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_be_bytes());
    }
    fn i64(&mut self, v: i64) {
        self.0.extend_from_slice(&v.to_be_bytes());
    }
    fn tag(&mut self, t: &[u8; 4]) {
        self.0.extend_from_slice(t);
    }
    fn pad4(&mut self) {
        while !self.0.len().is_multiple_of(4) {
            self.0.push(0);
        }
    }
}

fn clamp16(v: f64) -> i16 {
    v.round().clamp(i16::MIN as f64, i16::MAX as f64) as i16
}

/// Quadratic point list for one contour: (x, y, on_curve), y-up integers.
fn quad_points(c: &CurveContour) -> Vec<(i16, i16, bool)> {
    let flip = |p: Pt| (clamp16(p.x), clamp16(-p.y));
    let mut pts: Vec<(i16, i16, bool)> = Vec::new();
    let s = flip(c.start);
    pts.push((s.0, s.1, true));
    let mut cur = c.start;
    for seg in &c.segs {
        match *seg {
            Seg::Line(p) => {
                let q = flip(p);
                pts.push((q.0, q.1, true));
                cur = p;
            }
            Seg::Quad(a, p) => {
                let (qa, qp) = (flip(a), flip(p));
                pts.push((qa.0, qa.1, false));
                pts.push((qp.0, qp.1, true));
                cur = p;
            }
            Seg::Cubic(a, b, p) => {
                for (ctrl, end) in cubic_to_quads(cur, a, b, p, 0.5) {
                    let (qa, qp) = (flip(ctrl), flip(end));
                    pts.push((qa.0, qa.1, false));
                    pts.push((qp.0, qp.1, true));
                }
                cur = p;
            }
        }
    }
    // Drop duplicate consecutive on-curve points and the closing duplicate.
    let mut out: Vec<(i16, i16, bool)> = Vec::with_capacity(pts.len());
    for p in pts {
        if let Some(last) = out.last() {
            if last.0 == p.0 && last.1 == p.1 && last.2 && p.2 {
                continue;
            }
        }
        out.push(p);
    }
    while out.len() > 1 {
        let (f, l) = (out[0], out[out.len() - 1]);
        if f.0 == l.0 && f.1 == l.1 && l.2 {
            out.pop();
        } else {
            break;
        }
    }
    out
}

struct GlyphBin {
    data: Vec<u8>,
    bbox: (i16, i16, i16, i16),
    points: usize,
    contours: usize,
}

fn encode_glyph(contours: &[CurveContour]) -> GlyphBin {
    let cs: Vec<Vec<(i16, i16, bool)>> = contours.iter().map(quad_points).filter(|p| p.len() >= 3).collect();
    if cs.is_empty() {
        return GlyphBin { data: Vec::new(), bbox: (0, 0, 0, 0), points: 0, contours: 0 };
    }
    let (mut x0, mut y0, mut x1, mut y1) = (i16::MAX, i16::MAX, i16::MIN, i16::MIN);
    for c in &cs {
        for &(x, y, _) in c {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    let mut w = W(Vec::new());
    w.i16(cs.len() as i16);
    w.i16(x0);
    w.i16(y0);
    w.i16(x1);
    w.i16(y1);
    let mut end = 0usize;
    for c in &cs {
        end += c.len();
        w.u16((end - 1) as u16);
    }
    w.u16(0); // instructionLength
    let all: Vec<(i16, i16, bool)> = cs.iter().flatten().copied().collect();
    // Flags: on-curve bit plus short-vector encoding where it fits.
    let (mut px, mut py) = (0i32, 0i32);
    let mut flags = Vec::with_capacity(all.len());
    let mut xs = W(Vec::new());
    let mut ys = W(Vec::new());
    for &(x, y, on) in &all {
        let dx = x as i32 - px;
        let dy = y as i32 - py;
        px = x as i32;
        py = y as i32;
        let mut f = if on { 0x01u8 } else { 0 };
        if dx == 0 {
            f |= 0x10; // x same
        } else if dx.abs() <= 255 {
            f |= 0x02 | if dx > 0 { 0x10 } else { 0 };
            xs.u8(dx.unsigned_abs() as u8);
        } else {
            xs.i16(dx as i16);
        }
        if dy == 0 {
            f |= 0x20;
        } else if dy.abs() <= 255 {
            f |= 0x04 | if dy > 0 { 0x20 } else { 0 };
            ys.u8(dy.unsigned_abs() as u8);
        } else {
            ys.i16(dy as i16);
        }
        flags.push(f);
    }
    w.0.extend_from_slice(&flags);
    w.0.extend_from_slice(&xs.0);
    w.0.extend_from_slice(&ys.0);
    w.pad4();
    GlyphBin { data: w.0, bbox: (x0, y0, x1, y1), points: all.len(), contours: cs.len() }
}

fn checksum(b: &[u8]) -> u32 {
    let mut s = 0u32;
    for chunk in b.chunks(4) {
        let mut word = [0u8; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        s = s.wrapping_add(u32::from_be_bytes(word));
    }
    s
}

fn utf16be(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(|u| u.to_be_bytes()).collect()
}

fn ps_name(family: &str, style: &str) -> String {
    let raw = format!("{}-{}", family, style);
    let mut out: String = raw.chars().filter(|c| c.is_ascii_graphic() && !"[](){}<>/%".contains(*c)).collect();
    out.truncate(63);
    if out.is_empty() { "Morphotype-Regular".into() } else { out }
}

fn name_table(m: &FontMeta) -> Vec<u8> {
    let ribbi = matches!(m.style.as_str(), "Regular" | "Bold" | "Italic" | "Bold Italic");
    let mut recs: Vec<(u16, String)> = vec![(0, m.copyright.clone())];
    if ribbi {
        recs.push((1, m.family.clone()));
        recs.push((2, m.style.clone()));
    } else {
        recs.push((1, format!("{} {}", m.family, m.style)));
        recs.push((2, "Regular".into()));
    }
    recs.push((3, format!("{};{};{}", m.version, m.family, m.style)));
    recs.push((4, if m.style == "Regular" { m.family.clone() } else { format!("{} {}", m.family, m.style) }));
    recs.push((5, format!("Version {}", m.version)));
    recs.push((6, ps_name(&m.family, &m.style)));
    if !ribbi {
        recs.push((16, m.family.clone()));
        recs.push((17, m.style.clone()));
    }
    let strings: Vec<Vec<u8>> = recs.iter().map(|(_, s)| utf16be(s)).collect();
    let mut w = W(Vec::new());
    w.u16(0);
    w.u16(recs.len() as u16);
    w.u16((6 + 12 * recs.len()) as u16);
    let mut off = 0usize;
    for ((id, _), s) in recs.iter().zip(&strings) {
        w.u16(3); // Windows
        w.u16(1); // Unicode BMP
        w.u16(0x0409);
        w.u16(*id);
        w.u16(s.len() as u16);
        w.u16(off as u16);
        off += s.len();
    }
    for s in strings {
        w.0.extend_from_slice(&s);
    }
    w.0
}

fn cmap_table(map: &[(u32, u16)]) -> Vec<u8> {
    // Format 4 (BMP) segments: runs where code and glyph both increase by one.
    let bmp: Vec<(u32, u16)> = map.iter().copied().filter(|&(c, _)| c < 0xFFFF).collect();
    let mut segs: Vec<(u16, u16, u16)> = Vec::new(); // start, end, first gid
    for &(c, g) in &bmp {
        if let Some(last) = segs.last_mut() {
            if c as u16 == last.1 + 1 && g == last.2 + (last.1 - last.0) + 1 {
                last.1 = c as u16;
                continue;
            }
        }
        segs.push((c as u16, c as u16, g));
    }
    segs.push((0xFFFF, 0xFFFF, 0));
    let n = segs.len();
    let mut f4 = W(Vec::new());
    f4.u16(4);
    f4.u16((16 + 8 * n) as u16);
    f4.u16(0);
    f4.u16((n * 2) as u16);
    let mut es = 0u16;
    while (1usize << (es + 1)) <= n {
        es += 1;
    }
    let sr = 2 * (1u16 << es);
    f4.u16(sr);
    f4.u16(es);
    f4.u16((n * 2) as u16 - sr);
    for s in &segs {
        f4.u16(s.1);
    }
    f4.u16(0);
    for s in &segs {
        f4.u16(s.0);
    }
    for s in &segs {
        let delta = if s.0 == 0xFFFF { 1u16 } else { s.2.wrapping_sub(s.0) };
        f4.u16(delta);
    }
    for _ in &segs {
        f4.u16(0);
    }
    // Format 12 covers everything (including non-BMP).
    let mut f12 = W(Vec::new());
    let mut groups: Vec<(u32, u32, u32)> = Vec::new();
    for &(c, g) in map {
        if let Some(last) = groups.last_mut() {
            if c == last.1 + 1 && g as u32 == last.2 + (last.1 - last.0) + 1 {
                last.1 = c;
                continue;
            }
        }
        groups.push((c, c, g as u32));
    }
    f12.u16(12);
    f12.u16(0);
    f12.u32((16 + 12 * groups.len()) as u32);
    f12.u32(0);
    f12.u32(groups.len() as u32);
    for g in &groups {
        f12.u32(g.0);
        f12.u32(g.1);
        f12.u32(g.2);
    }
    let mut w = W(Vec::new());
    w.u16(0);
    w.u16(3);
    let header = 4 + 3 * 8;
    let off4 = header as u32;
    let off12 = off4 + f4.0.len() as u32;
    // (platform, encoding, offset) sorted by platform then encoding.
    for (p, e, o) in [(0u16, 3u16, off4), (3, 1, off4), (3, 10, off12)] {
        w.u16(p);
        w.u16(e);
        w.u32(o);
    }
    w.0.extend_from_slice(&f4.0);
    w.0.extend_from_slice(&f12.0);
    w.0
}

/// Serialize a complete TrueType font. Glyph 0 (.notdef) is generated.
pub fn write_ttf(m: &FontMeta, glyphs: &[OutGlyph]) -> Vec<u8> {
    let upm = m.units_per_em.max(16) as f64;
    // .notdef: a hollow box.
    let nd_w = upm * 0.5;
    let notdef = {
        let r = |x0: f64, y0: f64, x1: f64, y1: f64, cw: bool| {
            let pts = if cw {
                [Pt { x: x0, y: y0 }, Pt { x: x1, y: y0 }, Pt { x: x1, y: y1 }, Pt { x: x0, y: y1 }]
            } else {
                [Pt { x: x0, y: y0 }, Pt { x: x0, y: y1 }, Pt { x: x1, y: y1 }, Pt { x: x1, y: y0 }]
            };
            CurveContour { start: pts[0], segs: pts[1..].iter().map(|&p| Seg::Line(p)).chain([Seg::Line(pts[0])]).collect() }
        };
        let (a, s) = (upm * 0.7, upm * 0.05);
        vec![r(s, -a, nd_w - s, 0.0, true), r(2.0 * s, -a + s, nd_w - 2.0 * s, -s, false)]
    };
    let mut all: Vec<(Option<u32>, f64, Vec<u8>, (i16, i16, i16, i16), usize, usize)> = Vec::new();
    let nb = encode_glyph(&notdef);
    all.push((None, nd_w, nb.data, nb.bbox, nb.points, nb.contours));
    let mut sorted: Vec<&OutGlyph> = glyphs.iter().collect();
    sorted.sort_by_key(|g| g.codepoint.unwrap_or(u32::MAX));
    for g in sorted {
        let b = encode_glyph(&g.contours);
        all.push((g.codepoint, g.advance.max(0.0), b.data, b.bbox, b.points, b.contours));
    }
    let num_glyphs = all.len() as u16;

    // glyf + loca (long offsets)
    let mut glyf = W(Vec::new());
    let mut loca = W(Vec::new());
    for g in &all {
        loca.u32(glyf.0.len() as u32);
        glyf.0.extend_from_slice(&g.2);
    }
    loca.u32(glyf.0.len() as u32);

    let (mut fx0, mut fy0, mut fx1, mut fy1) = (i16::MAX, i16::MAX, i16::MIN, i16::MIN);
    let mut max_adv = 0u16;
    let (mut min_lsb, mut min_rsb, mut max_extent) = (i16::MAX, i16::MAX, i16::MIN);
    let (mut max_pts, mut max_cts) = (0usize, 0usize);
    let mut adv_sum = 0f64;
    let mut adv_n = 0f64;
    let mut hmtx = W(Vec::new());
    for g in &all {
        let adv = g.1.round().clamp(0.0, 65535.0) as u16;
        max_adv = max_adv.max(adv);
        if adv > 0 {
            adv_sum += adv as f64;
            adv_n += 1.0;
        }
        let empty = g.2.is_empty();
        let lsb = if empty { 0 } else { g.3 .0 };
        hmtx.u16(adv);
        hmtx.i16(lsb);
        if !empty {
            fx0 = fx0.min(g.3 .0);
            fy0 = fy0.min(g.3 .1);
            fx1 = fx1.max(g.3 .2);
            fy1 = fy1.max(g.3 .3);
            min_lsb = min_lsb.min(lsb);
            min_rsb = min_rsb.min(clamp16(adv as f64 - g.3 .2 as f64));
            max_extent = max_extent.max(g.3 .2);
        }
        max_pts = max_pts.max(g.4);
        max_cts = max_cts.max(g.5);
    }
    if fx0 > fx1 {
        (fx0, fy0, fx1, fy1, min_lsb, min_rsb, max_extent) = (0, 0, 0, 0, 0, 0, 0);
    }

    let mut head = W(Vec::new());
    head.u32(0x0001_0000);
    head.u32(0x0001_0000);
    head.u32(0); // checkSumAdjustment, patched below
    head.u32(0x5F0F_3CF5);
    head.u16(0x000B);
    head.u16(m.units_per_em);
    // 2026-01-01 in seconds since 1904-01-01 keeps builds reproducible.
    head.i64(3_849_984_000);
    head.i64(3_849_984_000);
    head.i16(fx0);
    head.i16(fy0);
    head.i16(fx1);
    head.i16(fy1);
    let bold = m.weight_class >= 600;
    let italic = m.italic_angle.abs() > 0.5;
    head.u16((bold as u16) | ((italic as u16) << 1));
    head.u16(8);
    head.i16(2);
    head.i16(1); // long loca
    head.i16(0);

    let mut hhea = W(Vec::new());
    hhea.u32(0x0001_0000);
    hhea.i16(m.ascender);
    hhea.i16(m.descender);
    hhea.i16(m.line_gap);
    hhea.u16(max_adv);
    hhea.i16(min_lsb);
    hhea.i16(min_rsb);
    hhea.i16(max_extent);
    let slope = m.italic_angle.to_radians();
    hhea.i16(if italic { 1000 } else { 1 });
    hhea.i16(if italic { clamp16(-slope.tan() * 1000.0) } else { 0 });
    hhea.i16(0);
    for _ in 0..4 {
        hhea.i16(0);
    }
    hhea.i16(0);
    hhea.u16(num_glyphs);

    let mut maxp = W(Vec::new());
    maxp.u32(0x0001_0000);
    maxp.u16(num_glyphs);
    maxp.u16(max_pts as u16);
    maxp.u16(max_cts as u16);
    maxp.u16(0);
    maxp.u16(0);
    maxp.u16(2);
    for _ in 0..7 {
        maxp.u16(0);
    }
    maxp.u16(0);

    let map: Vec<(u32, u16)> = all.iter().enumerate().filter_map(|(i, g)| g.0.map(|c| (c, i as u16))).collect();
    let first = map.first().map(|m| m.0.min(0xFFFF) as u16).unwrap_or(0x20);
    let last = map.last().map(|m| m.0.min(0xFFFF) as u16).unwrap_or(0x20);
    let mut os2 = W(Vec::new());
    os2.u16(4);
    os2.i16(clamp16(if adv_n > 0.0 { adv_sum / adv_n } else { upm * 0.5 }));
    os2.u16(m.weight_class.clamp(1, 1000));
    os2.u16(5);
    os2.u16(0); // installable embedding
    let e = |f: f64| clamp16(upm * f);
    for v in [e(0.65), e(0.6), 0, e(0.075), e(0.65), e(0.6), 0, e(0.35), e(0.05), e(0.26)] {
        os2.i16(v);
    }
    os2.i16(0);
    for _ in 0..10 {
        os2.u8(0);
    }
    os2.u32(1); // Basic Latin
    os2.u32(0);
    os2.u32(0);
    os2.u32(0);
    os2.tag(b"MRPH");
    let mut sel = 0x80u16; // USE_TYPO_METRICS
    if bold {
        sel |= 0x20;
    }
    if italic {
        sel |= 0x01;
    }
    if !bold && !italic {
        sel |= 0x40;
    }
    os2.u16(sel);
    os2.u16(first);
    os2.u16(last);
    os2.i16(m.ascender);
    os2.i16(m.descender);
    os2.i16(m.line_gap);
    os2.u16(fy1.max(m.ascender).max(0) as u16);
    os2.u16((-(fy0.min(m.descender) as i32)).max(0) as u16);
    os2.u32(1); // Latin 1
    os2.u32(0);
    os2.i16(m.x_height);
    os2.i16(m.cap_height);
    os2.u16(0);
    os2.u16(32);
    os2.u16(2);

    let mut post = W(Vec::new());
    post.u32(0x0003_0000);
    post.u32(((-m.italic_angle) * 65536.0).round() as i32 as u32);
    post.i16(e(-0.1));
    post.i16(e(0.05));
    post.u32(0);
    for _ in 0..4 {
        post.u32(0);
    }

    let mut tables: Vec<([u8; 4], Vec<u8>)> = vec![
        (*b"OS/2", os2.0),
        (*b"cmap", cmap_table(&map)),
        (*b"glyf", glyf.0),
        (*b"head", head.0),
        (*b"hhea", hhea.0),
        (*b"hmtx", hmtx.0),
        (*b"loca", loca.0),
        (*b"maxp", maxp.0),
        (*b"name", name_table(m)),
        (*b"post", post.0),
    ];
    tables.sort_by_key(|a| a.0);
    let n = tables.len();
    let mut es = 0u16;
    while (1usize << (es + 1)) <= n {
        es += 1;
    }
    let sr = (1u16 << es) * 16;
    let mut out = W(Vec::new());
    out.u32(0x0001_0000);
    out.u16(n as u16);
    out.u16(sr);
    out.u16(es);
    out.u16(n as u16 * 16 - sr);
    let mut offset = 12 + 16 * n;
    let mut head_offset = 0usize;
    for (tag, data) in &tables {
        if tag == b"head" {
            head_offset = offset;
        }
        out.tag(tag);
        out.u32(checksum(data));
        out.u32(offset as u32);
        out.u32(data.len() as u32);
        offset += (data.len() + 3) & !3;
    }
    for (_, data) in &tables {
        out.0.extend_from_slice(data);
        out.pad4();
    }
    let adj = 0xB1B0_AFBAu32.wrapping_sub(checksum(&out.0));
    out.0[head_offset + 8..head_offset + 12].copy_from_slice(&adj.to_be_bytes());
    out.0
}

fn be32(d: &[u8], o: usize) -> u32 {
    u32::from_be_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}

/// Wrap an sfnt (as written by [`write_ttf`]) as WOFF 1.0 with zlib-compressed
/// tables, for hosting on the web.
pub fn to_woff(sfnt: &[u8]) -> Vec<u8> {
    let n = u16::from_be_bytes([sfnt[4], sfnt[5]]) as usize;
    let flavor = be32(sfnt, 0);
    let mut entries = Vec::with_capacity(n);
    for i in 0..n {
        let o = 12 + i * 16;
        let (tag, sum, off, len) = (be32(sfnt, o), be32(sfnt, o + 4), be32(sfnt, o + 8) as usize, be32(sfnt, o + 12) as usize);
        let raw = &sfnt[off..off + len];
        let z = miniz_oxide::deflate::compress_to_vec_zlib(raw, 9);
        let data = if z.len() < raw.len() { z } else { raw.to_vec() };
        entries.push((tag, sum, len, data));
    }
    let header = 44 + 20 * n;
    let mut total = header;
    for e in &entries {
        total += (e.3.len() + 3) & !3;
    }
    let mut out = W(Vec::with_capacity(total));
    out.tag(b"wOFF");
    out.u32(flavor);
    out.u32(total as u32);
    out.u16(n as u16);
    out.u16(0);
    out.u32(sfnt.len() as u32);
    out.u16(1);
    out.u16(0);
    for _ in 0..5 {
        out.u32(0); // metadata and private blocks
    }
    let mut offset = header;
    for (tag, sum, orig, data) in &entries {
        out.u32(*tag);
        out.u32(offset as u32);
        out.u32(data.len() as u32);
        out.u32(*orig as u32);
        out.u32(*sum);
        offset += (data.len() + 3) & !3;
    }
    for e in &entries {
        out.0.extend_from_slice(&e.3);
        out.pad4();
    }
    out.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use rustybuzz::ttf_parser::{Face, GlyphId};

    fn square(x: f64, s: f64) -> CurveContour {
        let p = [Pt { x, y: 0.0 }, Pt { x: x + s, y: 0.0 }, Pt { x: x + s, y: -s }, Pt { x, y: -s }];
        // y-down, solid = positive area: right along the top... here the top is y = -s.
        CurveContour { start: p[3], segs: vec![Seg::Line(p[2]), Seg::Line(p[1]), Seg::Line(p[0]), Seg::Line(p[3])] }
    }

    fn meta() -> FontMeta {
        FontMeta {
            family: "Test Morph".into(),
            style: "Regular".into(),
            version: "1.000".into(),
            units_per_em: 1000,
            ascender: 800,
            descender: -200,
            line_gap: 0,
            cap_height: 700,
            x_height: 500,
            weight_class: 400,
            italic_angle: 0.0,
            copyright: "test".into(),
        }
    }

    #[test]
    fn woff_roundtrips() {
        let glyphs = vec![OutGlyph { codepoint: Some('A' as u32), advance: 600.0, contours: vec![square(50.0, 500.0)] }];
        let ttf = write_ttf(&meta(), &glyphs);
        let woff = to_woff(&ttf);
        assert_eq!(&woff[0..4], b"wOFF");
        assert_eq!(u32::from_be_bytes([woff[8], woff[9], woff[10], woff[11]]) as usize, woff.len());
        let back = crate::font::to_sfnt(&woff).unwrap();
        let face = Face::parse(&back, 0).expect("decoded WOFF parses");
        assert_eq!(face.glyph_hor_advance(face.glyph_index('A').unwrap()), Some(600));
    }

    #[test]
    fn written_font_parses_back() {
        let glyphs = vec![
            OutGlyph { codepoint: Some('A' as u32), advance: 600.0, contours: vec![square(50.0, 500.0)] },
            OutGlyph { codepoint: Some(' ' as u32), advance: 250.0, contours: vec![] },
            OutGlyph {
                codepoint: Some('😀' as u32),
                advance: 700.0,
                contours: vec![CurveContour {
                    start: Pt { x: 0.0, y: 0.0 },
                    segs: vec![
                        Seg::Cubic(Pt { x: 0.0, y: -400.0 }, Pt { x: 600.0, y: -400.0 }, Pt { x: 600.0, y: 0.0 }),
                        Seg::Line(Pt { x: 0.0, y: 0.0 }),
                    ],
                }],
            },
        ];
        let bytes = write_ttf(&meta(), &glyphs);
        assert_eq!(checksum(&bytes), 0xB1B0_AFBA);
        let face = Face::parse(&bytes, 0).expect("parses");
        assert_eq!(face.number_of_glyphs(), 4);
        let a = face.glyph_index('A').expect("A mapped");
        assert_eq!(face.glyph_hor_advance(a), Some(600));
        let bb = face.glyph_bounding_box(a).unwrap();
        assert_eq!((bb.x_min, bb.y_min, bb.x_max, bb.y_max), (50, 0, 550, 500));
        let sp = face.glyph_index(' ').unwrap();
        assert!(face.glyph_bounding_box(sp).is_none());
        let emoji = face.glyph_index('😀').expect("format 12 mapping");
        assert!(face.glyph_bounding_box(emoji).unwrap().y_max >= 290);
        assert!(face.glyph_bounding_box(GlyphId(0)).is_some());
        let fam = face.names().into_iter().find(|n| n.name_id == 1).and_then(|n| n.to_string());
        assert_eq!(fam.as_deref(), Some("Test Morph"));
    }
}
