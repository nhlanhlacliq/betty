import { BikeState } from '../models/BikeState';

/**
 * L4 — SafeWindowEvaluator
 *
 * Determines whether it is safe to deliver a non-critical audio message.
 * All four conditions must be true simultaneously (P2 & P3 triggers only).
 * P1 Critical and P4 Query bypass this check entirely.
 */
export class SafeWindowEvaluator {
  private readonly RPM_THRESHOLD = 5_000;
  private readonly LEAN_THRESHOLD = 20; // degrees
  private readonly BRAKING_FLAG = true;

  isSafe(state: BikeState, audioCurrentlyPlaying: boolean): boolean {
    if (audioCurrentlyPlaying) return false;
    if (state.rpm >= this.RPM_THRESHOLD) return false;
    if (state.leanAngle >= this.LEAN_THRESHOLD) return false;
    if (state.braking === this.BRAKING_FLAG) return false;
    return true;
  }

  /** Returns a human-readable reason why the window is not safe, for logging. */
  unsafeReason(state: BikeState, audioCurrentlyPlaying: boolean): string | null {
    if (audioCurrentlyPlaying) return 'Audio already playing';
    if (state.rpm >= this.RPM_THRESHOLD) return `High RPM: ${state.rpm}`;
    if (state.leanAngle >= this.LEAN_THRESHOLD) return `In corner: ${state.leanAngle}°`;
    if (state.braking) return 'Braking';
    return null;
  }
}
