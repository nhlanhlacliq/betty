import type { AreaNote } from './types';

/**
 * Explore, as cards per area (owner, 2026-10-17: "a list of places and stories which gets very long"). Pure, so the
 * grouping, ordering and search are tested without a page.
 */

/** One area as the phone keeps it (adapters/AreaSource AreaStore): its notes and when they were researched. */
export interface KeptArea { key: string; notes: AreaNote[]; at: number; lat?: number; lon?: number }

export interface AreaCard {
  name: string;
  /** Store keys merged into this card (an area renamed, e.g. "Westonaria Local Municipality" -> "Westonaria") */
  keys: string[];
  /** Unheard first, then heard, each in the order she researched them */
  notes: AreaNote[];
  heard: number;
  /** When she first researched it (the newest of the merged keys): the cards are newest first */
  at: number;
  lat: number | null;
  lon: number | null;
}

/** "City of Johannesburg Metropolitan Municipality" -> "Johannesburg"; "Westonaria Local Municipality" -> "Westonaria". */
export const plainArea = (name: string) => name.replace(/^City of\s+/i, '').replace(/\s+(Metropolitan|Local|District)\s+Municipality$/i, '').trim() || name;

/** The area's name from its store key ("Sandton|Gauteng, South Africa") or its first note. */
const nameOf = (a: KeptArea) => plainArea(a.notes[0]?.area || a.key.split('|')[0]);

export function areaCards(kept: KeptArea[], told: ReadonlySet<string>): AreaCard[] {
  const by = new Map<string, AreaCard>();
  for (const a of kept) {
    if (!a.notes?.length) continue;
    const name = nameOf(a);
    const id = name.toLowerCase();
    const c = by.get(id) ?? { name, keys: [], notes: [], heard: 0, at: 0, lat: null, lon: null };
    c.keys.push(a.key);
    const seen = new Set(c.notes.map((n) => n.text));
    c.notes.push(...a.notes.filter((n) => !seen.has(n.text)));
    c.at = Math.max(c.at, a.at || 0);
    if (c.lat == null && a.lat != null && a.lon != null) { c.lat = a.lat; c.lon = a.lon; }
    by.set(id, c);
  }
  return [...by.values()].map((c) => {
    const heard = c.notes.filter((n) => told.has(n.id));
    return { ...c, notes: [...c.notes.filter((n) => !told.has(n.id)), ...heard], heard: heard.length };
  }).sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

/** Words of a search, lower case. Every word must appear (in any order). */
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
export const matchesText = (q: string, ...texts: string[]) => {
  const w = words(q);
  if (!w.length) return true;
  const hay = texts.join(' ').toLowerCase();
  return w.every((x) => hay.includes(x));
};

/**
 * A card narrowed to what he is looking for: the area's name matching keeps every story; otherwise only the stories
 * that match. `unheardOnly` keeps the stories she has not told yet. Null = nothing of it to show.
 */
export function filterCard(c: AreaCard, q: string, told: ReadonlySet<string>, unheardOnly: boolean): AreaCard | null {
  let notes = unheardOnly ? c.notes.filter((n) => !told.has(n.id)) : c.notes;
  if (!matchesText(q, c.name)) notes = notes.filter((n) => matchesText(q, n.topic, n.text));
  return notes.length ? { ...c, notes } : null;
}

/**
 * A view that shows every point (Explore's map), 3 to 300 km across. The sketch (660 x 500 units) covers its box and
 * is cropped to it, so on a tall phone box only the middle part of its width shows: the fit uses the visible part
 * (`boxW` x `boxH`), keeping the points inside 80% of it so the dots and names are not cut at the edge.
 */
export function fitView(points: Array<{ lat: number; lon: number }>, boxW = 660, boxH = 500, fallback = { lat: -26.15, lon: 28.05 }): { center: { lat: number; lon: number }; spanKm: number } {
  if (!points.length) return { center: fallback, spanKm: 40 };
  const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
  const center = { lat: (Math.max(...lats) + Math.min(...lats)) / 2, lon: (Math.max(...lons) + Math.min(...lons)) / 2 };
  const wKm = (Math.max(...lons) - Math.min(...lons)) * 111.32 * Math.cos((center.lat * Math.PI) / 180);
  const hKm = (Math.max(...lats) - Math.min(...lats)) * 110.57;
  const k = Math.max(boxW / 660, boxH / 500) || 1;
  const visW = Math.min(660, boxW / k || 660), visH = Math.min(500, boxH / k || 500); // map units that show
  const span = Math.max((wKm * 660) / (visW * 0.8), (hKm * 660) / (visH * 0.8));
  return { center, spanKm: Math.min(300, Math.max(3, span + 1)) };
}
