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
  /** From the bike's maintenance schedule (not one he added), with the handbook's wording */
  schedule?: boolean;
  note?: string;
  /** "Last done" is a guess (the last schedule milestone below the odometer): he has not confirmed it */
  assumed?: boolean;
  /** How it stood before the last Done, so Done can be taken back ("mark as not done") */
  prev?: { lastKm: number; lastAt: number; assumed?: boolean };
}
export interface ServiceBook {
  odoKm: number;
  items: Reminder[];
  /** Which bike's schedule this is (BIKES id); missing = the first, generic set of 2026-10-17 */
  bike?: string;
}

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
  ({ ...book, items: book.items.map((r) => (r.id === id ? { ...r, lastKm: book.odoKm, lastAt: now, assumed: false, prev: { lastKm: r.lastKm, lastAt: r.lastAt, assumed: r.assumed } } : r)) });

/** Not done after all (tapped by mistake, or "chain not done"): back to how it stood before the last Done. */
export const undoDone = (book: ServiceBook, id: string): ServiceBook =>
  ({ ...book, items: book.items.map((r) => {
    if (r.id !== id || !r.prev) return r;
    const { prev, ...rest } = r;
    return { ...rest, lastKm: prev.lastKm, lastAt: prev.lastAt, ...(prev.assumed ? { assumed: true } : { assumed: false }) };
  }) });

/** One line of a bike's maintenance schedule. */
export interface ScheduleItem { id: string; name: string; everyKm: number | null; everyDays: number | null; note?: string }
export interface BikeSchedule { id: string; name: string; tankL: number; reserveL: number; items: ScheduleItem[] }

/**
 * Rider care that no handbook schedule lists as a service item: common guidance, editable.
 */
export const RIDER_CARE: ScheduleItem[] = [
  { id: 'chain', name: 'Chain clean and lube', everyKm: 600, everyDays: null, note: 'Common guidance; sooner after rain or dirt roads.' },
  { id: 'tyres', name: 'Tyre pressures', everyKm: null, everyDays: 14 },
  { id: 'tyreage', name: 'Tyre age check', everyKm: null, everyDays: 365 * 5 },
];

/**
 * The bikes Betty knows the schedule of. BMW G 310 GS: the owner's handbook, p. 140 (photo, 2026-10-17). The
 * running-in check (500 to 1,200 km, once) is left out: a one-off long past on a 2018 bike.
 */
export const BIKES: BikeSchedule[] = [
  { id: 'bmw-g310gs', name: 'BMW G 310 GS', tankL: 11, reserveL: 1, items: [
    { id: 'bmw-service', name: 'Standard BMW service', everyKm: null, everyDays: 365, note: 'Every 12 months.' },
    { id: 'oil', name: 'Engine oil and filter', everyKm: 10_000, everyDays: 365, note: 'Every 10,000 km or yearly, whichever comes first.' },
    { id: 'airfilter', name: 'Air filter element', everyKm: 20_000, everyDays: null },
    { id: 'sparkplug', name: 'Spark plug', everyKm: 20_000, everyDays: null },
    { id: 'valves', name: 'Valve clearance check', everyKm: 20_000, everyDays: null },
    { id: 'forkoil', name: 'Fork oil', everyKm: 20_000, everyDays: null },
    { id: 'fuelfilter', name: 'Fuel filters and fuel hoses', everyKm: 40_000, everyDays: 365 * 4, note: 'Every 40,000 km or 4 years, whichever comes first.' },
    { id: 'intake', name: 'Intake silencer hoses and tank vent valve', everyKm: 40_000, everyDays: 365 * 4, note: 'Every 40,000 km or 4 years, whichever comes first.' },
    { id: 'brakefluid', name: 'Brake fluid, entire system', everyKm: null, everyDays: 365 * 2, note: 'First after one year, then every 2 years.' },
  ] },
];
export const DEFAULT_BIKE = 'bmw-g310gs';

/**
 * A bike's schedule plus the rider care items. Distance items are assumed done at the last schedule milestone below
 * the odometer (oil at 20,000 when the odometer reads 23,450), time items today; all are marked `assumed` until he
 * confirms or changes them (alignToOdometer redoes the guess when he sets the odometer).
 */
export function bikeBook(bikeId: string, odoKm: number, now: number): ServiceBook {
  const bike = BIKES.find((b) => b.id === bikeId);
  const item = (x: ScheduleItem, schedule: boolean): Reminder => ({
    ...x, schedule, assumed: true, lastAt: now,
    lastKm: schedule && x.everyKm ? Math.floor(odoKm / x.everyKm) * x.everyKm : odoKm, // rider care: from today
  });
  return { odoKm, bike: bike?.id ?? 'other', items: [...RIDER_CARE.map((x) => item(x, false)), ...(bike?.items ?? []).map((x) => item(x, true))] };
}
/** The first set (before the handbook was known): kept for books saved then; new books use bikeBook. */
export const starterBook = (odoKm: number, now: number): ServiceBook => bikeBook(DEFAULT_BIKE, odoKm, now);

/**
 * He set the odometer: schedule items still on a guessed "last done" move to the last milestone below it (rider-care
 * items keep their km since, as before).
 */
export function alignToOdometer(book: ServiceBook, odoKm: number): ServiceBook {
  const shift = odoKm - book.odoKm;
  return { ...book, odoKm, items: book.items.map((r) => (r.schedule && r.assumed && r.everyKm
    ? { ...r, lastKm: Math.floor(odoKm / r.everyKm) * r.everyKm }
    : { ...r, lastKm: r.lastKm + shift })) };
}

/**
 * A book saved before the handbook schedule existed (no `bike`): his own items stay, the generic "Service" goes if it
 * was never changed, the bike's schedule is added.
 */
export function upgradeBook(book: ServiceBook, now: number): ServiceBook {
  if (book.bike) return book;
  const fresh = bikeBook(DEFAULT_BIKE, book.odoKm, now);
  const kept = book.items.filter((r) => !(r.id === 'service' && r.everyKm === 10_000 && r.everyDays === 365));
  const have = new Set(kept.map((r) => r.id));
  return { ...book, bike: DEFAULT_BIKE, items: [...kept, ...fresh.items.filter((r) => !have.has(r.id))] };
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
