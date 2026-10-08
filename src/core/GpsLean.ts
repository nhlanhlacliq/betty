import { angleDiff } from './geo';

const G = 9.81;
const MIN_SPEED_KMH = 15; // below this GPS course is too noisy to mean anything
const MAX_GAP_MS = 4000;
const MIN_GAP_MS = 300;
const MAX_LEAN = 60;

/**
 * Lean angle estimated from how fast the bike is turning at its speed: lean = atan(v * turnRate / g).
 * It needs only GPS speed and course, so it does not care how the phone is mounted or how much it vibrates,
 * which is what made the phone's tilt sensor useless for this. It is a balanced-turn estimate from roughly
 * one fix per second: fine for "how twisty has it been", too coarse for a precise peak angle.
 * Positive = leaning right.
 */
export class GpsLean {
  private last: { heading: number; at: number } | null = null;
  private smoothed = 0;

  update(speedKmh: number, headingDeg: number | null, at: number): number {
    if (headingDeg == null || speedKmh < MIN_SPEED_KMH) { this.last = null; this.smoothed = 0; return 0; }
    const prev = this.last;
    this.last = { heading: headingDeg, at };
    if (!prev) return Math.round(this.smoothed);
    const dt = at - prev.at;
    if (dt < MIN_GAP_MS) { this.last = prev; return Math.round(this.smoothed); } // too close together to difference
    if (dt > MAX_GAP_MS) { this.smoothed = 0; return 0; }
    const turnRate = (angleDiff(prev.heading, headingDeg) * Math.PI) / 180 / (dt / 1000); // rad/s
    const raw = (Math.atan(((speedKmh / 3.6) * turnRate) / G) * 180) / Math.PI;
    this.smoothed = this.smoothed * 0.5 + Math.max(-MAX_LEAN, Math.min(MAX_LEAN, raw)) * 0.5;
    return Math.round(this.smoothed);
  }
}
