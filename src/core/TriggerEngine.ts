import { CONFIG } from '../config/betty';
import { chooseAmbient, freshPlace, rideContext } from './ambient';
import { initialState } from './StateAggregator';
import { BikeState, TrafficIncident, TriggerEvent, TriggerId } from './types';

export const isSafeWindow = (s: BikeState) =>
  s.rpm < CONFIG.safeWindow.maxRpm && Math.abs(s.leanDeg) < CONFIG.safeWindow.maxLeanDeg;

/** Margin on top of ambientCooldownMs so a new ambient line is not dropped by the queue's own P3 rate limit. */
const AMBIENT_SLACK_MS = 5000;

const byDistance = (a: TrafficIncident, b: TrafficIncident) => a.distanceKm - b.distanceKm;
const km = (n: number) => `${Math.round(n * 10) / 10} km`;

/** Evaluates state, emits deduplicated trigger events. Pure logic: no I/O, easy to test. All tuning is read live from CONFIG. */
export class TriggerEngine {
  private lastFired = new Map<TriggerId, number>();
  private announced = new Set<string>();
  private rideStart: number;
  private milestonesHit = 0;
  private mentionedPlaces = new Set<string>();
  private lastAmbientSlot: number;

  constructor(private now: () => number = Date.now, private rng: () => number = Math.random) {
    this.rideStart = now(); this.lastAmbientSlot = now();
  }

  reset() {
    this.lastFired.clear(); this.announced.clear(); this.mentionedPlaces.clear();
    this.rideStart = this.now(); this.milestonesHit = 0; this.lastAmbientSlot = this.now();
  }

  /** True while a condition whose trigger is configured P1 is active: no banter or tour guide then. */
  ambientBlocked(s: BikeState): boolean {
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
    const { context, fallback } = this.describe(id, s, incident);
    if (id === 'local_fact') {
      const place = freshPlace(s.nearbyPlaces, this.mentionedPlaces, CONFIG.ambient.placeRadiusKm);
      if (place) this.mentionedPlaces.add(place.id); // never the same place twice in a ride
    }
    return { id, priority: CONFIG.priorities[id], context, fallback, createdAt: this.now() };
  }

  evaluate(s: BikeState): TriggerEvent[] {
    const out: TriggerEvent[] = [];
    const t = CONFIG.thresholds;

    if (s.engineTempC >= t.overtempC && this.ready('engine_overtemp')) out.push(this.force('engine_overtemp', s));
    if (s.dtcs.length && this.ready('dtc_detected')) out.push(this.force('dtc_detected', s));
    if (s.fuelPct > 0 && s.fuelPct <= t.lowFuelPct && this.ready('low_fuel')) out.push(this.force('low_fuel', s));

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
    const slotDue = this.now() - this.lastAmbientSlot >= CONFIG.ambientCooldownMs + AMBIENT_SLACK_MS;
    if (slotDue && !out.length && isSafeWindow(s) && !this.ambientBlocked(s)) {
      this.lastAmbientSlot = this.now();
      const fresh = freshPlace(s.nearbyPlaces, this.mentionedPlaces, CONFIG.ambient.placeRadiusKm);
      const pick = chooseAmbient(CONFIG.ambient, fresh !== null, this.rng);
      if (pick) out.push(this.force(pick, s));
    }
    return out;
  }

  private ready(id: TriggerId) {
    const last = this.lastFired.get(id);
    return last === undefined || this.now() - last >= CONFIG.cooldownsMs[id];
  }

  private describe(id: TriggerId, s: BikeState, incident?: TrafficIncident): { context: string; fallback: string } {
    switch (id) {
      case 'startup':
        return { context: 'The ride session has just started.', fallback: 'Systems online.' };
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
        const mins = (this.now() - this.rideStart) / 60_000;
        return { context: `Ride context: ${rideContext(s, mins, new Date(this.now()))}`, fallback: '' };
      }
      case 'local_fact': {
        const p = freshPlace(s.nearbyPlaces, this.mentionedPlaces, CONFIG.ambient.placeRadiusKm);
        if (!p) return { context: '', fallback: '' };
        return { context: `He is about ${km(p.distanceKm)} from ${p.name}. Notes on ${p.name}: ${p.summary}`, fallback: '' };
      }
      case 'rider_query':
        return {
          context: `The rider asked how the bike is doing. Engine ${s.engineTempC} C, fuel ${Math.round(s.fuelPct)} percent, ${s.dtcs.length ? 'fault codes ' + s.dtcs.join(', ') : 'no fault codes'}.`,
          fallback: `Engine's at ${s.engineTempC} degrees, fuel's at ${Math.round(s.fuelPct)} percent, ${s.dtcs.length ? 'and there are fault codes' : 'no faults'}.`,
        };
    }
  }
}
