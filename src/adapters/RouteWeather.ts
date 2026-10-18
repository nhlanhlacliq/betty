import { Checkpoint, CheckpointWeather, weatherAlong } from '../core/RouteAhead';

/**
 * The weather at each checkpoint of the route at the hour he gets there (2026-10-18): one Open-Meteo request for all
 * of them (it takes several places at once, checked live), hourly temperature, rain chance and weather code, for the
 * next two days. No key; coordinates rounded to about 1 km. Null when it fails (the route works without it).
 */
export async function fetchRouteWeather(cps: Checkpoint[], now = Date.now(), fetcher: typeof fetch = (...a) => fetch(...a)): Promise<CheckpointWeather[] | null> {
  if (!cps.length) return [];
  const lat = cps.map((c) => c.lat.toFixed(2)).join(','), lon = cps.map((c) => c.lon.toFixed(2)).join(',');
  try {
    const res = await fetcher(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,weather_code&forecast_hours=48&timezone=auto`);
    if (!res.ok) return null;
    const j = await res.json();
    return weatherAlong(cps, Array.isArray(j) ? j : [j], now);
  } catch { return null; }
}
