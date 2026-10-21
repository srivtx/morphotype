//! Font export audit: exports a matrix of fonts through the engine and
//! measures them against their sources. Run with
//! `cargo test -p morpho-core --test font_audit -- --nocapture` to see the table;
//! set `FONT_AUDIT_OUT` to a folder to keep the exported fonts (relative paths
//! start from crates/morpho-core, where cargo runs the test).

use morpho_core::font::{pair_kerning, to_sfnt};
use std::collections::HashMap;
use morpho_core::{Engine, FontSpec};
use rustybuzz::ttf_parser::{name_id, Face, GlyphId, OutlineBuilder, Tag};

const FONTS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../ui/public/fonts/");
const LETTERS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const FLAT_BOTTOM: &str = "HEILTxzkn";
const FLAT_CAP: &str = "HEIT";
const FLAT_X: &str = "xz";
const SYMMETRIC: &str = "HOno";
const KERN_PAIRS: [&str; 16] = ["AV", "AT", "AY", "AW", "To", "Ta", "Te", "Ty", "LT", "LY", "Yo", "Ya", "Vo", "Wa", "P.", "F,"];

fn source(file: &str) -> Vec<u8> {
    to_sfnt(&std::fs::read(format!("{FONTS}{file}")).unwrap()).unwrap()
}

/// Exact bounds of an outline, optionally de-skewed by `k` around height `c`.
struct Bounds {
    b: [f64; 4],
    last: (f64, f64),
    k: f64,
    c: f64,
}

impl Bounds {
    fn p(&self, x: f32, y: f32) -> (f64, f64) {
        let (x, y) = (x as f64, y as f64);
        (x - self.k * (y - self.c), y)
    }
    fn add(&mut self, (x, y): (f64, f64)) {
        self.b = [self.b[0].min(x), self.b[1].min(y), self.b[2].max(x), self.b[3].max(y)];
    }
}

impl OutlineBuilder for Bounds {
    fn move_to(&mut self, x: f32, y: f32) {
        let p = self.p(x, y);
        self.add(p);
        self.last = p;
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.move_to(x, y);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (a, c, e) = (self.last, self.p(x1, y1), self.p(x, y));
        for axis in 0..2 {
            let g = |p: (f64, f64)| if axis == 0 { p.0 } else { p.1 };
            let den = g(a) - 2.0 * g(c) + g(e);
            if den.abs() > 1e-12 {
                let t = (g(a) - g(c)) / den;
                if t > 0.0 && t < 1.0 {
                    let q = |s: f64| (1.0 - t) * (1.0 - t) * s;
                    let pt = (q(a.0) + 2.0 * t * (1.0 - t) * c.0 + t * t * e.0, q(a.1) + 2.0 * t * (1.0 - t) * c.1 + t * t * e.1);
                    self.add(pt);
                }
            }
        }
        self.add(e);
        self.last = e;
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        // Bundled fonts are TrueType; sample cubics finely just in case.
        let (a, b, c, d) = (self.last, self.p(x1, y1), self.p(x2, y2), self.p(x, y));
        for i in 1..=64 {
            let t = i as f64 / 64.0;
            let u = 1.0 - t;
            let f = |a: f64, b: f64, c: f64, d: f64| u * u * u * a + 3.0 * u * u * t * b + 3.0 * u * t * t * c + t * t * t * d;
            self.add((f(a.0, b.0, c.0, d.0), f(a.1, b.1, c.1, d.1)));
        }
        self.last = d;
    }
    fn close(&mut self) {}
}

fn bounds(face: &Face, ch: char, k: f64, c: f64) -> Option<[f64; 4]> {
    let g = face.glyph_index(ch)?;
    let mut b = Bounds { b: [f64::MAX, f64::MAX, f64::MIN, f64::MIN], last: (0.0, 0.0), k, c };
    face.outline_glyph(g, &mut b)?;
    Some(b.b)
}

