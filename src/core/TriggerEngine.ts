import { CONFIG, cleanBikeName } from '../config/betty';
import { EMPTY_MEMORY, MarkedSpot, RiderMemory, describeMemory, whenSaid } from './Commands';
import { PlannedRoute, RouteProgress, describeRoute, minutesText, routeProgress } from './Route';
import { profileUse } from './Profile';
import { ServiceBook, describeDue } from './Reminders';
import { LiveRecords, kmMilestoneCrossed } from './Records';
import { CheckpointWeather, describeRouteWeather, rainAhead } from './RouteAhead';
import { BREAK_MS, COLD_FEELS_C, CROSSWIND_KMH, crosswind, fatigueDueMin, feelsLikeC } from './Comfort';
import { Station, describeFuelPlan, describeStations, fuelLeft, kmToReserve, routeFuelPlan, stationsAhead } from './Fuel';
import { banterContext, banterTopics, chooseAmbient, situationDigest, clockNote, freshPlace, greetingFor, pickMode, pickTopic, placesFromHere, whereIs } from './ambient';
import { RideRecord } from './RideMemory';
import { RideSnapshot, RideStats } from './RideStats';
import { angleDiff, bearingDeg, haversineKm } from './geo';
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
  rain_soon: 'rain', traffic_incident: 'a traffic incident', marked_spot: 'a spot he marked', off_route: 'leaving the route',
  fuel_range: 'fuel range getting low', sunset_soon: 'sunset approaching',
};

const byDistance = (a: TrafficIncident, b: TrafficIncident) => a.distanceKm - b.distanceKm;
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const km = (n: number) => `${Math.round(n * 10) / 10} km`;

/**
 * What identifies an incident across rides. TomTom's ids are not guaranteed to stay the same from day to day, so a
 * named one is known by what and where ("a road closure|Hendrik Potgieter Street").
 */
export const incidentKey = (i: TrafficIncident) => (i.roadName ? `${i.description}|${i.roadName}` : i.id);

/** A closure shorter than this is a side street or a driveway, not something to plan around. */
const MIN_CLOSURE_M = 150;
/** How far either side of straight ahead still counts as "on his way". */
const AHEAD_DEG = 50;
/** Off the route: this far from its line (km) for this long while moving; back on it under BACK_ON_KM. */
const OFF_ROUTE_KM = 0.4;
const OFF_ROUTE_MS = 20_000;
const BACK_ON_KM = 0.15;
/** Warn about a marked spot this far ahead (km), and not again for this long. */
const MARK_WARN_KM = 0.4;
/** Standing still this long (under 3 km/h) = parked: one line asking, then quiet until he moves (ride of 2026-10-17). */
export const PARKED_MS = 10 * 60_000;
const STILL_KMH = 3;
const MOVING_AGAIN_KMH = 10;
/**
 * One angle per time check, in turn: with only "N minutes out" to go on, 18 time checks in a ride all made the same
 * joke ("Betty is holding steady", "I suspect..."). Each gets a different thing to hang it on.
 */
export const MILESTONE_ANGLES = [
  'the distance covered so far', 'the weather right now', 'something about the area he is in', 'a comparison with how else the time could have been spent',
  'just the time, bare and dry', 'the road or the riding so far', 'what is still ahead of the day', 'a small observation about the bike, without readings',
];
const WARN_AGAIN_MS = 10 * 60_000;

/**
 * A city has dozens of incidents within a few kilometres at rush hour. Only the ones that matter get a line:
 * close enough, serious enough, costing real time, and, once he is moving, roughly in the direction he is going.
 */
export function worthMentioning(i: TrafficIncident, s: BikeState): boolean {
  const t = CONFIG.thresholds;
  if (i.distanceKm > t.trafficRadiusKm || i.severity < t.trafficMinSeverity) return false;
  if (i.severity === 4 && i.lengthM != null && i.lengthM < MIN_CLOSURE_M) return false;
  if (i.severity < 4 && i.delaySec != null && i.delaySec < t.trafficMinDelaySec) return false;
  const placed = i.lat !== 0 || i.lon !== 0; // simulator incidents have no position
  if (placed && s.lat != null && s.lon != null && s.headingDeg != null && s.speedKmh >= 10) {
    return Math.abs(angleDiff(s.headingDeg, bearingDeg({ lat: s.lat, lon: s.lon }, i))) <= AHEAD_DEG;
  }
  return true;
}

/** Evaluates state, emits deduplicated trigger events. Pure logic: no I/O, easy to test. All tuning is read live from CONFIG. */
export class TriggerEngine {
  private lastFired = new Map<TriggerId, number>();
  private announced = new Set<string>();
  /** Incidents announced on earlier rides (by incidentKey): the same closure near home is not news every ride. */
  private known = new Set<string>();
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
  /** Fuel by distance: km since the last fill-up as it stood when fuelOffsetKm of this ride had been ridden. */
  private fuelBaseKm: number | null = null;
  private fuelOffsetKm = 0;

