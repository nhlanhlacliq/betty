import type { KeyValue } from '../adapters/kv';
import { AreaStore } from '../adapters/AreaSource';
import { RiderMemoryStore } from '../adapters/RiderMemoryStore';
import { RouteStore } from '../adapters/RouteStore';
import { SharePack, mergeSpots, mergeStories } from '../core/Share';

/**
 * Everything Betty keeps on a phone in one file, to move to a new phone or between the web app and the native app
 * (owner, 2026-10-17; shared since 2026-10-24): every `betty.*` entry (settings, rides, tracks, the log, memory, area
 * stories, fuel, incidents...) and her picture. Voice clips are left out: they are made again on demand. Import
 * REPLACES what is on the phone. Both apps use the same keys, so a web backup restores in the native app and back.
 */
export interface Backup {
  app: 'betty';
  version: 1;
  exportedAt: string;
  storage: Record<string, string>;
  avatar: { type: string; data: string } | null;
}

export const PREFIX = 'betty.';

/** Every betty.* entry, given the keys the store holds. */
export function collect(keys: string[], store: KeyValue): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (k.startsWith(PREFIX)) out[k] = store.getItem(k) ?? '';
  return out;
}

export const backupOf = (storage: Record<string, string>, avatar: Backup['avatar'], now = new Date()): Backup =>
  ({ app: 'betty', version: 1, exportedAt: now.toISOString(), storage, avatar });

/** Reads a backup file, or throws with a message for the rider. */
export function parseBackup(text: string): Backup {
  let b: any;
  try { b = JSON.parse(text); } catch { throw new Error('That file is not a Betty backup.'); }
  if (b?.app !== 'betty' || b?.version !== 1 || typeof b?.storage !== 'object' || !b.storage) throw new Error('That file is not a Betty backup.');
  for (const [k, v] of Object.entries(b.storage)) {
    if (!k.startsWith(PREFIX) || typeof v !== 'string') throw new Error('That backup is damaged.');
  }
  if (b.avatar !== null && b.avatar !== undefined && (typeof b.avatar?.type !== 'string' || typeof b.avatar?.data !== 'string')) throw new Error('That backup is damaged.');
  return b as Backup;
}

/** Replaces every betty.* entry with the backup's (other keys untouched). */
export function restoreStorage(b: Backup, keys: string[], store: KeyValue) {
  for (const k of keys) if (k.startsWith(PREFIX)) store.removeItem(k);
  for (const [k, v] of Object.entries(b.storage)) store.setItem(k, v);
}

/** A short description for the confirm step: "14 rides, 312 lines, 3 notes, 2 marked spots, from 2026-10-17". */
export function describeBackup(b: Backup): string {
  const count = (k: string, f: (v: any) => number) => { try { return f(JSON.parse(b.storage[k] ?? 'null')); } catch { return 0; } };
  const rides = count('betty.rides.v1', (v) => (Array.isArray(v) ? v.length : 0));
  const lines = count('betty.log.v1', (v) => (Array.isArray(v) ? v.length : 0));
  const notes = count('betty.memory.v1', (v) => v?.notes?.length ?? 0);
  const spots = count('betty.memory.v1', (v) => v?.marks?.length ?? 0);
  return `${rides} rides, ${lines} lines, ${notes} notes, ${spots} marked spots${b.avatar ? ', her picture' : ''}, from ${b.exportedAt.slice(0, 10)}`;
}

/**
 * A friend's Betty shared routes, spots or stories (core/Share): ADD them (routes to saved routes, spots not already
 * within ~30 m, stories she lacks); nothing of his is replaced. Returns what was added, in words.
 */
export function mergeSharePack(p: SharePack): { text: string; memoryChanged: boolean } {
  for (const r of p.routes) RouteStore.save(r);
  const mem = RiderMemoryStore.load();
  const marks = mergeSpots(mem.marks, p.spots, p.from);
  const spotsAdded = marks.length - mem.marks.length;
  if (spotsAdded) RiderMemoryStore.save({ ...mem, marks });
  const { merged, added } = mergeStories(AreaStore.all(), p.stories);
  for (const [k, a] of Object.entries(merged)) if (p.stories[k]) AreaStore.put(k, a.notes, a.lat != null && a.lon != null ? { lat: a.lat, lon: a.lon } : undefined);
  const bits = [p.routes.length && `${p.routes.length} route${p.routes.length === 1 ? '' : 's'} (in Where to?)`, spotsAdded && `${spotsAdded} spot${spotsAdded === 1 ? '' : 's'}`, added && `${added} stor${added === 1 ? 'y' : 'ies'}`].filter(Boolean);
  return { text: `Added from ${p.from}: ${bits.join(', ') || 'nothing new'}.`, memoryChanged: spotsAdded > 0 };
}
