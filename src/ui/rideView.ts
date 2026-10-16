/**
 * What the ride screen shows, as a pure function of the ride. No DOM here, so it is unit-tested in Node and the
 * screen module only paints the result. Wording lives in copy.ts.
 */
import type { BikeState, Priority } from '../core/types';
import { GLANCE, LINE_LINGER_MS, MOMENTS, RIDE_STATES } from './copy';
import type { IconName } from './icons';

export type OrbMode = 'rest' | 'speaking' | 'quiet' | 'listening';

export interface SaidLine { text: string; tag?: string; priority: Priority; at: number }

export interface RideInput {
  now: number;
  state: Pick<BikeState, 'speedKmh' | 'weather' | 'incidents' | 'area' | 'areaNotes' | 'nearbyPlaces'>;
  /** The line playing right now, if any */
  speaking: SaidLine | null;
  /** The last line she finished (shown for a while afterwards) */
  lastSaid: SaidLine | null;
  talk: 'off' | 'listening' | 'thinking';
  /** Minutes of quiet left: 0 none, Infinity until told */
  quietMin: number;
  ending: boolean;
  distanceKm: number;
  fuelKmLeft: number | null;
  fuelWarnKm: number;
  rainChancePct: number;
  trafficRadiusKm: number;
  untoldStories: number;
  showGlance: boolean;
}

export interface Glance { icon: IconName; label: string; title: string; value: string }

export interface RideView {
  orb: OrbMode;
  kicker: string;
  headline: string;
  sub: string;
  /** Top line: where he is, distance, air temperature */
  place: string;
  distance: string;
  temp: string;
  glance: Glance | null;
}

const momentFor = (tag?: string) => MOMENTS[(tag ?? 'voice') as keyof typeof MOMENTS] ?? MOMENTS.voice;
/** Voice tags like <laugh> are for Gemini, not for the screen. */
const plain = (t: string) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
const km = (n: number) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

/** The one thing worth a glance, most pressing first. */
export function pickGlance(i: RideInput): Glance {
  const s = i.state;
  if (i.fuelKmLeft !== null && i.fuelKmLeft <= i.fuelWarnKm * 1.5) {
    return { ...GLANCE.range, title: `${Math.max(0, Math.round(i.fuelKmLeft))} km left`, value: '' };
  }
  const w = s.weather;
  if (w && (w.rainNowMm > 0 || w.rainChanceNextHourPct >= i.rainChancePct)) {
    return { ...GLANCE.rain, title: w.rainNowMm > 0 ? 'Raining now' : 'Rain likely', value: `${w.rainChanceNextHourPct}%` };
  }
  const jam = [...s.incidents].filter((x) => x.distanceKm <= i.trafficRadiusKm).sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (jam) return { ...GLANCE.traffic, title: jam.roadName || jam.description, value: `${km(jam.distanceKm)} km` };
  if (w?.sunsetAt && w.sunsetAt > i.now && w.sunsetAt - i.now <= 60 * 60_000) {
    return { ...GLANCE.sunset, title: `Sunset at ${hhmm(w.sunsetAt)}`, value: '' };
  }
  const area = s.area?.suburb || s.area?.town;
  if (area) return { ...GLANCE.area, title: area, value: i.untoldStories ? `${i.untoldStories} ${i.untoldStories === 1 ? 'story' : 'stories'}` : '' };
  const near = [...s.nearbyPlaces].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (near) return { ...GLANCE.place, title: near.name, value: `${km(near.distanceKm)} km` };
  return { ...GLANCE.riding, title: 'Wherever the road goes', value: `${Math.round(s.speedKmh)} km/h` };
}

export function rideView(i: RideInput): RideView {
  const s = i.state;
  const base = {
    place: (s.area?.suburb || s.area?.town || 'Free ride').toUpperCase(),
    distance: `${km(i.distanceKm)} km`,
    temp: s.weather ? `${Math.round(s.weather.tempC)}°` : '–',
    glance: i.showGlance ? pickGlance(i) : null,
  };
  const quiet = i.quietMin > 0;
  const quietSub = i.quietMin === Infinity ? RIDE_STATES.quietUntilTold : RIDE_STATES.quietFor(i.quietMin);

  if (i.talk === 'listening') return { ...base, orb: 'listening', ...RIDE_STATES.listening };
  if (i.speaking) {
    const m = momentFor(i.speaking.tag);
    return { ...base, orb: 'speaking', kicker: m.kicker, headline: m.headline, sub: plain(i.speaking.text) };
  }
  if (i.talk === 'thinking') return { ...base, orb: 'listening', ...RIDE_STATES.thinking };
  if (i.ending) return { ...base, orb: 'rest', ...RIDE_STATES.ending };
  if (i.lastSaid && i.now - i.lastSaid.at <= LINE_LINGER_MS) {
    const m = momentFor(i.lastSaid.tag);
    return { ...base, orb: quiet ? 'quiet' : 'rest', kicker: m.kicker, headline: m.headline, sub: plain(i.lastSaid.text) };
  }
  if (quiet) return { ...base, orb: 'quiet', ...RIDE_STATES.quiet, sub: quietSub };
  if (s.speedKmh < 3) return { ...base, orb: 'rest', ...RIDE_STATES.parked };
  return { ...base, orb: 'rest', ...RIDE_STATES.idle };
}
