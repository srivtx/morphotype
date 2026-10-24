# morpho: the app from the command line

`scripts/morpho.mjs` drives Morphotype without its interface. It's built for AI agents (and scripts) designing in the app. A whole design is **one spec file and one command**: `make` builds it, places it against the engine's real outlines, fixes what's mechanical, checks it in words and draws **one** PNG. Every command ends with the likely next command.

```sh
npm run morpho -- serve &      # once: keeps a browser warm, so drawing takes about a second
npm run morpho -- help
```

## The workflow: make → check (--fix) → vary → video

```sh
morpho catalog kits                    # 1. pick a look (optional: kits, fonts, presets, shapes…)
morpho make poster.json                # 2. build, place, fix, check, one picture
morpho set poster.morpho 'Info.place=bottom left' --check   # 3. only if make left something to do
morpho vary poster.morpho --vary 'Title.preset=Ice chrome|Plasma|Molten'   # (optional) compare options in one sheet
morpho video poster.morpho -o poster.mp4                    # 4. done
```

A good design takes **2–3 calls and one image**: write the spec, `make`, then `video` (or `render`). `make` prints what it built, every layer's box and margins, what it fixed, the findings, and the commands for whatever is left, so the picture is for judging the look, not for finding mistakes.

To change the design, edit the spec and run `make` again: it rebuilds everything (so a spec is the design's source; `set` edits on the `.morpho` file are lost on the next `make`).

### Example

`night.json`:

```json
{
  "name": "Night Drive",
  "canvas": "1080x1350",
  "kit": "chrome-night",
  "duration": 4,
  "layers": [
    { "shape": "ring", "name": "Halo", "color": "accent", "fitWidth": 80, "place": "top third", "motion": { "loop": "pulse", "amount": 6, "period": 4 } },
    { "text": "NIGHT\nDRIVE", "name": "Title", "fitWidth": 78, "place": "top third", "modifiers": [{ "kind": "wave", "amplitude": 0.04, "wavelength": 1.4 }] },
    { "shape": "sparkle", "name": "Spark", "size": 200, "place": "top right", "margin": 110, "motion": { "loop": "spin", "period": 4 } },
    { "text": "LIVE · 21.11 · WAREHOUSE 9", "name": "Info", "place": "bottom", "margin": 120 }
  ],
  "motion": { "recipe": "cascade", "layers": ["Title", "Info"] }
}
```

```
$ morpho make night.json
wrote night.morpho from night.json
"Night Drive" 1080×1350, 4s loop, kit chrome-night: 4 layers
motion cascade: Title, Info: enter rise 0.15s apart, leaving from 3.17s so the 4s loop joins
motion Halo: loop pulse
motion Spark: loop spin
layout: Halo: fit 80% wide, at top third · Title: fit 78% wide, at top third · Spark: at top right (margin 110) · Info: at bottom (margin 120)
boxes on 1080×1350 (px; x,y from the centre; negative margins are off the canvas), top first:
"Info"                     463×25     centre 0,542      margins L 308 R 308 T 1205 B 120 · 35px type
"Spark"                    200×200    centre 330,-465   margins L 770 R 110 T 110 B 1040
"Title"                    842×387    centre 0,-225     margins L 119 R 119 T 256 B 706 · 210px type
"Halo"                     864×864    centre 0,-225     margins L 108 R 108 T 18 B 468
"Night Drive" 1080×1350, 4s loop: no problems, 2 warnings
! "Title" and "Spark": rights 8.808px apart, nearly lined up
! "Halo": only 18px from the top edge: crowded (bleed it off or give it room)
· the loop joins smoothly
· visual weight sits upper (16% of the way to the edge)
· palette: 2 main hues (violet, azure), mostly neutrals
· looked at 4 of 4 layers
still to do:
  morpho align night.morpho "Spark" --to "Title" --edge right   # "Title" and "Spark": rights 8.808px apart, nearly lined up
  morpho set night.morpho '"Halo".contain=true'   # "Halo": only 18px from the top edge: crowded (bleed it off or give it room)
wrote test-results/morpho/night-make.png (1000×338)
next: run the commands under "still to do" (add --check to see what each changes), or edit night.json and make again
```

Run the two commands (each with `--check` to see what it changed), or change the spec (`"margin": 120` on Spark is one way to settle the first) and `make` again.

The picture is the design at rest, or (when it moves) at rest plus three moments on the clock in one strip.

## The spec

JSON. Layers are listed **bottom first**: later ones draw on top.

| Key | What it is |
| --- | --- |
| `name` | The design's name. |
| `canvas` | `"1080x1350"`, a preset name (`"Instagram post"`, see `catalog canvas`) or `{ "width", "height" }`. |
| `kit` | A style kit (below): background, fonts and a look for each role. |
| `background` | `"#111111"`, `"#a,#b"` (a gradient), a background preset (`"Paper"`) or a background object. Overrides the kit's. |
| `duration`, `loop` | The clock, in seconds (looping unless `"loop": false`). |
| `style` | `poster` (default), `logo` or `abstract` (see `check`). |
| `layers` | The layers, bottom first (below). |
| `layout` | Stacks and rows: `{ "stack": ["Title", "Info"], "gap": 40, "align": "centre", "place": "centre" }`, or `"row": […]`. |
| `motion` | Motion recipes over several layers: `{ "recipe": "cascade", "layers": ["Title", "Info"] }` (or a list of them). |
| `set` | Assignments applied last, as `set` takes them: `["Title.gloss=0.6", "background.grain=0.2"]`. |

A layer is one of `"text": "HI\nTHERE"`, `"shape": "star"`, `"line": "<svg d>"`, `"path": "<svg d>"` (path data in em units, centred on 0,0) or `"group": [ …layers… ]` (with `"merge": true` they fuse into one shape). Then any of:

| Key | What it is |
| --- | --- |
| `name` | How commands address it. |
| `role` | `headline`, `accent` or `body`: which of the kit's looks it takes. By default the first text is the headline, other text is body, and everything else is accent. |
| `font`, `size`, `tracking` | Text: a bundled font id (`catalog fonts`), px, em. A headline with no size fills 80% of the width. |
| `color` | `#rrggbb`, or a kit palette name (`"accent"`, `"ink"`): the look's one main colour (a flat fill, a neon's glow, an ink), or flat in that colour when the look has none. |
| `preset`, `material`, `recipe` | A material look by name (`catalog presets`), a material id, a modifier recipe. A `preset` or `material` replaces the kit's look. |
| `modifiers` | `[{ "kind": "wave", "amplitude": 0.04 }, "slant"]`. |
| `fitWidth`, `fitHeight`, `place`, `margin`, `centre`, `contain`, `offset` | Layout in words (below). |
| `at`, `rotation`, `scale`, `width` | Plain position (`"x,y"` px from the centre), degrees, scale, and a pen line's stroke width. Use `place` instead of `at` where you can. |
| `set` | Any other setting: `{ "gloss": 0.4, "wave.amplitude": 0.05 }`. |
| `motion` | This layer's motion: a recipe's fields (`{ "enter": "rise", "delay": 0.3 }`, `{ "loop": "float" }`), or motion settings as they're stored (`catalog motion`). |

