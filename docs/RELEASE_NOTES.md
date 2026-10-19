## Morphotype 0.7.1

Glass that behaves like glass, glowing and grainy gradients, 3D keycaps, toy-brick mosaics and clipping groups, with fourteen templates measured from real designs.

### Install on a Mac

1. Download `Morphotype_0.7.1_universal.dmg` below (it runs on Apple silicon and Intel).
2. Open it and drag **Morphotype** into **Applications**.
3. The app isn't notarised yet, so macOS blocks it the first time. Either go to **System Settings → Privacy & Security** and click **Open Anyway** next to Morphotype, or run this once in Terminal (it also fixes a "damaged" message):
   `xattr -dr com.apple.quarantine /Applications/Morphotype.app && open /Applications/Morphotype.app`

`Morphotype-web.zip` is the same app as a static website: unzip it and serve the folder from any web host.

### What's new in 0.7.1

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
