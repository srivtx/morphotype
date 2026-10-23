// Finding layers by name or id, for edits and new layers alike.
import { isGroup, type Node, type Project } from '../state/model';

export class EditError extends Error {}

export function allNodes(nodes: Node[], out: Node[] = []): Node[] {
  for (const n of nodes) {
    out.push(n);
    if (isGroup(n)) allNodes(n.children, out);
  }
  return out;
}

export function findNode(p: Project, target: string): Node {
  const all = allNodes(p.layers);
  const id = target.replace(/^#/, '');
  const byId = all.find((n) => n.id === id);
  if (byId) return byId;
  for (const same of [(n: Node) => n.name === target, (n: Node) => n.name?.toLowerCase() === target.toLowerCase()]) {
    const hits = all.filter(same);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new EditError(`${hits.length} layers are called "${target}"; use an id: ${hits.map((n) => '#' + n.id).join(', ')}`);
  }
  const names = all.map((n) => (n.name ? `"${n.name}"` : `#${n.id}`));
  throw new EditError(`No layer "${target}". Layers: ${names.join(', ')}`);
}
