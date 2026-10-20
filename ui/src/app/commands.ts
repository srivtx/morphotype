// Every user-facing action, with its shortcut. The command palette, menus,
// help sheet and keyboard handler all read from here, so anything you can
// click you can also reach from the keyboard.
import type { SymbolKind } from '../engine/types';
import type { IconName } from '../components/icons';
import { platform } from '../platform';
import { PRESETS } from '../render/effects';
import { CANVAS_PRESETS, isGroup, newModifier, SYMBOL_UI, symbolLayer } from '../state/model';
import { edit, redo, select, setSettings, store, toast, undo } from '../state/store';
import { ancestors } from '../state/tree';
import { clock, timelineOf } from '../state/clock';
import { addCentreDot, addFace, tileSheet } from './assists';
import { goHome } from './projects';
import {
  addEmptyLayer,
  addIconGrid,
  addShape,
  alignSelected,
  applyPreset,
  arrangeSelected,
  breakApart,
  convertToOutline,
  copyPNG,
  copySelected,
  copyMotion,
  copyStyle,
  cutSelected,
  distributeSelected,
  duplicateSelected,
  editPoints,
  editText,
  endTextEdit,
  exportJPG,
  exportVideo,
  exportPNG,
  exportSVG,
  flipSelected,
  groupSelected,
  importFonts,
  importImage,
  nudge,
  openProject,
  paste,
  pasteMotion,
  pasteStyle,
  primaryNode,
  removeSelected,
  saveProject,
  selectAll,
  selectedNodes,
  startText,
  toggleLocked,
  toggleVisible,
  ungroupSelected,
  updateNode,
  constructionSheet,
} from './actions';

export interface Command {
  id: string;
  title: string;
  group: string;
  icon?: IconName;
  /** Key combos like "mod+shift+g", "alt+a", "t", "shift+0". */
  keys?: string[];
  keywords?: string;
  run: () => void;
  when?: () => boolean;
  /** Hidden from the palette (still bound to keys). */
  hidden?: boolean;
}

