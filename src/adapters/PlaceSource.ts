import { CONFIG } from '../config/betty';
import { haversineKm, LatLon } from '../core/geo';
import { BikeState, DataSource, NearbyPlace } from '../core/types';

/** Articles shorter than this are stubs with nothing to tell. */
const MIN_ARTICLE_BYTES = 2500;
const MIN_SUMMARY_CHARS = 120;
/** How much of each article Betty gets to read: enough to reach past the lead into the history. */
const NOTES_CHARS = 1800;
/** Places read in full per area. Each one is a separate request, so keep it modest. */
const PLACES_PER_AREA = 8;
/** Round to about 1 km before anything leaves the device: this is the rider's live location. */
const cell = (n: number) => Math.round(n * 100) / 100;

const API = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*';

export interface PlaceCandidate { pageid: number; title: string; lat: number; lon: number; bytes: number; distanceKm: number }

/**
 * Step 1: every Wikipedia article with coordinates in range, with its size. Size is the best cheap sign that an
 * article has a story in it; the nearest article is usually a stub about a suburb.
 */
export function parseCandidates(json: any, from: LatLon): PlaceCandidate[] {
  const out: PlaceCandidate[] = [];
  for (const p of json?.query?.pages ?? []) {
    const c = p?.coordinates?.[0];
    if (!p?.pageid || !p?.title || !c) continue;
    if (/^(List|Lists|Timeline|Outline) of /i.test(p.title)) continue; // index pages, nothing to say about a spot
    out.push({
      pageid: p.pageid, title: p.title, lat: c.lat, lon: c.lon, bytes: Number(p.length) || 0,
      distanceKm: Math.round(haversineKm(from, { lat: c.lat, lon: c.lon }) * 10) / 10,
    });
  }
  return out;
}

/** The articles worth reading in full: the meatiest ones, stubs left out. */
export function pickCandidates(all: PlaceCandidate[], n = PLACES_PER_AREA): PlaceCandidate[] {
  return all.filter((c) => c.bytes >= MIN_ARTICLE_BYTES).sort((a, b) => b.bytes - a.bytes).slice(0, n);
}

/** Step 2: the opening of one article as plain text. Bare lists (of suburbs, of schools) are dropped. */
export function toPlace(c: PlaceCandidate, json: any): NearbyPlace | null {
  const raw = String(json?.query?.pages?.[0]?.extract ?? '');
  const summary = raw.split('\n').map((l) => l.trim())
    .filter((l) => l.split(/\s+/).length > 5) // drops section titles and one-item-per-line lists
    .join(' ').replace(/\s+/g, ' ').trim().slice(0, NOTES_CHARS);
  if (summary.length < MIN_SUMMARY_CHARS) return null;
  return {
    id: `wiki-${c.pageid}`,
    name: c.title.replace(/,\s*(South Africa|Gauteng)$/i, '').replace(/\s*\((South Africa|Gauteng)\)$/i, ''),
    distanceKm: c.distanceKm, summary, lat: c.lat, lon: c.lon, interest: c.bytes,
  };
}

/**
 * Notable places near the rider, from Wikipedia (free, no key, CORS via origin=*; text is CC BY-SA, so Betty
 * paraphrases). These notes are the ONLY facts the tour-guide flavour may use, so they are made rich on purpose:
 * a wide search, the most substantial articles, and enough of each to reach its history. Refetches when the rider
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

  private async get(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  private async tick(force: boolean) {
    if (this.busy) return;
    const raw = this.getPos();
    const pos = { lat: cell(raw.lat), lon: cell(raw.lon) };
    const moved = this.lastPos ? haversineKm(this.lastPos, pos) : Infinity;
    if (!force && moved < CONFIG.feeds.placeRefetchKm) return;
    this.busy = true;
    try {
      const radiusM = Math.min(10_000, Math.round(CONFIG.ambient.placeRadiusKm * 1000));
      const key = `${pos.lat},${pos.lon},${radiusM}`;
      let places = this.cache.get(key);
      if (!places) {
        const list = await this.get(`${API}&generator=geosearch&ggscoord=${pos.lat}%7C${pos.lon}&ggsradius=${radiusM}&ggslimit=50`
          + '&prop=info%7Ccoordinates&colimit=max');
        const chosen = pickCandidates(parseCandidates(list, pos));
        places = [];
        let failed = 0;
        // One at a time on purpose: firing them all at once got HTTP 429 (rate limited) from Wikipedia in testing.
        for (const c of chosen) {
          try {
            const p = toPlace(c, await this.get(`${API}&pageids=${c.pageid}&prop=extracts&explaintext=1&exchars=${NOTES_CHARS}&exsectionformat=plain`));
            if (p) places.push(p);
          } catch { failed++; } // one article failing must not lose the rest
        }
        if (!failed) this.cache.set(key, places); // a partial result is used now but fetched again next time
        else if (!places.length) throw new Error(`${failed} article(s) failed to load`);
      }
      this.push?.({ nearbyPlaces: places });
      this.lastPos = pos;
      this.onStatus(`ok, ${places.length} with a story nearby`);
    } catch (e) {
      this.onStatus(`error: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
