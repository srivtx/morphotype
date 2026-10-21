// Frame cost of moving geometry: 1, 10 and 50 pen lines whose Wave phase
// ramps, against a running dev server, on the GPU (Metal on a Mac).
//
//   npx vite --port 1437 &   then   node scripts/perf-geo.mjs [url]
//
// Per frame: engine (worker build), round trip to the main thread, draw (new
// outlines in, fields rebuilt, composited, read back so the GPU has finished),
// then the live loop as the editor runs it while playing. Set CHROMIUM_PATH to
// use a specific browser binary.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:1437/?editor';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [process.platform === 'darwin' ? '--use-angle=metal' : '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
await page.goto(url);
await page.waitForFunction(() => window.morphotype?.store.get().ready && window.morphotype.renderer);
const gpu = await page.evaluate(() => { const gl = window.morphotype.renderer.gl; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e && gl.getParameter(e.UNMASKED_RENDERER_WEBGL); });
console.log('GPU:', gpu);
await page.evaluate(() => {
  window.__mk = async (n, animated) => {
    const m = window.morphotype; const mod = await import('/src/state/model.ts'); const gm = await import('/src/state/geoMotion.ts');
    const layers = [];
    for (let i = 0; i < n; i++) {
      const w = mod.newModifier('wave', { amplitude: 0.06, wavelength: 1.2, phase: 0 });
      const y = n === 1 ? 0 : -500 + (1000 * i) / (n - 1);
      const l = mod.lineLayer('M-0.8 0 C-0.4 -0.1 0.4 0.1 0.8 0', 900, n > 10 ? 6 : 12, { y, modifiers: [w], style: mod.style('flat', { fill: '#2563eb' }) });
      if (animated) l.animate = { [gm.modAnimKey(w.uid, 'phase')]: { to: 6.283, period: 2, phase: i / n, mode: 'ramp' } };
      layers.push(l);
    }
    const s = m.store.get();
    m.store.set({ project: { ...s.project, layers }, selection: [] });
    await new Promise((r) => setTimeout(r, 1500));
  };
});
const results = [];
for (const n of [1, 10, 50]) {
  // 1) Cost of one frame, step by step (clock held, synchronous GPU readback).
  const cost = await page.evaluate(async (n) => {
    const m = window.morphotype; const gm = await import('/src/state/geoMotion.ts');
    m.clock.pause({ duration: 6, loop: true });
    await window.__mk(n, true);
    const p = m.store.get().project; const r = m.renderer; const gl = r.gl; const px = new Uint8Array(4);
    const frames = 90; const sum = { engine: 0, roundTrip: 0, draw: 0, total: 0 }; const all = [];
    await m.liveGeometry.hold(async (show) => {
      for (let f = 0; f < frames; f++) {
        const t0 = performance.now();
        const out = await m.engine.buildExact(gm.movingDocAt(p, f / 30, 6));
        const t2 = performance.now();
        show(new Map(out.renders.map((x) => [x.id, x])));
        r.draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t4 = performance.now();
        sum.engine += out.ms; sum.roundTrip += t2 - t0; sum.draw += t4 - t2; sum.total += t4 - t0; all.push(t4 - t0);
      }
    });
    all.sort((a, b) => a - b);
    return { ...Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v / frames).toFixed(1)])), p95: +all[Math.floor(frames * 0.95)].toFixed(1) };
  }, n);
  // 2) The live loop as the editor runs it: playing for 4 s.
  const live = await page.evaluate(async () => {
    const m = window.morphotype; const L = m.liveGeometry.stats;
    m.clock.play({ duration: 6, loop: true });
    await new Promise((r) => setTimeout(r, 500));
    L.reset();
    let frames = 0, worst = 0, last = performance.now(), run = true;
    const loop = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; frames++; if (run) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    await new Promise((r) => setTimeout(r, 4000));
    run = false;
    return { geoFps: +(L.frames / 4).toFixed(1), dropped: L.dropped, rafFps: +(frames / 4).toFixed(1), worstFrame: +worst.toFixed(1) };
  });
  results.push({ n, ...cost, ...live });
}
// Static design: nothing should run.
const still = await page.evaluate(async () => {
  const m = window.morphotype; await window.__mk(50, false);
  m.clock.play({ duration: 6, loop: true });
  let builds = 0; const ob = m.engine.buildExact.bind(m.engine); m.engine.buildExact = (d) => (builds++, ob(d));
  m.liveGeometry.stats.reset();
  await new Promise((r) => setTimeout(r, 2000));
  m.engine.buildExact = ob;
  return { engineBuilds: builds, liveFrames: m.liveGeometry.stats.frames };
});
console.table(results);
console.log('50 still lines, 2 s playing:', still);
await browser.close();
