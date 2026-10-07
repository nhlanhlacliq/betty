import { BikeState, NearbyPlace } from './types';

export type AmbientChoice = 'ambient_banter' | 'local_fact' | null;
export interface AmbientWeights { banterWeight: number; tourGuideWeight: number; silenceWeight: number }

/**
 * Picks the flavour for one ambient slot. A tour-guide roll with no fresh place becomes silence
 * rather than extra banter, so the banter rate stays what the weights say.
 */
export function chooseAmbient(w: AmbientWeights, hasFreshPlace: boolean, rng: () => number = Math.random): AmbientChoice {
  const banter = Math.max(0, w.banterWeight);
  const guide = Math.max(0, w.tourGuideWeight);
  const total = banter + guide + Math.max(0, w.silenceWeight);
  if (total <= 0) return null;
  const roll = rng() * total;
  if (roll < banter) return 'ambient_banter';
  if (roll < banter + guide) return hasFreshPlace ? 'local_fact' : null;
  return null;
}

/** Nearest place within range that has not been mentioned this ride. */
export function freshPlace(places: NearbyPlace[], mentioned: ReadonlySet<string>, radiusKm: number): NearbyPlace | null {
  return places
    .filter((p) => p.distanceKm <= radiusKm && !mentioned.has(p.id))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0] ?? null;
}

const partOfDay = (hour: number) =>
  hour < 5 ? 'the middle of the night' : hour < 9 ? 'early morning' : hour < 12 ? 'mid-morning'
    : hour < 14 ? 'midday' : hour < 17 ? 'the afternoon' : hour < 20 ? 'the evening' : 'night';

/**
 * Facts banter may draw on. Deliberately leaves out speed, lean and RPM: Betty never comments on how he rides.
 */
export function rideContext(s: BikeState, minutesOut: number, at: Date): string {
  const parts = [`It is ${partOfDay(at.getHours())}.`, `He has been riding for ${Math.round(minutesOut)} minutes.`];
  if (s.weather) parts.push(`Weather: ${s.weather.summary}, ${s.weather.tempC} C, wind ${s.weather.windKmh} km/h.`);
  parts.push(`Fuel is at ${Math.round(s.fuelPct)} percent.`);
  parts.push(s.incidents.length ? `${s.incidents.length} traffic incident(s) reported nearby.` : 'No traffic incidents reported nearby.');
  if (s.speedKmh === 0) parts.push('The bike is standing still.');
  return parts.join(' ');
}
