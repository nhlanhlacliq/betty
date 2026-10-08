import { BikeState } from './types';

export interface RideSnapshot {
  startedAt: number;
  minutesOut: number;
  movingMin: number;
  distanceKm: number;
  stops: number;
  maxSpeedKmh: number;
  /** Average speed while moving */
  avgMovingKmh: number;
  maxLeanDeg: number;
  /** Share of moving time spent leaned past LEAN_CORNER_DEG, 0-100 */
  corneringPct: number;
  /** Metres gained and lost this ride (GPS altitude, small wobbles ignored) */
  climbM: number;
  descentM: number;
  /** Times speed dropped or rose by about 0.35 g or more */
  hardBrakes: number;
  hardAccels: number;
  /** Hard jolts from the road surface this ride (phone accelerometer, approximate) */
  jolts: number;
  maxEngineTempC: number;
  fuelStartPct: number | null;
  /** Things Betty flagged this ride (alerts), oldest first */
  events: Array<{ what: string; atMin: number }>;
  /** Places she has talked about this ride */
  places: string[];
}

const MOVING_KMH = 3;
/** A stop counts once he has been at a standstill this long, having properly got going (GOING_KMH) since the last one. */
const STOP_HOLD_MS = 4000;
const GOING_KMH = 15;
const LEAN_CORNER_DEG = 15;
/** Longest gap between two updates that still counts as riding time (a throttled tab can go quiet for minutes). */
const MAX_STEP_MS = 10_000;
/** Altitude must move this far from the last settled value before it counts: GPS height wanders by several metres. */
const ALT_STEP_M = 8;
/** Speed change per second that counts as hard, in m/s2 (about 0.35 g, roughly 12.5 km/h lost or gained in a second). */
const HARD_MS2 = 3.5;
/** Speed is compared over about this long, so one noisy fix or a dragged slider does not register. */
const SPEED_WINDOW_MS = 1000;

/** Running totals for the current ride, built from state updates. Feeds banter and the cross-ride memory. */
export class RideStats {
  private startedAt: number;
  private lastAt: number | null = null;
  private movingMs = 0;
  private corneringMs = 0;
  private distanceKm = 0;
  private stops = 0;
  private stoppedSince: number | null = null;
  private gotGoing = false;
  private maxLean = 0;
  private maxSpeed = 0;
  private maxTemp = 0;
  private fuelStart: number | null = null;
  private altAnchor: number | null = null;
  private climb = 0;
  private descent = 0;
  private speedRef: { kmh: number; at: number } | null = null;
  private hardBrakes = 0;
  private hardAccels = 0;
  private inHardEvent = false;
  private joltsAtStart: number | null = null;
  private jolts = 0;
  private events: RideSnapshot['events'] = [];
  private places: string[] = [];

  constructor(private now: () => number = Date.now) { this.startedAt = now(); }

  update(s: BikeState) {
    const t = this.now();
    const dt = this.lastAt === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, t - this.lastAt));
    this.lastAt = t;
    const moving = s.speedKmh > MOVING_KMH;
    if (moving) {
      this.movingMs += dt;
      this.distanceKm += (s.speedKmh * dt) / 3_600_000;
      if (Math.abs(s.leanDeg) >= LEAN_CORNER_DEG) this.corneringMs += dt;
      this.maxLean = Math.max(this.maxLean, Math.abs(s.leanDeg));
      this.maxSpeed = Math.max(this.maxSpeed, s.speedKmh);
    }
    // Crawling traffic makes GPS speed flicker around walking pace; on the first real ride that read as 32 "stops".
    if (s.speedKmh >= GOING_KMH) this.gotGoing = true;
    if (moving) this.stoppedSince = null;
    else {
      this.stoppedSince ??= t;
      if (this.gotGoing && t - this.stoppedSince >= STOP_HOLD_MS) { this.stops++; this.gotGoing = false; }
    }

    if (s.altitudeM != null) {
      if (this.altAnchor === null) this.altAnchor = s.altitudeM;
      const d = s.altitudeM - this.altAnchor;
      if (Math.abs(d) >= ALT_STEP_M) { if (d > 0) this.climb += d; else this.descent -= d; this.altAnchor = s.altitudeM; }
    }

    if (!this.speedRef || t - this.speedRef.at > MAX_STEP_MS) this.speedRef = { kmh: s.speedKmh, at: t };
    else if (t - this.speedRef.at >= SPEED_WINDOW_MS) {
      const a = (s.speedKmh - this.speedRef.kmh) / 3.6 / ((t - this.speedRef.at) / 1000);
      const hard = Math.abs(a) >= HARD_MS2;
      if (hard && !this.inHardEvent) { if (a < 0) this.hardBrakes++; else this.hardAccels++; } // one long stop counts once
      this.inHardEvent = hard;
      this.speedRef = { kmh: s.speedKmh, at: t };
    }

    if (this.joltsAtStart === null) this.joltsAtStart = s.jolts;
    this.jolts = Math.max(0, s.jolts - this.joltsAtStart);
    if (s.obd) {
      this.maxTemp = Math.max(this.maxTemp, s.engineTempC);
      if (this.fuelStart === null) this.fuelStart = s.fuelPct;
    }
  }

  noteEvent(what: string) { this.events.push({ what, atMin: Math.round((this.now() - this.startedAt) / 60_000) }); }
  notePlace(name: string) { if (!this.places.includes(name)) this.places.push(name); }

  snapshot(): RideSnapshot {
    return {
      startedAt: this.startedAt,
      minutesOut: (this.now() - this.startedAt) / 60_000,
      movingMin: this.movingMs / 60_000,
      distanceKm: Math.round(this.distanceKm * 10) / 10,
      stops: this.stops,
      maxSpeedKmh: Math.round(this.maxSpeed),
      avgMovingKmh: this.movingMs ? Math.round(this.distanceKm / (this.movingMs / 3_600_000)) : 0,
      maxLeanDeg: Math.round(this.maxLean),
      corneringPct: this.movingMs ? Math.round((this.corneringMs / this.movingMs) * 100) : 0,
      climbM: Math.round(this.climb),
      descentM: Math.round(this.descent),
      hardBrakes: this.hardBrakes,
      hardAccels: this.hardAccels,
      jolts: this.jolts,
      maxEngineTempC: Math.round(this.maxTemp),
      fuelStartPct: this.fuelStart,
      events: [...this.events],
      places: [...this.places],
    };
  }
}
