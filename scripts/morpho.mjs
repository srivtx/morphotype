// morpho: the app from the command line, for AI agents and scripts. Every
// command answers in short text or one PNG, so learning what exists, reading a
// design, editing it and judging it doesn't take source reading or a pile of
// screenshots.
//
//   npm run morpho -- make <spec.json> [-o f]     a whole design from one spec: built, placed, checked, one PNG
//   npm run morpho -- catalog [name|section]     what kits, materials, modifiers, shapes, motion… exist
//   npm run morpho -- describe <scene>            the design as a text tree (changed settings only)
//   npm run morpho -- scene <template> [-o f]     save a template as an editable .morpho file
//   npm run morpho -- set <file> <a=b>…           edit a .morpho file; prints what changed
//   npm run morpho -- new <file> / add / remove / duplicate / arrange   build a design from scratch
//   npm run morpho -- timing <scene>              when everything moves, as a text chart
//   npm run morpho -- layout <scene>              every layer's box and margins, and layout notes
//   npm run morpho -- video <scene> [-o f.mp4]    MP4, WebM, GIF or PNG frames (needs ffmpeg for video)
//   npm run morpho -- fit <file> <ref> <a.b>…     tune settings until the design matches a reference
//   npm run morpho -- render <scene> [opts]       PNG at rest, or a filmstrip with --at / --frames
//   npm run morpho -- vary <scene> --vary a=1,2   a grid of variations in one PNG
//   npm run morpho -- check <scene>               problems in words: off canvas, unseen, low contrast, loop jumps…
//   npm run morpho -- compare <scene> <ref.png>   scores against a reference, and reference | design | difference
//   npm run morpho -- serve                       keep a browser warm; the drawing commands then take a second
//
// <scene> is a template name (or a unique part of one) or a .morpho/.json file.
// Run `npm run morpho -- help` for every option.
import { createServer as createHttp } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MORPHO_PORT ?? 7801);
const OUT_DIR = path.join(root, 'test-results/morpho');

const HELP = `morpho <command> [args] [options]

  the workflow: make → check (--fix) → vary → video (docs/AGENT-TOOLS.md)

  make <spec.json> [-o f]  a whole design from one spec (canvas, kit, layers, layout, motion):
                           builds it, places it, fixes what's mechanical (--no-fix to skip),
                           checks it and draws one PNG. Re-run after editing the spec.
                           --kit name, --style poster|logo|abstract, --at 0,1,rest
  catalog [query]          index; a section (kits, materials, modifiers, shapes, motion, keyframes,
                           layers, presets, recipes, fonts, backgrounds, canvas, templates);
                           or any name (chrome, glitch, star, "Ice chrome", chrome-night)
  describe <scene>         every layer, top first, with the settings that differ from defaults
  scene <template> [-o f]  write a template as a .morpho file to edit (default: <slug>.morpho)
  set <file> <a=b>…        edit a .morpho file in place (--dry to only print the changes)
                           also Layer.preset="Ice chrome" and Layer.recipe=Glitch, layout
                           (Layer.place=top, .fitWidth=80, .margin=64, .centre=x, .contain=true),
                           --stack A,B (or --row A,B) --gap 40 --align centre --place centre,
                           --style poster|logo|abstract, and --check: what that did to the findings
  new <file>               a blank design: --canvas 1080x1350 | "Instagram post", --bg "#111" |
                           "#a,#b" | Midnight, --name, --duration 4, --kit name, --style poster|logo|abstract
  add <file> text "HI"     a layer: text "…" | shape star | line "<svg d>" | path "<svg d>", with
                           --name --at x,y --size --font --color --material chrome | --preset "Ice
                           chrome" --recipe Glitch --rotation --scale --width (lines) and
                           --above L | --below L | --into Group (default: on top); with a kit,
                           --role headline|accent|body; layout: --fit-width 80 --fit-height 30
                           --place "top third" --margin 64 --centre x|y|both
  add <file> modifier glitch --to L [--fields '{"amount":0.6}']   (or a recipe name)
  add <file> group A B [--name G] [--merge]
  add <file> font f.ttf    embed a font; prints the id for --font
  add <file> image p.png   a picture in a rectangle, or --to L to fill that layer with it
  remove <file> L…         · duplicate <file> L [--name --at]
  arrange <file> L top|bottom|up|down|above M|below M
  align <file> L… [--to canvas|M] [--edge centre]   by what's drawn; edges: left, right, centre,
                           top, bottom, middle (comma-separated for both axes)
  layout <scene>           every layer's box and margins, plus near-misses, crowding and hierarchy
  timing <scene>           when everything moves: bars on the clock and notes on rhythm
  motion <file> [L…]       motion over several layers at once (default: all, bottom up): --recipe
                           cascade|pop|type-on|slide-in|drop|drift|breathe, or --enter rise
                           --stagger 0.15 --feel Smooth --start 0.2 --duration 0.6 --letters
                           --loop float --spread 0.25 --leave auto|none|fade|rise…
  video <scene>            -o f.mp4 | f.webm | f.gif | dir/ (PNG frames); --fps (30, GIF 20),
                           --size (GIF default 480) or --scale
  fit <scene> <ref> L.k…   tune each setting until the design matches the reference picture;
                           writes the file (or --out), prints before → after
  render <scene>           PNG; one time draws the frame, several draw a captioned filmstrip
  vary <scene>             one PNG with a captioned cell per variation
  check <scene>            structural and visual problems, as text; --fix applies the mechanical
                           fixes (cut-off text, nearly centred, loop seams, moves the clock cuts
                           off) and prints the rest as commands; --style for this check only
  compare <scene> <image>  how close the design is to a reference (PNG/JPEG), with a difference image
  serve                    keep Vite and a browser running; drawing commands use it when up

assignments (set, --set, --vary, --variant):
  Layer.setting=value      by layer name or #id; bare keys find the material param, content field,
                           shape field or modifier (Title.wave.amplitude); or a full path
                           (Title.style.params.gloss). canvas.*, background.*, timeline.* too.
                           Values are JSON when they parse, else text; null removes.

options:
  --set a=b         apply before drawing (repeatable; files are left alone)
  --at 0,1.5,rest   times in seconds (rest = at rest, as a still export)
  --frames N        N times spread over the clock (a filmstrip)
  --scale S         output scale (render default 1; filmstrips and sheets fit --size)
  --size PX         long side of each cell (default 360)
  --cols N          columns in a sheet
  --vary a=1,2,3    one cell per value; several --vary multiply (values split on | when given)
  --variant 'a=1; b=2'  one cell per hand-made combination (repeatable)
  --layers N        check: how many layers get the visibility check (default 16)
  --transparent     no background
  --out FILE        where the PNG goes (default test-results/morpho/<scene>-<command>.png)
  --cpu             draw with SwiftShader (or set MORPHO_CPU=1): the same pixels on every machine, about 4× slower
                    (default: the GPU, falling back to SwiftShader when WebGL won't start there)
  --json            machine-readable output`;

