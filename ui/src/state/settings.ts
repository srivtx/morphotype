// User preferences, persisted per device. The schema doubles as the source
// for the searchable settings dialog.

export interface Settings {
  snap: boolean;
  snapArtboard: boolean;
  snapObjects: boolean;
  snapGrid: boolean;
  grid: boolean;
  gridSize: number;
  nudge: number;
  bigNudge: number;
  hoverOutlines: boolean;
  advanced: boolean;
  checker: boolean;
  pngScale: number;
  exportTransparent: boolean;
  previewQuality: 'fast' | 'balanced' | 'sharp';
  reduceMotion: boolean;
  confirmConvert: boolean;
  /** Corner handles keep proportions without ⇧ (⇧ then stretches). */
  keepRatio: boolean;
  /** Preview the iOS / Android corner mask over the artboard. */
  iconMask: boolean;
  /** Seen the first-run welcome. */
  welcomed: boolean;
  /** Seen the Type mode tour. */
  typeTour: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  snap: true,
  snapArtboard: true,
  snapObjects: true,
  snapGrid: false,
  grid: false,
  gridSize: 20,
  nudge: 1,
  bigNudge: 10,
  hoverOutlines: true,
  advanced: false,
  checker: true,
  pngScale: 2,
  exportTransparent: false,
  previewQuality: 'balanced',
  reduceMotion: false,
  confirmConvert: true,
  keepRatio: false,
  iconMask: false,
  welcomed: false,
  typeTour: false,
};

export type SettingDef =
  | { key: keyof Settings; type: 'toggle'; label: string; hint: string; section: string; keywords?: string }
  | { key: keyof Settings; type: 'number'; label: string; hint: string; section: string; min: number; max: number; step: number; suffix?: string; keywords?: string }
  | { key: keyof Settings; type: 'choice'; label: string; hint: string; section: string; options: { value: string | number; label: string }[]; keywords?: string };

export const SETTING_DEFS: SettingDef[] = [
  { key: 'snap', type: 'toggle', section: 'Canvas', label: 'Snapping', hint: 'Snap while moving layers. Hold ⌘ while dragging to skip it once.', keywords: 'magnet align guides' },
  { key: 'snapArtboard', type: 'toggle', section: 'Canvas', label: 'Snap to artboard', hint: 'Edges and centre lines of the artboard.', keywords: 'center middle edge' },
  { key: 'snapObjects', type: 'toggle', section: 'Canvas', label: 'Snap to other layers', hint: 'Edges and centres of other layers.', keywords: 'smart guides objects' },
  { key: 'snapGrid', type: 'toggle', section: 'Canvas', label: 'Snap to grid', hint: 'Round positions to the grid size.', keywords: 'pixel grid' },
  { key: 'grid', type: 'toggle', section: 'Canvas', label: 'Show grid', hint: 'Draw a layout grid over the artboard.', keywords: 'lines overlay' },
  { key: 'gridSize', type: 'number', section: 'Canvas', label: 'Grid size', hint: 'Spacing of the grid, in artboard pixels.', min: 2, max: 400, step: 1, suffix: 'px' },
  { key: 'hoverOutlines', type: 'toggle', section: 'Canvas', label: 'Hover outlines', hint: 'Outline layers under the pointer.', keywords: 'highlight' },
  { key: 'checker', type: 'toggle', section: 'Canvas', label: 'Checkerboard for transparency', hint: 'Show a checkerboard where the background is empty.', keywords: 'transparent alpha' },
  { key: 'nudge', type: 'number', section: 'Keyboard', label: 'Nudge distance', hint: 'Arrow keys move the selection by this much.', min: 0.1, max: 100, step: 0.1, suffix: 'px', keywords: 'arrow move' },
  { key: 'bigNudge', type: 'number', section: 'Keyboard', label: 'Big nudge distance', hint: '⇧ + arrow keys move by this much.', min: 1, max: 500, step: 1, suffix: 'px', keywords: 'shift arrow move' },
  { key: 'advanced', type: 'toggle', section: 'Editing', label: 'Advanced controls', hint: 'Show every parameter (seeds, phases, raw numbers) instead of just the essentials.', keywords: 'simple expert pro' },
  { key: 'keepRatio', type: 'toggle', section: 'Editing', label: 'Corners keep proportions', hint: 'Off (like Figma): hold ⇧ while dragging a corner to keep proportions. On: corners keep proportions and ⇧ stretches. Text always scales evenly from corners.', keywords: 'resize scale shift aspect ratio uniform' },
  { key: 'confirmConvert', type: 'toggle', section: 'Editing', label: 'Ask before converting to outlines', hint: 'Editing the points of text or a shape turns it into an outline first.', keywords: 'bake points nodes' },
  { key: 'previewQuality', type: 'choice', section: 'Performance', label: 'Preview quality', hint: 'Sharper previews cost more GPU time on large artboards.', options: [{ value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'sharp', label: 'Sharp' }], keywords: 'resolution speed gpu' },
  { key: 'reduceMotion', type: 'toggle', section: 'Performance', label: 'Pause animated effects', hint: 'Stop animated chrome and neon flicker in the preview.', keywords: 'animation battery' },
  { key: 'pngScale', type: 'choice', section: 'Export', label: 'Default PNG size', hint: 'Used by ⌘E.', options: [{ value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 4, label: '4×' }], keywords: 'resolution retina' },
  { key: 'exportTransparent', type: 'toggle', section: 'Export', label: 'Transparent PNG background', hint: 'Leave the background out of PNG exports.', keywords: 'alpha' },
];

const KEY = 'morphotype.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage can be unavailable (private mode); defaults are fine.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal.
  }
}
