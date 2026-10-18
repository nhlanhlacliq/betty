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
