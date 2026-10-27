/**
 * Bike health and how he rides, one summary per ride, kept with the ride (RideRecord.health / .riding) so trends can be
 * drawn over weeks (owner, 2026-10-27). Built up second by second from the ride's state while it runs: time-weighted
 * (each state counts for the time until the next, at most 5 s). Every threshold is CONFIG.health. Pure.
 */
import { CONFIG } from '../config/betty';
import { chargeVolts } from './Engine';
import type { BikeState } from './types';

/** One ride's bike health (only what the reader gave). */
export interface HealthSummary {
  /** Charging: the bike's voltage at health.chargeRpm and up, warm and settled */
  chargeV?: number;
  chargeMinV?: number;
  /** The engine computer's voltage with the ignition on, before the engine started */
  restV?: number;
  /** The lowest reader voltage while the starter turned (a weakening battery dips further) */
  crankV?: number;
  /** Minutes from a cold start to health.warmC */
  warmUpMin?: number;
  coolantMaxC?: number;
  /** Long-term fuel trim, warm (drifting from 0 = the engine correcting for something) */
  ltftPct?: number;
  /** How far short-term trim swings, warm (average of its size) */
  stftSwingPct?: number;
  /** Warm idle: revs and how steady (standard deviation) */
  idleRpm?: number;
  idleSdRpm?: number;
  /** Ignition advance at a steady warm cruise (pulled back = poor fuel or knock) */
  cruiseTimingDeg?: number;
  /** The bike's wheel speed over GPS speed (a worn tyre turns faster per km: this creeps up) */
  wheelVsGps?: number;
  codes?: string[];
}

/** One ride's riding (GPS always; throttle and revs with a reader). */
export interface RidingSummary {
  movingMin: number;
  avgKmh: number;
  maxKmh: number;
  /** Minutes above 100 and 120 km/h */
  over100Min: number;
  over120Min: number;
  throttleAvgPct?: number;
  /** Share of the moving time above health.wideThrottlePct */
  wideSharePct?: number;
  /** Times he opened it past health.fullThrottlePct */
  fullThrottle?: number;
  /** Throttle movement, percent per second while moving (smooth riders: lower) */
  throttleChurn?: number;
  peakRpm?: number;
  /** Share of the running time in each rev band (health.rpmBands upper edges) */
  rpmBandsPct?: number[];
  /** Seconds above health.coldRevs while the coolant was under obd.coldC (hard on a cold engine) */
  coldRevsS?: number;
  coldPeakRpm?: number;
}

const mean = (sum: number, w: number) => (w > 0 ? sum / w : undefined);
const r1 = (v: number | undefined) => (v == null ? undefined : Math.round(v * 10) / 10);
const r3 = (v: number | undefined) => (v == null ? undefined : Math.round(v * 1000) / 1000);

export class HealthWatch {
  private last: number | null = null;
  private lastThr: number | null = null;
  private wasRunning = false;
  private everRan = false;
  private recentV: Array<[number, number]> = [];
  private coldAt: number | null = null;
  private a = {
    chargeSum: 0, chargeW: 0, chargeMin: Infinity, restV: undefined as number | undefined, crankV: Infinity,
    warmUpMin: undefined as number | undefined, coolMax: 0, ltftSum: 0, ltftW: 0, stftSum: 0, stftW: 0,
    idleSum: 0, idleSq: 0, idleW: 0, timingSum: 0, timingW: 0, wheelSum: 0, wheelW: 0, codes: new Set<string>(),
    movingS: 0, speedSum: 0, maxKmh: 0, over100: 0, over120: 0, thrSum: 0, thrW: 0, wideS: 0, full: 0, churn: 0,
    peakRpm: 0, runS: 0, bands: [] as number[], coldRevsS: 0, coldPeak: 0, obd: false,
  };

