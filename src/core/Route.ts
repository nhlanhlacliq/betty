import { haversineKm, LatLon } from './geo';

/**
 * A planned route (api/route.ts: his Google Maps link or typed places, routed by TomTom) and how far along it he is.
 * Pure, so it is tested without a phone. Turn-by-turn stays with Google Maps; Betty uses this for what is ahead.
 */
export interface RouteStop {
  name: string; lat: number; lon: number;
  /** a place he named, not a point he dragged the route through */
  named: boolean;
  /** Minutes he plans to stay there (breakfast, fuel); counted in the time left. Undefined = ride through. */
  stayMin?: number;
}
export interface PlannedRoute {
  name: string;
  stops: RouteStop[];
  km: number;
  minutes: number;
  delayMin: number;
  legs: Array<{ km: number; minutes: number }>;
  points: Array<[number, number]>;
  mapsUrl: string;
  thrilling: boolean;
  plannedAt: number;
  /** When Betty planned it from his description: why these stops, in a sentence */
  why?: string;
}
export interface RouteProgress {
  /** Index of the route point he is nearest (carried to the next call: loops pass the same place twice) */
  index: number;
  doneKm: number;
  leftKm: number;
  leftMin: number;
  /** How far he is from the route line */
  offKm: number;
  /** The next stop he named (not dragged-through points), with the distance to it along the route */
  next: { name: string; km: number } | null;
  arrived: boolean;
}

const cumulative = new WeakMap<PlannedRoute, { along: number[]; stopAt: number[] }>();

/** Distance along the route at each point, and where each stop falls on it (searched forward, so loops work). */
function geometry(r: PlannedRoute) {
  let g = cumulative.get(r);
  if (g) return g;
  const along = [0];
  for (let i = 1; i < r.points.length; i++) {
    along.push(along[i - 1] + haversineKm({ lat: r.points[i - 1][0], lon: r.points[i - 1][1] }, { lat: r.points[i][0], lon: r.points[i][1] }));
  }
  const stopAt: number[] = [];
  let from = 0;
  for (const s of r.stops) {
    let best = from, bestD = Infinity;
    for (let i = from; i < r.points.length; i++) {
      const d = haversineKm(s, { lat: r.points[i][0], lon: r.points[i][1] });
      if (d < bestD) { bestD = d; best = i; }
    }
    stopAt.push(best); from = best;
  }
  g = { along, stopAt };
  cumulative.set(r, g);
  return g;
}

/** Where he is on the route. `hint` = the last index, so a loop's start and finish are not mixed up. */
export function routeProgress(r: PlannedRoute, here: LatLon, hint = 0): RouteProgress {
  const { along, stopAt } = geometry(r);
  const n = r.points.length;
  const total = along[n - 1] || r.km;
  // Look near where he was first (a little back, a good way forward); the whole route only if that finds nothing close.
  const nearest = (lo: number, hi: number) => {
    let best = lo, bestD = Infinity;
    for (let i = Math.max(0, lo); i <= Math.min(n - 1, hi); i++) {
      const d = haversineKm(here, { lat: r.points[i][0], lon: r.points[i][1] });
      if (d < bestD) { bestD = d; best = i; }
    }
    return { i: best, d: bestD };
  };
  let at = nearest(hint - 10, hint + 120);
  if (at.d > 0.5) { const all = nearest(0, n - 1); if (all.d < at.d) at = all; }
  const doneKm = along[at.i];
  const leftKm = Math.max(0, total - doneKm);
  const nextIdx = stopAt.findIndex((p, k) => p > at.i && r.stops[k].named);
  const next = nextIdx >= 0 ? { name: r.stops[nextIdx].name, km: Math.max(0, along[stopAt[nextIdx]] - doneKm) } : null;
  // Planned stays at stops still ahead count in the time left (2026-10-18).
  const stays = r.stops.reduce((n, s, k) => (s.named && s.stayMin && stopAt[k] > at.i ? n + s.stayMin : n), 0);
  return {
    index: at.i, doneKm, leftKm, leftMin: Math.round((r.minutes * leftKm) / Math.max(0.1, total)) + stays, offKm: at.d, next,
    arrived: leftKm < 0.3 && doneKm > total * 0.5,
  };
}

/** Where a point (a petrol station) falls on the route from `fromIndex` on: km along it and how far off its line. */
export function projectOnRoute(r: PlannedRoute, pt: LatLon, fromIndex = 0): { index: number; km: number; offKm: number } | null {
  const { along } = geometry(r);
  let best = -1, bestD = Infinity;
  for (let i = Math.max(0, fromIndex); i < r.points.length; i++) {
    const d = haversineKm(pt, { lat: r.points[i][0], lon: r.points[i][1] });
    if (d < bestD) { bestD = d; best = i; }
  }
  return best < 0 ? null : { index: best, km: along[best], offKm: bestD };
}

/** The named stops still ahead of him, with the distance to each along the route (the island's "Up ahead"). */
export function stopsAhead(r: PlannedRoute, p: RouteProgress): Array<{ name: string; km: number }> {
  const { along, stopAt } = geometry(r);
  return r.stops.map((s, k) => ({ s, at: stopAt[k] })).filter(({ s, at }) => s.named && at > p.index)
    .map(({ s, at }) => ({ name: s.name, km: along[at] - p.doneKm }));
}

/** "2 h 05" / "45 min" */
export const minutesText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);

/** One line about the route for her answers and the briefing. */
export function describeRoute(r: PlannedRoute, p: RouteProgress | null, detour = false): string {
  const kind = r.thrilling ? 'a twisty (thrilling) route' : 'the fastest route';
  const named = r.stops.filter((s) => s.named).map((s) => s.name);
  if (!p) return `He has planned ${kind}: ${r.name}, ${Math.round(r.km)} km, about ${minutesText(r.minutes)}${named.length > 1 ? `, via ${named.slice(0, -1).join(', ')}` : ''}${r.delayMin ? `, ${r.delayMin} min of traffic delay` : ''}. Google Maps gives him the turns.`;
  const off = detour ? ' He is on a detour by choice: do not mention being off the route.' : p.offKm > 0.4 ? ` He is about ${p.offKm.toFixed(1)} km off the route right now.` : '';
  return `He is on his planned route to ${r.name}: ${Math.round(p.leftKm)} km and about ${minutesText(p.leftMin)} left${p.next ? `, next stop ${p.next.name} in ${Math.round(p.next.km)} km` : ''}.${off}`;
}
