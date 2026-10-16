/**
 * Betty's look: the yellow companion, or the rider's own picture or GIF (owner, 2026-10-17). The picture is shown
 * circle-cropped in every orb with the same movement (styles: `.has-avatar` in app.css). It is kept on this phone
 * (IndexedDB) and never uploaded.
 */
export interface AvatarStore { get(): Promise<Blob | null>; put(b: Blob): Promise<void>; clear(): Promise<void> }

/** Animated formats are kept as they are (resizing through a canvas would freeze them). */
const ANIMATED = /^image\/(gif|webp|apng)$/i;
/** Largest picture kept as it is: an animated GIF cannot be shrunk without losing its animation. */
export const MAX_AVATAR_BYTES = 6 * 1024 * 1024;
/** Still pictures are cropped to a centred square and shrunk to this many pixels a side. */
const SIDE = 320;

export class IdbAvatarStore implements AvatarStore {
  private db: Promise<IDBDatabase | null>;
  constructor() {
    this.db = new Promise((res) => {
      try {
        const r = indexedDB.open('betty-avatar', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('avatar');
        r.onsuccess = () => res(r.result); r.onerror = () => res(null);
      } catch { res(null); }
    });
  }
  private async run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    const db = await this.db;
    if (!db) return null;
    return new Promise((res) => {
      try { const q = f(db.transaction('avatar', mode).objectStore('avatar')); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); } catch { res(null); }
    });
  }
  async get() {
    const v: any = await this.run('readonly', (s) => s.get('avatar'));
    return v?.bytes ? new Blob([v.bytes], { type: v.type }) : null;
  }
  async put(b: Blob) { const bytes = await b.arrayBuffer(); await this.run('readwrite', (s) => s.put({ bytes, type: b.type }, 'avatar')); }
  async clear() { await this.run('readwrite', (s) => s.delete('avatar')); }
}

export class MemoryAvatarStore implements AvatarStore {
  blob: Blob | null = null;
  async get() { return this.blob; }
  async put(b: Blob) { this.blob = b; }
  async clear() { this.blob = null; }
}

/**
 * What to keep for a chosen file: GIFs (and other possibly animated formats) as they are, up to MAX_AVATAR_BYTES;
 * still pictures cropped to the centre square and shrunk, so a 12 MB phone photo becomes a few dozen KB.
 * `shrink` is injected so tests run without a canvas. Throws with a message for the rider.
 */
export async function prepareAvatar(file: Blob, shrink: (b: Blob, side: number) => Promise<Blob | null> = canvasShrink): Promise<Blob> {
  if (!/^image\//i.test(file.type)) throw new Error('That is not a picture. Choose an image or a GIF.');
  if (ANIMATED.test(file.type)) {
    if (file.size > MAX_AVATAR_BYTES) throw new Error(`That GIF is ${Math.round(file.size / 1048576)} MB. Choose one under 6 MB.`);
    return file;
  }
  const small = await shrink(file, SIDE).catch(() => null);
  if (small) return small;
  if (file.size > MAX_AVATAR_BYTES) throw new Error('That picture is too big. Choose one under 6 MB.');
  return file; // this browser cannot resize it: keep it as it is
}

async function canvasShrink(b: Blob, side: number): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const img = await createImageBitmap(b);
  const s = Math.min(img.width, img.height);
  const c = document.createElement('canvas'); c.width = side; c.height = side;
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, side, side); // centre square
  return new Promise((res) => c.toBlob((out) => res(out), 'image/jpeg', 0.88));
}

/** Shows a picture (or the default companion, for null) in every orb on the page. */
export function applyAvatar(doc: Document, blob: Blob | null, objectUrl: (b: Blob) => string = (b) => URL.createObjectURL(b)) {
  const root = doc.documentElement;
  const old = root.dataset.avatarUrl;
  if (old) { try { URL.revokeObjectURL(old); } catch { /* already gone */ } }
  if (!blob) {
    root.classList.remove('has-avatar'); root.style.removeProperty('--orb-image'); delete root.dataset.avatarUrl;
    return;
  }
  const url = objectUrl(blob);
  root.dataset.avatarUrl = url;
  root.style.setProperty('--orb-image', `url("${url}")`);
  root.classList.add('has-avatar');
}

/** Settings: choose a picture or GIF, or go back to the default. */
export function mountAvatarSetting(doc: Document, store: AvatarStore, toast: (msg: string, err?: boolean) => void) {
  const file = doc.getElementById('avatarfile') as HTMLInputElement | null;
  const reset = doc.getElementById('avatarreset') as HTMLButtonElement | null;
  const showReset = (on: boolean) => { if (reset) reset.hidden = !on; };
  void store.get().then((b) => { applyAvatar(doc, b); showReset(!!b); }).catch(() => {});
  file?.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const keep = await prepareAvatar(f);
      await store.put(keep);
      applyAvatar(doc, keep); showReset(true);
      toast(ANIMATED.test(keep.type) ? 'Betty has a new look. Your GIF keeps moving.' : 'Betty has a new look.');
    } catch (e) { toast((e as Error).message, true); }
  });
  reset?.addEventListener('click', async () => {
    await store.clear(); applyAvatar(doc, null); showReset(false);
    toast('Betty is back to her usual self.');
  });
}
