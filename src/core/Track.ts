import { LatLon, haversineKm } from './geo';

/** A ride's path as [lat, lon] pairs, rounded to about 1 m. Small enough to keep a few rides on the phone. */
export type TrackPoint = [number, number];

/** A new GPS fix only extends the track once he has moved this far from the last point (GPS jitter at a stop). */
export const TRACK_STEP_KM = 0.015;
/** Most points kept while riding (a few hours at one point per 15 m). */
export const TRACK_MAX_POINTS = 4000;
/** Most points kept per stored ride. */
export const TRACK_STORED_POINTS = 400;

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Extend the track with a fix if it is far enough from the last point. Returns true when a point was added. */
export function addTrackPoint(track: TrackPoint[], p: LatLon): boolean {
  const last = track[track.length - 1];
  if (last && haversineKm({ lat: last[0], lon: last[1] }, p) < TRACK_STEP_KM) return false;
  track.push([round(p.lat), round(p.lon)]);
  if (track.length > TRACK_MAX_POINTS) track.splice(0, track.length - TRACK_MAX_POINTS);
  return true;
}

/** Evenly thinned copy with at most `max` points, always keeping the first and last. */
export function thinTrack(track: TrackPoint[], max = TRACK_STORED_POINTS): TrackPoint[] {
  if (track.length <= max) return track.slice();
  const out: TrackPoint[] = [];
  const step = (track.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(track[Math.round(i * step)]);
  return out;
}
