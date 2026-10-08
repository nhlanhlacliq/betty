import { el } from './dom';

export interface LockScreen {
  lock(): void;
  unlock(): void;
  readonly locked: boolean;
  /** What the locked screen shows: current speed and Betty's latest line. */
  setInfo(speed: string, line: string): void;
}

/**
 * Full-screen cover that swallows every touch so rain, a glove or a sleeve cannot press anything.
 * The only way out is holding the unlock button for holdMs; a brush or a raindrop is too short to count.
 * The page stays in front underneath, so the screen wake lock keeps holding.
 */
export function mountLockScreen(root: HTMLElement, holdMs = 1000): LockScreen {
  const cover = el('div', 'lockcover');
  cover.hidden = true;
  const speed = el('div', 'lockspeed', '0');
  const unit = el('div', 'lockunit', 'km/h');
  const line = el('div', 'lockline');
  const btn = el('button', 'lockbtn', 'HOLD TO UNLOCK');
  btn.type = 'button';
  cover.append(el('div', 'locktitle', 'LOCKED'), speed, unit, line, btn);
  root.append(cover);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const api: LockScreen = {
    get locked() { return !cover.hidden; },
    lock() { cover.hidden = false; },
    unlock() { cancel(); cover.hidden = true; },
    setInfo(s, l) { speed.textContent = s; line.textContent = l; },
  };
  const cancel = () => { clearTimeout(timer); timer = undefined; btn.classList.remove('holding'); };
  const begin = (e: Event) => {
    e.preventDefault();
    cancel();
    btn.classList.add('holding');
    timer = setTimeout(() => api.unlock(), holdMs);
  };
  btn.style.setProperty('--hold', `${holdMs}ms`);
  btn.addEventListener('pointerdown', begin);
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(t, cancel);
  // Nothing underneath may scroll, zoom, select or open a menu while locked.
  for (const t of ['touchmove', 'wheel', 'contextmenu', 'click', 'dblclick']) {
    cover.addEventListener(t, (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  }
  return api;
}
