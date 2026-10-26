import { kv } from './kv';
import { serverFetch } from './server';
import { CONFIG } from '../config/betty';
import { LatLon } from '../core/geo';
import { Landmark, mergeLandmarks, parseOverpass, parseWikidata, tilesNear, toResearch } from '../core/Landmarks';
import { BikeState, DataSource } from '../core/types';

const TILES_KEY = 'betty.landmarks.v1';
const NOTES_KEY = 'betty.lmnotes.v1';
const TOLD_KEY = 'betty.lmtold.v1';
/** Tiles kept on the phone (each ~10 km square, a few KB) */
const MAX_TILES = 300;
/** A tile is asked again after this long, or after a day when one of the two sources failed */
const FRESH_MS = 30 * 86_400_000, PARTIAL_MS = 86_400_000;

interface Tile { at: number; partial: boolean; list: Landmark[] }

const load = <T>(key: string, empty: T): T => { try { return JSON.parse(kv.getItem(key) ?? 'null') ?? empty; } catch { return empty; } };
const save = (key: string, v: unknown) => { try { kv.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

/** Researched notes per landmark id, kept for good (a landmark is researched once). */
export const LandmarkNotes = {
  all(): Record<string, string[]> { return load(NOTES_KEY, {}); },
  put(id: string, notes: string[]) { const a = this.all(); a[id] = notes; save(NOTES_KEY, a); },
};
/** When each landmark was last told (kept across rides; told again after CONFIG.landmarks.retellDays). */
export const LandmarkTold = {
  load(): Record<string, number> { return load(TOLD_KEY, {}); },
  save(r: Record<string, number>) {
    const keep = Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 1000);
    save(TOLD_KEY, Object.fromEntries(keep));
  },
};

/**
 * Landmarks around him (core/Landmarks): the tiles near his position from the phone, or once from api/landmarks
 * (Wikidata + OpenStreetMap), one request at a time; pushes `landmarks` into the state. A landmark worth it
 * (CONFIG.landmarks.researchFrom) gets researched once as he comes within researchKm (api/story, kind landmark).
 * Server only. Every failure just means fewer landmarks: it never stops the ride.
 */
export class LandmarkSource implements DataSource {
  private timer?: ReturnType<typeof setInterval>;
  private push?: (p: Partial<BikeState>) => void;
  private busy = false;
  private failed = new Set<string>();

  constructor(
    private getPos: () => LatLon | null,
    /** Where he is in words ("Hartbeespoort, North West"), to point the research at the right place */
    private getNear: () => string,
    private onStatus: (msg: string) => void = () => {},
    private fetcher: typeof fetch = serverFetch,
    private now: () => number = Date.now,
  ) {}

  start(onUpdate: (p: Partial<BikeState>) => void) {
    this.push = onUpdate;
    this.timer = setInterval(() => void this.tick(), 20_000);
    void this.tick();
  }
  stop() { if (this.timer) clearInterval(this.timer); }

  private key(t: { lat: number; lon: number }) { return `${t.lat.toFixed(3)},${t.lon.toFixed(3)},${CONFIG.landmarks.tileDeg}`; }

  async tick() {
    const pos = this.getPos();
    if (!pos || this.busy || !CONFIG.landmarksOn) return;
    this.busy = true;
    try {
      const tiles: Record<string, Tile> = load(TILES_KEY, {});
      for (const t of tilesNear(pos)) {
        const k = this.key(t), have = tiles[k];
        const due = !have || this.now() - have.at > (have.partial ? PARTIAL_MS : FRESH_MS);
        if (!due || this.failed.has(k)) continue;
        try {
          const res = await this.fetcher(`/api/landmarks?tile=${t.lat.toFixed(3)},${t.lon.toFixed(3)}&size=${CONFIG.landmarks.tileDeg}`);
          const out: any = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
          const list = mergeLandmarks(parseWikidata({ results: { bindings: out.wd ?? [] } }), parseOverpass({ elements: out.osm ?? [] }));
          tiles[k] = { at: this.now(), partial: !!(out.osmFailed || out.wdFailed), list };
          const keys = Object.keys(tiles).sort((a, b) => tiles[b].at - tiles[a].at);
          for (const old of keys.slice(MAX_TILES)) delete tiles[old];
          save(TILES_KEY, tiles);
          this.onStatus(`${list.length} places in the square at ${t.lat.toFixed(1)}, ${t.lon.toFixed(1)}${tiles[k].partial ? ' (one source failed, asked again tomorrow)' : ''}`);
        } catch (e) {
          this.failed.add(k); // not again this ride
          this.onStatus(`lookup failed (${(e as Error).message})`);
        }
      }
      const notes = LandmarkNotes.all();
      const near = tilesNear(pos).flatMap((t) => tiles[this.key(t)]?.list ?? []).map((l) => (notes[l.id] ? { ...l, notes: notes[l.id] } : l));
      this.push?.({ landmarks: near });
      // The best one ahead gets its story looked up before he is there (once; ~5 cents).
      const next = toResearch(near, pos).find((l) => !this.failed.has(l.id));
      if (next) {
        try {
          this.onStatus(`researching ${next.name}`);
          const res = await this.fetcher('/api/story', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'landmark', area: next.name.slice(0, 80), about: [next.kinds.slice(0, 2).join(', '), next.about].filter(Boolean).join('; '), region: this.getNear().slice(0, 80) }) });
          const out: any = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
          const got = (out.notes ?? []).map((n: any) => String(n.text ?? '')).filter(Boolean);
          LandmarkNotes.put(next.id, got);
          this.push?.({ landmarks: near.map((l) => (l.id === next.id ? { ...l, notes: got } : l)) });
          this.onStatus(`${next.name}: ${got.length} notes`);
        } catch (e) { this.failed.add(next.id); this.onStatus(`could not research ${next.name} (${(e as Error).message})`); }
      }
    } finally { this.busy = false; }
  }
}
