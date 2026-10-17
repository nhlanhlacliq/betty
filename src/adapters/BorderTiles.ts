import type { LatLon } from '../core/geo';

/** Suburb centres and the real metro boundary lines for part of the map (api/borders.ts). */
export interface BorderData { suburbs: Array<{ name: string; lat: number; lon: number }>; metro: Array<Array<[number, number]>> }

const TILE = 0.1; // ~10 km: each tile takes ~20 s the first time (Overpass), so few, larger ones
const KEY = 'betty.borders.v1';
/** Tiles are fetched only for views up to this wide; wider views use what is already kept. */
export const FETCH_SPAN_KM = 12;
/** Borders are drawn up to this wide (beyond it they are a tangle). */
export const SHOW_SPAN_KM = 30;

export const tileOf = (lat: number, lon: number) => `${(Math.floor(lat / TILE + 1e-9) * TILE).toFixed(2)},${(Math.floor(lon / TILE + 1e-9) * TILE).toFixed(2)}`;

/** The tiles a view needs, with one tile of margin (a suburb just off screen still shapes the borders on it). */
export function tilesFor(center: LatLon, spanKm: number): string[] {
  const halfLat = (spanKm * 0.5 * (500 / 660)) / 110.57 + 0.02; // ~2 km of margin: neighbours just off screen
  const halfLon = (spanKm * 0.5) / (111.32 * Math.cos((center.lat * Math.PI) / 180)) + 0.02;
  const out: string[] = [];
  const lats = [center.lat - halfLat, center.lat + halfLat], lons = [center.lon - halfLon, center.lon + halfLon];
  // Whole tile indices (28.1 / 0.1 is 280.999... in floating point, which used to pull in an extra tile).
  const idx = (v: number) => Math.floor(v / TILE + 1e-9);
  for (let i = idx(lats[0]); i <= idx(lats[1]); i++) {
    for (let j = idx(lons[0]); j <= idx(lons[1]); j++) out.push(`${(i * TILE).toFixed(2)},${(j * TILE).toFixed(2)}`);
  }
  return [...new Set(out)];
}

/**
 * The map's optional suburb borders (Garage > The map; off by default). Tiles come one at a time from Betty's server
 * (the Overpass servers behind it are slow and rate limited) and are kept on the phone for good.
 */
export class BorderTiles {
  private kept: Record<string, BorderData>;
  private loading = new Set<string>();
  private failed = new Map<string, number>();
  private queue: string[] = [];
  private busy = false;

  constructor(private onUpdate: () => void, private fetcher: typeof fetch = (...a) => fetch(...a), private store: Pick<Storage, 'getItem' | 'setItem'> | null = null) {
    try { this.kept = JSON.parse((this.store ?? localStorage).getItem(KEY) ?? '{}') ?? {}; } catch { this.kept = {}; }
  }

  /** What is known for this view (merged tiles), asking for missing tiles if the view is close enough. */
  forView(center: LatLon, spanKm: number): BorderData | null {
    if (spanKm > SHOW_SPAN_KM) return null;
    const tiles = tilesFor(center, spanKm);
    const out: BorderData = { suburbs: [], metro: [] };
    for (const t of tiles) {
      const d = this.kept[t];
      if (d) { out.suburbs.push(...d.suburbs); out.metro.push(...d.metro); }
      else if (spanKm <= FETCH_SPAN_KM && !this.loading.has(t) && Date.now() - (this.failed.get(t) ?? 0) > 120_000 && tiles.length <= 40) { this.loading.add(t); this.queue.push(t); }
    }
    void this.pump();
    return out.suburbs.length || out.metro.length ? out : null;
  }

  private async pump() {
    if (this.busy) return;
    const t = this.queue.shift();
    if (!t) return;
    this.busy = true;
    try {
      const res = await this.fetcher(`/api/borders?tile=${t}`);
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as BorderData;
      this.kept[t] = { suburbs: d.suburbs ?? [], metro: d.metro ?? [] };
      try { (this.store ?? localStorage).setItem(KEY, JSON.stringify(this.kept)); } catch { /* full or blocked: kept for this visit */ }
      this.onUpdate();
    } catch { this.failed.set(t, Date.now()); }
    finally { this.loading.delete(t); this.busy = false; void this.pump(); }
  }
}
