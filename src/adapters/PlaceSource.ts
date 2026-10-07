import { CONFIG } from '../config/betty';
import { haversineKm, LatLon } from '../core/geo';
import { BikeState, DataSource, NearbyPlace } from '../core/types';

const MIN_SUMMARY_CHARS = 80;
const MAX_SUMMARY_CHARS = 500;
/** Round to about 1 km before anything leaves the device: this is the rider's live location. */
const cell = (n: number) => Math.round(n * 100) / 100;

/** Turns a Wikipedia geosearch-with-extracts response into places, nearest first. Thin stubs are dropped. */
export function parseWikiPlaces(json: any, from: LatLon): NearbyPlace[] {
  const pages: any[] = json?.query?.pages ?? [];
  const out: NearbyPlace[] = [];
  for (const p of pages) {
    const c = p?.coordinates?.[0];
    const summary = String(p?.extract ?? '').replace(/\s+/g, ' ').trim();
    if (!p?.pageid || !p?.title || !c || summary.length < MIN_SUMMARY_CHARS) continue;
    if (/^(List|Lists|Timeline|Outline) of /i.test(p.title)) continue; // index pages, nothing to say about a spot
    out.push({
      id: `wiki-${p.pageid}`,
      name: String(p.title).replace(/,\s*(South Africa|Gauteng)$/i, ''),
      distanceKm: Math.round(haversineKm(from, { lat: c.lat, lon: c.lon }) * 10) / 10,
      summary: summary.slice(0, MAX_SUMMARY_CHARS),
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Notable places near the rider, from Wikipedia (free, no key, CORS via origin=*; text is CC BY-SA, so Betty
 * paraphrases). These summaries are the ONLY facts the tour-guide flavour may use. Refetches when the rider
 * has moved; results are cached per rounded coordinate cell.
 */
export class PlaceSource implements DataSource {
  private timer?: ReturnType<typeof setInterval>;
  private push?: (p: Partial<BikeState>) => void;
  private lastPos: LatLon | null = null;
  private busy = false;
  private cache = new Map<string, NearbyPlace[]>();

  constructor(private getPos: () => LatLon, private onStatus: (msg: string) => void = () => {}) {}

  start(onUpdate: (p: Partial<BikeState>) => void) {
    this.push = onUpdate;
    this.timer = setInterval(() => void this.tick(false), 15_000);
    void this.tick(true);
  }
  stop() { if (this.timer) clearInterval(this.timer); }
  refresh() { void this.tick(true); }

  private async tick(force: boolean) {
    if (this.busy) return;
    const raw = this.getPos();
    const pos = { lat: cell(raw.lat), lon: cell(raw.lon) };
    const moved = this.lastPos ? haversineKm(this.lastPos, pos) : Infinity;
    if (!force && moved < CONFIG.feeds.placeRefetchKm) return;
    this.busy = true;
    try {
      const key = `${pos.lat},${pos.lon}`;
      let places = this.cache.get(key);
      if (!places) {
        const radiusM = Math.min(10_000, Math.round(CONFIG.ambient.placeRadiusKm * 1000));
        const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*'
          + `&generator=geosearch&ggscoord=${pos.lat}%7C${pos.lon}&ggsradius=${radiusM}&ggslimit=10`
          + '&prop=extracts%7Ccoordinates&exintro=1&explaintext=1&exsentences=4&exlimit=max&colimit=max';
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        places = parseWikiPlaces(await res.json(), pos);
        this.cache.set(key, places);
      }
      this.push?.({ nearbyPlaces: places });
      this.lastPos = pos;
      this.onStatus(`ok, ${places.length} nearby`);
    } catch (e) {
      this.onStatus(`error: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
