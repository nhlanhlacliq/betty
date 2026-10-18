const KEY = 'betty.dismissed.v1';
/** A dismissed incident stays hidden this long (like IncidentMemory: long closures last for weeks, but not forever). */
const KEEP_MS = 7 * 24 * 3_600_000;

/**
 * Traffic incidents he dismissed from Horizon (owner, 2026-10-18), by incidentKey, kept a week on this device. Kept
 * apart from IncidentMemory (what she has ANNOUNCED): dismissing is his choice to stop seeing it on the card.
 */
export const HorizonDismissed = {
  load(now = Date.now()): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
      return Object.entries(v).filter(([, at]) => now - at < KEEP_MS).map(([k]) => k);
    } catch { return []; }
  },
  add(key: string, now = Date.now()) {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
      v[key] = now;
      for (const [k, at] of Object.entries(v)) if (now - at >= KEEP_MS) delete v[k];
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch { /* storage blocked */ }
  },
};
