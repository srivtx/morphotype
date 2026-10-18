// End-to-end smoke test: serves dist/, opens it in headless Chromium, applies
// every template and saves a screenshot of each. Fails on any page error.
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
try {
  await mkdir(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.stat', { timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '00-start.png') });

  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('button', { name: 'New from template…' }).click();
  const buttons = page.locator('.template');
  const count = await buttons.count();
  if (count === 0) throw new Error('No templates rendered');
  await page.keyboard.press('Escape');
  for (let i = 0; i < count; i++) {
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('button', { name: 'New from template…' }).click();
    const tpl = page.locator('.template').nth(i);
    const label = (await tpl.locator('strong').textContent()) ?? `t${i}`;
    const before = await page.locator('.stat').textContent();
    await tpl.click();
    await page.waitForFunction((prev) => document.querySelector('.stat')?.textContent !== prev, before, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(700);
    const file = `${String(i + 1).padStart(2, '0')}-${label.toLowerCase().replace(/\W+/g, '-')}.png`;
    await page.screenshot({ path: path.join(out, file) });
    console.log(`✓ ${label}`);
  }
  const layerErrors = await page.locator('.layer-warn').count();
  if (layerErrors) errors.push(`${layerErrors} layer(s) reported engine errors`);
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`screenshots in ${out}`);
