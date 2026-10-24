import { describe as group, expect, it } from 'vitest';
import type { Box } from '../engine/types';
import { group as groupNode, isGroup, symbolLayer, textLayer, type Project, type ShapeLayer } from '../state/model';
import { newMotion } from '../state/motion';
import { rowsOf } from '../state/tracks';
import { catalog } from './catalog';
import { forStyle, motionFindings, report, structural, type Finding } from './check';
import { applyEdits } from './edit';
import { diffFindings, fixPlan, retime, seamFix, todoText } from './fix';
import { allNodes, findNode } from './find';
import { KITS, kitByName, kitColor, kitProblems } from './kits';
import { addWithKit, fromSpec, newDesign } from './make';
import { moveEdits } from './moves';
import { alignEdits, fitEdits, layoutFromAssignments, placeEdits, spot, type Boxes } from './place';

const project = (layers: Project['layers'], o: Partial<Project> = {}): Project => ({ version: 2, name: 'Test', canvas: { width: 1000, height: 1200 }, background: { fill: { kind: 'solid', colors: ['#000000'], angle: 180 }, grain: 0, tile: null }, layers, fonts: [], ...o });

/** Boxes as the engine would build them: each layer's size around its position (text: 0.6 of its size per letter wide). */
function fakeBuild(p: Project): Boxes {
  const out: Boxes = new Map();
  for (const n of allNodes(p.layers)) {
    if (isGroup(n)) continue;
    const s = (n.content as { size: number }).size * n.scale;
    const w = n.content.type === 'text' ? s * n.content.text.length * 0.6 : s;
    const h = s;
    out.set(n.id, [n.x - w / 2, n.y - h / 2, n.x + w / 2, n.y + h / 2] as Box);
  }
  return out;
}

/** Fit, rebuild, place: what page.ts does against the real engine. */
function resolve(p: Project, ops: Parameters<typeof fitEdits>[2]): Project {
  p = applyEdits(p, fitEdits(p, fakeBuild(p), ops)).project;
  return applyEdits(p, placeEdits(p, fakeBuild(p), ops)).project;
}

const box = (p: Project, name: string) => fakeBuild(p).get(findNode(p, name).id)!;