const hasSel = () => store.get().selection.length > 0;
const design = () => store.get().mode === 'design';
const primaryShape = () => {
  const n = primaryNode();
  return n && !isGroup(n) ? n : undefined;
};
const fire = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function commands(): Command[] {
  const list: Command[] = [
    // File
    { id: 'home', title: 'Home: all designs and fonts', group: 'File', icon: 'grid', keys: ['alt+mod+h'], when: () => store.get().screen === 'editor', run: () => void goHome() },
    { id: 'icon-grid', title: 'Show or hide the app-icon grid', group: 'View', icon: 'grid', keywords: 'keylines guides ios macos icon', run: () => setSettings({ iconGrid: !store.get().settings.iconGrid }) },
    { id: 'add-icon-grid', title: 'Add the app-icon grid as layers', group: 'Add', icon: 'grid', keywords: 'keylines guides presentation icon', run: () => addIconGrid() },
    { id: 'new', title: 'New from template…', group: 'File', icon: 'sparkle', keys: ['mod+n'], run: () => store.set({ dialog: { kind: 'templates' } }) },
    { id: 'open', title: 'Open project…', group: 'File', icon: 'open', keys: ['mod+o'], run: () => void openProject() },
    { id: 'save', title: 'Save project…', group: 'File', icon: 'save', keys: ['mod+s'], run: () => void saveProject() },
    { id: 'import-fonts', title: 'Import fonts…', group: 'File', icon: 'font', run: () => void importFonts() },
    { id: 'trace', title: 'Add an image… (photo, trace or pixel art)', group: 'File', icon: 'image', keys: ['shift+mod+i'], keywords: 'import picture photo logo vectorize', run: () => void importImage() },
    { id: 'export-png', title: 'Export PNG', group: 'Export', icon: 'export', keys: ['mod+e'], run: () => void exportPNG() },
    { id: 'export-png-4', title: 'Export PNG at 4×', group: 'Export', icon: 'export', run: () => void exportPNG(4) },
    { id: 'export-jpg', title: 'Export JPG (for social posts)', group: 'Export', icon: 'export', keywords: 'instagram thumbnail jpeg', run: () => void exportJPG() },
    { id: 'export-svg', title: 'Export SVG', group: 'Export', icon: 'export', keys: ['shift+mod+e'], keywords: 'vector logo', run: () => void exportSVG() },
    { id: 'copy-png', title: 'Copy as image', group: 'Export', icon: 'copy', keys: ['shift+mod+c'], keywords: 'clipboard png', run: () => void copyPNG() },
    { id: 'export-video', title: 'Export video (one pass of the timeline)', group: 'Export', icon: 'film', keywords: 'mp4 webm animation motion movie record', run: () => void exportVideo() },
    { id: 'play-pause', title: 'Play or pause motion', group: 'View', icon: 'play', keys: ['k'], keywords: 'animation timeline motion stop', when: design, run: () => clock.toggle(timelineOf(store.get().project)) },
    { id: 'replay', title: 'Play motion from the start', group: 'View', icon: 'replay', keys: ['shift+k'], keywords: 'animation timeline restart entrance', when: design, run: () => clock.replay(timelineOf(store.get().project)) },
    { id: 'export-font', title: 'Export as font…', group: 'Export', icon: 'font', keywords: 'ttf woff install', run: () => store.set({ dialog: { kind: 'font' } }) },
    // Edit
    { id: 'undo', title: 'Undo', group: 'Edit', icon: 'undo', keys: ['mod+z'], run: undo },
    { id: 'redo', title: 'Redo', group: 'Edit', icon: 'redo', keys: ['shift+mod+z', 'mod+y'], run: redo },
    { id: 'cut', title: 'Cut', group: 'Edit', icon: 'scissors', keys: ['mod+x'], when: hasSel, run: cutSelected },
    { id: 'copy', title: 'Copy', group: 'Edit', icon: 'copy', keys: ['mod+c'], when: hasSel, run: copySelected },
    { id: 'paste', title: 'Paste', group: 'Edit', icon: 'copy', keys: ['mod+v'], run: () => void paste() },
    { id: 'duplicate', title: 'Duplicate', group: 'Edit', icon: 'duplicate', keys: ['mod+d'], when: hasSel, run: () => duplicateSelected() },
    { id: 'delete', title: 'Delete', group: 'Edit', icon: 'trash', keys: ['backspace', 'delete'], when: hasSel, run: removeSelected },
    { id: 'select-all', title: 'Select all', group: 'Edit', keys: ['mod+a'], run: selectAll },
    {
      id: 'deselect',
      title: 'Deselect / leave editing',
      group: 'Edit',
      keys: ['escape'],
      run: () => {
        const s = store.get();
        if (s.editing?.kind === 'text') endTextEdit();
        else if (s.editing) store.set({ editing: null });
        else if (s.tool !== 'select') store.set({ tool: 'select' });
        else select([]);
      },
    },
    { id: 'select-parent', title: 'Select parent group', group: 'Edit', keys: ['shift+enter'], hidden: true, when: hasSel, run: () => selectParent() },
    { id: 'copy-style', title: 'Copy style', group: 'Edit', icon: 'droplet', keys: ['alt+mod+c'], when: hasSel, run: copyStyle },
    { id: 'paste-style', title: 'Paste style', group: 'Edit', icon: 'droplet', keys: ['alt+mod+v'], when: hasSel, run: pasteStyle },
    { id: 'copy-motion', title: 'Copy motion', group: 'Edit', icon: 'motion', keys: ['alt+shift+mod+c'], keywords: 'animation entrance loop stagger', when: hasSel, run: copyMotion },
    { id: 'paste-motion', title: 'Paste motion', group: 'Edit', icon: 'motion', keys: ['alt+shift+mod+v'], keywords: 'animation entrance loop stagger', when: hasSel, run: pasteMotion },
    { id: 'next-layer', title: 'Select next layer', group: 'Edit', keys: ['tab'], hidden: true, run: () => cycle(1) },
    { id: 'prev-layer', title: 'Select previous layer', group: 'Edit', keys: ['shift+tab'], hidden: true, run: () => cycle(-1) },
    // Tools
    { id: 'tool-select', title: 'Select tool', group: 'Tools', icon: 'select', keys: ['v'], run: () => store.set({ tool: 'select' }) },
    { id: 'tool-hand', title: 'Hand tool (pan)', group: 'Tools', icon: 'hand', keys: ['h'], run: () => store.set({ tool: 'hand' }) },
    // Add
    { id: 'tool-text', title: 'Text tool (click the canvas to type)', group: 'Tools', icon: 'text', keys: ['t'], keywords: 'type write words', run: () => store.set({ tool: 'text', editing: null }) },
    { id: 'construction', title: 'Draw construction (guides and anchor points)', group: 'Shape', icon: 'points', keywords: 'blueprint presentation logo grid guides anchors spec sheet', when: hasSel, run: () => void constructionSheet() },
    { id: 'tool-pen', title: 'Pen tool (points and curves, for logos and line icons)', group: 'Tools', icon: 'points', keys: ['p'], keywords: 'bezier vector path line curve draw logo icon', run: () => store.set({ tool: 'pen', editing: null }) },
    { id: 'tool-draw', title: 'Draw tool (pen, marker, pencil, highlighter)', group: 'Tools', icon: 'brush', keys: ['b'], keywords: 'brush pencil freehand scribble sketch marker paint', run: () => store.set({ tool: 'draw', editing: null }) },
    { id: 'brush-smaller', title: 'Smaller brush', group: 'Tools', icon: 'brush', keys: ['['], run: () => setSettings({ brushWidth: Math.max(1, Math.round(store.get().settings.brushWidth / 1.25)) }) },
    { id: 'brush-bigger', title: 'Bigger brush', group: 'Tools', icon: 'brush', keys: [']'], run: () => setSettings({ brushWidth: Math.min(200, Math.round(store.get().settings.brushWidth * 1.25 + 0.5)) }) },
    { id: 'add-text', title: 'Add text in the middle', group: 'Add', icon: 'text', keywords: 'type write words', run: () => startText() },
    { id: 'add-squircle', title: 'Add squircle', group: 'Add', icon: 'tile', keys: ['r'], run: () => addShape(symbolLayer('squircle')) },
    { id: 'add-circle', title: 'Add circle', group: 'Add', icon: 'shapes', keys: ['o'], run: () => addShape(symbolLayer('circle')) },
    ...(Object.keys(SYMBOL_UI) as SymbolKind[]).map(
      (k): Command => ({ id: `add-${k}`, title: `Add ${SYMBOL_UI[k].label.toLowerCase()}`, group: 'Add', icon: 'shapes', keywords: `shape symbol ${SYMBOL_UI[k].group}`, run: () => addShape(symbolLayer(k)) }),
    ),
    { id: 'add-face', title: 'Add a face (eyes and a smile) to the selection', group: 'Add', icon: 'sparkle', keywords: 'eyes smile mascot character cute emoji', when: hasSel, run: () => primaryNode() && addFace(primaryNode()!.id) },
    { id: 'add-centre-dot', title: 'Add a centre dot to the selection', group: 'Add', icon: 'plus', keywords: 'flower middle center dot boss badge', when: hasSel, run: () => primaryNode() && addCentreDot(primaryNode()!.id) },
    { id: 'tile-sheet', title: 'Arrange as a sheet of coloured tiles', group: 'Arrange', icon: 'grid', keywords: 'grid tiles sticker sheet layout colour blocks', run: tileSheet },
    // Object
    { id: 'new-layer', title: 'New empty layer', group: 'Arrange', icon: 'plus', keys: ['shift+mod+n'], keywords: 'blank transparent layer folder draw into', when: () => store.get().mode === 'design', run: addEmptyLayer },
    { id: 'group', title: 'Group', group: 'Arrange', icon: 'group', keys: ['mod+g'], when: hasSel, run: () => groupSelected(false) },
    { id: 'merge', title: 'Merge into one shape', group: 'Arrange', icon: 'merge', keys: ['shift+mod+m'], keywords: 'union boolean combine weld', when: hasSel, run: () => groupSelected(true) },
    { id: 'ungroup', title: 'Ungroup', group: 'Arrange', icon: 'ungroup', keys: ['shift+mod+g'], when: () => selectedNodes().some(isGroup), run: ungroupSelected },
    { id: 'forward', title: 'Bring forward', group: 'Arrange', keys: ['mod+]'], when: hasSel, run: () => arrangeSelected('forward') },
    { id: 'backward', title: 'Send backward', group: 'Arrange', keys: ['mod+['], when: hasSel, run: () => arrangeSelected('backward') },
    { id: 'front', title: 'Bring to front', group: 'Arrange', keys: ['alt+mod+]'], when: hasSel, run: () => arrangeSelected('front') },
    { id: 'back', title: 'Send to back', group: 'Arrange', keys: ['alt+mod+['], when: hasSel, run: () => arrangeSelected('back') },
    { id: 'align-left', title: 'Align left', group: 'Align', icon: 'alignLeft', keys: ['alt+a'], when: hasSel, run: () => alignSelected('left') },
    { id: 'align-hcenter', title: 'Align horizontal centres', group: 'Align', icon: 'alignHCenter', keys: ['alt+h'], when: hasSel, run: () => alignSelected('hcenter') },
    { id: 'align-right', title: 'Align right', group: 'Align', icon: 'alignRight', keys: ['alt+d'], when: hasSel, run: () => alignSelected('right') },
    { id: 'align-top', title: 'Align top', group: 'Align', icon: 'alignTop', keys: ['alt+w'], when: hasSel, run: () => alignSelected('top') },
    { id: 'align-vcenter', title: 'Align vertical centres', group: 'Align', icon: 'alignVCenter', keys: ['alt+v'], when: hasSel, run: () => alignSelected('vcenter') },
    { id: 'align-bottom', title: 'Align bottom', group: 'Align', icon: 'alignBottom', keys: ['alt+s'], when: hasSel, run: () => alignSelected('bottom') },
    { id: 'distribute-h', title: 'Distribute horizontally', group: 'Align', icon: 'distributeH', keys: ['shift+alt+h'], when: hasSel, run: () => distributeSelected('x') },
    { id: 'distribute-v', title: 'Distribute vertically', group: 'Align', icon: 'distributeV', keys: ['shift+alt+v'], when: hasSel, run: () => distributeSelected('y') },
    { id: 'flip-h', title: 'Flip horizontal', group: 'Arrange', icon: 'flipH', keys: ['shift+h'], when: hasSel, run: () => flipSelected('x') },
    { id: 'flip-v', title: 'Flip vertical', group: 'Arrange', icon: 'flipV', keys: ['shift+v'], when: hasSel, run: () => flipSelected('y') },
    { id: 'lock', title: 'Lock / unlock', group: 'Arrange', icon: 'lock', keys: ['shift+mod+l'], when: hasSel, run: () => toggleLocked() },
    { id: 'hide', title: 'Hide / show', group: 'Arrange', icon: 'eye', keys: ['shift+mod+h'], when: hasSel, run: () => toggleVisible() },
    { id: 'outline', title: 'Convert to outline', group: 'Shape', icon: 'outline', keys: ['alt+mod+o'], keywords: 'bake path flatten', when: () => !!primaryShape(), run: () => void convertToOutline(primaryShape()!.id) },
    { id: 'break', title: 'Break apart into letters / pieces', group: 'Shape', icon: 'scissors', keys: ['shift+mod+b'], keywords: 'split separate release compound', when: () => !!primaryShape(), run: () => void breakApart(primaryShape()!.id) },
    { id: 'points', title: 'Edit points', group: 'Shape', icon: 'points', keys: ['shift+p'], keywords: 'nodes bezier pen vector', when: () => !!primaryShape() && design(), run: () => void editPoints(primaryShape()!.id) },
    { id: 'enter', title: 'Edit text, enter group or edit points', group: 'Edit', keys: ['enter'], hidden: true, when: () => (store.get().selection.length > 0 || store.get().tool === 'text') && design(), run: () => enter() },
    {
      id: 'add-warp',
      title: 'Warp (envelope)',
      group: 'Shape',
      icon: 'warp',
      keys: ['w'],
      keywords: 'bend arch flag bulge distort envelope',
      when: () => !!primaryShape(),
      run: () => {
        const l = primaryShape()!;
        const existing = l.modifiers.find((m) => m.kind === 'warp');
        if (existing) store.set({ editing: { kind: 'warp', id: l.id, uid: existing.uid } });
        else {
          const m = newModifier('warp');
          updateNode(l.id, (n) => !isGroup(n) && n.modifiers.push(m));
          store.set({ editing: { kind: 'warp', id: l.id, uid: m.uid }, tab: 'design' });
        }
      },
    },
    // Nudge (hidden: shown in help instead)
    ...(['left', 'right', 'up', 'down'] as const).flatMap((dir): Command[] => {
      const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
      const key = `arrow${dir}`;
      return [
        { id: `nudge-${dir}`, title: `Nudge ${dir}`, group: 'Edit', keys: [key], hidden: true, when: hasSel, run: () => nudge(v[0] * store.get().settings.nudge, v[1] * store.get().settings.nudge) },
        { id: `nudge-big-${dir}`, title: `Big nudge ${dir}`, group: 'Edit', keys: [`shift+${key}`], hidden: true, when: hasSel, run: () => nudge(v[0] * store.get().settings.bigNudge, v[1] * store.get().settings.bigNudge) },
      ];
    }),
    // View
    { id: 'fit', title: 'Zoom to fit', group: 'View', icon: 'fit', keys: ['mod+0', 'shift+1'], run: () => fire('mt-fit') },
    { id: 'zoom-100', title: 'Zoom to 100%', group: 'View', keys: ['shift+0'], run: () => fire('mt-zoom', { to: 1 }) },
    { id: 'zoom-in', title: 'Zoom in', group: 'View', icon: 'zoomIn', keys: ['mod+=', 'mod++'], run: () => fire('mt-zoom', { by: 1.25 }) },
    { id: 'zoom-out', title: 'Zoom out', group: 'View', icon: 'zoomOut', keys: ['mod+-'], run: () => fire('mt-zoom', { by: 0.8 }) },
    { id: 'zoom-sel', title: 'Zoom to selection', group: 'View', keys: ['shift+2'], when: hasSel, run: () => fire('mt-zoom', { selection: true }) },
    { id: 'grid', title: 'Show / hide grid', group: 'View', icon: 'grid', keys: ["mod+'"], run: () => setSettings({ grid: !store.get().settings.grid }) },
    {
      id: 'snap-grid',
      title: 'Snap to grid',
      group: 'View',
      icon: 'grid',
      keys: ["shift+mod+'"],
      run: () => {
        const on = !store.get().settings.snapGrid;
        // Snapping to an invisible grid is confusing, so turning it on shows the grid.
        setSettings(on ? { snapGrid: true, grid: true } : { snapGrid: false });
        toast(on ? `Snapping to a ${store.get().settings.gridSize} px grid` : 'Grid snapping off');
      },
    },
    { id: 'snap', title: 'Snapping on / off', group: 'View', icon: 'magnet', keys: ['mod+;'], run: () => setSettings({ snap: !store.get().settings.snap }) },
    { id: 'advanced', title: 'Simple / advanced controls', group: 'View', icon: 'settings', keys: ['mod+\\'], keywords: 'expert pro', run: () => setSettings({ advanced: !store.get().settings.advanced }) },
    { id: 'mode-design', title: 'Design mode', group: 'View', icon: 'design', keys: ['mod+1'], keywords: 'logo canvas', run: () => store.set({ mode: 'design', editing: null }) },
    { id: 'mode-type', title: 'Type mode (make a font)', group: 'View', icon: 'type', keys: ['mod+2'], keywords: 'font glyph editor alphabet', run: () => store.set({ mode: 'type', editing: null }) },
    { id: 'canvas', title: 'Canvas size and background…', group: 'View', icon: 'canvas', keywords: 'artboard instagram youtube thumbnail size background', run: () => (select([]), store.set({ tab: 'design' })) },
    // Help
    { id: 'palette', title: 'Search commands', group: 'Help', icon: 'search', keys: ['mod+k', 'mod+p', 'mod+/'], hidden: true, run: () => store.set({ dialog: { kind: 'palette' } }) },
    { id: 'settings', title: 'Settings…', group: 'Help', icon: 'settings', keys: ['mod+,'], keywords: 'preferences options', run: () => store.set({ dialog: { kind: 'settings' } }) },
    { id: 'type-basics', title: 'Type basics: parts of a letter, spacing, naming', group: 'Help', icon: 'type', keywords: 'typography cap height x-height baseline kerning tutorial learn font', run: () => store.set({ dialog: { kind: 'typeGuide' } }) },
    { id: 'help', title: 'How to use Morphotype and shortcuts', group: 'Help', icon: 'help', keys: ['?', 'shift+/'], keywords: 'guide keyboard tutorial', run: () => store.set({ dialog: { kind: 'help' } }) },
  ];
  // Style presets and canvas sizes are searchable too.
  for (const p of PRESETS) list.push({ id: `preset-${p.name}`, title: `Style: ${p.name}`, group: 'Style', icon: 'sparkle', keywords: `${p.effect} ${p.tags ?? ''} preset look`, when: hasSel, run: () => applyPreset(p) });
  for (const c of CANVAS_PRESETS)
    list.push({
      id: `canvas-${c.label}`,
      title: `Canvas: ${c.label} (${c.w} × ${c.h})`,
      group: 'Canvas',
      icon: 'canvas',
      keywords: `${c.group} ${c.keywords ?? ''} size artboard format`,
      run: () => {
        edit((p) => (p.canvas = { width: c.w, height: c.h }));
        fire('mt-fit');
      },
    });
  return list;
}

