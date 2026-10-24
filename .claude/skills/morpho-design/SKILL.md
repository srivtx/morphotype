---
name: morpho-design
description: Design posters, logos, type and motion in Morphotype with the morpho CLI (make → check --fix → vary → video). Use when asked to make, change or judge a design, poster, logo, lettering or animation in the app — not for work on the app's own code.
---

# Designing with morpho

Morphotype designs are made with `npm run morpho -- …` (`scripts/morpho.mjs`). Don't read template, material or effect sources to learn what exists, and don't screenshot the editor: the CLI answers in a few lines of text or one PNG. Full reference: `docs/AGENT-TOOLS.md`.

## The workflow: aim for 2–3 calls and one image

1. **Start the daemon once** (drawing then takes about a second): `npm run morpho -- serve &`
2. **Look up only what you need**, in text: `morpho catalog kits`, `catalog fonts`, `catalog presets`, `catalog shapes`, `catalog motion`, or a name (`catalog chrome`).
3. **Write a spec and `make` it.** One call builds the design, places everything against the engine's real outlines, fixes what's mechanical, checks it and draws one PNG:

   ```json
   {
     "name": "Summer Sound", "canvas": "1080x1350", "kit": "riso-zine", "duration": 5,
     "layers": [
       { "shape": "sparkle", "name": "Mark", "fitHeight": 20, "place": "top third" },
       { "text": "SUMMER\nSOUND", "name": "Title", "fitWidth": 82, "place": "centre" },
       { "text": "12 JULY · RIVERSIDE", "name": "Info", "place": "bottom", "margin": 90 }
     ],
     "motion": { "recipe": "cascade", "layers": ["Mark", "Title", "Info"] }
   }
   ```

   `npm run morpho -- make summer.json` → `summer.morpho`, findings, `test-results/morpho/summer-make.png`.
4. **Read the text first.** `make` prints every box and margin, what it fixed and the findings. Look at the PNG once, to judge the look; after a later `make` with no warnings you don't need to look again.
5. **If something's left**, run the commands under "still to do" with `--check` (it prints only what changed in the findings), or edit the spec and `make` again. `check <file> --fix` mends cut-off text, near-centring, loop seams and moves the clock cuts off.
6. **Compare options in one sheet**, not several renders: `morpho vary summer.morpho --vary 'Title.preset=Ice chrome|Plasma'`.
7. **Finish**: `morpho video summer.morpho -o summer.mp4` (moving) or `morpho render summer.morpho --out summer.png` (still).

Every command ends with `next: …`: the likely next command.

## Spec essentials

- Layers are **bottom first**. A layer is `text`, `shape`, `line`, `path` or `group`.
- **Place with words, not pixels**: `fitWidth` / `fitHeight` (% of the canvas), `place` (`top`, `centre`, `bottom`, `top third`, `bottom third`, `left`, `right`, `top left`…), `margin` (px or `"6%"`), `centre` (`x`, `y`, `true`), `contain`, `offset` [x, y]. Stacks and rows: `"layout": [{ "stack": ["Date", "Venue"], "gap": 12, "align": "left", "place": "bottom left" }]`.
- **Kits** (`chrome-night`, `neon-club`, `riso-zine`, `brutal-pop`, `puff-sky`, `editorial`, `holo-y2k`, `arcade`) set the background, fonts and a look per role. The first text is the headline, other text is body, shapes are accent; `role`, `font`, `preset` or `material` override it; `color` (hex or a palette name like `"accent"`) tints the look's main colour.
- **Motion recipes**: `cascade`, `pop`, `type-on`, `slide-in`, `drop`, `drift`, `breathe`, or `enter` / `stagger` / `feel` / `loop` by hand. On a looping clock, things that enter also leave before the end, so loops join.
- Anything else: a layer's `"set": { "gloss": 0.4 }`, `"modifiers": [{ "kind": "wave", "amplitude": 0.04 }]`, or the spec's `"set": ["Title.liquid=1"]`.
- `"style": "abstract"` turns rules of taste (centring, near-misses, clear lead, crowding, hue count) into notes; mistakes stay warnings.

## Editing an existing design

`morpho describe f.morpho` (text tree) → `morpho set f.morpho 'Title.gloss=0.4' 'Info.place=bottom left' --check` → `morpho check f.morpho --fix`. Templates: `morpho scene "UFO poster" -o ufo.morpho`. When the design was made from a spec, change the spec and `make` again instead: `make` rebuilds from the spec.