group('layout in words', () => {
  it('reads spots, with one word centring the other axis', () => {
    expect(spot('top')).toEqual({ x: 'centre', y: 'top' });
    expect(spot('Upper third')).toEqual({ x: 'centre', y: 'top third' });
    expect(spot('bottom-right')).toEqual({ x: 'right', y: 'bottom' });
    expect(spot('left top')).toEqual({ x: 'left', y: 'top' });
    expect(spot('middle')).toEqual({ x: 'centre', y: 'centre' });
    expect(() => spot('somewhere')).toThrow(/Spots: top, centre/);
  });

  it('fits to a share of the canvas, keeping the box where it was', () => {
    const p0 = project([textLayer('HELLO', 'archivo', { name: 'T', x: 50, y: 20 }, { size: 100 })]);
    const p = resolve(p0, [{ target: 'T', fitWidth: 80 }]);
    const b = box(p, 'T');
    expect(b[2] - b[0]).toBeCloseTo(800, 0);
    expect((b[0] + b[2]) / 2).toBeCloseTo(50, 3);
    // Both: it fits inside both.
    const q = resolve(p0, [{ target: 'T', fitWidth: 80, fitHeight: 10 }]);
    expect(box(q, 'T')[3] - box(q, 'T')[1]).toBeCloseTo(120, 3);
  });

  it('places at spots with margins, and thirds on the third lines', () => {
    const p0 = project([symbolLayer('star', 200, { name: 'S', x: 33, y: 44 })]);
    let b = box(resolve(p0, [{ target: 'S', place: 'top left', margin: 40 }]), 'S');
    expect([b[0], b[1]]).toEqual([-460, -560]);
    b = box(resolve(p0, [{ target: 'S', place: 'bottom', margin: '10%' }]), 'S');
    expect([(b[0] + b[2]) / 2, b[3]]).toEqual([0, 600 - 100]);
    b = box(resolve(p0, [{ target: 'S', place: 'top third' }]), 'S');
    expect((b[1] + b[3]) / 2).toBeCloseTo(-200, 6);
    b = box(resolve(p0, [{ target: 'S', place: 'centre', offset: [0, -50] }]), 'S');
    expect([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]).toEqual([0, -50]);
  });

  it('centres by ink, and keeps things inside the margins (shrinking what is too big)', () => {
    const p0 = project([textLayer('WIDE WORD HERE', 'archivo', { name: 'T', x: 120, y: 7 }, { size: 200 })]);
    const p = resolve(p0, [{ target: 'T', contain: true, margin: 50 }]);
    const b = box(p, 'T');
    expect(b[2] - b[0]).toBeCloseTo(900, 0);
    expect(b[0]).toBeCloseTo(-450, 1);
    const c = box(resolve(p0, [{ target: 'T', centre: 'x' }]), 'T');
    expect((c[0] + c[2]) / 2).toBeCloseTo(0, 6);
    expect((c[1] + c[3]) / 2).toBeCloseTo(7, 6);
  });

  it('stacks and rows with a gap, aligned across, placed as one block', () => {
    const p0 = project([textLayer('AB', 'archivo', { name: 'A' }, { size: 100 }), textLayer('ABCD', 'archivo', { name: 'B', x: 300 }, { size: 50 })]);
    const p = resolve(p0, [{ stack: ['A', 'B'], gap: 20, align: 'left', place: 'bottom left', margin: 40 }]);
    const a = box(p, 'A'), b = box(p, 'B');
    expect(b[1] - a[3]).toBeCloseTo(20, 6);
    expect(a[0]).toBeCloseTo(-460, 6);
    expect(b[0]).toBeCloseTo(-460, 6);
    expect(b[3]).toBeCloseTo(560, 6);
    const r = resolve(p0, [{ row: ['A', 'B'], gap: 30 }]);
    expect(box(r, 'B')[0] - box(r, 'A')[2]).toBeCloseTo(30, 6);
    expect((box(r, 'B')[1] + box(r, 'B')[3]) / 2).toBeCloseTo((box(r, 'A')[1] + box(r, 'A')[3]) / 2, 6);
  });

  it('moves and sizes groups through their layers', () => {
    const g = groupNode([symbolLayer('star', 100, { name: 'S1', x: -100 }), symbolLayer('star', 100, { name: 'S2', x: 100 })], { name: 'G' });
    const p = resolve(project([g]), [{ target: 'G', fitWidth: 60, place: 'top', margin: 0 }]);
    const s1 = box(p, 'S1'), s2 = box(p, 'S2');
    expect(s2[2] - s1[0]).toBeCloseTo(600, 3);
    expect(s1[1]).toBeCloseTo(-600, 3);
    expect((s1[0] + s2[2]) / 2).toBeCloseTo(0, 3);
  });

  it('aligns edges by the boxes', () => {
    const p0 = project([symbolLayer('star', 100, { name: 'A', x: 10 }), symbolLayer('star', 300, { name: 'B', x: 200, y: 90 })]);
    const p = applyEdits(p0, alignEdits(p0, fakeBuild(p0), ['A'], 'B', ['left', 'top'])).project;
    expect(box(p, 'A')[0]).toBe(box(p, 'B')[0]);
    expect(box(p, 'A')[1]).toBe(box(p, 'B')[1]);
    expect(() => alignEdits(p0, fakeBuild(p0), ['A'], 'canvas', ['sideways'])).toThrow(/align edges are/);
  });

  it('takes layout out of assignments, leaving the other edits', () => {
    const r = layoutFromAssignments(['Title.place=top third', '"Big one".fitWidth=80', 'Title.margin=5%', 'Title.gloss=0.4', 'Info.centre=x', 'Info.fit=height 20%', 'Info.contain=true']);
    expect(r.rest).toEqual(['Title.gloss=0.4']);
    expect(r.ops).toEqual([
      { target: 'Title', place: 'top third', margin: '5%' },
      { target: 'Big one', fitWidth: 80 },
      { target: 'Info', centre: 'x', fitHeight: 20, contain: true },
    ]);
    expect(() => layoutFromAssignments(['A.place=nowhere'])).toThrow(/No spot/);
    expect(() => layoutFromAssignments(['A.fitWidth=-3'])).toThrow(/% of the canvas/);
  });
});

