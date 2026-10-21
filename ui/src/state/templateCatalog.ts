// The template list is big (every template's layers are code), so it loads in
// its own chunk, when Home or the picker first wants it or once the app is idle.
import { useEffect, useState } from 'react';
import { effectById } from '../render/effects';
import { MODIFIER_UI, type Node, type Project } from './model';
import { toast } from './store';
import type { Template } from './templates';

let list: Template[] | null = null;
let pending: Promise<Template[]> | null = null;

/** Every template, in the order Home and the picker show them. */
export function loadTemplates(): Promise<Template[]> {
  return (pending ??= import('./templates').then(
    (m) => (list = m.TEMPLATES),
    (e: Error) => {
      pending = null;
      throw e;
    },
  ));
}

const failed = (e: Error) => toast(`Couldn't load the templates: ${e.message}`, 'error');

/** The templates if they have loaded, else null. */
export const loadedTemplates = () => list;

/** Run `fn` with the templates: right away once they have loaded, else when they land. */
export function withTemplates(fn: (templates: Template[]) => void) {
  if (list) fn(list);
  else loadTemplates().then(fn, failed);
}

/** The templates, or null until they have loaded (loading starts on first use). */
export function useTemplates(): Template[] | null {
  const [, loaded] = useState(0);
  useEffect(() => {
    if (list) return;
    let live = true;
    loadTemplates().then(() => live && loaded(1), failed);
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/**
 * The building blocks a design uses (modifiers, materials, page pattern),
 * shown on template cards so people can see how a look is made.
 */
export function recipeOf(p: Project): string[] {
  const out = new Set<string>();
  const mat = new Set<string>();
  const visit = (n: Node) => {
    for (const m of n.modifiers) if (m.on) out.add(MODIFIER_UI[m.kind]?.label ?? m.kind);
    if (n.op === 'subtract') out.add('Cut');
    if (n.op === 'intersect') out.add('Mask');
    if ((n as { type?: string }).type === 'group') {
      const g = n as Extract<Node, { type: 'group' }>;
      if (g.merge) (out.add('Merge'), mat.add(effectById(g.style.effect).name));
      g.children.forEach(visit);
    } else if (n.op === 'add') mat.add(effectById(n.style.effect).name);
    if (n.style?.stroke) out.add('Stroke');
  };
  p.layers.forEach(visit);
  const pat = p.background.pattern;
  return [...out, ...[...mat].filter((m) => m !== 'Flat' || mat.size === 1), ...(pat ? [`${pat.kind[0].toUpperCase()}${pat.kind.slice(1)} pattern`] : [])];
}
