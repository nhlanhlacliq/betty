const KEY = 'betty.fuel.v1';

/** Km ridden since the last recorded fill-up, kept across rides on this device. null = no fill-up recorded yet. */
export const FuelStore = {
  load(): number | null {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      return typeof v?.kmSinceFill === 'number' && Number.isFinite(v.kmSinceFill) ? v.kmSinceFill : null;
    } catch { return null; }
  },
  save(kmSinceFill: number | null) {
    if (kmSinceFill === null) return;
    try { localStorage.setItem(KEY, JSON.stringify({ kmSinceFill, savedAt: Date.now() })); } catch { /* ignore */ }
  },
};
