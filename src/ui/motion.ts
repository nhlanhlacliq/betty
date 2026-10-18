import { CONFIG } from '../config/betty';

/**
 * Little animations (owner, 2026-10-18: toasts, her line word by word, numbers counting up, Done on a reminder, the
 * story's road drawing itself, the What's new badge, button presses, Horizon growing and glowing). ONE switch turns
 * them all off: Garage > Betty's personality > Little animations (`CONFIG.motion`), and the phone's Reduce Motion
 * does too. While on, <html> has the class `motion`; every one of these animations in app.css sits under `.motion`, and
 * the script-driven ones below check `motionOn()` first. Off = things simply appear, nothing else changes.
 */
export function motionOn(doc: Document = document): boolean {
  if (!CONFIG.motion) return false;
  try { return !doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}

/** Put the switch on <html> (at load and whenever the config changes). */
export function applyMotion(doc: Document = document) {
  doc.documentElement.classList.toggle('motion', motionOn(doc));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * Her line, word by word, about as fast as she says it (subtitles): each word fades in on its own delay. The whole
 * line is there for screen readers at once (aria-label). Speech runs near 165 words a minute; a long line is
 * squeezed into 9 s so the end never lags far behind her voice.
 */
export function revealWords(el: HTMLElement, text: string, doc: Document = document) {
  if (!motionOn(doc)) { el.textContent = text; return; }
  const words = text.split(/\s+/).filter(Boolean);
  const step = Math.min(340, 9000 / Math.max(1, words.length));
  el.setAttribute('aria-label', text);
  el.innerHTML = words.map((w, i) => `<span class="word" aria-hidden="true" style="animation-delay:${Math.round(i * step)}ms">${esc(w)}</span>`).join(' ');
}

/**
 * Numbers that CHANGED since he last saw them count from the old value to the new one, keeping their format
 * ("1,234 km", "R312", "2h 19m"). Unchanged numbers just show (owner, 2026-10-18: counting up every time distracted).
 * What he last saw is kept per `key` on the phone (`betty.counted.v1`), so it also holds across visits.
 */
const SEEN_KEY = 'betty.counted.v1';
let seenCache: Record<string, string> | null = null;
const seenStore = (doc: Document): Record<string, string> => {
  if (seenCache) return seenCache;
  try { seenCache = JSON.parse(doc.defaultView?.localStorage.getItem(SEEN_KEY) ?? '{}') ?? {}; } catch { seenCache = {}; }
  return seenCache!;
};
const saveSeen = (doc: Document) => { try { doc.defaultView?.localStorage.setItem(SEEN_KEY, JSON.stringify(seenStore(doc))); } catch { /* private mode */ } };
const NUM = /(\d[\d,]*(?:\.\d+)?)/;

export function countUp(el: HTMLElement, key: string, ms = 700, doc: Document = document) {
  const text = el.textContent ?? '';
  const seen = seenStore(doc);
  const before = seen[key];
  seen[key] = text;
  if (!motionOn(doc) || before === undefined || before === text) return;
  const parts = text.split(NUM);
  const old = before.split(NUM);
  const nums = parts.map((p, i) => (i % 2 ? Number(p.replace(/,/g, '')) : null));
  // From the old numbers when the text has the same shape ("12 km" -> "15 km"), otherwise from zero.
  const from = parts.map((p, i) => (i % 2 && old.length === parts.length ? Number(old[i].replace(/,/g, '')) || 0 : 0));
  if (!nums.some((n, i) => n != null && n !== from[i])) return;
  el.dataset.counted = text;
  const win = doc.defaultView;
  if (!win?.requestAnimationFrame) return;
  const t0 = win.performance.now();
  const fmt = (n: number, like: string) => {
    const dp = like.split('.')[1]?.length ?? 0;
    const s = n.toFixed(dp);
    return like.includes(',') ? Number(s).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : s;
  };
  const frame = (t: number) => {
    if (el.dataset.counted !== text) return; // repainted meanwhile
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3); // ease out
    el.textContent = parts.map((p, i) => (i % 2 ? fmt(from[i] + ((nums[i] as number) - from[i]) * e, p) : p)).join('');
    if (k < 1) win.requestAnimationFrame(frame); else el.textContent = text;
  };
  win.requestAnimationFrame(frame);
}

/** Count every changed number in these elements (a screen just shown); each is known by `prefix` and its label. */
export function countUpAll(root: ParentNode, selector: string, prefix: string, doc: Document = document) {
  root.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
    const label = el.parentElement?.querySelector('small')?.textContent?.trim();
    countUp(el, `${prefix}:${label || i}`, 700, doc);
  });
  saveSeen(doc);
}

