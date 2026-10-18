import { useMemo, useState } from 'react';
import { allCommands, keyLabel } from '../app/commands';
import { platform } from '../platform';
import { store } from '../state/store';
import { Icon } from './icons';
import { Dialog } from './ui';

const GUIDE: { title: string; steps: string[] }[] = [
  {
    title: 'Make a logo',
    steps: [
      'Start from a template (⌘N) or add text (T) and shapes from the dock at the bottom.',
      'Click to select, drag to move, pull the handles to resize, and grab just outside a corner to rotate. Hold ⇧ to keep proportions or snap angles, ⌥ to scale from the centre, ⌘ to skip snapping.',
      'Pick a look in the Style tab. Every layer has its own material, so eyes can be ink while the body is puffy.',
      'Set a layer to Cut to punch it out of the layer directly below it (eyes in a mascot, a cursor in a pin).',
      'Group (⌘G) to move things together, or Merge (⇧⌘M) to fuse them into one shape with one material.',
    ],
  },
  {
    title: 'Reshape anything',
    steps: [
      'Quick looks in the Design tab apply a whole modifier stack in one click: Bitmap, Dot matrix, Soft pixel, Arch, Melting…',
      'Warp (W) bends the selection with presets like Arch, Flag and Bulge. Drag its 16 points on the canvas for a hand-made envelope.',
      'Edit points (P or double-click) turns text or a shape into an outline you can edit point by point. Double-click a line to add a point, double-click a point to make it smooth or sharp, ⌫ deletes.',
      'Trace an image (⇧⌘I) to turn a logo or lettering into vectors, then Break apart (⇧⌘B) to get one layer per letter.',
    ],
  },
  {
    title: 'Design a font',
    steps: [
      'Switch to Type mode (⌘2). Pick a base font, then apply a style to every glyph at once: pixels, dots, rounding, weight, slant.',
      'Click a glyph to open it. Drag its points, give it its own modifiers, change its width, or reset it to the base font.',
      'Add any character you like, even ones the base font doesn’t have, and draw it or trace it from an image.',
      'Export a .ttf to install, a .woff for the web, or the web kit with a ready-to-paste @font-face snippet.',
    ],
  },
  {
    title: 'Export',
    steps: [
      'PNG at 1×, 2× or 4× (⌘E), JPG for social posts, or copy the image straight to the clipboard (⇧⌘C).',
      'SVG (⇧⌘E) keeps clean vector outlines, with one path per object and its main colour.',
      'Pick a canvas format (Instagram, Story, YouTube thumbnail, App icon…) in the Design tab when nothing is selected.',
    ],
  },
];

/** How to use Morphotype, plus every shortcut, searchable. */
export function HelpDialog() {
  const [q, setQ] = useState('');
  const cmds = useMemo(() => allCommands().filter((c) => c.keys?.length && !c.id.startsWith('nudge-big')), []);
  const groups = [...new Set(cmds.map((c) => c.group))];
  const ql = q.toLowerCase();
  const shown = cmds.filter((c) => !ql || `${c.title} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(ql));
  return (
    <Dialog title="How to use Morphotype" subtitle="Everything can be done from the keyboard. Press ⌘K any time to search commands." onClose={() => store.set({ dialog: null })} size="lg">
      <div className="help">
        <div className="help-guide">
          {GUIDE.map((g) => (
            <section key={g.title}>
              <h4>{g.title}</h4>
              <ol>
                {g.steps.map((s) => (
                  <li key={s}>{platform().isMac ? s : s.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+')}</li>
                ))}
              </ol>
            </section>
          ))}
          <section>
            <h4>Canvas</h4>
            <ol>
              <li>Scroll to pan, pinch or ⌘-scroll to zoom, hold Space (or H) and drag to pan.</li>
              <li>Drag on empty canvas to select several layers. Arrow keys nudge (⇧ for 10 px). Tab cycles through layers.</li>
              <li>Click a group to select it; double-click to step inside. ⌘-click selects the deepest layer directly.</li>
            </ol>
          </section>
        </div>
        <div className="help-keys">
          <div className="search-box small">
            <Icon name="search" size={13} />
            <input placeholder="Find a shortcut" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="keys-scroll">
            {groups.map((g) => {
              const items = shown.filter((c) => c.group === g);
              if (!items.length) return null;
              return (
                <div key={g}>
                  <h5>{g}</h5>
                  {items.map((c) => (
                    <div key={c.id} className="shortcut-row">
                      <span>{c.title.replace(/^Nudge (\w+)$/, 'Nudge $1 (⇧ for more)')}</span>
                      <span>
                        {c.keys!.slice(0, 2).map((k) => (
                          <kbd key={k} className="kbd">
                            {keyLabel(k)}
                          </kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
