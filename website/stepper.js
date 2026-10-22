// A Pasito-style stepper (after joshpuckett/pasito), shared by the hero's
// material switch and the reel of animated posters.

/** Dots, an active pill, and a fill while autoplaying. */
export function stepper(el, count, { duration, labels, onChange }) {
  if (labels) el.classList.add('labelled');
  const buttons = Array.from({ length: count }, (_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', labels ? labels[i] : `Show ${i + 1} of ${count}`);
    if (labels) b.innerHTML = `<span>${labels[i]}</span>`;
    b.addEventListener('click', () => api.set(i, true));
    el.append(b);
    return b;
  });
  let active = 0, timer = 0, playing = false, held = 0;
  const fill = () => {
    const b = buttons[active];
    b.classList.remove('fill');
    if (!playing) return;
    b.style.setProperty('--fill', `${duration(active)}ms`);
    void b.offsetWidth;
    b.classList.add('fill');
  };
  const schedule = () => {
    clearTimeout(timer);
    if (playing) timer = setTimeout(() => api.set((active + 1) % count), duration(active));
  };
  const api = {
    get index() { return active; },
    set(i, byUser = false) {
      buttons[active].classList.remove('on', 'fill');
      buttons[active].setAttribute('aria-selected', 'false');
      active = (i + count) % count;
      buttons[active].classList.add('on');
      buttons[active].setAttribute('aria-selected', 'true');
      onChange(active, byUser);
      if (byUser && playing) {
        // A pick holds for a while before autoplay resumes.
        api.pause();
        clearTimeout(held);
        held = setTimeout(() => api.play(), 9000);
      }
      fill();
      schedule();
    },
    play() { playing = true; fill(); schedule(); },
    pause() { playing = false; clearTimeout(timer); buttons[active].classList.remove('fill'); },
    get playing() { return playing; },
  };
  buttons[0].classList.add('on');
  buttons[0].setAttribute('aria-selected', 'true');
  return api;
}
