import { GpsLean } from '../core/GpsLean';
import { BikeState, DataSource } from '../core/types';

/** navigator.geolocation -> speed, position, course, altitude, and a lean estimate derived from speed and course. */
export class WebGeoSource implements DataSource {
  private id?: number;
  private lean = new GpsLean();
  constructor(private onError: (msg: string) => void = console.warn) {}

  start(onUpdate: (p: Partial<BikeState>) => void) {
    if (!('geolocation' in navigator)) { this.onError('Geolocation unavailable'); return; }
    this.id = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const speedKmh = Math.max(0, Math.round((c.speed ?? 0) * 3.6));
        // The browser reports NaN or null for course when it has none (standing still).
        const headingDeg = c.heading != null && Number.isFinite(c.heading) ? c.heading : null;
        onUpdate({
          speedKmh,
          lat: c.latitude,
          lon: c.longitude,
          headingDeg,
          altitudeM: c.altitude != null && Number.isFinite(c.altitude) ? Math.round(c.altitude) : null,
          leanDeg: this.lean.update(speedKmh, headingDeg, pos.timestamp),
        });
      },
      (err) => this.onError(`GPS: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 },
    );
  }
  stop() { if (this.id !== undefined) navigator.geolocation.clearWatch(this.id); }
}
