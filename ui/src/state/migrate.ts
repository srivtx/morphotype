import type { EngineLayer } from '../engine/types';
import { defaultParams, effectById, type ParamValues } from '../render/effects';
import { background, fill, group, isGroup, tile, type Background, type Node, type Project, type ShapeLayer, type Style } from './model';

interface ProjectV1 {
  version: 1;
  name: string;
  canvas: { width: number; height: number };
  layers: (Omit<EngineLayer, 'sx' | 'sy'> & { name?: string })[];
  effect: { id: string; params: ParamValues };
  fonts?: Project['fonts'];
}

/** Version 1 had one effect for the whole document, with the backdrop baked in. */
function fromV1(p: ProjectV1): Project {
  const params = { ...p.effect.params };
  const take = (k: string, fallback: string) => {
    const v = String(params[k] ?? fallback);
    delete params[k];
    return v;
  };
  let bg: Background;
  let effect = p.effect.id;
  switch (effect) {
    case 'inflate':
      bg = background({ ...fill('linear', take('bgTop', '#2b8bff'), take('bgBottom', '#1a3fe0')), angle: 180 });
      break;
    case 'icon': {
      const top = take('tileTop', '#c9b8ff');
      const bottom = take('tileBottom', '#8a63f5');
      const size = Number(params.tileSize ?? 0.84);
      const gloss = Number(params.gloss ?? 0.45);
      delete params.tileSize;
      delete params.corner;
      delete params.gloss;
      bg = background(fill('solid', take('background', '#000000')), { tile: tile({ ...fill('linear', top, bottom), angle: 180 }, { size, gloss }) });
      break;
    }
    case 'distressed':
      bg = background(fill('solid', take('paper', '#0b0b0b')), { grain: Number(params.grain ?? 0.6) * 0.5 });
      break;
    default:
      bg = background(fill('solid', take('background', '#000000')));
  }
  if (!effectById(effect) || effectById(effect).id !== effect) effect = 'flat';
  const known = defaultParams(effectById(effect));
  const style: Style = { effect, params: { ...known, ...Object.fromEntries(Object.entries(params).filter(([k]) => k in known)) } };
  const layers: ShapeLayer[] = p.layers.map((l) => ({ ...l, sx: 1, sy: 1, style: structuredClone(style) }));
  const nodes: Node[] = layers.length === 1 && layers[0].op === 'add' ? layers : [group(layers, { merge: true, style, name: 'Artwork' })];
  return { version: 2, name: p.name, canvas: p.canvas, background: bg, layers: nodes, fonts: p.fonts ?? [] };
}

/** Fill in fields added after a file was written. */
function normalize(p: Project): Project {
  const fix = (n: Node) => {
    if (isGroup(n)) {
      n.children.forEach(fix);
      n.modifiers ??= [];
      n.style ??= { effect: 'flat', params: defaultParams(effectById('flat')) };
    } else {
      n.sx ??= 1;
      n.sy ??= 1;
      n.style ??= { effect: 'flat', params: defaultParams(effectById('flat')) };
    }
    if (!isGroup(n) || n.style) n.style.params = { ...defaultParams(effectById(n.style.effect)), ...n.style.params };
  };
  p.layers.forEach(fix);
  p.background ??= background();
  p.fonts ??= [];
  return p;
}

export function migrate(raw: unknown): Project {
  const p = raw as { version?: number; layers?: unknown };
  if (!p || !Array.isArray(p.layers)) throw new Error('Not a Morphotype project.');
  if (p.version === 1) return normalize(fromV1(raw as ProjectV1));
  if (p.version === 2) return normalize(raw as Project);
  throw new Error(`This project was made by a newer Morphotype (format ${p.version}).`);
}
