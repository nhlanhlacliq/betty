import { BikeState, NearbyPlace } from './types';

export type AmbientChoice = 'ambient_banter' | 'local_fact' | null;
export interface AmbientWeights { banterWeight: number; tourGuideWeight: number; silenceWeight: number }

/**
 * Picks the flavour for one ambient slot. A roll whose flavour has nothing new to offer (no unmentioned place,
 * no unused banter angle) becomes silence rather than the other flavour, so the mix stays what the weights say.
 */
export function chooseAmbient(
  w: AmbientWeights, hasFreshPlace: boolean, rng: () => number = Math.random, hasFreshAngle = true,
): AmbientChoice {
  const banter = Math.max(0, w.banterWeight);
  const guide = Math.max(0, w.tourGuideWeight);
  const total = banter + guide + Math.max(0, w.silenceWeight);
  if (total <= 0) return null;
  const roll = rng() * total;
  if (roll < banter) return hasFreshAngle ? 'ambient_banter' : null;
  if (roll < banter + guide) return hasFreshPlace ? 'local_fact' : null;
  return null;
}

/** Nearest place within range that has not been mentioned this ride. */
export function freshPlace(places: NearbyPlace[], mentioned: ReadonlySet<string>, radiusKm: number): NearbyPlace | null {
  return places
    .filter((p) => p.distanceKm <= radiusKm && !mentioned.has(p.id))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0] ?? null;
}

export const partOfDay = (hour: number) =>
  hour < 5 ? 'the middle of the night' : hour < 9 ? 'early morning' : hour < 12 ? 'mid-morning'
    : hour < 14 ? 'midday' : hour < 17 ? 'the afternoon' : hour < 20 ? 'the evening' : 'night';

export interface BanterAngle { id: string; text: string }

/**
 * Things banter may be about, one per quip. The id carries a coarse bucket, so an angle comes back only when the
 * underlying fact has actually changed (new part of day, different weather, another half hour, a quarter tank less).
 * Deliberately leaves out speed, lean and RPM: Betty never comments on how he rides.
 */
export function banterAngles(s: BikeState, minutesOut: number, at: Date): BanterAngle[] {
  const out: BanterAngle[] = [];
  const day = partOfDay(at.getHours());
  out.push({ id: `angle-time:${day}`, text: `It is ${day}.` });
  if (s.weather) {
    out.push({
      id: `angle-weather:${s.weather.summary}:${Math.round(s.weather.tempC / 5)}`,
      text: `Weather: ${s.weather.summary}, ${s.weather.tempC} C, wind ${s.weather.windKmh} km/h.`,
    });
  }
  if (minutesOut >= 20) {
    out.push({ id: `angle-duration:${Math.floor(minutesOut / 30)}`, text: `He has been riding for ${Math.round(minutesOut)} minutes.` });
  }
  if (s.fuelPct <= 75) out.push({ id: `angle-fuel:${Math.floor(s.fuelPct / 25)}`, text: `Fuel is at ${Math.round(s.fuelPct)} percent.` });
  if (s.incidents.length) out.push({ id: `angle-traffic:${s.incidents.length}`, text: `${s.incidents.length} traffic incident(s) reported nearby.` });
  if (s.speedKmh === 0 && minutesOut >= 5) out.push({ id: 'angle-stopped', text: 'The bike is standing still.' });
  return out;
}

/** One angle not yet used this ride, or null when everything current has been joked about already. */
export function freshAngle(angles: BanterAngle[], used: ReadonlySet<string>, rng: () => number = Math.random): BanterAngle | null {
  const fresh = angles.filter((a) => !used.has(a.id));
  return fresh.length ? fresh[Math.min(fresh.length - 1, Math.floor(rng() * fresh.length))] : null;
}
