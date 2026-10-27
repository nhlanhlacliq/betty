/**
 * The road ahead of him, so distances follow the road instead of a straight line (owner, 2026-10-27: home was "400
 * metres ahead" with a couple of turns to go; traffic only on the road he is actually taking). Three sources, best first:
 *  1. his planned route: the route line from where he is on it;
 *  2. his own past rides: rides that passed here going the same way, and where most of them went next;
 *  3. the road he is on (OpenStreetMap): followed until it splits with no clear way straight on.
 * Things on the path are measured along it; things off it (within the stretch the path covers) are not ahead of him;
 * things beyond its end fall back to the old straight-line rule. Pure; every number is CONFIG.path.
 */
import { CONFIG } from '../config/betty';
import { LatLon, angleDiff, bearingDeg, haversineKm } from './geo';

export type Pt = [number, number];
export interface PathAhead { points: Pt[]; source: 'route' | 'history' | 'road'; km: number; detail: string }

const ll = (p: Pt): LatLon => ({ lat: p[0], lon: p[1] });
const lengthKm = (pts: Pt[]) => pts.reduce((n, p, i) => (i ? n + haversineKm(ll(pts[i - 1]), ll(p)) : 0), 0);

/** Where a point lies against a polyline: how far along it (km from its start) and how far off it. */
export function onPath(pts: Pt[], p: LatLon): { km: number; offKm: number } | null {
  if (pts.length < 2) return null;
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180), ky = 110.57; // km per degree here (flat earth: fine for a few km)
  let best: { km: number; offKm: number } | null = null, done = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][1] * kx, ay = pts[i - 1][0] * ky, bx = pts[i][1] * kx, by = pts[i][0] * ky, px = p.lon * kx, py = p.lat * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, seg = Math.sqrt(len2);
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const off = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (!best || off < best.offKm) best = { km: done + t * seg, offKm: off };
    done += seg;
  }
  return best;
}

/** The polyline from `here`, cut to `maxKm`. */
function cut(pts: Pt[], maxKm: number): Pt[] {
  const out: Pt[] = [pts[0]];
  let km = 0;
  for (let i = 1; i < pts.length && km < maxKm; i++) { km += haversineKm(ll(pts[i - 1]), ll(pts[i])); out.push(pts[i]); }
  return out;
}

/** 1. The planned route from where he is on it. */
export function routeAhead(points: Pt[], index: number, here: LatLon, maxKm = CONFIG.path.maxKm): PathAhead | null {
  const rest = points.slice(Math.max(0, index + 1));
  if (!rest.length) return null;
  const pts = cut([[here.lat, here.lon], ...rest], maxKm);
  return { points: pts, source: 'route', km: lengthKm(pts), detail: 'your route' };
}

/**
 * 2. His usual way from here: every past ride with a stretch within path.historyNearKm of here heading within
 * path.historyHeadingDeg of his course, continued to maxKm. The continuation most of the others agree with wins, cut
 * where fewer than path.agreeShare of them still follow it (one past ride: all of it).
 */
export function historyAhead(tracks: Pt[][], here: LatLon, heading: number, maxKm = CONFIG.path.maxKm): PathAhead | null {
  const c = CONFIG.path;
  const cands: Pt[][] = [];
  for (const t of tracks) {
    if (t.length < 2) continue;
    let best = -1, bestOff = Infinity;
    for (let i = 1; i < t.length; i++) {
      const p = onPath([t[i - 1], t[i]], here);
      if (!p || p.offKm > c.historyNearKm || p.offKm >= bestOff) continue;
      if (Math.abs(angleDiff(heading, bearingDeg(ll(t[i - 1]), ll(t[i])))) > c.historyHeadingDeg) continue;
      best = i; bestOff = p.offKm;
    }
    if (best > 0) { const pts = cut([[here.lat, here.lon], ...t.slice(best)], maxKm); if (pts.length > 1) cands.push(pts); }
  }
  if (!cands.length) return null;
  const marks = (pts: Pt[]) => { // a point every agreeEveryKm along it
    const out: LatLon[] = []; let km = 0, next = c.agreeEveryKm;
    for (let i = 1; i < pts.length; i++) { km += haversineKm(ll(pts[i - 1]), ll(pts[i])); if (km >= next) { out.push(ll(pts[i])); next += c.agreeEveryKm; } }
    return out;
  };
  const follows = (b: Pt[], p: LatLon) => (onPath(b, p)?.offKm ?? Infinity) <= c.agreeKm;
  let bestPts = cands[0], bestScore = -1, bestAgree: number[] = [];
  for (const a of cands) {
    const agree = marks(a).map((m) => cands.filter((b) => follows(b, m)).length);
    const score = agree.reduce((n, x) => n + x, 0);
    if (score > bestScore) { bestScore = score; bestPts = a; bestAgree = agree; }
  }
  // cut where too few follow it any more (but keep the first stretch: he is on it now)
  const need = Math.max(1, Math.ceil(cands.length * c.agreeShare));
  const stopAt = bestAgree.findIndex((n) => n < need);
  const keepKm = stopAt < 0 ? maxKm : Math.max(c.agreeEveryKm, stopAt * c.agreeEveryKm);
  const pts = cut(bestPts, keepKm);
  return { points: pts, source: 'history', km: lengthKm(pts), detail: `your usual way (${cands.length} past ride${cands.length === 1 ? '' : 's'})` };
}

