import { CHANGELOG, ChangeDay } from '../changelog';
import { buildTime } from './ChangelogPanel';

/**
 * Garage > What's new (owner, 2026-10-17): the changelog with an unread count, on the Garage card and the Garage tab.
 * Entries are only ever added at the top, so "seen" is simply how many items he has seen; opening the sheet marks
 * them all read. A first visit counts only the newest day as new, not the whole history.
 */
const SEEN_KEY = 'betty.seen.v1';

export const totalItems = (log: ChangeDay[]) => log.reduce((n, d) => n + d.items.length, 0);
export function unreadCount(log: ChangeDay[], seen: number | null): number {
  const total = totalItems(log);
  if (seen === null) return log[0]?.items.length ?? 0;
  return Math.max(0, total - seen);
}

export interface SeenStore { get(): number | null; set(n: number): void }
export const LocalSeen: SeenStore = {
  get() { try { const v = localStorage.getItem(SEEN_KEY); return v === null ? null : Number(v) || 0; } catch { return null; } },
  set(n) { try { localStorage.setItem(SEEN_KEY, String(n)); } catch { /* storage blocked */ } },
};

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function mountWhatsNew(doc: Document, store: SeenStore = LocalSeen, log: ChangeDay[] = CHANGELOG, built = buildTime()) {
  const $ = (id: string) => doc.getElementById(id);
  const paint = () => {
    const n = unreadCount(log, store.get());
    for (const id of ['whatsnewbadge', 'garagebadge']) {
      const b = $(id);
      if (b) { b.textContent = n > 9 ? '9+' : String(n); b.hidden = n === 0; }
    }
    const sub = $('whatsnewsub');
    if (sub) sub.textContent = n ? `${n} new update${n === 1 ? '' : 's'} since you last looked` : `Up to date${built ? `, version of ${stamp(built)}` : ''}`;
  };
  const render = () => {
    const list = $('whatsnewlist');
    if (!list) return;
    let unread = unreadCount(log, store.get());
    list.innerHTML = log.map((d) => `<h3>${esc(d.date)}</h3><ul class="changes">${d.items.map((it) => `<li${unread-- > 0 ? ' class="new"' : ''}>${esc(it)}</li>`).join('')}</ul>`).join('');
    const v = $('whatsnewversion');
    if (v) v.textContent = built ? `This version: ${stamp(built)}` : 'Development build';
  };
  // Opening it shows what is new (marked), then counts everything as read.
  $('whatsnewopen')?.addEventListener('click', () => { render(); store.set(totalItems(log)); paint(); });
  render(); paint();
  return { paint };
}

const stamp = (iso: string) => new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
