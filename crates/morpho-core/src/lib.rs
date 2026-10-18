//! # morpho-core
//!
//! The Morphotype engine. Pure Rust with no platform dependencies: it runs
//! natively inside the Tauri desktop app and as WebAssembly in the browser.
//!
//! Pipeline: fonts / symbols / traced images → geometry → morph → modifier
//! stack → layer booleans → SVG path (for the GPU renderer) or exports
//! (SVG, TrueType).

pub mod engine;
pub mod field;
pub mod fit;
pub mod font;
pub mod geom;
pub mod modifiers;
pub mod morph;
pub mod noise;
pub mod stroke;
pub mod svg;
pub mod symbols;
pub mod trace;
pub mod ttf;

pub use engine::{BuildOut, Document, Engine, FontSpec, SvgOpts};
pub use trace::TraceOpts;
