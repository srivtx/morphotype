//! SVG path data: writing (compact) and parsing (full path grammar, arcs included).

use crate::geom::{pt, CurveContour, CurveShape, Pt, Rect, Seg, Shape};
use std::fmt::Write;

fn num(out: &mut String, v: f64, decimals: usize) {
    let v = if v.abs() < 0.5 * 10f64.powi(-(decimals as i32)) { 0.0 } else { v };
    let mut s = format!("{:.*}", decimals, v);
    if s.contains('.') {
        while s.ends_with('0') {
            s.pop();
        }
        if s.ends_with('.') {
            s.pop();
        }
    }
    out.push_str(&s);
}

fn pair(out: &mut String, p: Pt, decimals: usize) {
    num(out, p.x, decimals);
    out.push(' ');
    num(out, p.y, decimals);
}

/// Polylines as `M … L … Z` path data.
pub fn poly_d(s: &Shape, decimals: usize) -> String {
    let mut out = String::with_capacity(s.point_count() * 14);
    for c in &s.contours {
        if c.len() < 3 {
            continue;
        }
        out.push('M');
        pair(&mut out, c[0], decimals);
        out.push('L');
        for (i, &p) in c[1..].iter().enumerate() {
            if i > 0 {
                out.push(' ');
            }
            pair(&mut out, p, decimals);
        }
        out.push('Z');
    }
    out
}

/// Curve contours as path data.
pub fn curves_d(cs: &[CurveContour], decimals: usize) -> String {
    let mut out = String::new();
    for c in cs {
        if c.segs.is_empty() {
            continue;
        }
        out.push('M');
        pair(&mut out, c.start, decimals);
        let n = c.segs.len();
        for (i, s) in c.segs.iter().enumerate() {
            match *s {
                Seg::Line(p) => {
                    // The closing line is implied by Z.
                    if i + 1 == n && p.dist(c.start) < 1e-9 {
                        continue;
                    }
                    out.push('L');
                    pair(&mut out, p, decimals);
                }
                Seg::Quad(a, p) => {
                    out.push('Q');
                    pair(&mut out, a, decimals);
                    out.push(' ');
                    pair(&mut out, p, decimals);
                }
                Seg::Cubic(a, b, p) => {
                    out.push('C');
                    pair(&mut out, a, decimals);
                    out.push(' ');
                    pair(&mut out, b, decimals);
                    out.push(' ');
                    pair(&mut out, p, decimals);
                }
            }
        }
        out.push('Z');
    }
    out
}

/// A standalone SVG document for a path.
pub fn document(d: &str, bbox: Rect, pad: f64, fill: &str, background: Option<&str>) -> String {
    let (x, y, w, h) = if bbox.is_empty() {
        (0.0, 0.0, 100.0, 100.0)
    } else {
        (bbox.x0 - pad, bbox.y0 - pad, bbox.width() + 2.0 * pad, bbox.height() + 2.0 * pad)
    };
    let mut s = String::new();
    let _ = write!(
        s,
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x:.2} {y:.2} {w:.2} {h:.2}" width="{w:.0}" height="{h:.0}">"#
    );
    if let Some(bg) = background {
        let _ = write!(s, r#"<rect x="{x:.2}" y="{y:.2}" width="{w:.2}" height="{h:.2}" fill="{}"/>"#, escape(bg));
    }
    let _ = write!(s, r#"<path fill="{}" fill-rule="nonzero" d="{}"/></svg>"#, escape(fill), d);
    s
}

fn escape(v: &str) -> String {
    v.chars().filter(|c| c.is_ascii_alphanumeric() || "#(),.% -".contains(*c)).collect()
}

struct Lexer<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Lexer<'a> {
    fn skip(&mut self) {
        while self.i < self.b.len() && (self.b[self.i].is_ascii_whitespace() || self.b[self.i] == b',') {
            self.i += 1;
        }
    }
    fn peek_cmd(&mut self) -> Option<u8> {
        self.skip();
        self.b.get(self.i).copied().filter(|c| c.is_ascii_alphabetic() && *c != b'e' && *c != b'E')
    }
    fn number(&mut self) -> Option<f64> {
        self.skip();
        let start = self.i;
        let b = self.b;
        if self.i < b.len() && (b[self.i] == b'+' || b[self.i] == b'-') {
            self.i += 1;
        }
        let mut dot = false;
        while self.i < b.len() && (b[self.i].is_ascii_digit() || (b[self.i] == b'.' && !dot)) {
            if b[self.i] == b'.' {
                dot = true;
            }
            self.i += 1;
        }
        if self.i < b.len() && (b[self.i] == b'e' || b[self.i] == b'E') {
            let save = self.i;
            self.i += 1;
            if self.i < b.len() && (b[self.i] == b'+' || b[self.i] == b'-') {
                self.i += 1;
            }
            let ds = self.i;
            while self.i < b.len() && b[self.i].is_ascii_digit() {
                self.i += 1;
            }
            if ds == self.i {
                self.i = save;
            }
        }
        if start == self.i {
            return None;
        }
        std::str::from_utf8(&b[start..self.i]).ok()?.parse().ok()
    }
    fn point(&mut self) -> Result<Pt, String> {
        let x = self.number().ok_or("Expected a number in path data.")?;
        let y = self.number().ok_or("Expected a number in path data.")?;
        Ok(pt(x, y))
    }
    fn flag(&mut self) -> Option<bool> {
        self.skip();
        let c = *self.b.get(self.i)?;
        if c == b'0' || c == b'1' {
            self.i += 1;
            Some(c == b'1')
        } else {
            None
        }
    }
    fn has_number(&mut self) -> bool {
        self.skip();
        matches!(self.b.get(self.i), Some(c) if c.is_ascii_digit() || *c == b'-' || *c == b'+' || *c == b'.')
    }
}