/// Points of a simple glyph as stored in glyf: (x, y, on-curve).
fn glyf_points(face: &Face, g: GlyphId) -> Vec<(i32, i32, bool)> {
    let raw = face.raw_face();
    let (Some(glyf), Some(loca), Some(head)) = (raw.table(Tag::from_bytes(b"glyf")), raw.table(Tag::from_bytes(b"loca")), raw.table(Tag::from_bytes(b"head"))) else {
        return Vec::new();
    };
    let u16_at = |d: &[u8], o: usize| u16::from_be_bytes([d[o], d[o + 1]]) as usize;
    let long = u16_at(head, 50) == 1;
    let i = g.0 as usize;
    let (s, e) = if long {
        let r = |j: usize| u32::from_be_bytes([loca[j * 4], loca[j * 4 + 1], loca[j * 4 + 2], loca[j * 4 + 3]]) as usize;
        (r(i), r(i + 1))
    } else {
        (u16_at(loca, i * 2) * 2, u16_at(loca, i * 2 + 2) * 2)
    };
    if e <= s {
        return Vec::new();
    }
    let d = &glyf[s..e];
    let nc = i16::from_be_bytes([d[0], d[1]]);
    if nc <= 0 {
        return Vec::new();
    }
    let nc = nc as usize;
    let n = u16_at(d, 10 + 2 * (nc - 1)) + 1;
    let mut o = 10 + 2 * nc;
    o += 2 + u16_at(d, o);
    let mut flags = Vec::with_capacity(n);
    while flags.len() < n {
        let f = d[o];
        o += 1;
        flags.push(f);
        if f & 8 != 0 {
            let r = d[o];
            o += 1;
            for _ in 0..r {
                flags.push(f);
            }
        }
    }
    let mut read = |short: u8, same: u8| {
        let mut v = 0i32;
        let mut out = Vec::with_capacity(n);
        for &f in &flags {
            if f & short != 0 {
                let m = d[o] as i32;
                o += 1;
                v += if f & same != 0 { m } else { -m };
            } else if f & same == 0 {
                v += i16::from_be_bytes([d[o], d[o + 1]]) as i32;
                o += 2;
            }
            out.push(v);
        }
        out
    };
    let xs = read(0x02, 0x10);
    let ys = read(0x04, 0x20);
    flags.iter().enumerate().map(|(i, f)| (xs[i], ys[i], f & 1 != 0)).collect()
}

fn kern(face: &Face, pair: &str) -> f64 {
    let rb = rustybuzz::Face::from_face(face.clone());
    let run = |on: bool| {
        let mut buf = rustybuzz::UnicodeBuffer::new();
        buf.push_str(pair);
        let f = rustybuzz::Feature::new(Tag::from_bytes(b"kern"), on as u32, ..);
        let out = rustybuzz::shape(&rb, &[f], buf);
        let p = out.glyph_positions();
        if p.len() < 2 {
            return 0;
        }
        p[0].x_advance + p[1].x_offset
    };
    (run(true) - run(false)) as f64 / face.units_per_em() as f64
}

/// Characters of a font that have an outline.
fn drawn_chars(face: &Face) -> Vec<char> {
    (0x21..0x3000u32).filter_map(char::from_u32).filter(|&c| face.glyph_index(c).is_some_and(|g| face.glyph_bounding_box(g).is_some())).collect()
}

/// Every pair's kerning as rustybuzz shapes it, in font units.
fn all_kerning(data: &[u8], chars: &[char]) -> HashMap<(char, char), i32> {
    let face = rustybuzz::Face::from_slice(data, 0).unwrap();
    pair_kerning(&face, chars)
}

