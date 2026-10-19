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
symbol params ─► polylines (line symbols: constant-width strokes merged in a distance field)
traced/imported path ─► parse SVG path data
brush stroke points ─► swept-circle distance field ─► outline
pen line (path data, open or closed) ─► flattened subpaths ─► constant-width strokes (round, flat or square caps)
            │
            ▼
      modifier stack (layer em units)
            │   affine (slant, stretch): curves stay exact
            │   point maps (wave, arc, warp, wobble, melt, perspective): densify, then displace
            │   field ops (weight, round, outline, ink, fuse, slice, echo): SDF → iso-contour
            │   pixels: nonzero raster → block outlines, dots, tiles, crosses, pluses or diamonds (dissolve drops cells)
            │   foam: bubbles packed largest-first through a spatial hash, carved from the shape's field
            │   isometric: an affine onto a cube face (top, left or right), so curves stay exact
            │   repeat (radial, grid, trail): affine copies, so curves stay exact
            ▼
      layer transform (translate · rotate · scale · stretch)
            ▼
      per render: members combine: add = concatenate (nonzero);
                                   cut / mask = SDF boolean on a shared grid
                  then the render's own modifiers (merged groups)
            ▼
      preview: polyline path data per render, plus per-layer outlines and
               local boxes for hit testing, handles and warp nets
      export:  exact curves or fitted cubics → SVG paths, or cubic→quad → TrueType / WOFF
