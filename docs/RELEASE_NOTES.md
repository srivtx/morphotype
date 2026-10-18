## Morphotype 0.4

Draw by hand, put photos in anything, and build the looks people are making right now from real, editable tools: sliced stamps, type all the way round a circle, pixel dissolves, dithering, echo lines, construction sheets and neo-brutalist stickers.

### Install on a Mac

1. Download `Morphotype_0.4.0_universal.dmg` below (it runs on Apple silicon and Intel).
2. Open it and drag **Morphotype** into **Applications**.
3. The app isn't notarised yet, so macOS blocks it the first time. Either go to **System Settings → Privacy & Security** and click **Open Anyway** next to Morphotype, or run this once in Terminal (it also fixes a "damaged" message):
   `xattr -dr com.apple.quarantine /Applications/Morphotype.app && open /Applications/Morphotype.app`

`Morphotype-web.zip` is the same app as a static website: unzip it and serve the folder from any web host.

### What's new

**Draw**
- Press B to draw. Pen, Marker, Pencil and Highlighter brushes, with pen pressure, tapered ends and smoothing. `[` and `]` change the size.
- Drawings stay editable: change their width or smoothing later, recolour them, or add any modifier.
- Two handwriting fonts to go with them: Caveat and Caveat Brush.

**Photos**
- Drop in a picture and choose Photo, Trace or Pixel art.
- Photo puts the picture inside a shape. Swap the shape for a circle, a star or your text and the photo stays inside. Zoom, pan, duotone, contrast, saturation and grain are in the Style tab.
- Pixel art turns a picture into a few inks (picked from the image or from a ready palette), with optional dithering, as squares or dots. Each colour becomes its own layer.

**Every layer**
- A stroke on any material, outside, centred or inside the outline.
- Opacity and blend modes: Multiply for overprinted inks and highlighters, Screen for light.

**New modifiers**
- **Slice** cuts rays or pie wedges out from a centre you can move, with a ring, a hole and soft piece corners.
- **Repeat** places copies around a circle, in a grid, or as a trail that steps, scales and turns.
- **Fuse** melts nearby letters into one solid form.
- **Fit in circle** squeezes anything into a round badge or an ellipse.
- **Echo lines** draws concentric outline rings.
- Arc now goes all the way round (bend 2).
- Pixels can dissolve toward one side.

**New materials and backgrounds**
- **Dither**: one-bit Bayer or noise dithering of light and gradients.
- **Halftone** now follows 3D light, can print on its own paper colour and can be misregistered.
- **Distressed** has a rubber-stamp grain.
- Flat shadows can be hard-edged and any colour, for neo-brutalist graphics.
- Backgrounds take patterns: grid paper, dot grid, ruled lines, stripes and checks.
- New presets include Rubber stamp, Lino black, Neo-brutal, Cream label, Pop offset, Printed 3D, Voxel blue, Pixel pop and three dithers.

**Construction sheets**
- Right-click a logo or lettering and choose Draw construction. It adds a tinted outline, a marker on every corner and curve extreme, and guide lines at the edges and the font's baseline, x-height, cap height and ascender, ready for a presentation.

**Shapes, fonts and templates**
- New shapes: Folder, Pill, Quarter circle, Half circle and Cove, for modular logos.
- New fonts: Young Serif, Bricolage Grotesque (variable), Caveat and Caveat Brush.
- 13 new templates, built from the tools above rather than pictures: Printed shapes, Night notes, Echo rings, Sun stamp, Ring seal, Voxel cursor, Dot type, Folder sticker, Pixel wordmark, Pixel poster, Dither signal, Fused band and Pixel garden. Each card shows what it's made with.
- ⇧⌘' snaps to the grid, and turns the grid on.

**Faster**
- Big distance-field operations run in linear time: wide Echo, Weight and Fuse values are up to 30× faster.
- A 2000-point scribble builds in about 5 ms.
- Photos stay out of the undo history, so editing a design with photos is as quick as one without.

**Fixes**
- On the Mac, the window buttons now sit on the centre line of the top bar.

Projects from earlier versions open as before.
