import { RideRecord, upsertRide } from '../core/RideMemory';

const KEY = 'betty.rides.v1';

/** Betty's memory of past rides. Lives in localStorage on this device only; nothing is uploaded. */
export const RideLog = {
  load(): RideRecord[] {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  },
  save(rec: RideRecord) {
    try { localStorage.setItem(KEY, JSON.stringify(upsertRide(RideLog.load(), rec))); } catch { /* ignore */ }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};
