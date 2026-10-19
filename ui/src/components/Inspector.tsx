import { useRef, useState } from 'react';
import { addIconGrid, alignSelected, distributeSelected, editPoints, editWarp, flipSelected, nodeBox, primaryNode, selectedNodes, setBackground, styleOf, unionBox, updateNode } from '../app/actions';
import { run, shortcutOf } from '../app/commands';
import type { Content, ModEntry, ModifierKind, SymbolKind } from '../engine/types';
import { backgroundCss, fillCss } from '../render/background';
import { effectById } from '../render/effects';
import { luminance, QUICK_COLORS, recolor } from '../render/palette';
import { useShape, viewBoxOf } from '../render/thumbs';
import { CANVAS_PRESETS, fieldShown, isChoice, isGroup, nodeLabel, MODIFIER_UI, newModifier, style, SYMBOL_DEFAULTS, SYMBOL_UI, pattern, stroke, symbolLayer, tile, uid, type BlendMode, type Depth, depth, type Stroke, type StrokeAlign, type Fill, type FillKind, type Pattern, type PatternKind, type Group, type Node, type ShapeLayer, type Style } from '../state/model';
import { BG_PRESETS, lookOf, SHAPE_RECIPES, type Recipe } from '../state/recipes';
import { edit, select, setSettings, store, toast, undo, useStore } from '../state/store';
import { applyIconTarget, ICON_TARGETS, iconTarget, type IconTarget } from '../state/icon';
import { allLayers, findNode } from '../state/tree';
import { ColorChip, ColorField } from './ColorPicker';
import { FontPicker } from './FontPicker';
import { Icon } from './icons';
import { EffectThumb } from './StylePanel';
import { ModifierPicker, ShapePicker } from './pickers';
import { IconButton, Menu, MenuItem, MenuSep, NumberBox, Popover, Section, Segmented, Select, Slider, Toggle } from './ui';

type Of<T extends Content['type']> = Extract<Content, { type: T }>;

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const nodes = selection.map((id) => findNode(project.layers, id)).filter((n): n is Node => !!n);
  if (!nodes.length) return <CanvasPanel />;
  const primary = nodes.at(-1)!;
  return (
    <div className="inspector">
      <SelectionHeader nodes={nodes} />
      <AlignBar count={nodes.length} />
      <Appearance nodes={nodes} />
      <TransformSection nodes={nodes} />
      {nodes.length === 1 && <NodeEditor node={primary} />}
      {nodes.length > 1 && (
        <Section title="Selection" id="multi">
          <p className="hint">{nodes.length} layers selected. Styles from the Style tab apply to all of them.</p>
          <div className="button-row">
            <button className="btn" onClick={() => run('group')}>
              <Icon name="group" /> Group
            </button>
            <button className="btn" onClick={() => run('merge')}>
              <Icon name="merge" /> Merge
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

function SelectionHeader({ nodes }: { nodes: Node[] }) {
  const n = nodes.at(-1)!;
  const kind = nodes.length > 1 ? `${nodes.length} layers` : isGroup(n) ? (n.merge ? 'Merged shape' : 'Group') : { text: 'Text', symbol: 'Shape', path: 'Outline', morph: 'Morph', stroke: 'Drawing', line: 'Line' }[n.content.type];
  return (
    <div className="sel-header">
      <span className="sel-kind">{kind}</span>
      {nodes.length === 1 && (
        <label className="sel-name-wrap" data-tip="Layer name: how it's listed in Layers. It doesn't change the text itself.">
          <input
            className="sel-name"
            value={n.name ?? ''}
            placeholder={!isGroup(n) && n.content.type === 'text' ? 'Layer name (optional)' : nodeLabel(n)}
            aria-label="Layer name"
            onChange={(e) => updateNode(n.id, (x) => (x.name = e.target.value || undefined), 'name')}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
      )}
      <Menu buttonClass="icon-btn" label={<Icon name="more" />} title="More" placement="bottom-end" width={260}>
        {(close) => (
          <div className="menu-list">
            {['duplicate', 'group', 'merge', 'ungroup', 'outline', 'break', 'copy-style', 'paste-style', 'lock', 'hide', 'delete'].map((id) => (
              <MenuItem key={id} icon={id === 'delete' ? 'trash' : undefined} label={labelOf(id)} kbd={shortcutOf(id)} danger={id === 'delete'} onClick={() => (close(), run(id))} />
            ))}
          </div>
        )}
      </Menu>
    </div>
  );
}

function labelOf(id: string) {
  return (
    {
      duplicate: 'Duplicate',
      group: 'Group',
      merge: 'Merge into one shape',
      ungroup: 'Ungroup',
      outline: 'Convert to outline',
      break: 'Break apart',
      'copy-style': 'Copy style',
      'paste-style': 'Paste style',
      lock: 'Lock / unlock',
      hide: 'Hide / show',
      delete: 'Delete',
    } as Record<string, string>
  )[id];
}

function AlignBar({ count }: { count: number }) {
  const tip = count === 1 ? ' to artboard' : '';
  return (
    <div className="align-bar" role="toolbar" aria-label="Align">
      <IconButton icon="alignLeft" title={`Align left${tip}`} kbd={shortcutOf('align-left')} onClick={() => alignSelected('left')} />
      <IconButton icon="alignHCenter" title={`Align centre${tip}`} kbd={shortcutOf('align-hcenter')} onClick={() => alignSelected('hcenter')} />
      <IconButton icon="alignRight" title={`Align right${tip}`} kbd={shortcutOf('align-right')} onClick={() => alignSelected('right')} />
      <span className="dock-sep" />
      <IconButton icon="alignTop" title={`Align top${tip}`} kbd={shortcutOf('align-top')} onClick={() => alignSelected('top')} />
      <IconButton icon="alignVCenter" title={`Align middle${tip}`} kbd={shortcutOf('align-vcenter')} onClick={() => alignSelected('vcenter')} />
      <IconButton icon="alignBottom" title={`Align bottom${tip}`} kbd={shortcutOf('align-bottom')} onClick={() => alignSelected('bottom')} />
      <span className="dock-sep" />
      <IconButton icon="distributeH" title="Distribute horizontally" kbd={shortcutOf('distribute-h')} disabled={count < 3} onClick={() => distributeSelected('x')} />
      <IconButton icon="distributeV" title="Distribute vertically" kbd={shortcutOf('distribute-v')} disabled={count < 3} onClick={() => distributeSelected('y')} />
      <span className="dock-sep" />
      <IconButton icon="flipH" title="Flip horizontal" kbd={shortcutOf('flip-h')} onClick={() => flipSelected('x')} />
      <IconButton icon="flipV" title="Flip vertical" kbd={shortcutOf('flip-v')} onClick={() => flipSelected('y')} />
    </div>
  );
}

/** Colour params worth showing up front (hide ones whose feature is off). */
function shownColors(st: Style) {
  const def = effectById(st.effect);
  const off = (k: string) => {
    const twin: Record<string, string> = { fill2: 'gradient', border: 'borderWidth', line: 'lineWidth', outlineColor: 'outline' };
    const t = twin[k];
    return t !== undefined && Number(st.params[t] ?? 0) <= 0;
  };
  return def.params.filter((p) => p.type === 'color' && !p.advanced && !off(p.key)).slice(0, 4);
}

/** Material and colour, right where you select: the most common edits. */
function Appearance({ nodes }: { nodes: Node[] }) {
  const owners = nodes.filter((n) => !isGroup(n) || n.merge);
  const plainGroup = nodes.length === 1 && isGroup(nodes[0]) && !nodes[0].merge;
  if (plainGroup) return null;
  if (!owners.length) return null;
  const st = styleOf(owners.at(-1)!)!;
  const def = effectById(st.effect);
  const clipOnly = owners.every((n) => n.op !== 'add');
  const colors = shownColors(st);
  const ids = owners.map((n) => n.id);
  const setParam = (k: string, v: string) =>
    edit((p) => {
      for (const id of ids) {
        const n = findNode(p.layers, id);
        if (n && n.style.effect === st.effect) n.style.params[k] = v;
      }
    }, `ap:${ids.join()}:${k}`);
  const recolorAll = (hex: string) =>
    edit((p) => {
      for (const id of ids) {
        const n = findNode(p.layers, id);
        if (n) n.style = recolor(n.style, hex);
      }
    }, `ap:${ids.join()}:recolor`);
  if (clipOnly) return null;
  return (
    <Section title="Appearance" id="appearance">
      <div className="appearance">
        <button className="material-chip" onClick={() => store.set({ tab: 'style' })} data-tip="Change the material and its settings in the Style tab">
          <span className="material-thumb">
            <EffectThumb id={st.effect} />
          </span>
          <span className="material-name">{def.name}</span>
          <Icon name="chevronRight" size={12} />
        </button>
        <div className="appearance-colors">
          {colors.map((c) => (
            <ColorChip key={c.key} label={c.label} value={String(st.params[c.key] ?? c.default)} onChange={(v) => setParam(c.key, v)} />
          ))}
        </div>
      </div>
      <div className="quick-colors" role="group" aria-label="Recolour">
        {QUICK_COLORS.map((c) => (
          <button key={c} className="quick-color" style={{ background: c }} aria-label={`Recolour ${c}`} data-tip={colors.length > 1 ? 'Recolour the whole material from this colour' : c} onClick={() => recolorAll(c)} />
        ))}
      </div>
      <div className={`appearance-adds ${st.stroke || st.depth ? 'stacked' : ''}`}>
        <StrokeEditor ids={ids} value={st.stroke ?? null} />
        <DepthEditor ids={ids} value={st.depth ?? null} />
      </div>
      <div className="blend-row">
        <Slider label="Soften" value={st.soften ?? 0} min={0} max={120} step={0.5} suffix="px" reset={0} onChange={(v) => edit((p) => ids.forEach((id) => { const n = findNode(p.layers, id); if (n) n.style.soften = v || undefined; }), `soft:${ids.join()}`)} />
        <Slider label="Opacity" value={st.opacity ?? 1} min={0} max={1} step={0.01} reset={1} onChange={(v) => edit((p) => ids.forEach((id) => { const n = findNode(p.layers, id); if (n) n.style.opacity = v; }), `op:${ids.join()}`)} />
        <div className="field">
          <span>Blend</span>
          <Segmented
            size="sm"
            value={st.blend ?? 'normal'}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'multiply', label: 'Multiply', title: 'Darkens like overprinted ink: risograph, highlighter, shadows' },
              { value: 'screen', label: 'Screen', title: 'Lightens like projected light: glows and light leaks' },
            ]}
            onChange={(v) => edit((p) => ids.forEach((id) => { const n = findNode(p.layers, id); if (n) n.style.blend = v as BlendMode; }))}
          />
        </div>
      </div>
    </Section>
  );
}

