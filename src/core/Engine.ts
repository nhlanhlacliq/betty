/**
 * What the engine says, in words, and the little watchers on top of it (owner, 2026-10-27, with the Vgate iCar Pro BLE
 * reading his G 310 GS: coolant, revs, speed, throttle, load, intake air, pressure, trims, voltages, fault status).
 * Pure: thresholds are CONFIG.obd, nothing here is tied to one bike.
 */
import { CONFIG } from '../config/betty';
import type { BikeState } from './types';

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** Charging as the voltage says: only meaningful with the engine running and past its first minute. */
export function chargingState(s: BikeState): 'charging' | 'low' | 'resting' | null {
  const v = s.engine.batteryV, c = CONFIG.obd;
  if (v == null) return null;
  if (s.rpm <= 0) return 'resting';
  if ((s.engine.runS ?? Infinity) < c.chargeSettleS) return null;
  return v >= c.chargeOkV ? 'charging' : v < c.chargeLowV ? 'low' : null;
}

/** One line of everything the engine gives, for her answers, the briefing and the sign-off. Only what it gave. */
export function engineNote(s: BikeState, gear: number | null = null): string {
  if (!s.obd) return 'No engine data is connected: engine temperature, revs, fuel level and faults are unknown.';
  const e = s.engine, c = CONFIG.obd, bits: string[] = [];
  if (s.engineTempC) {
    const t = s.engineTempC;
    bits.push(`coolant ${Math.round(t)} C (${t >= CONFIG.thresholds.overtempC ? 'too hot' : t < c.coldC ? 'still warming up' : 'normal'})`);
  }
  if (s.rpm > 0) bits.push(`${Math.round(s.rpm / 50) * 50} rpm${gear ? `, in ${ordinal(gear)} gear` : ''}`);
  else if (s.speedKmh < 5) bits.push('engine not running');
  const ch = chargingState(s);
  if (e.batteryV != null) {
    bits.push(`battery ${e.batteryV.toFixed(1)} V (${ch === 'charging' ? 'charging normally'
      : ch === 'low' ? `NOT charging properly: it should be ${c.chargeOkV} V or more with the engine running`
      : ch === 'resting' ? (e.batteryV < c.batteryWeakV ? 'weak for a battery at rest' : 'at rest, fine')
      : 'settling'})`);
  }
  if (e.intakeC != null) bits.push(`intake air ${Math.round(e.intakeC)} C`);
  if (e.ltftPct != null && Math.abs(e.ltftPct) >= c.trimNoteAbsPct) bits.push(`long-term fuel trim ${e.ltftPct.toFixed(1)} percent (the engine is correcting its mixture more than usual)`);
  bits.push(s.dtcs.length ? `fault codes ${s.dtcs.join(', ')}` : 'no fault codes');
  if (e.milOn) bits.push('the engine warning light is ON');
  if (s.fuelKnown) bits.push(`fuel ${Math.round(s.fuelPct)} percent`);
  return `Engine data: ${bits.join(', ')}.`;
}

/**
 * Charging watch: the voltage under chargeLowV with the engine running at chargeMinRpm or more for chargeLowSec is
 * a charging problem (regulator, stator, a loose lead). Says so once, again only after it has recovered.
 */
export class ChargeWatch {
  private lowSince: number | null = null;
  private warned = false;
  update(s: BikeState, now: number): boolean {
    const c = CONFIG.obd, v = s.engine.batteryV;
    if (v == null || s.rpm < c.chargeMinRpm || (s.engine.runS ?? Infinity) < c.chargeSettleS) { this.lowSince = null; return false; }
    if (v >= c.chargeOkV) { this.lowSince = null; this.warned = false; return false; }
    if (v >= c.chargeLowV) { this.lowSince = null; return false; }
    this.lowSince ??= now;
    if (!this.warned && now - this.lowSince >= c.chargeLowSec * 1000) { this.warned = true; return true; }
    return false;
  }
  reset() { this.lowSince = null; this.warned = false; }
}

/**
 * The gear, learned from how fast the bike goes per 1000 rpm: each gear is one fixed ratio, so on a ride the readings
 * pile up at as many values as the bike has gears. No gearbox table needed (any bike). The gear is only named once all
 * CONFIG.obd.gears are learned, so "4th" really is 4th. Kept across rides (adapters: betty.gears.v1).
 */
export class GearLearner {
  /** Count per ratio bin (km/h per 1000 rpm, in steps of binWidth) */
  bins: Record<string, number> = {};
  constructor(saved?: Record<string, number>) { if (saved) this.bins = { ...saved }; }

  add(kmh: number, rpm: number, throttlePct: number) {
    const c = CONFIG.obd.gear;
    if (kmh < c.minKmh || rpm < c.minRpm || throttlePct < c.minThrottlePct) return;
    const k = String(Math.round((kmh / (rpm / 1000)) / c.binWidth));
    this.bins[k] = (this.bins[k] ?? 0) + 1;
  }

  /** The learned ratios, lowest gear first; fewer than the gear count while still learning. */
  ratios(): number[] {
    const c = CONFIG.obd.gear;
    const entries = Object.entries(this.bins).map(([k, n]) => ({ r: Number(k) * c.binWidth, n }));
    // a peak: more samples than its neighbours within the merge distance, and enough of them
    const peaks = entries.filter((a) => a.n >= c.minSamples && entries.every((b) => b === a || Math.abs(b.r - a.r) / a.r > c.mergePct || b.n < a.n || (b.n === a.n && b.r > a.r)));
    return peaks.sort((a, b) => b.n - a.n).slice(0, CONFIG.obd.gears).map((p) => p.r).sort((a, b) => a - b);
  }

  /** The gear for this speed and rpm, or null (still learning, clutch in, or between gears). */
  gear(kmh: number, rpm: number): number | null {
    const c = CONFIG.obd.gear;
    if (kmh < c.minKmh || rpm < c.minRpm) return null;
    const rs = this.ratios();
    if (rs.length < CONFIG.obd.gears) return null;
    const r = kmh / (rpm / 1000);
    let best = -1, err = Infinity;
    rs.forEach((g, i) => { const d = Math.abs(r - g) / g; if (d < err) { err = d; best = i; } });
    return err <= c.matchPct ? best + 1 : null;
  }
}
