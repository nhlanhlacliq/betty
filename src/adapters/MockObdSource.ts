import { BikeState, DataSource } from '../core/types';

/** Simulated OBD2 feed. Swap for a real ELM327 adapter in Phase 4 (same DataSource interface). */
export class MockObdSource implements DataSource {
  private timer?: ReturnType<typeof setInterval>;
  private t = 0;
  private fuel = 60;
  private temp = 70;

  reset() { this.t = 0; this.fuel = 60; this.temp = 70; }

  start(onUpdate: (p: Partial<BikeState>) => void) {
    this.timer = setInterval(() => {
      this.t += 1;
      this.temp = Math.min(112, this.temp + 0.15);
      this.fuel = Math.max(0, this.fuel - 0.05);
      onUpdate({
        rpm: Math.round(3500 + 1800 * Math.sin(this.t / 8)),
        engineTempC: Math.round(this.temp * 10) / 10,
        throttlePct: Math.round(25 + 20 * Math.sin(this.t / 6)),
        fuelPct: Math.round(this.fuel * 10) / 10,
        dtcs: [],
      });
    }, 1000);
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
