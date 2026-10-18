//! WebAssembly surface of the engine. Everything crosses the boundary as
//! JSON strings or byte slices; the engine itself lives in a thread-local so
//! caches persist between calls (the UI runs this inside a Web Worker).

use morpho_core::{Document, Engine, FontSpec, SvgOpts, TraceOpts};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    static ENGINE: RefCell<Engine> = RefCell::new(Engine::new());
}

fn parse<T: serde::de::DeserializeOwned>(json: &str, what: &str) -> Result<T, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("Invalid {what}: {e}")))
}

/// Load (or replace) a font. Returns its metadata as JSON.
#[wasm_bindgen(js_name = loadFont)]
pub fn load_font(id: &str, bytes: &[u8], index: u32) -> Result<String, JsError> {
    ENGINE.with(|e| {
        let info = e.borrow_mut().load_font(id, bytes, index).map_err(|m| JsError::new(&m))?;
        serde_json::to_string(&info).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen(js_name = unloadFont)]
pub fn unload_font(id: &str) {
    ENGINE.with(|e| e.borrow_mut().unload_font(id));
}

/// Build a document. Returns `{ d, bbox, layers, points }` as JSON.
#[wasm_bindgen]
pub fn build(doc_json: &str) -> Result<String, JsError> {
    let doc: Document = parse(doc_json, "document")?;
    ENGINE.with(|e| serde_json::to_string(&e.borrow_mut().build(&doc)).map_err(|e| JsError::new(&e.to_string())))
}

#[wasm_bindgen(js_name = exportSvg)]
pub fn export_svg(doc_json: &str, opts_json: &str) -> Result<String, JsError> {
    let doc: Document = parse(doc_json, "document")?;
    let opts: SvgOpts = parse(opts_json, "SVG options")?;
    Ok(ENGINE.with(|e| e.borrow_mut().export_svg(&doc, &opts)))
}

/// Compile a TrueType font from a font spec.
#[wasm_bindgen(js_name = exportFont)]
pub fn export_font(spec_json: &str) -> Result<Vec<u8>, JsError> {
    let spec: FontSpec = parse(spec_json, "font spec")?;
    ENGINE.with(|e| e.borrow_mut().export_font(&spec).map_err(|m| JsError::new(&m)))
}

/// Trace RGBA pixels. Returns `{ d, contours, aspect }` as JSON.
#[wasm_bindgen(js_name = traceImage)]
pub fn trace_image(rgba: &[u8], width: u32, height: u32, opts_json: &str) -> Result<String, JsError> {
    let opts: TraceOpts = parse(opts_json, "trace options")?;
    ENGINE.with(|e| {
        let out = e.borrow_mut().trace_image(rgba, width as usize, height as usize, &opts).map_err(|m| JsError::new(&m))?;
        serde_json::to_string(&out).map_err(|e| JsError::new(&e.to_string()))
    })
}
