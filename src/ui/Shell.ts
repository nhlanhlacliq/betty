/**
 * The app shell: which screen is showing, dialogs, and the toast.
 *
 * Screens and dialogs are static markup in index.html (`<section data-screen="...">`, `<div data-sheet="...">`), so
 * the controls inside them exist from page load and main.ts can bind them by id. This module only shows and hides.
 * Markup hooks, all delegated from the document:
 *   data-go="screen"          show that screen
 *   data-back                 go back to the previous screen
 *   data-nav="screen"         a navigation button (marked active while its screen, or one under it, shows)
 *   data-sheet-open="sheet"   open a dialog; data-sheet-close closes it (so do the backdrop and Escape)
 */
import { hydrateIcons } from './icons';

export type ScreenId = 'home' | 'ride' | 'chat' | 'journeys' | 'story' | 'explore' | 'settings' | 'workshop';

/** Which navigation button is lit for each screen. */
const NAV_OF: Record<ScreenId, ScreenId> = {
  home: 'home', ride: 'home', chat: 'home', journeys: 'journeys', story: 'journeys', explore: 'explore', settings: 'settings', workshop: 'settings',
};

export interface Shell {
  readonly current: ScreenId;
  show(id: ScreenId): void;
  back(): void;
  openSheet(id: string): void;
  closeSheet(): void;
  toast(msg: string, err?: boolean): void;
  /** Called with the screen id every time a screen is shown (screens refresh their content then). */
  onShow(fn: (id: ScreenId) => void): void;
  onSheet(fn: (id: string) => void): void;
  /** Rewrite a navigation target (while a ride runs, "Ride" goes to the ride, not the start page). */
  setRedirect(fn: (id: ScreenId) => ScreenId): void;
}