  add(s: BikeState, now: number) {
    const h = CONFIG.health, a = this.a;
    const dt = this.last == null ? 0 : Math.min(5, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const moving = s.speedKmh > 3;
    if (moving) {
      a.movingS += dt; a.speedSum += s.speedKmh * dt; a.maxKmh = Math.max(a.maxKmh, s.speedKmh);
      if (s.speedKmh > 100) a.over100 += dt;
      if (s.speedKmh > 120) a.over120 += dt;
    }
    if (!s.obd) return;
    a.obd = true;
    const e = s.engine, running = s.rpm > h.runningRpm, warm = s.engineTempC >= h.warmC;
    // the battery: the starter's dip (reader voltage in the seconds before it first runs) and the voltage at rest
    if (e.batteryV != null) { this.recentV.push([now, e.batteryV]); this.recentV = this.recentV.filter(([t]) => now - t <= h.crankWindowMs); }
    if (!running && !this.everRan && e.ecuV != null && a.restV === undefined) a.restV = e.ecuV;
    if (running && !this.wasRunning) {
      const dip = Math.min(...this.recentV.map(([, v]) => v));
      if (Number.isFinite(dip)) a.crankV = Math.min(a.crankV, dip);
      this.everRan = true;
    }
    this.wasRunning = running;
    if (!running) return;
    a.runS += dt;
    // warming up: from the first cold reading to warmC
    if (s.engineTempC > 0 && s.engineTempC < CONFIG.obd.coldC && this.coldAt === null && a.warmUpMin === undefined) this.coldAt = now;
    if (this.coldAt !== null && warm) { a.warmUpMin = Math.round((now - this.coldAt) / 6000) / 10; this.coldAt = null; }
    a.coolMax = Math.max(a.coolMax, s.engineTempC);
    const v = chargeVolts(s);
    if (v != null && s.rpm >= h.chargeRpm && (e.runS ?? Infinity) >= CONFIG.obd.chargeSettleS) { a.chargeSum += v * dt; a.chargeW += dt; a.chargeMin = Math.min(a.chargeMin, v); }
    if (warm && e.ltftPct != null) { a.ltftSum += e.ltftPct * dt; a.ltftW += dt; }
    if (warm && e.stftPct != null) { a.stftSum += Math.abs(e.stftPct) * dt; a.stftW += dt; }
    if (warm && s.speedKmh < 2 && s.throttlePct <= h.idleThrottlePct && s.rpm < h.idleBelowRpm) { a.idleSum += s.rpm * dt; a.idleSq += s.rpm * s.rpm * dt; a.idleW += dt; }
    if (warm && e.timingDeg != null && s.rpm >= h.cruise.rpmFrom && s.rpm <= h.cruise.rpmTo && s.throttlePct >= h.cruise.throttleFrom && s.throttlePct <= h.cruise.throttleTo) { a.timingSum += e.timingDeg * dt; a.timingW += dt; }
    const wheel = e.bikeSpeedKmh;
    if (wheel != null && wheel > h.wheelFromKmh && s.speedKmh > h.wheelFromKmh) { a.wheelSum += (wheel / s.speedKmh) * dt; a.wheelW += dt; }
    for (const c of s.dtcs) a.codes.add(c);
    // riding with the engine
    a.peakRpm = Math.max(a.peakRpm, s.rpm);
    const band = h.rpmBands.findIndex((top) => s.rpm < top);
    const i = band < 0 ? h.rpmBands.length : band;
    a.bands[i] = (a.bands[i] ?? 0) + dt;
    if (s.engineTempC > 0 && s.engineTempC < CONFIG.obd.coldC) {
      a.coldPeak = Math.max(a.coldPeak, s.rpm);
      if (s.rpm > h.coldRevs) a.coldRevsS += dt;
    }
    if (moving) {
      a.thrSum += s.throttlePct * dt; a.thrW += dt;
      if (s.throttlePct > h.wideThrottlePct) a.wideS += dt;
      if (this.lastThr != null) {
        if (s.throttlePct > h.fullThrottlePct && this.lastThr <= h.fullThrottlePct) a.full++;
        if (dt > 0) a.churn += Math.abs(s.throttlePct - this.lastThr);
      }
      this.lastThr = s.throttlePct;
    } else this.lastThr = null;
  }

  health(): HealthSummary | null {
    const a = this.a;
    if (!a.obd) return null;
    const idle = mean(a.idleSum, a.idleW), sq = mean(a.idleSq, a.idleW);
    const out: HealthSummary = {
      chargeV: r1(mean(a.chargeSum, a.chargeW)), chargeMinV: Number.isFinite(a.chargeMin) ? r1(a.chargeMin) : undefined,
      restV: r1(a.restV), crankV: Number.isFinite(a.crankV) ? r1(a.crankV) : undefined, warmUpMin: a.warmUpMin,
      coolantMaxC: a.coolMax || undefined, ltftPct: r1(mean(a.ltftSum, a.ltftW)), stftSwingPct: r1(mean(a.stftSum, a.stftW)),
      idleRpm: idle != null ? Math.round(idle) : undefined, idleSdRpm: idle != null && sq != null ? Math.round(Math.sqrt(Math.max(0, sq - idle * idle))) : undefined,
      cruiseTimingDeg: r1(mean(a.timingSum, a.timingW)), wheelVsGps: r3(mean(a.wheelSum, a.wheelW)),
      codes: a.codes.size ? [...a.codes] : undefined,
    };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as HealthSummary;
  }

  riding(): RidingSummary | null {
    const a = this.a;
    if (a.movingS < 60) return null;
    const min = (s: number) => Math.round(s / 6) / 10;
    const out: RidingSummary = {
      movingMin: min(a.movingS), avgKmh: Math.round(a.speedSum / a.movingS), maxKmh: Math.round(a.maxKmh),
      over100Min: min(a.over100), over120Min: min(a.over120),
    };
    if (a.obd && a.thrW > 0) {
      out.throttleAvgPct = Math.round(a.thrSum / a.thrW);
      out.wideSharePct = Math.round((a.wideS / a.thrW) * 100);
      out.fullThrottle = a.full;
      out.throttleChurn = r1(a.churn / a.thrW);
      out.peakRpm = a.peakRpm;
      out.rpmBandsPct = Array.from({ length: CONFIG.health.rpmBands.length + 1 }, (_, i) => Math.round(((a.bands[i] ?? 0) / Math.max(1, a.runS)) * 100));
      out.coldRevsS = Math.round(a.coldRevsS);
      if (a.coldPeak) out.coldPeakRpm = a.coldPeak;
    }
    return out;
  }
}

/** A value over time: the newest ride against his usual (the median of the rides before it). */
export interface Metric { id: string; label: string; unit: string; of: 'health' | 'riding'; get: (h: HealthSummary & RidingSummary) => number | undefined; /** a rise is the bad way (true), a drop (false), neither (null) */ worseUp: boolean | null }
export const METRICS: Metric[] = [
  { id: 'chargeV', label: 'Charging voltage', unit: 'V', of: 'health', get: (x) => x.chargeV, worseUp: false },
  { id: 'restV', label: 'Battery at rest', unit: 'V', of: 'health', get: (x) => x.restV, worseUp: false },
  { id: 'crankV', label: 'Lowest while starting', unit: 'V', of: 'health', get: (x) => x.crankV, worseUp: false },
  { id: 'warmUpMin', label: 'Warm-up to 80 C', unit: 'min', of: 'health', get: (x) => x.warmUpMin, worseUp: true },
  { id: 'coolantMaxC', label: 'Hottest coolant', unit: 'C', of: 'health', get: (x) => x.coolantMaxC, worseUp: true },
  { id: 'ltftPct', label: 'Long-term fuel trim', unit: '%', of: 'health', get: (x) => x.ltftPct, worseUp: null },
  { id: 'stftSwingPct', label: 'Short-term trim swing', unit: '%', of: 'health', get: (x) => x.stftSwingPct, worseUp: true },
  { id: 'idleRpm', label: 'Warm idle', unit: 'rpm', of: 'health', get: (x) => x.idleRpm, worseUp: null },
  { id: 'idleSdRpm', label: 'Idle steadiness (spread)', unit: 'rpm', of: 'health', get: (x) => x.idleSdRpm, worseUp: true },
  { id: 'cruiseTimingDeg', label: 'Timing at a cruise', unit: 'deg', of: 'health', get: (x) => x.cruiseTimingDeg, worseUp: false },
  { id: 'wheelVsGps', label: 'Wheel speed vs GPS', unit: '', of: 'health', get: (x) => x.wheelVsGps, worseUp: true },
  { id: 'avgKmh', label: 'Average moving speed', unit: 'km/h', of: 'riding', get: (x) => x.avgKmh, worseUp: null },
  { id: 'maxKmh', label: 'Top speed', unit: 'km/h', of: 'riding', get: (x) => x.maxKmh, worseUp: null },
  { id: 'over120Min', label: 'Minutes over 120 km/h', unit: 'min', of: 'riding', get: (x) => x.over120Min, worseUp: null },
  { id: 'throttleAvgPct', label: 'Average throttle', unit: '%', of: 'riding', get: (x) => x.throttleAvgPct, worseUp: null },
  { id: 'wideSharePct', label: 'Time at wide throttle', unit: '%', of: 'riding', get: (x) => x.wideSharePct, worseUp: null },
  { id: 'fullThrottle', label: 'Full-throttle pulls', unit: '', of: 'riding', get: (x) => x.fullThrottle, worseUp: null },
  { id: 'throttleChurn', label: 'Throttle movement (smoothness)', unit: '%/s', of: 'riding', get: (x) => x.throttleChurn, worseUp: null },
  { id: 'peakRpm', label: 'Peak revs', unit: 'rpm', of: 'riding', get: (x) => x.peakRpm, worseUp: null },
  { id: 'coldRevsS', label: 'High revs on a cold engine', unit: 's', of: 'riding', get: (x) => x.coldRevsS, worseUp: true },
];

export interface WithSummaries { startedAt: number; health?: HealthSummary; riding?: RidingSummary }
export interface Trend { metric: Metric; latest: number; usual: number | null; rides: number; drift: 'worse' | 'better' | 'changed' | null; series: number[] }

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Each metric's newest value against the median of up to health.baselineRides rides before it; drift past health.drift. */
export function trends(rides: WithSummaries[]): Trend[] {
  const h = CONFIG.health;
  const sorted = [...rides].sort((a, b) => a.startedAt - b.startedAt);
  const out: Trend[] = [];
  for (const m of METRICS) {
    const series = sorted.map((r) => m.get({ ...(r.health ?? {}), ...(r.riding ?? {}) } as HealthSummary & RidingSummary)).filter((v): v is number => v != null);
    if (!series.length) continue;
    const latest = series[series.length - 1];
    const before = series.slice(-1 - h.baselineRides, -1);
    const usual = before.length >= h.minRides ? Math.round(median(before) * 1000) / 1000 : null;
    const limit = h.drift[m.id];
    let drift: Trend['drift'] = null;
    if (usual != null && limit != null && Math.abs(latest - usual) >= limit) drift = m.worseUp == null ? 'changed' : (latest > usual) === m.worseUp ? 'worse' : 'better';
    out.push({ metric: m, latest, usual, rides: series.length, drift, series: series.slice(-h.seriesRides) });
  }
  return out;
}

const fmt = (v: number, unit: string) => `${Math.round(v * 100) / 100}${unit ? ` ${unit}` : ''}`;
/** For her briefing: bike-health values that have drifted the bad way (empty when nothing has). */
export function healthNote(rides: WithSummaries[]): string {
  const bad = trends(rides).filter((t) => t.metric.of === 'health' && t.drift === 'worse');
  return bad.length ? `Bike health worth a word: ${bad.map((t) => `${t.metric.label.toLowerCase()} was ${fmt(t.latest, t.metric.unit)} last ride against his usual ${fmt(t.usual!, t.metric.unit)}`).join('; ')}.` : '';
}
/** For her sign-off: how this ride compared with how he usually rides (the biggest differences), never advice. */
export function ridingNote(now: RidingSummary | null, rides: WithSummaries[]): string {
  if (!now) return '';
  const t = trends([...rides, { startedAt: Infinity, riding: now }]).filter((x) => x.metric.of === 'riding' && x.usual != null && x.drift);
  return t.length ? `Compared with how he usually rides: ${t.slice(0, 3).map((x) => `${x.metric.label.toLowerCase()} ${fmt(x.latest, x.metric.unit)} (usually ${fmt(x.usual!, x.metric.unit)})`).join('; ')}. Say it as an observation or a tease, never as advice.` : '';
}
