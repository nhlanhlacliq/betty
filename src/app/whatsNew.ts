import { kv } from '../adapters/kv';
import type { ChangeDay } from '../changelog';

/** What's new read state (`betty.seen.v2`, entry ids seen), shared by both apps' What's new. */
const SEEN_KEY = 'betty.seen.v2';
const OLD_KEY = 'betty.seen.v1';

export const allIds = (log: ChangeDay[]) => log.flatMap((d) => d.items.map((c) => c.id));
/** Unread entries that are worth a badge (fixes are not). */
export const unreadCount = (log: ChangeDay[], seen: ReadonlySet<string>) =>
  log.reduce((n, d) => n + d.items.filter((c) => c.kind !== 'fixed' && !seen.has(c.id)).length, 0);

export interface SeenStore { get(): string[] | null; set(ids: string[]): void; hadOld(): boolean }
export const LocalSeen: SeenStore = {
  get() { try { const v = JSON.parse(kv.getItem(SEEN_KEY) ?? 'null'); return Array.isArray(v) ? v : null; } catch { return null; } },
  set(ids) { try { kv.setItem(SEEN_KEY, JSON.stringify(ids)); } catch { /* storage blocked */ } },
  hadOld() { try { return kv.getItem(OLD_KEY) !== null; } catch { return false; } },
};

/** What he has seen: stored, or (first time with this version) everything if he used the old one, else all but the newest day. */
export function seenSet(log: ChangeDay[], store: SeenStore): Set<string> {
  const have = store.get();
  if (have) return new Set(have);
  const start = store.hadOld() ? allIds(log) : log.slice(1).flatMap((d) => d.items.map((c) => c.id));
  store.set(start);
  return new Set(start);
}

