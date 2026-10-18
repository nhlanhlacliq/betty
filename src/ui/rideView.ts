/**
 * What the ride screen shows, as a pure function of the ride. No DOM here, so it is unit-tested in Node and the
 * screen module only paints the result. Wording lives in copy.ts.
 */
import { incidentKey } from '../core/TriggerEngine';
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
  route?: { name: string; leftKm: number; leftMin: number; next: { name: string; km: number } | null; offKm: number; doneKm?: number; detour?: boolean } | null;
  /** Full-tank range, for the fuel progress bar */
  fuelRangeKm?: number;
  /** A service reminder due within 500 km or a week, or overdue (core/Reminders islandReminder) */
  service?: { name: string; text: string; due: boolean; kmLeft: number | null; key: string } | null;
  /** Traffic incidents he dismissed from Horizon (incidentKey), hidden for a week */
  dismissed?: string[];
}

export type GlanceId = 'range' | 'rain' | 'traffic' | 'route' | 'offroute' | 'sunset' | 'service' | 'area' | 'place' | 'riding';
/** What a card's one button does (main.ts carries it out). */
export type GlanceAction = 'filled' | 'ask-rain' | 'ask-traffic' | 'upahead' | 'story' | 'ask-place';
export interface Glance {
  icon: IconName; label: string; title: string; value: string;
  id?: GlanceId;
  /** Changes when the news changes ("rain 60%" -> "raining now"): a new key makes the compact island grow */
  key?: string;
  /** The pill's few words */
  short?: string;
  action?: { kind: GlanceAction; label: string };
  /** 0 to 1, for the optional progress bar */
  progress?: number;
  /** Set when the card can be dismissed (traffic): what to hide (an incidentKey) */
  dismiss?: string;
}

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
  /** All the cues, most pressing first (the island browses them) */
  glances: Glance[];
}

const momentFor = (tag?: string) => MOMENTS[(tag ?? 'voice') as keyof typeof MOMENTS] ?? MOMENTS.voice;
/** Voice tags like <laugh> are for Gemini, not for the screen. */
const plain = (t: string) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
/** "Engine oil and filter" -> "Engine oil", "Brake fluid, entire system" -> "Brake fluid": for the pill. */
const shortName = (n: string) => n.replace(/\s+and\s.*$|,.*$/, '').trim() || n;
const km = (n: number) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

