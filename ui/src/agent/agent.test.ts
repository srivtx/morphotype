import { describe as group, expect, it } from 'vitest';
import { EFFECTS, PRESETS } from '../render/effects';
import { group as groupNode, lineLayer, MODIFIER_UI, mods, newModifier, style, SYMBOL_UI, symbolLayer, textLayer, type Group, type Project, type ShapeLayer } from '../state/model';
import { newMotion } from '../state/motion';
import { addGroup, addLayer, addModifier, arrange, blank, duplicateLayer, removeLayers } from './build';
import { boxTable, itemsOf, layoutFindings, lookFindings } from './layout';
import { timing } from './timing';
import { SHAPE_RECIPES } from '../state/recipes';
import { TEMPLATES } from '../state/templates';
import type { BuildResult } from '../engine/client';
import { catalog, findTemplate, SECTIONS } from './catalog';
import { contrast, diff, luminance, motionFindings, outside, presence, report, structural } from './check';
import { describe } from './describe';
import { applyEdit, applyEdits, EditError, parseAssignment } from './edit';

const project = (layers: Project['layers']): Project => ({ version: 2, name: 'Test', canvas: { width: 1000, height: 800 }, background: { fill: { kind: 'solid', colors: ['#000000'], angle: 180 }, grain: 0, tile: null }, layers, fonts: [] });

group('catalog', () => {
  it('lists every material, modifier and shape in the index', () => {
    const idx = catalog('', TEMPLATES);
    for (const e of EFFECTS) expect(idx).toContain(e.id);
    for (const m of Object.keys(MODIFIER_UI)) expect(idx).toContain(m);
    for (const s of Object.keys(SYMBOL_UI)) expect(idx).toContain(s);
    expect(idx).toContain(`templates (${TEMPLATES.length})`);
  });

  it('details every material, modifier, shape, preset and recipe by name', () => {
    for (const e of EFFECTS) {
      const t = catalog(e.id);
      expect(t).toContain(`material ${e.id}`);
      for (const p of e.params) expect(t, `${e.id}.${p.key}`).toContain(`  ${p.key}: `);
    }
    for (const m of Object.keys(MODIFIER_UI)) expect(catalog(m)).toContain(`modifier ${m}`);
    for (const s of Object.keys(SYMBOL_UI)) expect(catalog(s)).toContain(`shape ${s}`);
    for (const p of PRESETS) expect(catalog(p.name)).toContain(`preset ${p.name}`);
    for (const r of SHAPE_RECIPES) expect(catalog(r.name)).toContain(`recipe ${r.name}`);
  });

  it('answers every section and searches the rest', () => {
    for (const s of SECTIONS) expect(catalog(s, TEMPLATES).length, s).toBeGreaterThan(40);
    expect(catalog('puff')).toContain('material inflate');
    expect(catalog('zzzz')).toContain('Nothing matches');
  });

  it('documents every field the layer factories make', () => {
    const doc = catalog('layers');
    const keys = (o: object) => Object.keys(o).filter((k) => k !== 'type');
    for (const l of [textLayer('A'), symbolLayer('star'), lineLayer('M0 0 L1 0', 100)] as ShapeLayer[]) {
      for (const k of keys(l)) expect(doc, `layer.${k}`).toContain(k);
      for (const k of keys(l.content)) expect(doc, `${l.content.type}.${k}`).toContain(k);
    }
    for (const k of keys(groupNode([]))) expect(doc, `group.${k}`).toContain(k);
  });

  it('finds templates by exact name or a unique part', () => {
    const t = TEMPLATES[0];
    expect(findTemplate(TEMPLATES, t.name)).toBe(t);
    expect(findTemplate(TEMPLATES, t.name.toUpperCase())).toBe(t);
    expect(() => findTemplate(TEMPLATES, 'no such template at all')).toThrow(/No template/);
  });
});