const ALIGNS: { value: StrokeAlign; label: string; title: string }[] = [
  { value: 'outside', label: 'Outside', title: 'Around the shape; keeps the shape its size' },
  { value: 'center', label: 'Centre', title: 'Half inside, half outside, like most vector tools' },
  { value: 'inside', label: 'Inside', title: 'Inside the edge; never grows the shape' },
];

/** A line around the outline, for any material. */
function StrokeEditor({ ids, value }: { ids: string[]; value: Stroke | null }) {
  const set = (fn: (s: Style) => void, key = '') =>
    edit((p) => {
      for (const id of ids) {
        const n = findNode(p.layers, id);
        if (n) fn(n.style);
      }
    }, key && `stroke:${ids.join()}:${key}`);
  if (!value)
    return (
      <button className="link-btn stroke-add" onClick={() => set((s) => (s.stroke = stroke()))} data-tip="Draw a line around the shape, over any material">
        <Icon name="plus" size={12} /> Add stroke
      </button>
    );
  return (
    <div className="stroke-editor">
      <div className="stroke-head">
        <span>Stroke</span>
        <ColorChip label="Stroke colour" value={value.color} onChange={(v) => set((s) => s.stroke && (s.stroke.color = v), 'c')} />
        <NumberBox label="W" value={value.width} min={0} max={400} onChange={(v) => set((s) => s.stroke && (s.stroke.width = Math.max(0, v)), 'w')} />
        <IconButton icon="minus" title="Remove stroke" size={13} className="tiny" onClick={() => set((s) => (s.stroke = null))} />
      </div>
      <Segmented size="sm" value={value.align} options={ALIGNS.map((a) => ({ value: a.value, label: a.label, title: a.title }))} onChange={(v) => set((s) => s.stroke && (s.stroke.align = v))} />
      {value.opacity < 1 || value.width > 0 ? <Slider label="Opacity" value={value.opacity} min={0} max={1} step={0.01} reset={1} onChange={(v) => set((s) => s.stroke && (s.stroke.opacity = v), 'o')} /> : null}
    </div>
  );
}