/** A road from OpenStreetMap: its points in order, and whether it is one-way (1 = in that order, -1 = the reverse). */
export interface RoadWay { pts: Pt[]; oneway: 0 | 1 | -1; name?: string }

const key = (p: Pt) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
/** The road network as junctions: for every point, the ways through it and where (built once per set of tiles). */
export class RoadGraph {
  private at = new Map<string, Array<{ w: number; i: number }>>();
  constructor(readonly ways: RoadWay[]) {
    ways.forEach((r, w) => r.pts.forEach((p, i) => { const k = key(p); const l = this.at.get(k); if (l) l.push({ w, i }); else this.at.set(k, [{ w, i }]); }));
  }
  /** Ways leaving this point (both directions where allowed). */
  exits(p: Pt): Array<{ w: number; i: number; dir: 1 | -1 }> {
    const out: Array<{ w: number; i: number; dir: 1 | -1 }> = [];
    for (const { w, i } of this.at.get(key(p)) ?? []) {
      const r = this.ways[w];
      if (i < r.pts.length - 1 && r.oneway !== -1) out.push({ w, i, dir: 1 });
      if (i > 0 && r.oneway !== 1) out.push({ w, i, dir: -1 });
    }
    return out;
  }
}

/** 3. The road he is on, followed while there is a clear way straight on (path.straightDeg, others path.otherDeg off). */
export function roadAhead(g: RoadGraph, here: LatLon, heading: number, maxKm = CONFIG.path.roadMaxKm): PathAhead | null {
  const c = CONFIG.path;
  let best: { w: number; i: number; dir: 1 | -1; off: number } | null = null;
  g.ways.forEach((r, w) => {
    for (let i = 1; i < r.pts.length; i++) {
      const p = onPath([r.pts[i - 1], r.pts[i]], here);
      if (!p || p.offKm > c.roadSnapKm || (best && p.offKm >= best.off)) continue;
      const fwd = bearingDeg(ll(r.pts[i - 1]), ll(r.pts[i]));
      if (r.oneway !== -1 && Math.abs(angleDiff(heading, fwd)) <= c.roadHeadingDeg) best = { w, i, dir: 1, off: p.offKm };
      else if (r.oneway !== 1 && Math.abs(angleDiff(heading, (fwd + 180) % 360)) <= c.roadHeadingDeg) best = { w, i: i - 1, dir: -1, off: p.offKm };
    }
  });
  if (!best) return null;
  const pts: Pt[] = [[here.lat, here.lon]];
  let { w, i, dir } = best as { w: number; i: number; dir: 1 | -1 };
  let km = 0, ended = 'its end', steps = 0;
  const name = g.ways[w].name;
  while (km < maxKm && steps++ < 2000) {
    const r = g.ways[w], p = r.pts[i];
    km += haversineKm(ll(pts[pts.length - 1]), ll(p)); pts.push(p);
    const ni = i + dir;
    const exits = g.exits(p).filter((e) => !(e.w === w && e.dir === -dir)); // not back the way he came
    const inBearing = bearingDeg(ll(pts[pts.length - 2]), ll(p));
    const turn = (e: { w: number; i: number; dir: 1 | -1 }) => Math.abs(angleDiff(inBearing, bearingDeg(ll(p), ll(g.ways[e.w].pts[e.i + e.dir]))));
    if (exits.length === 1 && exits[0].w === w && ni >= 0 && ni < r.pts.length) { i = ni; continue; } // just the road going on
    if (!exits.length) { ended = 'its end'; break; }
    const straight = exits.filter((e) => turn(e) <= c.straightDeg);
    const others = exits.filter((e) => turn(e) > c.straightDeg);
    // the same road going on (its name or route number) wins over side roads (the M20 stopped at every junction)
    const here = g.ways[w].name;
    const same = here ? straight.filter((e) => g.ways[e.w].name === here).sort((a, b) => turn(a) - turn(b))[0] : undefined;
    const pick = same ?? (straight.length === 1 && others.every((e) => turn(e) >= c.otherDeg) ? straight[0] : undefined);
    if (pick) { ({ w, i, dir } = pick); i += dir; continue; }
    ended = 'a junction'; break;
  }
  if (pts.length < 2) return null;
  return { points: pts, source: 'road', km: lengthKm(pts), detail: `the road you are on${name ? ` (${name})` : ''}, ${lengthKm(pts).toFixed(1)} km to ${ended}` };
}

