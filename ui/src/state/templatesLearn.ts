// Learn motion: eight small scenes, each teaching one idea with the plain
// tools — library shapes, a flat colour or Puffy, and the Motion panel. The
// caption on the canvas says how it was made; open the timeline to see when
// each part moves, and take it apart.
import { background, fill, group, mods, style, symbolLayer, textLayer, type Node, type Project, type ShapeLayer, type Style } from './model';
import { FEELS, newMotion, type Motion, type ParamAnim, type Transition } from './motion';
import type { SymbolKind } from '../engine/types';
import type { Template } from './templates';

const W = 1200;
const H = 800;
const PAPER = '#f6f3ec';
const INK = '#1d1b18';
const DIM = '#7a746a';
const COLOURS = ['#ff5a36', '#ffb21e', '#2fbf71', '#2f7bff', '#9b5cff', '#ff4fa3'];

const feel = (label: string, duration?: number): Transition => {
  const t = { ...FEELS.find((f) => f.label === label)!.value };
  return duration ? { ...t, duration } : t;
};
const flat = (c: string, extra: Partial<Style> = {}): Style => ({ ...style('flat', { fill: c }), ...extra });
const puffy = (body: string, shade: string): Style => style('inflate', { body, shade });

function shape(kind: SymbolKind, size: number, x: number, y: number, st: Style, name: string, params: Record<string, unknown> = {}, motion?: Partial<Motion>): ShapeLayer {
  const n = symbolLayer(kind, size, { x, y, name, style: st }, params);
  if (motion) n.motion = newMotion(motion);
  return n;
}

/** Left-aligned text; `y` is the middle of the line. */
const words = (s: string, size: number, x: number, y: number, colour: string, name: string, font = 'inter') => textLayer(s, font, { x, y, name, style: flat(colour) }, { size, align: 'left', lineHeight: 1.2, tracking: 0 });

/** The lesson's title and how-to, top left. */
const caption = (title: string, how: string): Node[] => [words(title, 40, -W / 2 + 60, -H / 2 + 74, INK, 'Title', 'inter-black'), words(how, 21, -W / 2 + 60, -H / 2 + 124, DIM, 'How it was made')];

/** A faint ring marking a spot. */
const mark = (x: number, y: number, size: number, name: string) => {
  const n = shape('circle', size, x, y, flat('#ddd6c8'), name);
  n.modifiers = mods({ kind: 'outline', width: 4 / size });
  return n;
};

const lesson = (name: string, hint: string, layers: Node[], duration = 5): Template => ({
  name,
  hint,
  category: 'Learn',
  make: (): Project => ({ version: 2, name, canvas: { width: W, height: H }, layers, background: background(fill('solid', PAPER)), fonts: [], timeline: { duration, loop: true } }),
});

const anim = (to: number | string, period: number, mode: ParamAnim['mode'] = 'swing', phase = 0): ParamAnim => ({ to, period, phase, mode });

