## Morphotype 0.3

Type right on the canvas, quicker colours, app icons done right, and a Type mode that teaches as you go.

### Install on a Mac

1. Download `Morphotype_0.3.0_universal.dmg` below (it runs on Apple silicon and Intel).
2. Open it and drag **Morphotype** into **Applications**.
3. The app isn't notarised yet, so macOS blocks it the first time. Either go to **System Settings → Privacy & Security** and click **Open Anyway** next to Morphotype, or run this once in Terminal (it also fixes a "damaged" message):
   `xattr -dr com.apple.quarantine /Applications/Morphotype.app && open /Applications/Morphotype.app`

`Morphotype-web.zip` is the same app as a static website: unzip it and serve the folder from any web host.

### What's new

**Typing on the canvas**
- Press T and click anywhere to type. Double-click any text to edit it in place. The caret and selection sit exactly on the rendered letters, whatever the font or material.
- A small bar above the text sets the font, size, colour and alignment. Warp and other distortions pause while you type and come back when you finish.
- Esc or a click outside finishes. A text left empty disappears.
- The layer name field now says what it is, so it can't be mistaken for the text itself.

**Colour and background, up front**
- The Design tab shows the layer's material and colours first. One click on a swatch recolours the whole material, so chrome, puffy or aura stay believable in any hue.
- The background is now the bottom row of the Layers panel, and a round chip in the dock opens background presets from anywhere.

**Editing like a pro tool**
- ⇧ keeps proportions when resizing, as in Figma (there's a setting to flip it). Text always scales evenly from the corners.
- Hold ⌥ to measure the distance from the selection to the layer under the pointer, or to the artboard edges.
- Live readouts while moving, resizing and rotating. ⇧Enter selects the parent group.

**App icons**
- Choose macOS, iOS · Android or Custom under App icon tile. macOS icons include the rounded tile and shadow; iOS and Android get a full square, because the system rounds the corners, with a preview of the system mask.
- Turn the tile into an ordinary layer to give it any material or modifier.

**Type mode**
- Starting a font is now a project: name it, then reshape an existing typeface or start blank and draw each glyph over a guide.
- The panel is split into Font, Glyph and Use & export, so you only see the tools for the job at hand.
- **Type basics**: a short guide to the parts of a letter, spacing, consistency, optical tricks and font naming. The metric lines in the glyph editor explain themselves when clicked, and a short tour shows the way around.
- **Use in Design** asks for the font's own name, refuses names that reuse the base font's, lists what makes your font different, and can switch text set in the base font to yours.

**New materials, shapes and templates**
- Letterpress (blind emboss or deboss), Halftone (dots or lines that fade), Risograph (two misregistered inks) and a print texture for Flat. Nine new presets.
- New Smile and Starburst shapes.
- Six new templates: Critter icons, Mascot card, Pixel ID card, Star lockup, Badge row and Riso zine. A new **What are you making?** row starts a blank logo, app icon, post, thumbnail, business card or font at the right size.
- New canvas sizes: business card, ID badge and A4 flyer.

Projects from earlier versions open as before.
