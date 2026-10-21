// The motion section, on the reel from v1: one scene playing at a time on a
// big stage, a stepper and a pause button over it, and arrows to either side.
// Under the stage are that scene's real timeline rows, laid out the way the
// app's timeline dock lays them out, with a playhead that follows the video.
// Dragging across the rows scrubs.
import { REEL, SHOWCASES } from './showcases.js';
import { stepper } from './stepper.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const FPS = 30;
/** Each scene plays this many loops before the reel moves on. */
const LOOPS = 2;

const SCENES = REEL.map((id) => SHOWCASES.find((s) => s.id === id));

function rowsHTML(s) {
  const D = s.duration;
  return s.rows
    .map((r) => {
      const lanes = (r.tracks.length ? r.tracks : [null])
        .map((t) => {
          if (!t) return '<div class="tl-lane empty"></div>';
          if (t.start != null) {
            const l = (t.start / D) * 100, w = Math.max(2, ((t.end - t.start) / D) * 100);
            const steps = (t.steps ?? []).slice(1).map((st) => `<span class="step" style="left:${(((st.start - t.start) / (t.end - t.start)) * 100).toFixed(2)}%"></span>`).join('');
            return `<div class="tl-lane"><span class="clip k-${t.kind}" data-start="${t.start}" data-end="${t.end}" style="left:${l}%;width:${w}%" title="${esc(t.label)} · ${t.start.toFixed(2)}–${t.end.toFixed(2)} s">${esc(t.label)}${steps}</span></div>`;
          }
          const p = t.period ? (t.period / D) * 100 : 100;
          const tip = t.period ? `${t.label} · every ${+t.period.toFixed(2)} s` : t.label;
          return `<div class="tl-lane"><span class="clip k-${t.kind}" style="left:0;width:100%;--p:${p}%" title="${esc(tip)}">${esc(t.label)}</span></div>`;
        })
        .join('');
      return `<div class="tl-row" data-depth="${Math.min(r.depth, 2)}"><div class="tl-name" title="${esc(r.name)}">${esc(r.name)}</div><div class="tl-lanes">${lanes}</div></div>`;
    })
    .join('');
}

function rulerHTML(D) {
  let out = '';
  for (let f = 0; f <= D * FPS; f += FPS / 4) {
    const t = f / FPS, x = (t / D) * 100;
    const major = f % FPS === 0;
    out += `<i class="${major ? 'major' : ''}" style="left:${x}%"></i>`;
    if (major && t < D) out += `<span style="left:${x}%">${t}s</span>`;
  }
  return out;
}

export function timeline() {
  const frame = $('[data-reel]');
  const media = $('.reel-media', frame);
  const play = $('.reel-play', frame);
  const title = $('[data-reel-title]'), note = $('[data-reel-note]');
  const dock = $('[data-tl-dock]');
  const head = $('[data-tl-head]', dock);
  const rowsEl = $('[data-tl-rows]', dock);
  const ruler = $('[data-tl-ruler]', dock);
  const time = $('[data-tl-time]');

  const videos = SCENES.map((s) => {
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'none';
    v.poster = `/media/${s.id}.webp`;
    v.dataset.src = `/media/${s.id}.mp4`;
    v.setAttribute('aria-label', `${s.title}: ${s.flavor}`);
    media.append(v);
    return v;
  });

  let cur = 0, inView = false, userPaused = false, scrubbing = false, raf = 0, clips = [];

  const render = (i) => {
    const s = SCENES[i];
    rowsEl.innerHTML = rowsHTML(s);
    ruler.innerHTML = rulerHTML(s.duration);
    clips = [...rowsEl.querySelectorAll('.clip[data-start]')].map((el) => ({ el, a: +el.dataset.start, b: +el.dataset.end }));
    title.textContent = s.title;
    note.textContent = s.flavor;
  };

  const paint = () => {
    const v = videos[cur], D = SCENES[cur].duration;
    const t = v.currentTime % D;
    head.style.setProperty('--t', (t / D).toFixed(4));
    time.textContent = `${t.toFixed(2)} s · f${Math.round(t * FPS)}`;
    for (const c of clips) c.el.classList.toggle('live', t >= c.a && t <= c.b);
  };
  // The playhead only runs while a video plays on screen.
  const tick = () => {
    paint();
    raf = videos[cur].paused ? 0 : requestAnimationFrame(tick);
  };
  const run = () => raf || (raf = requestAnimationFrame(tick));

  const show = (i) => {
    cur = i;
    videos.forEach((v, k) => {
      if (k === i) {
        if (!v.src && inView) v.src = v.dataset.src;
        v.currentTime = 0;
        v.classList.add('on');
        if (inView && !userPaused && !reduced) v.play().then(run, () => {});
      } else {
        v.classList.remove('on');
        v.pause();
      }
    });
    // Warm the next one (videos load only once the reel is on screen).
    const n = videos[(i + 1) % videos.length];
    if (!n.src && inView) {
      n.preload = 'auto';
      n.src = n.dataset.src;
    }
    render(i);
    paint();
  };

  const steps = stepper($('.pasito', frame), SCENES.length, { duration: (i) => SCENES[i].duration * LOOPS * 1000, onChange: (i) => show(i) });
  show(0);
  $('.prev', frame).addEventListener('click', () => steps.set(steps.index - 1, true));
  $('.next', frame).addEventListener('click', () => steps.set(steps.index + 1, true));

  const pause = (on) => {
    userPaused = on;
    play.classList.toggle('paused', on);
    play.setAttribute('aria-label', on ? 'Play' : 'Pause');
    const v = videos[steps.index];
    if (on) {
      steps.pause();
      v.pause();
    } else {
      steps.play();
      v.play().then(run, () => {});
    }
  };
  play.addEventListener('click', () => pause(!userPaused));

  // Scrub: drag across the rows to move through the loop (the reel holds still).
  const seek = (e) => {
    const r = rowsEl.getBoundingClientRect();
    const u = clamp((e.clientX - r.left - parseFloat(getComputedStyle(dock).getPropertyValue('--name'))) / (r.width - parseFloat(getComputedStyle(dock).getPropertyValue('--name')) - 14), 0, 1);
    videos[cur].currentTime = u * SCENES[cur].duration;
    paint();
  };
  dock.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    scrubbing = true;
    dock.setPointerCapture(e.pointerId);
    if (!userPaused) pause(true);
    seek(e);
  });
  dock.addEventListener('pointermove', (e) => scrubbing && seek(e));
  dock.addEventListener('pointerup', () => (scrubbing = false));

  if (reduced) {
    userPaused = true;
    play.classList.add('paused');
    play.setAttribute('aria-label', 'Play');
  }
  new IntersectionObserver(
    ([en]) => {
      const first = en.isIntersecting && !videos[steps.index].src;
      inView = en.isIntersecting;
      if (first) show(steps.index);
      const v = videos[steps.index];
      if (inView && !userPaused && !reduced) {
        v.play().then(run, () => {});
        steps.play();
      } else {
        v.pause();
        steps.pause();
      }
    },
    { threshold: 0.35 },
  ).observe(frame);
}
