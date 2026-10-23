import { describe as group, expect, it } from 'vitest';
import { EFFECTS, PRESETS } from '../render/effects';
import { group as groupNode, lineLayer, MODIFIER_UI, mods, newModifier, style, SYMBOL_UI, symbolLayer, textLayer, type Project, type ShapeLayer } from '../state/model';
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

  it('finds jumps and loop seams in the motion', () => {
    const smooth = Array.from({ length: 10 }, (_, i) => ({ t: i, d: 1 }));
    expect(motionFindings(smooth, 1, true)).toEqual([{ level: 'info', text: 'the loop joins smoothly' }]);
    expect(motionFindings(smooth, 9, true)[0].text).toMatch(/loop jumps where it starts over/);
    expect(motionFindings([...smooth, { t: 4.5, d: 12 }], null, true)[0].text).toMatch(/jump at 4.5s/);
    expect(motionFindings(smooth.map((s) => ({ ...s, d: 0 })), 0, true)[0].text).toMatch(/nothing visibly changes/);
  });

  it('measures presence and contrast from pixels', () => {
    const px = (rgb: number[], n = 4) => ({ data: new Uint8ClampedArray(Array.from({ length: n }, () => [...rgb, 255]).flat()), width: n, height: 1 });
    expect(diff(px([0, 0, 0]), px([30, 30, 30]))).toBe(30);
    expect(contrast(luminance(255, 255, 255), luminance(0, 0, 0))).toBeCloseTo(21);
    expect(presence(px([255, 255, 255]), px([0, 0, 0]))).toEqual({ px: 4, contrast: 21 });
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
