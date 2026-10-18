//! Rough timing of common edits: `cargo run --release --example bench`.
use morpho_core::{Document, Engine, SvgOpts};
use std::time::Instant;

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
    ];
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
