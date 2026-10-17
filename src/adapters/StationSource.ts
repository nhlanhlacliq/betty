import type { Station } from '../core/Fuel';
import { haversineKm } from '../core/geo';

/** Look again after moving this far (km). */
const REFETCH_KM = 10;

/**
 * Petrol stations near him (api/stations.ts), asked for only when fuel gets low or he asks about fuel, and again
 * after 10 km. A failed look keeps the last list (no signal is not "no stations").
 */
export class StationSource {
  private at: { lat: number; lon: number } | null = null;
  private busy: Promise<Station[]> | null = null;
  list: Station[] = [];

  constructor(private fetcher: typeof fetch = (...a) => fetch(...a)) {}

  near(lat: number, lon: number, force = false): Promise<Station[]> {
    if (this.busy) return this.busy;
    if (!force && this.at && haversineKm(this.at, { lat, lon }) < REFETCH_KM) return Promise.resolve(this.list);
    this.busy = (async () => {
      try {
        const res = await this.fetcher(`/api/stations?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`);
        if (!res.ok) return this.list;
        const got = await res.json();
        if (Array.isArray(got)) { this.list = got as Station[]; this.at = { lat, lon }; }
      } catch { /* keep what we had */ }
      return this.list;
    })().finally(() => { this.busy = null; });
    return this.busy;
  }
}