/// Pairs where two kerning tables disagree, as "AV -80 vs -75".
fn kern_diff(got: &HashMap<(char, char), i32>, want: &HashMap<(char, char), i32>) -> Vec<String> {
    let mut keys: Vec<_> = got.keys().chain(want.keys()).copied().collect();
    keys.sort();
    keys.dedup();
    keys.into_iter()
        .filter_map(|k| {
            let (g, w) = (got.get(&k).copied().unwrap_or(0), want.get(&k).copied().unwrap_or(0));
            (g != w).then(|| format!("{}{} {g} vs {w}", k.0, k.1))
        })
        .collect()
}

fn gpos_len(data: &[u8]) -> usize {
    Face::parse(data, 0).unwrap().raw_face().table(Tag::from_bytes(b"GPOS")).map_or(0, |t| t.len())
}

fn name(face: &Face, id: u16) -> String {
    face.names().into_iter().filter(|n| n.name_id == id).find_map(|n| n.to_string()).unwrap_or_default()
}

#[derive(Default, Debug)]
struct Audit {
    bytes: usize,
    gpos: usize,
    points: usize,
    missing_extremes: usize,
    baseline_err: f64,
    cap_err: f64,
    x_err: f64,
    sb_asym: f64,
    kern_pairs: usize,
    kern_sum: f64,
    copyright: String,
    license: String,
    license_url: String,
    version: String,
}

fn audit(data: &[u8], cap: f64, xh: f64) -> Audit {
    let face = Face::parse(data, 0).unwrap();
    let upm = face.units_per_em() as f64;
    let k = (-(face.italic_angle() as f64)).to_radians().tan();
    let mut a = Audit { bytes: data.len(), gpos: gpos_len(data), ..Default::default() };
    for ch in LETTERS.chars() {
        let Some(g) = face.glyph_index(ch) else { continue };
        let pts = glyf_points(&face, g);
        a.points += pts.len();
        let Some(b) = bounds(&face, ch, 0.0, 0.0) else { continue };
        let on: Vec<_> = pts.iter().filter(|p| p.2).collect();
        let hit = |f: &dyn Fn(&(i32, i32, bool)) -> f64, v: f64| on.iter().any(|p| (f(p) - v).abs() <= 1.0);
        let ok = hit(&|p| p.0 as f64, b[0]) && hit(&|p| p.0 as f64, b[2]) && hit(&|p| p.1 as f64, b[1]) && hit(&|p| p.1 as f64, b[3]);
        a.missing_extremes += !ok as usize;
    }
    let max_err = |chars: &str, f: &dyn Fn([f64; 4]) -> f64| chars.chars().filter_map(|c| bounds(&face, c, 0.0, 0.0)).map(f).fold(0.0, f64::max);
    a.baseline_err = max_err(FLAT_BOTTOM, &|b| b[1].abs());
    a.cap_err = max_err(FLAT_CAP, &|b| (b[3] - cap).abs());
    a.x_err = max_err(FLAT_X, &|b| (b[3] - xh).abs());
    for ch in SYMMETRIC.chars() {
        let (Some(g), Some(b)) = (face.glyph_index(ch), bounds(&face, ch, k, xh / 2.0)) else { continue };
        let adv = face.glyph_hor_advance(g).unwrap_or(0) as f64;
        a.sb_asym = a.sb_asym.max((b[0] - (adv - b[2])).abs());
    }
    for p in KERN_PAIRS {
        let v = kern(&face, p) * upm;
        if v.abs() >= 1.0 {
            a.kern_pairs += 1;
        }
        a.kern_sum += v;
    }
    a.copyright = name(&face, name_id::COPYRIGHT_NOTICE);
    a.license = name(&face, name_id::LICENSE);
    a.license_url = name(&face, name_id::LICENSE_URL);
    a.version = name(&face, name_id::VERSION);
    a
}

struct Case {
    label: &'static str,
    spec: &'static str,
    source: &'static str,
}

