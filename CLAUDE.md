# Morphotype

A type and logo lab. The geometry engine is Rust (`crates/morpho-core`), compiled to WebAssembly and run in a worker. The UI is React/TypeScript (`ui/src`), and materials are WebGL2 shaders (`ui/src/render`). `docs/ARCHITECTURE.md` explains how they fit together.

## Designing in the app: use morpho

Don't read the template or effect sources to learn what exists, and don't screenshot the editor to judge a design. Use the CLI (`docs/AGENT-TOOLS.md`):

```sh
npm run morpho -- serve &                 # once: keeps a browser warm (drawing then takes < 1 s)
npm run morpho -- catalog                 # what exists; then: catalog chrome / glitch / star / motion / keyframes / layers
npm run morpho -- describe "UFO poster"   # a design as text, changed settings only
npm run morpho -- scene "UFO poster" -o ufo.morpho
npm run morpho -- set ufo.morpho 'Title.gloss=0.4' 'Star.x=-120'
npm run morpho -- render ufo.morpho --frames 6           # one filmstrip image
npm run morpho -- vary ufo.morpho --vary 'Title.liquid=0.2,0.6,1.2'
npm run morpho -- check ufo.morpho                       # problems in words
npm run morpho -- compare ufo.morpho reference.png

npm run morpho -- new poster.morpho --canvas 1080x1350 --bg "#111111"   # from scratch
npm run morpho -- add poster.morpho text "HELLO" --size 200 --preset "Ice chrome"
npm run morpho -- align poster.morpho HELLO                            # centre by what's drawn
npm run morpho -- layout poster.morpho                                 # boxes and margins as text
npm run morpho -- timing poster.morpho                                 # when everything moves
npm run morpho -- video poster.morpho -o poster.mp4
```

Prefer `check`, `describe` and text output over images. When you do need to look, ask for one contact sheet (`--frames`, `vary`), not several renders.

## Commands

- `npm run dev`: the app at http://localhost:1420 (builds the engine in debug first)
- `npm test`: Rust and TypeScript unit tests
- `npm run typecheck`
- `npm run build && npm run test:e2e`: browser end-to-end test
- `npm run wasm:dev`: rebuild the engine after Rust changes
