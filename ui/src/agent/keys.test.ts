import { describe as group, expect, it } from 'vitest';
import { style, symbolLayer, type Project, type ShapeLayer } from '../state/model';
import { catalog } from './catalog';
import { describe } from './describe';
import { applyEdits, EditError } from './edit';
import { timing } from './timing';

const project = (layers: Project['layers']): Project => ({ version: 2, name: 'Keys', canvas: { width: 1000, height: 800 }, background: { fill: { kind: 'solid', colors: ['#000000'], angle: 180 }, grain: 0, tile: null }, layers, fonts: [], timeline: { duration: 3, loop: true } });
const star = () => symbolLayer('star', 300, { name: 'Star', style: style('flat', { fill: '#ffcc00' }) });

group('free keys from the command line', () => {
  it('sets keys with set, in short form, and lengthens the clock to hold them', () => {
    const { project: p, changes } = applyEdits(project([star()]), ['Star.keys.rotation=[[0,0],[1,45],[2.5,30,"linear"],[4,0]]', 'Star.keys.fill=[[0,"#ffffff"],[2,"#ff3366"]]']);
    const s = p.layers[0] as ShapeLayer;
    expect(s.keys?.rotation.map((k) => [k.t, k.v])).toEqual([
      [0, 0],
      [1, 45],
      [2.5, 30],
      [4, 0],
    ]);
    expect(s.keys?.rotation[2].ease?.ease).toEqual([0, 0, 1, 1]);
    // Material settings land on the style.
    expect(s.style.keys?.fill).toHaveLength(2);
    expect(p.timeline?.duration).toBe(4);
    expect(changes[0]).toMatch(/keys\.rotation/);
    // null removes them.
    expect((applyEdits(p, ['Star.keys.rotation=null']).project.layers[0] as ShapeLayer).keys).toBeUndefined();
  });

  it('checks what it keys', () => {
    expect(() => applyEdits(project([star()]), ['Star.keys.wobble=[[0,1]]'])).toThrow(EditError);
    expect(() => applyEdits(project([star()]), ['Star.keys.fill=[[0,12]]'])).toThrow(/colour/);
    expect(() => applyEdits(project([star()]), ['Star.keys.x=[[0,0,"zigzag"]]'])).toThrow(/no curve/);
  });

  it('describe, timing and catalog show them', () => {
    const { project: p } = applyEdits(project([star()]), ['Star.keys.rotation=[[0,0],[1,45],[2.5,30,"linear"]]']);
    expect(describe(p)).toContain('keys rotation 0s 0 → 1s 45 → 2.5s 30 linear');
    const t = timing(p);
    expect(t).toMatch(/rotation keys\s+◆─+◆─+◆/);
    expect(t).toContain('0s 0 → 1s 45 → 2.5s 30 linear');
    expect(catalog('keyframes', [])).toContain('Star.keys.rotation=[[0,0],[1,45],[2.5,30]]');
  });

  it('warns about keys after the end of the clock', () => {
    const p = project([star()]);
    (p.layers[0] as ShapeLayer).keys = { x: [{ t: 0, v: 0 }, { t: 5, v: 100 }] };
    expect(timing(p)).toContain('! a position x key at 5s is after the 3s clock: it never plays');
  });
});
