// The motion section: a showcase loop above its real timeline rows, laid out
// the way the app's timeline dock lays them out. The playhead follows the
// video, dragging across the dock scrubs it, and switching showcases
// pixelates out of one and into the next.
import { SHOWCASES } from './showcases.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const FPS = 30;

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
  const root = $('[data-tl]');
  const video = $('[data-tl-video]', root);
  const fx = $('[data-tl-fx]', root);
  const fctx = fx.getContext('2d');
  const tiny = document.createElement('canvas');
  const tctx = tiny.getContext('2d');
  const dock = $('[data-tl-dock]', root);
  const head = $('[data-tl-head]', root);
  const rowsEl = $('[data-tl-rows]', root);
  const ruler = $('[data-tl-ruler]', root);
  const title = $('[data-tl-title]', root);
  const time = $('[data-tl-time]', root);
  const playBtn = $('[data-tl-play]', root);
  const picker = $('[data-tl-picker]');

  let cur = 0, clips = [], inView = false, userPaused = false, scrubbing = false, switching = false;
  let loops = 0, lastT = 0, touched = 0;

  const chips = SHOWCASES.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tl-chip';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === 0));
    b.innerHTML = `<img src="/media/${s.id}.webp" alt="" loading="lazy" />${esc(s.title)}`;
    b.addEventListener('click', () => {
      touched = performance.now();
      show(i);
    });
    picker.append(b);
    return b;
  });

  const render = (i) => {
    const s = SHOWCASES[i];
    title.textContent = `Animated · ${s.title}`;
    ruler.innerHTML = rulerHTML(s.duration);
    rowsEl.innerHTML = rowsHTML(s);
    clips = [...rowsEl.querySelectorAll('.clip[data-start]')].map((el) => ({ el, a: +el.dataset.start, b: +el.dataset.end }));
    chips.forEach((c, k) => {
      c.setAttribute('aria-selected', String(k === i));
      c.style.setProperty('--prog', 0);
    });
  };

  /** Draw the current video frame in blocks of `size` pixels. */
  const pixelate = (size) => {
    const w = (fx.width = fx.clientWidth), h = (fx.height = fx.clientHeight);
    const tw = Math.max(1, Math.round(w / size)), th = Math.max(1, Math.round(h / size));
    tiny.width = tw;
    tiny.height = th;
    tctx.drawImage(video, 0, 0, tw, th);
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(tiny, 0, 0, w, h);
  };
  const tween = (ms, fn) =>
    new Promise((res) => {
      const t0 = performance.now();
      const step = (now) => {
        const k = clamp((now - t0) / ms, 0, 1);
        fn(k);
        k < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });

  const load = (i) =>
    new Promise((res) => {
      video.addEventListener('loadeddata', res, { once: true });
      video.src = `/media/${SHOWCASES[i].id}.mp4`;
    });

  const show = async (i) => {
    if (switching || i === cur) return;
    switching = true;
    const animate = !reduced && video.readyState >= 2;
    if (animate) {
      fx.classList.add('on');
      await tween(260, (k) => pixelate(1 + k * k * 40));
    }
    cur = i;
    loops = 0;
    await load(i);
    render(i);
    if (inView && !userPaused) video.play().catch(() => {});
    if (animate) {
      await tween(360, (k) => pixelate(1 + (1 - k) ** 2 * 40));
      fx.classList.remove('on');
    }
    switching = false;
  };

  // Playhead, readout, live clips and the chip's progress follow the video.
  const tick = () => {
    const D = SHOWCASES[cur].duration;
    const t = clamp(video.currentTime || 0, 0, D);
    head.style.setProperty('--t', (t / D).toFixed(4));
    time.textContent = `${t.toFixed(2)} s · f${Math.round(t * FPS)}`;
    for (const c of clips) c.el.classList.toggle('live', t >= c.a && t <= c.b);
    chips[cur].style.setProperty('--prog', (t / D).toFixed(3));
    if (t + 0.5 < lastT) loops++;
    lastT = t;
    // Left alone, it moves on to the next showcase after a couple of loops.
    if (loops >= 2 && !scrubbing && !userPaused && performance.now() - touched > 15000) show((cur + 1) % SHOWCASES.length);
    if (inView) requestAnimationFrame(tick);
  };

  // Scrub by dragging anywhere across the dock.
  const timeAt = (x) => {
    const r = head.getBoundingClientRect();
    return clamp((x - r.left) / r.width, 0, 1) * SHOWCASES[cur].duration;
  };
  let wasPlaying = false, sx = 0, armed = false;
  dock.addEventListener('pointerdown', (e) => {
    sx = e.clientX;
    armed = true;
    if (e.pointerType === 'mouse') begin(e);
  });
  const begin = (e) => {
    scrubbing = true;
    touched = performance.now();
    wasPlaying = !video.paused;
    video.pause();
    video.currentTime = timeAt(e.clientX);
    dock.setPointerCapture(e.pointerId);
  };
  dock.addEventListener('pointermove', (e) => {
    if (!scrubbing && armed && e.pointerType !== 'mouse' && Math.abs(e.clientX - sx) > 8) begin(e);
    if (scrubbing) video.currentTime = timeAt(e.clientX);
  });
  const end = () => {
    armed = false;
    if (!scrubbing) return;
    scrubbing = false;
    lastT = video.currentTime;
    if (wasPlaying && !userPaused) video.play().catch(() => {});
  };
  dock.addEventListener('pointerup', end);
  dock.addEventListener('pointercancel', end);

  playBtn.addEventListener('click', () => {
    userPaused = !video.paused ? true : false;
    playBtn.classList.toggle('paused', userPaused);
    playBtn.setAttribute('aria-label', userPaused ? 'Play' : 'Pause');
    userPaused ? video.pause() : video.play().catch(() => {});
  });

  video.loop = true;
  video.muted = true;
  render(0);
  load(0);
  new IntersectionObserver(
    ([en]) => {
      const was = inView;
      inView = en.isIntersecting;
      if (inView && !was) {
        if (!userPaused && !reduced) video.play().catch(() => {});
        requestAnimationFrame(tick);
      } else if (!inView) video.pause();
    },
    { threshold: 0.3 },
  ).observe(root);
  if (reduced) {
    userPaused = true;
    playBtn.classList.add('paused');
  }
}
