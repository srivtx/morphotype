// End-to-end test: serves dist/, drives the app in headless Chromium through
// templates, editing, styling, Type mode and exports. Fails on any page error
// or broken expectation, and saves screenshots along the way.
//
//   npm run build && npm run test:e2e [-- --out screenshots]
//
// Set CHROMIUM_PATH to use a specific browser binary.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outIdx = process.argv.indexOf('--out');
const out = path.resolve(outIdx > 0 ? process.argv[outIdx + 1] : path.join(root, 'test-results/e2e'));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.map': 'application/json' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const file = path.join(dist, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(dist) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const check = (ok, msg) => {
  if (ok) console.log(`✓ ${msg}`);
  else errors.push(`✗ ${msg}`);
};
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

try {
  await mkdir(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  const state = () => page.evaluate(() => window.morphotype.store.get());

  // ---- Home: new design, autosave, reopen ----
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.home', { timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '00-home.png') });
  check((await page.locator('.home-start').count()) === 1, 'Home opens at launch with new design and font');
  await page.locator('.home-page').getByRole('radio', { name: 'Clear' }).click();
  await page.locator('.home-sizes .chip', { hasText: 'Portrait' }).click();
  await page.waitForSelector('.stat', { timeout: 30_000 });
  let st0 = await state();
  check(st0.screen === 'editor' && st0.projectId && st0.project.canvas.height === 1350 && st0.project.layers.length === 0, 'a portrait design starts blank with its own id');
  check(st0.project.background.fill.kind === 'none', 'a design can start on a transparent page');
  await page.locator('.empty-start-page').getByRole('radio', { name: 'White' }).click();
  await page.waitForTimeout(300);
  st0 = await state();
  check(st0.project.background.fill.kind === 'solid' && st0.settings.newPage === 'white', 'the start panel switches the page back to white');
  await page.keyboard.press('o');
  await page.waitForTimeout(1500);
  await page.locator('.home-btn').click();
  await page.waitForSelector('.home-card', { timeout: 10_000 });
  check((await page.locator('.home-card').count()) === 1, 'the design saved itself and is listed on Home');
  await page.waitForSelector('.home-card img', { timeout: 10_000 }).catch(() => {});
  await page.screenshot({ path: path.join(out, '00-home-recent.png') });
  await page.locator('.home-card-open').first().click();
  await page.waitForSelector('.stat', { timeout: 10_000 });
  const st1 = await state();
  check(st1.projectId === st0.projectId && st1.project.layers.length === 1 && st1.past.length === 2, 'back from Home: the same design, undo history kept (page + shape)');
  // A reload must bring it back from the library.
  await page.reload();
  await page.waitForSelector('.home-card', { timeout: 30_000 });
  await page.locator('.home-card-open').first().click();
  await page.waitForSelector('.stat', { timeout: 10_000 });
  const st2 = await state();
  check(st2.projectId === st0.projectId && st2.project.layers.length === 1 && st2.past.length === 0, 'after a reload the design opens from the library');

  await page.goto(`http://127.0.0.1:${port}/?editor`);
  await page.waitForSelector('.stat', { timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, '00-start.png') });
  const layersOf = (s) => {
    const all = [];
    const walk = (ns) => ns.forEach((n) => (n.type === 'group' ? (all.push(n), walk(n.children)) : all.push(n)));
    walk(s.project.layers);
    return all;
  };
  const settle = (ms = 700) => page.waitForTimeout(ms);
  /** Poll until `fn(state)` is true (software GL frames can be slow). */
  const until = async (fn, timeout = 20_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (fn(await state())) return true;
      await page.waitForTimeout(150);
    }
    return false;
  };
  const vp = page.locator('.viewport');
  const vb = await vp.boundingBox();
  const openTemplate = async (name) => {
    await page.keyboard.press(`${mod}+n`);
    await page.locator('.templates').waitFor({ timeout: 10_000 });
    await page.locator('.template', { hasText: name }).first().click();
    await settle(900);
  };

  // ---- every template renders ----
  await page.evaluate(() => {
    window.morphotype.clock.pause({ duration: 6, loop: true });
    window.morphotype.clock.seek(5);
  });
  await page.keyboard.press(`${mod}+n`);
  const names = (await page.locator('.template strong').allTextContents()).filter((n) => n !== 'Blank canvas');
  await page.keyboard.press('Escape');
  check(names.length >= 15, `${names.length} templates listed`);
  // The dialog itself is exercised once; the rest render in parallel pages that
  // load each template straight into the store and wait for its build (CPU
  // rendering here is the slow part, so three pages share the cores).
  await openTemplate(names[0]);
  await page.screenshot({ path: path.join(out, `01-${names[0].toLowerCase().replace(/\W+/g, '-')}.png`) });
  const lanes = 3;
  await Promise.all(
    Array.from({ length: lanes }, async (_, lane) => {
      const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      p2.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      p2.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
      await p2.goto(`http://127.0.0.1:${port}/?editor`);
      await p2.waitForFunction(() => window.morphotype?.renderer, null, { timeout: 30_000 });
      // Hold motion still, after every entrance, so screenshots are stable and software GL isn't redrawing every frame.
      await p2.evaluate(() => {
        window.morphotype.clock.pause({ duration: 6, loop: true });
        window.morphotype.clock.seek(5);
      });
      for (let i = lane; i < names.length; i += lanes) {
        const name = names[i];
        const result = await p2.evaluate(async (name) => {
          const m = window.morphotype;
          const before = m.store.get().build;
          m.store.set({ project: m.templates.find((t) => t.name === name).make(), selection: [], dialog: null, screen: 'editor' });
          for (let k = 0; k < 1500 && m.store.get().build === before; k++) await new Promise((r) => setTimeout(r, 20));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return (m.store.get().build?.layers ?? []).filter((l) => l.error).map((l) => l.error);
        }, name);
        if (result.length) errors.push(`${name}: ${result.join('; ')}`);
        const file = `${String(i + 1).padStart(2, '0')}-${name.toLowerCase().replace(/\W+/g, '-')}.png`;
        await p2.locator('.viewport').screenshot({ path: path.join(out, `art-${file}`) });
      }
      await p2.close();
    }),
  );
  check(true, 'templates rendered');

  // ---- per-layer styles: styling the eyes must not restyle the body ----
  await openTemplate('Chat mascot');
  await page.locator('.row', { hasText: 'Eyes' }).click();
  await page.getByRole('tab', { name: 'Style' }).click();
  await page.getByPlaceholder(/Search looks/).fill('neon');
  await page.locator('.preset-card', { hasText: 'Neon pink' }).click();
  await settle();
  let s = await state();
  const eyes = layersOf(s).find((l) => l.content?.symbol?.kind === 'eyes');
  const bubble = layersOf(s).find((l) => l.content?.symbol?.kind === 'bubble');
  check(eyes.style.effect === 'neon' && bubble.style.effect === 'sticker', 'a preset applies only to the selected layer');
  await page.screenshot({ path: path.join(out, 'edit-01-styled-eyes.png') });

  // ---- select, move, resize on the canvas ----
  await page.getByRole('tab', { name: 'Design' }).click();
  await openTemplate('Glow glass');
  await page.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 2 - 40);
  s = await state();
  check(s.selection.length === 1, 'clicking a shape selects it');
  const before = layersOf(s)[0];
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2 - 40);
  await page.mouse.down();
  await page.mouse.move(vb.x + vb.width / 2 + 80, vb.y + vb.height / 2 - 40, { steps: 8 });
  await page.mouse.up();
  s = await state();
  check(layersOf(s)[0].x > before.x + 30, 'dragging moves the layer');
  const handle = await page.locator('.handle.edge').nth(1).boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 4);
  await page.mouse.down();
  await page.mouse.move(handle.x + 90, handle.y + 4, { steps: 6 });
  await page.mouse.up();
  s = await state();
  check(layersOf(s)[0].sx > 1.1, 'the side handle stretches the layer');
  await page.keyboard.press(`${mod}+z`);
  s = await state();
  check(Math.abs(layersOf(s)[0].sx - 1) < 1e-6, 'undo restores the stretch');

  // ---- add shapes, group, reorder by dragging in the layers panel ----
  await page.keyboard.press('o');
  await settle(300);
  await page.keyboard.press('r');
  await settle(300);
  s = await state();
  check(s.project.layers.length === 3, 'shortcuts add shapes');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+g`);
  await settle(300);
  s = await state();
  check(s.project.layers.length === 1 && s.project.layers[0].type === 'group', 'select all + group');
  await page.keyboard.press(`Shift+${mod}+g`);
  await settle(300);
  s = await state();
  check(s.project.layers.length === 3, 'ungroup');
  const rows = page.locator('.row');
  await rows.nth(0).click();
  await until((st) => st.selection.length === 1);
  const topId = (await state()).project.layers.at(-1).id;
  const from = await rows.nth(0).boundingBox();
  const to = await rows.nth(2).boundingBox();
  await page.mouse.move(from.x + 60, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, to.y + to.height - 3, { steps: 8 });
  await page.mouse.up();
  check(await until((st) => st.project.layers.length === 3 && st.project.layers[0].id === topId), 'dragging the top row to the bottom reorders layers');
  await page.screenshot({ path: path.join(out, 'edit-02-layers.png') });

  // ---- break apart and edit points ----
  await openTemplate('Glow glass');
  await page.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 2 - 40);
  await page.keyboard.press(`Shift+${mod}+b`);
  await until((st) => st.project.layers[0]?.type === 'group');
  s = await state();
  const g = s.project.layers[0];
  check(g.type === 'group' && g.children.length === 3, `break apart "lab" gives 3 letters (${g.children?.length})`);
  await page.keyboard.press('Escape');
  await openTemplate('Neon script');
  await page.locator('.row', { hasText: 'Night' }).click();
  await page.keyboard.press('Shift+p');
  await settle(900);
  check((await page.locator('.pe-node').count()) > 20, 'edit points shows the outline nodes');
  s = await state();
  const d0 = layersOf(s)[0].content.d;
  const node = await page.locator('.pe-node').nth(5).boundingBox();
  await page.mouse.move(node.x + 4, node.y + 4);
  await page.mouse.down();
  await page.mouse.move(node.x + 40, node.y - 30, { steps: 5 });
  await page.mouse.up();
  s = await state();
  check(layersOf(s)[0].content.d !== d0, 'dragging a point edits the path');
  await page.screenshot({ path: path.join(out, 'edit-03-points.png') });
  await page.keyboard.press('Escape');

  // ---- command palette and settings search ----
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('instagram story');
  await settle(200);
  await page.keyboard.press('Enter');
  check(await until((st) => st.project.canvas.width === 1080 && st.project.canvas.height === 1920 && !st.dialog), 'palette runs a canvas preset');
  await page.keyboard.press(`${mod}+,`);
  await page.getByPlaceholder('Search settings and shortcuts…').waitFor();
  await page.keyboard.type('nudge');
  let labels = 0;
  for (let i = 0; i < 40 && labels !== 2; i++) {
    await page.waitForTimeout(150);
    labels = await page.locator('.settings-section .setting-label').count();
  }
  check(labels === 2, `settings search filters to the nudge settings (${labels})`);
  await page.screenshot({ path: path.join(out, 'edit-04-settings.png') });
  await page.keyboard.press('Escape');
  check(await until((st) => !st.dialog), 'Escape closes the settings');

  // ---- exports ----
  const download = async (open, click) => {
    const wait = page.waitForEvent('download', { timeout: 60_000 });
    await open();
    await click();
    const d = await wait;
    const file = path.join(out, d.suggestedFilename());
    await d.saveAs(file);
    return readFile(file);
  };
  await openTemplate('Chat mascot');
  const exportMenu = () => page.getByRole('button', { name: 'Export', exact: true }).click();
  const png = await download(exportMenu, () => page.getByRole('menuitem', { name: /^PNG 1×/ }).click());
  check(png.subarray(1, 4).toString() === 'PNG' && png.length > 10_000, `PNG export (${(png.length / 1024).toFixed(0)} KB)`);
  const svg = (await download(exportMenu, () => page.getByRole('menuitem', { name: /^SVG/ }).click())).toString();
  check(svg.startsWith('<svg') && (svg.match(/<path /g) ?? []).length >= 2, 'SVG export has one path per object');
  const jpg = await download(exportMenu, () => page.getByRole('menuitem', { name: /^JPG/ }).click());
  check(jpg[0] === 0xff && jpg[1] === 0xd8, 'JPG export');

  // ---- typing on the canvas ----
  await openTemplate('Glow glass');
  const textCount = async () => layersOf(await state()).filter((l) => l.content?.type === 'text').length;
  const n0 = await textCount();
  await page.keyboard.press('t');
  await page.keyboard.press('Escape');
  check((await textCount()) === n0 && (await state()).tool === 'select', 'T then Esc leaves nothing behind');
  await page.keyboard.press('t');
  await page.mouse.click(vb.x + 140, vb.y + 140);
  await settle(400);
  await page.keyboard.type('Hi there', { delay: 20 });
  await settle(500);
  s = await state();
  const typed = layersOf(s).find((l) => l.content?.text === 'Hi there');
  check(!!typed && s.editing?.kind === 'text', 'T + click starts typing on the canvas');
  check((await page.locator('.text-caret, .text-sel').count()) > 0, 'a caret is drawn on the canvas');
  await page.screenshot({ path: path.join(out, 'text-01-typing.png') });
  await page.keyboard.press('Escape');
  await settle(300);
  check((await state()).editing === null, 'Esc finishes typing');
  const tb = await page.evaluate((id) => window.morphotype.store.get().build.layers.find((l) => l.id === id)?.bbox, typed.id);
  const r = await page.evaluate(() => {
    const c = document.querySelector('.viewport canvas').getBoundingClientRect();
    return { x: c.left, y: c.top };
  });
  const toScreen = await page.evaluate(([x, y]) => window.morphotype.renderer?.toScreen?.(x, y) ?? null, [(tb[0] + tb[2]) / 2, (tb[1] + tb[3]) / 2]);
  if (toScreen) {
    await page.mouse.dblclick(r.x + toScreen.x, r.y + toScreen.y);
    await settle(500);
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type('Yo');
    await settle(500);
    s = await state();
    check(layersOf(s).some((l) => l.id === typed.id && l.content.text === 'Yo'), 'double-click edits text in place');
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('t');
  await page.mouse.click(vb.x + 140, vb.y + vb.height - 160);
  await settle(300);
  await page.keyboard.press('Escape');
  await settle(300);
  check(!layersOf(await state()).some((l) => l.content?.type === 'text' && !l.content.text.trim()), 'an empty text is removed when typing ends');

  // ---- drawing, photos, construction, patterns, new modifiers ----
  await openTemplate('Blank canvas');
  await page.keyboard.press('b');
  check((await state()).tool === 'draw' && (await page.locator('.brush-bar').count()) === 1, 'B opens the draw tool and brush bar');
  const cx = vb.x + vb.width / 2;
  const cy = vb.y + vb.height / 2;
  await page.mouse.move(cx - 150, cy);
  await page.mouse.down();
  for (let k = 0; k <= 60; k++) await page.mouse.move(cx - 150 + k * 5, cy + 60 * Math.sin(k / 6));
  await page.mouse.up();
  check(await until((st) => layersOf(st).some((l) => l.content?.type === 'stroke' && l.content.points.length > 20) && st.build?.layers.some((o) => o.bbox && !o.error)), 'drawing a stroke makes an editable drawing layer');
  await page.keyboard.press('Escape');
  check((await state()).tool === 'select', 'Esc leaves the draw tool');
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#ff7a1a';
    g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#2b6bff';
    g.fillRect(40, 40, 120, 120);
    window.morphotype.store.set({ dialog: { kind: 'trace', image: g.getImageData(0, 0, 320, 200), name: 'Swatch', target: 'layer' } });
  });
  await page.getByRole('button', { name: 'Place photo' }).click();
  s = await state();
  const photo = layersOf(s).find((l) => l.style?.effect === 'photo');
  check(!!photo && typeof photo.style.params.image === 'string', 'an image can be placed as a photo inside a shape');
  await page.evaluate(() => {
    const m = window.morphotype;
    const p = structuredClone(m.store.get().project);
    p.background.pattern = { kind: 'grid', size: 80, weight: 3, color: '#000000', opacity: 0.5 };
    p.layers.push({
      ...structuredClone(p.layers.find((l) => l.content?.type !== 'stroke')),
      id: 'mods-test',
      content: { type: 'symbol', symbol: { kind: 'circle' }, size: 300 },
      style: { effect: 'flat', params: { fill: '#111111' } },
      modifiers: [
        { kind: 'slice', count: 8, gap: 0.05, angle: 0, ring: 0.3, hole: 0, jitter: 0, seed: 1, soften: 0.02, on: true, uid: 'm1' },
        { kind: 'echo', count: 2, spacing: 0.06, width: 0.02, on: true, uid: 'm2' },
        { kind: 'repeat', mode: 'radial', count: 3, radius: 0.4, sweep: 360, orient: 1, cols: 1, rows: 1, gapX: 0, gapY: 0, dx: 0, dy: 0, grow: 1, spin: 0, on: true, uid: 'm3' },
      ],
    });
    m.store.set({ project: p, selection: ['mods-test'] });
  });
  check(await until((st) => st.build?.layers.some((o) => o.id === 'mods-test' && o.bbox && !o.error)), 'slice, echo and repeat build together');
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('Draw construction');
  await page.keyboard.press('Enter');
  check(await until((st) => st.project.layers.some((n) => n.type === 'group' && n.name === 'Construction')), 'construction sheet draws guides and anchors');
  await settle(800);
  await page.screenshot({ path: path.join(out, 'new-01-draw-photo-construction.png') });

  // ---- pen, colour tracing and references ----
  await page.evaluate(() => window.morphotype.store.set({ selection: [] }));
  await page.keyboard.press('p');
  {
    const cx = vb.x + vb.width / 2;
    const cy = vb.y + vb.height / 2;
    await page.mouse.click(cx - 180, cy - 60);
    await page.mouse.move(cx, cy - 160);
    await page.mouse.down();
    await page.mouse.move(cx + 110, cy - 160, { steps: 4 });
    await page.mouse.up();
    await page.mouse.click(cx + 180, cy - 40);
    await page.keyboard.press('Enter');
    await page.mouse.click(cx - 120, cy + 80);
    await page.mouse.click(cx + 120, cy + 80);
    await page.mouse.click(cx, cy + 220);
    await page.mouse.click(cx - 120, cy + 80);
  }
  check(await until((st) => { const ls = layersOf(st); return ls.some((l) => l.content?.type === 'line' && !/Z/.test(l.content.d)) && ls.some((l) => l.name === 'Shape' && l.content?.type === 'path'); }), 'the pen draws open lines and closed shapes');
  await settle();
  s = await state();
  check(!(s.build?.layers ?? []).some((l) => l.error), 'pen layers build without errors');
  await page.keyboard.press('Escape');
  // An empty layer: what the pen draws next goes inside it.
  await page.keyboard.press(`Shift+${mod}+n`);
  check(await until((st) => st.project.layers.some((n) => n.type === 'group' && /^Layer \d+$/.test(n.name) && n.children.length === 0)), 'an empty layer can be added');
  await page.keyboard.press('p');
  {
    const cx = vb.x + vb.width / 2;
    const cy = vb.y + vb.height / 2;
    await page.mouse.click(cx - 200, cy + 260);
    await page.mouse.click(cx + 200, cy + 260);
    await page.keyboard.press('Enter');
  }
  check(await until((st) => st.project.layers.some((n) => n.type === 'group' && /^Layer \d+$/.test(n.name) && n.children.some((c) => c.content?.type === 'line'))), 'the pen draws into the selected empty layer');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.morphotype.store.set({ selection: [] }));
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 400;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 400, 400);
    x.fillStyle = '#0a5cff';
    x.fillRect(40, 40, 320, 320);
    x.fillStyle = '#ffc21a';
    x.beginPath();
    x.arc(200, 200, 90, 0, Math.PI * 2);
    x.fill();
    window.morphotype.store.set({ dialog: { kind: 'trace', image: x.getImageData(0, 0, 400, 400), name: 'Flat logo', target: 'layer' } });
  });
  await page.getByRole('radio', { name: 'Trace' }).click();
  const inks = page.locator('.trace-controls .slider').first().locator('input').last();
  await inks.fill('3');
  await inks.press('Enter');
  await settle(800);
  await page.getByRole('button', { name: 'Add as layer' }).click();
  check(await until((st) => st.project.layers.some((n) => n.type === 'group' && n.name === 'Flat logo vector' && n.children.length === 2)), 'colour trace makes one vector layer per ink');
  // Shading in a traced picture becomes a fitted gradient on its layer.
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 300, 300);
    const g = x.createLinearGradient(0, 40, 0, 260);
    g.addColorStop(0, '#ff3d00');
    g.addColorStop(1, '#ffc400');
    x.fillStyle = g;
    x.fillRect(40, 40, 220, 220);
    window.morphotype.store.set({ dialog: { kind: 'trace', image: x.getImageData(0, 0, 300, 300), name: 'Shaded', target: 'layer' } });
  });
  await page.getByRole('radio', { name: 'Trace' }).click();
  await inks.fill('2');
  await inks.press('Enter');
  await settle(800);
  await page.getByRole('button', { name: 'Add as layer' }).click();
  check(
    await until((st) => st.project.layers.some((n) => n.type === 'group' && n.name === 'Shaded vector' && n.children.some((l) => l.style?.params?.fill2))),
    'colour trace keeps shading as a fitted gradient',
  );
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const x = c.getContext('2d');
    x.fillStyle = '#ff0000';
    x.fillRect(0, 0, 200, 100);
    window.morphotype.store.set({ dialog: { kind: 'trace', image: x.getImageData(0, 0, 200, 100), name: 'Ref', target: 'layer' } });
  });
  await page.getByRole('radio', { name: 'Reference' }).click();
  await page.getByRole('button', { name: 'Trace over it' }).click();
  s = await state();
  check(s.project.layers[0]?.guide === true && s.project.layers[0].locked && s.tool === 'pen', 'a reference goes under everything, locked, with the pen on');
  await settle(900);
  const cmp = await page.evaluate(async () => {
    const r = await window.morphotype.tools.compareWithReference(0.3);
    return r && { match: r.match, diff: r.diff, heat: r.heat.startsWith('data:image/png') };
  });
  check(!!cmp && cmp.heat && cmp.match >= 0 && cmp.match <= 100, `compare with reference measures the match (${cmp?.match?.toFixed(1)}%, Δ ${cmp?.diff?.toFixed(1)})`);
  await page.keyboard.press('Escape');
  const images = (b) => (b.toString().match(/<image /g) ?? []).length;
  const withRef = images(await download(async () => {}, () => page.keyboard.press(`Shift+${mod}+e`)));
  await page.evaluate(() => {
    const st = window.morphotype.store;
    const p = structuredClone(st.get().project);
    p.layers[0].guide = false;
    st.set({ project: p });
  });
  await settle();
  const withoutFlag = images(await download(async () => {}, () => page.keyboard.press(`Shift+${mod}+e`)));
  check(withoutFlag === withRef + 1, `references are left out of exports (${withRef} vs ${withoutFlag})`);

  // ---- moving geometry: a pen line's Wave phase flows on the clock ----
  {
    const lineId = await page.evaluate(() => {
      const m = window.morphotype;
      const p = m.store.get().project;
      const uid = `mwave${Date.now().toString(36)}`;
      const line = {
        id: `lwave${Date.now().toString(36)}`, name: 'Flow', visible: true, op: 'add', x: 0, y: 0, rotation: 0, scale: 1,
        modifiers: [{ kind: 'wave', amplitude: 0.06, wavelength: 1.2, phase: 0, on: true, uid }],
        content: { type: 'line', d: 'M-0.8 0 C-0.4 -0.1 0.4 0.1 0.8 0', size: 900, width: 14, cap: 'round' },
        style: { effect: 'flat', params: { fill: '#2563eb' } },
      };
      m.clock.pause({ duration: 1, loop: true });
      m.store.set({ project: { ...p, layers: [line], timeline: { duration: 1, loop: true } }, selection: [line.id], tab: 'design', dialog: null, screen: 'editor', mode: 'design', past: [], future: [] });
      return line.id;
    });
    await settle(900);
    await page.locator('.mod .mod-head [data-tip="Modifier options"]').first().click();
    await page.getByRole('menuitem', { name: 'More controls' }).click();
    await page.getByRole('button', { name: 'Animate Phase' }).click();
    check(await until((st) => { const a = Object.entries(layersOf(st).find((l) => l.id === lineId)?.animate ?? {}); return a.length === 1 && /^mod:.+:phase$/.test(a[0][0]) && a[0][1].mode === 'ramp' && a[0][1].to > 6.2; }), 'a modifier slider has a keyframe: Wave phase ramps all the way round');
    const sampled = await page.evaluate(async (id) => {
      const m = window.morphotype;
      const before = m.store.get();
      m.clock.play({ duration: 1, loop: true });
      const outlines = new Set();
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 120));
        outlines.add(m.renderer.objs.find((o) => o.item.id === id)?.item.d);
      }
      const after = m.store.get();
      m.clock.pause({ duration: 1, loop: true });
      return { distinct: outlines.size, sameProject: before.project === after.project, history: after.past.length - before.past.length, frames: m.liveGeometry.stats.frames };
    }, lineId);
    check(sampled.distinct >= 3 && sampled.frames > 0, `the line's outline flows while the clock plays (${sampled.distinct} outlines in 12 samples)`);
    check(sampled.sameProject && sampled.history === 0, 'moving geometry stays out of the project and the undo history');
    await page.screenshot({ path: path.join(out, 'new-01b-flowing-line.png') });
    // Video: the line is rebuilt for each frame's time.
    await page.evaluate(() => {
      const m = window.morphotype;
      window.__geoBuilds = 0;
      const ob = m.engine.buildExact.bind(m.engine);
      m.engine.buildExact = (d) => (d.renders?.length === 1 && d.quality === 360 && window.__geoBuilds++, ob(d));
    });
    const video = await download(async () => {}, () => page.getByRole('button', { name: 'Export video' }).click());
    const geoBuilds = await page.evaluate(() => window.__geoBuilds);
    // (Software GL in the headless shell records an empty file; the frames themselves are checked on a GPU.)
    check(geoBuilds >= 31, `video export builds the moving line for every frame (${geoBuilds} builds, ${(video.length / 1024).toFixed(0)} KB file)`);
  }

  // ---- letter by letter: a typed word rises one letter at a time, on the canvas and in exported frames ----
  {
    await page.evaluate(() => {
      const m = window.morphotype;
      const p = m.store.get().project;
      m.clock.pause({ duration: 2, loop: true });
      // The Motion section opens with the selection (it remembers being closed).
      localStorage.setItem('mt.section.motion', '1');
      m.store.set({ project: { ...p, layers: [], background: { ...p.background, fill: { kind: 'solid', colors: ['#ffffff'], angle: 0 } }, timeline: { duration: 2, loop: true } }, selection: [], tab: 'design', dialog: null, screen: 'editor', mode: 'design', past: [], future: [] });
    });
    await settle(400);
    await page.keyboard.press('t');
    await page.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 2);
    await settle(300);
    await page.keyboard.type('Hello', { delay: 20 });
    await page.keyboard.press('Escape');
    await settle(400);
    const textId = await page.evaluate(() => {
      const st = window.morphotype.store;
      const p = structuredClone(st.get().project);
      const t = p.layers.find((l) => l.content?.text === 'Hello');
      t.style = { effect: 'flat', params: { fill: '#000000' } };
      t.motion = { loop: 'none', amount: 16, period: 2, phase: 0, enter: 'rise', distance: 150, delay: 0, transition: { type: 'easing', duration: 0.5, ease: [0.16, 1, 0.3, 1], bounce: 0.25, stiffness: 200, damping: 20, mass: 1 }, stagger: 0 };
      st.set({ project: p, selection: [t.id] });
      return t.id;
    });
    await settle(600);
    const together = await page.evaluate((id) => ({ objs: window.morphotype.renderer.objs.filter((o) => o.item.id.startsWith(id)).length, tagged: !!window.morphotype.store.get().build.renders.find((r) => r.id === id)?.glyphs }), textId);
    check(together.objs === 1 && !together.tagged, 'text that moves as one is drawn as one object, with no letter tags');
    await page.getByRole('radio', { name: 'One by one' }).click();
    check(await until((st) => layersOf(st).find((l) => l.id === textId)?.motion?.letters === 'letters'), 'Motion > Letters > One by one sets the text moving letter by letter');
    const letters = await page.evaluate(async (id) => {
      const m = window.morphotype;
      for (let k = 0; k < 200 && !m.renderer.objs.some((o) => o.item.id === `${id}#4`); k++) await new Promise((r) => setTimeout(r, 25));
      const objs = m.renderer.objs.filter((o) => o.item.id.startsWith(`${id}#`));
      return { n: objs.length, offsets: objs.map((o) => +o.item.motion[0].offset.toFixed(3)), first: objs[0]?.item.bbox, last: objs.at(-1)?.item.bbox, gap: m.store.get().project.layers.find((l) => l.id === id).motion.stagger };
    }, textId);
    check(letters.n === 5 && letters.offsets.every((o, i) => Math.abs(o - i * letters.gap) < 1e-6), `the five letters start ${letters.gap} s apart (${letters.offsets.join(', ')})`);
    // Ink inside each letter's resting box, early on and once all have arrived.
    const ink = await page.evaluate(({ first, last }) => {
      const m = window.morphotype;
      const { width: W, height: H } = m.store.get().project.canvas;
      const frames = m.renderer.exportFrames(1, false);
      const count = (img, b) => {
        let n = 0;
        for (let y = Math.floor(b[1] + H / 2); y < Math.ceil(b[3] + H / 2); y++)
          for (let x = Math.floor(b[0] + W / 2); x < Math.ceil(b[2] + W / 2); x++) {
            const i = (y * img.width + x) * 4;
            if (img.data[i] + img.data[i + 1] + img.data[i + 2] < 384) n++;
          }
        return n;
      };
      try {
        const early = frames.frame(0.12);
        const late = frames.frame(1.5);
        return { early: [count(early, first), count(early, last)], late: [count(late, first), count(late, last)] };
      } finally {
        frames.close();
      }
    }, letters);
    check(ink.early[0] > 30 && ink.early[1] === 0 && ink.late[0] > 30 && ink.late[1] > 30, `exported frames: early the first letter is rising and the last hasn't started (${ink.early}), later both are in place (${ink.late})`);
    await page.evaluate(() => window.morphotype.clock.seek(0.16));
    await settle(500);
    await page.screenshot({ path: path.join(out, 'new-01c-letter-by-letter.png') });
    await page.evaluate(() => window.morphotype.store.set({ selection: [] }));
  }

  // ---- a path of stops: Then moves on through every stop, on the canvas and in video ----
  {
    const ballId = await page.evaluate(() => {
      const m = window.morphotype;
      const p = m.templates.find((t) => t.name.startsWith('Learn 10')).make();
      const ball = p.layers.find((l) => l.name === 'Ball');
      m.clock.pause({ duration: 5, loop: true });
      m.clock.seek(0);
      m.store.set({ project: p, selection: [ball.id], tab: 'design', dialog: null, screen: 'editor', mode: 'design', past: [], future: [] });
      return ball.id;
    });
    await settle(1200);
    const ballOf = (st) => layersOf(st).find((l) => l.id === ballId);
    const ghosts = await page.locator('.move-ghost').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    check(ghosts.join('|') === 'Stop 1 of Ball|Stop 2 of Ball|Stop 3 of Ball', `every stop is a numbered dashed copy on the canvas (${ghosts.length})`);
    check((await page.locator('.move-path polyline').getAttribute('points')).trim().split(/\s+/).length === 4, 'a dashed path joins its place and the three stops');
    // Where it is on the canvas at a time on the clock (px from its place).
    const at = (t) =>
      page.evaluate(
        ({ id, t }) => {
          const m = window.morphotype;
          m.clock.seek(t);
          const o = m.renderer.objs.find((x) => x.item.id === id);
          const pl = m.renderer.placed(o);
          return [Math.round(pl.m[4]), Math.round(pl.m[5])];
        },
        { id: ballId, t },
      );
    const near = ([x, y], [X, Y]) => Math.abs(x - X) <= 3 && Math.abs(y - Y) <= 3;
    const visits = [await at(0.9), await at(2), await at(3.1), await at(4.9)];
    check(near(visits[0], [0, 0]) && near(visits[1], [280, -220]) && near(visits[2], [560, 0]) && near(visits[3], [840, -220]), `the ball plays its three stops in order on the canvas (${visits.map((v) => v.join(',')).join(' → ')})`);
    await page.evaluate(() => window.morphotype.clock.seek(2.45));
    await settle(400);
    await page.screenshot({ path: path.join(out, 'new-01c-path-of-stops.png') });
    // Drag the third copy with ⇧: it keeps to one axis.
    const g3 = await page.locator('[aria-label="Stop 3 of Ball"]').boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.move(g3.x + g3.width / 2, g3.y + g3.height / 2);
    await page.mouse.down();
    await page.mouse.move(g3.x + g3.width / 2 - 60, g3.y + g3.height / 2 + 8, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    let st = await state();
    const s3 = ballOf(st).motion.stops[1];
    check(s3.x < 800 && s3.y === -220, `dragging a stop's copy moves that stop, ⇧ on one axis (${s3.x}, ${s3.y})`);
    // The timeline: Then is one clip with a segment per stop.
    if (await page.getByRole('button', { name: 'Open the timeline' }).count()) await page.getByRole('button', { name: 'Open the timeline' }).click();
    await page.locator('.tl-step').first().waitFor({ timeout: 5000 });
    check((await page.locator('.tl-step').count()) === 3, 'Then is a sequence clip with a segment for each stop');
    const handle = await page.locator('.tl-step').nth(1).locator('.tl-clip-handle').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    st = await state();
    const retimed = ballOf(st).motion;
    check(retimed.stops[0].transition?.duration > 0.75 && retimed.leaveTransition.duration === 0.7, `dragging a boundary retimes that stop only (${retimed.stops[0].transition?.duration} s)`);
    await page.getByRole('button', { name: 'Stop 3', exact: true }).click();
    await page.locator('.tl-editor header b', { hasText: 'Stop 3' }).waitFor({ timeout: 5000 });
    check(true, 'clicking a segment edits that stop');
    await page.keyboard.press('Escape');
    await page.locator('.tl-editor').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    if (!(await page.locator('.add-stop').count())) await page.locator('.section-toggle:text-is("Motion")').click();
    await page.locator('.add-stop').click();
    st = await state();
    check(ballOf(st).motion.stops.length === 3 && (await page.locator('.tl-step').count()) === 4 && (await page.locator('.move-ghost').count()) === 4, '+ Add a stop adds one more Move to… after the last');
    await page.keyboard.press(`${mod}+z`);
    await page.keyboard.press(`${mod}+z`);
    await page.keyboard.press(`${mod}+z`);
    st = await state();
    check(ballOf(st).motion.stops.length === 2 && ballOf(st).motion.stops[1].x === 840 && !ballOf(st).motion.stops[0].transition, 'undo takes the stop, the retime and the drag back');
    // Video: each frame is drawn at its own time, so the ball passes every stop in order.
    await page.evaluate((id) => {
      const r = window.morphotype.renderer;
      window.__ballFrames = [];
      const placed = r.placed.bind(r);
      r.placed = (o) => {
        const pl = placed(o);
        if (r.exporting && o.item.id === id && pl) window.__ballFrames.push([r.pinned?.t, Math.round(pl.m[4]), Math.round(pl.m[5])]);
        return pl;
      };
    }, ballId);
    const t0 = Date.now();
    const video = await download(async () => {}, () => page.getByRole('button', { name: 'Export video' }).first().click());
    const frames = await page.evaluate(() => window.__ballFrames);
    const frameAt = (t) => frames.find((f) => Math.abs(f[0] - t) < 1 / 60);
    const inVideo = [0.9, 2, 3.1, 4.9].map((t) => frameAt(t)?.slice(1) ?? [NaN, NaN]);
    check(
      frames.length >= 150 && near(inVideo[0], [0, 0]) && near(inVideo[1], [280, -220]) && near(inVideo[2], [560, 0]) && near(inVideo[3], [840, -220]),
      `exported video plays the stops in order (${frames.length} frames: ${inVideo.map((v) => v.join(',')).join(' → ')}; ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(video.length / 1024).toFixed(0)} KB)`,
    );
  }

  // ---- depth, glass and the icon grid ----
  await openTemplate('Frosted 404');
  await page.locator('.row', { hasText: 'Caption' }).click();
  await page.getByRole('tab', { name: 'Design' }).click();
  await page.getByRole('button', { name: 'Add depth' }).click();
  await settle();
  s = await state();
  check(layersOf(s).find((l) => l.name === 'Caption')?.style.depth?.amount > 0, 'Depth adds 3D sides to any layer');
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('Add the app-icon grid');
  await page.keyboard.press('Enter');
  check(await until((st) => st.project.layers.some((n) => n.type === 'group' && n.name === 'Icon grid')), 'the app-icon grid can be added as layers');
  await settle(900);
  await page.screenshot({ path: path.join(out, 'new-02-depth-glass-grid.png') });
  // A new font starts from the selected text's typeface; start from the default.
  await page.evaluate(() => window.morphotype.store.set({ selection: [] }));

  // ---- Type mode ----
  await page.keyboard.press(`${mod}+2`);
  await page.waitForSelector('.type-start', { timeout: 15_000 });
  check(true, 'Type mode opens on the new-font screen');
  await page.locator('.ts-name input').fill('Archivo Black Copy');
  check(await page.locator('.type-start footer .btn.primary').isDisabled(), 'a name that reuses the base font name is refused');
  await page.locator('.ts-name input').fill('Testa Grotesk');
  await page.locator('.type-start footer .btn.primary').click();
  await page.waitForSelector('.tour-card', { timeout: 10_000 });
  await page.screenshot({ path: path.join(out, 'type-00-tour.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.glyph-cell svg path', { timeout: 30_000 });
  await settle(1500);
  check((await page.locator('.glyph-cell').count()) > 80, 'glyph grid lists the character set');
  await page.locator('.look', { hasText: 'Dot matrix' }).click();
  await settle(1800);
  await page.screenshot({ path: path.join(out, 'type-01-dots.png') });
  const onLooks = await page.locator('.look.on').allTextContents();
  check(onLooks.length === 1 && onLooks[0].includes('Dot matrix'), 'only the picked look is highlighted');
  // Glyph layers: a circle cut out of "O", then a look of its own.
  await page.locator('.glyph-cell', { hasText: 'O' }).first().click();
  await page.getByRole('tab', { name: /Glyph/ }).click();
  await page.locator('.section:has(.section-toggle:text-is("Layers")) .chip-btn').click();
  await page.locator('.popover .pick', { hasText: 'Star' }).first().click();
  await settle(400);
  await page.getByRole('radio', { name: 'Cut', exact: true }).click();
  await settle(1500);
  s = await state();
  const oEdit = s.project.type.glyphs.O;
  check(oEdit?.parts?.length === 1 && oEdit.parts[0].op === 'subtract' && s.glyphPart === oEdit.parts[0].id, 'a shape layer cuts into a glyph');
  await page.locator('.toggle-row', { hasText: "Use the font's look" }).locator('input, button, .toggle').first().click();
  await settle(1500);
  s = await state();
  check(s.project.type.glyphs.O.ownLook === true, 'a glyph can opt out of the font look');
  await page.screenshot({ path: path.join(out, 'type-01b-layers.png') });
  await page.getByRole('button', { name: 'Bake into points' }).click();
  check(await until((st) => !!st.project.type.glyphs.O?.d && !st.project.type.glyphs.O.parts?.length), 'baking turns the finished glyph into points');
  await page.locator('.glyph-cell', { hasText: 'B' }).first().click();
  await page.getByRole('button', { name: 'Edit points' }).first().click();
  await settle(900);
  check((await page.locator('.glyph-canvas .pe-node').count()) > 4, 'glyph point editor opens');
  await page.locator('.metric-label', { hasText: 'Cap height' }).click();
  check((await page.locator('.term-tip').count()) === 1, 'metric lines explain themselves');
  await page.locator('.add-chars input').fill('★');
  await page.keyboard.press('Enter');
  await settle(1000);
  s = await state();
  check(s.project.type.charset.includes('★') && s.glyph === '★', 'adding a character outside the base font');
  await page.getByRole('button', { name: 'Start from a block' }).first().click();
  await settle(600);
  await page.getByRole('tab', { name: /Use & export/ }).click();
  const woff = await download(async () => {}, () => page.getByRole('button', { name: '.woff (web)' }).click());
  check(woff.subarray(0, 4).toString() === 'wOFF', `WOFF export (${(woff.length / 1024).toFixed(0)} KB)`);
  const kit = await download(async () => {}, () => page.getByRole('button', { name: /Web font kit/ }).click());
  check(kit[0] === 0x50 && kit[1] === 0x4b && kit.includes(Buffer.from('@font-face')), 'web font kit zip with CSS');
  const ttf = await download(async () => {}, () => page.getByRole('button', { name: '.ttf' }).click());
  check(ttf.readUInt32BE(0) === 0x00010000, `TTF export (${(ttf.length / 1024).toFixed(0)} KB)`);
  await page.screenshot({ path: path.join(out, 'type-02-star.png') });
  await page.getByRole('button', { name: /Use in Design/ }).click();
  await page.waitForSelector('.use-font');
  await page.screenshot({ path: path.join(out, 'type-03-use.png') });
  await page.getByRole('button', { name: 'Use font' }).click();
  check(await until((st) => st.mode === 'design' && st.fonts.some((f) => f.name.startsWith('Testa Grotesk'))), 'Use in Design adds the font under its own name');
  s = await state();
  check(layersOf(s).some((l) => l.content?.font?.startsWith('custom-')), 'a text layer is set in the new font');
} catch (e) {
  errors.push(`crashed: ${e.message.split('\n').slice(0, 12).join(' / ')}`);
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (pages[0]) await pages[0].screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`screenshots in ${out}`);