/// Endpoint-parameterised elliptical arc → cubic segments.
fn arc_to_cubics(p0: Pt, rx: f64, ry: f64, phi_deg: f64, large: bool, sweep: bool, p1: Pt, out: &mut Vec<Seg>) {
    let (mut rx, mut ry) = (rx.abs(), ry.abs());
    if rx < 1e-12 || ry < 1e-12 || p0.dist(p1) < 1e-12 {
        out.push(Seg::Line(p1));
        return;
    }
    let phi = phi_deg.to_radians();
    let (s, c) = phi.sin_cos();
    let dx = (p0.x - p1.x) / 2.0;
    let dy = (p0.y - p1.y) / 2.0;
    let x1 = c * dx + s * dy;
    let y1 = -s * dx + c * dy;
    let lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if lam > 1.0 {
        rx *= lam.sqrt();
        ry *= lam.sqrt();
    }
    let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    let den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let mut k = (num / den).max(0.0).sqrt();
    if large == sweep {
        k = -k;
    }
    let cx1 = k * rx * y1 / ry;
    let cy1 = -k * ry * x1 / rx;
    let cx = c * cx1 - s * cy1 + (p0.x + p1.x) / 2.0;
    let cy = s * cx1 + c * cy1 + (p0.y + p1.y) / 2.0;
    let ang = |ux: f64, uy: f64, vx: f64, vy: f64| (ux * vy - uy * vx).atan2(ux * vx + uy * vy);
    let t1 = ang(1.0, 0.0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let mut dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if !sweep && dt > 0.0 {
        dt -= std::f64::consts::TAU;
    } else if sweep && dt < 0.0 {
        dt += std::f64::consts::TAU;
    }
    let n = (dt.abs() / (std::f64::consts::PI / 2.0)).ceil().max(1.0) as usize;
    let step = dt / n as f64;
    let alpha = 4.0 / 3.0 * (step / 4.0).tan();
    let at = |t: f64| -> (Pt, Pt) {
        let (st, ct) = t.sin_cos();
        let p = pt(cx + rx * ct * c - ry * st * s, cy + rx * ct * s + ry * st * c);
        let d = pt(-rx * st * c - ry * ct * s, -rx * st * s + ry * ct * c);
        (p, d)
    };
    for i in 0..n {
        let ta = t1 + step * i as f64;
        let tb = ta + step;
        let (pa, da) = at(ta);
        let (pb, db) = at(tb);
        let end = if i + 1 == n { p1 } else { pb };
        out.push(Seg::Cubic(pa + da * alpha, pb - db * alpha, end));
    }
}

/// Parse SVG path data into closed curve contours (open subpaths are closed).
pub fn parse_path(d: &str) -> Result<CurveShape, String> {
    Ok(parse_subpaths(d)?
        .into_iter()
        .map(|(mut c, _)| {
            let end = c.end();
            if end.dist(c.start) > 1e-9 {
                c.segs.push(Seg::Line(c.start));
            }
            c
        })
        .collect())
}

/// Parse SVG path data into subpaths as drawn, each with whether it was
/// closed with Z (open ones are lines, for stroking).
pub fn parse_subpaths(d: &str) -> Result<Vec<(CurveContour, bool)>, String> {
    let mut lx = Lexer { b: d.as_bytes(), i: 0 };
    let mut out: Vec<(CurveContour, bool)> = Vec::new();
    let mut cur: Option<CurveContour> = None;
    let mut pos = Pt::default();
    let mut start = Pt::default();
    let mut last_ctrl: Option<(u8, Pt)> = None;
    let mut cmd = 0u8;
    let close = |cur: &mut Option<CurveContour>, out: &mut Vec<(CurveContour, bool)>, closed: bool| {
        if let Some(c) = cur.take() {
            if !c.segs.is_empty() {
                out.push((c, closed));
            }
        }
    };
    loop {
        if let Some(c) = lx.peek_cmd() {
            lx.i += 1;
            cmd = c;
        } else if !lx.has_number() {
            break;
        } else if cmd == 0 {
            return Err("Path data must start with a command.".into());
        }
        let rel = cmd.is_ascii_lowercase();
        let base = if rel { pos } else { Pt::default() };
        match cmd.to_ascii_uppercase() {
            b'M' => {
                close(&mut cur, &mut out, false);
                pos = base + lx.point()?;
                start = pos;
                cur = Some(CurveContour { start: pos, segs: Vec::new() });
                // Subsequent pairs are implicit line-tos.
                cmd = if rel { b'l' } else { b'L' };
                last_ctrl = None;
                continue;
            }
            b'L' => {
                pos = base + lx.point()?;
                cur.get_or_insert(CurveContour { start, segs: Vec::new() }).segs.push(Seg::Line(pos));
                last_ctrl = None;
            }
            b'H' => {
                let x = lx.number().ok_or("Expected a number.")?;
                pos = pt(if rel { pos.x + x } else { x }, pos.y);
                cur.get_or_insert(CurveContour { start, segs: Vec::new() }).segs.push(Seg::Line(pos));
                last_ctrl = None;
            }
            b'V' => {
                let y = lx.number().ok_or("Expected a number.")?;
                pos = pt(pos.x, if rel { pos.y + y } else { y });
                cur.get_or_insert(CurveContour { start, segs: Vec::new() }).segs.push(Seg::Line(pos));
                last_ctrl = None;
            }
            b'C' | b'S' => {
                let is_s = cmd.eq_ignore_ascii_case(&b'S');
                let c1 = if is_s {
                    match last_ctrl {
                        Some((b'C', c)) => pos * 2.0 - c,
                        _ => pos,
                    }
                } else {
                    base + lx.point()?
                };
                let c2 = base + lx.point()?;
                let e = base + lx.point()?;
                cur.get_or_insert(CurveContour { start, segs: Vec::new() }).segs.push(Seg::Cubic(c1, c2, e));
                last_ctrl = Some((b'C', c2));
                pos = e;
            }
            b'Q' | b'T' => {
                let is_t = cmd.eq_ignore_ascii_case(&b'T');
                let c1 = if is_t {
                    match last_ctrl {
                        Some((b'Q', c)) => pos * 2.0 - c,
                        _ => pos,
                    }
                } else {
                    base + lx.point()?
                };
                let e = base + lx.point()?;
                cur.get_or_insert(CurveContour { start, segs: Vec::new() }).segs.push(Seg::Quad(c1, e));
                last_ctrl = Some((b'Q', c1));
                pos = e;
            }
            b'A' => {
                let rx = lx.number().ok_or("Bad arc.")?;
                let ry = lx.number().ok_or("Bad arc.")?;
                let rot = lx.number().ok_or("Bad arc.")?;
                let large = lx.flag().ok_or("Bad arc flag.")?;
                let sweep = lx.flag().ok_or("Bad arc flag.")?;
                let e = base + lx.point()?;
                let c = cur.get_or_insert(CurveContour { start, segs: Vec::new() });
                arc_to_cubics(pos, rx, ry, rot, large, sweep, e, &mut c.segs);
                pos = e;
                last_ctrl = None;
            }
            b'Z' => {
                close(&mut cur, &mut out, true);
                pos = start;
                last_ctrl = None;
                cmd = 0;
                continue;
            }
            other => return Err(format!("Unsupported path command '{}'.", other as char)),
        }
    }
    close(&mut cur, &mut out, false);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::{flatten_curves, signed_area};

    #[test]
    fn roundtrip_and_relative_commands() {
        let cs = parse_path("m10 10 h20 v20 h-20 z M50,50 L60 50 60 60 Z").unwrap();
        assert_eq!(cs.len(), 2);
        let s = flatten_curves(&cs, 0.1);
        assert!((signed_area(&s.contours[0]) - 400.0).abs() < 1e-9);
        let d = curves_d(&cs, 2);
        let again = parse_path(&d).unwrap();
        assert_eq!(again, cs);
    }

    #[test]
    fn arcs_make_circles() {
        let cs = parse_path("M0 -10 A10 10 0 1 1 0 10 A10 10 0 1 1 0 -10Z").unwrap();
        let a = signed_area(&cs[0].flatten(0.01)).abs();
        assert!((a - std::f64::consts::PI * 100.0).abs() < 0.5, "{a}");
    }

    #[test]
    fn numbers_without_separators() {
        let cs = parse_path("M0-1.5.5.5L1e1,0z").unwrap();
        assert_eq!(cs[0].start, pt(0.0, -1.5));
        assert_eq!(cs[0].segs[0], Seg::Line(pt(0.5, 0.5)));
        assert_eq!(cs[0].segs[1], Seg::Line(pt(10.0, 0.0)));
    }

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        assert!(parse_path("M 1").is_err());
        assert!(parse_path("12 13").is_err());
        assert!(parse_path("M0 0 X").is_err());
    }
}
