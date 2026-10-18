import { describe, expect, it } from 'vitest';
import { edit, redo, store, undo } from './store';

describe('history', () => {
  it('coalesces edits that share a key and undoes them in one step', () => {
    const start = store.get().project.name;
    for (const n of ['a', 'ab', 'abc']) edit((p) => (p.name = n), 'name');
    expect(store.get().project.name).toBe('abc');
    undo();
    expect(store.get().project.name).toBe(start);
    redo();
    expect(store.get().project.name).toBe('abc');
  });

  it('keeps separate steps for unkeyed edits', () => {
    edit((p) => (p.canvas.width = 800));
    edit((p) => (p.canvas.width = 900));
    undo();
    expect(store.get().project.canvas.width).toBe(800);
  });
});
