import { OBD2Adapter } from './interfaces';
import { BikeState } from '../models/BikeState';

/**
 * Phase 1 — Simulates OBD2 telemetry for phone-based testing.
 * Produces realistic values that evolve over time to exercise triggers.
 */
export class MockOBD2Adapter implements OBD2Adapter {
  private connected = false;
  private tick = 0;

  async connect(): Promise<void> {
    this.connected = true;
    console.log('[MockOBD2] Connected (simulated)');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async poll(): Promise<Partial<BikeState>> {
    this.tick++;

    // Simulate a cruising ride with occasional variations
    const baseRpm = 3500 + Math.sin(this.tick * 0.1) * 800;
    const speed = 80 + Math.sin(this.tick * 0.05) * 20;
    const coolantTemp = 85 + Math.min(this.tick * 0.05, 20); // warms up over time

    return {
      rpm: Math.round(Math.max(0, baseRpm)),
      speed: Math.round(Math.max(0, speed)),
      coolantTemp: Math.round(coolantTemp),
      throttlePos: Math.round(20 + Math.sin(this.tick * 0.1) * 15),
      engineLoad: Math.round(35 + Math.sin(this.tick * 0.08) * 10),
      fuelStatus: this.tick > 200 ? 'Closed loop, fault' : 'Closed loop, no fault',
      batteryVoltage: parseFloat((13.8 + Math.sin(this.tick * 0.02) * 0.3).toFixed(1)),
      dtcCodes: [], // No faults by default
    };
  }
}
