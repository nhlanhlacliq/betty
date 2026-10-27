import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { CONFIG } from '../../../src/config/betty';
import { recordHeader, recordRow } from '../../../src/core/EngineRecord';
import type { BikeState } from '../../../src/core/types';

/**
 * The ride's engine recording on the phone: one CSV per ride (engine/engine-<ride start>.csv in the app's documents),
 * a row every CONFIG.obd.record.everyMs while the reader gives data, written out every saveEveryMs and at the end.
 * Shared from the Log screen. The rows are core/EngineRecord's.
 */
const dir = () => new Directory(Paths.document, 'engine');

export class EngineRecorder {
  private rows: string[] = [];
  private tick?: ReturnType<typeof setInterval>;
  private save?: ReturnType<typeof setInterval>;
  private file: File;
  constructor(rideId: number, private state: () => BikeState, private gear: (s: BikeState) => number | null, private log: (m: string) => void) {
    const d = dir();
    if (!d.exists) d.create();
    this.file = new File(d, `engine-${new Date(rideId).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.csv`);
  }

  start() {
    const c = CONFIG.obd.record;
    this.tick = setInterval(() => {
      const s = this.state();
      if (s.obd) this.rows.push(recordRow(s, Date.now(), this.gear(s)));
    }, c.everyMs);
    this.save = setInterval(() => void this.write(), c.saveEveryMs);
    this.log(`recording engine data every ${c.everyMs / 1000} s to ${this.file.name}`);
  }

  async stop() {
    clearInterval(this.tick); clearInterval(this.save);
    await this.write();
    const mins = this.rows.length * CONFIG.obd.record.everyMs / 60_000;
    this.log(`engine recording: ${this.rows.length} rows (${mins.toFixed(1)} min of engine data) in ${this.file.name}; share it from the Log`);
    prune();
  }

  private async write() {
    if (!this.rows.length) return;
    try {
      if (this.file.exists) this.file.delete();
      this.file.create();
      await this.file.write(`${recordHeader()}\n${this.rows.join('\n')}\n`);
    } catch (e) { this.log(`engine recording not saved: ${(e as Error).message}`); }
  }
}

/** The recordings on the phone, newest first. */
export function recordings(): File[] {
  const d = dir();
  if (!d.exists) return [];
  return d.list().filter((f): f is File => f instanceof File && f.name.endsWith('.csv')).sort((a, b) => b.name.localeCompare(a.name));
}
function prune() { for (const f of recordings().slice(CONFIG.obd.record.keep)) { try { f.delete(); } catch { /* next time */ } } }

/** Share the newest recording (the share sheet: Files, AirDrop, mail). */
export async function shareLatestRecording(): Promise<boolean> {
  const f = recordings()[0];
  if (!f) return false;
  await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: f.name });
  return true;
}