export function mountShell(doc: Document = document): Shell {
  hydrateIcons(doc.body);
  const screens = new Map<ScreenId, HTMLElement>();
  doc.querySelectorAll<HTMLElement>('[data-screen]').forEach((s) => screens.set(s.dataset.screen as ScreenId, s));
  const showFns: Array<(id: ScreenId) => void> = [];
  const sheetFns: Array<(id: string) => void> = [];
  const history: ScreenId[] = [];
  let current: ScreenId = 'home';
  let redirect = (id: ScreenId) => id;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const paint = () => {
    for (const [id, el] of screens) if (!docked(el)) el.hidden = id !== current;
    doc.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) => {
      const on = b.dataset.nav === NAV_OF[current];
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    doc.documentElement.dataset.view = current;
  };
  const enter = (id: ScreenId) => {
    current = id;
    shell.closeSheet();
    paint();
    showFns.forEach((f) => f(id));
    const win = doc.defaultView;
    if (win && !/jsdom/.test(win.navigator.userAgent)) win.scrollTo({ top: 0 }); // jsdom has no scrolling
  };

  const shell: Shell = {
    get current() { return current; },
    show(target) {
      const id = redirect(target);
      if (!screens.has(id)) return;
      // In the wide layout the Workshop is always open beside the phone; "showing" it just brings it into view.
      if (docked(screens.get(id)!)) { screens.get(id)!.scrollIntoView?.({ behavior: 'smooth' }); return; }
      if (id !== current) history.push(current);
      if (history.length > 20) history.shift();
      enter(id);
    },
    back() { enter(redirect(history.pop() ?? 'home')); },
    openSheet(id) {
      shell.closeSheet();
      const sheet = doc.querySelector<HTMLElement>(`[data-sheet="${id}"]`);
      if (!sheet) return;
      sheetFns.forEach((f) => f(id));
      sheet.hidden = false;
      sheet.querySelector<HTMLElement>('.primary, button')?.focus?.({ preventScroll: true });
    },
    closeSheet() { doc.querySelectorAll<HTMLElement>('[data-sheet]').forEach((s) => { s.hidden = true; }); },
    toast(msg, err = false) {
      const t = doc.getElementById('toast');
      if (!t) return;
      t.textContent = msg;
      t.classList.toggle('err', err);
      t.hidden = !msg;
      clearTimeout(toastTimer);
      if (msg) toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3200);
    },
    onShow(fn) { showFns.push(fn); },
    onSheet(fn) { sheetFns.push(fn); },
    setRedirect(fn) { redirect = fn; },
  };

  doc.addEventListener('click', (e) => {
    const t = (e.target as Element | null)?.closest?.('[data-go],[data-back],[data-sheet-open],[data-sheet-close],[data-sheet]');
    if (!t) return;
    const el = t as HTMLElement;
    if (el.dataset.go) shell.show(el.dataset.go as ScreenId);
    else if (el.hasAttribute('data-back')) shell.back();
    else if (el.dataset.sheetOpen) shell.openSheet(el.dataset.sheetOpen);
    else if (el.hasAttribute('data-sheet-close')) shell.closeSheet();
    else if (el.dataset.sheet && e.target === el) shell.closeSheet(); // a tap on the backdrop, not inside the dialog
  });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') shell.closeSheet(); });

  // Wide screen: the Workshop section moves out of the phone into the column beside it (and back on a narrow
  // window). Moving a node keeps its listeners, so the panels inside it carry on working.
  const workshop = screens.get('workshop');
  const studio = doc.getElementById('studio');
  const device = doc.getElementById('device');
  const mq = doc.defaultView?.matchMedia?.(WIDE);
  const docked = (el: HTMLElement) => !!studio && el.parentElement === studio;
  const dock = () => {
    if (!workshop || !studio || !device) return;
    if (mq?.matches) {
      if (current === 'workshop') shell.back();
      studio.append(workshop);
      workshop.hidden = false;
    } else if (docked(workshop)) {
      device.insertBefore(workshop, device.querySelector('.tab-bar'));
      workshop.hidden = current !== 'workshop';
    }
  };
  mq?.addEventListener?.('change', dock);
  paint();
  dock();
  // The frame's clock on a computer (a phone shows its own status bar).
  const clock = doc.getElementById('clock');
  const tick = () => { if (clock) clock.textContent = new Date().toTimeString().slice(0, 5); };
  tick();
  if (clock && !/jsdom/.test(doc.defaultView?.navigator.userAgent ?? '')) setInterval(tick, 20_000);
  return shell;
}

/** Wide enough for the Workshop beside the phone. */
const WIDE = '(min-width: 1100px)';

/**
 * Keep a screen's `--dock-h` equal to the height of its bottom dock, so the map ends where the dock begins and the
 * map buttons sit just above it, whatever the dock holds (a long line from Betty, a short phone).
 */
export function followDock(screen: HTMLElement, dock: HTMLElement) {
  const win = screen.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  const set = () => { if (dock.offsetHeight) screen.style.setProperty('--dock-h', `${dock.offsetHeight}px`); };
  if (win && 'ResizeObserver' in win) new win.ResizeObserver(set).observe(dock);
  set();
}

/** Copy text to the clipboard, falling back to a hidden textarea where the async clipboard is not available. */
export async function copyText(text: string, doc: Document = document): Promise<boolean> {
  try {
    const nav = doc.defaultView?.navigator;
    if (nav?.clipboard && doc.defaultView?.isSecureContext) { await nav.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const field = doc.createElement('textarea');
  field.value = text; doc.body.append(field); field.select();
  try { return doc.execCommand?.('copy') ?? false; } catch { return false; } finally { field.remove(); }
}

/** Offer text as a file download. */
export function downloadText(name: string, text: string, doc: Document = document) {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win?.URL?.createObjectURL) return false;
  const a = doc.createElement('a');
  a.href = win.URL.createObjectURL(new win.Blob([text], { type: 'text/plain' }));
  a.download = name;
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => win.URL.revokeObjectURL(a.href), 1000);
  return true;
}
