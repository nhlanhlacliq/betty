import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { GpsLean } from '../../../src/core/GpsLean';
import type { BikeState, DataSource } from '../../../src/core/types';

/**
 * The phone's GPS -> speed, position, course, altitude and the GPS lean estimate (as WebGeoSource on the web).
 *
 * Background running (stage 6, 2026-10-24): during a ride the GPS runs as a background location task
 * (startLocationUpdatesAsync), so Betty keeps going with the screen locked or another app in front: iOS shows the blue
 * location pill, Android a "Betty is riding with you" notification. That needs "Allow while using" plus the
 * background permission; without it, it falls back to the foreground-only watch (the old behaviour).
 * The task must be defined when the app loads (this module is imported from index.ts), not inside a component.
 */
export const RIDE_GPS_TASK = 'betty-ride-gps';
let deliver: ((locs: Location.LocationObject[]) => void) | null = null;

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(RIDE_GPS_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  deliver?.(data.locations);
});

export class ExpoGeoSource implements DataSource {
  private sub?: Location.LocationSubscription;
  private background = false;
  private lean = new GpsLean();
  constructor(private onError: (msg: string) => void = console.warn) {}

  async start(onUpdate: (p: Partial<BikeState>) => void) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { this.onError('GPS: permission refused'); return; }
    const fix = (pos: Location.LocationObject) => {
      const c = pos.coords;
      const speedKmh = Math.max(0, Math.round((c.speed ?? 0) * 3.6));
      const headingDeg = c.heading != null && Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null;
      onUpdate({
        speedKmh, lat: c.latitude, lon: c.longitude, headingDeg,
        altitudeM: c.altitude != null && Number.isFinite(c.altitude) ? Math.round(c.altitude) : null,
        leanDeg: this.lean.update(speedKmh, headingDeg, pos.timestamp),
      });
    };
    // Background first; the foreground watch if the phone says no.
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === 'granted') {
        deliver = (locs) => { for (const l of locs) fix(l); };
        await Location.startLocationUpdatesAsync(RIDE_GPS_TASK, {
          accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0,
          activityType: Location.ActivityType.OtherNavigation, pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: { notificationTitle: 'Betty is riding with you', notificationBody: 'Speed, route and alerts keep going with the screen off.', killServiceOnDestroy: true },
        });
        this.background = true;
        this.onError('GPS: running in the background too');
        return;
      }
      this.onError('GPS: background not allowed (Settings > Betty > Location > Always), so Betty pauses when the screen locks');
    } catch (e) { this.onError(`GPS: background updates failed (${(e as Error).message}); foreground only`); }
    this.sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      fix, (reason) => this.onError(`GPS: ${reason}`),
    );
  }

  stop() {
    this.sub?.remove(); this.sub = undefined;
    if (this.background) { deliver = null; this.background = false; void Location.stopLocationUpdatesAsync(RIDE_GPS_TASK).catch(() => {}); }
  }
}
