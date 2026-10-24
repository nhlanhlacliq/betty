import { kv } from './kv';

/** His rider profile (Garage > Let Betty know me), `betty.profile.v1`, in the backup. */
const KEY = 'betty.profile.v1';
export const ProfileStore = {
  get(): string | null { try { const v = JSON.parse(kv.getItem(KEY) ?? 'null'); return typeof v?.text === 'string' && v.text.trim() ? v.text : null; } catch { return null; } },
  set(text: string | null) { try { if (text && text.trim()) kv.setItem(KEY, JSON.stringify({ text: text.trim(), updatedAt: Date.now() })); else kv.removeItem(KEY); } catch { /* blocked */ } },
};

/** The question to ask ChatGPT or Claude, offered with a Copy button. */
export const ASK_ABOUT_ME = 'Summarise what you know about me for my motorcycle co-pilot: who I am, my riding, my interests, my sense of humour, and anything I would not want brought up. Leave out anything sensitive.';
