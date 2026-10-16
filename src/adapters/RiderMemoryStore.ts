import { EMPTY_MEMORY, RiderMemory } from '../core/Commands';

const KEY = 'betty.memory.v1';

/** What he asked Betty to remember and the spots he marked, kept across rides on this device only. */
export const RiderMemoryStore = {
  load(): RiderMemory {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      return v && Array.isArray(v.notes) && Array.isArray(v.marks) ? v : EMPTY_MEMORY;
    } catch { return EMPTY_MEMORY; }
  },
  save(m: RiderMemory) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage blocked */ } },
};
