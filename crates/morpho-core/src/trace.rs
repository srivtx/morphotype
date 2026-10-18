//! Raster image → vector outline.
//!
//! Smooth mode runs marching squares directly on the (optionally blurred)
//! ink intensity, which gives sub-pixel accurate, naturally smooth contours.
//! Pixel mode keeps hard pixel edges for pixel-art marks.

use crate::field::{block_contours, box_blur, extract, Grid};
use crate::geom::{pt, Shape};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TraceOpts {
    /// Ink threshold in 0..1; `None` picks one automatically (Otsu).
    pub threshold: Option<f64>,
    /// Trace light-on-dark instead of dark-on-light (or holes instead of opaque areas).
    pub invert: bool,
    /// Blur radius in pixels before tracing; larger = smoother, rounder outlines.
    pub smooth: f64,
    /// Drop specks smaller than this many square pixels.
    pub despeckle: f64,
    /// Keep hard pixel edges.
    pub pixel: bool,
    /// Longest side is downsampled to at most this many pixels.
    pub max_size: usize,
}

impl Default for TraceOpts {
    fn default() -> Self {
        TraceOpts { threshold: None, invert: false, smooth: 1.0, despeckle: 16.0, pixel: false, max_size: 1400 }
    }
}

/// Per-pixel ink amount in 0..1 from RGBA.
fn ink(rgba: &[u8], w: usize, h: usize, invert: bool) -> Vec<f32> {
    let n = w * h;
    let transparent = rgba.chunks_exact(4).take(n).filter(|p| p[3] < 250).count();
    let use_alpha = transparent > n / 50;
    rgba.chunks_exact(4)
        .take(n)
        .map(|p| {
            let a = p[3] as f32 / 255.0;
            let v = if use_alpha {
                a
            } else {
                let lum = (0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32) / 255.0;
                1.0 - lum
            };
            if invert { 1.0 - v } else { v }
        })
        .collect()
}

fn downsample(v: &[f32], w: usize, h: usize, f: usize) -> (Vec<f32>, usize, usize) {
    if f <= 1 {
        return (v.to_vec(), w, h);
    }
    let (nw, nh) = (w.div_ceil(f), h.div_ceil(f));
    let mut out = vec![0f32; nw * nh];
    for j in 0..nh {
        for i in 0..nw {
            let mut s = 0.0;
            let mut c = 0.0;
            for y in j * f..((j + 1) * f).min(h) {
                for x in i * f..((i + 1) * f).min(w) {
                    s += v[y * w + x];
                    c += 1.0;
                }
            }
            out[j * nw + i] = if c > 0.0 { s / c } else { 0.0 };
        }
    }
    (out, nw, nh)
}

/// Otsu's threshold on a 0..1 signal.
pub fn otsu(v: &[f32]) -> f64 {
    let mut hist = [0u64; 256];
    for &x in v {
        hist[(x.clamp(0.0, 1.0) * 255.0) as usize] += 1;
    }
    let total: u64 = hist.iter().sum();
    if total == 0 {
        return 0.5;
    }
    let sum_all: f64 = hist.iter().enumerate().map(|(i, &c)| i as f64 * c as f64).sum();
    let (mut wb, mut sb) = (0f64, 0f64);
    let mut between = [0f64; 256];
    for (t, &c) in hist.iter().enumerate() {
        wb += c as f64;
        sb += t as f64 * c as f64;
        let wf = total as f64 - wb;
        if wb == 0.0 || wf == 0.0 {
            continue;
        }
        let mb = sb / wb;
        let mf = (sum_all - sb) / wf;
        between[t] = wb * wf * (mb - mf) * (mb - mf);
    }
    let max = between.iter().cloned().fold(0.0, f64::max);
    if max <= 0.0 {
        return 0.5;
    }
    // Bimodal images have a plateau of equally good thresholds; take its middle.
    let good: Vec<usize> = (0..256).filter(|&t| between[t] >= max * (1.0 - 1e-9)).collect();
    let mid = (good[0] + good[good.len() - 1]) as f64 * 0.5;
    (mid + 0.5) / 255.0
}

