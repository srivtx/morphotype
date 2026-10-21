// The poster deck: one collectible card per new animated poster, fanned out.
// Cards tilt toward the pointer under a foil, play their loop on hover (one at
// a time), and open in an inspector where they turn over to show their timeline.
import { DECK, SHOWCASES } from './showcases.js';

const CARDS = DECK.map((id) => SHOWCASES.find((s) => s.id === id));

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ---------- Colour ---------- */

const rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (c) => `#${c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (h) => {
  const [r, g, b] = rgb(h).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const sat = (h) => {
  const c = rgb(h);
  return (Math.max(...c) - Math.min(...c)) / 255;
};

/** The card's colours: its scene background, plus the most vivid ink for the foil rim. */
function tones(s) {
  const c1 = s.bg[0];
  const accent = [...s.palette].slice(1).sort((a, b) => sat(b) - sat(a))[0] || '#8b72ff';
  const dark = lum(c1) < 0.32;
  return {
    '--c1': c1,
    '--c1l': mix(c1, '#ffffff', dark ? 0.16 : 0.45),
    '--c1d': mix(c1, '#000000', dark ? 0.35 : 0.12),
    '--fg': dark ? '#f6f2ea' : '#16141c',
    '--chip': dark ? 'rgba(255,255,255,0.12)' : 'rgba(20,16,28,0.08)',
    '--rimA': mix(accent, '#ffffff', 0.55),
    '--rimB': mix(accent, '#000000', 0.12),
  };
}

const fmt = (v) => (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v)) : String(+v.toFixed(2)));

/* ---------- Card markup ---------- */

function front(s, i) {
  const stats = s.settings
    .map((st) => {
      const v = clamp((st.value - st.min) / (st.max - st.min), 0, 1);
      const v2 = st.to == null ? null : clamp((st.to - st.min) / (st.max - st.min), 0, 1);
      return `<li><span>${esc(st.label)}</span><i class="meter${v2 == null ? '' : ' to'}" style="--v:${v.toFixed(3)}${v2 == null ? '' : `;--v2:${v2.toFixed(3)}`}"></i><b>${fmt(st.value)}${st.to == null ? '' : `→${fmt(st.to)}`}</b></li>`;
    })
    .join('');
  const sw = s.palette.slice(0, 5).map((c) => `<i style="background:${c}"></i>`).join('');
  return `
    <div class="face front"><div class="panel"><div class="foil"></div>
      <div class="tc-head"><b class="tc-name">${esc(s.title)}</b><span class="tc-no">No.${String(i + 1).padStart(2, '0')}/${String(CARDS.length).padStart(2, '0')}</span></div>
      <div class="tc-art"><img src="/media/${s.id}.webp" alt="" loading="lazy" decoding="async" /><video muted loop playsinline preload="none" data-src="/media/${s.id}.mp4"></video></div>
      <div class="tc-type"><span class="tc-chip">${esc(s.material)}</span><span class="tc-meta">${s.duration.toFixed(1)} s · ${s.layers} layers</span></div>
      <ul class="tc-stats">${stats}</ul>
      <p class="tc-flavor">${esc(s.flavor)}</p>
      <div class="tc-foot"><span class="tc-sw">${sw}</span><span class="tc-mark">MORPHOTYPE</span></div>
    </div><div class="glare"></div></div>`;
}

function lanes(track, D) {
  if (track.start != null) {
    const l = (track.start / D) * 100, w = Math.max(1.5, ((track.end - track.start) / D) * 100);
    return `<i class="k-${track.kind}" style="left:${l}%;width:${w}%"></i>`;
  }
  const p = track.period ? (track.period / D) * 100 : 100;
  return `<i class="k-${track.kind}" style="left:0;width:100%;--p:${p}%"></i>`;
}

function back(s) {
  const MAX = 7;
  const rows = s.rows.slice(0, MAX).map((r) => {
    const tracks = r.tracks.length ? r.tracks.map((t) => `<div class="bk-lane">${lanes(t, s.duration)}</div>`).join('') : '<div class="bk-lane"></div>';
    return `<div class="bk-row" data-depth="${Math.min(r.depth, 2)}"><span>${esc(r.name)}</span><div class="bk-lanes">${tracks}</div></div>`;
  });
  const more = s.rows.length > MAX ? `<p class="bk-more">and ${s.rows.length - MAX} more rows</p>` : '';
  const ticks = Array.from({ length: Math.round(s.duration) + 1 }, (_, i) => `<span>${i}s</span>`).join('');
  const all = s.rows.flatMap((r) => r.tracks);
  const count = (k) => all.filter((t) => t.kind === k).length;
  const kinds = [['enter', 'Comes in'], ['leave', 'Then'], ['loop', 'Loop'], ['param', 'Setting'], ['flow', 'Flows']].filter(([k]) => count(k));
  const legend = kinds.map(([k, label]) => `<span><i class="k-${k}"></i>${label} ${count(k)}</span>`).join('');
  const facts = `<div class="bk-facts"><div><b>${s.layers}</b><span>Layers</span></div><div><b>${s.rows.length}</b><span>Moving</span></div><div><b>${all.length}</b><span>Tracks</span></div><div><b>${s.duration * 30}</b><span>Frames</span></div></div>`;
  return `
    <div class="face back"><div class="panel"><div class="foil"></div>
      <div class="bk-top"><img src="/icon.png" alt="" /><div><b>${esc(s.title)}</b><span>Timeline · ${s.duration.toFixed(1)} s</span></div></div>
      <div class="bk-tl"><div class="bk-ruler">${ticks}</div>${rows.join('')}</div>
      ${more}
      <div class="bk-legend">${legend}</div>
      ${facts}
      <p class="bk-foot">Open it in Morphotype: <b>Templates › Learn › Animated · ${esc(s.title)}</b></p>
    </div><div class="glare"></div></div>`;
}

function makeCard(s, i) {
  const el = document.createElement('article');
  el.className = 'tcard';
  el.tabIndex = 0;
  el.dataset.i = i;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${s.title}: ${s.material}. Open card`);
  for (const [k, v] of Object.entries(tones(s))) el.style.setProperty(k, v);
  el.innerHTML = `<div class="tcard-tilt"><div class="tcard-flip">${front(s, i)}${back(s)}</div></div>`;
  return el;
}

