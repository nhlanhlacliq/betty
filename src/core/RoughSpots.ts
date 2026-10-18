import { angleDiff, bearingDeg, haversineKm } from './geo';
import type { RideRecord } from './RideMemory';

/**
 * Rough patches (owner's backlog, 2026-10-18: "spots that recur across rides become automatic marked-spot warnings"):
 * the hard brakes and big bumps of every ride, grouped by ~110 m cell. A spot counts when bumps there came on 2 or more
 * different rides, or hard braking on 3 or more (people brake hard at lights; a bump is the road). Pure, tested.
 */
export interface RoughSpot { lat: number; lon: number; bumpRides: number; brakeRides: number }
const CELL = 0.001;
const key = (lat: number, lon: number) => `${Math.round(lat / CELL)}:${Math.round(lon / CELL)}`;

export function roughSpots(rides: RideRecord[]): RoughSpot[] {
  const by = new Map<string, { lat: number; lon: number; bumps: Set<number>; brakes: Set<number> }>();
  for (const r of rides) for (const [lat, lon, kind] of r.rough ?? []) {
    const k = key(lat, lon);
    const c = by.get(k) ?? { lat, lon, bumps: new Set<number>(), brakes: new Set<number>() };
    (kind === 2 ? c.bumps : c.brakes).add(r.startedAt);
    by.set(k, c);
  }
  return [...by.values()].filter((c) => c.bumps.size >= 2 || c.brakes.size >= 3)
    .map((c) => ({ lat: c.lat, lon: c.lon, bumpRides: c.bumps.size, brakeRides: c.brakes.size }));
}

/** The rough spot ahead of him within `withinKm` and 50 degrees of his course, nearest first. */
export function roughAhead(spots: RoughSpot[], here: { lat: number; lon: number }, headingDeg: number, withinKm = 0.3): { spot: RoughSpot; km: number } | null {
  let best: { spot: RoughSpot; km: number } | null = null;
  for (const sp of spots) {
    const km = haversineKm(here, sp);
    if (km > withinKm || km < 0.03) continue;
    if (Math.abs(angleDiff(headingDeg, bearingDeg(here, sp))) > 50) continue;
    if (!best || km < best.km) best = { spot: sp, km };
  }
  return best;
}
