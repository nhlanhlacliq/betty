import { RideSnapshot } from './RideStats';

/** What Betty remembers about one past ride. Small on purpose: it is stored on the device and fed to Claude. */
export interface RideRecord {
  startedAt: number;
  minutes: number;
  distanceKm: number;
  weather: string | null;
  places: string[];
  events: string[];
}

export const MAX_REMEMBERED_RIDES = 30;
/** Shorter than this (and under 1 km) is a desk test, not a ride worth remembering. */
const MIN_MINUTES = 3;

export function toRecord(snap: RideSnapshot, weather: string | null): RideRecord | null {
  if (snap.minutesOut < MIN_MINUTES && snap.distanceKm < 1) return null;
  return {
    startedAt: snap.startedAt,
    minutes: Math.round(snap.minutesOut),
    distanceKm: snap.distanceKm,
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

const ago = (ms: number) => {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days ago`;
  if (days === 1) return 'yesterday';
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours} hour(s) ago` : 'earlier today';
};

export function describeRide(r: RideRecord, now: number): string {
  const bits = [`${ago(now - r.startedAt)}: ${r.minutes} minutes, ${r.distanceKm} km`];
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
