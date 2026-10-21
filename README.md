# Morphotype

A Mac-first type and logo lab. Morph one typeface into another, reshape lettering with a stack of modifiers, draw by hand, put photos inside any shape, trace images into vector marks, compile the result into a real installable font, and render it as liquid chrome, glow glass, puffy 3D, halftone, dither, rubber stamp or neon, all in real time on the GPU.

![Templates rendered by Morphotype](docs/images/gallery.png)

## Install

Download the latest `.dmg` from [Releases](https://github.com/srivtx/morphotype/releases). It's a universal app for Apple silicon and Intel Macs. Open it and drag **Morphotype** to Applications. The app isn't notarised yet, so the first time macOS blocks it: go to **System Settings → Privacy & Security** and click **Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Morphotype.app` once in Terminal. On Windows 10 or 11, download `Morphotype_<version>_x64-setup.exe` from the same release and run it. It isn't code-signed yet, so SmartScreen may warn the first time: click **More info → Run anyway**. `Morphotype-web.zip` in the same release is the browser version, ready to host anywhere.

## What it does

Morphotype has two modes: **Design** for logos, icons, thumbnails and posts, and **Type** for designing a whole font. **Home** lists every design and font you've made; they save on this device as you work.

**Design mode**
- **Type on the canvas.** Press T and click anywhere to type, or double-click any text to edit it in place, with a real caret and selection and a small bar for font, size, colour and alignment.
- **Pen tool.** Press P and draw like in Illustrator or Figma: click for corners, drag for curves, close on the first point for a filled shape, or finish open for a line with round, flat or square ends. Points and handles snap to other points, lines through them, layer and artboard edges and centres (handles also level with their own point, for clean arcs); ⌥ while dragging a handle makes a sharp turn. **Mirror** draws one half and reflects it across the artboard's centre line. Every point stays editable, and the point editor snaps the same way. Lines can carry a zigzag, wave, meander, coil or scallop along them (whole ridges per segment, round turns, flat ends), and dashes or dots.
- **Draw.** Press B for marker, pencil or highlighter strokes, with pen pressure and tapered ends. Drawings stay editable vector layers.
- **Photos.** Drop in a picture and place it inside any shape or text (zoom, pan, duotone, grain), trace it into an outline, or turn it into pixel art with a few inks and optional dithering.
- **Direct editing.** Click to select, drag to move, and use the handles to resize, stretch or rotate (⇧ keeps proportions, as in Figma). Smart guides snap to the artboard and other layers, to equal spacing between neighbours, and while resizing to other layers' edges and sizes; ⌘ skips snapping. ⌘D after moving a copy repeats the step, for rows of circles or stacks of pills. Hold ⌥ to measure distances, and drags show live readouts. Also marquee selection, multi-select, align and distribute, flip, lock, hide, groups and right-click menus.
- **A material per layer.** Liquid chrome, Glow glass, Puffy, Sticker, Aura gradient, Holographic, Retro 3D, Neon, Glossy glyph, Distressed (with rubber-stamp grain), Letterpress, Halftone (with 3D light and misregistration), Risograph, Dither, Photo, Thermal, Prism light, Colour dots, Plush, Pattern (twenty-four GPU patterns, from sunbursts and Truchet arcs to houndstooth, op-art, riding bars, a flickering mosaic, barcode rows and flowing lines), Ribbon (colour that flows along a line) and Flat with linear or radial gradients, print texture and hard shadows. **Frosted glass** and **Lens glass** see what's behind them: they blur, bend, magnify and split it into colour. There are over 70 presets with GPU-rendered previews, and the Design tab recolours any material from a single colour. Every layer can also have a stroke (outside, centre or inside), solid 3D **depth**, opacity and a Multiply or Screen blend.
- **Shapes that work like a logo tool.** Cut and Mask clip into the layer directly below, Merge fuses layers into one outline with one material, and Break apart splits text or traced images into one layer per letter.
- **Reshape anything.** Quick looks (Bitmap, Sun rays, Blob dots, Echo stack, Fused band, All the way round…) apply a whole modifier stack in one click. Warp gives Photoshop-style envelope presets plus 16 draggable points. Edit points gives real bezier editing. The modifiers are Weight, Round, Mirror (left/right, top/bottom or both), Scallops (round bumps or bites all along any edge), Outline, Pixels (blocks, dots, soft tiles, crosses, pluses, diamonds, dissolve), Slice, Fuse, Foam, Repeat (around, grid, trail), Echo lines, Slant, Stretch, Warp, Fit in circle, Isometric, Arc (up to a full circle), Wave, Perspective, Wobble, Melt and Ink bleed.
- **Construction sheets.** Draw construction turns a logo into a presentation drawing: tinted outline, anchor markers and guides at its edges and the font's metric lines.
- **Shapes.** Circles to squircles, stars, sparkles, bursts, wavy and scalloped badges, flowers (wavy, round, pill, oval or pointed petals, with a centre hole), globes, asterisks, lenses, clouds, folders, quarter and half circles, mascot bodies, eyes and smiles, all parametric. Smiles and spirals end round, flat or square.
- **Motion.** Any layer or group can move on one scene clock, in three steps. **Comes in**: fade, rise, drop, slide in, grow, spin in, or **Move from…** a spot you drag on the canvas (a dashed copy marks where it starts; it ends where it sits in the design). **Then**: after a set time it moves on to a spot you drag (and stays) and, with **+ Add a stop**, on through as many more spots as you like, each with its own wait and Feel (numbered dashed copies on the canvas, a segment each in the timeline), or rises, drops, slides or shrinks away. **Keeps moving**: a loop that floats, bounces, sways, spins, pulses, blinks, wiggles, orbits or **slides** — left, right, up or down, one way like a conveyor or back and forth. The Motion panel is **simple** by default (what it does, how far, when, and a Feel: Smooth, Snappy, Bouncy or Slow); its **Advanced** switch adds the curves and springs, offsets, fades and the stagger order, and can be flipped any time. ⌥⇧⌘C / ⌥⇧⌘V copy one layer's motion to others. Transitions are an easing curve, a spring set by time (duration and bounce) or a physics spring (stiffness, damping, mass), edited on a live curve, after [DialKit](https://www.dialkit.dev/). A group's **Children: One by one** moves each child in turn, a Gap apart (a wave across rows of bars, a deal of cards), in order, reversed, from the centre or shuffled; a text's **Letters: One by one** or **Word by word** does the same with its letters or words, each turning about its own centre, without splitting the text. **One by one** and **Random** put any selection out of step. On a looping timeline, Cycle sliders step through the cycles that fit a whole number of times, so every move shows. Every number and colour of a material, and every number of a modifier or shape (a Wave's phase, a star's points, Repeat's turn), has a keyframe button to **swing**, **ramp** or **flicker** it between two values; shape and modifier keyframes rebuild just those layers while the timeline plays. Pattern fills move with **Speed**. Motion is applied when drawing, so nothing rebuilds, and clip frames stay still while their contents move. The **timeline** above the dock plays, pauses (K), scrubs, sets the length and looping (loops are fitted so the end meets the start), and **exports video** (MP4 where the browser can, otherwise WebM). Open it (the ˄ button) to see **when everything moves**, after DialKit's timeline: a row per moving layer, nested in its groups, with entrances as clips from start to settle (their curve drawn in), loops and keyframed settings as their real cycles (colours as the colours they pass through), and a ruler in seconds and frames (30 a second, as exported). Drag a clip to move its start, its end to change how long it takes (or, on a staggered group, how far apart its children go), a cycle to shift it and a cycle mark to change its length; everything snaps to frames, the playhead and other clips. Click a clip to edit it, or + on a selected layer to give it an entrance or a loop.
- **Layout.** Lay a selection, or a group's children, out as a row, a column, a grid or a fanned hand of cards, live from sliders.
- **Smart assists.** Variations shows eight new takes on a shape to pick from; Centre dot and Face add a contrasting dot or eyes and a smile sized to the shape; Arrange as tiles lays shapes out on a sheet of coloured tiles, keeping faces and dots with their shape.
- **Backgrounds and formats.** Solid, linear, radial or aura mesh gradients, film grain, patterns (grid paper, dot grid, lines, stripes, checks, doodles), and an app-icon tile with gloss, shadow and a holographic rim, set up for macOS (rounded tile in the artwork) or iOS and Android (full square, with a preview of the system mask), plus an app-icon grid as an overlay or as layers. The background is the bottom row in Layers and a chip in the dock. Canvas presets cover Instagram, Stories, YouTube thumbnails, X headers, OG images, app icons, business cards, ID badges and more.
- **Fonts.** TTF, OTF, TTC and WOFF, shaped with a HarfBuzz port, with variable axes. Text can morph into another font glyph by glyph.
- **Image tracing.** PNG, JPG, WebP or SVG become smooth vector outlines, or keep hard pixel edges. Colour tracing turns a flat logo into one editable vector layer per colour, keeping shading as fitted gradients, and a picture can sit under your work as a locked reference to trace with the pen (never exported).
- **Compare with reference.** With a reference picture in the design, the inspector scores how closely the artwork matches it and shows a heat map of where it differs (live if you like). **Fit** tunes any numeric setting of the selected layer (position, size, a squiggle's amplitude, a gradient's angle…) until it lines up with the reference, as one undo step.

