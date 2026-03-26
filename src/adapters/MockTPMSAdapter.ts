import { TPMSAdapter } from './interfaces';
import { BikeState } from '../models/BikeState';

type UpdateCallback = (data: Partial<BikeState>) => void;

/**
 * Phase 1 — Simulates TPMS readings.
 * BMW G 310 GS recommended pressures: Front 36 PSI / Rear 42 PSI (solo).
 */
export class MockTPMSAdapter implements TPMSAdapter {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callbacks: Set<UpdateCallback> = new Set();

  async startScan(): Promise<void> {
    // Simulate slow pressure drop over a long ride (loses ~0.5 PSI / 10 min)
    let front = 36.0;
    let rear = 42.0;

    this.intervalId = setInterval(() => {
      // Tiny random drift
      front = Math.max(20, front - Math.random() * 0.01);
      rear = Math.max(20, rear - Math.random() * 0.01);

      const data: Partial<BikeState> = {
        frontTyrePSI: parseFloat(front.toFixed(1)),
        rearTyrePSI: parseFloat(rear.toFixed(1)),
      };
      this.callbacks.forEach((cb) => cb(data));
    }, 30_000); // every 30 s

    console.log('[MockTPMS] Scan started (simulated)');
  }

  stopScan(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[MockTPMS] Scan stopped');
  }

  subscribe(callback: UpdateCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
}
