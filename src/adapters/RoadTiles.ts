import { CONFIG } from '../config/betty';
import { RoadWay, decodeWays } from '../core/PathAhead';
import { LatLon } from '../core/geo';
import { serverFetch } from './server';

/**
 * The roads around him (api/roads, OpenStreetMap), for following the road he is on (core/PathAhead). Small tiles
 * (CONFIG.path.roadTileDeg), the one he is in and its neighbours, kept in memory for the ride (the server's edge keeps
 * them a month, so riding the same area again costs little). One at a time; a failed tile is not asked again this ride.
 */
export class RoadTiles {
  private tiles = new Map<string, { at: number; rows: Array<[number, number, string, number[]]> }>();
  private failed = new Set<string>();
  private busy = false;
  private lastKeys = '';
  constructor(private fetcher: typeof fetch = serverFetch, private onStatus: (m: string) => void = () => {}) {}

  private keysNear(p: LatLon): string[] {
    const d = CONFIG.path.roadTileDeg, f = (n: number) => (Math.floor(n / d) * d).toFixed(3);
    const out: string[] = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) out.push(`${f(p.lat + a * d)},${f(p.lon + b * d)}`);
    return out;
  }

  /** The roads near `p` (fetching what is missing); null when nothing changed since the last call. */
  async near(p: LatLon): Promise<RoadWay[] | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const keys = this.keysNear(p);
      for (const k of keys) {
        if (this.tiles.has(k) || this.failed.has(k)) continue;
        try {
          const res = await this.fetcher(`/api/roads?tile=${k}&size=${CONFIG.path.roadTileDeg}`);
          const out: any = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
          this.tiles.set(k, { at: Date.now(), rows: out.ways ?? [] });
        } catch (e) { this.failed.add(k); this.onStatus(`roads ${k}: ${(e as Error).message}`); }
      }
      // keep the newest few in memory
      const old = [...this.tiles.entries()].sort((a, b) => b[1].at - a[1].at).slice(CONFIG.path.roadTilesKeep);
      for (const [k] of old) this.tiles.delete(k);
      const have = keys.filter((k) => this.tiles.has(k)).join('|');
      if (have === this.lastKeys) return null;
      this.lastKeys = have;
      return decodeWays(keys.flatMap((k) => this.tiles.get(k)?.rows ?? []));
    } finally { this.busy = false; }
  }
}
