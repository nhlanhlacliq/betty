import { RideSnapshot } from './RideStats';
import { FuelSetup, costOf, litresFor } from './Fuel';

/** What Betty remembers about one past ride. Small on purpose: it is stored on the device and fed to Claude. */
export interface RideRecord {
  startedAt: number;
  minutes: number;
  /** Of those, the minutes moving (rides from before 2026-10-17 do not have it) */
  movingMin?: number;
  distanceKm: number;
  /** Highest point of the ride, GPS metres (rides from 2026-10-18 on) */
  highM?: number;
  /** Fuel used (km x his average consumption) and what it cost at the price of the day, rand */
  fuelL?: number;
  costR?: number;
  weather: string | null;
  places: string[];
  events: string[];
}

export const MAX_REMEMBERED_RIDES = 500; // was 30: Journeys groups by month, keeps records (2026-10-18)
/** Shorter than this (and under 1 km) is a desk test, not a ride worth remembering. */
const MIN_MINUTES = 3;

export function toRecord(snap: RideSnapshot, weather: string | null, fuel?: FuelSetup): RideRecord | null {
  if (snap.minutesOut < MIN_MINUTES && snap.distanceKm < 1) return null;
  return {
    startedAt: snap.startedAt,
    minutes: Math.round(snap.minutesOut),
    movingMin: Math.min(Math.round(snap.minutesOut), Math.round(snap.movingMin)),
    distanceKm: snap.distanceKm,
    ...(snap.highM != null ? { highM: snap.highM } : {}),
    ...(fuel ? { fuelL: Math.round(litresFor(snap.distanceKm, fuel) * 10) / 10, costR: costOf(snap.distanceKm, fuel) } : {}),
    weather,
    places: snap.places.slice(0, 8),
    events: [...new Set(snap.events.map((e) => e.what))].slice(0, 8),
  };
}

/** Insert or replace the record for a ride (the current ride is saved repeatedly as it grows). Newest last. */
export function upsertRide(history: RideRecord[], rec: RideRecord): RideRecord[] {
  return [...history.filter((r) => r.startedAt !== rec.startedAt), rec]
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-MAX_REMEMBERED_RIDES);
}

/**
 * A ride's time as shown: riding time only (the default, owner 2026-10-17: an 80 minute stop made a 3 h 39 ride), or
 * all of it. Rides recorded before riding time was kept show all of it.
 */
export const rideMinutes = (r: RideRecord, ridingOnly: boolean) => (ridingOnly && r.movingMin != null ? r.movingMin : r.minutes);
/** Minutes stopped (parked, breaks, lights), when known. */
export const stoppedMinutes = (r: RideRecord) => (r.movingMin != null ? Math.max(0, r.minutes - r.movingMin) : null);

/** Fuel spend in a month (rides that kept a cost), and per km over those rides. */
export function fuelSpend(history: RideRecord[], now: number) {
  const d = new Date(now);
  const month = history.filter((r) => r.costR != null && new Date(r.startedAt).getMonth() === d.getMonth() && new Date(r.startedAt).getFullYear() === d.getFullYear());
  const costed = history.filter((r) => r.costR != null && r.distanceKm > 0);
  const km = costed.reduce((n, r) => n + r.distanceKm, 0);
  return {
    monthR: month.reduce((n, r) => n + (r.costR ?? 0), 0),
    monthRides: month.length,
    perKmR: km ? Math.round((costed.reduce((n, r) => n + (r.costR ?? 0), 0) / km) * 100) / 100 : null,
  };
}

const ago = (ms: number) => {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days ago`;
  if (days === 1) return 'yesterday';
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours} hour(s) ago` : 'earlier today';
};

export function describeRide(r: RideRecord, now: number): string {
  const stopped = stoppedMinutes(r);
  const bits = [`${ago(now - r.startedAt)}: ${r.minutes} minutes${stopped ? ` (${r.minutes - stopped} of them riding)` : ''}, ${r.distanceKm} km`];
  if (r.weather) bits.push(`weather ${r.weather}`);
  if (r.places.length) bits.push(`talked about ${r.places.join(', ')}`);
  if (r.events.length) bits.push(`flagged ${r.events.join(', ')}`);
  return bits.join('; ');
}

export function describeTotals(history: RideRecord[]): string {
  const km = Math.round(history.reduce((n, r) => n + r.distanceKm, 0));
  const hours = Math.round(history.reduce((n, r) => n + r.minutes, 0) / 6) / 10;
  return `${history.length} ride(s) together before this one, ${km} km and ${hours} hours in total`;
}
