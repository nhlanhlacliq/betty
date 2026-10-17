/**
 * Touch gestures the app needs because its screens scroll inside a fixed frame (and the installed app has no browser
 * pull-to-refresh at all), owner 2026-10-17:
 * - Pull down at the top of any screen to reload the app. Never during a ride: a reload would end it.
 * - Drag an open sheet down to close it (from its handle, or anywhere once its content is scrolled to the top).
 */
import type { Shell } from './Shell';

/** How far (px, after damping) a pull must travel before letting go reloads or closes. */
export const REFRESH_AT = 64;
export const CLOSE_AT = 110;
/** A quick flick closes a sheet sooner: px per ms. */
const FLICK = 0.6;

/** What a pull of `dy` px means: the indicator offset (damped) and whether letting go now reloads. */
export function pullState(dy: number): { offset: number; armed: boolean } {
  const offset = Math.min(Math.max(0, dy) * 0.5, 90);
  return { offset, armed: offset >= REFRESH_AT };
}
/** Whether letting a sheet go after dragging it `dy` px in `ms` closes it. */
export const shouldClose = (dy: number, ms: number) => dy >= CLOSE_AT || (dy > 40 && dy / Math.max(1, ms) >= FLICK);

const point = (e: TouchEvent) => e.touches[0] ?? e.changedTouches[0];

export function mountPullToRefresh(doc: Document, ctx: { canRefresh(): boolean; reload(): void }) {
  const host = doc.getElementById('device') ?? doc.body;
  const pill = doc.createElement('div');
  pill.className = 'ptr'; pill.setAttribute('aria-hidden', 'true'); pill.textContent = 'Pull to refresh';
  host.append(pill);
  let startY = 0, startX = 0, pulling = false, screen: HTMLElement | null = null, state = { offset: 0, armed: false };

  const reset = () => { pulling = false; pill.classList.remove('show', 'armed'); pill.style.transform = ''; };
  doc.addEventListener('touchstart', (e) => {
    const t = e.target as Element | null;
    screen = t?.closest?.('.screen') as HTMLElement | null;
    // Not inside a sheet, a scrolled list, or anywhere while riding.
    // Not inside a sheet, a scrolled list, a field or a map (dragging a map pans it), or anywhere while riding.
    if (!screen || screen.hidden || t?.closest?.('[data-sheet], .chat-list, input, textarea, select, .ride-map, .ride-dock, .active-dock') || !ctx.canRefresh() || screen.scrollTop > 0) { screen = null; return; }
    const p = point(e); startY = p.clientY; startX = p.clientX; pulling = false;
  }, { passive: true });
  doc.addEventListener('touchmove', (e) => {
    if (!screen) return;
    const p = point(e); const dy = p.clientY - startY, dx = p.clientX - startX;
    if (!pulling && (dy < 8 || Math.abs(dx) > dy || screen.scrollTop > 0)) { if (dy < 0 || Math.abs(dx) > dy) screen = null; return; }
    pulling = true;
    e.preventDefault(); // stop the page bouncing while the pill follows the finger
    state = pullState(dy);
    pill.classList.add('show'); pill.classList.toggle('armed', state.armed);
    pill.textContent = state.armed ? 'Release to refresh' : 'Pull to refresh';
    pill.style.transform = `translate(-50%, ${state.offset}px)`;
  }, { passive: false });
  doc.addEventListener('touchend', () => {
    if (!screen) return;
    screen = null;
    if (pulling && state.armed) { pill.textContent = 'Refreshing...'; ctx.reload(); return; }
    reset();
  });
  doc.addEventListener('touchcancel', () => { screen = null; reset(); });
}

