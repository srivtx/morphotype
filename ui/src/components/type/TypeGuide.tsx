// Type basics: a short, visual primer on the parts of a letter and how fonts
// are spaced, plus quick definitions used by the glyph editor's metric lines.
import { useState } from 'react';
import { store, useStore } from '../../state/store';
import { Dialog } from '../ui';

export const TYPE_TERMS: Record<string, { name: string; text: string }> = {
  baseline: { name: 'Baseline', text: 'The line letters sit on. Round letters like O and S dip slightly below it (overshoot) so they look level with flat ones.' },
  xheight: { name: 'x-height', text: 'Height of lowercase letters without ascenders, like x, a and n. A taller x-height reads better at small sizes; a short one feels elegant.' },
  cap: { name: 'Cap height', text: 'Height of flat capitals like H and E. Round capitals (O, C) overshoot it a little.' },
  ascender: { name: 'Ascender', text: 'How far tall lowercase strokes (b, d, h, k, l) rise. Usually a touch above the cap height.' },
  descender: { name: 'Descender', text: 'How far tails of g, j, p, q and y drop below the baseline.' },
  advance: { name: 'Advance width', text: 'The full width a glyph takes up, including the space on each side (side bearings). It decides where the next letter starts.' },
};

interface Topic {
  id: string;
  title: string;
  body: React.ReactNode;
}

function metricsOf(fontId: string) {
  const info = store.get().fonts.find((f) => f.id === fontId)?.info;
  const upm = info?.unitsPerEm ?? 1000;
  return {
    asc: (info?.ascender ?? 800) / upm,
    desc: (info?.descender ?? -200) / upm,
    cap: (info?.capHeight ?? 700) / upm,
    x: (info?.xHeight ?? 500) / upm,
  };
}

/** The base font's own "Hxgd", with its real metric lines. */
function Anatomy({ font }: { font: string }) {
  const m = metricsOf(font);
  const size = 120;
  const base = 40 + m.asc * size;
  const H = base - m.desc * size + 24;
  const line = (y: number, label: string, cls = '') => (
    <g className={`metric ${cls}`}>
      <line x1={0} x2={520} y1={base - y * size} y2={base - y * size} />
      <text x={516} y={base - y * size - 5} textAnchor="end">
        {label}
      </text>
    </g>
  );
  return (
    <svg className="anatomy" viewBox={`0 0 520 ${H}`} role="img" aria-label="Parts of a letter">
      {line(m.asc, 'Ascender', 'soft')}
      {line(m.cap, 'Cap height')}
      {line(m.x, 'x-height', 'soft')}
      {line(0, 'Baseline', 'base')}
      {line(m.desc, 'Descender', 'soft')}
      <text x={18} y={base} className="anatomy-glyphs" style={{ fontFamily: `"mt-${font}", system-ui`, fontSize: size }}>
        Hxgd
      </text>
    </svg>
  );
}

function SpacingFigure({ font }: { font: string }) {
  return (
    <svg className="anatomy" viewBox="0 0 520 170" role="img" aria-label="Advance width and side bearings">
      <rect className="adv-box" x={70} y={20} width={150} height={130} />
      <rect className="adv-box" x={220} y={20} width={150} height={130} />
      <text x={145} y={128} textAnchor="middle" className="anatomy-glyphs" style={{ fontFamily: `"mt-${font}", system-ui`, fontSize: 120 }}>
        n
      </text>
      <text x={295} y={128} textAnchor="middle" className="anatomy-glyphs" style={{ fontFamily: `"mt-${font}", system-ui`, fontSize: 120 }}>
        o
      </text>
      <g className="metric">
        <text x={145} y={165} textAnchor="middle">
          advance width
        </text>
        <text x={295} y={165} textAnchor="middle">
          advance width
        </text>
      </g>
    </svg>
  );
}