/** Every cue worth a glance, most pressing first (the island shows the first and can browse the rest). */
export function glanceCues(i: RideInput): Glance[] {
  const s = i.state;
  const out: Glance[] = [];
  const add = (g: Glance) => out.push(g);
  if (i.fuelKmLeft !== null && i.fuelKmLeft <= i.fuelWarnKm * 1.5) {
    const left = Math.max(0, Math.round(i.fuelKmLeft));
    add({ ...GLANCE.range, id: 'range', key: `range:${Math.round(left / 10)}`, title: `${left} km left`, value: '', short: `${left} km left`,
      action: { kind: 'filled', label: 'Filled up' }, progress: i.fuelRangeKm ? Math.min(1, left / i.fuelRangeKm) : undefined });
  }
  const w = s.weather;
  if (w && (w.rainNowMm > 0 || w.rainChanceNextHourPct >= i.rainChancePct)) {
    const now = w.rainNowMm > 0;
    add({ ...GLANCE.rain, id: 'rain', key: `rain:${now ? 'now' : Math.round(w.rainChanceNextHourPct / 10)}`, title: now ? 'Raining now' : `Rain likely, ${w.rainChanceNextHourPct}%`, value: '',
      short: now ? 'Raining' : `Rain ${w.rainChanceNextHourPct}%`, action: { kind: 'ask-rain', label: 'Will it last?' } });
  }
  const hidden = new Set(i.dismissed ?? []);
  const jam = [...s.incidents].filter((x) => x.distanceKm <= i.trafficRadiusKm && !hidden.has(incidentKey(x))).sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (jam) add({ ...GLANCE.traffic, id: 'traffic', key: `traffic:${jam.id}`, title: `${km(jam.distanceKm)} km`, value: jam.roadName || jam.description,
    short: `Traffic ${km(jam.distanceKm)} km`, action: { kind: 'ask-traffic', label: 'Tell me' }, dismiss: incidentKey(jam) });
  const r = i.route;
  if (r && r.offKm > 0.4) add({ ...GLANCE.offroute, id: 'offroute', key: 'offroute', title: r.detour ? 'On a detour' : `${km(r.offKm)} km off`, value: r.detour ? `${km(r.offKm)} km from the route to ${r.name}` : `to ${r.name}`, short: r.detour ? 'Detour' : 'Off route',
    action: { kind: 'upahead', label: 'Up ahead' } });
  else if (r) {
    const left = r.leftMin >= 60 ? `${Math.floor(r.leftMin / 60)} h ${String(r.leftMin % 60).padStart(2, '0')}` : `${r.leftMin} min`;
    const done = r.doneKm ?? 0;
    add({ ...GLANCE.route, id: 'route', key: `route:${r.next?.name ?? r.name}`, title: `${Math.round(r.leftKm)} km · ${left}`, value: r.next ? `${r.next.name} in ${km(r.next.km)} km` : `to ${r.name}`,
      short: `${Math.round(r.leftKm)} km · ${left}`, action: { kind: 'upahead', label: 'Up ahead' }, progress: done + r.leftKm > 0 ? done / (done + r.leftKm) : undefined });
  }
  if (w?.sunsetAt && w.sunsetAt > i.now && w.sunsetAt - i.now <= 60 * 60_000) {
    add({ ...GLANCE.sunset, id: 'sunset', key: 'sunset', title: `Sunset ${hhmm(w.sunsetAt)}`, value: '', short: `Sunset ${hhmm(w.sunsetAt)}`,
      progress: 1 - (w.sunsetAt - i.now) / (60 * 60_000) });
  }
  const sv = i.service;
  if (sv) add({ ...GLANCE.service, id: 'service', key: `service:${sv.key}:${sv.due ? 'due' : 'soon'}`, title: sv.name, value: sv.due ? `Due: ${sv.text}` : `Due ${sv.text}`,
    short: sv.kmLeft != null && sv.kmLeft > 0 ? `${shortName(sv.name)} in ${sv.kmLeft} km` : `${shortName(sv.name)} due`,
    progress: sv.kmLeft != null ? Math.min(1, Math.max(0, 1 - sv.kmLeft / 500)) : undefined });
  const area = s.area?.suburb || s.area?.town;
  if (area) add({ ...GLANCE.area, id: 'area', key: `area:${area}`, title: area, value: i.untoldStories ? `${i.untoldStories} ${i.untoldStories === 1 ? 'story' : 'stories'} to tell` : '', short: area,
    action: i.untoldStories ? { kind: 'story', label: 'Tell me a story' } : undefined });
  const near = [...s.nearbyPlaces].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (near) add({ ...GLANCE.place, id: 'place', key: `place:${near.id}`, title: `${km(near.distanceKm)} km`, value: near.name, short: near.name,
    action: { kind: 'ask-place', label: "What's that?" } });
  if (!out.length) add({ ...GLANCE.riding, id: 'riding', key: 'riding', title: `${Math.round(s.speedKmh)} km/h`, value: 'Follow your curiosity', short: `${Math.round(s.speedKmh)} km/h` });
  return out;
}

/** "212 km · 2 h 40" -> "212 km and 2 hours 40": for her voice. */
const speakable = (t: string) => t.replace(/\s·\s/g, ' and ').replace(/(\d+) h (\d+)/g, '$1 hours $2').replace(/(\d+) min\b/g, '$1 minutes');

/**
 * Horizon read out (owner, 2026-10-18: "anything ahead?"), for a phone in the pocket: the cards in order, one plain
 * sentence each, at most five, said by the phone (no AI call, works without signal).
 */
export function horizonSpoken(cues: Glance[]): string {
  const say = (g: Glance): string | null => {
    switch (g.id) {
      case 'range': return `Fuel: ${g.title} before reserve.`;
      case 'rain': return `${g.title}.`;
      case 'traffic': return `Traffic ${g.title} ahead${g.value ? `, ${g.value}` : ''}.`;
      case 'offroute': return g.title === 'On a detour' ? 'You\'re on your detour.' : `You're ${g.title} the route ${g.value}.`;
      case 'route': return `Route: ${speakable(g.title)} to go${g.value ? `, ${speakable(g.value)}` : ''}.`;
      case 'sunset': return `${g.title}.`;
      case 'service': return `${g.title} ${g.value.replace(/^Due:? /, 'due ')}.`;
      case 'area': return `You're in ${g.title}${g.value ? `, ${g.value}` : ''}.`;
      case 'place': return `${g.value} is ${g.title} away.`;
      default: return null;
    }
  };
  const lines = cues.map(say).filter((x): x is string => !!x).slice(0, 5);
  return lines.length ? lines.join(' ') : 'All clear on the horizon.';
}

/** The top card in one line, for the lock screens: "Maintenance: Engine oil in 416 km". */
export const horizonLine = (cues: Glance[]): string => {
  const g = cues.find((x) => x.id !== 'riding');
  return g ? `${g.label.replace(/ · estimate$/, '')}: ${g.short ?? g.title}` : '';
};

/** The one thing worth a glance, most pressing first. */
export function pickGlance(i: RideInput): Glance { return glanceCues(i)[0]; }

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
    glances: i.showGlance ? glanceCues(i) : [],
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
