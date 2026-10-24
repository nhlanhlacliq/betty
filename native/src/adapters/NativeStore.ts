import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { KeyValue, useStore } from '../../../src/adapters/kv';

/**
 * The phone's store for the shared code (src/adapters/kv). The stores read and write synchronously (they were written
 * for the browser's localStorage), so every `betty.*` entry is loaded into memory once at start-up (`openStore`,
 * before anything reads), and changes are written back to AsyncStorage in batches: half a second after a change, and
 * at once when the app goes to the background.
 */
const PREFIX = 'betty.';
const FLUSH_MS = 500;

class NativeStore implements KeyValue {
  private data = new Map<string, string>();
  private dirty = new Set<string>();
  private gone = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private log: (msg: string) => void) {}

  async load() {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    const got = keys.length ? await AsyncStorage.getMany(keys) : {};
    for (const [k, v] of Object.entries(got)) if (v != null) this.data.set(k, v);
  }

  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.data.get(key) === value) return;
    this.data.set(key, value); this.gone.delete(key); this.dirty.add(key); this.soon();
  }
  removeItem(key: string) { if (this.data.delete(key)) { this.dirty.delete(key); this.gone.add(key); this.soon(); } }
  /** Every key kept (the data backup reads all of them). */
  keys() { return [...this.data.keys()]; }

  private soon() { if (this.timer === undefined) this.timer = setTimeout(() => void this.flush(), FLUSH_MS); }

  async flush() {
    clearTimeout(this.timer); this.timer = undefined;
    const set: Record<string, string> = {};
    for (const k of this.dirty) { const v = this.data.get(k); if (v != null) set[k] = v; }
    const gone = [...this.gone];
    this.dirty.clear(); this.gone.clear();
    try {
      if (Object.keys(set).length) await AsyncStorage.setMany(set);
      if (gone.length) await AsyncStorage.removeMany(gone);
    } catch (e) {
      // Kept in memory and tried again with the next change; said once in the log.
      for (const k of Object.keys(set)) this.dirty.add(k);
      for (const k of gone) this.gone.add(k);
      this.log(`could not save to the phone: ${(e as Error).message}`);
    }
  }
}

let store: NativeStore | null = null;
/** The open store (after openStore), for the data backup. */
export const currentStore = () => store;

/** Load everything Betty keeps and point the shared stores at it. Call (and await) before anything reads a store. */
export async function openStore(log: (msg: string) => void = () => {}) {
  if (store) return store;
  const s = new NativeStore(log);
  try { await s.load(); } catch (e) { log(`could not read the phone's store: ${(e as Error).message}`); }
  useStore(s);
  AppState.addEventListener('change', (st) => { if (st !== 'active') void s.flush(); });
  store = s;
  return s;
}
