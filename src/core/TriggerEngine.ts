import { CONFIG } from '../config/betty';
import { banterContext, banterTopics, chooseAmbient, freshPlace, partOfDay, pickMode, pickTopic, placesFromHere, whereIs } from './ambient';
import { RideRecord } from './RideMemory';
import { RideSnapshot, RideStats } from './RideStats';
import { initialState } from './StateAggregator';
import { BikeState, TrafficIncident, TriggerEvent, TriggerId } from './types';

/**
 * Whether P2/P3 lines may be spoken right now. Always yes unless the lean hold is switched on in TUNING:
 * the owner had both the RPM and the lean condition removed (2026-10-08/09).
 */
export const isSafeWindow = (s: BikeState) =>
  !CONFIG.safeWindow.useLean || Math.abs(s.leanDeg) < CONFIG.safeWindow.maxLeanDeg;

/** How an alert is remembered later in the ride and in the ride log. */
const EVENT_LABELS: Partial<Record<TriggerId, string>> = {
  engine_overtemp: 'engine running hot', dtc_detected: 'a fault code', low_fuel: 'low fuel',
  rain_soon: 'rain', traffic_incident: 'a traffic incident',
};

const byDistance = (a: TrafficIncident, b: TrafficIncident) => a.distanceKm - b.distanceKm;
const km = (n: number) => `${Math.round(n * 10) / 10} km`;

/** Evaluates state, emits deduplicated trigger events. Pure logic: no I/O, easy to test. All tuning is read live from CONFIG. */
export class TriggerEngine {
  private lastFired = new Map<TriggerId, number>();
  private announced = new Set<string>();
  private rideStart: number;
  private milestonesHit = 0;
  /** Place ids already talked about this ride. */
  private mentioned = new Set<string>();
  /** When each banter topic was last used, and what its fact was then. */
  private topicUse = new Map<string, { bucket: string; seq: number }>();
  private topicSeq = 0;
  private lastMode: string | null = null;
  private lastAmbientSlot: number;
  private stats: RideStats;
  private history: RideRecord[] = [];

  constructor(private now: () => number = Date.now, private rng: () => number = Math.random) {
    this.rideStart = now(); this.lastAmbientSlot = now(); this.stats = new RideStats(now);
  }

  reset() {
    this.lastFired.clear(); this.announced.clear(); this.mentioned.clear();
    this.topicUse.clear(); this.topicSeq = 0; this.lastMode = null;
    this.rideStart = this.now(); this.milestonesHit = 0; this.lastAmbientSlot = this.now();
    this.stats = new RideStats(this.now);
  }

  /** Past rides Betty remembers (loaded by the UI layer from wherever they are stored). */
  setHistory(history: RideRecord[]) { this.history = history; }
  rideSnapshot(): RideSnapshot { return this.stats.snapshot(); }

  /** True while a condition whose trigger is configured P1 is active: no banter or tour guide then. */
  ambientBlocked(s: BikeState): boolean {
    if (!s.obd) return false; // no engine data, so no engine condition can be active
    const t = CONFIG.thresholds;
    const active: TriggerId[] = [];
    if (s.engineTempC >= t.overtempC) active.push('engine_overtemp');
    if (s.dtcs.length) active.push('dtc_detected');
    if (s.fuelPct > 0 && s.fuelPct <= t.lowFuelPct) active.push('low_fuel');
    return active.some((id) => CONFIG.priorities[id] === 1);
  }

  startup(): TriggerEvent { return this.force('startup', initialState()); }

  /** Emit an event now, ignoring cooldowns (simulator buttons, rider queries). */
  force(id: TriggerId, s: BikeState, incident?: TrafficIncident): TriggerEvent {
    this.lastFired.set(id, this.now());
    const { context, fallback, mark } = this.describe(id, s, incident);
    mark?.();
    const label = EVENT_LABELS[id];
    if (label) this.stats.noteEvent(label);
    return { id, priority: CONFIG.priorities[id], context, fallback, createdAt: this.now() };
  }

  evaluate(s: BikeState): TriggerEvent[] {
    this.stats.update(s);
    const out: TriggerEvent[] = [];
    const t = CONFIG.thresholds;

    if (s.obd) { // engine alerts need an OBD2 feed (simulated or real)
      if (s.engineTempC >= t.overtempC && this.ready('engine_overtemp')) out.push(this.force('engine_overtemp', s));
      if (s.dtcs.length && this.ready('dtc_detected')) out.push(this.force('dtc_detected', s));
      if (s.fuelPct > 0 && s.fuelPct <= t.lowFuelPct && this.ready('low_fuel')) out.push(this.force('low_fuel', s));
    }

    const w = s.weather;
    if (w && (w.rainNowMm >= 0.1 || w.rainChanceNextHourPct >= t.rainChancePct) && this.ready('rain_soon')) {
      out.push(this.force('rain_soon', s));
    }

    const inc = s.incidents
      .filter((i) => i.distanceKm <= t.trafficRadiusKm && i.severity >= t.trafficMinSeverity && !this.announced.has(i.id))
      .sort(byDistance)[0];
    if (inc && this.ready('traffic_incident')) {
      this.announced.add(inc.id);
      out.push(this.force('traffic_incident', s, inc));
    }

    const mins = (this.now() - this.rideStart) / 60_000;
    const due = Math.floor(mins / CONFIG.milestoneEveryMin);
    if (due > this.milestonesHit && this.ready('ride_milestone')) {
      this.milestonesHit = due;
      this.lastAmbientSlot = this.now();
      out.push(this.force('ride_milestone', s));
    }

    // One ambient slot per cooldown. A slot that rolls silence is still used up, so the silence weight means something.
    const slotDue = this.now() - this.lastAmbientSlot >= CONFIG.ambientCooldownMs;
    if (slotDue && !out.length && isSafeWindow(s) && !this.ambientBlocked(s)) {
      this.lastAmbientSlot = this.now();
      const place = freshPlace(placesFromHere(s), this.mentioned, CONFIG.ambient.placeRadiusKm);
      const pick = chooseAmbient(CONFIG.ambient, place !== null, this.rng);
      if (pick) out.push(this.force(pick, s));
    }
    return out;
  }