const CASES: [Case; 7] = [
    Case { label: "inter plain", spec: r#"{"font":"inter","family":"Audit Plain","style":"Regular"}"#, source: "Inter-Regular.woff" },
    Case { label: "inter weight", spec: r#"{"font":"inter","family":"Audit Weight","style":"Bold","modifiers":[{"kind":"weight","amount":0.03}]}"#, source: "Inter-Regular.woff" },
    Case { label: "archivo round", spec: r#"{"font":"archivo","family":"Audit Round","style":"Regular","modifiers":[{"kind":"round","radius":0.03}]}"#, source: "ArchivoBlack-Regular.woff" },
    Case { label: "inter slant", spec: r#"{"font":"inter","family":"Audit Slant","style":"Italic","modifiers":[{"kind":"slant","angle":12}]}"#, source: "Inter-Regular.woff" },
    Case { label: "morph 50%", spec: r#"{"font":"inter","family":"Audit Morph","style":"Regular","morph":{"font":"playfair","t":0.5}}"#, source: "Inter-Regular.woff" },
    Case { label: "inter kerned", spec: r#"{"font":"inter","family":"Audit Kerned","style":"Regular","kerning":{"AV":-0.2,"To":0,"HH":0.05,"Hé":-0.01,"xyz":1}}"#, source: "Inter-Regular.woff" },
    Case { label: "morph missing", spec: r#"{"font":"inter","family":"Audit Missing","style":"Regular","charset":"ß´","morph":{"font":"rubik","t":0.5}}"#, source: "Inter-Regular.woff" },
];

fn engine() -> Engine {
    let mut e = Engine::new();
    for (id, f) in [("inter", "Inter-Regular.woff"), ("archivo", "ArchivoBlack-Regular.woff"), ("playfair", "PlayfairDisplay-Black.woff"), ("rubik", "RubikMonoOne-Regular.woff")] {
        e.load_font(id, &std::fs::read(format!("{FONTS}{f}")).unwrap(), 0).unwrap();
    }
    e
}

#[test]
fn font_export_audit() {
    let mut e = engine();
    let mut fails: Vec<String> = Vec::new();
    let mut check = |ok: bool, msg: String| {
        if !ok {
            fails.push(msg);
        }
    };
    println!("\n{:<15} {:>8} {:>6} {:>7} {:>6} {:>8} {:>6} {:>6} {:>7} {:>9}  names", "case", "bytes", "gpos", "points", "noext", "baseline", "cap", "x-ht", "sb-asym", "kern");
    let row = |label: &str, a: &Audit| {
        println!(
            "{:<15} {:>8} {:>6} {:>7} {:>6} {:>8.1} {:>6.1} {:>6.1} {:>7.1} {:>3}/{:<2}{:>4.0}  ©{} lic{} url{} {}",
            label,
            a.bytes,
            a.gpos,
            a.points,
            a.missing_extremes,
            a.baseline_err,
            a.cap_err,
            a.x_err,
            a.sb_asym,
            a.kern_pairs,
            KERN_PAIRS.len(),
            a.kern_sum,
            !a.copyright.is_empty() as u8,
            !a.license.is_empty() as u8,
            !a.license_url.is_empty() as u8,
            a.version
        );
    };
    let mut sources = std::collections::HashMap::new();
    for c in &CASES {
        let src = source(c.source);
        let sf = Face::parse(&src, 0).unwrap();
        let (cap, xh) = (sf.capital_height().unwrap() as f64, sf.x_height().unwrap() as f64);
        let sa = sources.entry(c.source).or_insert_with(|| audit(&src, cap, xh));
        let spec: FontSpec = serde_json::from_str(c.spec).unwrap();
        let bytes = e.export_font(&spec).unwrap();
        // CI checks the exported files with OTS and fontbakery.
        if let Ok(dir) = std::env::var("FONT_AUDIT_OUT") {
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(format!("{dir}/{}.ttf", c.label.replace([' ', '%'], "-")), &bytes).unwrap();
        }
        // A morph blends the zones towards its target's, so it is measured
        // against its own (blended) metrics.
        let a = if c.spec.contains("\"morph\"") {
            let f = Face::parse(&bytes, 0).unwrap();
            audit(&bytes, f.capital_height().unwrap() as f64, f.x_height().unwrap() as f64)
        } else {
            audit(&bytes, cap, xh)
        };
        // Every pair shapes to exactly the kerning the engine meant to write.
        let face = Face::parse(&bytes, 0).unwrap();
        let chars = drawn_chars(&face);
        let got = all_kerning(&bytes, &chars);
        let want: HashMap<(char, char), i32> =
            e.font_kerning(&spec, &chars, face.units_per_em() as f64).unwrap().into_iter().map(|(l, r, v)| ((char::from_u32(l).unwrap(), char::from_u32(r).unwrap()), v as i32)).collect();
        let bad = kern_diff(&got, &want);
        check(bad.is_empty(), format!("{}: {} of {} pairs shape wrong: {}", c.label, bad.len(), want.len(), bad.iter().take(8).cloned().collect::<Vec<_>>().join(", ")));
        if c.label != "morph missing" {
            row(&format!("src {}", c.source.split(['-', '.']).next().unwrap()), sa);
            row(c.label, &a);
        }
        let l = c.label;

        // Every export keeps the source's copyright and licence.
        check(a.copyright.contains(&sa.copyright), format!("{l}: copyright notice of the source is missing: {:?}", a.copyright));
        check(a.license_url == sa.license_url, format!("{l}: licence URL {:?} != {:?}", a.license_url, sa.license_url));
        match l {
            "inter plain" => {
                check(a.points <= sa.points * 21 / 20, format!("{l}: {} points vs {} in the source", a.points, sa.points));
                check(a.missing_extremes <= sa.missing_extremes, format!("{l}: {} glyphs miss an on-curve extreme", a.missing_extremes));
                check(a.baseline_err < 0.5 && a.cap_err < 0.5, format!("{l}: metrics moved"));
                check(a.kern_pairs == sa.kern_pairs && (a.kern_sum - sa.kern_sum).abs() <= KERN_PAIRS.len() as f64, format!("{l}: kerning {}/{} vs {}/{}", a.kern_pairs, a.kern_sum, sa.kern_pairs, sa.kern_sum));
                // Same units per em, so every pair keeps the source's exact value.
                let bad = kern_diff(&got, &all_kerning(&src, &chars));
                check(bad.is_empty() && got.len() > 1000, format!("{l}: {} of {} pairs differ from the source: {}", bad.len(), got.len(), bad.iter().take(8).cloned().collect::<Vec<_>>().join(", ")));
                // Class kerning: under half the 4 bytes a pair takes in format 1.
                check(a.gpos < got.len() * 2, format!("{l}: GPOS is {} bytes for {} pairs", a.gpos, got.len()));
                println!("{l}: {} pairs in {} bytes of GPOS", got.len(), a.gpos);
            }
            "inter kerned" => {
                let src_k = all_kerning(&src, &chars);
                let upm = face.units_per_em() as f64;
                let want_pairs = [(('A', 'V'), -0.2), (('T', 'o'), 0.0), (('H', 'H'), 0.05), (('H', 'é'), -0.01)].map(|(p, v)| (p, (v * upm).round() as i32));
                for ((l, r), v) in want_pairs {
                    check(got.get(&(l, r)).copied().unwrap_or(0) == v, format!("{l}: override {l}{r} = {:?}, want {v}", got.get(&(l, r))));
                }
                check(src_k.get(&('T', 'o')).is_some_and(|v| *v != 0), format!("{l}: Inter should kern To"));
                let rest = |m: &HashMap<(char, char), i32>| m.iter().filter(|(k, _)| !want_pairs.iter().any(|w| w.0 == **k)).map(|(k, v)| (*k, *v)).collect::<HashMap<_, _>>();
                check(kern_diff(&rest(&got), &rest(&src_k)).is_empty(), format!("{l}: overrides changed other pairs"));
                // What the kerning editor lists: the font's own pairs, overrides left out.
                let table = e.kerning_table(&spec).unwrap();
                let listed: HashMap<String, f64> = table.pairs.into_iter().collect();
                let missing: Vec<String> = src_k.iter().filter(|(p, &v)| listed.get(&format!("{}{}", p.0, p.1)) != Some(&(v as f64 / upm))).map(|(p, v)| format!("{}{} {v}", p.0, p.1)).collect();
                check(table.units_per_em as f64 == upm && missing.is_empty(), format!("{l}: kerning table misses {} pairs: {}", missing.len(), missing.iter().take(8).cloned().collect::<Vec<_>>().join(", ")));
                check(listed.len() == src_k.len(), format!("{l}: kerning table lists {} pairs, the source has {}", listed.len(), src_k.len()));
            }
            "inter weight" => {
                check(a.baseline_err <= 2.0, format!("{l}: flat letters sit {:.1} units off the baseline", a.baseline_err));
                check(a.cap_err <= 3.0 && a.x_err <= 3.0, format!("{l}: cap/x-height off by {:.1}/{:.1}", a.cap_err, a.x_err));
                check(a.kern_pairs >= sa.kern_pairs - 1, format!("{l}: kerning lost"));
            }
            "archivo round" => {
                check(a.baseline_err <= 1.0, format!("{l}: baseline off by {:.1}", a.baseline_err));
                check(a.kern_pairs >= sa.kern_pairs - 1, format!("{l}: kerning lost"));
            }
            "inter slant" => {
                check(a.sb_asym <= sa.sb_asym + 4.0, format!("{l}: slanted sidebearings unbalanced by {:.1} (source {:.1})", a.sb_asym, sa.sb_asym));
                check(a.missing_extremes <= sa.missing_extremes + 2, format!("{l}: {} glyphs miss an on-curve extreme", a.missing_extremes));
                check(a.kern_pairs == sa.kern_pairs, format!("{l}: kerning lost"));
            }
            "morph 50%" => {
                // Curves are blended point for point, not resampled and refit.
                check(a.points <= sa.points * 2, format!("{l}: {} points vs {} in the source", a.points, sa.points));
                check(a.baseline_err <= 2.0, format!("{l}: flat letters sit {:.1} units off the baseline", a.baseline_err));
                check(a.cap_err <= 2.0 && a.x_err <= 2.0, format!("{l}: cap/x-height off the blended metrics by {:.1}/{:.1}", a.cap_err, a.x_err));
                check(a.kern_pairs >= sa.kern_pairs / 2, format!("{l}: kerning lost ({} pairs)", a.kern_pairs));
            }
            "morph missing" => {
                // Rubik Mono One has no ß or ´: those glyphs must stay Inter's, not blend into .notdef.
                let face = Face::parse(&bytes, 0).unwrap();
                for ch in ['ß', '´'] {
                    let got = bounds(&face, ch, 0.0, 0.0).unwrap();
                    let want = bounds(&sf, ch, 0.0, 0.0).unwrap();
                    let d = (0..4).map(|i| (got[i] - want[i]).abs()).fold(0.0, f64::max);
                    check(d <= 1.0, format!("{l}: {ch} drifted {d:.0} units from the base glyph"));
                }
            }
            _ => {}
        }
    }
    // Each export gets its own version, so reinstalling replaces the old one.
    let spec = |v: &str| serde_json::from_str::<FontSpec>(&format!(r#"{{"font":"inter","family":"Audit Version","charset":"A","version":"{v}"}}"#)).unwrap();
    let v = audit(&e.export_font(&spec("1.004")).unwrap(), 0.0, 0.0).version;
    check(v == "Version 1.004", format!("version string {v:?}"));
    println!();
    assert!(fails.is_empty(), "font audit failed:\n  {}", fails.join("\n  "));
}
