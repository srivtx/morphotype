## Morphotype 0.9.1

A motion editor with a timeline, text that moves letter by letter, a kerning editor, smoother morphed fonts, and a faster start.

### Install on a Mac

1. Download `Morphotype_0.9.1_universal.dmg` below (it runs on Apple silicon and Intel).
2. Open it and drag **Morphotype** into **Applications**.
3. The app isn't notarised yet, so macOS blocks it the first time. Either go to **System Settings → Privacy & Security** and click **Open Anyway** next to Morphotype, or run this once in Terminal (it also fixes a "damaged" message):
   `xattr -dr com.apple.quarantine /Applications/Morphotype.app && open /Applications/Morphotype.app`

### Install on Windows

1. Download `Morphotype_0.9.1_x64-setup.exe` below and run it.
2. The installer isn't signed yet, so SmartScreen may warn. Click **More info** → **Run anyway**.

Fonts you install are registered under your user account and broadcast straight away, so they show up in other apps without a restart.

`Morphotype-web.zip` is the same app as a static website: unzip it and serve the folder from any web host.

### What's new in 0.9.1

**Motion editor**
- A **timeline dock**: a row for every moving layer. Entrances and **Then** are clips, loops and keyframed settings show their real cycles, and colours show the colours they pass through. Drag to retime, click to edit, + to add.
- **Comes in › Move from…** and **Then › Move to…**, set by dragging dashed copies on the canvas. Then can also rise, drop, slide or shrink away.
- **A path of stops**: Move to… can go on through any number of stops, each with its own wait and Feel, shown on the canvas as numbered copies joined by a dashed path.
- **Letter by letter**: text can move one letter or one word at a time, without breaking it apart.
- Slide loops go left, right, up or down, one way (a conveyor) or back and forth.
- Groups move their children together or one by one, with a gap and an order (in order, reverse, from the centre, random).
- The Motion panel is **Simple** by default (Feel: Smooth, Snappy, Bouncy, Slow); **Advanced** adds curves, springs, offsets, fades and order.
- Copy and paste motion (⌥⇧⌘C / ⌥⇧⌘V).

**Learn**
- Ten lessons and six starters built from library shapes.
- Ten **animated showcases**, one per material: neon sign, sticker pack, liquid chrome, keycaps, melting type, arcade, plush weather, holo card, extruded 3D type and a riso print. Each is made with the Motion panel, so you can take every part apart.

**Type**
- A **Kerning** tab in Type mode: drag the right letter or nudge with the arrow keys, pick pairs by typing or clicking, and search every kerned pair. Advanced adds kerning classes (with suggestions) and pair exceptions, exported as compact GPOS class tables.
- **Morphed fonts are drawn curve to curve**, so a blend has about a third as many points as before and its letters stay exactly on the baseline, x-height and cap height.

**Speed and polish**
- The app opens faster: Home loads about half the code it used to, and the editor, Type mode and templates load as you need them.
- Moving shapes no longer stall the GPU: 50 moving lines go from about 5 to about 19 frames a second.
- Every template now exports exactly the same pixels each time (some materials could differ by a pixel at shape edges from run to run).
- Fixed: the playhead didn't follow a scrub while paused.

### What's new in 0.9.0

**Motion**
- One **scene clock**: play, pause, seek and replay. The project saves a timeline (length and loop), and when a loop is on, loops and pattern speeds snap to a whole number of cycles per loop so they repeat cleanly.
- **Motion on layers and groups**: loops (swing, bob, spin, pulse, slide), entrances (rise, fade, pop) and DialKit-style transitions — cubic-Bézier easing, time-based springs (duration and bounce) and physics springs (stiffness, damping, mass).
- **Group stagger**: each child gets the group's motion about its own centre, offset in time.
- It runs on the GPU. Motion is applied as a transform when shapes are composited, so the engine never rebuilds — a static design does no per-frame work at all.
- Any colour or slider in **Style** can be keyframed (To, Cycle, Offset) with Swing, Ramp or Flicker.
- **Modifier and shape sliders can be keyframed too.** Press the keyframe button next to a setting — open **More** on a modifier first — and the value ramps over the clock, in the editor and in exported video. Only the renders whose outline actually moves get rebuilt.
- New patterns: **Bars**, **Mosaic**, **Barcode** and **Flow**, and every pattern now has a **Speed** setting.
- A **timeline bar**: play/pause (K), replay (⇧K), scrubbing, length, loop and video export (MP4 where supported, else WebM). It only appears when something in the scene moves.
- **Layout**: Row, Column, Grid or Fan, with Gap, Columns, Spread and Curve.
- **Ripple / Shuffle** staggers the motion and animations of a selection.