function cycle(dir: 1 | -1) {
  const s = store.get();
  const f = s.selection.at(-1);
  const p = s.project.layers;
  // Cycle among siblings of the current selection (or the top level).
  const sibs = (() => {
    if (!f) return p;
    const walkFind = (list: typeof p): typeof p | null => {
      for (const n of list) {
        if (n.id === f) return list;
        if (isGroup(n)) {
          const r = walkFind(n.children);
          if (r) return r;
        }
      }
      return null;
    };
    return walkFind(p) ?? p;
  })();
  if (!sibs.length) return;
  const i = f ? sibs.findIndex((n) => n.id === f) : -1;
  // Top of the stack first, like the layers panel.
  const next = sibs[(i - dir + sibs.length) % sibs.length] ?? sibs.at(-1)!;
  select([next.id]);
}

/** Shift+Enter: select the group around the selection. */
function selectParent() {
  const s = store.get();
  const id = s.selection.at(-1);
  const parent = id ? [...ancestors(s.project.layers, id)].at(-1) : undefined;
  if (parent) select([parent.id]);
}

/** Enter: edit the text, step into a group, or edit points. */
function enter() {
  if (store.get().tool === 'text') {
    startText();
    return;
  }
  const n = primaryNode();
  if (!n) return;
  if (isGroup(n)) {
    if (n.children.length) select([n.children.at(-1)!.id]);
    return;
  }
  if (n.content.type === 'text') {
    editText(n.id, undefined, true);
    return;
  }
  void editPoints(n.id);
}

