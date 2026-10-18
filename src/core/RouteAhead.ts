import { haversineKm } from './geo';
import { PlannedRoute, RouteProgress, projectOnRoute } from './Route';
import type { TrackPoint } from './Track';

/**
 * Route: what is ahead (owner, 2026-10-18: "can definitely be done now"). Pure, so it is tested:
 * - checkpoints along the route (the named stops still ahead, plus a point every ~40 km between them), each with the
 *   km to it and the clock time he gets there, counting the stops he plans to stay at (breakfast, fuel);
 * - the weather at each checkpoint at THAT time (Open-Meteo hourly, fetched by the adapter);
 * - a past ride turned into stops to ride it again.
 */
export interface Checkpoint { name: string; lat: number; lon: number; km: number; /** minutes from now */ inMin: number; named: boolean }
export interface CheckpointWeather extends Checkpoint { at: number; tempC: number; rainPct: number; summary: string }

/** Minutes he plans to stay at each stop (index into route.stops); undefined = ride through. */
export const stayOf = (r: PlannedRoute, i: number) => Math.max(0, r.stops[i]?.stayMin ?? 0);

/** The checkpoints ahead of him (from the start when not riding yet), at most `max`. */
export function checkpoints(r: PlannedRoute, p: RouteProgress | null, everyKm = 40, max = 8): Checkpoint[] {
  const done = p?.doneKm ?? 0, from = p?.index ?? 0;
  const total = r.km || 1;
  const speed = r.minutes / total; // planned minutes per km (traffic included)
  // Named stops ahead, with where they fall along the route.
  const stops = r.stops.map((s, i) => ({ s, i, on: projectOnRoute(r, s, Math.max(0, from - 5)) }))
    .filter((x) => x.s.named && x.on && x.on.km > done + 0.3)
    .map((x) => ({ name: x.s.name, lat: x.s.lat, lon: x.s.lon, km: x.on!.km - done, i: x.i }));
  // Points every `everyKm` along the line, where no named stop is near.
  const pts: Array<{ name: string; lat: number; lon: number; km: number; i: number }> = [];
  let along = 0, nextAt = everyKm;
  for (let k = Math.max(1, from + 1); k < r.points.length; k++) {
    along += haversineKm({ lat: r.points[k - 1][0], lon: r.points[k - 1][1] }, { lat: r.points[k][0], lon: r.points[k][1] });
    if (along >= nextAt) {
      if (!stops.some((s) => Math.abs(s.km - along) < everyKm / 2)) pts.push({ name: `${Math.round(along)} km on`, lat: r.points[k][0], lon: r.points[k][1], km: along, i: -1 });
      nextAt += everyKm;
    }
  }
  const all = [...stops, ...pts].sort((a, b) => a.km - b.km);
  let staying = 0;
  const out: Checkpoint[] = [];
  for (const c of all) {
    out.push({ name: c.name, lat: c.lat, lon: c.lon, km: Math.round(c.km), inMin: Math.round(c.km * speed + staying), named: c.i >= 0 });
    if (c.i >= 0) staying += stayOf(r, c.i); // he arrives, then stays
  }
  // Keep the named stops first when there are too many, then fill with points, in order along the route.
  const keep = new Set([...out.filter((c) => c.named), ...out.filter((c) => !c.named)].slice(0, max));
  return out.filter((c) => keep.has(c));
}

const WMO: Array<[number, string]> = [[0, 'clear'], [3, 'partly cloudy'], [48, 'foggy'], [57, 'drizzle'], [67, 'rain'], [77, 'snow'], [82, 'showers'], [86, 'snow showers'], [99, 'thunderstorms']];
const wmo = (code: number) => WMO.find(([m]) => code <= m)?.[1] ?? 'unknown';

/**
 * Each checkpoint's weather at the hour he gets there, from Open-Meteo's hourly forecast for that point (one result per
 * checkpoint, same order). A checkpoint whose hour is not in the forecast is left out.
 */
export function weatherAlong(cps: Checkpoint[], forecasts: unknown[], now: number): CheckpointWeather[] {
  const out: CheckpointWeather[] = [];
  cps.forEach((c, k) => {
    const h = (forecasts[k] as any)?.hourly;
    if (!h?.time) return;
    const at = now + c.inMin * 60_000;
    // Hourly times are local ISO strings ("2026-10-18T15:00"): the hour he arrives in.
    const idx = (h.time as string[]).findIndex((t, i, a) => new Date(t).getTime() <= at && (i === a.length - 1 || new Date(a[i + 1]).getTime() > at));
    if (idx < 0) return;
    out.push({ ...c, at, tempC: Math.round(h.temperature_2m?.[idx] ?? NaN), rainPct: Math.round(h.precipitation_probability?.[idx] ?? 0), summary: wmo(h.weather_code?.[idx] ?? -1) });
  });
  return out;
}

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
/** "Villiers at about 11:40: rain likely (70%), 18 C." for the Up ahead sheet and her lines. */
export const weatherLine = (w: CheckpointWeather) =>
  `${w.rainPct >= 50 ? `rain likely (${w.rainPct}%)` : w.summary}${Number.isFinite(w.tempC) ? `, ${w.tempC}°` : ''}`;

/** Her words about the weather along the route (briefing, answers). */
export function describeRouteWeather(list: CheckpointWeather[]): string {
  if (!list.length) return '';
  return `Weather along the route, at the time he gets there: ${list.map((w) => `${w.name} at about ${hhmm(w.at)}, ${weatherLine(w).replace('°', ' C')}`).join('; ')}.`;
}

/** The first wet stretch ahead in the next two hours (for the alert), or null. */
export const rainAhead = (list: CheckpointWeather[], withinMin = 120, pct = 60) => list.find((w) => w.inMin <= withinMin && w.rainPct >= pct) ?? null;

/**
 * A past ride as stops to plan again (owner's backlog: "re-ride a past ride"): the start, up to `max - 2` points spread
 * along the road, and the end, as "lat,lon" stops for api/route (coordinate stops are routed as they are).
 */
export function rideAgainStops(track: TrackPoint[], max = 12): string[] {
  if (track.length < 2) return [];
  const n = Math.min(max, track.length);
  const pick = Array.from({ length: n }, (_, i) => track[Math.round((i * (track.length - 1)) / (n - 1))]);
  return pick.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`);
}
