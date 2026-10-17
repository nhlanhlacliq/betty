/**
 * Service reminders (owner, 2026-10-17): chain, service, tyres... each due by distance, by time, or both, counted from
 * when it was last done. Distance comes from Betty's odometer: every km ridden with her, which he can set to the
 * bike's own reading in Garage so a "next service at 30,000 km" lines up. Pure, so it is tested.
 */
export interface Reminder {
  id: string;
  name: string;
  /** Due this many km after it was last done (null = not by distance) */
  everyKm: number | null;
  /** Due this many days after it was last done (null = not by time) */
  everyDays: number | null;
  /** Odometer (km) and time (ms) when it was last done */
  lastKm: number;
  lastAt: number;
}
export interface ServiceBook { odoKm: number; items: Reminder[] }

export type DueState = 'ok' | 'soon' | 'due';
export interface DueInfo { r: Reminder; state: DueState; kmLeft: number | null; daysLeft: number | null }

const DAY = 86_400_000;
/** "Soon": within a tenth of the interval, at least 100 km or 7 days. */
const soonKm = (every: number) => Math.max(100, every * 0.1);
const soonDays = (every: number) => Math.max(7, every * 0.1);

export function dueInfo(r: Reminder, odoKm: number, now: number): DueInfo {
  const kmLeft = r.everyKm != null ? Math.round(r.lastKm + r.everyKm - odoKm) : null;
  const daysLeft = r.everyDays != null ? Math.ceil((r.lastAt + r.everyDays * DAY - now) / DAY) : null;
  const due = (kmLeft != null && kmLeft <= 0) || (daysLeft != null && daysLeft <= 0);
  const soon = (kmLeft != null && kmLeft <= soonKm(r.everyKm!)) || (daysLeft != null && daysLeft <= soonDays(r.everyDays!));
  return { r, state: due ? 'due' : soon ? 'soon' : 'ok', kmLeft, daysLeft };
}

/** Every reminder with its state, the most pressing first. */
export function dueList(book: ServiceBook, now: number): DueInfo[] {
  const rank: Record<DueState, number> = { due: 0, soon: 1, ok: 2 };
  const urgency = (d: DueInfo) => Math.min(d.kmLeft != null ? d.kmLeft / 50 : Infinity, d.daysLeft ?? Infinity); // ~50 km a day of riding
  return book.items.map((r) => dueInfo(r, book.odoKm, now)).sort((a, b) => rank[a.state] - rank[b.state] || urgency(a) - urgency(b));
}

/** "in 420 km", "in 12 days", "620 km overdue", "due today". */
export function dueText(d: DueInfo): string {
  const parts: string[] = [];
  if (d.kmLeft != null) parts.push(d.kmLeft > 0 ? `in ${d.kmLeft.toLocaleString('en-US')} km` : d.kmLeft === 0 ? 'due now' : `${(-d.kmLeft).toLocaleString('en-US')} km overdue`);
  if (d.daysLeft != null) {
    const days = d.daysLeft;
    const t = days > 540 ? `${Math.round(days / 365)} years` : days > 60 ? `${Math.round(days / 30)} months` : days > 1 ? `${days} days` : days === 1 ? 'a day' : '';
    parts.push(days > 0 ? `in ${t}` : days === 0 ? 'due today' : `${-days} day${days === -1 ? '' : 's'} overdue`);
  }
  // Both given: the one that comes first matters.
  if (parts.length === 2 && d.state !== 'ok') return parts.find((p) => /overdue|due/.test(p)) ?? parts.join(' or ');
  return parts.join(' or ') || 'no interval set';
}

/** Done: counted again from here. */
export const markDone = (book: ServiceBook, id: string, now: number): ServiceBook =>
  ({ ...book, items: book.items.map((r) => (r.id === id ? { ...r, lastKm: book.odoKm, lastAt: now } : r)) });

/**
 * A starting set, counted from today (edit "last done" in Garage if it was longer ago). Intervals are common
 * guidance, not the bike's handbook: the service one should be checked against his service book.
 */
export function starterBook(odoKm: number, now: number): ServiceBook {
  const r = (id: string, name: string, everyKm: number | null, everyDays: number | null): Reminder => ({ id, name, everyKm, everyDays, lastKm: odoKm, lastAt: now });
  return { odoKm, items: [
    r('chain', 'Chain clean and lube', 600, null),
    r('tyres', 'Tyre pressures', null, 14),
    r('service', 'Service', 10_000, 365),
    r('tyreage', 'Tyre age check', null, 365 * 5),
  ] };
}

/** Which reminder he means by "chain done", "I serviced the bike", "checked the tyres": word stems in common. */
const stems = (t: string) => t.toLowerCase().replace(/tire/g, 'tyre').split(/[^a-z]+/).filter((w) => w.length > 2 && !['the', 'and', 'check', 'checked', 'done', 'bike', 'her', 'its', 'did', 'just', 'got'].includes(w)).map((w) => w.slice(0, 4));
export function findReminder(items: Reminder[], said: string): Reminder | null {
  const want = new Set(stems(said));
  let best: Reminder | null = null, bestHits = 0;
  for (const r of items) {
    const hits = stems(r.name).filter((s) => want.has(s)).length;
    if (hits > bestHits) { best = r; bestHits = hits; }
  }
  return best;
}

/** Her words about what is due, for the briefing, answers and the sign-off ('' when nothing is due or close). */
export function describeDue(book: ServiceBook, now: number, all = false): string {
  const list = dueList(book, now).filter((d) => all || d.state !== 'ok');
  if (!list.length) return all ? 'No maintenance reminders set.' : '';
  return `Maintenance: ${list.map((d) => `${d.r.name} ${d.state === 'ok' ? dueText(d) : `${d.state === 'due' ? 'is due' : 'is coming up'} (${dueText(d)})`}`).join('; ')}.`;
}