**Type mode**
- Start a font by naming it and picking a typeface to reshape, or start blank and draw every glyph over a guide.
- Type basics: a short guide to cap height, x-height, spacing, optical tricks and naming, plus clickable metric lines in the glyph editor.
- A glyph grid (A–Z, a–z, 0–9, punctuation and any character you add), previewed with your style.
- Font-wide looks and modifiers, per-glyph point editing, widths and modifiers, and tracing images into glyphs.
- Glyph layers: build glyphs from shapes and other glyphs (components), cut with them, give a glyph its own look, or bake the finished glyph into editable points.
- A live tester using the real compiled font.
- Kerning by pair: type a pair, see it in the compiled font, nudge it. Hand-kerned pairs replace the font's own and go into the exported GPOS, which uses class kerning to stay small.
- Export as `.ttf`, `.woff`, or a **web font kit** (TTF, WOFF, `@font-face` CSS and a specimen page). On the Mac app you can also install the font, and **Use in Design** adds it to your fonts under its own name, with a summary of how it differs from the font it started from.

**Export**: PNG at 1×, 2× or 4× (optionally transparent), JPG, copy to clipboard, SVG with one path per object, fonts, and `.morpho` project files that embed imported fonts.

**Keyboard first**: ⌘K searches every command, shape, preset, canvas size and setting. Every action has a shortcut (press ? in the app), and settings are searchable (⌘,).

