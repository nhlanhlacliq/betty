import { AreaSample, samplesAlong, trimEnds } from '../core/RideCard';
import type { TrackPoint } from '../core/Track';

/**
 * What a ride card adds to its map (owner, 2026-10-17: "labels and line"): the names of the places along the road
 * (/api/area at points spread along the ride) and the real metro boundary (/api/borders?box=). Both are slow the first
 * time (Nominatim allows one request a second; Overpass takes ~30 s for a long ride), so they are fetched when the
 * ride's story opens and kept per ride (`betty.cardmap.v1`, newest 12, like the tracks).
 */
export interface CardExtras {
  samples: AreaSample[];
  /** The suburbs where the ride starts and ends (the town when there is no suburb), left off when the ends are hidden */
  ends: string[];
  metro: Array<Array<[number, number]>> | null;
}

const KEY = 'betty.cardmap.v1';
const KEEP = 12;
const SAMPLES = 8;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const load = (store: Store): Record<string, CardExtras> => { try { return JSON.parse(store.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };

/** The box around the track, out to whole 0.1 degrees with a little margin (the server's metro query takes these). */
export function boxFor(track: TrackPoint[]): string | null {
  if (track.length < 2) return null;
  const lats = track.map((t) => t[0]), lons = track.map((t) => t[1]);
  const down = (v: number) => (Math.floor(v * 10 + 1e-9) / 10).toFixed(1), up = (v: number) => (Math.ceil(v * 10 - 1e-9) / 10).toFixed(1);
  const s = down(Math.min(...lats) - 0.02), w = down(Math.min(...lons) - 0.02), n = up(Math.max(...lats) + 0.02), e = up(Math.max(...lons) + 0.02);
  if (Number(n) - Number(s) > 1.5 || Number(e) - Number(w) > 1.5) return null; // a very long ride: no line
  return `${s},${w},${n},${e}`;
}

export class CardExtrasSource {
  private busy = new Map<number, Promise<CardExtras>>();

  constructor(private fetcher: typeof fetch = (...a) => fetch(...a), private store: Store | null = null, private gapMs = 1100) {}

  private get st(): Store { return this.store ?? localStorage; }

  /** A deleted ride: drop what was kept for its card. */
  forget(rideId: number) {
    try { const all = load(this.st); delete all[String(rideId)]; this.st.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  }

  /** Kept for this ride, if fetched before. */
  kept(rideId: number): CardExtras | null { return load(this.st)[String(rideId)] ?? null; }

  /** Start (or join) fetching for a ride; resolves with what could be found (never rejects). */
  prepare(rideId: number, track: TrackPoint[]): Promise<CardExtras> {
    const have = this.kept(rideId);
    if (have) return Promise.resolve(have);
    const going = this.busy.get(rideId);
    if (going) return going;
    const p = this.fetchAll(rideId, track).finally(() => this.busy.delete(rideId));
    this.busy.set(rideId, p);
    return p;
  }

  private async area(lat: number, lon: number): Promise<{ suburb: string | null; town: string | null } | null> {
    try {
      const res = await this.fetcher(`/api/area?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`);
      if (!res.ok) return null;
      const a: any = await res.json();
      return { suburb: a?.suburb ?? null, town: a?.town ?? null };
    } catch { return null; }
  }

  private async fetchAll(rideId: number, track: TrackPoint[]): Promise<CardExtras> {
    const box = boxFor(track);
    const metro = box ? this.fetcher(`/api/borders?box=${box}`).then(async (r) => (r.ok ? ((await r.json()) as any).metro ?? [] : null)).catch(() => null) : Promise.resolve(null);
    const wait = () => new Promise((r) => setTimeout(r, this.gapMs));
    // Ride ends first (to leave his home area off), then points along the way, one a second (Nominatim's rule).
    const ends: string[] = [];
    let failed = 0;
    for (const t of track.length > 1 ? [track[0], track[track.length - 1]] : []) {
      const a = await this.area(t[0], t[1]);
      const home = a?.suburb ?? a?.town;
      if (home) ends.push(home); else if (!a) failed++;
      await wait();
    }
    const samples: AreaSample[] = [];
    const shown = trimEnds(track);
    for (const p of samplesAlong(shown.length > 1 ? shown : track, SAMPLES)) {
      const a = await this.area(p.lat, p.lon);
      if (a) samples.push({ ...p, ...a }); else failed++;
      await wait();
    }
    const out: CardExtras = { samples, ends: [...new Set(ends)], metro: await metro };
    // Keep it only if it all came through: a dropped signal should be tried again next time.
    if (!failed && out.metro !== null) {
      try {
        const all = { ...load(this.st), [String(rideId)]: out };
        const ids = Object.keys(all).map(Number).sort((a, b) => b - a).slice(0, KEEP);
        this.st.setItem(KEY, JSON.stringify(Object.fromEntries(ids.map((id) => [String(id), all[String(id)]]))));
      } catch { /* full or blocked: used for this visit */ }
    }
    return out;
  }
}
