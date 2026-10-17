/**
 * What the ride screen shows, as a pure function of the ride. No DOM here, so it is unit-tested in Node and the
 * screen module only paints the result. Wording lives in copy.ts.
 */
import type { BikeState, Priority } from '../core/types';
import { COMPANION_STATE, GLANCE, LINE_LINGER_MS, MOMENTS, RIDE_STATES } from './copy';
import type { IconName } from './icons';

export type OrbMode = 'resting' | 'speaking' | 'quiet' | 'listening';

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
  minutesOut: number;
  fuelKmLeft: number | null;
  fuelWarnKm: number;
  rainChancePct: number;
  trafficRadiusKm: number;
  untoldStories: number;
  showGlance: boolean;
  /** The planned route and where he is on it, if he planned one */
  route?: { name: string; leftKm: number; leftMin: number; next: { name: string; km: number } | null; offKm: number } | null;
}

export interface Glance { icon: IconName; label: string; title: string; value: string }

export interface RideView {
  orb: OrbMode;
  /** Beside "Your riding companion": speaking, listening, along for the ride... */
  state: string;
  /** What she is saying, just said, or the idle line: the companion card */
  message: string;
  /** The context card: what kind of moment, and the facts around him */
  kicker: string;
  headline: string;
  facts: string;
  /** Title and sub-title of the page: where he is */
  place: string;
  /** Map stats */
  distance: string;
  minutes: string;
  speed: string;
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
    return { ...GLANCE.rain, title: w.rainNowMm > 0 ? 'Raining now' : `Rain likely, ${w.rainChanceNextHourPct}%`, value: '' };
  }
  const jam = [...s.incidents].filter((x) => x.distanceKm <= i.trafficRadiusKm).sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (jam) return { ...GLANCE.traffic, title: `${km(jam.distanceKm)} km`, value: jam.roadName || jam.description };
  const r = i.route;
  if (r && r.offKm > 0.4) return { ...GLANCE.offroute, title: `${km(r.offKm)} km off`, value: `to ${r.name}` };
  if (r) {
    const left = r.leftMin >= 60 ? `${Math.floor(r.leftMin / 60)} h ${String(r.leftMin % 60).padStart(2, '0')}` : `${r.leftMin} min`;
    return { ...GLANCE.route, title: `${Math.round(r.leftKm)} km · ${left}`, value: r.next ? `${r.next.name} in ${km(r.next.km)} km` : `to ${r.name}` };
  }
  if (w?.sunsetAt && w.sunsetAt > i.now && w.sunsetAt - i.now <= 60 * 60_000) {
    return { ...GLANCE.sunset, title: `Sunset ${hhmm(w.sunsetAt)}`, value: '' };
  }
  const area = s.area?.suburb || s.area?.town;
  if (area) return { ...GLANCE.area, title: area, value: i.untoldStories ? `${i.untoldStories} ${i.untoldStories === 1 ? 'story' : 'stories'} to tell` : '' };
  const near = [...s.nearbyPlaces].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (near) return { ...GLANCE.place, title: `${km(near.distanceKm)} km`, value: near.name };
  return { ...GLANCE.riding, title: `${Math.round(s.speedKmh)} km/h`, value: 'Follow your curiosity' };
}

/** The facts around him, one short line: area, weather, sunset, stories. */
function factsFor(i: RideInput): string {
  const s = i.state;
  const bits: string[] = [];
  const where = [s.area?.suburb, s.area?.town].filter(Boolean).join(', ');
  if (where) bits.push(where);
  if (s.weather) bits.push(`${Math.round(s.weather.tempC)}°, ${s.weather.summary}`);
  if (s.weather?.sunsetAt && s.weather.sunsetAt > i.now && s.weather.sunsetAt - i.now <= 3 * 3_600_000) bits.push(`sunset ${hhmm(s.weather.sunsetAt)}`);
  if (i.untoldStories) bits.push(`${i.untoldStories} ${i.untoldStories === 1 ? 'story' : 'stories'} still to tell`);
  return bits.join(' · ');
}

export function rideView(i: RideInput): RideView {
  const s = i.state;
  const base = {
    place: s.area?.suburb || s.area?.town || '',
    distance: km(i.distanceKm),
    minutes: String(Math.floor(i.minutesOut)),
    speed: String(Math.round(s.speedKmh)),
    temp: s.weather ? `${Math.round(s.weather.tempC)}°` : '',
    glance: i.showGlance ? pickGlance(i) : null,
    facts: factsFor(i),
  };
  const quiet = i.quietMin > 0;
  const quietSub = i.quietMin === Infinity ? RIDE_STATES.quietUntilTold : RIDE_STATES.quietFor(i.quietMin);
  const moment = (line: SaidLine, orb: OrbMode, state: string) => {
    const m = momentFor(line.tag);
    return { ...base, orb, state, kicker: m.kicker, headline: m.headline, message: plain(line.text) };
  };

  if (i.talk === 'listening') return { ...base, orb: 'listening', state: COMPANION_STATE.listening, ...RIDE_STATES.listening, message: RIDE_STATES.listening.sub };
  if (i.speaking) return moment(i.speaking, 'speaking', COMPANION_STATE.speaking);
  if (i.talk === 'thinking') return { ...base, orb: 'listening', state: COMPANION_STATE.thinking, ...RIDE_STATES.thinking, message: RIDE_STATES.thinking.sub };
  if (i.ending) return { ...base, orb: 'resting', state: COMPANION_STATE.ending, ...RIDE_STATES.ending, message: RIDE_STATES.ending.sub };
  if (i.lastSaid && i.now - i.lastSaid.at <= LINE_LINGER_MS) {
    return moment(i.lastSaid, quiet ? 'quiet' : 'resting', quiet ? COMPANION_STATE.quiet : COMPANION_STATE.idle);
  }
  if (quiet) return { ...base, orb: 'quiet', state: COMPANION_STATE.quiet, ...RIDE_STATES.quiet, message: quietSub };
  const idle = s.speedKmh < 3 ? RIDE_STATES.parked : RIDE_STATES.idle;
  return { ...base, orb: 'resting', state: COMPANION_STATE.idle, kicker: idle.kicker, headline: idle.headline, message: idle.sub };
}
