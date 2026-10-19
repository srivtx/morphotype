## Morphotype 0.6

A real pen tool, colour tracing and reference images: recreate logos and icons exactly, as editable vectors.

### Install on a Mac

1. Download `Morphotype_0.6.0_universal.dmg` below (it runs on Apple silicon and Intel).
2. Open it and drag **Morphotype** into **Applications**.
3. The app isn't notarised yet, so macOS blocks it the first time. Either go to **System Settings → Privacy & Security** and click **Open Anyway** next to Morphotype, or run this once in Terminal (it also fixes a "damaged" message):
   `xattr -dr com.apple.quarantine /Applications/Morphotype.app && open /Applications/Morphotype.app`

`Morphotype-web.zip` is the same app as a static website: unzip it and serve the folder from any web host.

### What's new

**Pen tool (P)**
- Click for corner points, drag for smooth curves, and click the first point to close a filled shape. Enter or Esc keeps it as an open line; ⌫ takes back the last point, and ⇧ keeps 45° steps.
- Open paths are real **lines**: any width, with round, flat or square ends, and any material, stroke or depth on top.
- Every pen shape and line stays editable point by point (Edit points is now ⇧P or Enter).

**Recreate a picture**
- **Colour tracing**: in Add image → Trace, set Colours above 1 and a flat logo becomes one smooth vector layer per colour, stacked so no gaps show between them.
- **Reference**: place a picture under your work, faded and locked, with the pen ready. It's drawn while you design but never appears in PNG, SVG or project previews. Any layer can be made a reference in its Layer section.

**Templates**
- The logo and icon templates are redrawn with real pen paths: the isometric bunny's silhouette and ears, the flame's peaks and wiggly eyes, the weather icon's OK hand and arm, the wavy badge's line icon, and a glass cube with three refracting faces.

**Fixes**
- Pressing Enter in a number field inside a dialog could activate the dialog's Close button and throw away your settings. Dialogs now keep focus where you left it, and Enter only commits the number.
- Appearance lists Add stroke and Add depth side by side with proper spacing.

Projects from earlier versions open as before.
