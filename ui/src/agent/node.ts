// The CLI's commands that don't draw (catalog, describe, scene, set) run this
// in Node through Vite, without a browser: templates, migration and edits are
// plain data.
import { TEMPLATES } from '../state/templates';
import { migrate } from '../state/migrate';
import type { Project } from '../state/model';
import { catalog as catalogText, findTemplate } from './catalog';

export { describe } from './describe';
export { applyEdits } from './edit';
export { migrate };

export const catalog = (q = '') => catalogText(q, TEMPLATES);
export const template = (name: string): Project => findTemplate(TEMPLATES, name).make();
export { timing } from './timing';
export { addGroup, addLayer, addModifier, arrange, blank, duplicateLayer, removeLayers } from './build';
export { addWithKit, newDesign } from './make';
export { moveEdits } from './moves';
export { layoutFromAssignments } from './place';
