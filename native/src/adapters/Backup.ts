import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Backup, backupOf, collect, restoreStorage } from '../../../src/app/backup';
import { currentStore } from './NativeStore';

/**
 * Garage > Your data, the phone's side (the file format is shared: src/app/backup.ts). Export writes the backup to
 * the cache and opens the share sheet (Save to Files, AirDrop, WhatsApp...). Import reads a file picked from Files.
 * Her picture (from a web backup) is kept as it came, in the app's documents, so it goes out again with the next
 * export; the native orb does not show it yet.
 */
const avatarFile = () => new File(Paths.document, 'betty-avatar.json');

function readAvatar(): Backup['avatar'] {
  try { const f = avatarFile(); return f.exists ? JSON.parse(f.textSync()) : null; } catch { return null; }
}

/** The backup file's name (the same as the web app's). */
const fileName = (b: Backup) => `betty-backup-${b.exportedAt.slice(0, 10)}.json`;

export async function exportAll(): Promise<void> {
  const store = currentStore();
  if (!store) throw new Error('Betty is still loading.');
  const b = backupOf(collect(store.keys(), store), readAvatar());
  const f = new File(Paths.cache, fileName(b));
  if (f.exists) f.delete();
  f.create();
  await f.write(JSON.stringify(b));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(f.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Betty backup' });
}

/** A file he picks (a backup, or a friend's share), as text; null if he cancelled. */
export async function pickFile(): Promise<string | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'public.json', '*/*'], copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.length) return null;
  return new File(r.assets[0].uri).text();
}

/** Replace everything Betty keeps on this phone with the backup, and write it to the phone at once. */
export async function restoreAll(b: Backup) {
  const store = currentStore();
  if (!store) throw new Error('Betty is still loading.');
  restoreStorage(b, store.keys(), store);
  const f = avatarFile();
  try {
    if (b.avatar) { if (f.exists) f.delete(); f.create(); await f.write(JSON.stringify(b.avatar)); }
    else if (f.exists) f.delete();
  } catch { /* the picture is optional */ }
  await store.flush();
}