/** Solid 3D sides behind the layer, for any material. */
function DepthEditor({ ids, value }: { ids: string[]; value: Depth | null }) {
  const set = (fn: (s: Style) => void, key = '') =>
    edit((p) => {
      for (const id of ids) {
        const n = findNode(p.layers, id);
        if (n) fn(n.style);
      }
    }, key && `depth:${ids.join()}:${key}`);
  if (!value)
    return (
      <button className="link-btn stroke-add" onClick={() => set((s) => (s.depth = depth()))} data-tip="Give the layer thick 3D sides, like letters cut from card">
        <Icon name="plus" size={12} /> Add depth
      </button>
    );
  return (
    <div className="stroke-editor">
      <div className="stroke-head">
        <span>Depth</span>
        <ColorChip label="Side colour" value={value.color} onChange={(v) => set((s) => s.depth && (s.depth.color = v), 'c')} />
        <NumberBox label="D" value={value.amount} min={0} max={400} title="How far the sides reach, in px" onChange={(v) => set((s) => s.depth && (s.depth.amount = Math.max(0, v)), 'a')} />
        <IconButton icon="minus" title="Remove depth" size={13} className="tiny" onClick={() => set((s) => (s.depth = null))} />
      </div>
      <Slider label="Direction" value={value.angle} min={0} max={360} step={1} suffix="°" reset={150} onChange={(v) => set((s) => s.depth && (s.depth.angle = v), 'ang')} />
      <Slider label="Shade" value={value.shade} min={0} max={1} step={0.01} reset={0.35} onChange={(v) => set((s) => s.depth && (s.depth.shade = v), 'sh')} />
    </div>
  );
}

function TransformSection({ nodes }: { nodes: Node[] }) {
  const build = useStore((s) => s.build);
  const [lockRatio, setLockRatio] = useState(true);
  const only = nodes.length === 1 && !isGroup(nodes[0]) ? (nodes[0] as ShapeLayer) : null;
  const local = only ? build?.layers.find((o) => o.id === only.id)?.local : null;
  const box = unionBox(nodes);
  if (!box && !only) return null;
  const ids = nodes.map((n) => n.id);
  const move = (dx: number, dy: number) =>
    edit((p) => {
      for (const id of ids) {
        const n = findNode(p.layers, id);
        if (n) for (const l of isGroup(n) ? allLayers(n.children) : [n]) (l.x += dx), (l.y += dy);
      }
    }, 'tf-move');
  if (only && local) {
    const lw = local[2] - local[0];
    const lh = local[3] - local[1];
    const w = Math.abs(lw * only.scale * (only.sx ?? 1));
    const h = Math.abs(lh * only.scale * (only.sy ?? 1));
    const setSize = (nw: number, nh: number) =>
      updateNode(only.id, (n) => {
        if (isGroup(n) || lw <= 0 || lh <= 0) return;
        const sgnX = Math.sign(n.sx ?? 1) || 1;
        const sgnY = Math.sign(n.sy ?? 1) || 1;
        n.sx = (sgnX * Math.max(1, nw)) / (lw * n.scale);
        n.sy = (sgnY * Math.max(1, nh)) / (lh * n.scale);
      }, 'tf-size');
    return (
      <Section title="Position and size" id="transform">
        <div className="grid2">
          <NumberBox label="X" value={only.x} onChange={(v) => updateNode(only.id, (n) => !isGroup(n) && (n.x = v), 'x')} title="Horizontal position of the layer origin (0 = artboard centre)" />
          <NumberBox label="Y" value={only.y} onChange={(v) => updateNode(only.id, (n) => !isGroup(n) && (n.y = v), 'y')} title="Vertical position (0 = artboard centre)" />
          <NumberBox label="W" value={w} min={1} onChange={(v) => setSize(v, lockRatio ? (v / (w || 1)) * h : h)} />
          <div className="with-lock">
            <NumberBox label="H" value={h} min={1} onChange={(v) => setSize(lockRatio ? (v / (h || 1)) * w : w, v)} />
            <IconButton icon={lockRatio ? 'lock' : 'unlock'} title={lockRatio ? 'Proportions locked' : 'Proportions free'} active={lockRatio} onClick={() => setLockRatio(!lockRatio)} size={13} className="tiny" />
          </div>
          <NumberBox label="↻" value={only.rotation} step={0.5} suffix="°" title="Rotation" onChange={(v) => updateNode(only.id, (n) => !isGroup(n) && (n.rotation = v), 'rot')} />
          <NumberBox label="%" value={only.scale * 100} step={1} min={1} title="Overall scale" onChange={(v) => updateNode(only.id, (n) => !isGroup(n) && (n.scale = Math.max(0.01, v / 100)), 'scale')} />
        </div>
        {(Math.abs((only.sx ?? 1) - 1) > 1e-3 || Math.abs((only.sy ?? 1) - 1) > 1e-3) && (
          <button className="link-btn" onClick={() => updateNode(only.id, (n) => !isGroup(n) && ((n.sx = Math.sign(n.sx ?? 1) || 1), (n.sy = Math.sign(n.sy ?? 1) || 1)))}>
            Reset stretch
          </button>
        )}
      </Section>
    );
  }
  if (!box) return null;
  const scaleAll = (f: number) => {
    const ax = box[0];
    const ay = box[1];
    edit((p) => {
      for (const id of ids) {
        const n = findNode(p.layers, id);
        if (!n) continue;
        for (const l of isGroup(n) ? allLayers(n.children) : [n]) {
          l.x = ax + (l.x - ax) * f;
          l.y = ay + (l.y - ay) * f;
          l.scale *= f;
        }
      }
    }, 'tf-scale');
  };
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  return (
    <Section title="Position and size" id="transform">
      <div className="grid2">
        <NumberBox label="X" value={box[0]} onChange={(v) => move(v - box[0], 0)} />
        <NumberBox label="Y" value={box[1]} onChange={(v) => move(0, v - box[1])} />
        <NumberBox label="W" value={w} min={1} onChange={(v) => scaleAll(v / (w || 1))} />
        <NumberBox label="H" value={h} min={1} onChange={(v) => scaleAll(v / (h || 1))} />
      </div>
    </Section>
  );
}

function NodeEditor({ node }: { node: Node }) {
  if (isGroup(node)) return <GroupEditor g={node} />;
  return <LayerEditor layer={node} />;
}

function BlendRow({ node }: { node: Node }) {
  return (
    <div className="field">
      <span>Blend</span>
      <Segmented
        size="sm"
        value={node.op}
        options={[
          { value: 'add', label: 'Normal', title: 'Draw this layer with its own style' },
          { value: 'subtract', label: 'Cut', title: 'Punch this shape out of the layer directly below it' },
          { value: 'intersect', label: 'Mask', title: 'Keep the layer below only where this overlaps it' },
        ]}
        onChange={(op) => updateNode(node.id, (n) => (n.op = op))}
      />
    </div>
  );
}