  private ready(id: TriggerId) {
    const last = this.lastFired.get(id);
    return last === undefined || this.now() - last >= CONFIG.cooldownsMs[id];
  }

  private describe(id: TriggerId, s: BikeState, incident?: TrafficIncident): { context: string; fallback: string; mark?: () => void } {
    switch (id) {
      case 'startup':
        return { context: `The ride session has just started. It is ${partOfDay(new Date(this.now()).getHours())}.`, fallback: 'Systems online.' };
      case 'engine_overtemp':
        return {
          context: `Engine temperature is ${s.engineTempC} C and climbing.`,
          fallback: 'Engine temp is high. Ease off and find somewhere to pull over.',
        };
      case 'dtc_detected': {
        const codes = s.dtcs.length ? s.dtcs : ['P0000'];
        return {
          context: `The bike reported fault codes: ${codes.join(', ')}.`,
          fallback: `The bike's reporting a fault code, ${codes[0]}. Worth checking when you stop.`,
        };
      }
      case 'low_fuel':
        return {
          context: `Fuel is at ${Math.round(s.fuelPct)} percent.`,
          fallback: `Fuel's at ${Math.round(s.fuelPct)} percent. Time to find a station.`,
        };
      case 'rain_soon': {
        const w = s.weather;
        const raining = (w?.rainNowMm ?? 0) >= 0.1;
        const chance = w?.rainChanceNextHourPct ?? 70;
        return {
          context: raining ? 'It is raining at the rider\'s location right now.' : `There is a ${chance} percent chance of rain in the next hour.`,
          fallback: raining ? 'It\'s raining out there. Watch your grip.' : `${chance} percent chance of rain within the hour. Maybe plan a cover stop.`,
        };
      }
      case 'traffic_incident': {
        const i = incident ?? [...s.incidents].sort(byDistance)[0]
          ?? { id: 'x', description: 'an incident', severity: 2, distanceKm: 2, lat: 0, lon: 0 };
        const where = i.roadName ? ` on ${i.roadName}` : '';
        return {
          context: `Traffic report: ${i.description}${where}, about ${km(i.distanceKm)} away, severity ${i.severity} of 4.`,
          fallback: `Heads up. ${i.description}${where}, about ${km(i.distanceKm)} away.`,
        };
      }
      case 'ride_milestone': {
        const mins = Math.round((this.now() - this.rideStart) / 60_000);
        return { context: `The rider has been out for ${mins} minutes.`, fallback: `You've been out ${mins} minutes. Good ride so far.` };
      }
      // Ambient flavours have no canned fallback: without Claude, or with nothing to go on, Betty stays quiet.
      case 'ambient_banter': {
        const topics = banterTopics({
          s, ride: this.stats.snapshot(), history: this.history, at: new Date(this.now()), placeRadiusKm: CONFIG.ambient.placeRadiusKm,
        });
        const topic = pickTopic(topics, this.topicUse, this.rng);
        if (!topic) return { context: '', fallback: '' };
        const mode = pickMode(this.lastMode, this.rng);
        return {
          context: banterContext(topic, mode, topics), fallback: '',
          mark: () => { this.topicUse.set(topic.id, { bucket: topic.bucket, seq: ++this.topicSeq }); this.lastMode = mode.id; },
        };
      }
      case 'local_fact': {
        const p = freshPlace(placesFromHere(s), this.mentioned, CONFIG.ambient.placeRadiusKm);
        if (!p) return { context: '', fallback: '' };
        const where = whereIs(s, p);
        return {
          context: `He is about ${km(p.distanceKm)} from ${p.name}${where ? `, which is ${where}` : ''}. Notes on ${p.name}: ${p.summary}`, fallback: '',
          mark: () => { this.mentioned.add(p.id); this.stats.notePlace(p.name); }, // never the same place twice in a ride
        };
      }
      case 'rider_query': {
        if (!s.obd) {
          const r = this.stats.snapshot();
          const w = s.weather ? ` Weather: ${s.weather.summary}, ${s.weather.tempC} C.` : '';
          return {
            context: `The rider asked how things are going. No engine data is connected, so say nothing about engine, fuel or faults. He has been out ${Math.round(r.minutesOut)} minutes and covered ${r.distanceKm} km.${w}`,
            fallback: `No engine data connected. You're ${Math.round(r.minutesOut)} minutes in, ${r.distanceKm} kilometres done.`,
          };
        }
        return {
          context: `The rider asked how the bike is doing. Engine ${s.engineTempC} C, fuel ${Math.round(s.fuelPct)} percent, ${s.dtcs.length ? 'fault codes ' + s.dtcs.join(', ') : 'no fault codes'}.`,
          fallback: `Engine's at ${s.engineTempC} degrees, fuel's at ${Math.round(s.fuelPct)} percent, ${s.dtcs.length ? 'and there are fault codes' : 'no faults'}.`,
        };
      }
    }
  }
}
