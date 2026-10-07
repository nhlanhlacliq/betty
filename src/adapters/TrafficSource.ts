import { CONFIG } from '../config/betty';
import { haversineKm, LatLon } from '../core/geo';
import { BikeState, DataSource, TrafficIncident } from '../core/types';

export interface TrafficProvider {
  fetchIncidents(lat: number, lon: number, radiusKm: number): Promise<TrafficIncident[]>;
}

/**
 * Polls a TrafficProvider. With no provider (no API key) it stays idle: use the simulator to inject incidents.
 * No keyless live-traffic incident API exists, so a free key (TomTom) is the cheapest real option.
 */
export class TrafficSource implements DataSource {
  private timer?: ReturnType<typeof setInterval>;
  private push?: (p: Partial<BikeState>) => void;
  private lastAt = 0;
  private lastPos: LatLon | null = null;
  private busy = false;

  constructor(
    private provider: TrafficProvider | null,
    private getPos: () => LatLon,
    private onStatus: (msg: string) => void = () => {},
  ) {}

  start(onUpdate: (p: Partial<BikeState>) => void) {
    this.push = onUpdate;
    if (!this.provider) { this.onStatus('no API key (simulator only)'); return; }
    this.timer = setInterval(() => void this.tick(false), 15_000);
    void this.tick(true);
  }
  stop() { if (this.timer) clearInterval(this.timer); }
  refresh() { if (this.provider) void this.tick(true); }

  private async tick(force: boolean) {
    if (this.busy || !this.provider) return;
    const pos = this.getPos();
    const now = Date.now();
    const moved = this.lastPos ? haversineKm(this.lastPos, pos) : Infinity;
    const due = now - this.lastAt >= CONFIG.feeds.pollTrafficMs || moved >= 2;
    if (!force && !due) return;
    this.busy = true;
    try {
      const incidents = await this.provider.fetchIncidents(pos.lat, pos.lon, Math.max(CONFIG.thresholds.trafficRadiusKm, 1));
      this.push?.({ incidents });
      this.lastAt = now; this.lastPos = pos;
      this.onStatus(`ok, ${incidents.length} nearby (${new Date(now).toLocaleTimeString()})`);
    } catch (e) {
      this.onStatus(`error: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