group('kits', () => {
  it('name only fonts, presets, backgrounds and colours that exist', () => {
    expect(KITS.length).toBeGreaterThanOrEqual(6);
    expect(kitProblems()).toEqual([]);
  });

  it('are in the catalog', () => {
    const idx = catalog('');
    for (const k of KITS) expect(idx).toContain(k.name);
    expect(catalog('kits')).toContain('chrome-night: ');
    expect(catalog('riso-zine')).toContain('kit riso-zine');
  });

  it('give layers their role\'s look unless they set their own', () => {
    const { project: p } = fromSpec({ kit: 'chrome-night', layers: [{ shape: 'ring', name: 'R' }, { text: 'BIG', name: 'H' }, { text: 'small', name: 'B' }, { text: 'mine', name: 'M', role: 'body', color: 'hot' }, { text: 'own', name: 'O', preset: 'Molten' }] });
    const [r, h, b, m, o] = p.layers as ShapeLayer[];
    expect(p.background.fill.colors[0]).toBe('#0b0b0d');
    expect(p.agent).toEqual({ kit: 'chrome-night' });
    expect(h.content).toMatchObject({ font: 'unbounded' });
    expect(h.style.effect).toBe('chrome');
    expect(r.style.params.c2).toBe('#5a17d6');
    expect(b.content).toMatchObject({ font: 'space-grotesk', size: Math.round(1080 * 0.032), tracking: 0.04 });
    expect(b.style.params.fill).toBe('#e8e8f0');
    expect(m.style.params.fill).toBe('#ff2e9a');
    expect(o.style.params.c3).toBe('#ff6a00');
    // A colour of its own tints the kit's look when it has one main colour.
    const neon = fromSpec({ kit: 'neon-club', layers: [{ shape: 'ring', color: 'cool' }, { shape: 'star', color: '#123456', preset: 'Ice chrome' }] }).project.layers as ShapeLayer[];
    expect(neon[0].style).toMatchObject({ effect: 'neon', params: { color: '#28f0ff' } });
    expect(neon[1].style).toMatchObject({ effect: 'flat', params: { fill: '#123456' } });
  });

  it('carry on into add', () => {
    let p = newDesign({ kit: 'editorial', style: 'logo' });
    expect(p.agent).toEqual({ kit: 'editorial', style: 'logo' });
    p = addWithKit(p, 'text', 'TITLE', {}).project;
    p = addWithKit(p, 'text', 'caption', { color: 'accent' }).project;
    const [t, c] = p.layers as ShapeLayer[];
    expect(t.content).toMatchObject({ font: 'playfair' });
    expect(c.content).toMatchObject({ font: 'eb-garamond' });
    expect(c.style.params.fill).toBe('#e3120b');
    expect(() => newDesign({ kit: 'nope' })).toThrow(/Kits: chrome-night/);
    expect(() => kitColor(kitByName('editorial'), 'blurple')).toThrow(/ink, accent, paper/);
  });
});

group('make', () => {
  it('builds a spec: canvas, clock, layers bottom first, modifiers, settings, layout and motion', () => {
    const made = fromSpec({
      name: 'Poster',
      canvas: '1080x1350',
      duration: 4,
      style: 'abstract',
      layers: [
        { shape: 'ring', name: 'Halo', fitWidth: 90, place: 'top third', set: { 'motion.loop': 'spin' } },
        { text: 'NIGHT\\nDRIVE', name: 'Title', place: 'top third', modifiers: [{ kind: 'wave', amplitude: 0.04 }, 'slant'] },
        { group: [{ text: 'A', name: 'GA' }, { text: 'B', name: 'GB' }], name: 'Pair', merge: true },
        { text: 'Info', name: 'Info', size: 30, motion: { enter: 'fade', delay: 1 } },
      ],
      layout: [{ stack: ['Title', 'Info'], gap: 30 }],
      motion: { recipe: 'cascade', layers: ['Title'] },
    });
    const p = made.project;
    expect(p.canvas).toEqual({ width: 1080, height: 1350 });
    expect(p.timeline).toEqual({ duration: 4, loop: true });
    expect(p.agent).toEqual({ style: 'abstract' });
    expect(p.layers.map((n) => n.name)).toEqual(['Halo', 'Title', 'Pair', 'Info']);
    const title = findNode(p, 'Title') as ShapeLayer;
    expect(title.content).toMatchObject({ text: 'NIGHT\nDRIVE' });
    expect(title.modifiers.map((m) => m.kind)).toEqual(['wave', 'slant']);
    expect(title.motion).toMatchObject({ enter: 'rise', leave: 'rise' });
    expect(findNode(p, 'Halo').motion?.loop).toBe('spin');
    expect(findNode(p, 'Info').motion).toMatchObject({ enter: 'fade', delay: 1, leave: 'fade' });
    // Fits first (the headline gets 80% wide by default), then places, then stacks.
    expect(made.layout.slice(0, 2)).toEqual([{ target: `#${findNode(p, 'Halo').id}`, fitWidth: 90 }, { target: `#${findNode(p, 'Title').id}`, fitWidth: 80 }]);
    expect(made.layout.find((o) => 'stack' in o)).toMatchObject({ stack: ['Title', 'Info'] });
  });

  it('says what is wrong with a bad spec', () => {
    expect(() => fromSpec({} as never)).toThrow(/"layers"/);
    expect(() => fromSpec({ layers: [{ text: 'A', shape: 'star' }] })).toThrow(/not text and shape/);
    expect(() => fromSpec({ layers: [{ shape: 'zigzagoon' }] })).toThrow(/No shape "zigzagoon"/);
    expect(() => fromSpec({ layers: [{ text: 'A', place: 'nowhere' }] })).toThrow(/No spot/);
    expect(() => fromSpec({ layers: [{ text: 'A' }], layout: [{ stack: ['A', 'Z'] }] })).toThrow(/No layer "Z"/);
    expect(() => fromSpec({ layers: [{ text: 'A' }], kit: 'nope' })).toThrow(/No kit/);
  });
});