## Layout in words

Measure, then place: every instruction is resolved against the engine's real build boxes (what's drawn, not the anchor), so italic, wavy or warped type lands where it looks like it should.

| Instruction | What it does |
| --- | --- |
| `fitWidth: 80`, `fitHeight: 30` | Sizes the layer (or group) so its box is that % of the canvas width / height. Both: it fits inside both. Fits happen first; the layer then stays centred where it was. |
| `place: "top"` | `top`, `centre`, `bottom`, `top third`, `bottom third`, `left`, `right`, `top left`, `top right`, `bottom left`, `bottom right`. One word centres the other axis. Thirds put the box's centre on the third line. |
| `margin: 64` | Distance from the edges for `place`, in px or `"6%"` of the short side (default 6%). |
| `centre: "x"` | Centres by ink: `x`, `y` or `both` (`true`). |
| `contain: true` | Shrinks it if it's bigger than the canvas inside the margins, then moves it inside them. |
| `offset: [0, -60]` | A nudge in px after placing. |
| `stack` / `row` | Several layers one under another (or side by side), first listed first, `gap` px apart, aligned `start`, `centre` or `end` across (`left`, `right`, `top`, `bottom` work too), and placed as one block with `place` and `margin`. |

The same instructions work on files you already have:

```sh
morpho add poster.morpho text "Sat 14 June" --place "bottom left" --margin 80
morpho add poster.morpho shape star --fit-height 30 --place centre
morpho set poster.morpho 'Title.place=top third' 'Title.fitWidth=80' 'Info.margin=5%' 'Info.centre=x'
morpho set poster.morpho --stack "Date,Venue" --gap 12 --align left --place "bottom left"
morpho align poster.morpho Title Info            # centre by what's drawn (--to Layer, --edge left…)
```

