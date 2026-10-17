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
    if (!screen || screen.hidden || t?.closest?.('[data-sheet], .chat-list, input, textarea, select') || !ctx.canRefresh() || screen.scrollTop > 0) { screen = null; return; }
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
