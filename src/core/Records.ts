import { haversineKm } from './geo';
import { monthKey, monthLabel } from './Journeys';
import { RideRecord, rideMinutes } from './RideMemory';
import type { TrackPoint } from './Track';

/**
 * Personal records and milestones (owner, 2026-10-18, Journeys 4): kept from the rides themselves, nothing stored.
 * Speed is deliberately not a record (she never encourages riding faster). Pure, so it is tested.
 */
export interface RecordsView {
  longest: { ride: RideRecord; km: number } | null;
  longestTime: { ride: RideRecord; minutes: number } | null;
  /** Furthest point of a ride from where it started (the rough road copy) */
  furthest: { ride: RideRecord; km: number } | null;
  highest: { ride: RideRecord; m: number } | null;
  bestMonth: { key: string; label: string; km: number } | null;
  /** Weeks in a row (Monday to Sunday) with at least one ride, up to this week or last; and the best run */
  streak: number;
  bestStreak: number;
  totalKm: number;
  rides: number;
  nextKm: { at: number; left: number; from: number } | null;
  nextRides: { at: number; left: number } | null;
}

export const KM_MILESTONES = [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 15_000, 20_000, 25_000, 50_000, 75_000, 100_000];
export const RIDE_MILESTONES = [10, 25, 50, 100, 150, 200, 300, 400, 500];

const DAY = 86_400_000;
/** Monday 00:00 of the week a time falls in, as a day number (for counting weeks in a row). */
const weekOf = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return Math.round(d.getTime() / (7 * DAY)); };

export function rideRecords(rides: RideRecord[], roads: Record<string, TrackPoint[]>, ridingOnly: boolean, now: number): RecordsView {
  const max = <T>(xs: T[], v: (x: T) => number) => xs.reduce<T | null>((b, x) => (b === null || v(x) > v(b) ? x : b), null);
  const longestR = max(rides, (r) => r.distanceKm);
  const timeR = max(rides, (r) => rideMinutes(r, ridingOnly));
  const out = rides.map((r) => {
    const t = roads[String(r.startedAt)];
    if (!t || t.length < 2) return null;
    const s = { lat: t[0][0], lon: t[0][1] };
    return { ride: r, km: Math.max(...t.map((p) => haversineKm(s, { lat: p[0], lon: p[1] }))) };
  }).filter((x): x is { ride: RideRecord; km: number } => !!x);
  const furthest = max(out, (x) => x.km);
  const highR = max(rides.filter((r) => r.highM != null), (r) => r.highM!);
  const months = new Map<string, number>();
  for (const r of rides) months.set(monthKey(r.startedAt), (months.get(monthKey(r.startedAt)) ?? 0) + r.distanceKm);
  const best = max([...months.entries()], ([, km]) => km);
  // Weeks in a row: count back from this week (or last week, if he has not ridden yet this week).
  const weeks = new Set(rides.map((r) => weekOf(r.startedAt)));
  let w = weekOf(now); if (!weeks.has(w)) w--;
  let streak = 0; while (weeks.has(w)) { streak++; w--; }
  let bestStreak = 0, run = 0, prev: number | null = null;
  for (const x of [...weeks].sort((a, b) => a - b)) { run = prev !== null && x === prev + 1 ? run + 1 : 1; bestStreak = Math.max(bestStreak, run); prev = x; }
  const totalKm = Math.round(rides.reduce((n, r) => n + r.distanceKm, 0));
  const nk = KM_MILESTONES.find((m) => m > totalKm);
  const nr = RIDE_MILESTONES.find((m) => m > rides.length);
  const prevKm = [...KM_MILESTONES].reverse().find((m) => m <= totalKm) ?? 0;
  return {
    longest: longestR ? { ride: longestR, km: longestR.distanceKm } : null,
    longestTime: timeR ? { ride: timeR, minutes: rideMinutes(timeR, ridingOnly) } : null,
    furthest: furthest ? { ride: furthest.ride, km: Math.round(furthest.km) } : null,
    highest: highR ? { ride: highR, m: highR.highM! } : null,
    bestMonth: best ? { key: best[0], label: monthLabel(best[0]), km: Math.round(best[1]) } : null,
    streak, bestStreak, totalKm, rides: rides.length,
    nextKm: nk ? { at: nk, left: nk - totalKm, from: prevKm } : null,
    nextRides: nr ? { at: nr, left: nr - rides.length } : null,
  };
}

/**
 * What she can call out live (Journeys 4: "your longest ride yet"): the longest ride so far, and the total km
 * milestone this ride is about to cross. From the rides BEFORE this one.
 */
export interface LiveRecords { longestKm: number; longestWhen: number | null; totalKm: number; rides: number }
export const liveRecords = (history: RideRecord[]): LiveRecords => {
  const l = history.reduce<RideRecord | null>((b, r) => (!b || r.distanceKm > b.distanceKm ? r : b), null);
  return { longestKm: l?.distanceKm ?? 0, longestWhen: l?.startedAt ?? null, totalKm: history.reduce((n, r) => n + r.distanceKm, 0), rides: history.length };
};
/** The km milestone crossed between two totals, or null. */
export const kmMilestoneCrossed = (before: number, after: number) => KM_MILESTONES.find((m) => before < m && after >= m) ?? null;