## Kits

A kit gives a design a background, a palette, a font pairing and a look for each role in one word. Anything a layer sets itself wins. `catalog kits` lists them with their contents.

| Kit | Look |
| --- | --- |
| `chrome-night` | liquid chrome on near-black, a violet glow, grotesk captions |
| `neon-club` | neon tubes on black, pink and cyan |
| `riso-zine` | two-ink risograph on warm paper, tall condensed headline |
| `brutal-pop` | flat colour, thick outlines and hard shadows on a green grid |
| `puff-sky` | puffy inflated letters on deep sky blue, pink accents |
| `editorial` | black serif on paper with a red stamp |
| `holo-y2k` | holographic foil and an acid aura on black |
| `arcade` | pixel type in chunky 3D on electric violet |

`new <file> --kit name` starts a file with a kit; `add` then gives each layer its role's look (`--role headline|accent|body`).

## Motion recipes

Several layers in one go, on today's motion model (entrances, loops, ways out), so nobody works out delays or writes keyframes by hand. On a looping clock everything that enters also leaves before the clock ends (the entrance's own way out: rise leaves rising, grow shrinks away), so the loop joins without a jump. `"leave": "none"` keeps things on screen.

| Recipe | What it does |
| --- | --- |
| `cascade` | each rises in, one after another |
| `pop` | each grows in with a spring |
| `type-on` | text fades in letter by letter |
| `slide-in` | each slides in from the left |
| `drop` | each drops in from above with a bounce |
| `drift` | everything floats, out of step |
| `breathe` | everything pulses gently, out of step |

Or by hand: `enter` (`fade`, `rise`, `drop`, `left`, `right`, `grow`, `spin`), `stagger` (s between layers), `start` (s), `feel` (`Smooth`, `Snappy`, `Bouncy`, `Slow`), `duration` (s), `distance`, `letters` (`true` or `"words"`) with `letterStagger`, `loop` with `period`, `amount` and `spread` (phase step between layers), `leave` (`auto`, `none`, `fade`, `rise`…) and `leaveAt`.

```sh
morpho motion poster.morpho Title Info Date --recipe cascade
morpho motion poster.morpho --enter rise --stagger 0.15 --feel Snappy     # every top-level layer, bottom up
morpho motion poster.morpho Star --loop spin --period 4
```

## check, --fix, set --check

`check` says what's wrong in words, marks what it can mend with `[--fix]`, and prints the rest as commands to run.

```sh
morpho check poster.morpho            # findings; "N can be fixed automatically"; to do: commands
morpho check poster.morpho --fix      # applies the mechanical fixes, writes the file, checks again
morpho set poster.morpho 'Title.size=240' --check   # just what that edit changed in the findings
```