/**
 * Where a thing is ahead of him: km along the path when it lies on it (within offKm); null when the path covers that
 * stretch and it is off it (not on his way); the straight-line rule (within coneDeg of his course) beyond the path's
 * end or with no path. Returns null for things behind him.
 */
export function aheadKm(target: LatLon, here: LatLon, heading: number | null, path: PathAhead | null, offKm: number, coneDeg: number): number | null {
  const straight = haversineKm(here, target);
  if (path) {
    const p = onPath(path.points, target);
    if (p && p.offKm <= offKm) return p.km;
    if (straight <= path.km) return null; // within the stretch the path covers, and not on it: not on his way
  }
  if (heading == null) return straight;
  return Math.abs(angleDiff(heading, bearingDeg(here, target))) <= coneDeg ? straight : null;
}

/** Road tiles: OpenStreetMap ways in delta-coded integers of 1e-5 degrees (api/roads) -> RoadWay, each way once
 *  (a road crossing a tile edge comes in both tiles: twice it would look like a junction). */
export function decodeWays(rows: Array<[number, number, string, number[]]>): RoadWay[] {
  const seen = new Set<number>();
  return rows.filter(([id]) => (seen.has(id) ? false : (seen.add(id), true))).map(([, oneway, name, d]) => {
    const pts: Pt[] = [];
    let lat = 0, lon = 0;
    for (let k = 0; k + 1 < d.length; k += 2) { lat += d[k]; lon += d[k + 1]; pts.push([lat / 1e5, lon / 1e5]); }
    return { pts, oneway: (oneway === 1 ? 1 : oneway === -1 ? -1 : 0) as 0 | 1 | -1, ...(name ? { name } : {}) };
  });
}

/**
 * Keeps the path ahead current: worked out again when he has moved path.recomputeM, turned path.recomputeDeg, or every
 * path.recomputeMs. The best source that has an answer wins.
 */
export class PathPredictor {
  private tracks: Pt[][] = [];
  private graph: RoadGraph | null = null;
  private last: { at: number; lat: number; lon: number; heading: number } | null = null;
  path: PathAhead | null = null;
  setTracks(t: Pt[][]) { this.tracks = t; this.last = null; }
  setRoads(ways: RoadWay[]) { this.graph = ways.length ? new RoadGraph(ways) : null; this.last = null; }
  hasRoads() { return !!this.graph; }

  update(here: LatLon | null, heading: number | null, speedKmh: number, now: number, route: { points: Pt[]; index: number } | null): PathAhead | null {
    const c = CONFIG.path;
    if (!c.on || !here) return (this.path = null);
    if (route) return (this.path = routeAhead(route.points, route.index, here));
    if (heading == null || speedKmh < c.minKmh) return this.path; // keep the last one while stopped
    const l = this.last;
    if (l && now - l.at < c.recomputeMs && haversineKm(l, here) * 1000 < c.recomputeM && Math.abs(angleDiff(l.heading, heading)) < c.recomputeDeg) return this.path;
    this.last = { at: now, lat: here.lat, lon: here.lon, heading };
    const usual = historyAhead(this.tracks, here, heading);
    const road = this.graph ? roadAhead(this.graph, here, heading) : null;
    // his usual way when it reaches far enough; else whichever goes further (the road he is on, to its next junction)
    this.path = usual && usual.km >= c.minHistoryKm ? usual : [usual, road].filter((x): x is PathAhead => !!x).sort((a, b) => b.km - a.km)[0] ?? null;
    return this.path;
  }
}
