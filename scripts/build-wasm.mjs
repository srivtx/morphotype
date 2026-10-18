// Build the Rust engine to WebAssembly and generate JS bindings.
// Usage: node scripts/build-wasm.mjs [--dev]
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const profile = dev ? 'debug' : 'release';
const out = path.join(root, 'ui/src/engine/pkg');

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

function has(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!has('wasm-bindgen')) {
  console.error('wasm-bindgen is missing. Install it with:\n  cargo install wasm-bindgen-cli --version 0.2.129\n  rustup target add wasm32-unknown-unknown');
  process.exit(1);
}

run('cargo', ['build', '-p', 'morpho-wasm', '--target', 'wasm32-unknown-unknown', ...(dev ? [] : ['--release'])]);
const wasm = path.join(root, `target/wasm32-unknown-unknown/${profile}/morpho_wasm.wasm`);
run('wasm-bindgen', ['--target', 'web', '--out-dir', out, '--out-name', 'morpho', wasm]);

const bin = path.join(out, 'morpho_bg.wasm');
if (!dev && has('wasm-opt')) {
  run('wasm-opt', ['-O3', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '-o', bin, bin]);
}
if (existsSync(bin)) {
  console.log(`engine: ${(statSync(bin).size / 1024).toFixed(0)} KiB (${profile})`);
}