group('motion recipes', () => {
  const three = () => project([textLayer('A', 'archivo', { name: 'A' }), textLayer('B', 'archivo', { name: 'B' }), textLayer('C', 'archivo', { name: 'C' })], { timeline: { duration: 4, loop: true } });
  const clips = (p: Project) => rowsOf(p, []).flatMap((r) => r.tracks.filter((t) => t.kind === 'enter' || t.kind === 'leave').map((t) => ({ name: r.node.name, kind: t.kind, start: (t as { start: number }).start, end: (t as { end: number }).end })));

  it('staggers entrances and leaves before a looping clock ends, last in last out', () => {
    const r = moveEdits(three(), { layers: ['A', 'B', 'C'], enter: 'rise', stagger: 0.2, start: 0.1 });
    const c = clips(r.project);
    expect(c.filter((x) => x.kind === 'enter').map((x) => +x.start.toFixed(2)).sort()).toEqual([0.1, 0.3, 0.5]);
    const leaves = c.filter((x) => x.kind === 'leave');
    expect(leaves).toHaveLength(3);
    for (const l of leaves) expect(l.end).toBeLessThanOrEqual(4 - 0.1);
    expect(r.summary).toMatch(/enter rise 0.2s apart from 0.1s, leaving from .*s so the 4s loop joins/);
    const order = ['A', 'B', 'C'].map((n) => findNode(r.project, n).motion!.leaveAt!);
    expect(order[0]).toBeLessThan(order[2]);
  });

  it('keeps letter-by-letter exits inside the clock, and stays when told', () => {
    const r = moveEdits(three(), { layers: 'text', recipe: 'type-on' });
    for (const l of clips(r.project).filter((x) => x.kind === 'leave')) expect(l.end).toBeLessThanOrEqual(4 - 0.149);
    expect(findNode(r.project, 'A').motion).toMatchObject({ letters: 'letters', enter: 'fade' });
    const stay = moveEdits(three(), { layers: ['A'], enter: 'grow', leave: 'none' });
    expect(findNode(stay.project, 'A').motion?.leave).toBeUndefined();
  });

  it('runs loops out of step and refuses unknown names', () => {
    const r = moveEdits(three(), { recipe: 'drift' });
    expect(['A', 'B', 'C'].map((n) => findNode(r.project, n).motion!.phase)).toEqual([0, 0.25, 0.5]);
    expect(() => moveEdits(three(), { recipe: 'wobble' })).toThrow(/Recipes: cascade/);
    expect(() => moveEdits(three(), { enter: 'zoom' as never })).toThrow(/Entrances: fade/);
    expect(() => moveEdits(three(), { feel: 'Wobbly', enter: 'rise' })).toThrow(/Feels: Smooth/);
  });
});

