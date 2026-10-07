import { BikeState } from './types';

export interface RideSnapshot {
  startedAt: number;
  minutesOut: number;
  movingMin: number;
  distanceKm: number;
  stops: number;
  maxLeanDeg: number;
  /** Share of moving time spent leaned past LEAN_CORNER_DEG, 0-100 */
  corneringPct: number;
  maxEngineTempC: number;
  fuelStartPct: number | null;
  /** Things Betty flagged this ride (alerts), oldest first */
  events: Array<{ what: string; atMin: number }>;
  /** Places she has talked about this ride */
  places: string[];
}

const MOVING_KMH = 3;
const LEAN_CORNER_DEG = 15;
/** Longest gap between two updates that still counts as riding time (a throttled tab can go quiet for minutes). */
const MAX_STEP_MS = 10_000;

/** Running totals for the current ride, built from state updates. Feeds banter and the cross-ride memory. */
export class RideStats {
  private startedAt: number;
  private lastAt: number | null = null;
  private movingMs = 0;
  private corneringMs = 0;
  private distanceKm = 0;
  private stops = 0;
  private wasMoving = false;
  private maxLean = 0;
  private maxTemp = 0;
  private fuelStart: number | null = null;
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
    } else if (this.wasMoving) {
      this.stops++;
    }
    this.wasMoving = moving;
    this.maxTemp = Math.max(this.maxTemp, s.engineTempC);
    if (this.fuelStart === null && s.rpm > 0) this.fuelStart = s.fuelPct;
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
      maxLeanDeg: Math.round(this.maxLean),
      corneringPct: this.movingMs ? Math.round((this.corneringMs / this.movingMs) * 100) : 0,
      maxEngineTempC: Math.round(this.maxTemp),
      fuelStartPct: this.fuelStart,
      events: [...this.events],
      places: [...this.places],
    };
  }
}