`--fix` mends what has one right answer:

- **text cut off** by the canvas: shrunk to fit inside the margins and moved in;
- **nearly centred** (0.2–1.2% off): centred by its ink;
- **an entrance that replays at the loop's seam**: a way out timed to end before the clock does (and the entrance brought forward if it would otherwise not hold still);
- **a move the clock cuts off**: started earlier, then its stagger tightened, then made quicker.

Everything else comes back as a ready-to-run command (`align … --edge left` for a near-miss, `set … contain=true` for something crowding an edge, a size for a headline without a clear lead, a fill for low contrast, `arrange … top` for something covered), or in words when it needs judgment.

`set --check` (and `make`) remember each version's findings, so `--check` only checks the new one and prints what appeared (`+`), went away (`−`) or changed (`~`).

**`--style poster|logo|abstract`** (on `new`, `make`, `set`, or one `check`) says what kind of design it is; it's kept in the file. For `abstract` work, rules of taste (near-misses and centring, a clear lead, crowded edges, how many hues) become notes; mistakes (off the canvas, unseen, low contrast, loop jumps, pops) stay warnings.

### What check looks for

**From the project and the engine's build:** layers the engine couldn't build; layers entirely or partly off the canvas; text too small to read; unknown materials and invalid colours; settings outside their range; keyframes that point at nothing; entrances or exits timed after the clock ends, or cut off by it.

**From the boxes (layout notes):** edges and centres that nearly line up, 0.2–1.2% of the canvas apart (closer than that, nobody sees it); layers that are nearly centred; things crowding an edge; a design that sits a little off centre; two headlines of about the same size (no clear lead); too many text sizes.

**From the pixels:** layers that can't be seen at rest (each layer is hidden in turn and the image compared, scaled to the layer's size so hairlines and tiny marks count); text with low contrast against what's actually behind it (measured on its best-separated quarter, so outlines, hard shadows and lit edges count); a blank, one-colour design; pops in the motion (one frame step far bigger than the steps on both sides of it); a loop that jumps where it starts over; where the visual weight sits, and how many hues the palette really uses.

## Every command