![Templates rendered by Morphotype](docs/images/gallery.png)

![The editor](docs/images/editor.png)

![Type mode](docs/images/type-mode.png)

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

Typical timings (release build, a 10-letter word): plain text under 0.5 ms, weight about 5 ms, rounding about 20 ms, ink about 25 ms, slice about 10 ms. A 2000-point brush scribble takes about 5 ms and seven echo rings around a shape about 11 ms. Cached rebuilds when only another layer changed take about 0.3 ms. See `cargo run --release -p morpho-core --example bench`.

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
| Build the Windows installer (on Windows) | `npx tauri build --bundles nsis` |
| Build the web app | `npm run build` (output in `dist/`) |
| Rust and UI unit tests | `npm test` |
| Browser end-to-end test | `npm run build && npm run test:e2e` |
| Live render studio (templates → PNG, compare with a reference) | `node scripts/studio.mjs`, then e.g. `curl '127.0.0.1:7799/compare?tpl=UFO%20poster&ref=ref.png&out=diff.png'` |
| Frame cost of moving geometry (1, 10, 50 animated pen lines, on the GPU) | `npx vite --port 1437`, then `node scripts/perf-geo.mjs` |
| Measure an outline on a reference picture | `cargo run --release --example refpath -- mask.pgm` (a white-on-black PGM mask → path data) |

CI builds an unsigned universal `.dmg` and an unsigned Windows installer on every push and pull request (the *Morphotype-macOS* and *Morphotype-Windows* artifacts), and checks exported fonts with OTS and fontbakery (the *font-audit* artifact holds the fonts and reports). The first build of a new version (the `version` in `package.json`) on `main` also publishes a GitHub Release with the `.dmg`, the Windows installer and the web build attached.

### Learn motion

The **Learn** tab of the templates has short lessons, each one idea with its how-to written on the canvas: *Here to there* (Move from…), *Three feels*, *Then move on*, *One by one*, *Conveyor* (a seamless one-way slide), *Loops*, *Colours and shapes move too* (keyframes on a fill, a flower's petals and a star's points), *Put it together* and *Letter by letter* (a word that rises a letter at a time, a line that follows word by word). Six **starters** are small finished pieces to reuse: loading dots, a pulse wave, a ticker, an orbit, a notification and a heartbeat. All are plain library shapes, flat colour or Puffy, and the Motion panel; open the timeline to see how each is timed.

### Moving cards from basic shapes

The **Moving cards** and **Course cards** templates are built only from the tools below; open one and take it apart, or start blank:

