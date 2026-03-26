import { BikeState } from '../models/BikeState';
import {
  TriggerEvent,
  TriggerPriority,
  TriggerType,
  createTriggerEvent,
} from '../models/TriggerEvent';
import triggersConfig from '../config/triggers.json';

type TriggerCallback = (event: TriggerEvent) => void;

/**
 * L4 — TriggerEngine
 *
 * Evaluates every incoming BikeState update against all trigger rules.
 * Enforces once-per-session deduplication for P2 and P3 triggers.
 * Fires P1 unconditionally (safety critical, no deduplication).
 */
export class TriggerEngine {
  private firedThisSession = new Set<TriggerType>();
  private callbacks: Set<TriggerCallback> = new Set();
  private lastAmbientAt = 0;
  private readonly AMBIENT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

  onTrigger(callback: TriggerCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  resetSession(): void {
    this.firedThisSession.clear();
    this.lastAmbientAt = 0;
    console.log('[TriggerEngine] Session reset');
  }

  evaluate(state: BikeState): void {
    this.evaluateCritical(state);
    this.evaluateAdvisory(state);
    this.evaluateAmbient(state);
  }

  // ─── P1 Critical ──────────────────────────────────────────────────────────

  private evaluateCritical(state: BikeState): void {
    const cfg = triggersConfig.critical;

    if (state.coolantTemp > cfg.coolantTempThreshold) {
      this.fire(
        TriggerPriority.P1_CRITICAL,
        TriggerType.OVERTEMP,
        { coolantTemp: state.coolantTemp },
        state,
        false, // P1: never deduplicate
      );
    }

    if (state.rearTyrePSI < cfg.rearTyreCriticalPSI) {
      this.fire(
        TriggerPriority.P1_CRITICAL,
        TriggerType.TYRE_PRESSURE_CRITICAL,
        { tyre: 'rear', psi: state.rearTyrePSI },
        state,
        false,
      );
    }

    if (state.frontTyrePSI < cfg.frontTyreCriticalPSI) {
      this.fire(
        TriggerPriority.P1_CRITICAL,
        TriggerType.TYRE_PRESSURE_CRITICAL,
        { tyre: 'front', psi: state.frontTyrePSI },
        state,
        false,
      );
    }

    if (state.dtcCodes.length > 0) {
      this.fire(
        TriggerPriority.P1_CRITICAL,
        TriggerType.DTC_FAULT,
        { codes: state.dtcCodes },
        state,
        false,
      );
    }
  }

  // ─── P2 Advisory ──────────────────────────────────────────────────────────

  private evaluateAdvisory(state: BikeState): void {
    const cfg = triggersConfig.advisory;

    this.checkOnce(
      state,
      TriggerPriority.P2_ADVISORY,
      TriggerType.LOW_FUEL,
      cfg.lowFuelPercent,
      () => this.parseFuelPercent(state.fuelStatus) < cfg.lowFuelPercent,
      { fuelStatus: state.fuelStatus },
    );

    this.checkOnce(
      state,
      TriggerPriority.P2_ADVISORY,
      TriggerType.TYRE_PRESSURE_LOW,
      cfg.rearTyreLowPSI,
      () =>
        state.rearTyrePSI < cfg.rearTyreLowPSI ||
        state.frontTyrePSI < cfg.frontTyreLowPSI,
      {
        frontPSI: state.frontTyrePSI,
        rearPSI: state.rearTyrePSI,
      },
    );

    this.checkOnce(
      state,
      TriggerPriority.P2_ADVISORY,
      TriggerType.TRAFFIC_INCIDENT,
      0,
      () =>
        state.trafficIncidents.some(
          (inc) => inc.distanceKm <= cfg.trafficRadiusKm,
        ),
      { incidents: state.trafficIncidents.slice(0, 3) },
    );

    this.checkOnce(
      state,
      TriggerPriority.P2_ADVISORY,
      TriggerType.WEATHER_RAIN,
      0,
      () => ['Rain', 'Drizzle', 'Thunderstorm'].includes(state.weatherCondition),
      { condition: state.weatherCondition },
    );

    this.checkOnce(
      state,
      TriggerPriority.P2_ADVISORY,
      TriggerType.BATTERY_LOW,
      0,
      () => state.batteryVoltage < cfg.batteryLowVolts,
      { voltage: state.batteryVoltage },
    );
  }

  // ─── P3 Ambient ───────────────────────────────────────────────────────────

  private evaluateAmbient(state: BikeState): void {
    const now = Date.now();
    if (now - this.lastAmbientAt < this.AMBIENT_COOLDOWN_MS) return;

    // Engine reached operating temp — welcome message
    this.checkOnce(
      state,
      TriggerPriority.P3_AMBIENT,
      TriggerType.ENGINE_WARM,
      0,
      () => state.coolantTemp >= 80 && state.speed > 0,
      { coolantTemp: state.coolantTemp },
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private checkOnce(
    state: BikeState,
    priority: TriggerPriority,
    type: TriggerType,
    _threshold: number,
    condition: () => boolean,
    context: Record<string, unknown>,
  ): void {
    if (this.firedThisSession.has(type)) return;
    if (!condition()) return;
    this.fire(priority, type, context, state, true);
  }

  private fire(
    priority: TriggerPriority,
    type: TriggerType,
    context: Record<string, unknown>,
    state: BikeState,
    deduplicate: boolean,
  ): void {
    if (deduplicate) {
      this.firedThisSession.add(type);
    }

    if (priority === TriggerPriority.P3_AMBIENT) {
      this.lastAmbientAt = Date.now();
    }

    const event = createTriggerEvent(priority, type, context, state);
    this.callbacks.forEach((cb) => cb(event));
  }

  private parseFuelPercent(fuelStatus: string): number {
    // OBD2 fuel status is a string, not a percentage.
    // Phase 4 will map actual OBD2 PID 0x2F (Fuel Tank Level Input).
    // For Phase 1 mock, the mock always returns > 15% unless overridden.
    const match = fuelStatus.match(/(\d+)%/);
    return match ? parseInt(match[1], 10) : 100;
  }
}
