const KEY = 'betty.incidents.v1';
/** How long an incident she has already told him about stays known. Long road closures last for weeks. */
const KEEP_MS = 7 * 24 * 3_600_000;

/**
 * Traffic incidents she has already announced on earlier rides, so the same closure near home is not announced at
 * the start of every ride. Kept in localStorage on this device only.
 */
export const IncidentMemory = {
  load(now = Date.now()): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
      return Object.entries(v).filter(([, at]) => now - at < KEEP_MS).map(([k]) => k);
    } catch { return []; }
  },
  save(keys: string[], now = Date.now()) {
    if (!keys.length) return;
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
      for (const k of keys) v[k] ??= now; // keep the first time it was announced, so it expires a week after that
      for (const [k, at] of Object.entries(v)) if (now - at >= KEEP_MS) delete v[k];
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch { /* storage blocked */ }
  },
};