group('check --fix', () => {
  it('retimes moves the clock cuts off: earlier first, then quicker', () => {
    const t = textLayer('A', 'archivo', { name: 'A', motion: newMotion({ enter: 'rise', delay: 3.8 }) });
    const p = project([t], { timeline: { duration: 4, loop: true } });
    const f = structural(p, null).find((x) => /cut off/.test(x.text))!;
    expect(f.text).toMatch(/"A" .*its entrance ends at 4.4s, after the 4s clock: cut off/);
    const q = applyEdits(p, f.fix!.edits!).project;
    expect(findNode(q, 'A').motion!.delay).toBeCloseTo(3.3, 6);
    // No room to start earlier: it gets quicker.
    const slow = project([textLayer('A', 'archivo', { name: 'A', motion: newMotion({ enter: 'rise', transition: { ...newMotion().transition, duration: 5 } }) })], { timeline: { duration: 4, loop: false } });
    const fix = retime(slow, slow.layers[0].id, 'enter');
    const s = applyEdits(slow, fix.edits!).project;
    expect(findNode(s, 'A').motion!.transition.duration).toBeLessThanOrEqual(3.9);
    expect(fix.does).toMatch(/entrance now 0–.*s, inside the 4s clock/);
  });

  it('adds a way out for entrances that would replay at the seam, after the other fixes', () => {
    const p = project([textLayer('A', 'archivo', { name: 'A', motion: newMotion({ enter: 'drop' }) }), textLayer('B', 'archivo', { name: 'B', motion: newMotion({ loop: 'float' }) })], { timeline: { duration: 3, loop: true } });
    const fix = seamFix(p)!;
    expect(fix.does).toMatch(/^"A" leaves \(drop\) at/);
    const q = applyEdits(p, fix.edits!).project;
    expect(findNode(q, 'B').motion?.leave).toBeUndefined();
    expect(seamFix(q)).toBeNull();
    expect(seamFix({ ...p, timeline: { duration: 3, loop: false } })).toBeNull();
  });

  it('plans fixes for warnings, leaves notes alone, and lists the rest as commands', () => {
    const fs: Finding[] = [
      { level: 'warn', text: 'cut', fix: { edits: ['A.x=1'], does: 'moved' } },
      { level: 'warn', text: 'near', hint: `align {file} "A" --to "B" --edge left` },
      { level: 'warn', text: 'just words' },
      { level: 'info', text: 'note', fix: { edits: ['A.x=2'], does: 'no' } },
    ];
    const plan = fixPlan(fs);
    expect(plan.edits).toEqual(['A.x=1']);
    expect(plan.done).toEqual(['cut → moved']);
    expect(todoText(plan.todo, 'my poster.morpho')).toEqual([`morpho align "my poster.morpho" "A" --to "B" --edge left   # near`, '# just words']);
    expect(report('T', fs)).toContain('! cut [--fix]');
  });

  it('turns style rules into notes for abstract designs, and only those', () => {
    const fs: Finding[] = [
      { level: 'warn', text: 'nearly centred', style: true, fix: { layout: [], does: 'centred' } },
      { level: 'warn', text: 'off the edge' },
    ];
    expect(forStyle(fs, 'poster')).toBe(fs);
    const a = forStyle(fs, 'abstract');
    expect(a[0]).toMatchObject({ level: 'info', fix: undefined });
    expect(a[1]).toBe(fs[1]);
  });

  it('only flags a pop when the steps on both sides are small (a move from rest is not a pop)', () => {
    expect(motionFindings([{ t: 1, a: 0, b: 12, c: 11 }], null, true)).toEqual([]);
    expect(motionFindings([{ t: 1, a: 0.1, b: 12, c: 0.2 }], null, true)[0].text).toMatch(/pop at 1s/);
  });
});

group('set --check', () => {
  it('shows what appeared, went away and changed', () => {
    const before: Finding[] = [
      { level: 'warn', text: '"T": 10% off the left edge' },
      { level: 'warn', text: '"A" and "B": lefts 3px apart, nearly lined up' },
      { level: 'info', text: 'looked at 2 of 2 layers' },
    ];
    const after: Finding[] = [
      { level: 'warn', text: '"T": 4% off the left edge' },
      { level: 'error', text: '"C": entirely outside the canvas' },
      { level: 'info', text: 'looked at 3 of 3 layers' },
    ];
    expect(diffFindings(before, after)).toEqual(['~ ! "T": 4% off the left edge (was: "T": 10% off the left edge)', '+ ✗ "C": entirely outside the canvas', '− ! "A" and "B": lefts 3px apart, nearly lined up']);
    expect(diffFindings(after, after)).toEqual([]);
  });
});
