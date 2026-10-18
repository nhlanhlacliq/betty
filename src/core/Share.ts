import type { MarkedSpot } from './Commands';
import type { PlannedRoute } from './Route';
import type { RideRecord } from './RideMemory';
import { TrackPoint, thinTrack } from './Track';
import type { AreaNote } from './types';

/**
 * Share with a friend's Betty (owner's backlog, 2026-10-18; "a first step to group rides"): a small file with routes,
 * marked spots and area stories that the friend's Betty ADDS to hers (never replaces, never mixes his rides into her
 * rider's journeys or records). A shared ride arrives as a route to ride. Pure, so it is tested.
 */
export interface SharedArea { notes: AreaNote[]; lat?: number; lon?: number }
export interface SharePack {
  app: 'betty-share';
  version: 1;
  /** Who shared it (the name his Betty calls him) */
  from: string;
  at: string;
  routes: PlannedRoute[];
  spots: MarkedSpot[];
  /** Area stories by store key ("Sandton|Gauteng, South Africa") */
  stories: Record<string, SharedArea>;
}

/** A Google Maps directions link through a road (about 9 points: what a link takes). */
export function mapsLinkFor(track: TrackPoint[]): string {
  const pts = thinTrack(track, 10).map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`);
  return `https://www.google.com/maps/dir/${pts.join('/')}`;
}

/** A ride he rode, as a route a friend can ride: its road, distance and time, named after him and the ride. */
export function rideAsRoute(r: RideRecord, track: TrackPoint[], title: string, from: string, minutes: number): PlannedRoute | null {
  if (track.length < 2) return null;
  const [a, b] = [track[0], track[track.length - 1]];
  return {
    name: `${from}'s ride: ${title}`.slice(0, 80),
    stops: [{ name: 'Start', lat: a[0], lon: a[1], named: false }, { name: 'Finish', lat: b[0], lon: b[1], named: true }],
    km: r.distanceKm, minutes: Math.max(1, minutes), delayMin: 0, legs: [], points: thinTrack(track, 800),
    mapsUrl: mapsLinkFor(track), thrilling: false, plannedAt: r.startedAt,
  };
}

export function makePack(from: string, at: Date, parts: Partial<Pick<SharePack, 'routes' | 'spots' | 'stories'>>): SharePack {
  return { app: 'betty-share', version: 1, from: from.trim() || 'A friend', at: at.toISOString(), routes: parts.routes ?? [], spots: parts.spots ?? [], stories: parts.stories ?? {} };
}

/** A shared file, checked (null when it is not one: a backup, or something else). */
export function parsePack(text: string): SharePack | null {
  let j: any;
  try { j = JSON.parse(text); } catch { return null; }
  if (j?.app !== 'betty-share' || j.version !== 1) return null;
  const routes = Array.isArray(j.routes) ? j.routes.filter((r: any) => Array.isArray(r?.points) && r.points.length > 1 && typeof r.name === 'string') : [];
  const spots = Array.isArray(j.spots) ? j.spots.filter((s: any) => typeof s?.lat === 'number' && typeof s?.lon === 'number') : [];
  const stories: Record<string, SharedArea> = {};
  for (const [k, v] of Object.entries(j.stories ?? {})) if (Array.isArray((v as any)?.notes)) stories[k] = v as SharedArea;
  return { app: 'betty-share', version: 1, from: String(j.from ?? 'A friend').slice(0, 40), at: String(j.at ?? ''), routes, spots, stories };
}

export const describePack = (p: SharePack) => {
  const n = Object.values(p.stories).reduce((x, a) => x + a.notes.length, 0);
  return [p.routes.length && `${p.routes.length} route${p.routes.length === 1 ? '' : 's'}`, p.spots.length && `${p.spots.length} marked spot${p.spots.length === 1 ? '' : 's'}`, n && `${n} area stor${n === 1 ? 'y' : 'ies'}`].filter(Boolean).join(', ') || 'nothing';
};

/** His spots with the friend's added (not a spot already within ~30 m), each labelled with who it came from. */
export function mergeSpots(mine: MarkedSpot[], theirs: MarkedSpot[], from: string): MarkedSpot[] {
  const near = (a: MarkedSpot, b: MarkedSpot) => Math.abs(a.lat - b.lat) < 0.0003 && Math.abs(a.lon - b.lon) < 0.0003;
  const add = theirs.filter((t) => !mine.some((m) => near(m, t))).map((t) => ({ ...t, note: `${t.note ? `${t.note} ` : ''}(from ${from})`.trim() }));
  return [...mine, ...add];
}

/** Her area stories with the friend's added: new areas whole, known areas only the stories she does not have. */
export function mergeStories(mine: Record<string, SharedArea>, theirs: Record<string, SharedArea>): { merged: Record<string, SharedArea>; added: number } {
  const out = { ...mine };
  let added = 0;
  for (const [k, t] of Object.entries(theirs)) {
    const have = out[k];
    if (!have) { out[k] = t; added += t.notes.length; continue; }
    const texts = new Set(have.notes.map((n) => n.text));
    const fresh = t.notes.filter((n) => !texts.has(n.text));
    if (fresh.length) { out[k] = { ...have, notes: [...have.notes, ...fresh] }; added += fresh.length; }
  }
  return { merged: out, added };
}
