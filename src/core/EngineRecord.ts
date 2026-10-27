/**
 * The ride's engine recording (owner, 2026-10-27: "build the ride recording, make it read every second, on
 * everything", to test a fuel model against fill-ups). One row every CONFIG.obd.record.everyMs from the ride's merged
 * state: GPS (position, speed, height) next to everything the reader gives. Columns are data: add one here and it is
 * in every new recording. Pure; the app writes the file.
 */
import type { BikeState } from './types';

type Get = (s: BikeState, gear: number | null) => number | string | boolean | null | undefined;
export const RECORD_COLUMNS: Array<{ head: string; get: Get }> = [
  { head: 'lat', get: (s) => s.lat?.toFixed(5) },
  { head: 'lon', get: (s) => s.lon?.toFixed(5) },
  { head: 'altitude_m', get: (s) => (s.altitudeM != null ? Math.round(s.altitudeM) : null) },
  { head: 'gps_kmh', get: (s) => Math.round(s.speedKmh * 10) / 10 },
  { head: 'bike_kmh', get: (s) => s.engine.bikeSpeedKmh },
  { head: 'rpm', get: (s) => s.rpm },
  { head: 'gear', get: (_s, g) => g },
  { head: 'throttle_pct', get: (s) => s.throttlePct },
  { head: 'load_pct', get: (s) => s.engine.loadPct },
  { head: 'abs_load_pct', get: (s) => s.engine.absLoadPct },
  { head: 'lambda', get: (s) => s.engine.lambda },
  { head: 'stft_pct', get: (s) => s.engine.stftPct },
  { head: 'ltft_pct', get: (s) => s.engine.ltftPct },
  { head: 'o2_v', get: (s) => s.engine.o2V },
  { head: 'timing_deg', get: (s) => s.engine.timingDeg },
  { head: 'coolant_c', get: (s) => s.engineTempC },
  { head: 'intake_c', get: (s) => s.engine.intakeC },
  { head: 'baro_kpa', get: (s) => s.engine.baroKpa },
  { head: 'ecu_v', get: (s) => s.engine.ecuV },
  { head: 'reader_v', get: (s) => s.engine.batteryV },
  { head: 'run_s', get: (s) => s.engine.runS },
  { head: 'km_since_clear', get: (s) => s.engine.kmSinceClear },
  { head: 'mil', get: (s) => (s.engine.milOn == null ? null : s.engine.milOn ? 1 : 0) },
  { head: 'codes', get: (s) => s.dtcs.join(' ') },
];

export const recordHeader = () => ['time', ...RECORD_COLUMNS.map((c) => c.head)].join(',');
/** One CSV row (no commas inside values: codes are space-separated). */
export function recordRow(s: BikeState, at: number, gear: number | null = null): string {
  return [new Date(at).toISOString(), ...RECORD_COLUMNS.map((c) => { const v = c.get(s, gear); return v == null ? '' : String(v); })].join(',');
}