group('describe', () => {
  it('shows each layer once, top first, with only changed settings', () => {
    const a = textLayer('Hello', 'archivo', { name: 'Title', style: style('chrome', { liquid: 1.2 }) });
    const b = symbolLayer('star', 300, { name: 'Star', x: 120 }, { points: 7 });
    const out = describe(project([b, a]));
    const lines = out.split('\n');
    expect(lines[2]).toContain('"Title"');
    expect(lines[3]).toContain('"Star"');
    expect(out).toContain('chrome {liquid 1.2}');
    expect(out).toContain('shape star 300px (points 7)');
    expect(out).toContain('at 120,0');
    expect(out).not.toContain('bevel');
  });

  it('describes every template without throwing', () => {
    for (const t of TEMPLATES) {
      const p = t.make();
      expect(describe(p), t.name).toContain(`"${p.name}"`);
    }
  });
});

group('edit', () => {
  const base = () => {
    const t = textLayer('Hi', 'archivo', { name: 'Big title', style: style('chrome'), modifiers: mods({ kind: 'wave', amplitude: 0.05, wavelength: 1, phase: 0 }) });
    const s = symbolLayer('star', 300, { name: 'Star' });
    return project([s, t]);
  };

  it('parses quoted names, paths and JSON values', () => {
    expect(parseAssignment('"Big title".x=-12')).toEqual({ target: 'Big title', path: ['x'], value: -12 });
    expect(parseAssignment('Star.fill=#ff0000').value).toBe('#ff0000');
    expect(parseAssignment('a.b.c={"x":1}')).toEqual({ target: 'a', path: ['b', 'c'], value: { x: 1 } });
  });

  it('finds the home of bare keys', () => {
    const { project: p, changes } = applyEdits(base(), ['Big title.liquid=1.1', 'Big title.text=Bye', 'Star.points=8', 'Big title.wave.amplitude=0.1', 'Star.x=40']);
    const [s, t] = p.layers as ShapeLayer[];
    expect(t.style.params.liquid).toBe(1.1);
    expect(t.content).toMatchObject({ text: 'Bye' });
    expect(s.content).toMatchObject({ symbol: { points: 8 } });
    expect(t.modifiers[0]).toMatchObject({ amplitude: 0.1 });
    expect(s.x).toBe(40);
    expect(changes[0]).toBe('"Big title" style.params.liquid: 0.6 → 1.1');
  });

  it('leaves the input alone', () => {
    const p = base();
    applyEdit(p, 'Star.x=99');
    expect((p.layers[0] as ShapeLayer).x).toBe(0);
  });

  it('refuses values out of range and unknown names, saying what works', () => {
    expect(() => applyEdit(base(), 'Big title.liquid=9')).toThrow('chrome.liquid is a number 0…1.5, got 9');
    expect(() => applyEdit(base(), 'Big title.c1=red')).toThrow(/colour like/);
    expect(() => applyEdit(base(), 'Star.points=2')).toThrow(/3…24/);
    expect(() => applyEdit(base(), 'Nope.x=1')).toThrow(/Layers: "Star", "Big title"/);
    expect(() => applyEdit(base(), 'Star.glos=1')).toThrow(/Try: .*points/);
    expect(() => applyEdit(base(), 'Star.wave.amplitude=1')).toThrow(/no wave modifier/);
    expect(() => applyEdit(base(), 'Star.x')).toThrow(EditError);
  });

  it('creates motion and routes keyframes to the style or the layer', () => {
    const anim = '{"to":1,"period":2,"phase":0,"mode":"swing"}';
    const m = (base().layers[1] as ShapeLayer).modifiers[0].uid;
    const { project: p } = applyEdits(base(), ['Big title.motion.loop="float"', `Big title.animate.speed=${anim}`, `Big title.animate.mod:${m}:amplitude=${anim}`]);
    const t = p.layers[1] as ShapeLayer;
    expect(t.motion).toMatchObject({ loop: 'float', period: 2 });
    expect(t.style.animate?.speed).toMatchObject({ to: 1 });
    expect(t.animate?.[`mod:${m}:amplitude`]).toMatchObject({ mode: 'swing' });
  });

  it('keeps shared settings when the material changes', () => {
    const { project: p } = applyEdits(base(), ['Big title.bevel=80', 'Big title.effect=inflate']);
    const t = p.layers[1] as ShapeLayer;
    expect(t.style.effect).toBe('inflate');
    expect(t.style.params.bevel).toBe(80);
    expect(t.style.params.c1).toBeUndefined();
  });

  it('edits the canvas, background and clock, and removes with null', () => {
    const { project: p } = applyEdits(base(), ['canvas.width=1080', 'background.grain=0.3', 'timeline.duration=4', 'Star.name=null']);
    expect(p.canvas.width).toBe(1080);
    expect(p.background.grain).toBe(0.3);
    expect(p.timeline).toEqual({ duration: 4, loop: true });
    expect(p.layers[0].name).toBeUndefined();
  });
});

