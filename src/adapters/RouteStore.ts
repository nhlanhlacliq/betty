import { kv } from './kv';
import type { PlannedRoute } from '../core/Route';

const KEY = 'betty.route.v1';
/** The planned route, kept on the phone until he clears it (it is in the data backup, like everything betty.*). */
export const RouteStore = {
  get(): PlannedRoute | null { try { const v = JSON.parse(kv.getItem(KEY) ?? 'null'); return v?.points?.length ? v : null; } catch { return null; } },
  set(r: PlannedRoute | null) { try { if (r) kv.setItem(KEY, JSON.stringify(r)); else kv.removeItem(KEY); } catch { /* storage full or blocked */ } },
  /** Routes he saved to ride again (newest first, 20), with their stays (Route: what is ahead, 2026-10-18). */
  saved(): PlannedRoute[] { try { const v = JSON.parse(kv.getItem(SAVED_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } },
  save(r: PlannedRoute) { try { kv.setItem(SAVED_KEY, JSON.stringify([r, ...RouteStore.saved().filter((x) => x.plannedAt !== r.plannedAt && x.name !== r.name)].slice(0, 20))); } catch { /* full */ } },
  unsave(plannedAt: number) { try { kv.setItem(SAVED_KEY, JSON.stringify(RouteStore.saved().filter((x) => x.plannedAt !== plannedAt))); } catch { /* ignore */ } },
};
const SAVED_KEY = 'betty.routes.saved.v1';
