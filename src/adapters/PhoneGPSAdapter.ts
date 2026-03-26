import { GPSAdapter } from './interfaces';
import { BikeState } from '../models/BikeState';

// expo-location is dynamically imported to keep the file testable without Expo.
let LocationModule: typeof import('expo-location') | null = null;

async function getLocationModule() {
  if (!LocationModule) {
    LocationModule = await import('expo-location');
  }
  return LocationModule;
}

type UpdateCallback = (data: Partial<BikeState>) => void;

/**
 * Phase 1 — Uses the phone's GPS via expo-location.
 * Updates at ~1 Hz (1000 ms interval, 10 m distance filter).
 */
export class PhoneGPSAdapter implements GPSAdapter {
  private subscription: { remove: () => void } | null = null;
  private callbacks: Set<UpdateCallback> = new Set();

  async start(): Promise<void> {
    const Location = await getLocationModule();

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('[PhoneGPS] Location permission denied');
    }

    this.subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 10,
      },
      (location) => {
        const data: Partial<BikeState> = {
          gpsLat: location.coords.latitude,
          gpsLon: location.coords.longitude,
          gpsHeading: location.coords.heading ?? 0,
          gpsAltitude: location.coords.altitude ?? 0,
        };
        this.callbacks.forEach((cb) => cb(data));
      },
    );

    console.log('[PhoneGPS] Started');
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    console.log('[PhoneGPS] Stopped');
  }

  subscribe(callback: UpdateCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  async getCurrentPosition(): Promise<Partial<BikeState>> {
    const Location = await getLocationModule();
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      gpsLat: location.coords.latitude,
      gpsLon: location.coords.longitude,
      gpsHeading: location.coords.heading ?? 0,
      gpsAltitude: location.coords.altitude ?? 0,
    };
  }
}
