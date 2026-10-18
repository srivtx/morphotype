# Morphotype

A Mac-first type and logo lab. Morph one typeface into another, reshape lettering with a stack of modifiers, trace images into vector marks, compile the result into a real installable font, and render it as liquid chrome, glow glass, puffy 3D, app icons, distressed print or neon, all in real time on the GPU.

![Templates rendered by Morphotype](docs/images/gallery.png)

## What it does

**Type and fonts**
- Loads TTF, OTF, TTC and WOFF fonts, shaped with a HarfBuzz port so kerning, ligatures and variable-font axes work.
- **Font morphing**: blends any two fonts glyph by glyph. Contours are matched by position and size, then aligned with dynamic time warping so stems, bowls and serifs line up. At 0 and 1 the result is exactly the original outline.
- **Layer morphing**: blends any two layers, for example a word into a star.
- **Make font**: compiles the current look (morph plus modifiers) into a valid `.ttf` with about 190 glyphs. On the Mac app, *Install on this Mac* puts it straight into `~/Library/Fonts`.

**Shape modifiers** (non-destructive, stackable, sized in ems)
Weight · Round corners · Outline · Ink bleed · Slant · Stretch · Wave · Arc · Wobble · Melt (drips) · Pixelate · Perspective

**Logos and symbols**
- Parametric shapes: squircle, sun badge, map pin, cursor, cloud blob, mascot eyes, cat head, star, sparkle, polygon, ring, heart, plus.
- Layer blending: **Add**, **Cut** (punch out) and **Mask** (intersect), computed as true booleans so the exported SVG and font are clean.
- **Image tracing**: PNG, JPG, WebP or SVG files become smooth vector outlines with sub-pixel accuracy, or keep hard pixel edges for pixel art.

**Effects** (GPU, live)
Liquid chrome (animatable) · Glow glass with floor reflection · Puffy inflated 3D · App-icon tile · Distressed print · Neon tube · Flat. There are 16 presets; every parameter is editable.

**Export**: PNG at 1×, 2× or 4× (optionally transparent), SVG vector outline, TrueType font, and `.morpho` project files that embed any imported fonts.

![The editor](docs/images/editor.png)

## How it's built

```
┌──────────────────────── Mac app (Tauri) ────────────────────────┐
│  React UI ──► Web Worker ──► morpho-core (Rust → WebAssembly)   │
│     │                          fonts · morph · modifiers ·      │
│     │                          booleans · tracing · TTF writer  │
│     ▼                                                           │
│  WebGL2 renderer: mask → jump-flood SDF → height map → effect   │
│                                                                 │
│  Native side (Rust): system fonts · font install · dialogs      │
└─────────────────────────────────────────────────────────────────┘
```

- **One Rust engine, everywhere.** `crates/morpho-core` is pure Rust with no platform code. It runs as WebAssembly inside a Web Worker on both the Mac app and the web, so slider drags never pay an IPC round-trip and never block the UI thread. The same crate is linked natively into the Tauri shell.
- **Robust geometry.** Weight, rounding, outlines, ink and booleans all go through one path: narrow-band exact signed distance, then marching-squares iso-contours. Overlapping strokes merge correctly, nothing self-intersects, and the source font's winding rules don't matter.
- **GPU effects.** The outline is rasterised once. A jump-flooding pass builds a signed distance field in about 12 GPU passes, which is blurred into a height map. Each effect is a single fragment shader over those textures, so changing a colour or bevel redraws in under a frame.
- **Latest-wins scheduling.** While the engine is busy, only the newest document is queued. If the WebAssembly module ever traps, the worker restarts, reloads fonts and retries.
- **Small native app.** Tauri uses the system WKWebView rather than bundling Chromium.

Typical timings (release build, a 10-letter word): plain text under 0.5 ms, weight about 8 ms, rounding about 20 ms, ink about 25 ms. Cached rebuilds when only another layer changed take about 0.3 ms. See `cargo run --release -p morpho-core --example bench`.

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting started

Prerequisites: Rust (stable), Node 22, and the WebAssembly toolchain:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129
npm install
```

| Task | Command |
| --- | --- |
| Run in the browser | `npm run dev`, then open http://localhost:1420 |
| Run the Mac app | `npm run tauri dev` |
| Build the Mac app (.app and .dmg) | `npm run tauri build` (universal binary: add `-- --target universal-apple-darwin`) |
| Build the web app | `npm run build` (output in `dist/`) |
| Rust and UI unit tests | `npm test` |
| Browser end-to-end test | `npm run build && npm run test:e2e` |

CI builds an unsigned universal `.dmg` on every push to `main` (the *Morphotype-macOS* artifact). Because it's unsigned, open it the first time with right-click → Open.

### Shortcuts

| | |
| --- | --- |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌘S / ⌘O | Save / open project |
| ⌘E | Export PNG at 2× |
| ⌘D | Duplicate layer |
| ⌘0 | Fit artboard |
| T | New text layer |
| Arrows (⇧ for 10 px) | Nudge layer |
| ⌫ | Delete layer |
| Pinch or ⌘-scroll / scroll / Space-drag | Zoom / pan / pan |

You can also drag fonts, images or `.morpho` files onto the window.

## Repository layout

```
crates/morpho-core   Rust engine (geometry, fonts, morph, modifiers, trace, TTF/SVG)
crates/morpho-wasm   wasm-bindgen bindings
src-tauri            Mac/desktop shell: system fonts, font install, dialogs
ui/src/engine        Worker + client for the engine
ui/src/render        WebGL2 renderer, SDF passes and effect shaders
ui/src/components    Editor UI
ui/public/fonts      Bundled OFL fonts
scripts              WASM build and end-to-end test
```

## Fonts and licences

The code is MIT licensed. The bundled fonts (Archivo Black, Inter, Space Grotesk, Playfair Display, Rubik Mono One, Pacifico, Silkscreen, Unbounded, Bungee, Dela Gothic One) are under the SIL Open Font License; see `ui/public/fonts/OFL.txt`. A font you make from an OFL font is a derivative: give it a new family name and keep it under the OFL.

## Known limitations

- Exported fonts don't carry kerning or OpenType features yet; metrics come from the base font(s).
- WOFF2 imports aren't supported yet; import the TTF or OTF instead.
- Morphing between structurally very different glyphs, such as a two-storey and a single-storey "a", can pinch mid-way. Moving the blend toward either end resolves it.
- The renderer needs WebGL2 with float render targets (`EXT_color_buffer_float`), which WKWebView provides on macOS 12 and later. If it's missing, editing and SVG/font export still work but the effect preview doesn't.