function GroupEditor({ g }: { g: Group }) {
  const set = (fn: (x: Group) => void, key = '') => updateNode(g.id, (n) => isGroup(n) && fn(n), key);
  return (
    <>
      <Section title="Group" id="group">
        <BlendRow node={g} />
        <Toggle
          label="Merge into one shape"
          hint="Fuse the children into a single outline with one style and shared modifiers, like a boolean union."
          checked={g.merge}
          onChange={(v) =>
            edit((p) => {
              const n = findNode(p.layers, g.id);
              if (!isGroup(n)) return;
              n.merge = v;
              // Carry the look across so the change isn't jarring.
              const first = allLayers(n.children)[0];
              if (v && first) n.style = structuredClone(first.style);
              if (!v) for (const l of allLayers(n.children)) l.style = structuredClone(n.style);
            })
          }
        />
        {!g.merge && (
          <Toggle
            label="Clip to the bottom layer"
            hint="Use the bottom layer as a frame: everything above it, glows and soft edges included, only shows inside its shape."
            checked={!!g.clip}
            onChange={(v) => set((x) => (x.clip = v || undefined))}
          />
        )}
        <p className="hint">{g.merge ? 'Children are fused. Use Cut on a child to punch holes.' : `${g.children.length} layers keep their own styles. Double-click on the canvas to select inside.`}</p>
        <div className="button-row">
          <button className="btn" onClick={() => run('ungroup')}>
            <Icon name="ungroup" /> Ungroup
          </button>
        </div>
      </Section>
      {g.merge && <Modifiers mods={g.modifiers} onChange={(fn, key) => set((x) => fn(x.modifiers), key)} owner={g.id} />}
    </>
  );
}

function LayerEditor({ layer }: { layer: ShapeLayer }) {
  const error = useStore((s) => s.build?.layers.find((l) => l.id === layer.id)?.error ?? null);
  const set = (fn: (l: ShapeLayer) => void, key = '') => updateNode(layer.id, (n) => !isGroup(n) && fn(n), key);
  return (
    <>
      {error && <div className="layer-error">{error}</div>}
      <ContentEditor layer={layer} set={set} />
      <Section title="Layer" id="blend" defaultOpen={layer.op !== 'add' || !!layer.guide}>
        <BlendRow node={layer} />
        <p className="hint">Cut and Mask apply to the layer directly beneath this one in the same group.</p>
        <Toggle label="Reference only" checked={!!layer.guide} onChange={(v) => set((l) => (l.guide = v || undefined))} hint="Shown while you design, left out of PNG, SVG and project previews: for pictures you trace over" />
      </Section>
      <QuickLooks layer={layer} />
      <Modifiers mods={layer.modifiers} owner={layer.id} layer={layer} onChange={(fn, key) => set((l) => fn(l.modifiers), key)} />
    </>
  );
}

function ContentEditor({ layer, set }: { layer: ShapeLayer; set: (fn: (l: ShapeLayer) => void, key?: string) => void }) {
  const c = layer.content;
  const setC = <T extends Content['type']>(fn: (c: Of<T>) => void, key = '') => set((l) => fn(l.content as Of<T>), key);
  switch (c.type) {
    case 'text':
      return <TextEditor c={c} setC={setC} />;
    case 'symbol':
      return <SymbolEditor c={c} setC={setC} />;
    case 'path':
      return (
        <Section title="Outline" id="path">
          <Slider label="Size" value={c.size} min={10} max={1600} step={1} onChange={(v) => setC<'path'>((x) => (x.size = v), 'size')} />
          <div className="button-row">
            <button className="btn" onClick={() => void editPoints(layer.id)}>
              <Icon name="points" /> Edit points
            </button>
            <button className="btn" onClick={() => run('break')}>
              <Icon name="scissors" /> Break apart
            </button>
          </div>
          <p className="hint">Double-click the shape (or press ⇧P) to edit its points. Break apart splits traced text into one layer per letter.</p>
        </Section>
      );
    case 'line':
      return (
        <Section title="Line" id="line">
          <Slider label="Width" value={c.width} min={0.5} max={300} step={0.5} suffix="px" onChange={(v) => setC<'line'>((x) => (x.width = v), 'lw')} />
          <div className="field">
            <span>Ends</span>
            <Segmented
              size="sm"
              value={c.cap}
              options={[
                { value: 'round', label: 'Round', title: 'Round ends, like a marker' },
                { value: 'butt', label: 'Flat', title: 'Cut square at the last point' },
                { value: 'square', label: 'Square', title: 'Square, half the width past the last point' },
              ]}
              onChange={(v) => setC<'line'>((x) => (x.cap = v))}
            />
          </div>
          <Slider label="Size" value={c.size} min={10} max={3000} step={1} onChange={(v) => setC<'line'>((x) => (x.size = v), 'ls')} />
          <button className="btn" onClick={() => void editPoints(layer.id)}>
            <Icon name="points" /> Edit points
          </button>
          <p className="hint">Drawn with the pen (P). Edit points to reshape it; Bake turns it into a filled outline.</p>
        </Section>
      );
    case 'morph':
      return <MorphLayerEditor c={c} self={layer.id} setC={setC} />;
    case 'stroke':
      return (
        <Section title="Drawing" id="stroke">
          <Slider label="Width" value={c.width} min={0.5} max={200} step={0.5} suffix="px" onChange={(v) => setC<'stroke'>((x) => (x.width = v), 'sw')} />
          <Slider label="Taper ends" value={c.taper} min={0} max={0.5} step={0.01} onChange={(v) => setC<'stroke'>((x) => (x.taper = v), 'st')} />
          <Slider label="Smoothing" value={c.smooth} min={0} max={1} step={0.01} onChange={(v) => setC<'stroke'>((x) => (x.smooth = v), 'ss')} />
          <p className="hint">Stays editable: change the width or smoothing any time, or add modifiers like Wobble, Echo lines or Repeat.</p>
        </Section>
      );
  }
}

function SymbolThumbSmall({ spec }: { spec: Of<'symbol'>['symbol'] }) {
  const shape = useShape(`symp:${JSON.stringify(spec)}`, () => ({
    layers: [{ id: 's', visible: true, op: 'add', x: 0, y: 0, rotation: 0, scale: 1, sx: 1, sy: 1, modifiers: [], content: { type: 'symbol', symbol: spec, size: 100 } }],
  }));
  return (
    <svg viewBox={shape ? viewBoxOf(shape.box, 0.12) : '-50 -50 100 100'} className="thumb-svg" aria-hidden>
      {shape && <path d={shape.d} />}
    </svg>
  );
}

