import { kv } from './kv';

const KEY = 'betty.gears.v1';
/** The gear learner's counts (core/Engine GearLearner), kept across rides so the gears are known from the start.
 *  One bike for now: a garage of bikes would key this by bike. */
export const GearStore = {
  load(): Record<string, number> { try { const v = JSON.parse(kv.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } },
  save(bins: Record<string, number>) { try { kv.setItem(KEY, JSON.stringify(bins)); } catch { /* storage blocked */ } },
};
