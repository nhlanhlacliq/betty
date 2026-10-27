import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Write text to a file in the cache and open the share sheet (Save to Files, AirDrop, mail...). */
export async function shareFile(name: string, text: string, mimeType: string, UTI: string): Promise<void> {
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  await f.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(f.uri, { mimeType, UTI, dialogTitle: name });
}
