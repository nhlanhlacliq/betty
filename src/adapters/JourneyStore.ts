const KEY = 'betty.journeys.v1';

/** Favourite rides and names he gave them (Journeys 7, 2026-10-18). On this phone, in the backup. */
interface Meta { starred: number[]; names: Record<string, string> }
let cache: Meta | null = null;
const load = (): Meta => {
  if (cache) return cache;
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); cache = { starred: Array.isArray(v?.starred) ? v.starred : [], names: v?.names && typeof v.names === 'object' ? v.names : {} }; }
  catch { cache = { starred: [], names: {} }; }
  return cache;
};
const save = (m: Meta) => { cache = m; try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* full or blocked */ } };

export const JourneyStore = {
  starred(id: number) { return load().starred.includes(id); },
  setStar(id: number, on: boolean) { const m = load(); save({ ...m, starred: on ? [...new Set([...m.starred, id])] : m.starred.filter((x) => x !== id) }); },
  name(id: number): string | null { return load().names[String(id)] ?? null; },
  /** '' takes the name away (back to the automatic one). */
  rename(id: number, name: string) {
    const m = load(), names = { ...m.names };
    const n = name.trim().slice(0, 60);
    if (n) names[String(id)] = n; else delete names[String(id)];
    save({ ...m, names });
  },
  /** For tests and an import: read storage again. */
  reset() { cache = null; },
};
