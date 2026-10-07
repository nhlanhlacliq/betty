import { BikeState, DataSource } from '../core/types';

type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Approximate lean angle from the phone's fused orientation.
 * Assumes the phone is mounted upright (portrait), screen facing the rider. Zero it on level ground.
 * Treat as approximate: fusion lags in sustained corners, and mounting vibration adds noise.
 */
export class WebMotionSource implements DataSource {
  private offset = 0;
  private raw = 0;
  private smoothed = 0;
  private needsZero = true;
  private handler?: (e: DeviceOrientationEvent) => void;

  /** iOS needs this called directly from a tap. Android/desktop resolve immediately. */
  static async requestPermission(): Promise<boolean> {
    const D = (window as any).DeviceOrientationEvent as DOE | undefined;
    if (!D) return false;
    if (typeof D.requestPermission === 'function') {
      try { return (await D.requestPermission()) === 'granted'; } catch { return false; }
    }
    return true;
  }

  zero() { this.offset = this.raw; this.smoothed = 0; }

  start(onUpdate: (p: Partial<BikeState>) => void) {
    this.handler = (e) => {
      if (e.beta == null || e.gamma == null) return;
      const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
      // gravity in device frame: gx = -cos(b) sin(g), gy = sin(b); roll about the bike's long axis
      this.raw = (Math.atan2(-Math.cos(b) * Math.sin(g), Math.sin(b)) * 180) / Math.PI;
      if (this.needsZero) { this.offset = this.raw; this.needsZero = false; }
      const lean = this.raw - this.offset;
      this.smoothed = this.smoothed * 0.8 + lean * 0.2;
      onUpdate({ leanDeg: Math.round(this.smoothed * 10) / 10 });
    };
    window.addEventListener('deviceorientation', this.handler);
  }
  stop() { if (this.handler) window.removeEventListener('deviceorientation', this.handler); }
}
