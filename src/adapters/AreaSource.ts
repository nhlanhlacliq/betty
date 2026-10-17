import { haversineKm, LatLon } from '../core/geo';
import { AreaInfo, AreaNote, BikeState, DataSource } from '../core/types';

const KEY = 'betty.areas.v1';
/** Look the area up again after moving this far (km). */
const REFETCH_KM = 2;
/** Round to about 1 km before the position leaves the phone. */
const cell = (n: number) => Math.round(n * 100) / 100;

/** `lat`/`lon`: where he was when the area was found (Explore's map); older entries have none until looked up. */
interface Kept { notes: AreaNote[]; at: number; lat?: number; lon?: number }

/** Researched notes per area, kept on the phone: an area is researched once, then free every ride after. */
const TOLD_KEY = 'betty.told.v1';
/** Ids of the area stories already told, kept across rides (the newest 500). */
export const ToldStore = {
  load(): string[] { try { const v = JSON.parse(localStorage.getItem(TOLD_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } },
  save(ids: string[]) { try { localStorage.setItem(TOLD_KEY, JSON.stringify(ids.slice(-500))); } catch { /* storage blocked */ } },
};

export const AreaStore = {
  all(): Record<string, Kept> { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } },
  get(area: string): AreaNote[] | null { return this.all()[area]?.notes ?? null; },
  put(area: string, notes: AreaNote[], pos?: LatLon) {
    try {
      const a = this.all(); const old = a[area];
      a[area] = { notes, at: old?.at ?? Date.now(), ...(pos ? { lat: pos.lat, lon: pos.lon } : old?.lat != null ? { lat: old.lat, lon: old.lon } : {}) };
      localStorage.setItem(KEY, JSON.stringify(a));
    } catch { /* storage blocked */ }
  },
  /** Where an area is, for one found before positions were kept. */
  place(area: string, pos: LatLon) {
    try { const a = this.all(); if (a[area]) { a[area] = { ...a[area], lat: pos.lat, lon: pos.lon }; localStorage.setItem(KEY, JSON.stringify(a)); } } catch { /* storage blocked */ }
  },
};

/** The areas worth a story at a spot: the town, and the suburb when it is not just part of the town's name. */
export function areasOf(a: AreaInfo): Array<{ name: string; key: string }> {
  const region = [a.region, 'South Africa'].filter(Boolean).join(', ');
  const out: Array<{ name: string; key: string }> = [];
  if (a.town) out.push({ name: a.town, key: `${a.town}|${region}` });
  if (a.suburb && !(a.town && a.suburb.toLowerCase().includes(a.town.toLowerCase()))) out.push({ name: a.suburb, key: `${a.suburb}|${region}` });
  return out;
}

/**
 * History and culture of the area he is riding through (owner, 2026-10-16: "not just Wikipedia, web search as
 * well"). Finds the suburb and town (api/area, OpenStreetMap), then the notes for each: from the phone if this area
 * was researched before, otherwise researched once by api/story (Claude with web search, about 5 cents) and kept.
 * Notes already told on earlier rides are skipped by the engine; when an area runs out, it is researched again for
 * new stories, at most once a ride.
 */
export class AreaSource implements DataSource {
  private timer?: ReturnType<typeof setInterval>;
  private push?: (p: Partial<BikeState>) => void;
  private lastPos: LatLon | null = null;
  private busy = false;
  private moreAsked = new Set<string>();

  constructor(
    private getPos: () => LatLon,
    private told: () => ReadonlySet<string>,
    private onStatus: (msg: string) => void = () => {},
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  start(onUpdate: (p: Partial<BikeState>) => void) {
    this.push = onUpdate;
    this.timer = setInterval(() => void this.tick(), 60_000);
    void this.tick();
  }
  stop() { if (this.timer) clearInterval(this.timer); }

  private async json(url: string, init?: RequestInit) {
    const res = await this.fetcher(url, init);
    const out: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
    return out;
  }

  private async research(name: string, key: string, exclude: string[]): Promise<AreaNote[]> {
    const region = key.split('|')[1] ?? '';
    const out = await this.json('/api/story', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ area: name, region, exclude }) });
    const stamp = Date.now();
    return (out.notes ?? []).map((n: any, i: number) => ({ id: `${key}#${stamp}-${i}`, area: name, topic: String(n.topic ?? ''), text: String(n.text ?? '') }));
  }

  async tick(force = false) {
    if (this.busy) return;
    const raw = this.getPos();
    const pos = { lat: cell(raw.lat), lon: cell(raw.lon) };
    if (!force && this.lastPos && haversineKm(this.lastPos, pos) < REFETCH_KM) return;
    this.busy = true;
    try {
      const info: AreaInfo = await this.json(`/api/area?lat=${pos.lat}&lon=${pos.lon}`);
      const notes: AreaNote[] = [];
      const failed: string[] = [];
      for (const a of areasOf(info)) try {
        let kept = AreaStore.get(a.key);
        const told = this.told();
        if (!kept) {
          this.onStatus(`researching ${a.name}`);
          kept = await this.research(a.name, a.key, []);
          AreaStore.put(a.key, kept, pos);
        } else if (kept.every((n) => told.has(n.id)) && !this.moreAsked.has(a.key)) {
          this.moreAsked.add(a.key); // every story told already: look for new ones, once a ride
          this.onStatus(`finding new stories about ${a.name}`);
          kept = [...kept, ...await this.research(a.name, a.key, kept.map((n) => n.topic))];
          AreaStore.put(a.key, kept, pos);
        }
        if (AreaStore.all()[a.key]?.lat == null) AreaStore.place(a.key, pos); // found before positions were kept
        notes.push(...kept);
      } catch (e) { failed.push(`${a.name}: ${(e as Error).message}`); } // one area failing must not lose the other
      this.push?.({ area: info, areaNotes: notes });
      this.lastPos = pos;
      this.onStatus(`ok, ${areasOf(info).map((a) => a.name).join(' and ') || 'no named area'}: ${notes.length} stories${failed.length ? ` (failed: ${failed.join('; ')})` : ''}`);
    } catch (e) {
      this.onStatus(`error: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
