import { kv } from './kv';
const KEY = 'betty.fuel.v1';

/** Km ridden since the last recorded fill-up, kept across rides on this device. null = no fill-up recorded yet. */
export const FuelStore = {
  load(): number | null {
    try {
      const v = JSON.parse(kv.getItem(KEY) ?? 'null');
      return typeof v?.kmSinceFill === 'number' && Number.isFinite(v.kmSinceFill) ? v.kmSinceFill : null;
    } catch { return null; }
  },
  save(kmSinceFill: number | null) {
    if (kmSinceFill === null) return;
    try { kv.setItem(KEY, JSON.stringify({ kmSinceFill, savedAt: Date.now() })); } catch { /* ignore */ }
  },
};

import type { FillUp } from '../core/FillUps';
const FILLS = 'betty.fillups.v1';
const COUNTER = 'betty.counter.v1';
/** His fill-ups, oldest first (the newest 100). */
export const FillUpStore = {
  load(): FillUp[] { try { const v = JSON.parse(kv.getItem(FILLS) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } },
  add(f: FillUp) { try { kv.setItem(FILLS, JSON.stringify([...FillUpStore.load(), f].slice(-100))); } catch { /* ignore */ } },
  remove(at: number) { try { kv.setItem(FILLS, JSON.stringify(FillUpStore.load().filter((f) => f.at !== at))); } catch { /* ignore */ } },
};
/** The bike's "km since codes cleared" counter (PID 31) as last read, for fill-ups made without a ride running. */
export const BikeCounter = {
  load(): number | null { try { const v = JSON.parse(kv.getItem(COUNTER) ?? 'null'); return typeof v?.km === 'number' ? v.km : null; } catch { return null; } },
  save(km: number) { try { kv.setItem(COUNTER, JSON.stringify({ km, at: Date.now() })); } catch { /* ignore */ } },
};
