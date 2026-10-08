import { CONFIG } from '../config/betty';
import { RideRecord, describeRide, describeTotals } from './RideMemory';
import { RideSnapshot } from './RideStats';
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

export const partOfDay = (hour: number) =>
  hour < 5 ? 'the middle of the night' : hour < 9 ? 'early morning' : hour < 12 ? 'mid-morning'
    : hour < 14 ? 'midday' : hour < 17 ? 'the afternoon' : hour < 20 ? 'the evening' : 'night';

export interface BanterTopic {
  id: string;
  /** Changes when the underlying fact has moved on, which makes the topic fresh again. */
  bucket: string;
  text: string;
}
export interface BanterInput {
  s: BikeState; ride: RideSnapshot; history: RideRecord[]; at: Date; placeRadiusKm: number;
}

/**
 * Everything banter could be about right now, his riding included (pace, revs, corners): the owner asked for that.
 * The prompt still forbids daring him to go faster or lean further.
 */
export function banterTopics({ s, ride, history, at, placeRadiusKm }: BanterInput): BanterTopic[] {
  const out: BanterTopic[] = [];
  const add = (id: string, bucket: string | number, text: string) => out.push({ id, bucket: String(bucket), text });
  const mins = ride.minutesOut;

  const day = partOfDay(at.getHours());
  add('time', day, `It is ${day}.`);
  if (s.weather) {
    add('weather', `${s.weather.summary}:${Math.round(s.weather.tempC / 5)}`,
      `Weather: ${s.weather.summary}, ${s.weather.tempC} C, wind ${s.weather.windKmh} km/h.`);
  }
  if (mins >= 10) add('duration', Math.floor(mins / 20), `He has been out for ${Math.round(mins)} minutes.`);
  if (ride.distanceKm >= 2) add('distance', Math.floor(ride.distanceKm / 15), `He has covered ${ride.distanceKm} km this ride.`);
  if (s.obd) {
    const used = ride.fuelStartPct !== null ? Math.round(ride.fuelStartPct - s.fuelPct) : 0;
    add('fuel', Math.floor(s.fuelPct / 20), `Fuel is at ${Math.round(s.fuelPct)} percent${used > 0 ? `, down ${used} since setting off` : ''}.`);
  }
  if (s.obd && ride.maxEngineTempC > 0) {
    const normal = s.engineTempC >= 70 && s.engineTempC < CONFIG.thresholds.overtempC - 5;
    add('engine', Math.floor(s.engineTempC / 10),
      `Engine is at ${Math.round(s.engineTempC)} C${normal ? ', which is normal' : ''}; the highest this ride was ${ride.maxEngineTempC} C.`);
  }
  if (ride.movingMin >= 5 && ride.maxLeanDeg > 0) {
    add('corners', Math.floor(ride.corneringPct / 20),
      `His cornering so far: leaned past 15 degrees for ${ride.corneringPct} percent of the time moving, deepest lean ${ride.maxLeanDeg} degrees.`);
  }
  if (ride.movingMin >= 3) {
    add('pace', Math.floor(ride.avgMovingKmh / 20), `His riding so far: averaging ${ride.avgMovingKmh} km/h while moving, top speed ${ride.maxSpeedKmh} km/h.`);
  }
  if (s.speedKmh > 0) add('speed_now', Math.floor(s.speedKmh / 30), `He is doing ${Math.round(s.speedKmh)} km/h right now.`);
  if (s.obd && s.rpm > 0) add('revs', Math.floor(s.rpm / 2000), `The engine is turning ${Math.round(s.rpm / 100) * 100} rpm right now, throttle at ${Math.round(s.throttlePct)} percent.`);
  if (ride.stops >= 1) {
    add('stops', ride.stops, `He has made ${ride.stops} stop(s) so far this ride${s.speedKmh > 0 ? ' and is moving again now' : ''}.`);
  }
  if (s.speedKmh === 0 && mins >= 5) add('standing', Math.floor(mins / 15), 'The bike is standing still right now.');
  if (s.incidents.length) add('traffic', s.incidents.length, `${s.incidents.length} traffic incident(s) reported nearby.`);
  const near = [...s.nearbyPlaces].filter((p) => p.distanceKm <= placeRadiusKm).sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (near) add('location', near.id, `He is near ${near.name}.`);
  if (ride.events.length) {
    add('earlier', ride.events.length, `Earlier this ride you flagged: ${ride.events.map((e) => `${e.what} at ${e.atMin} minutes`).join(', ')}.`);
  }
  if (ride.places.length) add('places', ride.places.length, `Places you have told him about this ride: ${ride.places.join(', ')}.`);
  const last = history.at(-1);
  if (last) add('last_ride', last.startedAt, `Your memory of his last ride, ${describeRide(last, at.getTime())}.`);
  if (history.length >= 2) add('totals', history.length, `Your memory: ${describeTotals(history)}.`);
  add('open', Math.floor(mins / 10), 'Nothing in particular: pick whatever in the background strikes you.');
  return out;
}

/**
 * Never runs dry: a topic whose fact has changed since it was last used (or that was never used) goes first,
 * otherwise the one used longest ago comes round again.
 */
export function pickTopic(
  topics: BanterTopic[], used: ReadonlyMap<string, { bucket: string; seq: number }>, rng: () => number = Math.random,
): BanterTopic | null {
  if (!topics.length) return null;
  const fresh = topics.filter((t) => used.get(t.id)?.bucket !== t.bucket);
  if (fresh.length) return fresh[Math.min(fresh.length - 1, Math.floor(rng() * fresh.length))];
  return [...topics].sort((a, b) => used.get(a.id)!.seq - used.get(b.id)!.seq)[0];
}

export interface BanterMode { id: string; text: string }
export const BANTER_MODES: BanterMode[] = [
  { id: 'quip', text: 'one dry quip' },
  { id: 'observation', text: 'a wry observation rather than a joke' },
  { id: 'thought', text: 'a passing thought the topic prompts, the kind you would share with a friend mid-ride' },
  { id: 'question', text: 'one light question for him to chew on while he rides. He cannot answer you yet, so it must need no reply' },
  { id: 'callback', text: 'tie the topic back to something you said or flagged earlier this ride, if there is anything; otherwise a quip' },
];

/** A different delivery from last time, so consecutive remarks do not share a shape. */
export function pickMode(lastId: string | null, rng: () => number = Math.random): BanterMode {
  const pool = BANTER_MODES.filter((m) => m.id !== lastId);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** The situation text for one banter remark: one topic to talk about, the rest as background. */
export function banterContext(topic: BanterTopic, mode: BanterMode, all: BanterTopic[]): string {
  const background = all.filter((t) => t.id !== topic.id && t.id !== 'open').map((t) => t.text).join(' ');
  return `Topic for this remark: ${topic.text}\nDelivery: ${mode.text}.\nBackground (for colour only, do not list it): ${background || 'none'}`;
}