function SymbolEditor({ c, setC }: { c: Of<'symbol'>; setC: <T extends Content['type']>(fn: (c: Of<T>) => void, key?: string) => void }) {
  const advanced = useStore((s) => s.settings.advanced);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const ui = SYMBOL_UI[c.symbol.kind];
  return (
    <Section title="Shape" id="symbol">
      <div className="field">
        <span>Shape</span>
        <button ref={btn} className={`select shape-select ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
          <SymbolThumbSmall spec={SYMBOL_DEFAULTS[c.symbol.kind]} />
          <span className="select-value">{ui.label}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      </div>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={340} placement="left-start">
          <ShapePicker
            onPick={(k: SymbolKind) => {
              setC<'symbol'>((x) => (x.symbol = { ...SYMBOL_DEFAULTS[k] }));
              setOpen(false);
            }}
          />
        </Popover>
      )}
      <Slider label="Size" value={c.size} min={10} max={1600} step={1} onChange={(v) => setC<'symbol'>((x) => (x.size = v), 'size')} />
      {ui.fields
        .filter((f) => advanced || !f.advanced)
        .map((f) => (
          <Slider
            key={f.key}
            label={f.label}
            min={f.min}
            max={f.max}
            step={f.step}
            value={Number((c.symbol as unknown as Record<string, number>)[f.key] ?? 0)}
            reset={Number((SYMBOL_DEFAULTS[c.symbol.kind] as unknown as Record<string, number>)[f.key])}
            onChange={(v) => setC<'symbol'>((x) => ((x.symbol as unknown as Record<string, number>)[f.key] = f.integer ? Math.round(v) : v), f.key)}
          />
        ))}
    </Section>
  );
}

function TextEditor({ c, setC }: { c: Of<'text'>; setC: <T extends Content['type']>(fn: (c: Of<T>) => void, key?: string) => void }) {
  const fonts = useStore((s) => s.fonts);
  const advanced = useStore((s) => s.settings.advanced);
  const info = fonts.find((f) => f.id === c.font)?.info;
  const morphInfo = c.morph ? fonts.find((f) => f.id === c.morph?.font)?.info : undefined;
  return (
    <>
      <Section title="Text" id="text">
        <textarea
          className="text-input"
          placeholder="Type your text…"
          data-tip="Or double-click the text on the canvas to type there"
          value={c.text}
          rows={Math.min(5, c.text.split('\n').length + 1)}
          spellCheck={false}
          onChange={(e) => setC<'text'>((x) => (x.text = e.target.value), 'text')}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          }}
        />
        <div className="field">
          <span>Font</span>
          <FontPicker value={c.font} onChange={(id) => id && setC<'text'>((x) => ((x.font = id), (x.axes = {})))} />
        </div>
        <Slider label="Size" value={c.size} min={8} max={800} step={1} onChange={(v) => setC<'text'>((x) => (x.size = v), 'size')} />
        <Slider label="Tracking" value={c.tracking} min={-0.3} max={1} step={0.005} reset={0} onChange={(v) => setC<'text'>((x) => (x.tracking = v), 'track')} />
        {(advanced || c.text.includes('\n')) && <Slider label="Leading" value={c.lineHeight} min={0.5} max={3} step={0.01} reset={1} onChange={(v) => setC<'text'>((x) => (x.lineHeight = v), 'lead')} />}
        <div className="field">
          <span>Align</span>
          <Segmented
            size="sm"
            value={c.align}
            options={[
              { value: 'left', icon: 'alignLeft', title: 'Left' },
              { value: 'center', icon: 'alignHCenter', title: 'Centre' },
              { value: 'right', icon: 'alignRight', title: 'Right' },
            ]}
            onChange={(a) => setC<'text'>((x) => (x.align = a))}
          />
        </div>
        {advanced && <Toggle label="Ligatures" checked={c.ligatures} onChange={(v) => setC<'text'>((x) => (x.ligatures = v))} />}
        {info?.axes.map((a) => (
          <Slider
            key={a.tag}
            label={a.name}
            min={a.min}
            max={a.max}
            step={(a.max - a.min) / 200}
            value={c.axes[a.tag] ?? a.default}
            reset={a.default}
            onChange={(v) => setC<'text'>((x) => (x.axes = { ...x.axes, [a.tag]: v }), `axis-${a.tag}`)}
          />
        ))}
      </Section>
      <Section title="Morph to another font" id="morph" defaultOpen={!!c.morph}>
        <div className="field">
          <span>Target</span>
          <FontPicker allowNone value={c.morph?.font ?? null} onChange={(id) => setC<'text'>((x) => (x.morph = id ? { font: id, t: x.morph?.t ?? 0.5, axes: {} } : null))} />
        </div>
        {c.morph ? (
          <>
            <Slider label="Blend" value={c.morph.t} min={0} max={1} step={0.005} onChange={(v) => setC<'text'>((x) => x.morph && (x.morph.t = v), 'morph-t')} />
            {morphInfo?.axes.map((a) => (
              <Slider
                key={a.tag}
                label={`Target ${a.name}`}
                min={a.min}
                max={a.max}
                step={(a.max - a.min) / 200}
                value={c.morph?.axes[a.tag] ?? a.default}
                reset={a.default}
                onChange={(v) => setC<'text'>((x) => x.morph && (x.morph.axes = { ...x.morph.axes, [a.tag]: v }), `maxis-${a.tag}`)}
              />
            ))}
          </>
        ) : (
          <p className="hint">Blend every letter into the same letter of another font.</p>
        )}
      </Section>
    </>
  );
}

function MorphLayerEditor({ c, self, setC }: { c: Of<'morph'>; self: string; setC: <T extends Content['type']>(fn: (c: Of<T>) => void, key?: string) => void }) {
  const layers = useStore((s) => s.project.layers);
  const others = allLayers(layers).filter((l) => l.id !== self && l.content.type !== 'morph');
  const opts = [{ value: '', label: 'Choose a layer…' }, ...others.map((l) => ({ value: l.id, label: nodeLabel(l) }))];
  return (
    <Section title="Morph between layers" id="morphlayer">
      <p className="hint">Blends the outlines of two layers. Hide the source layers to see only the morph.</p>
      <div className="field">
        <span>From</span>
        <Select value={c.a} options={opts} onChange={(v) => setC<'morph'>((x) => (x.a = v))} />
      </div>
      <div className="field">
        <span>To</span>
        <Select value={c.b} options={opts} onChange={(v) => setC<'morph'>((x) => (x.b = v))} />
      </div>
      <Slider label="Blend" value={c.t} min={0} max={1} step={0.005} onChange={(v) => setC<'morph'>((x) => (x.t = v), 't')} />
    </Section>
  );
}

function RecipeThumb({ recipe, layer }: { recipe: Recipe; layer: ShapeLayer }) {
  const sample: Content =
    layer.content.type === 'text'
      ? { ...layer.content, text: layer.content.text.trim().slice(0, 2) || 'Ag', size: 100 }
      : layer.content.type === 'symbol'
        ? { ...layer.content, size: 100 }
        : { type: 'text', text: 'Ag', font: 'archivo', size: 100, tracking: 0, lineHeight: 1, align: 'center', axes: {}, morph: null, ligatures: true };
  const key = `recipe:${recipe.name}:${JSON.stringify(sample)}`;
  const shape = useShape(key, () => ({
    layers: [{ id: 'r', visible: true, op: 'add', x: 0, y: 0, rotation: 0, scale: 1, sx: 1, sy: 1, modifiers: recipe.mods.map((m) => ({ ...m, on: true, uid: uid('m') }) as ModEntry), content: sample }],
  }));
  return (
    <svg viewBox={shape ? viewBoxOf(shape.box, 0.1) : '-50 -50 100 100'} className="thumb-svg" aria-hidden>
      {shape && <path d={shape.d} />}
    </svg>
  );
}

/** One-click modifier stacks, previewed on this layer's own content. */
function QuickLooks({ layer }: { layer: ShapeLayer }) {
  const [all, setAll] = useState(false);
  const current = lookOf(layer.modifiers);
  // Keep the active look visible even when it's past the first row.
  const shown = all ? SHAPE_RECIPES : SHAPE_RECIPES.slice(0, 8).concat(current && SHAPE_RECIPES.indexOf(current) >= 8 ? [current] : []);
  return (
    <Section title="Quick looks" id="looks">
      <div className="looks">
        {shown.map((r) => (
          <button
            key={r.name}
            className={`look ${current === r ? 'on' : ''}`}
            aria-pressed={current === r}
            data-tip={`${r.name} · ⇧-click to add on top`}
            onClick={(e) => {
              const add = e.shiftKey;
              updateNode(layer.id, (n) => {
                if (isGroup(n)) return;
                const fresh = r.mods.map((m) => ({ ...structuredClone(m), on: true, uid: uid('m') }) as ModEntry);
                n.modifiers = add ? [...n.modifiers, ...fresh] : fresh;
              });
              if (!add) toast(`Applied ${r.name}`, 'info', { label: 'Undo', run: undo });
            }}
          >
            <RecipeThumb recipe={r} layer={layer} />
            <span>{r.name}</span>
          </button>
        ))}
      </div>
      <button className="link-btn" onClick={() => setAll(!all)}>
        {all ? 'Fewer' : `All ${SHAPE_RECIPES.length} looks`}
      </button>
    </Section>
  );
}

export function Modifiers({ mods, onChange, owner, layer }: { mods: ModEntry[]; onChange: (fn: (m: ModEntry[]) => void, key?: string) => void; owner: string; layer?: ShapeLayer }) {
  const advancedAll = useStore((s) => s.settings.advanced);
  const editing = useStore((s) => s.editing);
  const [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const btn = useRef<HTMLButtonElement>(null);
  const patch = (u: string, fn: (m: ModEntry) => void, key = '') =>
    onChange((list) => {
      const m = list.find((x) => x.uid === u);
      if (m) fn(m);
    }, key ? `${owner}:${u}:${key}` : '');
  return (
    <Section
      title="Modifiers"
      id="mods"
      actions={
        <button ref={btn} className={`chip-btn ${picker ? 'on' : ''}`} onClick={() => setPicker(!picker)} aria-haspopup="menu">
          <Icon name="plus" size={13} /> Add
        </button>
      }
    >
      {picker && (
        <Popover anchor={btn.current} onClose={() => setPicker(false)} width={360} placement="left-start" className="mod-pop">
          <ModifierPicker
            onPick={(k: ModifierKind) => {
              const m = newModifier(k);
              onChange((list) => list.push(m));
              setPicker(false);
              if (k === 'warp' && layer) editWarp(layer.id, m);
            }}
          />
        </Popover>
      )}
      {mods.length === 0 && <p className="hint">Stack modifiers to reshape the outline: pixels, warp, rounding, melt and more. They run top to bottom.</p>}
      {mods.map((m, i) => {
        const ui = MODIFIER_UI[m.kind];
        const values = m as unknown as Record<string, number | string>;
        const adv = advancedAll || expanded.has(m.uid);
        const hasAdv = ui.fields.some((f) => !isChoice(f) && f.advanced);
        return (
          <div key={m.uid} className={`mod ${m.on ? '' : 'off'}`}>
            <div className="mod-head">
              <button className={`switch small ${m.on ? 'on' : ''}`} role="switch" aria-checked={m.on} aria-label={`${ui.label} on`} onClick={() => patch(m.uid, (x) => (x.on = !x.on))}>
                <span />
              </button>
              <span className="mod-name">{ui.label}</span>
              <Menu buttonClass="icon-btn tiny" label={<Icon name="more" size={14} />} title="Modifier options" placement="bottom-end" width={190}>
                {(close) => (
                  <div className="menu-list">
                    <MenuItem label="Move up" disabled={i === 0} onClick={() => (close(), onChange((l) => l.splice(i - 1, 0, ...l.splice(i, 1))))} />
                    <MenuItem label="Move down" disabled={i === mods.length - 1} onClick={() => (close(), onChange((l) => l.splice(i + 1, 0, ...l.splice(i, 1))))} />
                    <MenuItem label="Duplicate" onClick={() => (close(), onChange((l) => l.splice(i + 1, 0, { ...structuredClone(m), uid: uid('m') })))} />
                    {hasAdv && !advancedAll && <MenuItem label={adv ? 'Fewer controls' : 'More controls'} onClick={() => (close(), setExpanded((s) => (s.has(m.uid) ? new Set([...s].filter((x) => x !== m.uid)) : new Set([...s, m.uid]))))} />}
                    <MenuSep />
                    <MenuItem icon="trash" danger label="Remove" onClick={() => (close(), onChange((l) => l.splice(i, 1)))} />
                  </div>
                )}
              </Menu>
            </div>
            {ui.fields
              .filter((f) => (isChoice(f) || adv || !f.advanced) && fieldShown(f, values))
              .map((f) =>
                isChoice(f) ? (
                  <div className="field" key={f.key}>
                    <span>{f.label}</span>
                    {f.options.length <= 3 ? (
                      <Segmented size="sm" value={String(values[f.key])} options={f.options.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => patch(m.uid, (x) => ((x as unknown as Record<string, string>)[f.key] = v))} />
                    ) : (
                      <Select value={String(values[f.key])} options={f.options} onChange={(v) => patch(m.uid, (x) => ((x as unknown as Record<string, string>)[f.key] = v))} />
                    )}
                  </div>
                ) : f.toggle ? (
                  <Toggle key={f.key} label={f.label} checked={Number(values[f.key] ?? 0) > 0.5} onChange={(v) => patch(m.uid, (x) => ((x as unknown as Record<string, number>)[f.key] = v ? 1 : 0))} />
                ) : (
                  <Slider
                    key={f.key}
                    label={f.label}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={Number(values[f.key] ?? 0)}
                    onChange={(v) => patch(m.uid, (x) => ((x as unknown as Record<string, number>)[f.key] = f.integer ? Math.round(v) : v), f.key)}
                  />
                ),
              )}
            {m.kind === 'warp' && layer && (
              <div className="button-row">
                <button className={`btn small ${editing?.kind === 'warp' && editing.uid === m.uid ? 'primary' : ''}`} onClick={() => (editing?.kind === 'warp' && editing.uid === m.uid ? store.set({ editing: null }) : editWarp(layer.id, m))}>
                  <Icon name="warp" size={13} /> {editing?.kind === 'warp' && editing.uid === m.uid ? 'Done' : 'Drag points on canvas'}
                </button>
                {m.points?.some((p) => p[0] || p[1]) && (
                  <button className="btn small" onClick={() => patch(m.uid, (x) => x.kind === 'warp' && (x.points = []))}>
                    Reset points
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ---------- canvas ----------

const KINDS: { value: FillKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'aura', label: 'Aura' },
];

export function FillEditor({ value, onChange, allowNone = true, keyPrefix }: { value: Fill; onChange: (fn: (f: Fill) => void, key?: string) => void; allowNone?: boolean; keyPrefix: string }) {
  const max = value.kind === 'solid' ? 1 : 4;
  return (
    <div className="fill-editor">
      <Segmented
        size="sm"
        value={value.kind}
        options={KINDS.filter((k) => allowNone || k.value !== 'none')}
        onChange={(k) =>
          onChange((f) => {
            f.kind = k;
            if (k !== 'solid' && k !== 'none' && f.colors.length < 2) f.colors.push(k === 'aura' ? '#1a0b2e' : '#ffffff');
            if (k === 'aura' && f.colors.length < 3) f.colors.push('#ff9a3d');
          })
        }
      />
      {value.kind !== 'none' && (
        <div className="stops">
          {value.colors.slice(0, max).map((c, i) => (
            <ColorChip key={i} label={`Colour ${i + 1}`} value={c} onChange={(v) => onChange((f) => (f.colors[i] = v), `${keyPrefix}-c${i}`)} />
          ))}
          {value.kind !== 'solid' && value.colors.length < 4 && <IconButton icon="plus" title="Add colour" onClick={() => onChange((f) => f.colors.push(f.colors.at(-1) ?? '#ffffff'))} size={13} className="tiny" />}
          {value.kind !== 'solid' && value.colors.length > 2 && <IconButton icon="minus" title="Remove last colour" onClick={() => onChange((f) => f.colors.pop())} size={13} className="tiny" />}
          <span className="fill-preview" style={{ background: fillCss(value) }} />
        </div>
      )}
      {(value.kind === 'linear' || value.kind === 'aura') && <Slider label={value.kind === 'aura' ? 'Arrangement' : 'Angle'} value={value.angle} min={0} max={360} step={1} suffix="°" onChange={(v) => onChange((f) => (f.angle = v), `${keyPrefix}-angle`)} />}
    </div>
  );
}

/** Page fill presets, colours and grain. Shared by the canvas panel and the dock. */
export function BackgroundEditor() {
  const bg = useStore((s) => s.project.background);
  return (
    <>
      <div className="bg-presets">
        {BG_PRESETS.map((b) => (
          <button
            key={b.name}
            className="bg-chip"
            data-tip={b.name}
            aria-label={b.name}
            style={{ background: backgroundCss(b.bg, 0.06) }}
            // Page-only presets keep an app-icon tile you already have.
            onClick={() => edit((d) => (d.background = { ...structuredClone(b.bg), pattern: b.bg.pattern ? structuredClone(b.bg.pattern) : null, tile: b.bg.tile ? structuredClone(b.bg.tile) : d.background.tile }))}
          >
            {b.bg.tile && <span className="bg-chip-tile" style={{ background: fillCss(b.bg.tile.fill) }} />}
          </button>
        ))}
      </div>
      <FillEditor value={bg.fill} keyPrefix="page" onChange={(fn, key) => setBackground((b) => fn(b.fill), key)} />
      <Slider label="Grain" value={bg.grain} min={0} max={1} step={0.01} reset={0} onChange={(v) => setBackground((b) => (b.grain = v), 'grain')} />
      <PatternEditor />
    </>
  );
}

const PATTERNS: { value: PatternKind | 'none'; label: string; title: string }[] = [
  { value: 'none', label: 'None', title: 'No pattern' },
  { value: 'grid', label: 'Grid', title: 'Grid paper' },
  { value: 'dots', label: 'Dots', title: 'Dot grid' },
  { value: 'lines', label: 'Lines', title: 'Ruled lines' },
  { value: 'diagonal', label: 'Stripes', title: 'Diagonal stripes' },
  { value: 'checker', label: 'Checks', title: 'Checkerboard' },
  { value: 'doodles', label: 'Doodles', title: 'Hand-drawn squiggles, crosses, dots and rings, like packaging' },
];

/** Grid paper, dot grid, stripes or checks over the page fill. */
function PatternEditor() {
  const pt = useStore((s) => s.project.background.pattern ?? null);
  const page = useStore((s) => s.project.background.fill);
  const set = (fn: (p: Pattern) => void, key?: string) => setBackground((b) => b.pattern && fn(b.pattern), key);
  return (
    <>
      <div className="field">
        <span>Pattern</span>
        <Select
          value={pt?.kind ?? 'none'}
          options={PATTERNS.map((p) => ({ value: p.value, label: p.label, hint: p.title }))}
          onChange={(v) =>
            setBackground((b) => {
              if (v === 'none') return void (b.pattern = null);
              // A shade of the page colour reads as paper; keep the user's colour once set.
              const base = page.colors[0] ?? '#ffffff';
              b.pattern = b.pattern ? { ...b.pattern, kind: v } : pattern(v, luminance(base) > 0.18 ? '#000000' : '#ffffff', { opacity: 0.18 });
              if (v === 'dots' && b.pattern.weight > b.pattern.size / 3) b.pattern.weight = 3;
            })
          }
        />
      </div>
      {pt && (
        <>
          <ColorField label="Pattern colour" value={pt.color} onChange={(v) => set((p) => (p.color = v), 'pc')} />
          <Slider label="Cell size" value={pt.size} min={4} max={400} step={1} suffix="px" onChange={(v) => set((p) => (p.size = v), 'ps')} />
          {pt.kind !== 'checker' && <Slider label={pt.kind === 'dots' ? 'Dot size' : 'Line width'} value={pt.weight} min={0.5} max={Math.max(4, pt.size / 2)} step={0.5} suffix="px" onChange={(v) => set((p) => (p.weight = v), 'pw')} />}
          <Slider label="Opacity" value={pt.opacity} min={0} max={1} step={0.01} onChange={(v) => set((p) => (p.opacity = v), 'po')} />
        </>
      )}
    </>
  );
}

/** Replace the background tile with an editable squircle layer at the bottom. */
function tileToLayer() {
  const p = store.get().project;
  const t = p.background.tile;
  if (!t) return;
  const side = t.size * Math.min(p.canvas.width, p.canvas.height);
  const c = t.fill.colors;
  const st =
    t.fill.kind === 'solid' || c.length < 2
      ? style('icon', { glyph: c[0] ?? '#ffffff', shine: t.gloss, shadow: t.shadow, outline: 0 })
      : style('flat', { fill: c[0], fill2: c.at(-1)!, gradient: 1, angle: t.fill.angle, shadowOpacity: t.shadow * 0.8, shadowY: side * 0.03, shadowBlur: side * 0.04 });
  const l =
    t.shape === 'circle'
      ? symbolLayer('circle', side, { name: 'Tile', style: st })
      : t.shape === 'rounded'
        ? symbolLayer('roundRect', side, { name: 'Tile', style: st }, { radius: t.radius * 0.5, aspect: 1 })
        : symbolLayer('squircle', side, { name: 'Tile', style: st }, { exponent: 12 - 8.8 * t.radius, aspect: 1 });
  edit((d) => {
    d.background.tile = null;
    d.layers.unshift(l);
  });
  select([l.id]);
  toast('The tile is now a layer at the bottom', 'info', { label: 'Undo', run: undo });
}

function CanvasPanel() {
  const p = useStore((s) => s.project);
  const settings = useStore((s) => s.settings);
  const bg = p.background;
  const target = iconTarget(bg.tile);
  const preset = CANVAS_PRESETS.find((c) => c.w === p.canvas.width && c.h === p.canvas.height);
  return (
    <div className="inspector">
      <div className="sel-header">
        <span className="sel-kind">Canvas</span>
        <input className="sel-name" value={p.name} aria-label="Project name" onChange={(e) => edit((d) => (d.name = e.target.value), 'name')} />
      </div>
      <Section title="Size" id="canvas-size">
        <div className="field">
          <span>Format</span>
          <Select
            value={preset?.label ?? 'Custom'}
            options={[...CANVAS_PRESETS.map((c) => ({ value: c.label, label: c.label, hint: `${c.w}×${c.h}` })), ...(preset ? [] : [{ value: 'Custom', label: 'Custom' }])]}
            onChange={(v) => {
              const c = CANVAS_PRESETS.find((x) => x.label === v);
              if (!c) return;
              edit((d) => (d.canvas = { width: c.w, height: c.h }));
              window.dispatchEvent(new Event('mt-fit'));
            }}
          />
        </div>
        <div className="grid2">
          <NumberBox label="W" value={p.canvas.width} min={16} max={8192} onChange={(v) => edit((d) => (d.canvas.width = Math.round(v)))} />
          <NumberBox label="H" value={p.canvas.height} min={16} max={8192} onChange={(v) => edit((d) => (d.canvas.height = Math.round(v)))} />
        </div>
        <button className="link-btn" onClick={() => edit((d) => (d.canvas = { width: d.canvas.height, height: d.canvas.width }))}>
          Swap orientation
        </button>
      </Section>
      <Section title="Background" id="canvas-bg">
        <BackgroundEditor />
      </Section>
      <Section title="App icon tile" id="canvas-tile" defaultOpen={!!bg.tile || p.canvas.width === p.canvas.height}>
        <Toggle label="Show a tile behind the artwork" checked={!!bg.tile} onChange={(v) => setBackground((b) => (b.tile = v ? (b.tile ?? tile({ ...{ kind: 'linear', colors: ['#c9b8ff', '#8a63f5'], angle: 180 } })) : null))} />
        <Toggle label="Show the icon grid" checked={settings.iconGrid} onChange={(v) => setSettings({ iconGrid: v })} hint="Apple-style keylines over the artboard while you design" />
        <button className="link-btn" onClick={addIconGrid} data-tip="Add the grid as locked line layers under your artwork, for presentation shots">
          Add the grid as layers
        </button>
        <div className="field-stack">
          <span>Made for</span>
          <Segmented
            size="sm"
            value={target ?? ('' as IconTarget)}
            options={ICON_TARGETS.map((t) => ({ value: t.value, label: t.label, title: t.hint }))}
            onChange={(v) => {
              setBackground((b) => applyIconTarget(b, v));
              setSettings({ iconMask: v === 'ios' });
            }}
          />
        </div>
        <p className="hint">{ICON_TARGETS.find((t) => t.value === target)?.hint ?? 'Pick a platform to set the tile up the way its icons are drawn.'}</p>
        {target === 'ios' || settings.iconMask ? <Toggle label="Preview the system mask" hint="Shows where iOS and Android crop the corners. Not exported." checked={settings.iconMask} onChange={(v) => setSettings({ iconMask: v })} /> : null}
        {bg.tile && (
          <>
            <div className="field">
              <span>Shape</span>
              <Segmented
                size="sm"
                value={bg.tile.shape}
                options={[
                  { value: 'squircle', label: 'Squircle' },
                  { value: 'rounded', label: 'Rounded' },
                  { value: 'circle', label: 'Circle' },
                ]}
                onChange={(v) => setBackground((b) => b.tile && (b.tile.shape = v))}
              />
            </div>
            <Slider label="Size" value={bg.tile.size} min={0.2} max={1} step={0.01} onChange={(v) => setBackground((b) => b.tile && (b.tile.size = v), 'tsize')} />
            {bg.tile.shape !== 'circle' && <Slider label="Roundness" value={bg.tile.radius} min={0} max={1} step={0.01} onChange={(v) => setBackground((b) => b.tile && (b.tile.radius = v), 'tr')} />}
            <FillEditor value={bg.tile.fill} keyPrefix="tile" allowNone={false} onChange={(fn, key) => setBackground((b) => b.tile && fn(b.tile.fill), key)} />
            <Slider label="Gloss" value={bg.tile.gloss} min={0} max={1} step={0.01} onChange={(v) => setBackground((b) => b.tile && (b.tile.gloss = v), 'tg')} />
            <Slider label="Shadow" value={bg.tile.shadow} min={0} max={1} step={0.01} onChange={(v) => setBackground((b) => b.tile && (b.tile.shadow = v), 'ts')} />
            <Slider label="Rim light" value={bg.tile.rim} min={0} max={40} step={0.5} onChange={(v) => setBackground((b) => b.tile && (b.tile.rim = v), 'trim')} />
            {bg.tile.rim > 0 && (
              <>
                <Toggle label="Holographic rim" checked={bg.tile.holo} onChange={(v) => setBackground((b) => b.tile && (b.tile.holo = v))} />
                {!bg.tile.holo && <ColorField label="Rim colour" value={bg.tile.rimColor} onChange={(v) => setBackground((b) => b.tile && (b.tile.rimColor = v), 'trc')} />}
              </>
            )}
            <button className="link-btn" onClick={tileToLayer} data-tip="Make the tile a normal shape layer so you can give it any material, modifiers or effects">
              Turn the tile into a layer
            </button>
          </>
        )}
      </Section>
      <p className="hint pad">Select a layer to edit it, or press ⌘K to search every command.</p>
    </div>
  );
}

export { nodeBox, primaryNode, selectedNodes };
