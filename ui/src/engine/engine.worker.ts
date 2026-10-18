// Runs the Rust engine off the main thread so the UI stays at 60 fps while
// geometry is rebuilt.
import init, * as morpho from './pkg/morpho.js';
import wasmUrl from './pkg/morpho_bg.wasm?url';
import type { Request, Response } from './protocol';

const ready = init({ module_or_path: wasmUrl });

function reply(msg: Response, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  try {
    await ready;
    switch (req.type) {
      case 'loadFont': {
        const info = JSON.parse(morpho.loadFont(req.id, req.bytes, req.index ?? 0));
        reply({ id: req.rid, ok: true, value: info });
        break;
      }
      case 'unloadFont':
        morpho.unloadFont(req.id);
        reply({ id: req.rid, ok: true, value: null });
        break;
      case 'build': {
        const t0 = performance.now();
        const out = JSON.parse(morpho.build(req.doc));
        out.ms = performance.now() - t0;
        reply({ id: req.rid, ok: true, value: out });
        break;
      }
      case 'exportSvg':
        reply({ id: req.rid, ok: true, value: morpho.exportSvg(req.doc, req.opts) });
        break;
      case 'exportFont': {
        const bytes = morpho.exportFont(req.spec);
        reply({ id: req.rid, ok: true, value: bytes }, [bytes.buffer]);
        break;
      }
      case 'trace':
        reply({ id: req.rid, ok: true, value: JSON.parse(morpho.traceImage(req.rgba, req.width, req.height, req.opts)) });
        break;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A RuntimeError means the module trapped; its state can't be trusted.
    reply({ id: req.rid, ok: false, error: message, fatal: e instanceof WebAssembly.RuntimeError });
  }
};
