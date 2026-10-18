//! Rough timing of common edits: `cargo run --release --example bench`.
use morpho_core::{Document, Engine, SvgOpts};
use std::time::Instant;

/// A 2000-point marker scribble across a 1000 px area.
fn scribble() -> String {
    let pts: Vec<String> = (0..2000)
        .map(|k| {
            let t = k as f64 / 2000.0 * 40.0;
            format!("[{:.1},{:.1},0]", 450.0 * (t * 0.37).sin() + 40.0 * t.cos(), 450.0 * (t * 0.23).cos() + 40.0 * t.sin())
        })
        .collect();
    format!(r#"{{"layers":[{{"id":"s","content":{{"type":"stroke","points":[{}],"width":18,"taper":0.1,"smooth":0.5}}}}]}}"#, pts.join(","))
}

fn main() {
    let fonts = concat!(env!("CARGO_MANIFEST_DIR"), "/../../ui/public/fonts/");
    let mut e = Engine::new();
    for (id, f) in [("archivo", "ArchivoBlack-Regular.woff"), ("playfair", "PlayfairDisplay-Black.woff"), ("pacifico", "Pacifico-Regular.woff")] {
        e.load_font(id, &std::fs::read(format!("{fonts}{f}")).unwrap(), 0).unwrap();
    }
    let out_dir = std::env::args().nth(1);
    let cases = [
        ("plain", r#"{"kind":"slant","angle":0}"#, ""),
        ("weight", r#"{"kind":"weight","amount":0.04}"#, ""),
        ("round", r#"{"kind":"round","radius":0.04}"#, ""),
        ("ink", r#"{"kind":"ink","amount":0.02,"scale":0.4,"seed":3}"#, ""),
        ("pixel", r#"{"kind":"pixelate","size":0.07}"#, ""),
        ("melt", r#"{"kind":"melt","amount":0.35,"scale":0.5,"seed":4}"#, ""),
        ("arc", r#"{"kind":"arc","bend":0.5}"#, ""),
        ("outline", r#"{"kind":"outline","width":0.04}"#, ""),
        ("morph", r#"{"kind":"slant","angle":0}"#, r#","morph":{"font":"pacifico","t":0.5}"#),
        ("slice", r#"{"kind":"slice","count":10,"gap":0.04,"ring":0.4}"#, ""),
        ("repeat", r#"{"kind":"repeat","mode":"grid","cols":3,"rows":2}"#, ""),
        ("fuse", r#"{"kind":"fuse","amount":0.15}"#, ""),
        ("fitCirc", r#"{"kind":"fitCircle","amount":1}"#, ""),
        ("arc360", r#"{"kind":"arc","bend":2}"#, ""),
        ("dissolve", r#"{"kind":"pixelate","size":0.05,"gap":0.1,"dissolve":0.8}"#, ""),
    ];
    // Shapes: a big sliced square (the "Sun stamp" template) and a radial repeat.
    for (name, json) in <[(&str, &str); 6]>::from([
        ("echo big", r#"{"layers":[{"id":"s","sy":1.9,"modifiers":[{"kind":"outline","width":0.03},{"kind":"echo","count":6,"spacing":0.32,"width":0.03}],"content":{"type":"symbol","symbol":{"kind":"blob","lobes":5,"depth":0.05,"seed":3,"wobble":0.4},"size":200}}]}"#),
        ("echo+wob", r#"{"layers":[{"id":"s","sy":1.9,"modifiers":[{"kind":"outline","width":0.03},{"kind":"echo","count":6,"spacing":0.32,"width":0.03},{"kind":"wobble","amount":0.05,"scale":0.6,"seed":4}],"content":{"type":"symbol","symbol":{"kind":"blob","lobes":5,"depth":0.05,"seed":3,"wobble":0.4},"size":200}}]}"#),
        ("sym slice", r#"{"layers":[{"id":"s","modifiers":[{"kind":"slice","count":11,"gap":0.034,"ring":0.36,"jitter":0.85,"seed":4,"soften":0.03},{"kind":"wobble","amount":0.004,"scale":0.12}],"content":{"type":"symbol","symbol":{"kind":"roundRect","radius":0.05},"size":900}}]}"#),
        ("sym round", r#"{"layers":[{"id":"s","modifiers":[{"kind":"round","radius":0.03}],"content":{"type":"symbol","symbol":{"kind":"roundRect","radius":0.05},"size":900}}]}"#),
        ("scribble", Box::leak(scribble().into_boxed_str())),
        ("sym rep", r#"{"layers":[{"id":"s","modifiers":[{"kind":"repeat","count":12,"radius":2}],"content":{"type":"symbol","symbol":{"kind":"star"},"size":120}}]}"#),
    ]) {
        let doc: Document = serde_json::from_str(json).unwrap();
        let t0 = Instant::now();
        let out = e.build(&doc);
        println!("{name:9} cold {:>7.2?}  points {}", t0.elapsed(), out.points);
    }
    for (name, m, extra) in cases {
        let json = format!(
            r#"{{"layers":[{{"id":"t","modifiers":[{m}],"content":{{"type":"text","text":"Morphotype","font":"archivo","size":200{extra}}}}}]}}"#
        );
        let doc: Document = serde_json::from_str(&json).unwrap();
        let t0 = Instant::now();
        let out = e.build(&doc);
        let cold = t0.elapsed();
        let t1 = Instant::now();
        e.build(&doc);
        let warm = t1.elapsed();
        println!("{name:8} cold {:>7.2?}  cached {:>7.2?}  points {}", cold, warm, out.points);
        if let Some(dir) = &out_dir {
            std::fs::write(format!("{dir}/{name}.svg"), e.export_svg(&doc, &SvgOpts { padding: 0.05, ..Default::default() })).unwrap();
        }
    }
}
