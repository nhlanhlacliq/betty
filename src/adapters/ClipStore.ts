/**
 * Voice clips kept on the phone across rides (IndexedDB), for lines she says the same way every time: stock phrases
 * and the sound-test lines. Made once per voice, model and style (the key says which), then free and instant
 * (owner, 2026-10-16: Gemini costs; Chirp is free). Any failure just means the clip is fetched again.
 */
export interface ClipStore {
  get(key: string): Promise<Blob | null>;
  put(key: string, clip: Blob): Promise<void>;
}

const STORE = 'clips';

export class IdbClipStore implements ClipStore {
  private db: Promise<IDBDatabase | null>;

  constructor(name = 'betty-voice', private max = 80) {
    this.db = new Promise((res) => {
      try {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      } catch { res(null); }
    });
  }

  async get(key: string): Promise<Blob | null> {
    const db = await this.db;
    if (!db) return null;
    return new Promise((res) => {
      try {
        const q = db.transaction(STORE).objectStore(STORE).get(key);
        q.onsuccess = () => { const v = q.result; res(v?.bytes ? new Blob([v.bytes], { type: v.type }) : null); };
        q.onerror = () => res(null);
      } catch { res(null); }
    });
  }

  async put(key: string, clip: Blob): Promise<void> {
    const db = await this.db;
    if (!db) return;
    const bytes = await clip.arrayBuffer();
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      const count = store.count();
      // A few voices tried makes a few sets; past the cap, start again rather than keep stale ones forever.
      count.onsuccess = () => { if (count.result >= this.max) store.clear(); store.put({ bytes, type: clip.type, at: Date.now() }, key); };
    } catch { /* storage blocked: it is fetched next time */ }
  }
}

/** In-memory stand-in (tests, or a browser without IndexedDB). */
export class MemoryClipStore implements ClipStore {
  readonly clips = new Map<string, Blob>();
  async get(key: string) { return this.clips.get(key) ?? null; }
  async put(key: string, clip: Blob) { this.clips.set(key, clip); }
}