  constructor(private now: () => number = Date.now, private rng: () => number = Math.random) {
    this.rideStart = now(); this.lastAmbientSlot = now(); this.stats = new RideStats(now);
  }

  reset() {
    this.lastFired.clear(); this.announced.clear(); this.mentioned.clear(); this.storiedAreas.clear(); this.warnedSpots.clear();
    this.topicUse.clear(); this.topicSeq = 0; this.lastMode = null;
    this.rideStart = this.now(); this.milestonesHit = 0; this.lastAmbientSlot = this.now(); this.quietUntil = 0;
    this.stillSince = null; this.parked = false; this.detour = false; this.detourLeft = false; this.saidLongest = false; this.lastDistance = 0;
    this.rainWarned.clear(); this.movingAtBreak = 0; this.fatigueAtMoving = null; this.coldSaid = false;
    const carried = this.kmSinceFill(); // a new ride does not refill the tank
    this.stats = new RideStats(this.now);
    this.fuelBaseKm = carried; this.fuelOffsetKm = 0;
  }

  /** Km ridden since the last fill-up as last saved (null = no fill-up on record). Call at ride start. */
  setFuelKm(km: number | null) { this.fuelBaseKm = km; this.fuelOffsetKm = this.stats.snapshot().distanceKm; }
  /** The rider has just filled the tank. */
  filledUp() { this.setFuelKm(0); this.lastFired.delete('fuel_range'); }
  kmSinceFill(): number | null {
    if (this.fuelBaseKm === null) return null;
    return Math.round((this.fuelBaseKm + this.stats.snapshot().distanceKm - this.fuelOffsetKm) * 10) / 10;
  }
  /** Km left before the reserve, from the tank and his average consumption. An estimate from distance, not a gauge. */
  fuelKmLeft(): number | null {
    const used = this.kmSinceFill();
    return used === null ? null : fuelLeft(used, CONFIG.fuel).kmToReserve;
  }
  /** Litres and km left (null = no fill-up on record). */
  fuelNow() { const used = this.kmSinceFill(); return used === null ? null : fuelLeft(used, CONFIG.fuel); }
  /** Service reminders and Betty's odometer (what is due goes in the briefing, answers and sign-off). */
  private book: ServiceBook | null = null;
  setServiceBook(b: ServiceBook | null) { this.book = b; }
  serviceBook() { return this.book; }
  /** What is due now, with the km ridden this ride added (the book's odometer is saved once a minute). */
  private dueNote(all = false): string {
    return this.book ? describeDue(this.book, this.now(), all) : '';
  }
  /** For an answer: what is due, or every reminder when he asks about maintenance. */
  private dueFor(said: string): string {
    const note = this.dueNote(/\b(service|maintenance|due|chain|tyres?|tires?|oil|lube|reminders?)\b/i.test(said));
    return note ? ` ${note}` : '';
  }
  /** Petrol stations near him (adapters/StationSource, fetched when fuel gets low or he asks). */
  private stations: Station[] = [];
  setStations(list: Station[]) { this.stations = list; }
  stationsNear(s: BikeState) {
    if (!this.stations.length || s.lat == null || s.lon == null) return [];
    return stationsAhead(this.stations, { lat: s.lat, lon: s.lon }, s.speedKmh >= 10 ? s.headingDeg : null, this.route, this.progress);
  }
  /** Her words on the fuel: litres and km left, the reserve, and stations ahead when known. '' without a fill-up. */
  private fuelNote(s: BikeState): string {
    const f = this.fuelNow();
    if (!f) return '';
    const est = `estimated from distance since the last fill-up and his dash average of ${CONFIG.fuel.lPer100} L/100 km, not a gauge`;
    const now = f.onReserve
      ? `He is on reserve: about ${f.litres} litres and ${f.kmToEmpty} km until empty (${est}).`
      : `About ${f.kmToReserve} km before the reserve starts, about ${f.litres} litres left, ${f.kmToEmpty} km until empty (${est}).`;
    const near = this.stationsNear(s);
    return `${now}${this.stations.length && s.lat != null ? ` ${describeStations(near, f.kmToEmpty)}` : ''}`;
  }
  private fuelPlanNote(): string {
    if (!this.route || this.progress) return '';
    return ` Fuel for the route: ${describeFuelPlan(routeFuelPlan(this.route, CONFIG.fuel, this.kmSinceFill()))}`;
  }