// ---------- arguments ----------

function parse(argv) {
  const pos = [], opt = { set: [], vary: [], variant: [] };
  const flags = new Set(['cpu', 'json', 'dry', 'transparent', 'merge', 'force', 'fix', 'no-fix', 'check', 'letters']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') opt.out = argv[++i];
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      const val = flags.has(k) ? true : (v ?? argv[++i]);
      if (Array.isArray(opt[k])) opt[k].push(val);
      else opt[k] = val;
    } else pos.push(a);
  }
  return { cmd: pos[0], args: pos.slice(1), opt };
}

const slug = (s) => String(s).toLowerCase().replace(/\.(morpho|json)$/, '').replace(/^.*\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';

const times = (opt) => {
  if (opt.at) return String(opt.at).split(',').map((s) => (s.trim() === 'rest' ? null : Number(s)));
  if (opt.frames) return { frames: Number(opt.frames) };
  return [null];
};

/** --vary: the cartesian product of each list; --variant: hand-made combos. */
function variants(opt) {
  const out = opt.variant.map((v) => ({ label: v, edits: v.split(';').map((s) => s.trim()).filter(Boolean) }));
  if (opt.vary.length) {
    let combos = [{ label: [], edits: [] }];
    for (const v of opt.vary) {
      const eq = v.indexOf('=');
      if (eq < 0) throw new Error(`--vary "${v}" needs values: Layer.setting=a,b,c`);
      const lhs = v.slice(0, eq), rhs = v.slice(eq + 1);
      const vals = (rhs.includes('|') ? rhs.split('|') : rhs.split(',')).map((s) => s.trim());
      const key = lhs.replace(/^"[^"]*"\.?|^[^.]*\./, '') || lhs;
      combos = combos.flatMap((c) => vals.map((x) => ({ label: [...c.label, `${key} ${x}`], edits: [...c.edits, `${lhs}=${x}`] })));
    }
    out.push(...combos.map((c) => ({ label: c.label.join(' · '), edits: c.edits })));
  }
  if (out.length > 48) throw new Error(`${out.length} variations is too many for one sheet (48 at most)`);
  return out;
}

async function scene(arg) {
  if (!arg) throw new Error('Which design? Give a template name or a .morpho file (catalog templates lists them).');
  if (existsSync(arg) && !arg.endsWith('/')) return { project: JSON.parse(await readFile(arg, 'utf8')), name: arg };
  return { template: arg, name: arg };
}

// ---------- Node side: no browser ----------

let vite = null;
async function nodeAgent() {
  const { createServer } = await import('vite');
  vite = await createServer({ configFile: path.join(root, 'vite.config.ts'), root: path.join(root, 'ui'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
  return vite.ssrLoadModule('/src/agent/node.ts');
}

// ---------- browser side ----------

async function browserPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const { chromium } = await import('playwright');
  if (existsSync(chromium.executablePath())) return undefined;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  throw new Error('No browser found: run `npx playwright install chromium` or set CHROMIUM_PATH');
}

/** Vite's dev server and a page with the app, ready to take jobs. */
async function startApp(gpu) {
  if (!existsSync(path.join(root, 'ui/src/engine/pkg/morpho.js'))) throw new Error('The engine isn’t built: run `npm run wasm:dev` first');
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const server = await createServer({ configFile: path.join(root, 'vite.config.ts'), root: path.join(root, 'ui'), server: { port: 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  const args = gpu ? [process.platform === 'darwin' ? '--use-angle=metal' : '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ executablePath: await browserPath(), args: [...args, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  // Small: the live preview redraws on every load, and output doesn't depend on it.
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = async () => {
    await page.goto(`${url}?editor`);
    await page.waitForFunction(() => window.morphotype?.renderer && window.morphotype.store.get().ready, null, { timeout: gpu ? 30_000 : 90_000 });
  };
  try {
    await ready();
  } catch (e) {
    await browser.close().catch(() => {});
    await server.close();
    if (!gpu) throw e;
    process.stderr.write('morpho: WebGL didn’t start on the GPU; drawing with SwiftShader instead\n');
    return startApp(false);
  }
  return {
    errors,
    async run(job) {
      // Vite reloads the page when the source changes; wait for it to come back.
      if (!(await page.evaluate(() => !!window.morphotype?.renderer).catch(() => false))) await ready();
      errors.length = 0;
      try {
        try {
          return { ...(await page.evaluate(runInPage, job)), pageErrors: [...errors] };
        } catch (e) {
          // A source edit reloaded the page mid-job: once it's back, go again.
          if (!/context was destroyed|Target closed|navigation/i.test(String(e?.message))) throw e;
          await ready();
          return { ...(await page.evaluate(runInPage, job)), pageErrors: [...errors] };
        }
      } catch (e) {
        const msg = String(e?.message ?? e).split('\n')[0].replace(/^.*?Error: /, '');
        throw new Error(errors.length ? `${msg}\npage errors:\n${errors.join('\n')}` : msg);
      }
    },
    async close() {
      await browser.close().catch(() => {});
      await server.close();
    },
  };
}

/** Runs in the page (Playwright sends only this function's source): load the scene, apply edits, do the job. */
async function runInPage({ scene, set, op, opts }) {
  const a = await window.morphotype.agent();
  return a.quietly(async () => {
    if (op === 'make') return { changes: [], name: opts.spec?.name, ...(await a.make(opts.spec, opts)) };
    // Later batches of a video reuse the design the first one loaded.
    const key = JSON.stringify([scene, set]);
    let changes = [];
    if (!(op === 'frames' && opts.from > 0 && window.__morphoKey === key)) {
      window.__morphoKey = null;
      if (scene.template) await a.open(scene.template);
      else await a.load(scene.project);
      changes = set.length ? await a.edit(set) : [];
      window.__morphoKey = key;
    }
    const p = a.project();
    const clock = p.timeline?.duration ?? 6;
    if (opts.at?.frames) opts.at = Array.from({ length: opts.at.frames }, (_, i) => +((i * clock) / opts.at.frames).toFixed(3));
    const name = p.name;
    if (op === 'render') return { changes, name, ...(await a.render(opts)) };
    if (op === 'vary') return { changes, name, ...(await a.vary(opts.variants, { ...opts, at: opts.at?.[0] ?? null })) };
    if (op === 'check') return { changes, name, ...(await (opts.fix ? a.checkFix(opts) : a.checkFull(opts))) };
    if (op === 'checkdiff') return { changes, name, ...(await a.checkDiff(opts.before, opts.beforeProject, opts)) };
    if (op === 'place') return { changes, name, ...(await a.place(opts.ops)) };
    if (op === 'compare') return { changes, name, ...(await a.compare(opts.ref, { ...opts, at: opts.at?.[0] ?? null })) };
    if (op === 'align') return { changes, name, ...(await a.align(opts.targets, opts.to, opts.edges)) };
    if (op === 'layout') return { changes, name, text: await a.layout() };
    if (op === 'frames') return { changes, name, ...(await a.frameBatch(opts)) };
    if (op === 'font') return { changes, name, ...(await a.importFont(opts.data)) };
    if (op === 'image') return { changes, name, ...(await a.importImage(opts.data, opts.name, opts.to)) };
    if (op === 'fit') return { changes, name, ...(await a.fit(opts.ref, opts.targets)) };
    throw new Error(`Unknown job ${op}`);
  });
}

async function daemon() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/ping`, { signal: AbortSignal.timeout(400) });
    return r.ok;
  } catch {
    return false;
  }
}

async function drawJob(job, gpu) {
  if (await daemon()) {
    const r = await fetch(`http://127.0.0.1:${PORT}/job`, { method: 'POST', body: JSON.stringify(job) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    return body;
  }
  const app = await startApp(gpu);
  try {
    return await app.run(job);
  } finally {
    await app.close();
  }
}

async function serve(gpu) {
  const app = await startApp(gpu);
  let queue = Promise.resolve();
  createHttp(async (req, res) => {
    if (req.url === '/ping') return res.end('ok');
    if (req.url === '/stop') {
      res.end('ok');
      await app.close();
      process.exit(0);
    }
    let body = '';
    for await (const c of req) body += c;
    // One job at a time: they share the page.
    queue = queue.then(async () => {
      try {
        res.end(JSON.stringify(await app.run(JSON.parse(body))));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(e?.message ?? e).replace(/^.*?Error: /, '') }));
      }
    });
  }).listen(PORT, '127.0.0.1', () => console.log(`morpho serve on 127.0.0.1:${PORT}${gpu ? '' : ' (SwiftShader)'}: drawing commands now use this browser. Stop with Ctrl-C or \`morpho stop\`.`));
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// ---------- commands ----------

async function writePng(b64, opt, sceneName, cmd) {
  const out = path.resolve(opt.out ?? path.join(OUT_DIR, `${slug(sceneName)}-${cmd}.png`));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(b64, 'base64'));
  const rel = path.relative(process.cwd(), out);
  return rel && !rel.startsWith('..') ? rel : out;
}

const num = (v) => (v === undefined ? undefined : Number(v));

/** Read a .morpho file, change it, apply any --set, write it back (unless --dry) and say what changed. */
async function editFile(file, opt, change) {
  if (!file || !existsSync(file)) throw new Error(`Needs a .morpho file${file ? `; "${file}" doesn't exist` : ''} (start one with: morpho new <file>, or morpho scene <template>)`);
  const a = await nodeAgent();
  const before = a.migrate(JSON.parse(await readFile(file, 'utf8')));
  const r = await change(a, before);
  let { project } = r;
  const lines = [r.change];
  if (opt.set.length) {
    const e = a.applyEdits(project, opt.set);
    project = e.project;
    lines.push(...e.changes);
  }
  if (!opt.dry) await writeFile(file, JSON.stringify(project, null, 1));
  return lines.join('\n') + (opt.dry ? '\n(dry run: file unchanged)' : '');
}

/** Options shared by add and duplicate. */
const placeOpts = (opt) => ({ name: opt.name, at: opt.at, rotation: num(opt.rotation), scale: num(opt.scale), material: opt.material, preset: opt.preset, recipe: opt.recipe, above: opt.above, below: opt.below, into: opt.into, size: num(opt.size), font: opt.font, width: num(opt.width), color: opt.color });

/** A page job that changes a file: send the design, write back what comes back. */
async function pageEdit(file, opt, op, opts) {
  if (!file || !existsSync(file)) throw new Error(`Needs a .morpho file${file ? `; "${file}" doesn't exist` : ''}`);
  const r = await drawJob({ scene: { project: JSON.parse(await readFile(file, 'utf8')) }, set: opt.set, op, opts }, gpu(opt));
  const out = opt.out ?? file;
  if (!opt.dry) await writeFile(out, JSON.stringify(r.project, null, 1));
  return [...(r.changes ?? []).map((c) => `set ${c}`), r.change ?? r.text, out !== file ? `wrote ${out}` : ''].filter(Boolean).join('\n');
}

/** ffmpeg arguments for an output file, by its extension. */
function encoder(out, fps, w) {
  const ext = path.extname(out).toLowerCase();
  const input = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-'];
  if (ext === '.gif') return [...input, '-vf', `split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', out];
  if (ext === '.webm') return [...input, '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-pix_fmt', 'yuv420p', out];
  if (ext === '.mp4' || ext === '.mov') return [...input, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'medium', '-movflags', '+faststart', out];
  throw new Error(`video writes .mp4, .mov, .webm or .gif, or PNG frames into a folder ending in /; not "${out}"`);
}

async function video(s, opt) {
  const { spawn } = await import('node:child_process');
  const out = path.resolve(opt.out ?? path.join(OUT_DIR, `${slug(s.name)}.mp4`));
  const pngDir = out.endsWith('/') || out.endsWith(path.sep);
  const gif = out.toLowerCase().endsWith('.gif');
  const fps = Number(opt.fps ?? (gif ? 20 : 30));
  const size = opt.size ? Number(opt.size) : gif && !opt.scale ? 480 : undefined;
  await mkdir(pngDir ? out : path.dirname(out), { recursive: true });
  let ff = null, failed = null;
  if (!pngDir) {
    ff = spawn('ffmpeg', encoder(out, fps), { stdio: ['pipe', 'inherit', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    ff.on('error', (e) => (failed = e.code === 'ENOENT' ? new Error('video needs ffmpeg (brew install ffmpeg), or write PNG frames with -o frames/') : e));
    ff.on('exit', (code) => code && (failed ??= new Error(`ffmpeg failed: ${err.trim().split('\n').pop()}`)));
  }
  const job = (from) => drawJob({ scene: { template: s.template, project: s.project }, set: opt.set, op: 'frames', opts: { fps, from, count: 15, size, scale: opt.scale ? Number(opt.scale) : undefined } }, !(opt.cpu || process.env.MORPHO_CPU));
  let from = 0, total = 1, info = null;
  while (from < total) {
    const r = await job(from);
    if (failed) throw failed;
    info ??= r;
    total = r.total;
    for (const [i, f] of r.frames.entries()) {
      const bytes = Buffer.from(f, 'base64');
      if (pngDir) await writeFile(path.join(out, `frame-${String(from + i).padStart(4, '0')}.png`), bytes);
      else if (!ff.stdin.write(bytes)) await new Promise((ok) => ff.stdin.once('drain', ok));
    }
    from += r.frames.length;
    process.stderr.write(`\r${from}/${total} frames`);
    if (!r.frames.length) break;
  }
  process.stderr.write('\n');
  if (ff) {
    ff.stdin.end();
    await new Promise((ok) => ff.on('close', ok));
    if (failed) throw failed;
  }
  const shown = path.relative(process.cwd(), out);
  return `wrote ${shown && !shown.startsWith('..') ? shown : out}: ${total} frames at ${fps} fps, ${info.width}×${info.height}, ${info.duration}s${info.loop ? ' (loops seamlessly)' : ''}`;
}

const gpu = (opt) => !(opt.cpu || process.env.MORPHO_CPU);
const q = (f) => (/^[\w./-]+$/.test(f) ? f : JSON.stringify(f));

// ---------- check results kept by file content, so set --check only checks the new version ----------

const CHECKS = path.join(OUT_DIR, '.checks');
const checkKey = async (text, style) => (await import('node:crypto')).createHash('sha1').update(`${style ?? ''}\n${text}`).digest('hex').slice(0, 20);
async function keepFindings(text, style, findings) {
  if (!findings) return;
  await mkdir(CHECKS, { recursive: true });
  await writeFile(path.join(CHECKS, `${await checkKey(text, style)}.json`), JSON.stringify(findings));
}
async function keptFindings(text, style) {
  try {
    return JSON.parse(await readFile(path.join(CHECKS, `${await checkKey(text, style)}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** What the findings leave to do: fixable ones, ones with a command, or nothing. */
const left = (findings = []) => ({ fixable: findings.some((f) => f.level !== 'info' && f.fix), todo: findings.some((f) => f.level !== 'info' && !f.fix), problems: findings.filter((f) => f.level !== 'info').length });

/** The likely next command after a design is in good shape: a video when it moves, a still when it doesn't. */
const finish = (file, moving) => (moving ? `morpho video ${q(file)} -o ${slug(file)}.mp4 (or vary to compare options first)` : `morpho render ${q(file)} --out ${slug(file)}.png (or vary to compare options first)`);

/** Layout from add's options: one placement for the new layer. */
function addLayout(opt, id) {
  const o = { target: `#${id}` };
  if (opt['fit-width'] !== undefined) o.fitWidth = Number(opt['fit-width']);
  if (opt['fit-height'] !== undefined) o.fitHeight = Number(opt['fit-height']);
  if (opt.place) o.place = opt.place;
  if (opt.margin !== undefined) o.margin = /%$/.test(opt.margin) ? opt.margin : Number(opt.margin);
  if (opt.centre ?? opt.center) o.centre = opt.centre ?? opt.center;
  return Object.keys(o).length > 1 ? [o] : [];
}

/** Stacks and rows from set's options. */
function stackLayout(opt) {
  const list = (v) => String(v).split(',').map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const k of ['stack', 'row']) {
    if (!opt[k]) continue;
    out.push({ [k]: list(opt[k]), gap: opt.gap !== undefined ? Number(opt.gap) : undefined, align: opt.align, place: opt.place, margin: opt.margin === undefined ? undefined : /%$/.test(opt.margin) ? opt.margin : Number(opt.margin) });
  }
  return out;
}

/** A motion recipe from the command line. */
function moveSpec(opt, layers) {
  const n = (k) => (opt[k] === undefined ? undefined : Number(opt[k]));
  return { layers: layers.length ? layers : 'all', recipe: opt.recipe, enter: opt.enter, leave: opt.leave, loop: opt.loop, stagger: n('stagger'), start: n('start'), feel: opt.feel, duration: n('duration'), distance: n('distance'), letters: opt.letters ? (opt.words ? 'words' : 'letters') : undefined, letterStagger: n('letter-stagger'), period: n('period'), amount: n('amount'), spread: n('spread'), leaveAt: n('leave-at') };
}

async function main() {
  const { cmd, args, opt } = parse(process.argv.slice(2));
  const t0 = performance.now();
  const say = (s) => process.stdout.write(s.endsWith('\n') ? s : s + '\n');
  const next = (s) => say(`next: ${s}`);
  const done = () => process.stderr.write(`(${((performance.now() - t0) / 1000).toFixed(1)} s)\n`);
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      return say(HELP);
    case 'catalog': {
      const a = await nodeAgent();
      say(a.catalog(args.join(' ')));
      next(args.length ? 'put it in a spec and run morpho make spec.json' : 'morpho catalog kits, then write a spec and run morpho make spec.json');
      break;
    }
    case 'make': {
      const [file] = args;
      if (!file || !existsSync(file)) throw new Error(`make needs a spec file${file ? `; "${file}" doesn't exist` : ''} (JSON: { "canvas": "1080x1350", "kit": "chrome-night", "layers": [ … ] }; see docs/AGENT-TOOLS.md)`);
      let spec;
      try {
        spec = JSON.parse(await readFile(file, 'utf8'));
      } catch (e) {
        throw new Error(`${file} isn't valid JSON: ${e.message}`);
      }
      const out = opt.out ?? file.replace(/\.json$/i, '') + '.morpho';
      if (out === file) throw new Error('make writes a .morpho file next to the spec; give -o for another name');
      const at = opt.at || opt.frames ? times(opt) : undefined;
      const r = await drawJob({ scene: null, set: [], op: 'make', opts: { spec, kit: opt.kit, style: opt.style, fix: !opt['no-fix'], at, file: out } }, gpu(opt));
      const text = JSON.stringify(r.project, null, 1);
      await writeFile(out, text);
      await keepFindings(text, undefined, r.findings);
      say(`wrote ${out} from ${file}`);
      say(r.text);
      say(`wrote ${await writePng(r.png, { ...opt, out: undefined }, out, 'make')} (${r.width}×${r.height})`);
      for (const e of r.pageErrors ?? []) process.stderr.write(`page error: ${e}\n`);
      const l = left(r.findings);
      next(l.todo ? `run the commands under "still to do" (add --check to see what each changes), or edit ${file} and make again` : finish(out, r.moving));
      break;
    }
    case 'describe': {
      const a = await nodeAgent();
      const s = await scene(args[0]);
      let p = s.project ? a.migrate(s.project) : a.template(s.template);
      if (opt.set.length) p = a.applyEdits(p, opt.set).project;
      say(a.describe(p));
      next(s.template ? `morpho scene ${q(args[0])} -o ${slug(p.name)}.morpho, then set or check it` : `morpho set ${q(args[0])} Layer.setting=value --check`);
      break;
    }
    case 'timing': {
      const a = await nodeAgent();
      const s = await scene(args[0]);
      let p = s.project ? a.migrate(s.project) : a.template(s.template);
      if (opt.set.length) p = a.applyEdits(p, opt.set).project;
      say(a.timing(p));
      next(s.project ? `morpho motion ${q(args[0])} <layers…> --recipe cascade (or set 'L.motion.delay=…'), then check` : `morpho scene ${q(args[0])} to edit it`);
      break;
    }
    case 'new': {
      const [file] = args;
      if (!file) throw new Error('new needs a file name: morpho new poster.morpho --canvas 1080x1350 --bg "#111111" (or --kit chrome-night)');
      if (existsSync(file) && !opt.force) throw new Error(`${file} already exists (add --force to replace it)`);
      const a = await nodeAgent();
      let p = a.newDesign({ name: opt.name ?? slug(file).replace(/-/g, ' '), canvas: opt.canvas, background: opt.bg, duration: num(opt.duration), kit: opt.kit, style: opt.style });
      if (opt.set.length) p = a.applyEdits(p, opt.set).project;
      await writeFile(file, JSON.stringify(p, null, 1));
      say(`wrote ${file}: "${p.name}" ${p.canvas.width}×${p.canvas.height}${p.agent?.kit ? `, kit ${p.agent.kit}` : ''}${p.agent?.style ? `, ${p.agent.style}` : ''}, no layers yet`);
      next(`morpho add ${q(file)} text "HELLO" --fit-width 80 --place "top third" (one spec and morpho make is quicker for a whole design)`);
      break;
    }
    case 'add': {
      const [file, kind, ...rest] = args;
      const what = rest.join(' ');
      if (kind === 'font' || kind === 'image') {
        if (!what || !existsSync(what)) throw new Error(`add ${kind} needs a file${what ? `; "${what}" doesn't exist` : ''}`);
        const data = (await readFile(what)).toString('base64');
        say(await pageEdit(file, opt, kind, { data, name: path.basename(what), to: opt.to }));
        next(kind === 'font' ? `morpho add ${q(file)} text "HELLO" --font <the id above>` : `morpho check ${q(file)}`);
        break;
      }
      let id = null;
      say(
        await editFile(file, opt, (a, p) => {
          if (kind === 'modifier' || kind === 'mod') {
            if (!opt.to) throw new Error('add modifier needs --to <layer>');
            return a.addModifier(p, opt.to, what, opt.fields ? JSON.parse(opt.fields) : {});
          }
          if (kind === 'group') return a.addGroup(p, rest, { ...placeOpts(opt), merge: !!opt.merge });
          if (!kind || !what) throw new Error('add <file> text "HELLO" | shape star | line "<svg d>" | path "<svg d>" | modifier <kind> --to L | group A B | font f.ttf | image p.png');
          const r = a.addWithKit(p, kind, what, { ...placeOpts(opt), role: opt.role });
          id = r.id;
          return r;
        }),
      );
      const ops = id && !opt.dry ? addLayout(opt, id) : [];
      if (ops.length) say(await pageEdit(file, { ...opt, set: [] }, 'place', { ops }));
      next(`morpho check ${q(file)} (or add the next layer)`);
      break;
    }
    case 'motion': {
      const [file, ...layers] = args;
      const spec = moveSpec(opt, layers);
      if (!spec.recipe && !spec.enter && !spec.loop && !spec.leave) throw new Error('motion needs --recipe (cascade, pop, type-on, slide-in, drop, drift, breathe) or --enter / --loop / --leave');
      say(
        await editFile(file, opt, (a, p) => {
          const r = a.moveEdits(p, spec);
          return { project: r.project, change: `${r.summary} (${r.edits.length} settings)` };
        }),
      );
      next(`morpho timing ${q(file)} to see it on the clock, or morpho check ${q(file)}`);
      break;
    }
    case 'remove':
      say(await editFile(args[0], opt, (a, p) => a.removeLayers(p, args.slice(1))));
      next(`morpho check ${q(args[0])}`);
      break;
    case 'duplicate':
      say(await editFile(args[0], opt, (a, p) => a.duplicateLayer(p, args[1], placeOpts(opt))));
      next(`morpho set ${q(args[0])} '<copy>.x=…' --check`);
      break;
    case 'arrange':
      say(await editFile(args[0], opt, (a, p) => a.arrange(p, args[1], args[2], args[3])));
      next(`morpho check ${q(args[0])}`);
      break;
    case 'fit': {
      const [file, ref, ...targets] = args;
      if (!ref || !existsSync(ref)) throw new Error(`fit needs a reference picture after the design${ref ? `; "${ref}" doesn't exist` : ''}`);
      if (!targets.length) throw new Error('fit needs the settings to tune: Layer.x Layer.size Layer.gloss …');
      const s = await scene(file);
      if (s.template) {
        opt.out ??= `${slug(s.name)}.morpho`;
        const a = await nodeAgent();
        await writeFile(opt.out, JSON.stringify(a.template(s.template), null, 1));
        say(await pageEdit(opt.out, opt, 'fit', { ref: (await readFile(ref)).toString('base64'), targets }));
      } else say(await pageEdit(file, opt, 'fit', { ref: (await readFile(ref)).toString('base64'), targets }));
      next(`morpho compare ${q(opt.out ?? file)} ${q(ref)}`);
      break;
    }
    case 'align': {
      const [file, ...targets] = args;
      if (!targets.length) throw new Error('align <file> <layer>… [--to canvas|Layer] [--edge centre,middle]');
      say(await pageEdit(file, opt, 'align', { targets, to: opt.to ?? 'canvas', edges: String(opt.edge ?? 'centre').split(',') }));
      next(`morpho check ${q(file)}`);
      break;
    }
    case 'video':
      say(await video(await scene(args[0]), opt));
      next('done: share the file; to change it, edit the spec and run morpho make again');
      break;
    case 'scene': {
      const a = await nodeAgent();
      if (!args[0]) throw new Error('Which template? (catalog templates lists them)');
      const p = a.template(args[0]);
      const out = opt.out ?? `${slug(p.name)}.morpho`;
      await writeFile(out, JSON.stringify(p, null, 1));
      say(`wrote ${out}: "${p.name}", ${p.layers.length} top-level layers`);
      next(`morpho describe ${q(out)}, then morpho set ${q(out)} Layer.setting=value --check`);
      break;
    }
    case 'set': {
      const [file, ...assign] = args;
      if (!file || !existsSync(file)) throw new Error(`set needs a .morpho file first${file ? `; "${file}" doesn't exist` : ''} (make one with: morpho make spec.json, or morpho scene <template>)`);
      const stacks = stackLayout(opt);
      if (!assign.length && !stacks.length && !opt.style) throw new Error('set needs at least one Layer.setting=value (or --stack A,B, or --style)');
      const a = await nodeAgent();
      const before = await readFile(file, 'utf8');
      const { ops, rest } = a.layoutFromAssignments(assign);
      let { project, changes } = a.applyEdits(a.migrate(JSON.parse(before)), rest);
      if (opt.style) {
        if (!['poster', 'logo', 'abstract'].includes(opt.style)) throw new Error(`--style is poster, logo or abstract, not "${opt.style}"`);
        changes.push(`style: ${project.agent?.style ?? 'poster'} → ${opt.style}`);
        project = { ...project, agent: { ...project.agent, style: opt.style } };
      }
      if (opt.dry) {
        say([...changes, ...(ops.length || stacks.length ? ['(layout is resolved against the build, so a dry run leaves it out)'] : []), '(dry run: file unchanged)'].join('\n'));
        break;
      }
      await writeFile(file, JSON.stringify(project, null, 1));
      if (changes.length) say(changes.join('\n'));
      const layout = [...ops, ...stacks];
      if (layout.length) say(await pageEdit(file, { ...opt, set: [] }, 'place', { ops: layout }));
      if (opt.check) {
        const after = await readFile(file, 'utf8');
        const kept = await keptFindings(before, undefined);
        const r = await drawJob({ scene: { project: JSON.parse(after) }, set: [], op: 'checkdiff', opts: { before: kept, beforeProject: kept ? null : JSON.parse(before), layers: opt.layers ? Number(opt.layers) : undefined, file } }, gpu(opt));
        await keepFindings(after, undefined, r.findings);
        say(r.text);
        const l = left(r.findings);
        next(l.fixable ? `morpho check ${q(file)} --fix` : l.todo ? 'the commands under "to do", with --check' : finish(file, r.moving));
      } else next(`morpho check ${q(file)} (or add --check to set: only what changed in the findings)`);
      break;
    }
    case 'render':
    case 'vary':
    case 'check':
    case 'layout':
    case 'compare': {
      const s = await scene(args[0]);
      const opts = { scale: opt.scale ? Number(opt.scale) : undefined, size: opt.size ? Number(opt.size) : undefined, cols: opt.cols ? Number(opt.cols) : undefined, transparent: !!opt.transparent, layers: opt.layers ? Number(opt.layers) : undefined, at: times(opt) };
      if (cmd === 'compare') {
        if (!args[1] || !existsSync(args[1])) throw new Error(`compare needs a reference image after the scene${args[1] ? `; "${args[1]}" doesn't exist` : ''}`);
        opts.ref = (await readFile(args[1])).toString('base64');
      }
      if (cmd === 'vary') {
        opts.variants = variants(opt);
        if (!opts.variants.length) throw new Error('vary needs --vary Layer.setting=a,b,c or --variant "a=1; b=2"');
      }
      if (cmd === 'check') {
        if (opt.style && !['poster', 'logo', 'abstract'].includes(opt.style)) throw new Error(`--style is poster, logo or abstract, not "${opt.style}"`);
        Object.assign(opts, { fix: !!opt.fix, style: opt.style, file: s.project ? args[0] : `${slug(s.name)}.morpho` });
        if (opt.fix && s.template) opt.out ??= `${slug(s.name)}.morpho`;
      }
      const r = await drawJob({ scene: { template: s.template, project: s.project }, set: opt.set, op: cmd, opts }, gpu(opt));
      if (opt.json) {
        const { png, project, ...rest } = r;
        if (png) rest.out = await writePng(png, opt, s.name, cmd);
        say(JSON.stringify(rest, null, 1));
        break;
      }
      for (const c of r.changes ?? []) say(`set ${c}`);
      if (cmd === 'check' && r.project && opt.fix && !opt.dry) {
        // --fix writes the fixed design: over the file, or (for a template or --out) to a new one.
        const out = opt.out ?? args[0];
        const text = JSON.stringify(r.project, null, 1);
        if (r.fixed || out !== args[0]) await writeFile(out, text);
        await keepFindings(text, opt.style, r.findings);
        if (out !== args[0]) say(`wrote ${out}`);
      } else if (cmd === 'check' && s.project && !opt.set.length) await keepFindings(await readFile(args[0], 'utf8'), opt.style, r.findings);
      if (r.text) say(r.text);
      if (r.png) say(`wrote ${await writePng(r.png, opt, s.name, cmd === 'render' && (opts.at.frames || opts.at.length > 1) ? 'frames' : cmd)} (${r.width}×${r.height})`);
      for (const e of r.pageErrors ?? []) process.stderr.write(`page error: ${e}\n`);
      const f = q(cmd === 'check' && opt.fix ? (opt.out ?? args[0]) : args[0]);
      if (cmd === 'check') {
        const l = left(r.findings);
        next(l.fixable ? `morpho check ${f} --fix` : l.todo ? `run the commands above (set … --check shows what each changes)` : finish(opt.out ?? args[0], r.moving));
      } else if (cmd === 'render') next(`morpho check ${f}`);
      else if (cmd === 'vary') next(`morpho set ${s.project ? f : '<file>'} <the cell's settings> --check`);
      else if (cmd === 'layout') next(`morpho set ${s.project ? f : '<file>'} 'Layer.place=top' 'Layer.margin=64' (or --stack A,B --gap 40)`);
      else next(`morpho fit ${f} ${q(args[1])} Layer.x Layer.size …`);
      break;
    }
    case 'serve':
      return serve(gpu(opt));
    case 'stop':
      await fetch(`http://127.0.0.1:${PORT}/stop`).catch(() => {});
      return say('stopped');
    default:
      throw new Error(`Unknown command "${cmd}". Try: morpho help`);
  }
  done();
}

main()
  .catch((e) => {
    process.stderr.write(`morpho: ${String(e?.message ?? e).replace(/^.*?Error: /, '')}\n`);
    process.exitCode = 1;
  })
  .finally(() => vite?.close());
