import { RideRecord } from './RideMemory';

/** One thing Betty said (or tried to say), as kept in the saved log. */
export interface LogEntry {
  id: string;
  at: number;
  /** Start time of the ride it belongs to; matches RideRecord.startedAt */
  rideId: number;
  /** e.g. "[P3] ambient_banter (claude, 865 ms)" or "[audio]" */
  head: string;
  text: string;
  /** What became of it: spoken, waiting, not spoken and why. Empty for notes that are not speech. */
  fate: string;
}

export const MAX_LOG_ENTRIES = 1500;

/** Add or update entries by id (a line's fate changes after it is first saved). Oldest first, capped. */
export function mergeLog(stored: LogEntry[], fresh: LogEntry[]): LogEntry[] {
  const byId = new Map(stored.map((e) => [e.id, e]));
  fresh.forEach((e) => byId.set(e.id, e));
  return [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-MAX_LOG_ENTRIES);
}

/** The rides that have lines in the log, newest first. */
export function ridesInLog(entries: LogEntry[]): Array<{ rideId: number; count: number }> {
  const counts = new Map<number, number>();
  entries.forEach((e) => counts.set(e.rideId, (counts.get(e.rideId) ?? 0) + 1));
  return [...counts].map(([rideId, count]) => ({ rideId, count })).sort((a, b) => b.rideId - a.rideId);
}

const two = (n: number) => String(n).padStart(2, '0');
export const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
const clock = (ms: number) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };

/** Plain text for reading on screen, copying or saving. One ride (rideId) or everything, oldest ride first. */
export function formatLog(entries: LogEntry[], rides: RideRecord[], rideId?: number): string {
  const wanted = rideId === undefined ? entries : entries.filter((e) => e.rideId === rideId);
  if (!wanted.length) return 'No lines logged yet.';
  const out: string[] = [];
  let current: number | null = null;
  for (const e of [...wanted].sort((a, b) => a.rideId - b.rideId || a.at - b.at)) {
    if (e.rideId !== current) {
      current = e.rideId;
      const r = rides.find((x) => x.startedAt === e.rideId);
      const facts = r ? `: ${r.minutes} min, ${r.distanceKm} km${r.weather ? `, ${r.weather}` : ''}` : '';
      if (out.length) out.push('');
      out.push(`=== Ride ${stamp(e.rideId)}${facts} ===`);
    }
    out.push(`${clock(e.at)} ${e.head}${e.fate ? ` [${e.fate}]` : ''}: ${e.text}`);
  }
  return out.join('\n');
}