  private memory: RiderMemory = EMPTY_MEMORY;
  /** Area stories already told (kept across rides by the UI layer), so riding through again brings new ones. */
  private toldNotes = new Set<string>();
  setToldNotes(ids: string[]) { this.toldNotes = new Set(ids); }
  toldNoteIds(): string[] { return [...this.toldNotes]; }
  private freshNote(s: BikeState) { return s.areaNotes.find((n) => !this.toldNotes.has(n.id)) ?? null; }
  /** His rider profile (null = none, or "Let Betty know me" is off) */
  private profile: string | null = null;
  setProfile(text: string | null) { this.profile = text && text.trim() ? text.trim() : null; }
  /** The planned route (api/route.ts) and where he is on it, updated each evaluate */
  private route: PlannedRoute | null = null;
  private progress: RouteProgress | null = null;
  private offSince: number | null = null;
  private offWarned = false;
  private stopsSaid = new Set<string>();
  private arrivedSaid = false;
  /** He said he is on a detour: no off-route lines until he is back on the route after having left it. */
  private detour = false;
  private detourLeft = false;
  setRoute(r: PlannedRoute | null) {
    this.route = r; this.progress = null; this.offSince = null; this.offWarned = false; this.stopsSaid.clear(); this.arrivedSaid = false;
    this.detour = false; this.detourLeft = false; this.rainWarned.clear(); this.routeWx = [];
  }
  setDetour(on: boolean) { this.detour = on; this.detourLeft = false; if (on) this.offWarned = true; }
  onDetour() { return this.detour; }
  /** The weather at each checkpoint of the route at the hour he gets there (adapters/RouteWeather, every 30 min). */
  private routeWx: CheckpointWeather[] = [];
  private rainWarned = new Set<string>();
  private rainNow: CheckpointWeather | null = null;
  setRouteWeather(list: CheckpointWeather[]) { this.routeWx = list; }
  routeWeather() { return this.routeWx; }
  /** Fatigue: riding minutes at the end of his last real break, and when she last said so. */
  private movingAtBreak = 0;
  private fatigueAtMoving: number | null = null;
  /** Wind and cold: what she is about to say, and whether the cold was said this ride. */
  private comfortNow: { kind: 'wind'; cross: number } | { kind: 'cold'; feels: number } | null = null;
  private coldSaid = false;
  /** His records before this ride (longest, total km), for "your longest ride yet" and "1,000 km together". */
  private live: LiveRecords | null = null;
  private saidLongest = false;
  private lastDistance = 0;
  private recordNow: { kind: 'longest' | 'total'; km: number } | null = null;
  setRecords(r: LiveRecords | null) { this.live = r; this.saidLongest = false; }
  /** Since when he has been standing still, and whether she has gone quiet for it. */
  private stillSince: number | null = null;
  private parked = false;
  isParked() { return this.parked; }
  routeNow(): { route: PlannedRoute; progress: RouteProgress | null } | null { return this.route ? { route: this.route, progress: this.progress } : null; }
  /** Marked spots warned about, by when the spot was saved -> when warned (each at most once in WARN_AGAIN_MS) */
  private warnedSpots = new Map<number, number>();
  private spotNow: { spot: MarkedSpot; km: number } | null = null;
  /**
   * The nearest marked spot just ahead (owner's road-hazard idea, built 2026-10-17): within MARK_WARN_KM, moving at
   * 15 km/h or more, inside AHEAD_DEG of his course, and not warned in the last 10 minutes.
   */
  private spotAhead(s: BikeState): { spot: MarkedSpot; km: number } | null {
    if (s.lat == null || s.lon == null || s.headingDeg == null || s.speedKmh < 15) return null;
    const here = { lat: s.lat, lon: s.lon };
    let best: { spot: MarkedSpot; km: number } | null = null;
    for (const m of this.memory.marks) {
      const km = haversineKm(here, m);
      if (km > MARK_WARN_KM || km < 0.02) continue;
      if (Math.abs(angleDiff(s.headingDeg, bearingDeg(here, m))) > AHEAD_DEG) continue;
      const warned = this.warnedSpots.get(m.at);
      if (warned !== undefined && this.now() - warned < WARN_AGAIN_MS) continue;
      if (!best || km < best.km) best = { spot: m, km };
    }
    return best;
  }
  /** Areas she has told a story about this ride: arriving somewhere new gets a story at the next remark. */
  private storiedAreas = new Set<string>();
  /** What he told her to remember and the spots he marked (for her answers). */
  setMemory(m: RiderMemory) { this.memory = m; }
  private quietUntil = 0;
  /** "Quiet for ten minutes": no banter, tour guide or time checks until then (Infinity = until he says so). */
  setQuiet(until: number) { this.quietUntil = until; }
  /** Minutes of quiet left, Infinity until he says so, or 0 when she may chat. */
  quietLeftMin(): number { const left = this.quietUntil - this.now(); return left <= 0 ? 0 : left === Infinity ? Infinity : Math.ceil(left / 60_000); }

  /** Past rides Betty remembers (loaded by the UI layer from wherever they are stored). */
  setHistory(history: RideRecord[]) { this.history = history; }
  /** Incidents already announced on earlier rides (keys from incidentKey). */
  setKnownIncidents(keys: string[]) { this.known = new Set(keys); }
  private announcedKeys: string[] = [];
  /** Keys of the incidents announced this ride, to remember for the next ones. */
  announcedIncidents(): string[] { return [...this.announcedKeys]; }
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

