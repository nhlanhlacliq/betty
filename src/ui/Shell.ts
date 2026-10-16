/**
 * The app shell: which screen is showing, bottom sheets, the toast, and the desktop layout.
 *
 * Screens and sheets are static markup in index.html (`<section data-screen="...">`, `<div data-sheet="...">`), so
 * the controls inside them exist from page load and main.ts can bind them by id. This module only shows and hides.
 * Markup hooks, all delegated from the document:
 *   data-go="screen"          show that screen
 *   data-back                 go back to the previous screen
 *   data-nav="screen"         a bottom-nav button (marked active while its screen shows)
 *   data-sheet-open="sheet"   open a sheet; data-sheet-close closes the open one (so does the backdrop and Escape)
 */
import { hydrateIcons } from './icons';

export type ScreenId = 'home' | 'ride' | 'journeys' | 'story' | 'explore' | 'settings' | 'workshop';

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
}

/** Desktop wide enough for a side column: the Workshop lives there, always open, instead of being a screen. */
const WIDE = '(min-width: 1100px)';

export function mountShell(doc: Document = document): Shell {
  hydrateIcons(doc.body);
  const screens = new Map<ScreenId, HTMLElement>();
  doc.querySelectorAll<HTMLElement>('[data-screen]').forEach((s) => screens.set(s.dataset.screen as ScreenId, s));
  const showFns: Array<(id: ScreenId) => void> = [];
  const sheetFns: Array<(id: string) => void> = [];
  const history: ScreenId[] = [];
  let current: ScreenId = 'home';
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const paint = () => {
    for (const [id, el] of screens) if (!el.classList.contains('docked')) el.hidden = id !== current;
    doc.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) => {
      const on = b.dataset.nav === current || (b.dataset.nav === 'journeys' && current === 'story');
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const theme = screens.get(current)?.dataset.theme ?? 'light';
    doc.documentElement.dataset.screenTheme = theme;
  };

  const shell: Shell = {
    get current() { return current; },
    show(id) {
      if (!screens.has(id)) return;
      // In the wide layout the Workshop is always open beside the phone; "showing" it just scrolls it into view.
      if (id === 'workshop' && workshopDocked()) { screens.get(id)?.scrollIntoView?.({ behavior: 'smooth' }); return; }
      if (id !== current) history.push(current);
      if (history.length > 20) history.shift();
      current = id;
      shell.closeSheet();
      paint();
      showFns.forEach((f) => f(id));
      screens.get(id)?.querySelector<HTMLElement>('.scroll')?.scrollTo?.({ top: 0 });
    },
    back() {
      const prev = history.pop() ?? 'home';
      current = prev;
      paint();
      showFns.forEach((f) => f(prev));
    },
    openSheet(id) {
      shell.closeSheet();
      const sheet = doc.querySelector<HTMLElement>(`[data-sheet="${id}"]`);
      if (!sheet) return;
      sheetFns.forEach((f) => f(id));
      sheet.hidden = false;
      sheet.querySelector<HTMLElement>('button, input, select')?.focus?.({ preventScroll: true });
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
  };

  doc.addEventListener('click', (e) => {
    const t = (e.target as Element | null)?.closest?.('[data-go],[data-back],[data-sheet-open],[data-sheet-close],[data-sheet]');
    if (!t) return;
    const el = t as HTMLElement;
    if (el.dataset.go) shell.show(el.dataset.go as ScreenId);
    else if (el.hasAttribute('data-back')) shell.back();
    else if (el.dataset.sheetOpen) shell.openSheet(el.dataset.sheetOpen);
    else if (el.hasAttribute('data-sheet-close')) shell.closeSheet();
    else if (el.dataset.sheet && e.target === el) shell.closeSheet(); // a tap on the backdrop, not inside the sheet
  });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') shell.closeSheet(); });

  // Desktop: move the Workshop section out of the phone into the side column (and back on a narrow window).
  // Moving a node keeps its listeners, so the panels inside it carry on working.
  const workshop = screens.get('workshop');
  const studio = doc.getElementById('studio');
  const phone = doc.getElementById('phone');
  const mq = doc.defaultView?.matchMedia?.(WIDE);
  const workshopDocked = () => !!workshop && workshop.parentElement === studio;
  const dock = () => {
    if (!workshop || !studio || !phone) return;
    if (mq?.matches) {
      if (current === 'workshop') shell.back();
      studio.append(workshop);
      workshop.hidden = false;
      workshop.classList.add('docked');
    } else if (workshopDocked()) {
      phone.append(workshop);
      workshop.classList.remove('docked');
      workshop.hidden = current !== 'workshop';
    }
  };
  mq?.addEventListener?.('change', dock);
  paint();
  dock();
  return shell;
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