**The shape kit**
- **Mirror** modifier: keeps one half and reflects it — left/right, top/bottom or both — across a line through the layer's position. Exact, and it works on any content.
- **Scallops** modifier: round bumps or bites evenly spaced along *any* outline, including squares, pills and text.
- **Flower petals**: Wavy (still the default, so old files don't change), Round, Pill, Oval and Pointed, each with a centre hole. All exact distance fields, so overlapping petals merge cleanly.
- **Assisted drawing**: points, handles and edges snap to points, the lines through them, the edges of other shapes and the grid, with equal-spacing and size targets. The pen can draw one half and mirror it for you; ⌘D after moving a copy repeats the step, for rows of circles and stacks of pills.
- **One-click assists**: Variations (eight engine-drawn takes on the selected shape), Centre dot, Face, and Arrange as tiles — shapes laid out on a sheet of coloured tiles, with faces and dots staying with their shape.

**Font export**
- **Kerning is carried over** from the base font and written as GPOS pair kerning, so exported fonts space like the originals. Redrawn glyphs get no kerning.
- **Weight** pulls glyphs back onto the baseline and the x-height (or cap height); **Slant** leans each glyph around half the x-height, so the sidebearings stay balanced.
- The source font's **copyright notice and licence are kept**.
- Each export gets the next version number (1.001, 1.002…), so macOS and Windows replace the installed copy instead of using a cached one.
- Every exported font is now checked in CI with OTS and fontbakery, and the audit table is written to the job summary.

**Fixes**
- The **Smile** shape no longer has a bitten-in end, and the **Spiral** no longer has inverted caps.
- Smile and Spiral now take the line tool's cap choice — **Round / Flat / Square**.
- Italic exports are no longer labelled as leaning the wrong way.

**Interface**
- Sliders are rebuilt as DialKit-style bars: a fill, ticks and a hover handle that moves out of the way of the text, stretching past the ends, with a click that snaps to tenths. Hover or press Enter to type a value.
- Segmented controls get a sliding pill, and buttons, selects, fields, switches and colour fields are restyled to match.

**Templates**
- **Moving cards** and **Course cards**, built only from everyday tools. The README has a step-by-step recipe for making them from basic shapes.
- **EB Garamond** joins the font library.

### Also in 0.8

**Along the line** (pen lines, in the Line panel)
- **Zigzag / wave**, **Meander**, **Coil** and **Scallop**, generated along the line's centre: amplitude, spacing, smoothness, coil roll.
- **Whole ridges per segment**: ridges fit evenly between pen points, so an arch drawn as two legs and two quarter arcs gets tips exactly on its joins.
- **Round turns**, **flat ends** and **dashes**: a 0 dash with round ends draws dots, and a thick dashed line makes barcode bars.

**New materials**
- **Pattern**: twenty crisp, anti-aliased patterns drawn on the GPU inside any shape. Scale, weight, angle, rays, wave/bulge, centre and shift are all adjustable, and the paper can be transparent.
- **Ribbon**: colour that flows along a pen line from one end to the other, with tube shading, gloss, twists and a fade-out.
- **Flat**: radial gradients, and gradients that run over just part of a shape (start/end), for highlight caps and bottom fades.

**Sharper output**
- PNG/JPG exports build geometry at export quality, and fields at up to two texels per pixel. Long lines and thin bars no longer show stair-steps.

**Fonts**
- **Anton**, a heavy condensed display face (OFL).

**Templates, fitted to their references**
- **Squiggle arch**, **Pattern tiles**, **UFO poster**, **Flex icons**, **App icons** and **Pattern swatches** — each compared against its reference pixel by pixel.

Projects from earlier versions open as before.