  /** The pre-ride briefing. Give it the state once the feeds are in (main.ts waits up to 10 s for weather). */
  startup(s: BikeState = initialState()): TriggerEvent { return this.force('startup', s); }

  private riderText: string | null = null;
  /** What the phone did with his words before asking her (a fill-up, a detour), for her answer. */
  private riderNoted: string[] = [];

  /** He said something to her (typed in the chat panel now; spoken once voice input exists). */
  ask(text: string, s: BikeState, noted: string[] = []): TriggerEvent {
    this.riderText = text.trim();
    this.riderNoted = noted;
    try { return { ...this.force('rider_query', s), riderSaid: this.riderText }; } finally { this.riderText = null; this.riderNoted = []; }
  }

  /** Emit an event now, ignoring cooldowns (simulator buttons, rider queries). */
  force(id: TriggerId, s: BikeState, incident?: TrafficIncident): TriggerEvent {
    this.lastFired.set(id, this.now());
    const { context, fallback, mark } = this.describe(id, s, incident);
    mark?.();
    const label = EVENT_LABELS[id];
    if (label) this.stats.noteEvent(label);
    const use = this.profile && context ? profileUse(id, this.rng) : null;
    return { id, priority: CONFIG.priorities[id], context, fallback, createdAt: this.now(), ...(use ? { profile: { text: this.profile!, use } } : {}) };
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

    else { // no fuel gauge: go by distance since the last fill-up, if the rider has recorded one
      const left = this.fuelKmLeft();
      if (left !== null && left <= CONFIG.fuel.warnKmLeft && this.ready('fuel_range')) out.push(this.force('fuel_range', s));
    }

    const w = s.weather;
    if (w && (w.rainNowMm >= 0.1 || w.rainChanceNextHourPct >= t.rainChancePct) && this.ready('rain_soon')) {
      out.push(this.force('rain_soon', s));
    }
    const toSunset = this.minutesToSunset(s);
    if (toSunset !== null && toSunset > 0 && toSunset <= t.sunsetWarnMin && this.ready('sunset_soon')) {
      out.push(this.force('sunset_soon', s));
    }

    const inc = s.incidents
      .filter((i) => worthMentioning(i, s) && !this.announced.has(i.id) && !this.known.has(incidentKey(i)))
      .sort(byDistance)[0];
    if (inc && this.ready('traffic_incident')) {
      this.announced.add(inc.id);
      this.announcedKeys.push(incidentKey(inc));
      out.push(this.force('traffic_incident', s, inc));
    }

    // The planned route: leaving it (well off it for 20 s while moving), the next named stop within 1 km, arrival.
    if (this.route && s.lat != null && s.lon != null) {
      const p = routeProgress(this.route, { lat: s.lat, lon: s.lon }, this.progress?.index ?? 0);
      this.progress = p;
      if (this.detour) { // he said so: no off-route lines; back on the route after leaving it ends the detour
        if (p.offKm > OFF_ROUTE_KM) this.detourLeft = true;
        else if (this.detourLeft && p.offKm < BACK_ON_KM) { this.detour = false; this.detourLeft = false; this.offSince = null; this.offWarned = false; }
      } else if (p.offKm > OFF_ROUTE_KM && s.speedKmh >= 15) {
        this.offSince ??= this.now();
        if (!this.offWarned && this.now() - this.offSince >= OFF_ROUTE_MS && this.ready('off_route')) { this.offWarned = true; out.push(this.force('off_route', s)); }
      } else if (p.offKm < BACK_ON_KM) { this.offSince = null; this.offWarned = false; }
      if (p.next && p.next.km <= 1 && p.offKm < OFF_ROUTE_KM && !this.stopsSaid.has(p.next.name)) { this.stopsSaid.add(p.next.name); out.push(this.force('route_stop', s)); }
      if (p.arrived && !this.arrivedSaid) { this.arrivedSaid = true; out.push(this.force('route_arrived', s)); }
      // Rain where he will be (within two hours), once per place a ride.
      const wet = rainAhead(this.routeWx.filter((w) => w.at > this.now()));
      if (wet && !this.rainWarned.has(wet.name)) {
        this.rainWarned.add(wet.name); this.rainNow = wet;
        try { out.push(this.force('route_weather', s)); } finally { this.rainNow = null; }
      }
    }

    const spot = this.spotAhead(s);
    if (spot && this.ready('marked_spot')) {
      this.warnedSpots.set(spot.spot.at, this.now());
      this.spotNow = spot;
      try { out.push(this.force('marked_spot', s)); } finally { this.spotNow = null; }
    }

    // Fatigue (P2): two hours riding without a real break (one at night), then again every hour without one.
    if (s.speedKmh >= MOVING_AGAIN_KMH) {
      const moving = this.stats.snapshot().movingMin;
      const due = fatigueDueMin(new Date(this.now()).getHours());
      if (moving - this.movingAtBreak >= due && (this.fatigueAtMoving === null || moving - this.fatigueAtMoving >= 60)) {
        this.fatigueAtMoving = moving;
        out.push(this.force('fatigue', s));
      }
    }
    // Wind across the bike (gusts) and the cold he feels at speed (P2).
    const wx = s.weather;
    if (wx && s.speedKmh >= 30) {
      const heading = s.headingDeg;
      if (heading != null && wx.windGustKmh != null && wx.windFromDeg != null) {
        const cross = crosswind(wx.windGustKmh, wx.windFromDeg, heading);
        if (cross >= CROSSWIND_KMH && this.ready('wind_cold')) {
          this.comfortNow = { kind: 'wind', cross };
          try { out.push(this.force('wind_cold', s)); } finally { this.comfortNow = null; }
        }
      }
      const feels = feelsLikeC(wx.tempC, s.speedKmh, wx.windKmh, wx.windFromDeg ?? null, heading);
      if (!this.coldSaid && feels <= COLD_FEELS_C && s.speedKmh >= 40) {
        this.coldSaid = true; this.comfortNow = { kind: 'cold', feels };
        try { out.push(this.force('wind_cold', s)); } finally { this.comfortNow = null; }
      }
    }
    // Parked: after PARKED_MS standing still she asks once, then stays quiet until he moves off again.
    if (s.speedKmh < STILL_KMH) this.stillSince ??= this.now();
    else if (s.speedKmh >= MOVING_AGAIN_KMH) {
      // A stop of 15 minutes or more was a real break: the fatigue count starts again.
      if (this.stillSince !== null && this.now() - this.stillSince >= BREAK_MS) { this.movingAtBreak = this.stats.snapshot().movingMin; this.fatigueAtMoving = null; }
      this.stillSince = null;
      if (this.parked) { this.parked = false; this.lastAmbientSlot = this.now(); }
    }
    if (!this.parked && this.stillSince !== null && this.now() - this.stillSince >= PARKED_MS) {
      this.parked = true;
      if (this.ready('ride_parked')) out.push(this.force('ride_parked', s));
    }

    const mins = (this.now() - this.rideStart) / 60_000;
    const due = Math.floor(mins / CONFIG.milestoneEveryMin);
    // He asked for quiet, or is parked: time checks and ambient slots pass unused (so they do not all arrive the
    // moment it ends).
    if (this.now() < this.quietUntil || this.parked) {
      this.milestonesHit = Math.max(this.milestonesHit, due);
      this.lastAmbientSlot = this.now();
      return out;
    }
    // Records (P3, so not while quiet or parked): his longest ride passed (with a few rides behind him, and a ride of
    // some length), and a total-km milestone crossed. Once each per ride.
    if (this.live) {
      const before = this.lastDistance, dist = this.stats.snapshot().distanceKm;
      this.lastDistance = dist;
      const crossed = kmMilestoneCrossed(this.live.totalKm + before, this.live.totalKm + dist);
      if (!this.saidLongest && this.live.rides >= 3 && this.live.longestKm >= 10 && dist > this.live.longestKm) {
        this.saidLongest = true;
        this.recordNow = { kind: 'longest', km: this.live.longestKm };
        try { out.push(this.force('ride_record', s)); } finally { this.recordNow = null; }
        return out;
      }
      if (crossed && this.live.rides >= 1) {
        this.recordNow = { kind: 'total', km: crossed };
        try { out.push(this.force('ride_record', s)); } finally { this.recordNow = null; }
        return out;
      }
    }
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
      const note = this.freshNote(s);
      // Owner, 2026-10-17: area stories should come up on their own. On arriving in a new area the next remark is a
      // story about it (unless the tour guide is switched off); after that they come up in the normal mix.
      const arriving = note !== null && CONFIG.ambient.tourGuideWeight > 0 && !this.storiedAreas.has(note.area);
      const pick = arriving ? 'area_story' : chooseAmbient(CONFIG.ambient, place !== null, this.rng, note !== null);
      if (pick) out.push(this.force(pick, s));
    }
    return out;
  }

  private minutesToSunset(s: BikeState): number | null {
    return s.weather?.sunsetAt != null ? (s.weather.sunsetAt - this.now()) / 60_000 : null;
  }

  private ready(id: TriggerId) {
    const last = this.lastFired.get(id);
    return last === undefined || this.now() - last >= CONFIG.cooldownsMs[id];
  }

  private describe(id: TriggerId, s: BikeState, incident?: TrafficIncident): { context: string; fallback: string; mark?: () => void } {
    switch (id) {
      case 'startup': {
        const at = new Date(this.now());
        const hello = greetingFor(at.getHours());
        const greet = hello
          ? `If you greet him, the only greeting that fits this hour is "${hello}".`
          : 'These are the small hours, so open without any greeting: go straight to saying you are ready.'; // naming the words to avoid made her say them
        // Owner liked the self-introduction she gave when asked "tell me about yourself" (2026-10-16): a briefing.
        const left = this.fuelKmLeft();
        const ahead = s.incidents.filter((i) => worthMentioning(i, s) && !this.known.has(incidentKey(i)) && !this.announced.has(i.id)).sort(byDistance);
        for (const i of ahead.slice(0, 3)) { this.announced.add(i.id); this.announcedKeys.push(incidentKey(i)); }
        const digest = situationDigest({
          s, ride: this.stats.snapshot(), history: this.history, at, placeRadiusKm: CONFIG.ambient.placeRadiusKm,
          // Only incidents not announced in the last week: the briefing named the same Hendrik Potgieter closure ride
          // after ride (2026-10-17). Any it does name count as announced, so no alert repeats them a minute later.
          fuelKmLeft: left, incidentsAhead: ahead,
          skip: ['time', 'duration', 'distance', 'standing', 'speed_now', 'stops', 'traffic'], // nothing has happened yet; the clock is given above
        });
        const kept = describeMemory(this.memory, s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null, this.now(), 3);
        const pz = CONFIG.persona;
        const w = s.weather;
        const canned = ['Systems online.',
          w ? ` ${cap(w.summary)}, ${Math.round(w.tempC)} degrees, ${w.rainChanceNextHourPct} percent chance of rain in the next hour.` : '',
          left === null ? '' : ` About ${left} kilometres to reserve by my count.`].join('');
        return {
          context: `The ride session has just started. Local time is ${clockNote(at)}. ${greet} Your settings: humour ${pz.humour} percent, ${100 - pz.tars} percent JARVIS, ${pz.tars} percent TARS. What you know: ${digest}${kept ? ` ${kept}` : ''}${this.route ? ` ${describeRoute(this.route, null)}${this.fuelPlanNote()}${this.routeWx.length ? ` ${describeRouteWeather(this.routeWx)}` : ''}` : ''}${this.dueNote() ? ` ${this.dueNote()} Mention what is due briefly.` : ''}`,
          fallback: canned,
        };
      }
      case 'engine_overtemp':
        return {
          context: `Engine temperature is ${s.engineTempC} C and climbing.`,
          fallback: 'Engine temp is high. Ease off and find somewhere to pull over.',
        };
      case 'dtc_detected': {
        const codes = s.dtcs.length ? s.dtcs : ['P0000'];
        return {
          context: `The bike reported fault codes: ${codes.join(', ')}.`,
          fallback: `${cap(cleanBikeName(CONFIG.bikeName))} is reporting a fault code, ${codes[0]}. Worth checking when you stop.`,
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
        const mins = i.delaySec ? Math.max(1, Math.round(i.delaySec / 60)) : 0;
        const delay = mins ? `, adding about ${mins} minute${mins === 1 ? '' : 's'}` : '';
        return {
          context: `Traffic report: ${i.description}${where}, about ${km(i.distanceKm)} away in the direction he is heading${delay}. Severity ${i.severity} of 4 (4 means closed).`,
          fallback: `Heads up. ${cap(i.description)}${where}, about ${km(i.distanceKm)} away${delay}.`,
        };
      }
      case 'ride_milestone': {
        const mins = Math.round((this.now() - this.rideStart) / 60_000);
        const r = this.stats.snapshot();
        const riding = Math.round(r.movingMin);
        const angle = MILESTONE_ANGLES[Math.max(0, this.milestonesHit - 1) % MILESTONE_ANGLES.length];
        const facts = [`${r.distanceKm} km so far`, s.weather ? `weather ${s.weather.summary}, ${s.weather.tempC} C` : '', s.area?.suburb || s.area?.town ? `he is in ${s.area.suburb || s.area.town}` : ''].filter(Boolean).join('; ');
        const split = mins - riding >= 5 ? ` (${riding} of them riding, the rest stopped)` : '';
        return {
          context: `The rider has been out for ${mins} minutes${split}. For this time check, hang the line on ${angle}. Facts you may use: ${facts}.`,
          fallback: `You've been out ${mins} minute${mins === 1 ? '' : 's'}. Good ride so far.`,
        };
      }
      case 'ride_record': {
        const r = this.recordNow, dist = this.stats.snapshot().distanceKm;
        if (!r) return { context: '', fallback: '' };
        if (r.kind === 'longest') {
          const when = this.live?.longestWhen ? whenSaid(this.live.longestWhen, this.now()) : 'before';
          return {
            context: `This is now his longest ride with you: ${Math.round(dist)} km so far, past his previous longest of ${Math.round(r.km)} km (${when}).`,
            fallback: "That's your longest ride with me yet.",
          };
        }
        return {
          context: `He has just passed ${r.km.toLocaleString('en-US')} km of riding with you in total, over ${(this.live?.rides ?? 0) + 1} rides.`,
          fallback: `That's ${r.km.toLocaleString('en-US')} kilometres together.`,
        };
      }
      case 'fatigue': {
        const r = this.stats.snapshot();
        const since = Math.round(r.movingMin - this.movingAtBreak);
        const next = this.progress?.next;
        const night = fatigueDueMin(new Date(this.now()).getHours()) === 60;
        return {
          context: `He has been riding for ${minutesText(since)} without a proper break${night ? ', and it is late' : ''}. Suggest a break, kindly and briefly${next ? `; his next planned stop, ${next.name}, is ${Math.round(next.km)} km ahead` : ''}. Do not lecture.`,
          fallback: `${minutesText(since)} in the saddle without a break. Worth stopping soon${next ? `, ${next.name} is ${Math.round(next.km)} kilometres on` : ''}.`,
        };
      }
      case 'wind_cold': {
        const c = this.comfortNow;
        if (!c) return { context: '', fallback: '' };
        return c.kind === 'wind'
          ? { context: `Strong wind across his line of travel: gusts of about ${c.cross} km/h from the side. Warn him plainly in a line; do not tell him how to ride.`, fallback: `Strong crosswind gusts, around ${c.cross} km/h.` }
          : { context: `At this speed the wind chill makes it feel about ${c.feels} C on the bike (air ${s.weather?.tempC} C). Mention it plainly in a line, in case he wants another layer at the next stop.`, fallback: `It feels about ${c.feels} degrees at this speed.` };
      }
      case 'route_weather': {
        const w = this.rainNow;
        if (!w) return { context: '', fallback: '' };
        const at = new Date(w.at).toTimeString().slice(0, 5);
        return {
          context: `On his route, rain is likely around ${w.name} when he gets there, at about ${at}: ${w.rainPct}% chance, ${w.summary}, ${w.tempC} C. It is ${w.km} km ahead. Tell him plainly in a line, so he can plan for it.`,
          fallback: `Rain likely around ${w.name} by about ${at}.`,
        };
      }
      case 'ride_parked': {
        const mins = Math.round((this.now() - (this.stillSince ?? this.now())) / 60_000);
        return {
          context: `He has been standing still for ${mins} minutes: he may have parked or stopped for a break. In one short line, ask whether he has parked, tell him to say "end ride" if he is done, and that you will keep quiet until he moves.`,
          fallback: "Parked? Say 'end ride' if we're done. I'll keep quiet till you move.",
        };
      }
      case 'fuel_range': {
        const left = this.fuelKmLeft();
        if (left === null) {
          return { context: 'No fill-up has been recorded, so the fuel range is unknown. Tell him so, briefly.', fallback: 'I have no fill-up on record, so I cannot estimate your range.' };
        }
        const near = this.stationsNear(s)[0];
        return {
          context: `Fuel is getting low. ${this.fuelNote(s)} Tell him plainly, and where the nearest station ahead is if one is given.`,
          fallback: `About ${left} kilometres before reserve by my count.${near ? ` ${near.name}${near.area ? ` in ${near.area}` : ''} is about ${Math.round(near.km)} kilometres ahead.` : ' Time to plan a stop.'}`,
        };
      }
      case 'sunset_soon': {
        const m = this.minutesToSunset(s);
        if (m === null || m <= 0) return { context: 'Sunset time is not known right now. Tell him so, briefly.', fallback: 'I do not have a sunset time right now.' };
        const mins = Math.max(5, Math.round(m / 5) * 5);
        return {
          context: `Sunset is in about ${mins} minutes; the light will start going before then.`,
          fallback: `About ${mins} minutes to sunset. The light will be going soon.`,
        };
      }
      case 'ride_debrief': {
        const r = this.stats.snapshot();
        const stoppedMin = Math.round(r.minutesOut - r.movingMin);
        const bits = [`${Math.round(r.minutesOut)} minutes${stoppedMin >= 5 ? ` (${Math.round(r.movingMin)} riding, ${stoppedMin} stopped)` : ''}`, `${r.distanceKm} km`];
        if (r.movingMin >= 1) bits.push(`averaging ${r.avgMovingKmh} km/h while moving`, `top speed ${r.maxSpeedKmh} km/h`);
        bits.push(`${r.stops} stop(s)`);
        if (r.climbM >= 20) bits.push(`${r.climbM} m climbed`);
        if (r.hardBrakes) bits.push(`${r.hardBrakes} hard stop(s) on the brakes`);
        if (r.places.length) bits.push(`places you told him about: ${r.places.join(', ')}`);
        if (r.events.length) bits.push(`you flagged: ${[...new Set(r.events.map((e) => e.what))].join(', ')}`);
        if (s.weather) bits.push(`weather ${s.weather.summary}, ${s.weather.tempC} C`);
        const left = s.obd ? null : this.fuelKmLeft();
        if (left !== null) bits.push(`about ${left} km of fuel range left by distance`);
        const due = this.dueNote();
        if (due) bits.push(`${due.replace(/\.$/, '')} (mention it in passing)`);
        return {
          context: `The ride has just ended. Summary: ${bits.join('; ')}.`,
          fallback: `Ride done: ${Math.round(r.minutesOut)} minutes and ${r.distanceKm} kilometres${r.stops ? `, with ${r.stops} stop${r.stops === 1 ? '' : 's'}` : ''}. Good one.`,
        };
      }
      // Ambient flavours have no canned fallback: without Claude, or with nothing to go on, Betty stays quiet.
      case 'ambient_banter': {
        const topics = banterTopics({
          s, ride: this.stats.snapshot(), history: this.history, at: new Date(this.now()), placeRadiusKm: CONFIG.ambient.placeRadiusKm,
          fuelKmLeft: this.fuelKmLeft(),
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
      case 'off_route': {
        const p = this.progress, r = this.route;
        if (!p || !r) return { context: '', fallback: '' };
        return {
          context: `He has left his planned route to ${r.name}: he is about ${p.offKm.toFixed(1)} km away from it. Tell him plainly in a line; Google Maps on his screen will guide him back, so do not give directions.`,
          fallback: `You're off the route to ${r.name}. Maps will bring you back.`,
        };
      }
      case 'route_stop': {
        const p = this.progress;
        if (!p?.next) return { context: '', fallback: '' };
        return {
          context: `His next planned stop, ${p.next.name}, is about ${Math.max(0.1, Math.round(p.next.km * 10) / 10)} km ahead. Let him know it is coming up, in a line.`,
          fallback: `${p.next.name} coming up, about a kilometre ahead.`,
        };
      }
      case 'route_arrived': {
        const r = this.route;
        if (!r) return { context: '', fallback: '' };
        const mins = Math.round((this.now() - this.rideStart) / 60_000);
        return {
          context: `He has reached the end of his planned route: ${r.name}, ${Math.round(r.km)} km planned, ${minutesText(mins)} since he set off. Welcome him in, warmly, one or two lines.`,
          fallback: `That's ${r.name}. Route done.`,
        };
      }
      case 'marked_spot': {
        const m = this.spotNow;
        if (!m) return { context: '', fallback: '' };
        const metres = Math.max(50, Math.round((m.km * 1000) / 50) * 50);
        const note = m.spot.note ? `, with his note "${m.spot.note}"` : '';
        return {
          context: `He is about ${metres} metres from a spot he marked ${whenSaid(m.spot.at, this.now())}${m.spot.near ? ` near ${m.spot.near}` : ''}${note}. It is ahead of him. Give him a short heads-up: what it is and how far. If the note sounds like a hazard (a pothole, gravel, a speed camera), say it plainly as a warning, no joke. Never tell him how to steer, which part of the lane to use or what speed to do: you cannot see the road.`,
          fallback: `Marked spot ahead${m.spot.note ? `: ${m.spot.note}` : ''}.`,
        };
      }
      case 'area_story': {
        const n = this.freshNote(s);
        if (!n) return { context: '', fallback: '' };
        return {
          context: `He is riding through ${n.area}. A story about ${n.area} (${n.topic}): ${n.text}`, fallback: '',
          mark: () => { this.toldNotes.add(n.id); this.storiedAreas.add(n.area); this.stats.notePlace(n.area); },
        };
      }
      case 'rider_query': {
        if (this.riderText) {
          const r = this.stats.snapshot();
          const digest = situationDigest({
            s, ride: r, history: this.history, at: new Date(this.now()), placeRadiusKm: CONFIG.ambient.placeRadiusKm,
            fuelKmLeft: this.fuelKmLeft(), incidentsAhead: s.incidents.filter((i) => worthMentioning(i, s)).sort(byDistance),
            riderSaid: this.riderText,
          });
          const here = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null;
          const kept = describeMemory(this.memory, here, this.now());
          return {
            context: `He just said to you: "${this.riderText}". What you know right now: ${digest}${kept ? ` ${kept}` : ''}${this.route ? ` ${describeRoute(this.route, this.progress, this.detour)}${this.routeWx.length ? ` ${describeRouteWeather(this.routeWx.filter((w) => w.at > this.now()))}` : ''}` : ''}${!s.obd && this.fuelNow() ? ` Fuel: ${this.fuelNote(s)}` : ''}${this.dueFor(this.riderText)}${this.riderNoted.length ? ` ${this.riderNoted.join(' ')}` : ''}`,
            fallback: `I can't think that one through without a signal. You're ${Math.round(r.minutesOut)} minutes in, ${r.distanceKm} kilometres done.`,
          };
        }
        if (!s.obd) {
          const r = this.stats.snapshot();
          const w = s.weather ? ` Weather: ${s.weather.summary}, ${s.weather.tempC} C.` : '';
          const left = this.fuelKmLeft();
          const range = left === null ? '' : ` ${this.fuelNote(s)}`;
          return {
            context: `The rider asked how things are going. No engine data is connected, so say nothing about engine temperature, revs or faults. He has been out ${Math.round(r.minutesOut)} minutes and covered ${r.distanceKm} km.${range}${w}`,
            fallback: `No engine data connected. You're ${Math.round(r.minutesOut)} minutes in, ${r.distanceKm} kilometres done${left === null ? '' : `, about ${left} kilometres to reserve by my count`}.`,
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
