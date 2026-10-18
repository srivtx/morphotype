# Architecture and plan

## Goals

1. **Make type and logos, not just render them.** Outlines must stay real geometry all the way to SVG and installable fonts, so effects are never baked into a bitmap you can't reuse.
2. **Interactive at every step.** Slider drags must feel instant: geometry in tens of milliseconds at worst, shading inside one frame.
3. **Mac first, web for free.** A native-feeling Mac app now, with the same code running in a browser.

## Platform decision

| Option | Verdict |
| --- | --- |
| Electron | Ships a whole Chromium (150 MB+) and runs the core in JS. Rejected. |
| Native Swift + Metal | Best Mac fidelity, but Mac-only and every UI change is slow to build. Rejected for v1. |
| Pure Rust + wgpu UI | Fast and portable, but immature text-field and menu widgets would slow down the editor. Rejected for v1. |
| **Tauri + Rust core + WebGL2** | Native shell in the system WKWebView (about 10 MB), the core in Rust, effects on the GPU, and a browser build from the same code. **Chosen.** |

The engine runs as WebAssembly **inside the web view** rather than behind Tauri IPC. Every edit sends the whole document to the engine; sending it through `postMessage` to a worker is cheaper than serialising through IPC to another process, and it keeps the web build identical. The native side handles only what a browser can't do: reading system fonts, installing fonts, and native dialogs.

## Engine pipeline (`crates/morpho-core`)

```
text ─► shape (rustybuzz) ─► glyph outlines (em units, cached per font/axes/glyph)
                         └─► morph? glyph pairs (cached correspondence) at t
symbol params ─► polylines
traced/imported path ─► parse SVG path data
            │
            ▼
      modifier stack (layer em units)
            │   affine (slant, stretch): curves stay exact
            │   point maps (wave, arc, wobble, melt, perspective): densify, then displace
            │   field ops (weight, round, outline, ink): narrow-band SDF → iso-contour
            │   pixelate: nonzero raster → axis-aligned block outlines
            ▼
      layer transform ─► combine: add = concatenate (nonzero);
                                  cut / mask = SDF boolean on a shared grid
            ▼
      preview: polyline path data      export: exact curves or fitted cubics
                                               → SVG, or cubic→quad → TrueType
```

Key algorithms:

- **Winding normalisation.** Contours are oriented by nesting depth (solids positive, holes negative), so fonts with TrueType or PostScript conventions, overlapping contours and imported SVGs all behave the same.
- **Narrow-band signed distance.** Exact segment distances are computed only within the band an operation needs; the sign comes from a nonzero scanline raster. Iso-contours come from oriented marching squares (inside on the right, with saddle cells resolved by the cell average), so output loops come out correctly wound with no post-processing.
- **Morph correspondence.** Contours are paired solid-to-solid and hole-to-hole by minimum cost (exact search up to 7 contours, greedy above). Unpaired contours grow from or shrink to their own centroid. Pairs are aligned with a rigid start-point shift, then refined with banded dynamic time warping on position and tangent. Both contours are sampled at a shared parameter set that includes every original vertex of either contour, so t = 0 and t = 1 are exact.
- **Curve fitting.** Schneider's algorithm, with corners detected on an RDP-simplified copy and nearly straight fits emitted as lines.
- **TrueType writer.** Writes glyf/loca, cmap formats 4 and 12, head, hhea, hmtx, maxp, name, OS/2 v4 and post v3, with correct checksums. Cubics are split into quadratics within 0.5 units. Output passes Chrome's OTS sanitizer.

## Renderer (`ui/src/render`)

All passes run in artboard texture space:

1. **Mask**: Canvas2D fills the engine's `Path2D` (anti-aliased) and uploads it as a texture.
2. **Seeds**: pixels that straddle the edge, with a sub-pixel estimate of where the 50 % coverage line lies.
3. **Jump flood**: log₂(N) passes plus a final 1-step pass, ping-ponging RG32F seed coordinates.
4. **SDF**: signed distance in texels (R16F, filterable).
5. **Height**: a bevel profile (round, chamfer or smooth) followed by a separable Gaussian. This step is cached and only redone when geometry or bevel settings change.
6. **Effect**: one fragment shader reads mask, SDF and height, computes normals by central differences, and composites premultiplied foreground over the background. The same shader renders the preview (with a viewport transform) and exports (into an FBO at up to 8K).

Effects are data: a GLSL body plus a parameter schema (`effects.ts`). The UI generates its controls from the schema, and a unit test checks that every parameter is consumed by either the shader or the height pass.

## UI (`ui/src`)

- A small external store (`useSyncExternalStore`) holds the project. Undo history stores immutable snapshots, and edits that share a key within 700 ms coalesce, so one slider drag is one undo step.
- `EngineClient` handles worker RPC with latest-wins builds and crash recovery.
- `platform/` hides the web/desktop differences: file dialogs, saving, system fonts and font install.

## Roadmap

1. **Glyph editor**: direct point editing per glyph, saved as overrides inside the exported font.
2. **Kerning carry-over**: interpolate pair kerning from GPOS/kern of both sources; add a class-based kerning editor.
3. **Variable font export**: export the morph axis (and weight/round) as a real `fvar`/`gvar` variable font. The morph correspondence is already point-compatible, which is the hard part.
4. **WOFF2 import** via a pure-Rust Brotli decoder.
5. **More effects**: halftone, risograph, holographic foil, extrude 3D, plus video loop export for animated chrome and neon.
6. **Metal path**: if profiling on Apple silicon shows WebGL overhead, move the SDF and effects to `wgpu`, which the Rust core can call directly.
7. **Signing and notarisation** for the `.dmg` in CI once an Apple Developer ID is available.