| Command | What it gives back | Browser? |
| --- | --- | --- |
| `make <spec.json> [-o f]` | A whole design from a spec: built, placed, mechanically fixed (`--no-fix` to skip), checked, one PNG. `--kit`, `--style`, `--at` / `--frames` for the picture. | yes |
| `catalog [query]` | What designs are made of. With no query, a one-screen index. With a section (`kits`, `materials`, `modifiers`, `shapes`, `motion`, `keyframes`, `layers`, `presets`, `recipes`, `fonts`, `backgrounds`, `canvas`, `templates`), that whole section. With a name (`chrome`, `glitch`, `star`, `"Ice chrome"`, `riso-zine`), every setting with its range, default and label. Anything else is searched. | no |
| `describe <scene>` | The design as a text tree, top layer first, showing **only settings that differ from the defaults**. | no |
| `scene <template> [-o f]` | Writes a template as an editable `.morpho` file. | no |
| `set <file> <a=b>…` | Edits a `.morpho` file in place and prints each change (`--dry` to only print them). Layout assignments (`L.place=…`) and `--stack`/`--row` are resolved against the build; `--check` prints what changed in the findings; `--style` sets the design's style. | layout and `--check` only |
| `new <file>` | A blank design: `--canvas`, `--bg`, `--duration`, `--kit`, `--style`. | no |
| `add <file> text "HI"` · `shape star` · `line "<d>"` · `path "<d>"` | A new layer. Options: `--name`, `--at x,y`, `--size`, `--font`, `--color`, `--material` or `--preset`, `--recipe`, `--rotation`, `--scale`, `--width` (lines), `--above L`, `--below L` or `--into Group`, `--role`, and layout: `--fit-width`, `--fit-height`, `--place`, `--margin`, `--centre`. | layout only |
| `add <file> modifier glitch --to L` | A modifier with its defaults; `--fields '{"amount":0.6}'` overrides them. A recipe name adds that recipe. | no |
| `add <file> group A B` | Wraps layers in a group where the topmost one was (`--merge` fuses them into one shape). | no |
| `add <file> font f.ttf` · `image p.png` | Embeds a font and prints its id for `--font`. Places a picture in a rectangle, or with `--to L` fills that layer with it. | yes |
| `motion <file> [L…]` | A motion recipe (`--recipe`) or entrances, loops and ways out by hand over several layers (default: every top-level layer, bottom up). | no |
| `remove` · `duplicate` · `arrange` | `remove <file> L…`. `duplicate <file> L` (new ids, so its keyframes follow its own modifiers). `arrange <file> L top\|bottom\|up\|down\|above M\|below M`. | no |
| `align <file> L… [--to canvas\|M] [--edge centre,middle]` | Lines layers (or groups) up by what they draw. | yes |
| `layout <scene>` | Every layer's box, centre and margins as text, plus the layout notes. | yes |
| `timing <scene>` | When everything moves: entrances and exits as bars on the clock, loops and keyframes as their cycles, with notes on rhythm. | no |
| `render <scene>` | A PNG at one time (at rest by default), or a captioned filmstrip with `--at 0,1,2` / `--frames 8`. | yes |
| `vary <scene>` | One PNG with a captioned cell per variation: `--vary` multiplies lists of values, `--variant 'a=1; b=2'` adds hand-made combinations. | yes |
| `check <scene>` | Findings in words, `--fix`, `--style` (above). | yes |
| `compare <scene> <image>` | How close the design is to a reference picture: colour, pixel and layout scores, plus one reference \| design \| difference image. | yes |
| `fit <file> <ref> L.setting…` | Tunes each setting in turn until the design matches a reference picture. | yes |
| `video <scene> -o f.mp4` | MP4, MOV, WebM or GIF (needs ffmpeg), or PNG frames into a folder ending in `/`. Every frame is drawn at its exact time, so loops join seamlessly. `--fps`, `--size`, `--scale`. | yes |
| `serve` / `stop` | Keeps Vite and a browser running (`MORPHO_PORT`, default 7801). Drawing commands then take about a second instead of 5–15 s. | — |

`<scene>` is a template name (exact, any case, or a unique part of one) or a `.morpho`/`.json` file. PNGs go to `test-results/morpho/` unless you pass `--out`. `--json` gives machine-readable output.

## Editing: `Layer.setting=value`

The same assignments work for `set`, a spec's `set`, and `--set`, `--vary` and `--variant` on any command (with `--set`, files are left alone):

```sh
morpho set y2k.morpho 'Topo blob.gloss=0.8'           # a material setting
morpho set y2k.morpho '"Serif K".fill="#ff2d55"'      # quote names that contain dots
morpho set y2k.morpho 'Pixel 2.pixelate.size=0.1'      # the layer's first modifier of that kind
morpho set y2k.morpho 'Spikes.rays=20'                 # a shape field
morpho set y2k.morpho 'Caption.text="Hello"'           # a content field
morpho set y2k.morpho 'Chrome star.motion.loop=spin'   # motion is created when missing
morpho set y2k.morpho 'Ball.animate.liquid={"to":1,"period":4,"phase":0,"mode":"swing"}'
morpho set y2k.morpho 'canvas.width=1080' 'timeline.duration=4' 'background.grain=0.2'
```