/* ---------- Foil texture ---------- */

function sparkle() {
  const c = document.createElement('canvas');
  c.width = c.height = 90;
  const g = c.getContext('2d');
  const img = g.createImageData(90, 90);
  for (let i = 0; i < 90 * 90; i++) {
    const r = Math.random();
    img.data[i * 4 + 3] = r < 0.035 ? 255 : r < 0.12 ? 190 : 90;
  }
  g.putImageData(img, 0, 0);
  document.documentElement.style.setProperty('--sparkle', `url(${c.toDataURL()})`);
}

/* ---------- Tilt, eased toward the pointer ---------- */

function tilter(el, range) {
  const st = { rx: 0, ry: 0, tx: 0, ty: 0, raf: 0 };
  const step = () => {
    st.rx += (st.tx - st.rx) * 0.16;
    st.ry += (st.ty - st.ry) * 0.16;
    el.style.setProperty('--rx', `${st.rx.toFixed(2)}deg`);
    el.style.setProperty('--ry', `${st.ry.toFixed(2)}deg`);
    st.raf = Math.abs(st.tx - st.rx) + Math.abs(st.ty - st.ry) > 0.05 ? requestAnimationFrame(step) : 0;
  };
  const kick = () => st.raf || (st.raf = requestAnimationFrame(step));
  return {
    move(e) {
      const r = el.getBoundingClientRect();
      const px = clamp((e.clientX - r.left) / r.width, 0, 1), py = clamp((e.clientY - r.top) / r.height, 0, 1);
      if (!reduced) {
        st.tx = (0.5 - py) * range;
        st.ty = (px - 0.5) * range * 1.2;
      }
      el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
      el.style.setProperty('--fx', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--fy', `${(py * 100).toFixed(1)}%`);
      el.style.setProperty('--hov', '1');
      kick();
    },
    leave() {
      st.tx = st.ty = 0;
      el.style.setProperty('--hov', '0');
      kick();
    },
  };
}

function playIn(card, on) {
  const v = $('video', card);
  if (!v) return;
  if (on && !reduced) {
    if (!v.src) v.src = v.dataset.src;
    v.onplaying = () => v.classList.add('playing');
    v.play().catch(() => {});
  } else {
    v.pause();
  }
}

/* ---------- The fan ---------- */

/** Where each card sits in the fan, after ref 10: a loose, overlapping spread. */
const FAN = [
  { a: -7, y: 34 },
  { a: 4, y: 52 },
  { a: -3, y: 6 },
  { a: 2, y: 0 },
  { a: 5, y: 44 },
  { a: -4, y: 16 },
];

export function deck() {
  sparkle();
  const hand = $('[data-hand]');
  const cards = CARDS.map((s, i) => makeCard(s, i));
  cards.forEach((c) => hand.append(c));
  const tilts = cards.map((c) => tilter(c, 16));
  const narrow = () => matchMedia('(max-width: 720px)').matches;
  // Overlap more when the fan would be wider than the page.
  const spacing = () => {
    const w = cards[0].offsetWidth;
    return Math.min(w * 0.8, (hand.clientWidth - w * 1.15) / (cards.length - 1));
  };
  let hover = -1;

  const layout = () => {
    if (narrow()) return;
    const n = cards.length;
    cards.forEach((c, i) => {
      const f = FAN[i % FAN.length];
      const on = i === hover;
      c.style.setProperty('--x', `${((i - (n - 1) / 2) * spacing()).toFixed(1)}px`);
      c.style.setProperty('--a', `${on ? f.a * 0.35 : f.a}deg`);
      c.style.setProperty('--lift', `${on ? f.y - 48 : f.y}px`);
      c.style.setProperty('--sc', on ? 1.07 : 1);
      c.style.setProperty('--z', on ? 60 : i + 1);
    });
  };

  const setHover = (i) => {
    if (i === hover) return;
    if (hover >= 0) {
      playIn(cards[hover], false);
      tilts[hover].leave();
    }
    hover = i;
    if (i >= 0) playIn(cards[i], true);
    layout();
  };

  // Which card the pointer is on, by fixed columns across the fan: lifting a
  // card never moves the boundaries, so hovering one can't hand off to another.
  const pick = (e) => {
    const r = hand.getBoundingClientRect();
    const n = cards.length, w = spacing();
    const i = Math.round((e.clientX - (r.left + r.width / 2)) / w + (n - 1) / 2);
    const edge = Math.abs(e.clientX - (r.left + r.width / 2)) <= w * (n / 2) + cards[0].offsetWidth * 0.1;
    return edge && i >= 0 && i < n ? i : -1;
  };
  hand.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || narrow()) return;
    const i = pick(e);
    setHover(i);
    if (i >= 0) tilts[i].move(e);
  });
  hand.addEventListener('pointerleave', () => !narrow() && setHover(-1));
  hand.addEventListener('click', (e) => {
    if (narrow()) return;
    const i = pick(e);
    if (i >= 0) inspector.open(i, cards[i]);
  });

  cards.forEach((c, i) => {
    c.style.setProperty('--delay', `${i * 70}ms`);
    c.addEventListener('focus', () => !narrow() && setHover(i));
    // Phones: the cards are a swipeable row and take their own taps.
    c.addEventListener('click', () => narrow() && inspector.open(i, c));
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        inspector.open(i, c);
      }
    });
  });
  hand.addEventListener('focusout', (e) => !hand.contains(e.relatedTarget) && setHover(-1));
  addEventListener('resize', layout);
  layout();

  // Deal the fan when it comes into view, then drop the stagger so hovers are quick.
  new IntersectionObserver(
    ([en], io) => {
      if (!en.isIntersecting) return;
      hand.classList.add('dealt');
      io.disconnect();
      setTimeout(() => cards.forEach((c) => c.style.setProperty('--delay', '0ms')), 1400);
    },
    { threshold: 0.3 },
  ).observe(hand);

  // On phones the fan is a swipeable row: only the card nearest the middle
  // plays, and only while the row is on screen.
  let onScreen = false, playing = -1;
  const centred = () => {
    if (!narrow()) return;
    const r = hand.getBoundingClientRect(), mid = r.left + r.width / 2;
    let best = -1, dist = Infinity;
    cards.forEach((c, i) => {
      const b = c.getBoundingClientRect(), d = Math.abs(b.left + b.width / 2 - mid);
      if (d < dist) (best = i), (dist = d);
    });
    const next = onScreen ? best : -1;
    if (next === playing) return;
    if (playing >= 0) playIn(cards[playing], false);
    playing = next;
    if (next >= 0) playIn(cards[next], true);
  };
  new IntersectionObserver(([en]) => ((onScreen = en.isIntersecting), centred()), { threshold: 0.4 }).observe(hand);
  let settle = 0;
  hand.addEventListener('scroll', () => (clearTimeout(settle), (settle = setTimeout(centred, 120))), { passive: true });

  const inspector = makeInspector(cards);
}

