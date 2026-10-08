import { BikeState, DataSource } from '../core/types';

type Askable = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** A spike this far above gravity-free rest counts as a jolt (pothole, speed bump, rough patch). About 0.8 g. */
const JOLT_MS2 = 8;
/** One bump rings for a moment; do not count it twice. */
const JOLT_GAP_MS = 400;
const PUSH_EVERY_MS = 1000;

/**
 * Phone motion sensors: the accelerometer counts hard jolts (road surface) and the compass gives a heading for
 * when the bike is standing still and GPS has no course. Lean is NOT taken from here any more: tilt read from a
 * handlebar-mounted phone was wrong often enough to be useless, so it now comes from GPS (see GpsLean).
 * Both readings are approximate and depend on the mount; treat them as colour, not measurement.
 */
export class WebMotionSource implements DataSource {
  private jolts = 0;
  private lastJoltAt = 0;
  private compass: number | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private onMotion?: (e: DeviceMotionEvent) => void;
  private onOrient?: (e: DeviceOrientationEvent) => void;

  /** iOS needs this called directly from a tap. Android/desktop resolve immediately. */
  static async requestPermission(): Promise<boolean> {
    const w = window as any;
    const kinds = [w.DeviceOrientationEvent, w.DeviceMotionEvent].filter(Boolean) as Askable[];
    if (!kinds.length) return false;
    // Both requests are made before the first await so they still count as part of the tap.
    const asks = kinds.map((k) => (typeof k.requestPermission === 'function' ? k.requestPermission().catch(() => 'denied' as const) : Promise.resolve('granted' as const)));
    return (await Promise.all(asks)).some((r) => r === 'granted');
  }

  start(onUpdate: (p: Partial<BikeState>) => void) {
    this.onMotion = (e) => {
      const a = e.acceleration; // gravity already removed
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const now = Date.now();
      if (Math.hypot(a.x, a.y, a.z) >= JOLT_MS2 && now - this.lastJoltAt >= JOLT_GAP_MS) { this.jolts++; this.lastJoltAt = now; }
    };
    this.onOrient = (e) => {
      const ios = (e as any).webkitCompassHeading;
      if (typeof ios === 'number' && Number.isFinite(ios)) this.compass = ios;
      else if (e.absolute && e.alpha != null) this.compass = (360 - e.alpha) % 360;
    };
    window.addEventListener('devicemotion', this.onMotion);
    window.addEventListener('deviceorientation', this.onOrient);
    // Sensors fire about 60 times a second; the rest of the app only needs a summary once a second.
    this.timer = setInterval(() => {
      onUpdate({ jolts: this.jolts, compassDeg: this.compass == null ? null : Math.round(this.compass) });
    }, PUSH_EVERY_MS);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.onMotion) window.removeEventListener('devicemotion', this.onMotion);
    if (this.onOrient) window.removeEventListener('deviceorientation', this.onOrient);
  }
}
