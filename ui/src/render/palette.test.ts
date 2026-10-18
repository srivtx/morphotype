import { describe, expect, it } from 'vitest';
import { applyIconTarget, iconTarget } from '../state/icon';
import { background, fill, mods, style, textLayer } from '../state/model';
import { buildScene } from '../state/tree';
import { EFFECTS } from './effects';
import { COLOR_ROLES, hexToOklch, luminance, oklchToHex, primaryColor, recolor } from './palette';

describe('palette', () => {
  it('round-trips colours through OKLCH', () => {
    for (const hex of ['#ff3d2e', '#2b6bff', '#0a0a0a', '#f4f1ea', '#7b4dff']) {
      const [L, C, H] = hexToOklch(hex);
      const back = oklchToHex(L, C, H);
      const d = [1, 3, 5].map((i) => Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)));
      expect(Math.max(...d), `${hex} → ${back}`).toBeLessThanOrEqual(2);
    }
  });

  it('only gives roles to colour params that exist', () => {
    for (const [id, roles] of Object.entries(COLOR_ROLES)) {
      const e = EFFECTS.find((x) => x.id === id);
      expect(e, id).toBeTruthy();
      for (const k of Object.keys(roles)) expect(e!.params.find((p) => p.key === k)?.type, `${id}.${k}`).toBe('color');
    }
  });

  it('recolours a material from one colour, darker shadows and lighter highlights', () => {
    const st = recolor(style('chrome'), '#ff3d2e');
    expect(primaryColor(st)).toBe('#ff3d2e');
    expect(luminance(String(st.params.c1))).toBeLessThan(luminance('#ff3d2e'));
    expect(luminance(String(st.params.c4))).toBeGreaterThan(luminance('#ff3d2e'));
  });
});

describe('icon targets', () => {
  it('sets up macOS and iOS tiles and recognises them', () => {
    const bg = background(fill('solid', '#000000'));
    applyIconTarget(bg, 'macos');
    expect(iconTarget(bg.tile)).toBe('macos');
    applyIconTarget(bg, 'ios');
    expect(iconTarget(bg.tile)).toBe('ios');
    expect(bg.tile?.size).toBe(1);
  });
});

describe('typing on the canvas', () => {
  it('pauses distortions only on the layer being typed into', () => {
    const a = textLayer('A', 'archivo', { modifiers: mods({ kind: 'warp', style: 'arch', bend: 0.5, points: [] }, { kind: 'round', radius: 0.02 }) });
    const b = textLayer('B', 'archivo', { modifiers: mods({ kind: 'arc', bend: 0.5 }) });
    const p = { version: 2 as const, name: 't', canvas: { width: 100, height: 100 }, background: background(), layers: [a, b], fonts: [] };
    const { doc } = buildScene(p, undefined, a.id);
    expect(doc.layers[0].modifiers.map((m) => m.kind)).toEqual(['round']);
    expect(doc.layers[1].modifiers.map((m) => m.kind)).toEqual(['arc']);
  });
});
