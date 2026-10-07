import { BikeState, DataSource } from '../core/types';

export class WebGeoSource implements DataSource {
  private id?: number;
  constructor(private onError: (msg: string) => void = console.warn) {}

  start(onUpdate: (p: Partial<BikeState>) => void) {
    if (!('geolocation' in navigator)) { this.onError('Geolocation unavailable'); return; }
    this.id = navigator.geolocation.watchPosition(
      (pos) => onUpdate({
        speedKmh: Math.max(0, Math.round((pos.coords.speed ?? 0) * 3.6)),
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        headingDeg: pos.coords.heading ?? null,
      }),
      (err) => this.onError(`GPS: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 },
    );
  }
  stop() { if (this.id !== undefined) navigator.geolocation.clearWatch(this.id); }
}
