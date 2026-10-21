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

Font export quality is measured by `crates/morpho-core/tests/font_audit.rs`: it exports a matrix of fonts (plain, Weight, Round, Slant, morph) and checks points, explicit extremes, baseline and cap/x-height drift, sidebearing balance, kerning and licence names against the sources (`cargo test -p morpho-core --test font_audit -- --nocapture` prints the table).

## Engine pipeline (`crates/morpho-core`)

```
text ─► shape (rustybuzz) ─► glyph outlines (em units, cached per font/axes/glyph)
                         └─► morph? glyph pairs (cached correspondence; curves blended point for point) at t
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
- **Kerning carry-over.** A font's kerning is measured by shaping: for each left character, one run alternating it with every other character is shaped with `kern` on and off, and the difference is each pair's kerning, whatever GPOS or `kern` lookups produce it. It is measured once per font, axes and character set, blended towards the morph target's (characters the target lacks keep the base value), scaled with Stretch, and written as GPOS pair adjustments in Extension lookups. Redrawn glyphs keep no kerning.
- **Type metrics under modifiers.** In a font, Weight grows each glyph on every side, so its points are pulled back onto the baseline and the x-height (lowercase) or cap height: shifted outside those lines, squeezed between them. Slant leans each glyph around half the x-height, so sidebearings stay balanced as in a drawn italic.
- **Glyph layers.** A glyph is its base or redrawn outline plus parts: library shapes, paths, or other glyphs as components (resolved recursively, at most three deep). Parts add by concatenation and cut or mask through the same SDF boolean as layers, then the font look runs unless the glyph opts out. Finished glyphs are cached by their spec, character and quality, so editing one glyph, or recompiling the live tester, rebuilds only what changed.
- **Morph correspondence.** Contours are paired solid-to-solid and hole-to-hole by minimum cost (exact search up to 7 contours, greedy above). Unpaired contours grow from or shrink to their own centroid. Pairs are aligned with a rigid start-point shift, then refined with banded dynamic time warping on position and tangent. Both contours are sampled at a shared parameter set that includes every original vertex of either contour, so t = 0 and t = 1 are exact.
- **Curve morph.** Font glyphs morph curve to curve on that same pairing and warp path (`CurveMorph`). Each contour is cut at the other's nodes (nodes within 5 % of the perimeter of each other are matched instead), so both get the same pieces. Corners, explicit points on both sides and extremes both share stay on-curve points; each run between them is refit on both sides as one TrueType spline (off-curve points with implied on-curve points between them) with the fewest spans that fit both within 0.0005 em, or kept piece by piece where none does. On-curve and control points are then interpolated directly, and points within 0.01 em of the baseline, x-height or cap height in both fonts (less than any overshoot) land exactly on the blended zone. A morph of Inter and Playfair Display Black at 50 % has 3,395 points across A–Z, a–z and 0–9 (Inter alone has 1,750; Playfair 3,186), against 11,287 from resampling and refitting a polyline, and sits on its blended zones. Where a pair can't be made compatible, or its area strays more than 12 % from the polyline morph's, the glyph falls back to the polyline morph and is refit. This point-compatible structure is the prerequisite for variable font (`fvar`/`gvar`) export: each glyph's two sides become the master outlines and their difference the deltas.
- **Curve fitting.** Schneider's algorithm, with corners detected on an RDP-simplified copy and nearly straight fits emitted as lines.
- **Warp.** A bicubic Bezier patch over the input's bounding box. With evenly spaced control points it reproduces the identity, so a preset (Arch, Flag, Bulge…) is just a table of control-point offsets scaled by `bend`, and hand-dragged points add to it. The UI mirrors the same table to draw the net.
- **Break apart.** Contours are grouped as solids with the holes they contain. Small pieces stacked above or below a larger one (the dot of an i, accents) stay with it, and the pieces come back in reading order.
- **TrueType writer.** Writes glyf/loca, cmap format 4 (plus format 12 when there are characters beyond the BMP), head, hhea, hmtx, maxp, name, OS/2 v4, post v2 (production glyph names), GPOS, STAT (wght and ital), and gasp and prep (smooth rendering with smart dropout control, since outlines aren't hinted), with correct checksums. Curves are split at their extremes so every extreme is an explicit point, cubics are split into quadratics within 0.5 units, and on-curve points TrueType can imply (midpoints of two off-curve points, not at an extreme) are left out. The name table keeps the source fonts' copyright notices and licence (name IDs 0, 13, 14, as the OFL requires); each export or install gets the next version (1.001, 1.002…) so an installed copy is replaced rather than cached. Output passes Chrome's OTS sanitizer. Glyph edits from Type mode (replacement outlines, widths, per-glyph modifiers, new code points) are applied per character, and WOFF 1.0 output wraps the same tables with zlib.

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

### Motion

Motion and animated materials never touch geometry; only keyframed shape and modifier settings do (below). One scene clock (`state/clock.ts`) gives every frame its time: playing, paused at a scrub position, or pinned by an export. The timeline's length and looping are saved with the project; on a looping timeline every loop period and pattern speed is rounded to a whole number of cycles, so the end meets the start.

- **Comes in, Then, slides and order** (`state/motion.ts`): an entrance can start from any offset (`enter: 'move'`, `fromX/fromY`, drawn on the canvas by `MoveGhosts` as a dashed copy to drag); Then (`leave`, `leaveAt`) moves on to an offset (`toX/toY`) and holds, or leaves; after a Move to… it can go on through `stops` (each an offset, a `hold` and an optional transition; `legsOf` places them on the clock, one after another, and `poseAt` adds each leg's move after Then's); a slide has a direction and can go one way (`dir`, `oneWay`); a group's stagger has an order (`order`, via `staggerSlot`). All are optional fields, so older files play as they did. On a looping timeline the Cycle controls (`CycleSlider`) only offer periods that fit a whole number of times, the same fitting `loopPeriod` applies when playing.
- **Letter by letter** (`state/letters.ts`): a text whose motion has `letters` (`'letters'` or `'words'`) moves each letter or word in turn, `stagger` seconds apart in `order`, like a staggered group's children, without becoming separate layers. `buildScene` asks the engine for letters on just that render (`RenderSpec.letters`); the engine answers with the letter of each subpath of the outline and each letter's word (`RenderOut.glyphs`, `.words`). It knows them from layout (contours per glyph, words from the text) as long as the layer's modifiers only move points (slant, wave, arc, warp…); after ones that rework the outline (weight, round, pixelate…) it falls back to pieces by shape, as Break apart finds them. `syncScene` then draws each letter as its own object with its own field, the text's motion about the letter's centre and its slot's delay; the material keeps the whole text's box (`SceneItem.frame`), so a gradient still runs across the word. Still text, or text moving as one, asks for nothing and draws as before. The timeline shows the text's clips as a staggered span, as for a group.
- **The timeline** (`state/tracks.ts`, `components/canvas/Timeline.tsx`) is a view of the same data, with nothing stored of its own: `rowsOf` lists the layers that move (plus the selection) with a track for each entrance, loop, keyframed setting and moving pattern, timed as the clock plays them (`loopPeriod` fitting included). Dragging a clip writes back the motion's `delay`, `stagger`, transition `duration`, or a loop's or keyframe's `phase` and `period`, snapped to frames. Only the playhead and time readout re-render while playing; the rows are memoised on the project and selection.
- **Layer motion** (`state/motion.ts`): a node's `motion` is a loop (float, slide, sway, spin, pulse, blink, wiggle, orbit…) plus an entrance (fade, rise, drop, slide in, grow, spin in) with a transition: a cubic Bézier, a time spring (duration + bounce, Motion's mapping) or a physics spring (stiffness, damping, mass), solved in closed form. `buildScene` hands each object the motions above it, innermost first; a group with Stagger hands its motion to each child, offset in time and turning about the child's own centre. At draw time the renderer composes the poses about their rest centres into one affine map and moves the object's quad in the vertex shader (`MOVED_RECT_VS`), so the field, height map and material are untouched. The fragment also gets where it would sit at rest, so a clip frame stays put while what's inside it moves; a clipped object's field is grown by how far its motion carries it (sampled over the timeline). The canvas scissors objects to the artboard, as exports are.
- **Animated settings**: a style's `animate` maps a material param to a second value, a cycle and a mode (swing, ramp, flicker). The renderer blends the uniform each frame (colours in RGB), so any material can pulse, shift or flicker without new shader code.
- **Moving patterns**: the Pattern material's Speed slides patterns along their grain, turns sunbursts and spirals, ripples rings, and drives the kinds made to move (riding bars, mosaic, barcode rows, flow lines).
- **Moving geometry** (`state/geoMotion.ts`, `app/geoMotion.ts`): a node's `animate` keyframes its own number settings, `mod:<uid>:<field>` for a modifier and `sym:<field>` for a library shape, with the same swing, ramp and flicker as materials (whole-number fields step). These change the outline, so the layers that have them are rebuilt: while the clock runs, `movingDocAt` builds an engine document with just the renders that move (plus the cuts, masks and morph sources they're made of) at the clock's time, at most 30 times a second and one at a time, and drops a frame asked for while one is building. The outlines go straight to the renderer through `liveOutlines()`, never into the project, undo history or autosave; their fields snap to a 16 px grid so textures are reused between frames. Paused, the outlines hold at the playhead. A design without keyframed geometry runs none of this. Selection outlines show the shape at rest, as they do for motion.
- **Video** (`exportVideo`): fields are built once at export size, then each frame is drawn at its own time and handed to a `MediaRecorder` on a 2D canvas, paced in real time. Moving geometry is built for every frame first (at export quality), so recording only swaps those outlines and rebuilds their fields. The preview stops drawing while an export holds the GPU. Stills (PNG, JPG, SVG, thumbnails) show the design at rest.

## UI (`ui/src`)

- A small external store (`useSyncExternalStore`) holds the project. Undo history stores immutable snapshots. Edits that share a key merge into one undo step: within a pointer gesture always, otherwise within 700 ms, so one drag or slider move is one step.
- `app/commands.ts` is the single list of user actions with their shortcuts. The keyboard handler, command palette, context menus and help sheet all read it, which is how everything stays reachable from the keyboard.
- Canvas overlays (selection frame, handles, smart guides, point editor, warp net) are SVG drawn over the WebGL canvas in screen space, using the per-layer outlines and local boxes the engine returns.
- Snapping rules live in `state/snap.ts` as pure functions (points and lines through them, equal spacing, matching sizes); the canvas only gathers targets. Moves, resizes, the pen and the point editor share them. A proportional corner resize snaps one axis and derives the other, so two snaps never fight over one scale.
- `app/assists.ts` holds the one-click helpers (centre dot, face, tile sheet, variations). Mirror and Scallops run in the engine on distance fields like the other outline modifiers; Mirror reflects across a line through the layer's position, so the mirrored pen can place the line exactly and editing points doesn't move it.
- Typing on the canvas uses a hidden textarea for input, selection and IME, and draws the caret and selection from the engine's own layout (`text_layout` shares the shaping code with the outline builder, so carets always match the letters). Modifiers that move letters (warp, arc, wave, slant, stretch, perspective) pause on that layer while typing.
- Materials have colour roles (`render/palette.ts`): one picked colour generates every role (shadow, base, light, highlight…) in OKLCH, which is how a single swatch recolours chrome or puffy believably.
- `EngineClient` handles worker RPC with latest-wins builds and crash recovery.
- `platform/` hides the web/desktop differences: file dialogs, saving, system fonts and font install.

## Roadmap

1. **Kerning editor**: kerning now carries over from both sources; add a class-based editor and class-based (format 2) pair tables for smaller files.
2. **Variable font export**: export the morph axis (and weight/round) as a real `fvar`/`gvar` variable font. The curve morph already makes both glyphs point-compatible, which is the hard part; glyphs that fall back to the polyline morph would need it too (or ship as static outlines).
3. **WOFF2 import** via a pure-Rust Brotli decoder.
4. **More effects**: video loop export for animated chrome and neon; an ASCII material, now possible with the backdrop pass.
5. **Metal path**: if profiling on Apple silicon shows WebGL overhead, move the SDF and effects to `wgpu`, which the Rust core can call directly.
6. **Signing and notarisation** for the `.dmg` in CI once an Apple Developer ID is available.
