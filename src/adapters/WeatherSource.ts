import { CONFIG } from '../config/betty';
import { haversineKm, LatLon } from '../core/geo';
import { BikeState, DataSource, WeatherState } from '../core/types';

const WMO: Array<[number, string]> = [
  [0, 'clear'], [3, 'partly cloudy'], [48, 'foggy'], [57, 'drizzle'], [67, 'rain'],
  [77, 'snow'], [82, 'showers'], [86, 'snow showers'], [99, 'thunderstorms'],
];
export const wmoSummary = (code: number) => WMO.find(([max]) => code <= max)?.[1] ?? 'unknown';

/**
 * First of Open-Meteo's daily times (local ISO strings without a zone, e.g. "2026-10-08T18:10") that is still ahead.
 * They are in the location's own time zone, which is the phone's time zone when you are riding there.
 */
export function nextTime(times: unknown, now: number): number | null {
  if (!Array.isArray(times)) return null;
  for (const t of times) {
    const ms = typeof t === 'string' ? new Date(t).getTime() : NaN;
    if (Number.isFinite(ms) && ms > now) return ms;
  }
  return null;
}

/** Open-Meteo: free, no API key, CORS-enabled (free tier is for non-commercial use). */
export class WeatherSource implements DataSource {
  private timer?: ReturnType<typeof setInterval>;
  private push?: (p: Partial<BikeState>) => void;
  private lastAt = 0;
  private lastPos: LatLon | null = null;
  private busy = false;

  constructor(private getPos: () => LatLon, private onStatus: (msg: string) => void = () => {}) {}

  start(onUpdate: (p: Partial<BikeState>) => void) {
    this.push = onUpdate;
    this.timer = setInterval(() => void this.tick(false), 15_000);
    void this.tick(true);
  }
  stop() { if (this.timer) clearInterval(this.timer); }
  refresh() { void this.tick(true); }

  private async tick(force: boolean) {
    if (this.busy) return;
    const pos = this.getPos();
    const now = Date.now();
    const moved = this.lastPos ? haversineKm(this.lastPos, pos) : Infinity;
    const due = now - this.lastAt >= CONFIG.feeds.pollWeatherMs || moved >= CONFIG.feeds.refetchDistanceKm;
    if (!force && !due) return;
    this.busy = true;
    try {
      const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lon.toFixed(3)}`
        + '&current=temperature_2m,precipitation,wind_speed_10m,weather_code'
        + '&hourly=precipitation_probability&forecast_hours=3&daily=sunrise,sunset&forecast_days=2'
        + '&wind_speed_unit=kmh&timezone=auto';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const c = j.current ?? {};
      const probs: number[] = (j.hourly?.precipitation_probability ?? []).slice(0, 2).filter((n: unknown) => typeof n === 'number');
      const weather: WeatherState = {
        tempC: Math.round(c.temperature_2m ?? 0),
        windKmh: Math.round(c.wind_speed_10m ?? 0),
        rainNowMm: c.precipitation ?? 0,
        rainChanceNextHourPct: probs.length ? Math.max(...probs) : 0,
        summary: wmoSummary(c.weather_code ?? 0),
        fetchedAt: now,
        sunriseAt: nextTime(j.daily?.sunrise, now),
        sunsetAt: nextTime(j.daily?.sunset, now),
      };
      this.push?.({ weather });
      this.lastAt = now; this.lastPos = pos;
      this.onStatus(`ok ${new Date(now).toLocaleTimeString()}`);
    } catch (e) {
      this.onStatus(`error: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