group('check', () => {
  const build = (layers: { id: string; bbox: [number, number, number, number] | null; error?: string }[]): BuildResult => ({ renders: [], bbox: null, points: 0, ms: 0, layers: layers.map((l) => ({ id: l.id, bbox: l.bbox, error: l.error ?? null, d: null, local: null, frames: [] })) });

  it('measures how much of a box is off the artboard', () => {
    expect(outside([-50, -50, 50, 50], 1000, 800).share).toBe(0);
    expect(outside([400, 0, 600, 100], 1000, 800)).toEqual({ share: 0.5, sides: ['right'] });
    expect(outside([900, 0, 1000, 10], 1000, 800).share).toBe(1);
  });

  it('reports engine errors, layers off the canvas, bad values and dead keyframes', () => {
    const a = textLayer('A', 'archivo', { id: 'a', name: 'Off' });
    const b = textLayer('B', 'archivo', { id: 'b', style: style('chrome', { liquid: 4, c1: 'blue' }) });
    const c = symbolLayer('star', 100, { id: 'c', animate: { 'mod:gone:amount': { to: 1, period: 1, phase: 0, mode: 'swing' } } });
    const d = textLayer('D', 'archivo', { id: 'd' });
    const g = groupNode([textLayer('hidden', 'archivo', { id: 'h', visible: false })], { id: 'g' });
    const f = structural(project([a, b, c, d, g]), build([{ id: 'a', bbox: [900, 0, 1000, 40] }, { id: 'b', bbox: [-10, -10, 10, 10] }, { id: 'c', bbox: [0, 0, 600, 10] }, { id: 'd', bbox: null, error: 'bad font' }, { id: 'h', bbox: [5000, 0, 5001, 1] }]));
    const text = f.map((x) => `${x.level} ${x.text}`).join('\n');
    expect(text).toContain('error "Off" #a: entirely outside the canvas');
    expect(text).toContain('warn #b: chrome.liquid = 4 is outside 0…1.5');
    expect(text).toContain('error #b: chrome.c1 = "blue" is not a colour');
    expect(text).toContain('warn #c: keyframe "mod:gone:amount" points at nothing');
    expect(text).toContain('off the right edge');
    expect(text).toContain("error #d: the engine couldn't build it: bad font");
    expect(text).not.toContain('#h');
  });

  it('finds pops and loop seams in the motion, not fast smooth moves', () => {
    const smooth = Array.from({ length: 10 }, (_, i) => ({ t: i, a: 1, b: 1 }));
    expect(motionFindings(smooth, { a: 1, b: 1, c: 1 }, true)).toEqual([{ level: 'info', text: 'the loop joins smoothly' }]);
    expect(motionFindings(smooth, { a: 1, b: 12, c: 1 }, true)[0].text).toMatch(/loop jumps where it starts over/);
    // An entrance that replays: still before the restart, moving fast after it.
    expect(motionFindings(smooth, { a: 0, b: 20, c: 25 }, true)[0].text).toMatch(/loop jumps/);
    expect(motionFindings([...smooth, { t: 4.5, a: 0.2, b: 12 }], null, true)[0].text).toMatch(/pop at 4.5s/);
    expect(motionFindings([{ t: 0.2, a: 30, b: 26 }, ...smooth], null, true)).toEqual([]);
    expect(motionFindings(smooth.map((s) => ({ ...s, a: 0, b: 0 })), { a: 0, b: 0, c: 0 }, true)[0].text).toMatch(/nothing visibly changes/);
  });

  it('measures presence and contrast from pixels', () => {
    const px = (rgb: number[], n = 4) => ({ data: new Uint8ClampedArray(Array.from({ length: n }, () => [...rgb, 255]).flat()), width: n, height: 1 });
    expect(diff(px([0, 0, 0]), px([30, 30, 30]))).toBe(30);
    expect(contrast(luminance(255, 255, 255), luminance(0, 0, 0))).toBeCloseTo(21);
    expect(presence(px([255, 255, 255]), px([0, 0, 0]))).toEqual({ px: 4, contrast: 21, behind: 0 });
    expect(presence(px([10, 10, 10]), px([10, 10, 10])).px).toBe(0);
  });

  it('summarises findings, problems first', () => {
    const r = report('X', [{ level: 'info', text: 'i' }, { level: 'warn', text: 'w' }, { level: 'error', text: 'e' }]);
    expect(r).toBe('X: 1 problem, 1 warning\n✗ e\n! w\n· i');
  });
});

