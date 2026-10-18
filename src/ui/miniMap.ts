import type { TrackPoint } from '../core/Track';

/**
 * A ride's road as a small drawing for its row in My journeys (2026-10-18): just the line, fitted to the box, in the
 * map's colours, with the start as a dot. No map library, no tiles. A ride with no road gets a quiet placeholder.
 */
export function miniTrackSvg(track: TrackPoint[], size = 56): string {
  const pad = 7;
  if (track.length < 2) {
    return `<svg class="mini-map empty" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="4" fill="#c9d3bf"/></svg>`;
  }
  const lat0 = track.reduce((n, t) => n + t[0], 0) / track.length;
  const k = Math.cos((lat0 * Math.PI) / 180); // east-west km shrink with latitude
  const xs = track.map((t) => t[1] * k), ys = track.map((t) => -t[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-4);
  const s = (size - pad * 2) / span;
  const ox = pad + ((size - pad * 2) - (maxX - minX) * s) / 2, oy = pad + ((size - pad * 2) - (maxY - minY) * s) / 2;
  const pts = xs.map((x, i) => `${(ox + (x - minX) * s).toFixed(1)},${(oy + (ys[i] - minY) * s).toFixed(1)}`);
  const [sx, sy] = pts[0].split(',');
  return `<svg class="mini-map" viewBox="0 0 ${size} ${size}" aria-hidden="true">`
    + `<polyline points="${pts.join(' ')}" fill="none" stroke="#fffdf3" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<polyline points="${pts.join(' ')}" fill="none" stroke="#819a77" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<circle cx="${sx}" cy="${sy}" r="2.8" fill="#faf9ee" stroke="#7e9674" stroke-width="1.6"/></svg>`;
}
