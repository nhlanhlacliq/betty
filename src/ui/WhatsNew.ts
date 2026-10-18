import { CHANGELOG, Change, ChangeDay, ChangeKind } from '../changelog';
import { buildTime } from './ChangelogPanel';

/**
 * Garage > What's new (owner, 2026-10-17; tidied 2026-10-18). Each day has New, Better and Fixed, one entry per
 * feature with a short title, one sentence and a "How it works" link into Help. The newest day (and any day with
 * something unread) is open, older days fold to one line. The badge counts unread New and Better entries, not fixes.
 * Read state is the set of entry ids seen (`betty.seen.v2`); the old count (`betty.seen.v1`) means he had been using
 * it, so everything there today counts as read.
 */
const SEEN_KEY = 'betty.seen.v2';
const OLD_KEY = 'betty.seen.v1';

export const allIds = (log: ChangeDay[]) => log.flatMap((d) => d.items.map((c) => c.id));
/** Unread entries that are worth a badge (fixes are not). */
export const unreadCount = (log: ChangeDay[], seen: ReadonlySet<string>) =>
  log.reduce((n, d) => n + d.items.filter((c) => c.kind !== 'fixed' && !seen.has(c.id)).length, 0);

export interface SeenStore { get(): string[] | null; set(ids: string[]): void; hadOld(): boolean }
export const LocalSeen: SeenStore = {
  get() { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null'); return Array.isArray(v) ? v : null; } catch { return null; } },
  set(ids) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids)); } catch { /* storage blocked */ } },
  hadOld() { try { return localStorage.getItem(OLD_KEY) !== null; } catch { return false; } },
};

/** What he has seen: stored, or (first time with this version) everything if he used the old one, else all but the newest day. */
export function seenSet(log: ChangeDay[], store: SeenStore): Set<string> {
  const have = store.get();
  if (have) return new Set(have);
  const start = store.hadOld() ? allIds(log) : log.slice(1).flatMap((d) => d.items.map((c) => c.id));
  store.set(start);
  return new Set(start);
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const KINDS: Array<[ChangeKind, string]> = [['new', 'New'], ['better', 'Better'], ['fixed', 'Fixed']];
const dayLabel = (iso: string, now = new Date()) => {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};
const counts = (d: ChangeDay) => KINDS.map(([k, label]) => { const n = d.items.filter((c) => c.kind === k).length; return n ? `${n} ${label.toLowerCase()}` : ''; }).filter(Boolean).join(' · ');

export function mountWhatsNew(doc: Document, store: SeenStore = LocalSeen, log: ChangeDay[] = CHANGELOG, built = buildTime()) {
  const $ = (id: string) => doc.getElementById(id);
  const openDays = new Set<string>();
  let seen = seenSet(log, store);
  /** Read state as it was when the sheet opened, so the new ones stay marked while he reads. */
  let shownSeen = seen;

  const paint = () => {
    const n = unreadCount(log, seen);
    for (const id of ['whatsnewbadge', 'garagebadge']) {
      const b = $(id);
      if (b) { b.textContent = n > 9 ? '9+' : String(n); b.hidden = n === 0; }
    }
    const sub = $('whatsnewsub');
    if (sub) sub.textContent = n ? `${n} new update${n === 1 ? '' : 's'} since you last looked` : `Up to date${built ? `, version of ${stamp(built)}` : ''}`;
  };
  const item = (c: Change) => `<li class="change${shownSeen.has(c.id) || c.kind === 'fixed' ? '' : ' new'}"><b>${esc(c.title)}</b> ${esc(c.text)}${c.help ? ` <button class="text-button wn-help" type="button" data-help="${esc(c.help)}">How it works</button>` : ''}</li>`;
  const render = () => {
    const list = $('whatsnewlist');
    if (!list) return;
    list.innerHTML = log.map((d) => {
      const open = openDays.has(d.date);
      const body = KINDS.map(([k, label]) => {
        const items = d.items.filter((c) => c.kind === k);
        return items.length ? `<h4 class="wn-kind ${k}">${label}</h4><ul class="changes">${items.map(item).join('')}</ul>` : '';
      }).join('');
      return `<section class="wn-day${open ? ' open' : ''}"><button class="month-head wn-head" type="button" data-wn-day="${d.date}" aria-expanded="${open}"><span><b>${esc(dayLabel(d.date))}</b><small>${esc(counts(d))}</small></span><i class="chev" aria-hidden="true"></i></button>${open ? `<div class="wn-body">${body}</div>` : ''}</section>`;
    }).join('');
    const v = $('whatsnewversion');
    if (v) v.textContent = built ? `This version: ${stamp(built)}` : 'Development build';
  };
  $('whatsnewlist')?.addEventListener('click', (e) => {
    const h = (e.target as Element).closest<HTMLElement>('[data-wn-day]');
    if (!h) return;
    const d = h.dataset.wnDay!;
    if (openDays.has(d)) openDays.delete(d); else openDays.add(d);
    render();
  });
  // Opening: the newest day and any day with something unread are open, the new ones marked; then all count as read.
  $('whatsnewopen')?.addEventListener('click', () => {
    shownSeen = seen;
    openDays.clear();
    log.forEach((d, i) => { if (i === 0 || d.items.some((c) => c.kind !== 'fixed' && !seen.has(c.id))) openDays.add(d.date); });
    render();
    seen = new Set(allIds(log)); store.set([...seen]); paint();
  });
  if (log[0]) openDays.add(log[0].date);
  render(); paint();
  return { paint };
}

const stamp = (iso: string) => new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