it('uses modifier entries shaped like the catalog says', () => {
  expect(newModifier('glitch')).toMatchObject({ kind: 'glitch', on: true });
  expect(catalog('glitch')).toContain("{ kind: 'glitch', …fields, on: true, uid: 'm1' }");
});

group('build', () => {
  const ids = (p: Project) => p.layers.map((n) => n.name);

  it('starts blank at a size and background', () => {
    const p = blank({ name: 'Gig', canvas: '1080x1350', background: '#111111,#222222', duration: 4 });
    expect(p).toMatchObject({ name: 'Gig', canvas: { width: 1080, height: 1350 }, layers: [], timeline: { duration: 4, loop: true } });
    expect(p.background.fill).toMatchObject({ kind: 'linear', colors: ['#111111', '#222222'] });
    expect(blank({ canvas: 'Instagram post' }).canvas.width).toBeGreaterThan(0);
    expect(() => blank({ canvas: 'Nowhere' })).toThrow(/WxH or one of/);
    expect(() => blank({ background: 'Plaid' })).toThrow(/No background/);
  });

  it('adds text, shapes and lines with unique names, looks and places', () => {
    let p = blank();
    p = addLayer(p, 'text', 'HELLO', { size: 200, preset: 'Ice chrome', at: '10,-20' }).project;
    p = addLayer(p, 'shape', 'star', { color: '#ff0000' }).project;
    p = addLayer(p, 'shape', 'Star', { material: 'inflate', recipe: 'Wavy', below: 'HELLO' }).project;
    p = addLayer(p, 'line', 'M-0.5 0 L0.5 0', { width: 20 }).project;
    expect(ids(p)).toEqual(['Star 2', 'HELLO', 'Star', 'Line']);
    const [s2, t, s] = p.layers as ShapeLayer[];
    expect(t).toMatchObject({ x: 10, y: -20, style: { effect: 'chrome' }, content: { size: 200 } });
    expect(s.style).toMatchObject({ effect: 'flat', params: { fill: '#ff0000' } });
    expect(s2.style.effect).toBe('inflate');
    expect(s2.modifiers.map((m) => m.kind)).toEqual(['wave']);
    expect(() => addLayer(p, 'text', 'x', { font: 'comic' })).toThrow(/No font "comic". Bundled: archivo/);
    expect(() => addLayer(p, 'shape', 'hexagonz')).toThrow(/Shapes: circle/);
    expect(() => addLayer(p, 'line', 'hello')).toThrow(/isn't SVG path data/);
  });

  it('adds modifiers and recipes, checking fields', () => {
    const p = addLayer(blank(), 'text', 'HI').project;
    const a = addModifier(p, 'HI', 'glitch', { amount: 0.8 }).project;
    expect((a.layers[0] as ShapeLayer).modifiers[0]).toMatchObject({ kind: 'glitch', amount: 0.8, size: 0.05, on: true });
    expect(addModifier(p, 'HI', 'Melting').change).toMatch(/recipe Melting/);
    expect(() => addModifier(p, 'HI', 'glitch', { nope: 1 })).toThrow(/glitch has no nope/);
    expect(() => addModifier(p, 'HI', 'zap')).toThrow(/No modifier "zap"/);
  });

  it('groups, duplicates, restacks and removes', () => {
    let p = blank();
    for (const t of ['A', 'B', 'C']) p = addLayer(p, 'text', t).project;
    p = addModifier(p, 'B', 'wave').project;
    const uid = (p.layers[1] as ShapeLayer).modifiers[0].uid;
    p = applyEdit(p, `B.animate.mod:${uid}:phase={"to":1,"period":2,"phase":0,"mode":"ramp"}`).project;
    p = duplicateLayer(p, 'B', { at: '50,0' }).project;
    expect(ids(p)).toEqual(['A', 'B', 'B 2', 'C']);
    const [b, b2] = [p.layers[1], p.layers[2]] as ShapeLayer[];
    expect(b2.id).not.toBe(b.id);
    expect(b2.modifiers[0].uid).not.toBe(uid);
    expect(Object.keys(b2.animate!)).toEqual([`mod:${b2.modifiers[0].uid}:phase`]);
    expect(b2.x).toBe(50);
    p = arrange(p, 'A', 'top').project;
    expect(ids(p)).toEqual(['B', 'B 2', 'C', 'A']);
    p = arrange(p, 'A', 'below', 'B').project;
    expect(ids(p)).toEqual(['A', 'B', 'B 2', 'C']);
    p = addGroup(p, ['B', 'C'], { name: 'Pair' }).project;
    expect(ids(p)).toEqual(['A', 'B 2', 'Pair']);
    expect((p.layers[2] as Group).children.map((n) => n.name)).toEqual(['B', 'C']);
    p = addLayer(p, 'shape', 'heart', { into: 'Pair' }).project;
    expect((p.layers[2] as Group).children.map((n) => n.name)).toEqual(['B', 'C', 'Heart']);
    p = removeLayers(p, ['A', 'Heart']).project;
    expect(ids(p)).toEqual(['B 2', 'Pair']);
    expect(() => arrange(p, 'Pair', 'sideways')).toThrow(/top, bottom, up, down/);
  });

  it('applies presets and recipes by assignment, and gives each loop its own amount', () => {
    let p = addLayer(blank(), 'text', 'HI').project;
    p = applyEdits(p, ['HI.preset="Molten"', 'HI.recipe=Heavy', 'HI.motion.loop="spin"']).project;
    const t = p.layers[0] as ShapeLayer;
    expect(t.style).toMatchObject({ effect: 'chrome', params: { c3: '#ff6a00' } });
    expect(t.modifiers.map((m) => m.kind)).toEqual(['weight']);
    expect(t.motion).toMatchObject({ loop: 'spin', amount: 1 });
    expect(applyEdits(p, ['HI.motion.loop="sway"', 'HI.motion.amount=20']).project.layers[0]).toMatchObject({ motion: { amount: 20 } });
    expect(() => applyEdit(p, 'HI.preset="Nope"')).toThrow(/No preset/);
  });
});

group('layout', () => {
  const W = 1000, H = 1000;
  const p = (layers: Project['layers']): Project => ({ ...project(layers), canvas: { width: W, height: H } });
  const build = (boxes: Record<string, [number, number, number, number]>): BuildResult => ({ renders: [], bbox: null, points: 0, ms: 0, layers: Object.entries(boxes).map(([id, bbox]) => ({ id, bbox, error: null, d: null, local: null, frames: [] })) });

  it('finds near-miss edges, nearly-centred things and crowded edges', () => {
    const q = p([textLayer('Headline', 'archivo', { id: 'a', name: 'A' }), symbolLayer('star', 100, { id: 'b', name: 'B' }), symbolLayer('circle', 100, { id: 'c', name: 'C' })]);
    const items = itemsOf(q, build({ a: [-300, -200, 300, -100], b: [-305, 0, -205, 100], c: [380, 350, 490, 460] }));
    const f = layoutFindings(q, items).map((x) => x.text).join('\n');
    expect(f).toContain('"A" and "B": lefts 5px apart, nearly lined up');
    expect(f).toContain('"C": only 10px from the right edge');
    expect(f).not.toContain('"A": ');
  });

  it('ignores differences nobody can see', () => {
    const q = p([textLayer('One', 'archivo', { id: 'a' }), textLayer('Two', 'archivo', { id: 'b' })]);
    const f = layoutFindings(q, itemsOf(q, build({ a: [-100, -50, 100, 0], b: [-101, 50, 99, 90] })));
    expect(f.filter((x) => /nearly/.test(x.text))).toEqual([]);
  });

  it('notes a missing lead among the biggest texts', () => {
    const q = p([textLayer('Big words', 'archivo', { id: 'a' }, { size: 200 }), textLayer('Also big', 'archivo', { id: 'b' }, { size: 190 }), textLayer('K', 'archivo', { id: 'k' }, { size: 600 })]);
    const boxes = build({ a: [-300, -300, 300, -100], b: [-300, 0, 300, 180], k: [-100, 200, 100, 480] });
    expect(layoutFindings(q, itemsOf(q, boxes)).some((x) => /no clear lead/.test(x.text))).toBe(false);
    const r = p(q.layers.slice(0, 2));
    expect(layoutFindings(r, itemsOf(r, boxes)).find((x) => /no clear lead/.test(x.text))?.text).toContain('"Big words" (200px) and "Also big" (190px)');
  });

  it('tables every box with its margins', () => {
    const q = p([symbolLayer('star', 100, { id: 'b', name: 'B' })]);
    expect(boxTable(q, itemsOf(q, build({ b: [-500, -500, -400, -400] })))).toContain('margins L 0 R 900 T 0 B 900');
  });

  it('reads balance and palette from pixels', () => {
    const w = 10, h = 10;
    const img = (f: (x: number, y: number) => number[]) => ({ data: new Uint8ClampedArray(Array.from({ length: w * h }, (_, i) => [...f(i % w, Math.floor(i / w)), 255]).flat()), width: w, height: h });
    const bare = img(() => [0, 0, 0]);
    const left = lookFindings(img((x) => (x < 3 ? [255, 0, 0] : [0, 0, 0])), bare).map((f) => f.text);
    expect(left[0]).toMatch(/sits left/);
    expect(left[1]).toBe('palette: 1 main hue (red), mostly neutrals');
    const rainbow = lookFindings(img((x) => [[255, 0, 0], [255, 150, 0], [255, 255, 0], [0, 200, 0], [0, 200, 255], [0, 0, 255], [160, 0, 255], [255, 0, 160], [255, 0, 0], [0, 0, 255]][x]), bare);
    expect(rainbow[1]).toMatchObject({ level: 'warn' });
    expect(lookFindings(img(() => [200, 200, 200]), bare)[0].text).toBe('visual weight: balanced around the centre');
  });
});

group('timing', () => {
  it('charts every move and notes rhythm', () => {
    const stars = [0, 1, 2].map((i) => symbolLayer('star', 100, { name: `S${i}`, motion: { ...newMotion({ enter: 'rise' }) } }));
    const q: Project = { ...project(stars), timeline: { duration: 6, loop: true } };
    const t = timing(q);
    expect(t).toContain('in rise');
    expect(t).toContain('3 entrances start together at 0s');
    expect(t).toMatch(/nothing moves from 0\.\d+s to 6s \(then it loops\)/);
    expect(timing(project([textLayer('Still')]))).toContain('nothing moves');
  });

  it('flags moves the clock cuts off', () => {
    const s = symbolLayer('star', 100, { motion: newMotion({ enter: 'rise', delay: 5.8 }) });
    expect(timing({ ...project([s]), timeline: { duration: 6, loop: false } })).toContain('gets cut off');
  });
});