/* ---------- Inspector ---------- */

function makeInspector(cards) {
  const root = $('[data-inspector]');
  const stage = $('[data-stage]', root);
  let index = -1, card = null, tilt = null, source = null, swiped = false;

  const angleOf = (el) => parseFloat(el.style.getPropertyValue('--a')) || 0;

  const mount = (i) => {
    const s = CARDS[i];
    card = makeCard(s, i);
    card.removeAttribute('role');
    card.setAttribute('aria-label', `${s.title}. Click to turn over`);
    stage.replaceChildren(card);
    tilt = tilter(card, 22);
    card.addEventListener('pointermove', (e) => tilt.move(e));
    card.addEventListener('pointerleave', () => tilt.leave());
    card.addEventListener('click', () => (swiped ? (swiped = false) : flip()));
    playIn(card, true);
  };

  const flip = () => card?.classList.toggle('flipped');

  const flyFrom = (el, reverse = false) => {
    const a = el.getBoundingClientRect(), b = stage.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const from = `translate(${dx}px, ${dy}px) scale(${a.width / b.width}) rotate(${angleOf(el)}deg)`;
    const frames = [{ transform: from }, { transform: 'none' }];
    return stage.animate(reverse ? frames.reverse() : frames, { duration: reduced ? 1 : reverse ? 420 : 640, easing: reverse ? 'cubic-bezier(.5,0,.75,0)' : 'cubic-bezier(.2,.9,.25,1.08)', fill: 'both' });
  };

  const open = (i, el) => {
    index = i;
    source = el;
    mount(i);
    root.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    void root.offsetWidth;
    root.classList.add('open');
    el.style.visibility = 'hidden';
    flyFrom(el);
    $('[data-flip]', root).focus({ preventScroll: true });
  };

  const close = async () => {
    if (index < 0) return;
    root.classList.remove('open');
    playIn(card, false);
    const target = cards[index];
    const visible = target.getBoundingClientRect();
    if (visible.bottom > 0 && visible.top < innerHeight) {
      card.classList.remove('flipped');
      // Never let a stalled animation (a background tab) keep the page locked.
      await Promise.race([flyFrom(target, true).finished.catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
    }
    target.style.visibility = '';
    stage.getAnimations().forEach((a) => a.cancel());
    root.hidden = true;
    document.documentElement.style.overflow = '';
    target.focus({ preventScroll: true });
    index = -1;
    source = null;
  };

  const go = (d) => {
    if (index < 0) return;
    cards[index].style.visibility = '';
    const next = (index + d + cards.length) % cards.length;
    const out = card;
    out.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-d * 60}px) rotate(${-d * 8}deg)`, opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
    setTimeout(() => {
      playIn(out, false);
      index = next;
      cards[next].style.visibility = 'hidden';
      mount(next);
      card.animate([{ transform: `translateX(${d * 60}px) rotate(${d * 8}deg)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.9,.25,1.1)' });
    }, reduced ? 0 : 200);
  };

  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  $('[data-flip]', root).addEventListener('click', flip);
  $('[data-prev]', root).addEventListener('click', () => go(-1));
  $('[data-next]', root).addEventListener('click', () => go(1));
  addEventListener('keydown', (e) => {
    if (index < 0) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'f' || e.key === 'F') flip();
  });

  // Swipe between cards on touch screens.
  let sx = null;
  stage.addEventListener('pointerdown', (e) => e.pointerType !== 'mouse' && (sx = e.clientX));
  stage.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) {
      swiped = true;
      go(dx < 0 ? 1 : -1);
    }
  });

  return { open, close };
}