export function matchKey(e: KeyboardEvent): string {
  if (e.key === '?') return '?';
  const parts: string[] = [];
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  // Physical keys for letters and digits, so ⌥ and ⇧ don't change them.
  const k = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.code.startsWith('Digit') ? e.code.slice(5) : e.key === ' ' ? 'space' : e.key.toLowerCase();
  parts.push(k);
  return parts.join('+');
}

/** Human label for a combo, e.g. "shift+mod+g" → "⇧⌘G". */
export function keyLabel(combo: string): string {
  const mac = platform().isMac;
  return combo
    .split('+')
    .map((p, i, a) => {
      if (p === '' && i === a.length - 1) return '+';
      switch (p) {
        case 'mod':
          return mac ? '⌘' : 'Ctrl+';
        case 'shift':
          return '⇧';
        case 'alt':
          return mac ? '⌥' : 'Alt+';
        case 'arrowleft':
          return '←';
        case 'arrowright':
          return '→';
        case 'arrowup':
          return '↑';
        case 'arrowdown':
          return '↓';
        case 'backspace':
          return '⌫';
        case 'delete':
          return '⌦';
        case 'escape':
          return 'Esc';
        case 'enter':
          return '↵';
        case 'tab':
          return 'Tab';
        default:
          return p.length === 1 ? p.toUpperCase() : p;
      }
    })
    .join('');
}

let cached: Command[] | null = null;
export function allCommands(): Command[] {
  return (cached ??= commands());
}

export function commandById(id: string) {
  return allCommands().find((c) => c.id === id);
}

export function shortcutOf(id: string): string | undefined {
  const k = commandById(id)?.keys?.[0];
  return k ? keyLabel(k) : undefined;
}

export function run(id: string) {
  const c = commandById(id);
  if (c && (!c.when || c.when())) c.run();
}
