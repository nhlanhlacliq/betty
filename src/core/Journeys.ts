import { RideRecord, rideMinutes } from './RideMemory';

/**
 * My journeys, organised (owner, 2026-10-18: "just a long scrolling list"): rides by month with each month's numbers.
 * Pure, so it is tested.
 */
export interface MonthGroup {
  /** "2026-10" */
  key: string;
  /** "October 2026" */
  label: string;
  /** Newest first */
  rides: RideRecord[];
  km: number;
  minutes: number;
  /** Fuel spent, from the rides that kept a cost (null when none did) */
  costR: number | null;
}

export const monthKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
};

/** Rides (any order) grouped by calendar month, newest month first, rides newest first. */
export function groupByMonth(rides: RideRecord[], ridingOnly: boolean): MonthGroup[] {
  const by = new Map<string, RideRecord[]>();
  for (const r of rides) {
    const k = monthKey(r.startedAt);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, list]) => {
    const sorted = [...list].sort((a, b) => b.startedAt - a.startedAt);
    const costed = sorted.filter((r) => r.costR != null);
    return {
      key, label: monthLabel(key), rides: sorted,
      km: Math.round(sorted.reduce((n, r) => n + r.distanceKm, 0) * 10) / 10,
      minutes: sorted.reduce((n, r) => n + rideMinutes(r, ridingOnly), 0),
      costR: costed.length ? costed.reduce((n, r) => n + (r.costR ?? 0), 0) : null,
    };
  });
}

/** Totals for a set of rides. */
const sum = (rides: RideRecord[], ridingOnly: boolean) => {
  const costed = rides.filter((r) => r.costR != null);
  return {
    rides: rides.length,
    km: Math.round(rides.reduce((n, r) => n + r.distanceKm, 0)),
    minutes: rides.reduce((n, r) => n + rideMinutes(r, ridingOnly), 0),
    costR: costed.length ? costed.reduce((n, r) => n + (r.costR ?? 0), 0) : null,
  };
};

/**
 * Month in numbers (Journeys 5): this month so far against last month at the same point (day 1 to today's day, so
 * the middle of a month is not compared with a whole one), and km per week for the last 8 weeks (Monday weeks).
 */
export function monthNumbers(rides: RideRecord[], ridingOnly: boolean, now: number) {
  const d = new Date(now);
  const thisStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const lastStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  const lastDays = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
  const lastSamePoint = new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), lastDays), 23, 59, 59).getTime();
  const thisMonth = sum(rides.filter((r) => r.startedAt >= thisStart && r.startedAt <= now), ridingOnly);
  const lastSoFar = sum(rides.filter((r) => r.startedAt >= lastStart && r.startedAt <= lastSamePoint), ridingOnly);
  const monday = new Date(d); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(monday); start.setDate(start.getDate() - (7 - i) * 7); // i = 7 is this week
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return { start: start.getTime(), km: Math.round(rides.filter((r) => r.startedAt >= start.getTime() && r.startedAt < end.getTime()).reduce((n, r) => n + r.distanceKm, 0)) };
  });
  const change = lastSoFar.km > 0 ? Math.round(((thisMonth.km - lastSoFar.km) / lastSoFar.km) * 100) : null;
  return { key: monthKey(now), thisMonth, lastSoFar, change, lastLabel: monthLabel(monthKey(lastStart)).split(' ')[0], weeks };
}

/**
 * On this day (Journeys 6; owner: "not limited to one year, also 6 months, 3 months, 1 month"): rides on this calendar
 * date 1, 3, 6 and 12 months ago (a month without that date, e.g. 31 June, is skipped).
 */
export const LOOK_BACK = [{ months: 1, label: 'A month ago today' }, { months: 3, label: 'Three months ago today' }, { months: 6, label: 'Six months ago today' }, { months: 12, label: 'A year ago today' }];
export function onThisDay(rides: RideRecord[], now: number): Array<{ label: string; ride: RideRecord }> {
  const d = new Date(now);
  const out: Array<{ label: string; ride: RideRecord }> = [];
  for (const b of LOOK_BACK) {
    const then = new Date(d.getFullYear(), d.getMonth() - b.months, d.getDate());
    if (then.getDate() !== d.getDate()) continue; // no such date that month
    const from = then.getTime(), to = from + 86_400_000;
    const hit = rides.filter((r) => r.startedAt >= from && r.startedAt < to).sort((a, c) => c.distanceKm - a.distanceKm)[0];
    if (hit) out.push({ label: b.label, ride: hit });
  }
  return out;
}

/** Find a ride (Journeys 7): every word must appear in its name, places, weather, month or date. */
export function findRides(rides: RideRecord[], q: string, titleOf: (r: RideRecord) => string): RideRecord[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rides;
  return rides.filter((r) => {
    const when = new Date(r.startedAt);
    const hay = [titleOf(r), r.places.join(' '), r.weather ?? '', when.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
