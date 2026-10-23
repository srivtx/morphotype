# morpho: the app from the command line

`scripts/morpho.mjs` drives Morphotype without its interface. It's built for AI agents (and scripts) designing in the app: every command answers in a few lines of text or in **one** PNG, so learning what exists, reading a design, editing it and judging it doesn't mean reading source files or taking a pile of screenshots.

```sh
npm run morpho -- help
```

## Commands

| Command | What it gives back | Browser? |
| --- | --- | --- |
| `catalog [query]` | What designs are made of. With no query, a one-screen index. With a section (`materials`, `modifiers`, `shapes`, `motion`, `keyframes`, `layers`, `presets`, `recipes`, `fonts`, `backgrounds`, `canvas`, `templates`), that whole section. With a name (`chrome`, `glitch`, `star`, `"Ice chrome"`), every setting with its range, default and label. Anything else is searched. | no |
| `describe <scene>` | The design as a text tree, top layer first. Each layer is one line: what it is, where it sits, its material, modifiers, motion and keyframes, showing **only settings that differ from the defaults**. | no |
| `scene <template> [-o f]` | Writes a template as an editable `.morpho` file. | no |
| `set <file> <a=b>…` | Edits a `.morpho` file in place and prints each change (`--dry` to only print them). | no |
| `render <scene>` | A PNG. With one time it's that frame (at rest by default). With `--at 0,1,2` or `--frames 8` it's one captioned filmstrip. | yes |
| `vary <scene>` | One PNG with a captioned cell per variation: `--vary` multiplies lists of values, `--variant 'a=1; b=2'` adds hand-made combinations. | yes |
| `check <scene>` | Problems, in words (see below). | yes |
| `compare <scene> <image>` | How close the design is to a reference picture: colour, pixel and layout scores, plus one reference \| design \| difference image. | yes |
| `serve` / `stop` | Keeps Vite and a browser running. While it's up, drawing commands take well under a second instead of 5–15 s. | — |

`<scene>` is a template name (exact, any case, or a unique part of one) or a `.morpho`/`.json` file. PNGs go to `test-results/morpho/` unless you pass `--out`. `--json` gives machine-readable output.

## Editing: `Layer.setting=value`

Use the same assignments for `set`, and for `--set`, `--vary` and `--variant` on any command (with `--set`, files are left alone):

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
- **Changing the material.** Setting `effect` switches the material. Settings the old and new materials share are kept; the rest start at the new material's defaults.
- **Template ids.** They are generated afresh each time a template is made, so address template layers by name. After `scene`, the ids in the file stay fixed.

## What `check` looks for

**From the project and the engine's build:**
- layers the engine couldn't build;
- layers entirely or partly off the canvas;
- text too small to read;
- unknown materials and invalid colours;
- settings outside their range;
- keyframes that point at nothing;
- entrances or exits timed after the clock ends.

**From the pixels:**
- layers that can't be seen at rest: each layer is hidden in turn and the image compared, scaled to the layer's size so hairlines and tiny marks count;
- text with low contrast against what's actually behind it;
- a blank, one-colour design;
- sudden jumps in the motion (frame pairs one video frame apart, sampled across the clock);
- a loop that jumps where it starts over.

## Speed

Drawing runs on the GPU by default, with SwiftShader as a fallback if WebGL won't start there. Pass `--cpu` (or set `MORPHO_CPU=1`) for SwiftShader everywhere: the same pixels on every machine, about 4× slower.

While a job runs, the editor's live preview is held still, because its animation loop competes for the main thread.

With `serve` running, timings on an M-series Mac for a 14-layer animated poster:

| Command | Time |
| --- | --- |
| `render` | 0.2 s |
| six-frame filmstrip | 0.3 s |
| six-cell `vary` | 0.8 s |
| full `check` | 1.9 s |

Under `serve`, edits to the app's TypeScript reload the page by themselves. After an engine (Rust) change, run `npm run wasm:dev`.

## How it fits together

| File | What it does |
| --- | --- |
| `ui/src/agent/catalog.ts` | Generates the catalog from the same registries the Inspector draws from (`EFFECTS`, `PRESETS`, `MODIFIER_UI`, `SYMBOL_UI`, `LOOP_UI`, …), so new materials, modifiers and shapes show up without touching it. A test fails if the layer-format notes miss a field that the layer factories create. |
| `ui/src/agent/describe.ts` | The text tree. |
| `ui/src/agent/edit.ts` | Assignments and their checks. |
| `ui/src/agent/check.ts` | Structural checks and the pixel measures (pure, unit-tested). |
| `ui/src/agent/page.ts` | The in-app side, on `await window.morphotype.agent()` (its own chunk). Loads a project with its fonts and pictures, builds it at export quality, and draws frames through the renderer's export path. Contact sheets are composed in an `OffscreenCanvas`. |
| `ui/src/agent/node.ts` | What the no-browser commands load in Node through Vite's SSR loader. |
| `scripts/morpho.mjs` | The CLI: argument parsing, Vite and Playwright, the `serve` daemon (`MORPHO_PORT`, default 7801). |
