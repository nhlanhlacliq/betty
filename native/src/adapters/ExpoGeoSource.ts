import * as Location from 'expo-location';
import { GpsLean } from '../../../src/core/GpsLean';
import type { BikeState, DataSource } from '../../../src/core/types';

/** The phone's GPS -> speed, position, course, altitude and the GPS lean estimate (as WebGeoSource on the web). */
export class ExpoGeoSource implements DataSource {
  private sub?: Location.LocationSubscription;
  private lean = new GpsLean();
  constructor(private onError: (msg: string) => void = console.warn) {}

  async start(onUpdate: (p: Partial<BikeState>) => void) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { this.onError('GPS: permission refused'); return; }
    // Foreground only for now. Riding with the screen off needs startLocationUpdatesAsync + a task (next step).
    this.sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (pos) => {
        const c = pos.coords;
        const speedKmh = Math.max(0, Math.round((c.speed ?? 0) * 3.6));
        const headingDeg = c.heading != null && Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null;
        onUpdate({
          speedKmh, lat: c.latitude, lon: c.longitude, headingDeg,
          altitudeM: c.altitude != null && Number.isFinite(c.altitude) ? Math.round(c.altitude) : null,
          leanDeg: this.lean.update(speedKmh, headingDeg, pos.timestamp),
        });
      },
      (reason) => this.onError(`GPS: ${reason}`),
    );
  }
  stop() { this.sub?.remove(); this.sub = undefined; }
}
