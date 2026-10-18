import { countsFromTracks } from '../core/RoadMemory';
import type { TrackPoint } from '../core/Track';

const KEY = 'betty.cells.v1';

/**
 * Where he has ridden, as counts per ~200 m cell (core/RoadMemory). Built the first time from the roads already kept,
 * then each ride adds itself. On this phone, in the backup.
 */
export const RoadCells = {
  load(seed: () => TrackPoint[][]): Record<string, number> {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (v && typeof v === 'object') return v;
    } catch { /* fall through */ }
    const counts = countsFromTracks(seed());
    RoadCells.save(counts);
    return counts;
  },
  save(counts: Record<string, number>) { try { localStorage.setItem(KEY, JSON.stringify(counts)); } catch { /* full: the next ride tries again */ } },
};
