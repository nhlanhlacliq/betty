/**
 * The ride map as an SVG string: a pure function, so it is unit-tested in Node and costs no map library or tile
 * service. It draws what Betty actually knows: the path ridden so far, where he is and which way he is heading,
 * nearby places she may talk about, traffic incidents and the spots he marked, on a quiet terrain background.
 * It is a sketch of the ride, not a navigation map, and says so.
 */
import type { LatLon } from '../core/geo';
import type { TrackPoint } from '../core/Track';

export interface MapPin { lat: number; lon: number; label?: string }

export interface MapInput {
  /** Where the map is centred (normally the current position). Null = no fix yet. */
  center: LatLon | null;
  /** The marker for him; null to leave it off (a past ride) */
  here: LatLon | null;
  headingDeg: number | null;
  track: TrackPoint[];
  places: MapPin[];
  incidents: MapPin[];
  marks: MapPin[];
  /** Width of the map in km */
  spanKm: number;
  /** The planned route (dotted, under the ridden track) and its named stops */
  route?: TrackPoint[];
  routeStops?: MapPin[];
}

export const MAP_W = 660;
export const MAP_H = 500;
/** Zoom steps for the + and - buttons (km across). */
export const MAP_SPANS = [1.5, 3, 6, 12, 25, 50];
export const DEFAULT_SPAN_KM = 6;

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Project lat/lon to map pixels around the centre (equirectangular: plenty at a few km). */
export function projector(center: LatLon, spanKm: number) {
  const pxPerKm = MAP_W / spanKm;
  const kx = 111.32 * Math.cos((center.lat * Math.PI) / 180);
  return (p: LatLon) => ({ x: MAP_W / 2 + (p.lon - center.lon) * kx * pxPerKm, y: MAP_H / 2 - (p.lat - center.lat) * 110.57 * pxPerKm });
}

/** The span that fits a whole track (for a past ride's map), from the zoom steps. */
export function spanFor(track: TrackPoint[]): number {
  if (track.length < 2) return DEFAULT_SPAN_KM;
  const lats = track.map((t) => t[0]), lons = track.map((t) => t[1]);
  const mid = (Math.max(...lats) + Math.min(...lats)) / 2;
  const wKm = (Math.max(...lons) - Math.min(...lons)) * 111.32 * Math.cos((mid * Math.PI) / 180);
  const hKm = (Math.max(...lats) - Math.min(...lats)) * 110.57 * (MAP_W / MAP_H);
  const need = Math.max(wKm, hKm) * 1.25;
  return MAP_SPANS.find((s) => s >= need) ?? MAP_SPANS[MAP_SPANS.length - 1];
}

/** Centre of a track's bounding box. */
export function trackCenter(track: TrackPoint[]): LatLon | null {
  if (!track.length) return null;
  const lats = track.map((t) => t[0]), lons = track.map((t) => t[1]);
  return { lat: (Math.max(...lats) + Math.min(...lats)) / 2, lon: (Math.max(...lons) + Math.min(...lons)) / 2 };
}

/**
 * Quiet background shapes, the same every time so the map does not flicker as he moves. Ids are per map: a page can
 * hold several maps, and a url(#id) that resolves into a hidden one draws nothing.
 */
const terrain = (id: string) => `<defs><pattern id="${id}-terrain" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M-20 65Q40 0 100 30T160 0M-10 80Q40 20 100 45T160 10M-10 95Q45 40 100 60T160 30" fill="none" stroke="#aebda2" stroke-width=".7" opacity=".3"/></pattern><filter id="${id}-shadow"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity=".18"/></filter></defs>
<rect width="${MAP_W}" height="${MAP_H}" fill="#e7eadf"/><path d="M458 0 449 60 482 87 465 128 501 176 470 209 486 250 465 289 489 345 453 384 480 425 439 500H660V0Z" fill="#d9e2cb"/><path d="M0 330Q90 300 160 340T300 360 420 420 500 500H0Z" fill="#dde6d3"/><rect width="${MAP_W}" height="${MAP_H}" fill="url(#${id}-terrain)"/>`;

