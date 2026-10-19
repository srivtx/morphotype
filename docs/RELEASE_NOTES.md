## Morphotype 0.8.0

Squiggles and dashes along any line, twenty GPU patterns, colour that flows along a line, and five new templates fitted to real designs pixel by pixel.

### Install on a Mac

1. Download `Morphotype_0.8.0_universal.dmg` below (it runs on Apple silicon and Intel).
2. Open it and drag **Morphotype** into **Applications**.
3. The app isn't notarised yet, so macOS blocks it the first time. Either go to **System Settings → Privacy & Security** and click **Open Anyway** next to Morphotype, or run this once in Terminal (it also fixes a "damaged" message):
   `xattr -dr com.apple.quarantine /Applications/Morphotype.app && open /Applications/Morphotype.app`

`Morphotype-web.zip` is the same app as a static website: unzip it and serve the folder from any web host.

### What's new in 0.8

**Along the line** (pen lines, in the Line panel)
- **Zigzag / wave**, **Meander**, **Coil** and **Scallop**, generated along the line's centre: amplitude, spacing, smoothness, coil roll.
- **Whole ridges per segment**: ridges fit evenly between pen points, so an arch drawn as two legs and two quarter arcs gets tips exactly on its joins.
- **Round turns**: each turn is a circle of the radius you set, with the tip kept at the amplitude. Turns stay round even where the legs fan out or run parallel on a curve.
- **Flat ends**: finish with a leg straight across the line.
- **Dashes**: dash, gap and offset; a 0 dash with round ends draws dots. A thick dashed line makes barcode bars.

**New materials**
- **Pattern**: twenty crisp, anti-aliased patterns drawn on the GPU inside any shape. Stripes, dots (optionally staggered), grid, checker, sunburst, rings, waves, chevron, Truchet arcs, fish scales, houndstooth, op-art bulge, spiral, crosses, triangles, diamonds, honeycomb, Memphis squiggles, crosshatch and gingham. Scale, weight, angle, rays, wave/bulge, centre and shift are all adjustable, and the paper can be transparent.
- **Ribbon**: colour that flows along a pen line from one end to the other (five stops), with tube shading, gloss, twists and a fade-out. The engine hands the renderer the line's centre line; the shader finds each pixel's place along it.
- **Flat**: radial gradients, and gradients that run over just part of a shape (start/end), for highlight caps and bottom fades.

**Sharper output**
- PNG/JPG exports build geometry at export quality, and fields at up to two texels per pixel. Long lines and thin bars no longer show stair-steps.
- Flat line ends are exact: straight, square-cornered cuts, even where a curve's first segment is tiny.
- Tracing: the Bézier fit no longer overshoots at sharp inner corners or bulges along long straight edges.

**Fonts**
- **Anton**, a heavy condensed display face (OFL).

**Templates, fitted to their references**
Each was compared against its reference pixel by pixel, and shapes were measured or fitted rather than eyeballed.
- **Squiggle arch**: the zigzag arch, with spine, amplitude and turn radius fitted to the reference by IoU, plus a traced smiling flower, stars and dots.
- **Pattern tiles**: fifteen tiles. Sunbursts and diagonals use the pattern material, bars are a thick dashed line, dots are dashes of zero length, the serpentine is a meander.
- **UFO poster**: saucers fitted from circles and Bézier curves (dome, lens body, rim light, bumps) with measured gradient ramps, traced bursts and stars, ruled lines and Anton type.
- **Flex icons**: twelve two-tone icons traced colour by colour, with each colour tucked under its black details so no seams show.
- **App icons**: six squircle app icons. A ribbon coloured along its length, plus regions vectorised with least-squares gradients, a puffy bubble and a pearl frame (a dotted line).
- **Pattern swatches**: every pattern on one sheet.

### Also in 0.7.1

**Keycaps, analysed region by region against the reference**
- Keys now affect each other: each key mirrors the key above in its top wall and the key below in its front wall, and sits in the diagonal shadow the key above casts.
- New Keycap controls: Reflection above / below, Mirror above / below, Shadow from above (with tint, or walls only), Wall sheen for lit walls, Sky fill for shaded walls, and Even top for thin coloured plastic that glows evenly.
- The dish is a smooth bowl with no creases. Translucent plastic now works like a colour filter, so a red part under orange plastic still reads red.
- Keycap tower and Macro keypad retuned. Measured against the picture, the keycap colours are about twice as close as in 0.7.0.

### Also in 0.7

**Glass, done properly**
- **Lens glass** now bends light the way glass does (Snell's law through a smooth dome). Each wavelength bends a little differently, so edges fringe smoothly into colour. A **Focus** point handles off-centre lenses; **Thickness** gives you a solid block; **Edge bend** reflects the inside at a grazing rim; **Edge film** adds a hairline of thin-film colour; and **Flat facets** gives chamfered crystal edges.
- **Rainbow light**: a studio light seen through the slopes of the glass fans out into warm, ordered spectral bands that sweep around the bevel. Shift, width and light angle are adjustable.
- New presets: **Magnifier drop** and **Crystal block**.

**New materials** (all GPU, from the distance field)
- **Glow gradient**: colour by distance from the edge, inside (edge → middle → core) and outside (two-colour fade). For glowing UI tiles, auras and light fades.
- **Grain gradient**: a rounded, lit form in three colours, dissolved into film grain with a grainy edge.
- **Mosaic**: fills a shape with blocks and bricks in six palette colours, with brick width, gaps and rounding.
- **Keycap**: a 3D key with a dished top face, shaded walls, tilt, gloss, a translucent option and a contact shadow.

**Every layer**
- **Soften** (next to Opacity): soft edges of any size, free on the GPU, and exported to SVG as a blur.

**Layers**
- **Clipping groups**: turn on *Clip to the bottom layer* on a group, and everything above that layer, glows and soft edges included, only shows inside its shape. This works on the canvas, in previews and in SVG.
- **Empty layer** (⇧⌘N): a blank layer to draw into. While it's selected, what you draw or add with the pen goes inside it.
- New designs can start on a **white, transparent or dark page**. Pick on Home or in the start panel.

**Templates measured from real designs**
- Rebuilt: Glass lens, Crystal word (a perspective glass cube from two stacked glass layers), Wavy badge icon, Iso bunny and Flame icon. Their paths are measured from the reference pictures.
- New: Glow widgets, Health widgets, Grain spheres, Brick icons, Object words, Keycap tower, Macro keypad, Tetris card, Pixel word and Creative mode.

Projects from earlier versions open as before.
