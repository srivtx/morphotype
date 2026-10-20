// Live render studio for template work: one Vite dev server (hot reload) and one
// long-lived browser, driven over a tiny local HTTP API, so "edit → render →
// compare" takes seconds instead of a rebuild and a cold browser each time.
//
//   node scripts/studio.mjs                      # starts on http://127.0.0.1:7799
//   curl '127.0.0.1:7799/render?tpl=UFO%20poster&scale=0.8333&out=/tmp/ufo.png'
//   curl '127.0.0.1:7799/compare?tpl=UFO%20poster&ref=/path/ref.png&out=/tmp/diff.png'
//   curl --data-binary @snippet.js 127.0.0.1:7799/eval    # run JS in the page (m = morphotype)
//   curl '127.0.0.1:7799/shot?out=/tmp/ui.png'                    # screenshot the app
//
// /render writes the artboard as a PNG through the renderer's own export; add
// fast=1 for quick drafts (no 2× field supersampling).
// /compare renders at the reference's size and returns mean colour difference,
// the share of clearly different pixels, and writes a side-by-side + heat map.
// Rust changes still need `npm run wasm:dev`; the page reloads by itself.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.STUDIO_PORT ?? 7799);
const vite = spawn('npx', ['vite', '--port', '1420', '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => {
  vite.stdout.on('data', (d) => String(d).includes('Local') && ok());
  vite.on('exit', (code) => fail(new Error(`vite exited (${code}); is port 1420 taken?`)));
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => m.text().startsWith('[studio]') && console.log(m.text()));
const ready = async () => {
  await page.goto('http://127.0.0.1:1420/?editor');
  await page.waitForFunction(() => window.morphotype?.renderer, null, { timeout: 60_000 });
};
await ready();

/** Load a template, let the engine build, and export the artboard. */
async function render(tpl, scale, fast = false) {
  if (!(await page.evaluate(() => !!window.morphotype?.renderer))) await ready();
  const b64 = await page.evaluate(
    async ({ tpl, scale, fast }) => {
      const m = window.morphotype;
      m.renderer.exportSupersample = fast ? 1 : 2;
      const t = m.templates.find((x) => x.name === tpl);
      if (!t) throw new Error(`No template called “${tpl}”`);
      const t0 = performance.now();
      const before = m.store.get().build;
      m.store.set({ project: t.make(), selection: [], dialog: null, screen: 'editor' });
      // Wait for the engine's new build, then two frames for the renderer to pick it up.
      for (let i = 0; i < 600 && m.store.get().build === before; i++) await new Promise((r) => setTimeout(r, 20));
      for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
      const t1 = performance.now();
      const bytes = await m.renderer.exportPNG(scale, false);
      console.log(`[studio] ${tpl}: build ${(t1 - t0).toFixed(0)} ms, export ${(performance.now() - t1).toFixed(0)} ms`);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { tpl, scale, fast },
  );
  return Buffer.from(b64, 'base64');
}

/** Pixel comparison in the page (canvas 2D): mean |Δ| per channel and the share over 60. */
async function compare(png, refPath, outPath) {
  const ref = await readFile(refPath);
  const r = await page.evaluate(
    async ({ a, b }) => {
      const load = async (b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const [A, R] = await Promise.all([load(a), load(b)]);
      const w = R.width, h = R.height;
      const c = new OffscreenCanvas(w * 3, h);
      const g = c.getContext('2d');
      g.drawImage(R, 0, 0);
      g.drawImage(A, w, 0, w, h);
      const ra = g.getImageData(0, 0, w, h).data, aa = g.getImageData(w, 0, w, h).data;
      const heat = g.createImageData(w, h);
      let sum = 0, big = 0;
      for (let i = 0; i < ra.length; i += 4) {
        const d = Math.abs(ra[i] - aa[i]) + Math.abs(ra[i + 1] - aa[i + 1]) + Math.abs(ra[i + 2] - aa[i + 2]);
        sum += d / 3;
        if (d > 60) big++;
        const v = Math.min(255, d * 2);
        heat.data[i] = heat.data[i + 1] = heat.data[i + 2] = v;
        heat.data[i + 3] = 255;
      }
      g.putImageData(heat, w * 2, 0);
      const out = await c.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await out.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { mean: sum / (w * h), over60: big / (w * h), w, h, png: btoa(bin) };
    },
    { a: png.toString('base64'), b: ref.toString('base64') },
  );
  if (outPath) await writeFile(outPath, Buffer.from(r.png, 'base64'));
  return { mean: +r.mean.toFixed(2), over60: +(r.over60 * 100).toFixed(2), size: [r.w, r.h] };
}

createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  const q = Object.fromEntries(u.searchParams);
  try {
    if (u.pathname === '/render') {
      const png = await render(q.tpl, Number(q.scale ?? 1), q.fast === '1');
      if (q.out) await writeFile(q.out, png);
      res.end(JSON.stringify({ ok: true, bytes: png.length, out: q.out ?? null }));
    } else if (u.pathname === '/compare') {
      // Render at the reference's width so pixels line up.
      const { refW, artW } = await page.evaluate(
        async ({ b64, tpl }) => ({
          refW: (await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())).width,
          artW: window.morphotype.templates.find((x) => x.name === tpl)?.make().canvas.width ?? 1200,
        }),
        { b64: (await readFile(q.ref)).toString('base64'), tpl: q.tpl },
      );
      const png = await render(q.tpl, refW / artW, q.fast === '1');
      res.end(JSON.stringify({ ok: true, ...(await compare(png, q.ref, q.out)) }));
    } else if (u.pathname === '/eval' && req.method === 'POST') {
      // Run a snippet in the page (`m` is window.morphotype); handy for driving the UI.
      let body = '';
      for await (const chunk of req) body += chunk;
      const value = await page.evaluate(`(async (m) => { ${body} })(window.morphotype)`);
      res.end(JSON.stringify({ ok: true, value }));
    } else if (u.pathname === '/shot') {
      await page.screenshot({ path: q.out ?? '/tmp/studio.png' });
      res.end(JSON.stringify({ ok: true, out: q.out ?? '/tmp/studio.png' }));
    } else if (u.pathname === '/reload') {
      await ready();
      res.end('{"ok":true}');
    } else {
      res.statusCode = 404;
      res.end('{"error":"try /render, /compare or /reload"}');
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e?.message ?? e) }));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`studio on http://127.0.0.1:${PORT}`));

const stop = async () => {
  await browser.close().catch(() => {});
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
