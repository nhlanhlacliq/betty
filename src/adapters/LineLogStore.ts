import { LogEntry, mergeLog } from '../core/LineLog';

const KEY = 'betty.log.v1';

/** Everything Betty has said, across rides. Lives in localStorage on this device only; nothing is uploaded. */
export const LineLogStore = {
  load(): LogEntry[] {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  },
  save(fresh: LogEntry[]) {
    if (!fresh.length) return;
    try { localStorage.setItem(KEY, JSON.stringify(mergeLog(LineLogStore.load(), fresh))); } catch { /* storage full or blocked */ }
  },
  /** Everything said on one ride, gone (the ride was deleted). */
  removeRide(rideId: number) {
    try { localStorage.setItem(KEY, JSON.stringify(LineLogStore.load().filter((e) => e.rideId !== rideId))); } catch { /* ignore */ }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};
