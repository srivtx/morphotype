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
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.stat', { timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, '00-start.png') });

  const state = () => page.evaluate(() => window.morphotype.store.get());
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
  await page.keyboard.press(`${mod}+n`);
  const names = (await page.locator('.template strong').allTextContents()).filter((n) => n !== 'Blank canvas');
  await page.keyboard.press('Escape');
  check(names.length >= 15, `${names.length} templates listed`);
  for (const [i, name] of names.entries()) {
    await openTemplate(name);
    const file = `${String(i + 1).padStart(2, '0')}-${name.toLowerCase().replace(/\W+/g, '-')}.png`;
    await page.screenshot({ path: path.join(out, file) });
    await page.mouse.click(vb.x + 6, vb.y + 6);
    const hide = await page.addStyleTag({ content: '.dock,.overlay,.stat,.edit-pill{display:none!important}' });
    await vp.screenshot({ path: path.join(out, `art-${file}`) });
    await hide.evaluate((el) => el.remove());
    const s = await state();
    const errs = (s.build?.layers ?? []).filter((l) => l.error);
    if (errs.length) errors.push(`${name}: ${errs.map((e) => e.error).join('; ')}`);
  }
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
  await settle(900);
  s = await state();
  const g = s.project.layers[0];
  check(g.type === 'group' && g.children.length === 3, `break apart "lab" gives 3 letters (${g.children?.length})`);
  await page.keyboard.press('Escape');
  await openTemplate('Neon script');
  await page.locator('.row', { hasText: 'Night' }).click();
  await page.keyboard.press('p');
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
  errors.push(`crashed: ${e.message.split('\n')[0]}`);
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
