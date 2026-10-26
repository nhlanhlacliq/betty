/**
 * Good places to stop (owner, 2026-10-26: "coffee shops, restaurants, whatever else has genuine interest and value",
 * without Google's paid places API). Researched once per area by a model that searches the web (api/story, kind
 * "stops": reviews, blogs, Tripadvisor), kept on the phone, and only when useful: once he has stopped for a while, and
 * for the towns on a planned route. Pure: picking the area and writing what she knows.
 */
import { CONFIG } from '../config/betty';
import type { AreaInfo } from './types';

export interface GoodStop { name: string; kind: string; why: string }

/** The area a stop list is for: the most specific one he is in (the suburb, else the town). */
export function stopsArea(a: AreaInfo | null): string | null {
  return a?.suburb || a?.town || null;
}

/** What she knows about stops here, for her answers and for the line when he stops. */
export function stopsNote(area: string, list: GoodStop[], max = CONFIG.stops.maxListed): string {
  if (!list.length) return '';
  return `Places worth stopping at in ${area} (from reviews; only these, never invent others): ${list.slice(0, max).map((x) => `${x.name} (${x.kind}): ${x.why}`).join(' ')}`;
}
