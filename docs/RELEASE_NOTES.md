## Morphotype 0.5

A home for your work, glass that sees what's behind it, 3D depth on anything, and glyphs you can build from layers.

### Install on a Mac

1. Download `Morphotype_0.5.0_universal.dmg` below (it runs on Apple silicon and Intel).
2. Open it and drag **Morphotype** into **Applications**.
3. The app isn't notarised yet, so macOS blocks it the first time. Either go to **System Settings → Privacy & Security** and click **Open Anyway** next to Morphotype, or run this once in Terminal (it also fixes a "damaged" message):
   `xattr -dr com.apple.quarantine /Applications/Morphotype.app && open /Applications/Morphotype.app`

`Morphotype-web.zip` is the same app as a static website: unzip it and serve the folder from any web host.

### What's new

**Home and your projects**
- Morphotype opens on Home: start a design in a common size, a new font or a template, and pick up any design or font you've made, with previews and search.
- Projects save on this device as you work. There's nothing to save, and "Saved" in the top bar confirms it. Rename, duplicate or delete (with Undo) from each card. ⌥⌘H goes Home.
- A new design starts on a white page with a "Start with" panel: text, shape, draw, image or template.
- Settings → At launch: show Home, or reopen the last project.

**Glass and light**
- **Frosted glass** blurs whatever is behind it, with a tint (or a tint gradient), a lit edge, grain and a shadow.
- **Lens glass** bends, magnifies and splits what's behind it into colour, with an iridescent rim. Put it over type.
- **Thermal** paints heat-camera colours that glow out into the canvas. **Prism light** throws spectral streaks out from the shapes. **Colour dots** prints a colour field as an LED dot screen. **Plush** is soft fuzzy fabric.

**Every layer**
- **Depth** (in Appearance, next to Stroke) gives any layer solid 3D sides in any direction and colour, over any material.

**Shapes and modifiers**
- New shapes: wavy and scalloped badges, globe, asterisk, lens and cloud.
- **Foam** eats bubbles through a shape. **Isometric** lays it on a face of a 3D cube. Pixels can now be crosses, pluses and diamonds.
- New quick looks: Foam, Sponge, Cross stitch, Diamonds, Iso left and Iso top.
- A **Doodles** background pattern, like packaging print.
- App icons: show Apple-style keylines while you design, or add the grid as layers for a presentation shot.

**Type mode**
- **Glyph layers**: build a glyph from shapes, cut ink traps and counters with them, or reuse another glyph as a component that follows its edits (draw the dot once, use it on i, j and !). Drag and resize layers on the glyph canvas.
- A glyph can skip the font look, and **Bake into points** turns the finished glyph, look and all, into an outline you can reshape point by point.
- Previews rebuild only the glyphs you change, and the engine caches finished glyphs, so editing big fonts stays quick.

**Templates**
- 15 new templates built from these tools: Glass lens, Crystal word, Frosted 404, Thermal wings, Prism grid, Heat dots, Foam letter, Cross-stitch wall, Badge set, Pixel office, Plush box, Wavy badge icon, Iso bunny, Flame icon and Weather icon. Related layers in templates are grouped.

**Fixes**
- In Type mode, picking a look highlighted every look that used the same modifier (Bitmap, Tiles and Dot matrix lit up together). Looks now match their exact settings, and the Design tab shows the active look too.
- The type tester no longer keeps every compiled font in memory.
- Segmented controls no longer overflow narrow panels.

Projects from earlier versions open as before.
