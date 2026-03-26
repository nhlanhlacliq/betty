import { IMUAdapter } from './interfaces';
import { BikeState } from '../models/BikeState';

let SensorsModule: typeof import('expo-sensors') | null = null;

async function getSensorsModule() {
  if (!SensorsModule) {
    SensorsModule = await import('expo-sensors');
  }
  return SensorsModule;
}

type UpdateCallback = (data: Partial<BikeState>) => void;

const BRAKING_G_THRESHOLD = 0.3;
const UPDATE_INTERVAL_MS = 100;

/**
 * Phase 1 — Reads lean angle and braking from the phone's accelerometer.
 *
 * Lean angle derivation: the phone is mounted upright on the handlebars.
 * The Y-axis component of gravity rotates as the bike leans.
 * leanAngle = atan2(y, z) converted to degrees.
 *
 * Braking detection: forward deceleration is negative on the X axis;
 * magnitude > 0.3g triggers braking flag.
 */
export class PhoneIMUAdapter implements IMUAdapter {
  private subscription: { remove: () => void } | null = null;
  private callbacks: Set<UpdateCallback> = new Set();
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    getSensorsModule().then((Sensors) => {
      Sensors.Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS);

      this.subscription = Sensors.Accelerometer.addListener(({ x, y, z }) => {
        const leanAngle = Math.abs(
          (Math.atan2(y, z) * 180) / Math.PI,
        );
        const gForce = Math.sqrt(x * x + y * y + z * z) - 1; // subtract gravity
        const braking = -x > BRAKING_G_THRESHOLD; // deceleration on X axis

        const data: Partial<BikeState> = {
          leanAngle: Math.min(leanAngle, 60),
          gForce: parseFloat(Math.max(0, gForce).toFixed(2)),
          braking,
        };
        this.callbacks.forEach((cb) => cb(data));
      });
    });

    console.log('[PhoneIMU] Started');
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.started = false;
    console.log('[PhoneIMU] Stopped');
  }

  subscribe(callback: UpdateCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
}