1. **Card.** Add a Rounded rect, set its size and corner, and give it a flat colour. Titles are text in EB Garamond, aligned left.
2. **Lines that ride a wave.** Draw one vertical line with the pen, then ⌘D and move it, and ⌘D again to repeat the step into a row (or use Layout → Row). Group the lines, then group that with a rect underneath and turn on **Clip to the bottom layer**, so they're cut at the panel. In Motion, give the group of lines a **Float** loop and some **Stagger**: each line rises and falls a little after its neighbour. (The Pattern material's **Bars** with Speed draws the same thing in one layer.) For lines that flow sideways, add a **Wave** modifier to a pen line, open its More controls and press the keyframe button next to **Phase**: it ramps all the way round, so the wave travels along the line.
3. **Flickering mosaic.** Make one small square, ⌘D it into a row, select the row, ⌘D it into rows (or Layout → Grid). Select every tile, press the keyframe button next to the Fill colour, pick a darker To and **Flicker**, then **Shuffle** in Motion so each tile flickers on its own. (Or Pattern → **Mosaic**.)
4. **Wireframe carousel.** Rounded rects with the **Outline** modifier make the frames. Put a row of small outlined cards in a group over a rect set to 0% opacity, clip it to that rect, and give the row a **Slide** loop.
5. **The deck.** Group the cards and use Layout → **Fan**, or turn each a few degrees by hand. Give the group a **Rise** entrance with a bouncy **Time** spring and a Stagger of about 0.1 s: the cards are dealt in one after another.
6. Press K to play, open the timeline to see and drag when each part moves, and export a video from its film button.

### Shortcuts

| | |
| --- | --- |
| ⌘K | Search every command |
| V / H / T / B / O / R | Select, hand, text tool, draw, circle, squircle |
| [ / ] | Smaller / bigger brush |
| Enter / ⇧Enter | Edit the selected text or enter a group / select the parent group |
| Hold ⌥ | Measure distances from the selection |
| P / W | Edit points / warp |
| ⌘G / ⇧⌘G / ⇧⌘M | Group / ungroup / merge into one shape |
| ⌥A ⌥H ⌥D / ⌥W ⌥V ⌥S | Align left, centre, right / top, middle, bottom |
| ⌘] ⌘[ (⌥ for front/back) | Bring forward / send backward |
| ⇧⌘B / ⌥⌘O | Break apart / convert to outline |
| ⌘D, ⌘C, ⌘V, ⌥⌘C, ⌥⌘V | Duplicate, copy, paste, copy style, paste style |
| ⌘E / ⇧⌘E / ⇧⌘C | Export PNG / SVG / copy image |
| ⌘1 / ⌘2 | Design / Type mode |
| ⌘0, ⇧0, ⇧2 | Fit, 100%, zoom to selection |
| ⌘' / ⇧⌘' | Show grid / snap to grid |
| Arrows (⇧ for 10 px), Tab | Nudge, cycle layers |
| K / ⇧K | Play or pause motion / play from the start |
| ? / ⌘, | Help and all shortcuts / settings |

Drag fonts, images or `.morpho` files onto the window to open them.

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

The code is MIT licensed. The bundled fonts (Archivo Black, Inter, Space Grotesk, Playfair Display, Rubik Mono One, Pacifico, Silkscreen, Unbounded, Bungee, Dela Gothic One, Young Serif, EB Garamond, Bricolage Grotesque, Caveat, Caveat Brush) are under the SIL Open Font License; see `ui/public/fonts/OFL.txt`. A font you make from an OFL font is a derivative: give it a new family name and keep it under the OFL.

## Known limitations

- Exported fonts carry the base font's kerning (blended with the morph target's), plus pairs you kern by hand, but no other OpenType features such as ligatures or alternates. Kerning is edited one pair at a time; there are no kerning classes to edit (the export finds classes by itself to keep files small). Metrics come from the base font(s).
- Content outside the artboard isn't rendered (like a clipped frame), though you can still select and move it.
- WOFF2 imports aren't supported yet; import the TTF or OTF instead.
- Morphing between structurally very different glyphs, such as a two-storey and a single-storey "a", can pinch mid-way. Moving the blend toward either end resolves it.
- The renderer needs WebGL2 with float render targets (`EXT_color_buffer_float`), which WKWebView provides on macOS 12 and later. If it's missing, editing and SVG/font export still work but the effect preview doesn't.