export function mapSvg(m: MapInput, label = 'Sketch of the ride: not for navigation', id = 'map'): string {
  const parts: string[] = [terrain(id)];
  const center = m.center ?? (m.track.length ? { lat: m.track[m.track.length - 1][0], lon: m.track[m.track.length - 1][1] } : null);
  if (center) {
    const at = projector(center, m.spanKm);
    const onMap = (p: { x: number; y: number }, pad = 40) => p.x > -pad && p.x < MAP_W + pad && p.y > -pad && p.y < MAP_H + pad;
    if (m.route && m.route.length > 1) {
      const d = m.route.map((t, i) => { const p = at({ lat: t[0], lon: t[1] }); return `${i ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`; }).join('');
      parts.push(`<path d="${d}" fill="none" stroke="#fffdf3" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`
        + `<path d="${d}" fill="none" stroke="#b39a52" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round" stroke-linejoin="round"/>`);
      for (const p of m.routeStops ?? []) {
        const q = at(p); if (!onMap(q, 0)) continue;
        parts.push(`<circle cx="${r1(q.x)}" cy="${r1(q.y)}" r="6" fill="#f4dc7b" stroke="#fffef4" stroke-width="2.5"/>`
          + (p.label ? `<text x="${r1(q.x)}" y="${r1(q.y - 12)}" font-size="12" font-weight="600" fill="#5d6a55" text-anchor="middle">${esc(p.label.length > 22 ? p.label.slice(0, 21) + '…' : p.label)}</text>` : ''));
      }
    }
    if (m.track.length > 1) {
      const d = m.track.map((t, i) => { const p = at({ lat: t[0], lon: t[1] }); return `${i ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`; }).join('');
      parts.push(`<path d="${d}" fill="none" stroke="#fffdf3" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`
        + `<path d="${d}" fill="none" stroke="#819a77" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
      const s = at({ lat: m.track[0][0], lon: m.track[0][1] });
      if (onMap(s)) parts.push(`<circle cx="${r1(s.x)}" cy="${r1(s.y)}" r="7" fill="#faf9ee" stroke="#7e9674" stroke-width="3"/>`);
    }
    for (const p of m.places) {
      const q = at(p); if (!onMap(q, 0)) continue;
      parts.push(`<circle cx="${r1(q.x)}" cy="${r1(q.y)}" r="4" fill="#fbfaf5" stroke="#8a9a80" stroke-width="2"/>`
        + (p.label ? `<text x="${r1(q.x)}" y="${r1(q.y - 10)}" font-size="12" fill="#6f7f6c" text-anchor="middle">${esc(p.label.length > 26 ? p.label.slice(0, 25) + '…' : p.label)}</text>` : ''));
    }
    for (const p of m.marks) {
      const q = at(p); if (!onMap(q, 0)) continue;
      parts.push(`<circle cx="${r1(q.x)}" cy="${r1(q.y)}" r="6" fill="#2f4741" stroke="#fffef4" stroke-width="2.5"/>`);
    }
    for (const p of m.incidents) {
      if (!p.lat && !p.lon) continue; // simulator incidents have no position
      const q = at(p); if (!onMap(q, 0)) continue;
      parts.push(`<g transform="translate(${r1(q.x)} ${r1(q.y)})"><circle r="13" fill="#fbfaf5" stroke="#c98a5b" stroke-width="2"/><path d="M0-6 6 5H-6Z" fill="none" stroke="#a8603a" stroke-width="2" stroke-linejoin="round"/></g>`);
    }
    if (m.here) {
      const h = at(m.here);
      const arrow = m.headingDeg == null
        ? '<circle r="6" fill="#2f4741"/>'
        : `<path d="M0-12 9 9 0 4-9 9Z" fill="#2f4741" transform="rotate(${Math.round(m.headingDeg)})"/>`;
      parts.push(`<g transform="translate(${r1(h.x)} ${r1(h.y)})" filter="url(#${id}-shadow)"><circle r="27" fill="#fffef4"/><circle r="21" fill="#f4dc7b"/>${arrow}</g>`);
    }
  }
  return `<svg class="map-art" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(label)}">${parts.join('')}</svg>`;
}