export function mountSheetDrag(doc: Document, shell: Shell) {
  let sheet: HTMLElement | null = null, startY = 0, startAt = 0, dy = 0, dragging = false;
  doc.addEventListener('touchstart', (e) => {
    const t = e.target as Element | null;
    const s = t?.closest?.('.sheet') as HTMLElement | null;
    if (!s || t?.closest?.('input, textarea, select, [type=range]')) { sheet = null; return; }
    // From the handle always; from the body only when it is not scrolled (so its content still scrolls up).
    if (!t?.closest?.('.sheet-handle') && s.scrollTop > 0) { sheet = null; return; }
    sheet = s; startY = point(e).clientY; startAt = Date.now(); dy = 0; dragging = false;
  }, { passive: true });
  doc.addEventListener('touchmove', (e) => {
    if (!sheet) return;
    dy = point(e).clientY - startY;
    if (!dragging && (dy < 6 || sheet.scrollTop > 0)) { if (dy < 0) sheet = null; return; }
    dragging = true;
    e.preventDefault();
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = () => {
    if (!sheet) return;
    const s = sheet; sheet = null;
    if (!dragging) return;
    s.style.transition = 'transform .2s ease';
    if (shouldClose(dy, Date.now() - startAt)) {
      s.style.transform = 'translateY(100%)';
      setTimeout(() => { shell.closeSheet(); s.style.transform = ''; s.style.transition = ''; }, 180);
    } else {
      s.style.transform = '';
      setTimeout(() => { s.style.transition = ''; }, 220);
    }
  };
  doc.addEventListener('touchend', end);
  doc.addEventListener('touchcancel', end);
}

/** Screens that go back to where he came from: a ride's story, the whole conversation, the Workshop. */
export const BACK_SCREENS = new Set(['story', 'chat', 'workshop']);
/** A back swipe starts within this many px of the left edge, and goes back past BACK_AT px (or a quick flick). */
const EDGE = 36;
export const BACK_AT = 90;
export const shouldGoBack = (dx: number, dy: number, ms: number) => Math.abs(dy) < Math.max(60, dx * 0.6) && (dx >= BACK_AT || (dx > 40 && dx / Math.max(1, ms) >= FLICK));

/** Swipe right from the left edge to go back, as in iPhone apps (the installed app has no browser back gesture). */
export function mountSwipeBack(doc: Document, shell: Shell) {
  let screen: HTMLElement | null = null, startX = 0, startY = 0, startAt = 0, dx = 0, dy = 0, dragging = false;
  doc.addEventListener('touchstart', (e) => {
    const p = point(e);
    const t = e.target as Element | null;
    const s = t?.closest?.('.screen') as HTMLElement | null;
    screen = null;
    if (!s || !BACK_SCREENS.has(s.dataset.screen ?? '') || shell.current !== s.dataset.screen || t?.closest?.('[data-sheet], input, textarea, select')) return;
    const left = s.getBoundingClientRect?.().left ?? 0;
    if (p.clientX - left > EDGE) return;
    screen = s; startX = p.clientX; startY = p.clientY; startAt = Date.now(); dx = 0; dy = 0; dragging = false;
  }, { passive: true });
  doc.addEventListener('touchmove', (e) => {
    if (!screen) return;
    const p = point(e); dx = p.clientX - startX; dy = p.clientY - startY;
    if (!dragging && (dx < 8 || Math.abs(dy) > dx)) { if (Math.abs(dy) > 12) screen = null; return; }
    dragging = true;
    e.preventDefault();
    screen.classList.add('swiping');
    screen.style.transform = `translateX(${Math.max(0, dx)}px)`;
  }, { passive: false });
  const end = () => {
    if (!screen) return;
    const s = screen; screen = null;
    if (!dragging) return;
    s.classList.remove('swiping'); s.classList.add('swipe-settle');
    const back = shouldGoBack(dx, dy, Date.now() - startAt);
    s.style.transform = back ? 'translateX(100%)' : '';
    setTimeout(() => { s.classList.remove('swipe-settle'); s.style.transform = ''; if (back) shell.back(); }, 190);
  };
  doc.addEventListener('touchend', end);
  doc.addEventListener('touchcancel', end);
}

/**
 * Edge stretch (owner, 2026-10-17: "make the top and bottom anchors stretch just a tiny bit"): pulling past the top
 * or bottom of a screen stretches it slightly, the edge he pulls from staying pinned, and it springs back. Replaces
 * the iPhone's bounce (which moved the whole screen). The map and the panels have their own gestures.
 */
export function edgeStretch(dy: number): number { return 1 + 0.035 * (1 - Math.exp(-Math.abs(dy) / 140)); }

export function mountEdgeStretch(doc: Document) {
  let screen: HTMLElement | null = null, y0 = 0, x0 = 0, dir: 'top' | 'bottom' | null = null;
  doc.addEventListener('touchstart', (e) => {
    const t = e.target as Element | null;
    screen = t?.closest?.('.screen') as HTMLElement | null;
    if (!screen || t?.closest?.('[data-sheet], .ride-map, .ride-dock, .active-dock, input, textarea, select, .chat-list')) { screen = null; return; }
    const p = point(e); y0 = p.clientY; x0 = p.clientX; dir = null;
  }, { passive: true });
  doc.addEventListener('touchmove', (e) => {
    if (!screen) return;
    const p = point(e); const dy = p.clientY - y0, dx = p.clientX - x0;
    if (Math.abs(dx) > Math.abs(dy)) return;
    const atTop = screen.scrollTop <= 0, atBottom = screen.scrollTop + screen.clientHeight >= screen.scrollHeight - 1;
    dir = dy > 0 && atTop ? 'top' : dy < 0 && atBottom ? 'bottom' : null;
    if (!dir) { screen.style.transform = ''; return; }
    screen.style.transition = 'none';
    screen.style.transformOrigin = dir === 'top' ? '50% 0' : '50% 100%';
    screen.style.transform = `scaleY(${edgeStretch(dy).toFixed(4)})`;
  }, { passive: true });
  const end = () => {
    if (!screen) return;
    const s = screen; screen = null;
    if (!s.style.transform) return;
    s.style.transition = 'transform .3s cubic-bezier(.2, .9, .3, 1.15)';
    s.style.transform = '';
    setTimeout(() => { s.style.transition = ''; s.style.transformOrigin = ''; }, 320);
  };
  doc.addEventListener('touchend', end);
  doc.addEventListener('touchcancel', end);
}

/**
 * A refresh keeps him where he was (owner, 2026-10-17: it went back to Home): the screen, the ride whose story was
 * open, and how far down the screen was scrolled, kept in sessionStorage for the one reload.
 */
const RESTORE_KEY = 'betty.restore';
/** Screens that make sense after a reload (the ride and its chat need a ride running). */
const RESTORABLE = new Set(['home', 'journeys', 'story', 'explore', 'settings', 'workshop']);
export interface Spot { screen: string; ride?: number; scroll: number }

export function rememberSpot(spot: Spot, store: Pick<Storage, 'setItem'> = sessionStorage) {
  try { store.setItem(RESTORE_KEY, JSON.stringify(spot)); } catch { /* storage blocked */ }
}
/** The spot saved before the reload, once (it is removed as it is read); null if none or not restorable. */
export function takeSpot(store: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage): Spot | null {
  try {
    const raw = store.getItem(RESTORE_KEY);
    store.removeItem(RESTORE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && RESTORABLE.has(s.screen) && (s.screen !== 'story' || Number.isFinite(s.ride)) ? s : null;
  } catch { return null; }
}
