import { BikeState, DataSource } from './types';

export const initialState = (): BikeState => ({
  timestamp: Date.now(), rpm: 0, engineTempC: 0, throttlePct: 0, fuelPct: 100, dtcs: [],
  speedKmh: 0, lat: null, lon: null, headingDeg: null, leanDeg: 0,
  weather: null, incidents: [],
});

/**
 * Merges partial updates from any DataSource into one BikeState and notifies listeners.
 * Overrides (used by the simulator) are layered on top of real values; clearing one restores the real value.
 */
export class StateAggregator {
  private real = initialState();
  private overrides: Partial<BikeState> = {};
  private state = initialState();
  private listeners = new Set<(s: BikeState) => void>();
  private sources: DataSource[] = [];

  addSource(src: DataSource) { this.sources.push(src); }
  get current(): BikeState { return this.state; }

  subscribe(fn: (s: BikeState) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  push(partial: Partial<BikeState>) {
    this.real = { ...this.real, ...partial };
    this.emit();
  }

  setOverride<K extends keyof BikeState>(key: K, value: BikeState[K]) { this.overrides[key] = value; this.emit(); }
  clearOverride(key: keyof BikeState) { delete this.overrides[key]; this.emit(); }
  getOverride<K extends keyof BikeState>(key: K): BikeState[K] | undefined { return this.overrides[key]; }
  hasOverride(key: keyof BikeState) { return key in this.overrides; }

  private emit() {
    this.state = { ...this.real, ...this.overrides, timestamp: Date.now() };
    this.listeners.forEach((l) => l(this.state));
  }

  async start() {
    for (const s of this.sources) {
      try { await s.start((p) => this.push(p)); }
      catch (e) { console.warn('[Betty] data source failed:', e); } // graceful degradation
    }
  }
  stop() { this.sources.forEach((s) => s.stop()); }
}