export const LEARN_TEMPLATES: Template[] = [
  lesson('Learn 1 · Here to there', 'Move a ball from one spot to another: the first thing to learn in motion', [
    ...caption('Here to there', 'Select the ball: Motion > Comes in > Move from... It ends where it sits;\ndrag the dashed copy on the canvas to where it starts.'),
    mark(-340, 90, 190, 'Start'),
    mark(330, 90, 190, 'End'),
    shape('circle', 160, 330, 90, flat(COLOURS[0]), 'Ball', {}, { enter: 'move', fromX: -670, fromY: 0, delay: 0.4, transition: feel('Smooth', 1.1) }),
  ]),
  lesson('Learn 2 · Three feels', 'The same move three ways — Smooth, Snappy and Bouncy — to feel the difference', [
    ...caption('Three feels', 'The same Move from..., with a different Feel each. Switch on Advanced\nto see the curve, or how much a spring bounces, and drag it.'),
    ...(['Smooth', 'Snappy', 'Bouncy'] as const).flatMap((f, i) => [
      words(f, 26, -520, -60 + i * 150, INK, `${f} label`),
      shape('pill', 220, 260, -60 + i * 150, flat(COLOURS[i + 1]), f, { aspect: 2.6 }, { enter: 'move', fromX: -560, delay: 0.4, transition: feel(f, 0.8) }),
    ]),
  ]),
  lesson('Learn 3 · Then move on', 'A shape arrives, waits, then moves on to a new spot and stays', [
    ...caption('Comes in, then moves on', 'Comes in > Rise. Then > Move to..., at 1.8 s: drag its dashed copy to where it goes.\nOpen the timeline (the ^ button) to see the two clips and drag them.'),
    mark(-200, 90, 200, 'First spot'),
    mark(260, 90, 200, 'Second spot'),
    shape('roundRect', 180, -200, 90, flat(COLOURS[3]), 'Square', { radius: 0.22, aspect: 1 }, { enter: 'rise', distance: 140, delay: 0.3, transition: feel('Bouncy'), leave: 'move', toX: 460, toY: 0, leaveAt: 1.8 }),
  ]),
  lesson('Learn 4 · One by one', 'Six stars pop up one after another: the group’s children move in turn', [
    ...caption('One by one', 'Group the stars, then Motion > Children > One by one. Gap sets how far\napart they start; Advanced adds the order (reverse, from the centre, random).'),
    group(
      COLOURS.map((c, i) => shape('star', 130, -400 + i * 160, 100, flat(c), `Star ${i + 1}`, { points: 5, inner: 0.5, rounding: 0.2 })),
      { name: 'Stars', motion: newMotion({ enter: 'rise', distance: 160, delay: 0.3, stagger: 0.12, transition: feel('Bouncy') }) },
    ),
  ]),
  lesson('Learn 5 · Conveyor', 'Hearts slide one way forever inside a frame, without a jump: a ticker or carousel', [
    ...caption('A conveyor', 'Loop > Slide, one way, to the left. Distance is the gap between hearts (170 px),\nso each pass ends where the next begins. The group clips them to the frame.'),
    (() => {
      const frame = shape('roundRect', 900, 0, 100, flat('#ece6da'), 'Frame', { radius: 0.06, aspect: 900 / 220 });
      const strip = group(
        Array.from({ length: 8 }, (_, i) => shape('heart', 110, -425 + i * 170, 100, flat(COLOURS[i % COLOURS.length]), `Heart ${i + 1}`)),
        { name: 'Strip', motion: newMotion({ loop: 'slide', dir: 'left', oneWay: true, amount: 170, period: 1.25 }) },
      );
      return group([frame, strip], { name: 'Conveyor', clip: true });
    })(),
  ]),
  lesson('Learn 6 · Loops', 'Five loops side by side — float, sway, pulse, spin and orbit — each named under its shape', [
    ...caption('Loops', 'A loop repeats as long as the timeline plays. Pick one in Motion > Keeps moving;\nCycle is how long one round takes. On a looping timeline it steps to whole repeats.'),
    ...(
      [
        ['moon', 'Float', { loop: 'float', amount: 24, period: 2.5 }],
        ['bolt', 'Sway', { loop: 'sway', amount: 12, period: 1.25 }],
        ['heart', 'Pulse', { loop: 'pulse', amount: 18, period: 1 }],
        ['sparkle', 'Spin', { loop: 'spin', amount: 1, period: 2.5 }],
        ['circle', 'Orbit', { loop: 'orbit', amount: 30, period: 2.5 }],
      ] as [SymbolKind, string, Partial<Motion>][]
    ).flatMap(([kind, label, m], i) => [shape(kind, 120, -440 + i * 220, 60, flat(COLOURS[i]), label, {}, m), words(label, 22, -470 + i * 220, 200, DIM, `${label} label`)]),
  ]),
  lesson('Learn 7 · Colours and shapes move too', 'A blob changes colour, a flower’s petals breathe and a star gains points: any setting can move', [
    ...caption('Colours and shapes move too', 'Click the diamond button next to any colour or setting to move it to To and back (Swing),\nround and round (Ramp) or in jumps (Flicker). The timeline shows each one.'),
    (() => {
      const n = shape('blob', 220, -340, 110, flat(COLOURS[0]), 'Colour', { lobes: 7, depth: 0.12 });
      n.style.animate = { fill: anim('#2f7bff', 2.5) };
      return n;
    })(),
    (() => {
      const n = shape('flower', 220, 0, 110, flat(COLOURS[2]), 'Petals', { petals: 6, depth: 0.2, petal: 'round', hole: 0 }, { loop: 'spin', amount: 1, period: 5 });
      n.animate = { 'sym:depth': anim(0.5, 1.25) };
      return n;
    })(),
    (() => {
      const n = shape('star', 220, 340, 110, flat(COLOURS[4]), 'Points', { points: 4, inner: 0.45, rounding: 0.15 });
      n.animate = { 'sym:points': anim(9, 5, 'swing') };
      return n;
    })(),
  ]),
  lesson('Learn 8 · Put it together', 'A puffy cat drops in, says hello word by word, and keeps wiggling: every idea at once', [
    ...caption('Put it together', 'The cat: Comes in > Drop (Bouncy), then a small Wiggle loop. The words: a group, One by one.\nThe sparkles: Spin with different Offsets (Advanced). Open the timeline to see it all.'),
    shape('catHead', 260, -230, 120, puffy('#ffb21e', '#d9731c'), 'Cat', {}, { enter: 'drop', distance: 420, delay: 0.2, transition: feel('Bouncy', 0.8), loop: 'wiggle', amount: 4, period: 2.5 }),
    group([words('Hello', 84, 0, 60, INK, 'Hello', 'inter-black'), words('there!', 84, 0, 160, COLOURS[3], 'there!', 'inter-black')], { name: 'Words', motion: newMotion({ enter: 'rise', distance: 60, delay: 0.9, stagger: 0.25, transition: feel('Snappy', 0.45) }) }),
    ...[0, 0.33, 0.66].map((phase, i) => shape('sparkle', 70 - i * 12, 420 - i * 60, -40 + i * 110, flat(COLOURS[(i * 2 + 1) % COLOURS.length]), `Sparkle ${i + 1}`, {}, { loop: 'spin', amount: 1, period: 2.5, phase, enter: 'grow', distance: 0, delay: 1.4 + i * 0.15, transition: feel('Bouncy', 0.5) })),
  ]),
  lesson('Learn 10 · A path of stops', 'A ball hops along a path, waiting at each stop: Then > Move to…, then + Add a stop', [
    ...caption('A path of stops', 'Then > Move to... takes it to stop 1; + Add a stop adds the next, with its own wait\nand Feel. Drag the numbered copies; the timeline shows a segment for each stop.'),
    ...(
      [
        [-420, 200, 'Start'],
        [-140, -20, 'Stop 1'],
        [140, 200, 'Stop 2'],
        [420, -20, 'Stop 3'],
      ] as const
    ).map(([x, y, name]) => mark(x, y, 150, name)),
    shape('circle', 120, -420, 200, flat(COLOURS[4]), 'Ball', {}, {
      enter: 'grow',
      distance: 0,
      delay: 0.2,
      transition: feel('Bouncy', 0.5),
      leave: 'move',
      toX: 280,
      toY: -220,
      leaveAt: 1,
      leaveTransition: feel('Smooth', 0.7),
      stops: [
        { x: 560, y: 0, hold: 0.4 },
        { x: 840, y: -220, hold: 0.4, transition: feel('Bouncy', 0.7) },
      ],
    }),
  ]),
];