/**
 * A ride's road draws itself only once the whole map is on screen (owner, 2026-10-18), so he sees it happen rather
 * than it finishing while the map is still below the fold. Until then the road waits undrawn (`.motion` only).
 */
export function drawWhenSeen(map: Element | null, doc: Document = document) {
  if (!map) return;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!motionOn(doc) || !win?.IntersectionObserver) { map.classList.add('drawn'); return; }
  const io = new win.IntersectionObserver((entries) => {
    if (!entries.some((e) => e.intersectionRatio >= 0.95)) return;
    io.disconnect();
    map.classList.add('drawing');
    setTimeout(() => map.classList.add('drawn'), 1800);
  }, { root: map.closest('.screen'), threshold: [0.95] });
  io.observe(map);
}

/** Play a CSS animation class once (restarting it if it is already on). */
export function play(el: Element | null, cls: string) {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

/**
 * Rows moving to their new places after a repaint (FLIP): `before` = their positions by key, taken just before the
 * repaint; each row found again under the same key slides from where it was.
 */
export function positions(root: ParentNode, selector: string, key: (el: HTMLElement) => string | undefined): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => { const k = key(el); if (k) out.set(k, el.getBoundingClientRect()); });
  return out;
}
export function slideFrom(before: Map<string, DOMRect>, root: ParentNode, selector: string, key: (el: HTMLElement) => string | undefined, doc: Document = document) {
  if (!motionOn(doc)) return;
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const k = key(el), was = k ? before.get(k) : undefined;
    if (!was || typeof el.animate !== 'function') return;
    const dy = was.top - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 2) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1)' });
  });
}

/**
 * An element changing size (Horizon growing or shrinking): from its old box to its new one, smoothly. The parts in
 * `hold` keep their FINAL width while the box animates (the box clips them), so text never re-wraps into a narrow
 * column on the way (owner, 2026-10-18: Horizon's text flashed up as tall vertical text while it grew).
 */
export function resize(el: HTMLElement, change: () => void, doc: Document = document, hold: HTMLElement[] = []) {
  if (!motionOn(doc) || typeof el.animate !== 'function' || el.hidden) { change(); return; }
  const a = el.getBoundingClientRect();
  change();
  const b = el.getBoundingClientRect();
  if (el.hidden || (Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2)) return;
  const held = hold.filter((h) => !h.hidden).map((h) => ({ h, w: h.getBoundingClientRect().width }));
  for (const { h, w } of held) { h.style.width = `${w}px`; h.style.flex = 'none'; }
  el.style.overflow = 'hidden';
  const anim = el.animate([{ width: `${a.width}px`, height: `${a.height}px` }, { width: `${b.width}px`, height: `${b.height}px` }],
    { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)' });
  const release = () => { for (const { h } of held) { h.style.width = ''; h.style.flex = ''; } el.style.overflow = ''; };
  anim.onfinish = release; anim.oncancel = release;
}

/** A tiny buzz under the finger on the main buttons (Android; iPhone Safari has no vibration for web pages). */
export function mountPressFeel(doc: Document = document) {
  doc.addEventListener('pointerdown', (e) => {
    if (!motionOn(doc)) return;
    const b = (e.target as Element | null)?.closest?.('button.primary, .end-button');
    if (b && !(b as HTMLButtonElement).disabled) { try { doc.defaultView?.navigator.vibrate?.(8); } catch { /* not allowed */ } }
  }, { passive: true });
}
