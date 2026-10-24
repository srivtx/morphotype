# Morphotype

A type and logo lab. The geometry engine is Rust (`crates/morpho-core`), compiled to WebAssembly and run in a worker. The UI is React/TypeScript (`ui/src`), and materials are WebGL2 shaders (`ui/src/render`). `docs/ARCHITECTURE.md` explains how they fit together.

## Designing in the app: use morpho

To make, change or judge a design, use the `morpho` CLI, not the template or effect sources or editor screenshots: write a spec, `npm run morpho -- make spec.json`, then `check --fix`, `vary` and `video`. The `morpho-design` skill (`.claude/skills/morpho-design/SKILL.md`) has the workflow and `docs/AGENT-TOOLS.md` the reference.

## Commands

- `npm run dev`: the app at http://localhost:1420 (builds the engine in debug first)
- `npm test`: Rust and TypeScript unit tests
- `npm run typecheck`
- `npm run build && npm run test:e2e`: browser end-to-end test
- `npm run wasm:dev`: rebuild the engine after Rust changes