```

Key algorithms:

- **Winding normalisation.** Contours are oriented by nesting depth (solids positive, holes negative), so fonts with TrueType or PostScript conventions, overlapping contours and imported SVGs all behave the same.
- **Narrow-band signed distance.** Exact segment distances are computed only within the band an operation needs; the sign comes from a nonzero scanline raster. Iso-contours come from oriented marching squares (inside on the right, with saddle cells resolved by the cell average), so output loops come out correctly wound with no post-processing. Bands wider than 8 cells (big Weight, Fuse or Echo values) switch to a dead-reckoning distance transform: exact nearest points within 2.5 cells of the outline, then two raster passes that hand each neighbour's nearest point on, which is linear in the grid size instead of sweeping the band once per edge (Echo rings went from ~320 ms to ~11 ms). Marching squares keeps dense per-edge links but stores crossing points compactly.
- **Slice and Echo.** Slice subtracts a cut field: distance to rays from a movable centre (plus an optional ring and hole) minus half the gap, then an opening (shrink, grow) softens the pieces' corners without closing the gaps, which a plain Round would. Echo keeps the inside and adds rings where the outside distance is near a multiple of the spacing, sampled at a resolution set by the ring width rather than the shape's size.
- **Brush strokes.** A stroke is a polyline with a radius per point (pen pressure, tapered ends). Input is smoothed with Chaikin corner cutting, resampled to the field spacing, and each segment stamps the distance to its tapered capsule into a grid, comparing squared distances first. The zero level is the outline, so self-crossing scribbles stay filled with round ends. A 2000-point scribble builds in about 5 ms. While drawing, the UI only updates one SVG path; the engine runs once on release.
- **Pen lines.** The SVG parser keeps whether each subpath was closed with Z. Filled outlines close every subpath; a Line layer flattens each subpath and stamps constant-width segments into one distance field, skipping samples past an open end for flat caps (square caps first extend the ends by half the width). Pen paths are stored in em units around their own centre, so modifiers scale with their size and the point editor works on them unchanged.
- **Colour tracing.** The picture is reduced to a few inks with k-means, then each ink is traced into its own smooth outline, normalised to the whole image so the layers line up. Masks are stacked: the largest ink first, and each mask also covers every ink above it, so no background shows through anti-aliased seams. Inks under 0.2 % of the picture are edge pixels and are skipped.
- **Line symbols.** Globes, asterisks and line icons are many strokes that overlap. Instead of joining polygons (whose winding breaks where they cross), each segment stamps its distance into one grid and the zero level becomes the outline, so every overlap merges and line weight stays exact.
- **Foam.** Bubble radii step down from the largest; at each size, random centres inside the shape (sampled from its signed distance) are kept if a spatial hash finds no bubble closer than the wall thickness, and an optional fade thins them toward one side. Kept bubbles are carved into the distance field by stamping only the cells they cover, so a letter full of foam builds in about 20 ms.
- **Glyph layers.** A glyph is its base or redrawn outline plus parts: library shapes, paths, or other glyphs as components (resolved recursively, at most three deep). Parts add by concatenation and cut or mask through the same SDF boolean as layers, then the font look runs unless the glyph opts out. Finished glyphs are cached by their spec, character and quality, so editing one glyph, or recompiling the live tester, rebuilds only what changed.
- **Morph correspondence.** Contours are paired solid-to-solid and hole-to-hole by minimum cost (exact search up to 7 contours, greedy above). Unpaired contours grow from or shrink to their own centroid. Pairs are aligned with a rigid start-point shift, then refined with banded dynamic time warping on position and tangent. Both contours are sampled at a shared parameter set that includes every original vertex of either contour, so t = 0 and t = 1 are exact.
- **Curve fitting.** Schneider's algorithm, with corners detected on an RDP-simplified copy and nearly straight fits emitted as lines.
- **Warp.** A bicubic Bezier patch over the input's bounding box. With evenly spaced control points it reproduces the identity, so a preset (Arch, Flag, Bulge…) is just a table of control-point offsets scaled by `bend`, and hand-dragged points add to it. The UI mirrors the same table to draw the net.
- **Break apart.** Contours are grouped as solids with the holes they contain. Small pieces stacked above or below a larger one (the dot of an i, accents) stay with it, and the pieces come back in reading order.
- **TrueType writer.** Writes glyf/loca, cmap formats 4 and 12, head, hhea, hmtx, maxp, name, OS/2 v4 and post v3, with correct checksums. Cubics are split into quadratics within 0.5 units. Output passes Chrome's OTS sanitizer. Glyph edits from Type mode (replacement outlines, widths, per-glyph modifiers, new code points) are applied per character, and WOFF 1.0 output wraps the same tables with zlib.

## Documents (`ui/src/state`)

A project is a tree of **layers** (text, symbol, outline, morph, drawing) and **groups**. Every layer has its own style (an effect and its parameters). `tree.ts` turns the tree into an engine document:

- each visible layer becomes one render (one styled object on the GPU);
- a layer or group set to **Cut** or **Mask** doesn't render. Its layers are appended, with that op, to the renders of the nearest non-clipping sibling below it (to every render inside it, if that sibling is a group), like clipping masks;
- a **merged** group is a single render: its descendants combine with their ops, then the group's own modifiers run on the union, and it uses the group's style.

UI-only fields (names, locks, styles) are stripped before the document reaches the engine, so a style edit never triggers a geometry rebuild. The background (page fill, pattern, app-icon tile, grain) belongs to the project, not to an effect. A style can also carry a stroke (outside, centre or inside, drawn by the renderer over any material), an opacity and a blend mode.

Projects save to an on-device library as you work (`library.ts`, IndexedDB): small metadata records (name, size, kind, preview) for Home, documents, pictures and imported fonts each in their own store, so Home reads only metadata and a picture shared by several projects is stored once. Saves wait for edits to settle and run in idle time; previews are re-rendered at most every few seconds. Opening a project gives it its own undo history, and every way of replacing the open project goes through one function that flushes the save first.

Reference layers (`guide`) render on the canvas but are skipped when the renderer draws for an export or a preview and when SVG is written, so a picture can be traced over without ever leaving the editor.

Pictures for the Photo material live in an asset store (`assets.ts`) outside the project, keyed by a hash of their data. Edits deep-copy the project for undo, so keeping megabytes of image data out of it keeps every edit and every undo step cheap; `.morpho` files embed the pictures in use when saved and restore them on open. Version 1 files, which had one effect for the whole document, are migrated into a merged group that keeps that effect, with the backdrop moved to the canvas.

## Renderer (`ui/src/render`)

Each object gets its own field, cropped to its bounding box plus how far its effect can paint (glows, shadows, reflections). Objects composite in order, with premultiplied alpha, over a background pass. For each object's field:

1. **Mask**: Canvas2D fills the engine's `Path2D` (anti-aliased) and uploads it as a texture.
2. **Seeds**: pixels that straddle the edge, with a sub-pixel estimate of where the 50 % coverage line lies.
3. **Jump flood**: log₂(N) passes plus a final 1-step pass, ping-ponging RG32F seed coordinates.
4. **SDF**: signed distance in texels (R16F, filterable).
5. **Height**: a bevel profile (round, chamfer or smooth) followed by a separable Gaussian. This step is cached and only redone when geometry or bevel settings change.
6. **Effect**: one fragment shader reads mask, SDF and height, computes normals by central differences, and returns premultiplied colour. The same shader renders the preview (with a viewport transform) and exports (into an FBO at up to 8K).

Preview cards and template thumbnails use a second, off-screen renderer with the same shaders, so they always match the canvas.

Every effect shader is wrapped with the same epilogue: an optional stroke from the SDF (so strokes work on chrome, puffy or halftone alike), optional **depth** (the outline swept back along a direction, sampled up to 96 times and shaded toward the back, drawn under the face) and the style's opacity. Renderer uniforms use names a unit test reserves, so no material parameter can shadow them.

**Backdrop materials** (Frosted glass, Lens glass) see what is drawn before them. Just before such an object composites, the renderer copies the framebuffer under its quad into a texture (RGB, since the screen has no alpha), and blurs it with two separable Gaussian passes at half resolution when the material asks for blur. The shader reads it through a uv map, so the same code works on screen, in exports and in thumbnails. Cost: one copy and four small blur passes per glass object, only while it is visible. Blend modes are fixed-function: Multiply uses `DST_COLOR, ONE_MINUS_SRC_ALPHA` and Screen `ONE, ONE_MINUS_SRC_COLOR` on premultiplied colour, with alpha kept "over" so transparent exports still work. Photo binds the picture as a mipmapped texture, uploaded once per renderer and redrawn when it finishes decoding.

Effects are data: a GLSL body plus a parameter schema (`effects.ts`). The UI generates its controls from the schema, and a unit test checks that every parameter is consumed by either the shader or the height pass.

## UI (`ui/src`)

- A small external store (`useSyncExternalStore`) holds the project. Undo history stores immutable snapshots. Edits that share a key merge into one undo step: within a pointer gesture always, otherwise within 700 ms, so one drag or slider move is one step.
- `app/commands.ts` is the single list of user actions with their shortcuts. The keyboard handler, command palette, context menus and help sheet all read it, which is how everything stays reachable from the keyboard.
- Canvas overlays (selection frame, handles, smart guides, point editor, warp net) are SVG drawn over the WebGL canvas in screen space, using the per-layer outlines and local boxes the engine returns.
- Typing on the canvas uses a hidden textarea for input, selection and IME, and draws the caret and selection from the engine's own layout (`text_layout` shares the shaping code with the outline builder, so carets always match the letters). Modifiers that move letters (warp, arc, wave, slant, stretch, perspective) pause on that layer while typing.
- Materials have colour roles (`render/palette.ts`): one picked colour generates every role (shadow, base, light, highlight…) in OKLCH, which is how a single swatch recolours chrome or puffy believably.
- `EngineClient` handles worker RPC with latest-wins builds and crash recovery.
- `platform/` hides the web/desktop differences: file dialogs, saving, system fonts and font install.

## Roadmap

1. **Kerning carry-over**: interpolate pair kerning from GPOS/kern of both sources; add a class-based kerning editor.
2. **Variable font export**: export the morph axis (and weight/round) as a real `fvar`/`gvar` variable font. The morph correspondence is already point-compatible, which is the hard part.
3. **WOFF2 import** via a pure-Rust Brotli decoder.
4. **More effects**: video loop export for animated chrome and neon; an ASCII material, now possible with the backdrop pass.
5. **Metal path**: if profiling on Apple silicon shows WebGL overhead, move the SDF and effects to `wgpu`, which the Rust core can call directly.
6. **Signing and notarisation** for the `.dmg` in CI once an Apple Developer ID is available.
