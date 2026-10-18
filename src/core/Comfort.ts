import { angleDiff } from './geo';

/**
 * The rider's comfort (owner's backlog, 2026-10-18): wind across the bike and the cold he actually feels at speed.
 * Pure, so it is tested.
 */

/** The part of the wind blowing across his line of travel (km/h). `windFromDeg` is where it blows FROM (meteorological). */
export function crosswind(windKmh: number, windFromDeg: number, headingDeg: number): number {
  return Math.round(Math.abs(windKmh * Math.sin((angleDiff(headingDeg, windFromDeg) * Math.PI) / 180)));
}

/**
 * How cold it feels on the bike: the wind-chill index (Environment Canada / JAG-TI, valid at or below 10 C) with the
 * wind he rides into: his own speed plus the head wind component. Above 10 C, or below 5 km/h, it is just the air.
 */
export function feelsLikeC(airC: number, speedKmh: number, windKmh = 0, windFromDeg: number | null = null, headingDeg: number | null = null): number {
  const head = windFromDeg != null && headingDeg != null ? windKmh * Math.cos((angleDiff(headingDeg, windFromDeg) * Math.PI) / 180) : 0;
  const v = Math.max(0, speedKmh + head);
  if (airC > 10 || v < 5) return Math.round(airC);
  const p = Math.pow(v, 0.16);
  return Math.round(13.12 + 0.6215 * airC - 11.37 * p + 0.3965 * airC * p);
}

/** Thresholds: a crosswind gust this strong is worth a heads-up; feeling this cold at speed is worth a word. */
export const CROSSWIND_KMH = 40;
export const COLD_FEELS_C = 5;

/**
 * Fatigue (owner's backlog): riding time since his last real break (15 minutes standing still). Two hours by day, one
 * at night (22:00 to 05:00), then again every hour he rides on without a break.
 */
export const BREAK_MS = 15 * 60_000;
export const fatigueDueMin = (hour: number) => (hour >= 22 || hour < 5 ? 60 : 120);
