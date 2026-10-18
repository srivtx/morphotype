//! Write SVGs of a font-to-font morph at several t values:
//! `cargo run --release --example morph_strip -- <out-dir> [text]`.
use morpho_core::{Document, Engine, SvgOpts};

fn main() {
    let fonts = concat!(env!("CARGO_MANIFEST_DIR"), "/../../ui/public/fonts/");
    let mut e = Engine::new();
    let list = [("archivo", "ArchivoBlack-Regular.woff"), ("playfair", "PlayfairDisplay-Black.woff"), ("pacifico", "Pacifico-Regular.woff"), ("silk", "Silkscreen-Regular.woff")];
    for (id, f) in list {
        e.load_font(id, &std::fs::read(format!("{fonts}{f}")).unwrap(), 0).unwrap();
    }
    let dir = std::env::args().nth(1).expect("output directory");
    let text = std::env::args().nth(2).unwrap_or_else(|| "Rag&8".into());
    for (a, b) in [("archivo", "pacifico"), ("archivo", "playfair"), ("playfair", "silk")] {
        for t in [0.0, 0.25, 0.5, 0.75, 1.0] {
            let json = format!(r#"{{"layers":[{{"id":"t","content":{{"type":"text","text":"{text}","font":"{a}","size":200,"morph":{{"font":"{b}","t":{t}}}}}}}]}}"#);
            let doc: Document = serde_json::from_str(&json).unwrap();
            std::fs::write(format!("{dir}/m-{a}-{b}-{t:.2}.svg"), e.export_svg(&doc, &SvgOpts { padding: 0.05, ..Default::default() })).unwrap();
        }
    }
}
