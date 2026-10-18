import { haversineKm } from './geo';
import type { TrackPoint } from './Track';

/**
 * Where he has ridden (owner's backlog, 2026-10-18: "new road vs usual road"): a grid of ~200 m cells with how many
 * rides passed through each. A stretch where every cell is new is "a road never ridden with Betty"; the counts say how
 * familiar a road is. Pure, so it is tested; adapters/RoadCells keeps the counts on the phone.
 */
export const CELL_DEG = 0.002; // about 220 m north-south, 200 m east-west here
export const cellOf = (lat: number, lon: number) => `${Math.round(lat / CELL_DEG)}:${Math.round(lon / CELL_DEG)}`;
/** Most cells kept (the least ridden go first): roughly 1 MB. */
export const MAX_CELLS = 60_000;
/** How many cells in a row make a "stretch" (about 2 km). */
const STRETCH = 10;

/** The cells a road passes through, filling the gaps between points (stored roads are a few hundred metres apart). */
export function cellsAlong(track: TrackPoint[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < track.length; i++) {
    const [lat, lon] = track[i];
    out.add(cellOf(lat, lon));
    if (i === 0) continue;
    const [plat, plon] = track[i - 1];
    const km = haversineKm({ lat: plat, lon: plon }, { lat, lon });
    const steps = Math.min(200, Math.floor(km / 0.1)); // every 100 m; a jump over 20 km is a gap in the GPS, not a road
    if (km > 20) continue;
    for (let k = 1; k < steps; k++) out.add(cellOf(plat + ((lat - plat) * k) / steps, plon + ((lon - plon) * k) / steps));
  }
  return out;
}

/** Counts from past rides' roads (the first time, before any ride added to it). */
export function countsFromTracks(tracks: TrackPoint[][]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tracks) for (const c of cellsAlong(t)) counts[c] = (counts[c] ?? 0) + 1;
  return counts;
}

/** Keep the most-ridden cells when there are too many. */
export function capCells(counts: Record<string, number>, max = MAX_CELLS): Record<string, number> {
  const keys = Object.keys(counts);
  if (keys.length <= max) return counts;
  return Object.fromEntries(keys.sort((a, b) => counts[b] - counts[a]).slice(0, max).map((k) => [k, counts[k]]));
}

/** The ride's view of it: cells visited this ride, the last stretch, and the counts as they were before this ride. */
export class RoadMemory {
  private ride = new Set<string>();
  private recent: number[] = [];
  constructor(private before: Record<string, number> = {}) {}

  /** A position on the ride. Returns how many earlier rides passed this cell, or null for a cell already visited this ride. */
  visit(lat: number, lon: number): number | null {
    const c = cellOf(lat, lon);
    if (this.ride.has(c)) return null;
    this.ride.add(c);
    const n = this.before[c] ?? 0;
    this.recent.push(n);
    if (this.recent.length > STRETCH) this.recent.shift();
    return n;
  }
  /** The last ~2 km are all new (one cell may have been crossed before, at a junction). */
  newStretch(): boolean { return this.recent.length >= STRETCH && this.recent.filter((n) => n === 0).length >= STRETCH - 1; }
  /** How many earlier rides took the last ~2 km (the middle value, so one busy junction does not count). */
  familiarity(): number {
    if (this.recent.length < STRETCH / 2) return 0;
    const s = [...this.recent].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
  /** The counts with this ride added (the same however often it is saved during the ride). */
  merged(): Record<string, number> {
    const out = { ...this.before };
    for (const c of this.ride) out[c] = (out[c] ?? 0) + 1;
    return capCells(out);
  }
  get cellsThisRide() { return this.ride.size; }
}