export function topics(font: string): Topic[] {
  return [
    {
      id: 'anatomy',
      title: 'Parts of a letter',
      body: (
        <>
          <Anatomy font={font} />
          <dl className="terms">
            {(['baseline', 'xheight', 'cap', 'ascender', 'descender'] as const).map((k) => (
              <div key={k}>
                <dt>{TYPE_TERMS[k].name}</dt>
                <dd>{TYPE_TERMS[k].text}</dd>
              </div>
            ))}
          </dl>
          <p>These lines come from the base font, and every glyph you draw should respect them. Letters that ignore them look like they're from a different font.</p>
        </>
      ),
    },
    {
      id: 'spacing',
      title: 'Spacing',
      body: (
        <>
          <SpacingFigure font={font} />
          <p>
            <strong>Advance width</strong> is the box each glyph occupies. The gaps between the outline and the edges are its <strong>side bearings</strong>. Good spacing makes the space between letters <em>look</em> even, not measure even: round
            sides need less room than straight ones.
          </p>
          <p>
            <strong>Tracking</strong> adds the same space between every letter (the Spacing slider). <strong>Kerning</strong> fixes individual pairs like AV or To. Set widths with the Width slider on each glyph, and check pairs in the tester with
            words like <em>nnonoo</em> and <em>HHOHOO</em>.
          </p>
        </>
      ),
    },
    {
      id: 'consistency',
      title: 'Consistency',
      body: (
        <>
          <p>A font feels like a family when its letters share decisions. Pick rules and repeat them:</p>
          <ul>
            <li>The same stem thickness for vertical strokes (n, h, l, H).</li>
            <li>The same corner rounding and stroke endings (terminals).</li>
            <li>The same contrast between thick and thin strokes.</li>
          </ul>
          <p>Font-wide looks (pixels, rounding, weight) apply one rule to every glyph at once, which is why they stay consistent. Per-glyph edits are where you add character, so use them sparingly.</p>
        </>
      ),
    },
    {
      id: 'optical',
      title: 'Optical tricks',
      body: (
        <ul>
          <li>
            <strong>Overshoot</strong>: O, S and C go slightly past the baseline and cap height, or they look too small.
          </li>
          <li>
            <strong>Thinner horizontals</strong>: horizontal strokes look heavier than vertical ones of the same width, so make them a little thinner.
          </li>
          <li>
            <strong>Raised middles</strong>: the crossbar of H, the middle of E and the waist of S sit a touch above the true centre, or the letter looks bottom-heavy.
          </li>
          <li>
            <strong>Open counters</strong>: the holes in a, e, g and o should stay open at small sizes. If they clog, lower the weight or rounding.
          </li>
        </ul>
      ),
    },
    {
      id: 'display',
      title: 'Logo or text font?',
      body: (
        <>
          <p>
            <strong>Display and logo fonts</strong> are seen big and briefly. They can be tight, quirky, pixelated or melting. Test them on the actual word they'll spell.
          </p>
          <p>
            <strong>Text fonts</strong> are read for paragraphs. They need generous x-height, open counters, calm details and even spacing. Test them small in the tester with real sentences.
          </p>
          <p>Bitmap, dot and soft-pixel looks work best at sizes that line up with their grid. Big, flat colours keep them crisp.</p>
        </>
      ),
    },
    {
      id: 'workflow',
      title: 'A good workflow',
      body: (
        <ol>
          <li>Start from a base font that's close to what you want, or start blank and draw.</li>
          <li>Apply a look to every glyph (the Font tab), then adjust Spacing.</li>
          <li>Fix the key letters first: H O n o set the rhythm, then the hard ones: a e g R S.</li>
          <li>
            Test real words: <em>Hamburgefonstiv</em>, your brand name, and the sample sentence.
          </li>
          <li>Give it its own name, then use it in Design or export it.</li>
        </ol>
      ),
    },
    {
      id: 'naming',
      title: 'Names and licences',
      body: (
        <>
          <p>A changed font is a new font, so it needs a new name. The fonts bundled with Morphotype use the SIL Open Font License: you can modify and share them, but the result must not use their reserved names and must keep the OFL.</p>
          <p>Fonts you import keep their own licence terms. Check them before you sell or publish something built from them.</p>
        </>
      ),
    },
  ];
}

export function TypeGuideDialog({ topic }: { topic?: string }) {
  const base = useStore((s) => s.project.type?.base ?? 'archivo');
  const list = topics(base);
  const [cur, setCur] = useState(topic ?? list[0].id);
  const t = list.find((x) => x.id === cur) ?? list[0];
  return (
    <Dialog title="Type basics" subtitle="Five minutes of theory that make every font better." onClose={() => store.set({ dialog: null })} size="lg">
      <div className="guide">
        <nav className="guide-nav" aria-label="Topics">
          {list.map((x, i) => (
            <button key={x.id} className={x.id === t.id ? 'on' : ''} onClick={() => setCur(x.id)}>
              <span className="guide-num">{i + 1}</span>
              {x.title}
            </button>
          ))}
        </nav>
        <article className="guide-body">
          <h3>{t.title}</h3>
          {t.body}
          <div className="guide-foot">
            {list.indexOf(t) < list.length - 1 && (
              <button className="btn" onClick={() => setCur(list[list.indexOf(t) + 1].id)}>
                Next: {list[list.indexOf(t) + 1].title}
              </button>
            )}
          </div>
        </article>
      </div>
    </Dialog>
  );
}
