//! Measure outlines on a reference picture: `refpath mask.pgm [smooth] [tol] [corner°]`.
//!
//! Reads a binary PGM (P5) ink mask cut from a reference (white = ink),
//! traces it with the app's own tracer and fits Bézier curves, then prints
//! path data in the picture's pixels, ready for a template's `pen()`.
use morpho_core::fit::fit_shape;
use morpho_core::svg::curves_d;
use morpho_core::trace::{trace, TraceOpts};

fn read_pgm(path: &str) -> (Vec<u8>, usize, usize) {
    let data = std::fs::read(path).expect("read mask");
    let mut fields = Vec::new();
    let mut i = 0;
    while fields.len() < 4 {
        while data[i].is_ascii_whitespace() {
            i += 1;
        }
        if data[i] == b'#' {
            while data[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        let s = i;
        while !data[i].is_ascii_whitespace() {
            i += 1;
        }
        fields.push(String::from_utf8_lossy(&data[s..i]).to_string());
    }
    assert_eq!(fields[0], "P5", "binary PGM only");
    let (w, h): (usize, usize) = (fields[1].parse().unwrap(), fields[2].parse().unwrap());
    let px = &data[i + 1..i + 1 + w * h];
    // Ink is white in the mask; the tracer reads alpha as ink.
    let rgba = px.iter().flat_map(|&v| [0, 0, 0, v]).collect();
    (rgba, w, h)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let path = a.get(1).expect("usage: refpath mask.pgm [smooth] [tol] [corner°]");
    let smooth = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(0.6);
    let tol = a.get(3).and_then(|s| s.parse().ok()).unwrap_or(0.6);
    let corner = a.get(4).and_then(|s| s.parse().ok()).unwrap_or(40.0);
    let (rgba, w, h) = read_pgm(path);
    let opts = TraceOpts { threshold: Some(0.5), smooth, despeckle: 6.0, max_size: 8192, frame: true, ..TraceOpts::default() };
    let shape = trace(&rgba, w, h, &opts).expect("trace");
    println!("{}", curves_d(&fit_shape(&shape, tol, corner), 1));
}