/// Trace an RGBA image. Output is in source pixel coordinates (y-down).
pub fn trace(rgba: &[u8], w: usize, h: usize, o: &TraceOpts) -> Result<Shape, String> {
    if w == 0 || h == 0 || rgba.len() < w * h * 4 {
        return Err("The image is empty or truncated.".into());
    }
    let raw = ink(rgba, w, h, o.invert);
    let f = w.max(h).div_ceil(o.max_size.clamp(64, 8192));
    let (mut v, sw, sh) = downsample(&raw, w, h, f);
    let threshold = o.threshold.unwrap_or_else(|| otsu(&v)).clamp(0.01, 0.99) as f32;
    let scale = f as f64;
    // Two pixels of empty padding guarantee closed contours.
    let pad = 2usize;
    let (gw, gh) = (sw + 2 * pad, sh + 2 * pad);
    let mut padded = vec![0f32; gw * gh];
    for j in 0..sh {
        padded[(j + pad) * gw + pad..(j + pad) * gw + pad + sw].copy_from_slice(&v[j * sw..(j + 1) * sw]);
    }
    v = padded;
    let origin = pt(-(pad as f64) * scale, -(pad as f64) * scale);
    let min_area = o.despeckle.max(0.0);
    let shape = if o.pixel {
        let mask: Vec<u8> = v.iter().map(|&x| (x > threshold) as u8).collect();
        let s = block_contours(&mask, gw, gh, origin, scale);
        Shape::new(s.contours.into_iter().filter(|c| crate::geom::signed_area(c).abs() >= min_area).collect())
    } else {
        let r = o.smooth.clamp(0.0, 32.0) / scale;
        if r >= 0.5 {
            box_blur(&mut v, gw, gh, r.round() as usize, 3);
        }
        // Inside where ink > threshold ⇔ (threshold − ink) < 0.
        for x in &mut v {
            *x = threshold - *x;
        }
        // Sample (i, j) is the centre of downsampled pixel (i − pad, j − pad).
        let g = Grid { w: gw, h: gh, origin, cell: scale };
        extract(&v, &g, 0.0, 0.3 * scale, min_area)
    };
    Ok(shape)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disc_image(n: usize, r: f64, dark: bool) -> Vec<u8> {
        let mut img = vec![255u8; n * n * 4];
        for j in 0..n {
            for i in 0..n {
                let dx = i as f64 + 0.5 - n as f64 / 2.0;
                let dy = j as f64 + 0.5 - n as f64 / 2.0;
                if (dx * dx + dy * dy).sqrt() < r {
                    let k = (j * n + i) * 4;
                    let v = if dark { 0 } else { 255 };
                    img[k] = v;
                    img[k + 1] = v;
                    img[k + 2] = v;
                }
            }
        }
        img
    }

    #[test]
    fn traces_a_disc() {
        let img = disc_image(200, 60.0, true);
        let s = trace(&img, 200, 200, &TraceOpts::default()).unwrap();
        assert_eq!(s.contours.len(), 1);
        let exact = std::f64::consts::PI * 3600.0;
        assert!((s.area() - exact).abs() / exact < 0.03, "{}", s.area());
        let c = s.bbox().center();
        assert!((c.x - 100.0).abs() < 1.0 && (c.y - 100.0).abs() < 1.0, "{c:?}");
    }

    #[test]
    fn pixel_mode_and_bad_input() {
        let img = disc_image(40, 10.0, true);
        let s = trace(&img, 40, 40, &TraceOpts { pixel: true, despeckle: 0.0, ..Default::default() }).unwrap();
        assert_eq!(s.contours.len(), 1);
        assert!(trace(&img, 400, 400, &TraceOpts::default()).is_err());
    }
}
