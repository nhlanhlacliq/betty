/**
 * Where Betty keeps her data on this device. The web app uses the browser's localStorage; the native app swaps in its
 * own store at start-up (`useStore`), loaded into memory first so every read stays instant (the stores read and write
 * synchronously). Resolved at call time, so tests that replace `localStorage` keep working.
 */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let override: KeyValue | null = null;

/** The native app's store (or a test's). `null` goes back to the browser's. */
export function useStore(store: KeyValue | null) { override = store; }

const current = (): KeyValue => {
  if (override) return override;
  const ls = (globalThis as { localStorage?: KeyValue }).localStorage;
  if (!ls) throw new Error('no storage on this device');
  return ls;
};

/** Every store goes through this (getItem/setItem may throw when storage is full or blocked: callers catch). */
export const kv: KeyValue = {
  getItem: (k) => current().getItem(k),
  setItem: (k, v) => current().setItem(k, v),
  removeItem: (k) => current().removeItem(k),
};