- **Addressing a layer.** Use its name or its `#id`. Bare keys find their own home: a material setting, a content field, a shape field, or a modifier kind. A full path (`style.params.gloss`, `modifiers.0.amount`) also works.
- **Values.** A value is JSON when it parses as JSON, and plain text otherwise. `null` removes a key.
- **Checks.** Numbers are checked against the setting's range. Unknown layers or settings fail with a list of the names that would have worked.
- **Presets and recipes.** `Layer.preset="Ice chrome"` switches to that look. `Layer.recipe=Glitch` adds that recipe's modifiers.
- **Motion kinds.** Setting `motion.loop`, `motion.enter` or `motion.leave` also sets that kind's own default amount (spin counts turns, sway counts degrees). Set the amount after the kind.
- **Changing the material.** Setting `effect` switches the material. Settings the old and new materials share are kept; the rest start at the new material's defaults.
- **Template ids.** They are generated afresh each time a template is made, so address template layers by name. After `scene`, the ids in the file stay fixed.

## Speed

Drawing runs on the GPU by default, with SwiftShader as a fallback if WebGL won't start there. Pass `--cpu` (or set `MORPHO_CPU=1`) for SwiftShader everywhere: the same pixels on every machine, about 4× slower.

While a job runs, the editor's live preview is held still, because its animation loop competes for the main thread.

With `serve` running, on an M-series Mac:

| Command | Time |
| --- | --- |
| `render` (14-layer animated poster) | 0.2 s |
| six-frame filmstrip | 0.3 s |
| six-cell `vary` | 0.8 s |
| full `check` (14 layers) | 1.9 s |
| `make` (4-layer animated poster: build, layout, fixes, check, picture) | 0.9 s |
| `set --check` | 0.6–1.1 s |

Under `serve`, edits to the app's TypeScript reload the page by themselves. After an engine (Rust) change, run `npm run wasm:dev`.

## How it fits together

| File | What it does |
| --- | --- |
| `ui/src/agent/make.ts` | Specs to projects: layers bottom first, kit looks by role, modifiers, settings, motion recipes; the layout comes back as instructions for the page to resolve. |
| `ui/src/agent/place.ts` | Layout in words (fit, place, stack, row, centre, contain) and `align`, as edits computed from build boxes. |
| `ui/src/agent/kits.ts` | The style kits. A test checks that every font, preset and background they name exists. |
| `ui/src/agent/moves.ts` | Motion recipes, and ways out timed to end before a looping clock does. |
| `ui/src/agent/fix.ts` | What `--fix` does (retiming, the loop seam), the commands it leaves, and the difference between two checks. |
| `ui/src/agent/catalog.ts` | Generates the catalog from the same registries the Inspector draws from (`EFFECTS`, `PRESETS`, `MODIFIER_UI`, `SYMBOL_UI`, `LOOP_UI`, …), so new materials, modifiers and shapes show up without touching it. A test fails if the layer-format notes miss a field that the layer factories create. |
| `ui/src/agent/describe.ts` | The text tree. |
| `ui/src/agent/edit.ts` | Assignments and their checks. |
| `ui/src/agent/build.ts` | New designs, layers, modifiers, groups, duplicates and restacking. |
| `ui/src/agent/layout.ts` | Boxes, layout notes, balance and palette. |
| `ui/src/agent/timing.ts` | The timing chart and rhythm notes (from the timeline dock's own tracks). |
| `ui/src/agent/check.ts` | Structural checks and the pixel measures (pure, unit-tested). |
| `ui/src/agent/page.ts` | The in-app side, on `await window.morphotype.agent()` (its own chunk). Loads a project with its fonts and pictures, builds it at export quality, resolves layout against the build, draws frames through the renderer's export path, and runs `make`, `check` and `--fix`. Contact sheets are composed in an `OffscreenCanvas`. |
| `ui/src/agent/node.ts` | What the no-browser commands load in Node through Vite's SSR loader. |
| `scripts/morpho.mjs` | The CLI: argument parsing, next-step hints, the findings kept for `--check` (`test-results/morpho/.checks/`), Vite and Playwright, the `serve` daemon. |
