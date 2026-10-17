/**
 * The home and ride panels slide down to a slim bar and back up (owner, 2026-10-17), so the map gets the screen:
 * swipe the panel down to slim it, up (or tap its handle) to bring it back. The state is remembered per screen.
 * The map already ends where the panel starts (followDock keeps --dock-h), so it re-frames on its own.
 */
const KEY = 'betty.dock.v1';
type Which = 'home' | 'ride';

const load = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };
const save = (which: Which, slim: boolean) => { try { localStorage.setItem(KEY, JSON.stringify({ ...load(), [which]: slim })); } catch { /* blocked */ } };

/**
 * The stretch while the finger pulls (owner: "a minor stretch that feels like it is pulling a bit but still
 * anchored"): the panel stays pinned to the bottom edge and only stretches or squashes a little, more slowly the
 * further he pulls. Pulling down on the full panel slides it (that is the slim preview).
 */
export function dockStretch(dy: number, slim: boolean): string {
  const give = 1 - Math.exp(-Math.abs(dy) / 120); // 0 -> 1, quickly at first, then resisting
  if (!slim && dy > 0) return `translateY(${Math.round(Math.min(dy, 120) * 0.6)}px)`;
  if (dy < 0) return `scaleY(${(1 + give * (slim ? 0.14 : 0.05)).toFixed(3)})`;
  return `scaleY(${(1 - give * 0.06).toFixed(3)})`;
}

/** What a vertical swipe of dy px on the panel does: 'slim' (down), 'full' (up) or nothing. */
export const dockSwipe = (dy: number, dx = 0): 'slim' | 'full' | null => (Math.abs(dx) > Math.abs(dy) ? null : dy > 40 ? 'slim' : dy < -40 ? 'full' : null);

export function mountCollapsibleDock(screen: HTMLElement, dock: HTMLElement, which: Which) {
  const set = (slim: boolean) => {
    screen.classList.toggle('dock-slim', slim);
    dock.setAttribute('aria-expanded', String(!slim));
    save(which, slim);
  };
  set(load()[which] === true);
  let y0 = 0, x0 = 0, dy = 0, dx = 0, on = false;
  dock.addEventListener('touchstart', (e) => {
    const t = e.target as Element;
    // Buttons and fields keep their taps; the panel's text area and handle take the swipe.
    if (t.closest('input, textarea, select, .voice-button') && !t.closest('[data-dock-handle]')) { on = false; return; }
    // Her line scrolls when it is long: a swipe there scrolls it, not the panel.
    const text = t.closest('#ridesub') as HTMLElement | null;
    if (text && text.scrollHeight > text.clientHeight) { on = false; return; }
    const p = e.touches[0]; y0 = p.clientY; x0 = p.clientX; dy = 0; dx = 0; on = true;
  }, { passive: true });
  dock.addEventListener('touchmove', (e) => {
    if (!on) return;
    const p = e.touches[0]; dy = p.clientY - y0; dx = p.clientX - x0;
    // A vertical swipe belongs to the panel: stop iPhone from scrolling or bouncing the page under it.
    if (Math.abs(dy) > Math.abs(dx) && e.cancelable) e.preventDefault();
    // Follow the finger with a little give, pinned to the bottom edge.
    if (Math.abs(dy) > Math.abs(dx)) { dock.style.transition = 'none'; dock.style.transform = dockStretch(dy, screen.classList.contains('dock-slim')); }
  }, { passive: false });
  const end = () => {
    if (!on) return;
    on = false; dock.style.transition = ''; dock.style.transform = ''; // springs back (the CSS transition)
    const what = dockSwipe(dy, dx);
    if (what) set(what === 'slim');
  };
  dock.addEventListener('touchend', end);
  dock.addEventListener('touchcancel', end);
  dock.querySelectorAll('[data-dock-handle]').forEach((h) => h.addEventListener('click', () => set(!screen.classList.contains('dock-slim'))));
  return { set, slim: () => screen.classList.contains('dock-slim') };
}
