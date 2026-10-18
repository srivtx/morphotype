import { describe, expect, it } from 'vitest';
import { group, MODIFIER_DEFAULTS, MODIFIER_UI, isChoice, newModifier, style, SYMBOL_DEFAULTS, SYMBOL_UI, symbolLayer, textLayer } from './model';
import { migrate } from './migrate';
import { TEMPLATES } from './templates';
import { allLayers, buildScene, walk } from './tree';

describe('model', () => {
  it('has UI for every modifier and symbol default', () => {
    for (const [kind, m] of Object.entries(MODIFIER_DEFAULTS)) {
      expect(m.kind).toBe(kind);
      for (const f of MODIFIER_UI[m.kind].fields) expect(m, `${kind}.${f.key}`).toHaveProperty(f.key);
      for (const f of MODIFIER_UI[m.kind].fields) if (isChoice(f)) expect(f.options.map((o) => o.value)).toContain((m as unknown as Record<string, string>)[f.key]);
    }
    for (const [kind, s] of Object.entries(SYMBOL_DEFAULTS)) {
      expect(s.kind).toBe(kind);
      for (const f of SYMBOL_UI[s.kind].fields) expect(s, `${kind}.${f.key}`).toHaveProperty(f.key);
    }
  });

  it('gives modifiers unique ids', () => {
    expect(newModifier('weight').uid).not.toBe(newModifier('weight').uid);
  });

  it('builds every template into renderable objects', () => {
    for (const t of TEMPLATES) {
      const p = t.make();
      const ids: string[] = [];
      walk(p.layers, (n) => ids.push(n.id));
      expect(new Set(ids).size, t.name).toBe(ids.length);
      const { doc, objects } = buildScene(p);
      expect(objects.length, t.name).toBeGreaterThan(0);
      expect(doc.renders?.length).toBe(objects.length);
      for (const r of doc.renders ?? []) expect(r.members.length, `${t.name}/${r.id}`).toBeGreaterThan(0);
    }
  });
});

describe('scene', () => {
  it('gives each shape its own object and clips cuts into the layer below', () => {
    const body = symbolLayer('blob', 500, { style: style('inflate') });
    const eyes = symbolLayer('eyes', 200, { op: 'subtract' });
    const star = symbolLayer('star', 100, { style: style('chrome') });
    const { doc, objects } = buildScene({ version: 2, name: 't', canvas: { width: 100, height: 100 }, background: { fill: { kind: 'solid', colors: ['#000'], angle: 0 }, grain: 0, tile: null }, layers: [body, eyes, star], fonts: [] });
    expect(objects.map((o) => o.style.effect)).toEqual(['inflate', 'chrome']);
    expect(doc.renders![0].members).toEqual([body.id, eyes.id]);
    expect(doc.renders![1].members).toEqual([star.id]);
  });

  it('cuts every child of a plain group and fuses merged groups', () => {
    const a = symbolLayer('circle');
    const b = symbolLayer('circle');
    const g = group([a, b]);
    const hole = group([symbolLayer('eyes')], { op: 'subtract' });
    const m = group([textLayer('A'), textLayer('B')], { merge: true, style: style('glass') });
    const { doc, objects } = buildScene({ version: 2, name: 't', canvas: { width: 100, height: 100 }, background: { fill: { kind: 'none', colors: [], angle: 0 }, grain: 0, tile: null }, layers: [g, hole, m], fonts: [] });
    expect(objects.length).toBe(3);
    const cut = doc.renders![0].members.at(-1);
    expect(cut).toEqual({ id: hole.children[0].id, op: 'subtract' });
    expect(doc.renders![1].members.at(-1)).toEqual(cut);
    expect(doc.renders![2].id).toBe(m.id);
    expect(doc.renders![2].members.length).toBe(2);
  });

  it('skips hidden layers but keeps them for morph references', () => {
    const a = textLayer('A', 'archivo', { visible: false });
    const { doc, objects } = buildScene({ version: 2, name: 't', canvas: { width: 100, height: 100 }, background: { fill: { kind: 'none', colors: [], angle: 0 }, grain: 0, tile: null }, layers: [a], fonts: [] });
    expect(objects.length).toBe(0);
    expect(doc.layers[0].visible).toBe(false);
  });
});

describe('migration', () => {
  it('turns a v1 document into per-layer styles with the backdrop on the canvas', () => {
    const v1 = {
      version: 1,
      name: 'Old',
      canvas: { width: 800, height: 800 },
      effect: { id: 'inflate', params: { bgTop: '#111111', bgBottom: '#222222', body: '#ffffff' } },
      layers: [
        { id: 'a', visible: true, op: 'add', x: 0, y: 0, rotation: 0, scale: 1, modifiers: [], content: { type: 'symbol', symbol: { kind: 'blob' }, size: 400 } },
        { id: 'b', visible: true, op: 'subtract', x: 0, y: 0, rotation: 0, scale: 1, modifiers: [], content: { type: 'symbol', symbol: { kind: 'eyes' }, size: 200 } },
      ],
    };
    const p = migrate(v1);
    expect(p.version).toBe(2);
    expect(p.background.fill).toMatchObject({ kind: 'linear', colors: ['#111111', '#222222'] });
    expect(p.layers.length).toBe(1);
    const g = p.layers[0];
    expect('children' in g && g.merge).toBe(true);
    expect(allLayers(p.layers).every((l) => l.sx === 1 && l.sy === 1)).toBe(true);
    expect(g.style.params.body).toBe('#ffffff');
    expect(g.style.params).not.toHaveProperty('bgTop');
  });
});