// ---------- starters: small finished animations to open and reuse ----------

const NIGHT = '#121216';
const starter = (name: string, hint: string, layers: Node[], bg = NIGHT, duration = 4): Template => ({
  name,
  hint,
  category: 'Learn',
  make: (): Project => ({ version: 2, name, canvas: { width: W, height: H }, layers, background: background(fill('solid', bg)), fonts: [], timeline: { duration, loop: true } }),
});

export const STARTER_TEMPLATES: Template[] = [
  starter('Starter · Loading dots', 'Three dots hop one after another: a group with a Bounce loop and One by one', [
    group(
      [0, 1, 2].map((i) => shape('circle', 70, -110 + i * 110, 30, flat(['#ff5a36', '#ffb21e', '#2fbf71'][i]), `Dot ${i + 1}`)),
      { name: 'Dots', motion: newMotion({ loop: 'bounce', amount: 70, period: 1, stagger: 0.15 }) },
    ),
    words('Loading', 34, -66, 160, '#8b8a94', 'Label'),
  ]),
  starter('Starter · Pulse wave', 'Nine bars pulse out from the middle: Pulse loop, One by one, from the centre', [
    group(
      Array.from({ length: 9 }, (_, i) => shape('pill', 260, -360 + i * 90, 0, flat(COLOURS[i % COLOURS.length]), `Bar ${i + 1}`, { aspect: 0.22 })),
      { name: 'Bars', motion: newMotion({ loop: 'pulse', amount: 45, period: 1, stagger: 0.08, order: 'centre' }) },
    ),
  ]),
  starter('Starter · Ticker', 'Words and sparkles run along a band forever: a one-way Slide inside a clipping group', [
    (() => {
      const band = shape('roundRect', 1100, 0, 0, flat('#ffb21e'), 'Band', { radius: 0.02, aspect: 1100 / 150 });
      const items = Array.from({ length: 6 }, (_, i) => [words('NEW DROP', 46, -630 + i * 360, 0, '#121216', `Word ${i + 1}`, 'inter-black'), shape('sparkle', 46, -330 + i * 360, 0, flat('#121216'), `Sparkle ${i + 1}`)]).flat();
      const run = group(items, { name: 'Run', motion: newMotion({ loop: 'slide', dir: 'left', oneWay: true, amount: 360, period: 2 }) });
      return group([band, run], { name: 'Ticker', clip: true });
    })(),
  ]),
  starter('Starter · Orbit', 'Planets circle a puffy sun, a moon circles its planet: Orbit loops nested in groups', [
    shape('circle', 200, 0, 0, puffy('#ffb21e', '#e0641c'), 'Sun', {}, { loop: 'pulse', amount: 6, period: 2 }),
    shape('circle', 34, 0, 0, flat('#2fbf71'), 'Near planet', {}, { loop: 'orbit', amount: 170, period: 2 }),
    group([shape('circle', 56, 0, 0, flat('#2f7bff'), 'Far planet'), shape('circle', 18, 0, 0, flat('#e8e6f0'), 'Moon', {}, { loop: 'orbit', amount: 56, period: 1 })], { name: 'Far planet and moon', motion: newMotion({ loop: 'orbit', amount: 300, period: 4 }) }),
  ]),
  starter(
    'Starter · Notification',
    'A message card drops in, its text rises after it, then it all slides away: Comes in, One by one, Then',
    [
      group(
        [
          shape('roundRect', 560, 0, 0, flat('#ffffff'), 'Card', { radius: 0.06, aspect: 560 / 150 }),
          shape('circle', 84, -200, 0, flat('#2f7bff'), 'Avatar'),
          words('New message', 34, -130, -18, '#121216', 'Heading', 'inter-black'),
          words('See you at 6?', 26, -130, 26, '#7a746a', 'Text'),
        ],
        { name: 'Notification', motion: newMotion({ enter: 'drop', distance: 260, delay: 0.3, stagger: 0.08, transition: feel('Bouncy', 0.6), leave: 'right', leaveDistance: 900, leaveAt: 3, leaveFade: false, leaveTransition: feel('Smooth', 0.5) }) },
      ),
    ],
    '#e9e6ff',
  ),
  starter('Starter · Heartbeat', 'A puffy heart beats while a ring grows and fades behind it: two loops in step', [
    group([(() => {
      const r = shape('circle', 220, 0, 10, flat('#ff4fa3'), 'Ring', {}, { loop: 'blink', amount: 100, period: 1 });
      r.modifiers = mods({ kind: 'outline', width: 0.03 });
      return r;
    })()], { name: 'Wave', motion: newMotion({ loop: 'pulse', amount: 90, period: 1 }) }),
    shape('heart', 240, 0, 10, puffy('#ff4f7a', '#c41d4a'), 'Heart', {}, { loop: 'pulse', amount: 10, period: 1, phase: 0.1 }),
  ]),
];
