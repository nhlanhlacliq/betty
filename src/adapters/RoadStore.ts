import { TrackPoint, thinTrack } from '../core/Track';

const KEY = 'betty.roads.v1';
/** Rides whose rough road is kept: about 1 KB each. */
const KEEP = 500;
/** Points per ride: enough for a thumbnail and the all-roads map. */
export const ROAD_POINTS = 60;

const coarse = (t: TrackPoint[]): TrackPoint[] => thinTrack(t, ROAD_POINTS).map(([a, b]) => [Math.round(a * 1e4) / 1e4, Math.round(b * 1e4) / 1e4]);

/**
 * A rough copy of EVERY ride's road (the detailed TrackStore keeps only the newest 30), for the thumbnails and the
 * Your roads map in My journeys (2026-10-18). On this device, in the backup.
 */
export const RoadStore = {
  all(): Record<string, TrackPoint[]> {
    try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  },
  get(rideId: number): TrackPoint[] { return this.all()[String(rideId)] ?? []; },
  save(rideId: number, track: TrackPoint[]) {
    if (track.length < 2) return;
    try {
      const all = { ...this.all(), [String(rideId)]: coarse(track) };
      const ids = Object.keys(all).map(Number).sort((a, b) => b - a).slice(0, KEEP);
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(ids.map((id) => [String(id), all[String(id)]]))));
    } catch { /* full or blocked: the thumbnails are a nicety */ }
  },
  /** Fill in rides whose detailed track is kept but have no rough copy yet (rides from before this store existed). */
  seed(detailed: Record<string, TrackPoint[]>) {
    const have = this.all();
    const missing = Object.entries(detailed).filter(([id, t]) => !have[id] && t.length > 1);
    if (!missing.length) return;
    try { localStorage.setItem(KEY, JSON.stringify({ ...have, ...Object.fromEntries(missing.map(([id, t]) => [id, coarse(t)])) })); } catch { /* ignore */ }
  },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};
