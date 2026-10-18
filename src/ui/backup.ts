import { SharePack, describePack, parsePack } from '../core/Share';
import type { AvatarStore } from './avatar';

/**
 * Everything Betty keeps on this phone in one file, to move to a new phone (owner, 2026-10-17): every `betty.*`
 * localStorage entry (settings, rides, tracks, the log, memory, area stories, fuel, incidents...) and her picture.
 * Voice clips are left out: they are made again on demand. Import REPLACES what is on the phone, then reloads.
 */
export interface Backup {
  app: 'betty';
  version: 1;
  exportedAt: string;
  storage: Record<string, string>;
  avatar: { type: string; data: string } | null;
}

const PREFIX = 'betty.';

export function collectStorage(ls: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k && k.startsWith(PREFIX)) out[k] = ls.getItem(k) ?? '';
  }
  return out;
}

const toBase64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function makeBackup(ls: Storage, avatars: AvatarStore, now = new Date()): Promise<Backup> {
  const pic = await avatars.get().catch(() => null);
  return {
    app: 'betty', version: 1, exportedAt: now.toISOString(),
    storage: collectStorage(ls),
    avatar: pic ? { type: pic.type, data: await toBase64(pic) } : null,
  };
}

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

/** Replaces everything Betty keeps on this phone with the backup. */
export async function restoreBackup(b: Backup, ls: Storage, avatars: AvatarStore) {
  for (const k of Object.keys(collectStorage(ls))) ls.removeItem(k);
  for (const [k, v] of Object.entries(b.storage)) ls.setItem(k, v);
  if (b.avatar) await avatars.put(new Blob([fromBase64(b.avatar.data)], { type: b.avatar.type }));
  else await avatars.clear();
}

/** A short description for the confirm step: "14 rides, 312 lines, 3 notes, 2 spots". */
export function describeBackup(b: Backup): string {
  const count = (k: string, f: (v: any) => number) => { try { return f(JSON.parse(b.storage[k] ?? 'null')); } catch { return 0; } };
  const rides = count('betty.rides.v1', (v) => (Array.isArray(v) ? v.length : 0));
  const lines = count('betty.log.v1', (v) => (Array.isArray(v) ? v.length : 0));
  const notes = count('betty.memory.v1', (v) => v?.notes?.length ?? 0);
  const spots = count('betty.memory.v1', (v) => v?.marks?.length ?? 0);
  return `${rides} rides, ${lines} lines, ${notes} notes, ${spots} marked spots${b.avatar ? ', her picture' : ''}, from ${b.exportedAt.slice(0, 10)}`;
}

export interface BackupContext {
  busy(): boolean; toast(msg: string, err?: boolean): void; confirm(msg: string): boolean; reload(): void;
  /** A file a friend's Betty shared (core/Share): add it; returns what was added, in words */
  mergeShare?(p: SharePack): string;
}

/** Send a JSON file with the share sheet (WhatsApp, AirDrop, Files...), or download it where there is none. */
export async function shareJson(doc: Document, obj: unknown, name: string, title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([JSON.stringify(obj)], name, { type: 'application/json' });
  const nav = doc.defaultView?.navigator as Navigator | undefined;
  if (nav?.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return 'shared'; } catch { return 'cancelled'; }
  }
  const a = doc.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  doc.body.append(a); a.click(); a.remove();
  return 'saved';
}

/** Garage > Your data: Export all data (share sheet or download) and Import a backup (replaces, then reloads). */
export function mountBackup(doc: Document, ls: Storage, avatars: AvatarStore, ctx: BackupContext) {
  doc.getElementById('exportdata')?.addEventListener('click', async () => {
    try {
      const b = await makeBackup(ls, avatars);
      const name = `betty-backup-${b.exportedAt.slice(0, 10)}.json`;
      const file = new File([JSON.stringify(b)], name, { type: 'application/json' });
      const nav = doc.defaultView?.navigator as Navigator | undefined;
      if (nav?.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], title: 'Betty backup' }); ctx.toast('Backup ready. Keep it somewhere safe.'); return; } catch { return; } // dismissed
      }
      const a = doc.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
      doc.body.append(a); a.click(); a.remove();
      ctx.toast(`Saved ${name} to your downloads.`);
    } catch (e) { ctx.toast(`Could not make the backup: ${(e as Error).message}`, true); }
  });
  const input = doc.getElementById('importdata') as HTMLInputElement | null;
  input?.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (ctx.busy()) { ctx.toast('End the ride first, then import.', true); return; }
    try {
      const text = await f.text();
      // A friend's share (routes, spots, stories): ADDED, nothing replaced, no reload.
      const pack = parsePack(text);
      if (pack && ctx.mergeShare) {
        if (!ctx.confirm(`Add what ${pack.from} shared (${describePack(pack)})? Nothing of yours is replaced.`)) return;
        ctx.toast(ctx.mergeShare(pack));
        return;
      }
      const b = parseBackup(text);
      if (!ctx.confirm(`Replace everything Betty has on this phone with this backup (${describeBackup(b)})?`)) return;
      await restoreBackup(b, ls, avatars);
      ctx.toast('Backup restored. Reloading...');
      ctx.reload();
    } catch (e) { ctx.toast((e as Error).message, true); }
  });
}
