import { TrackPoint, thinTrack } from '../core/Track';

const KEY = 'betty.tracks.v1';
/** Rides whose path is kept (the newest). */
const KEEP = 30; // was 12; every ride also keeps a rough copy in RoadStore (2026-10-18)

/** The path of recent rides, by ride id (its start time), for the maps in Journeys. On this device only. */
export const TrackStore = {
  all(): Record<string, TrackPoint[]> {
    try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  },
  get(rideId: number): TrackPoint[] { return this.all()[String(rideId)] ?? []; },
  save(rideId: number, track: TrackPoint[]) {
    if (track.length < 2) return;
    try {
      const all = { ...this.all(), [String(rideId)]: thinTrack(track) };
      const ids = Object.keys(all).map(Number).sort((a, b) => b - a).slice(0, KEEP);
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(ids.map((id) => [String(id), all[String(id)]]))));
    } catch { /* storage full or blocked: the map is a nicety */ }
  },
  remove(rideId: number) {
    const all = this.all(); delete all[String(rideId)];
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};
