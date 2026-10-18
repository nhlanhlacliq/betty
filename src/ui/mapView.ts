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
  /** Optional suburb borders (estimated between suburb centres) and the real metro boundary */
  borders?: { suburbs: Array<{ name: string; lat: number; lon: number }>; metro: Array<Array<[number, number]>> } | null;
  /** The planned route (dotted, under the ridden track) and its named stops */
  route?: TrackPoint[];
  routeStops?: MapPin[];
  /** Place names written beside the road (the ride card's towns), each with a small dot on the line */
  labels?: MapPin[];
  /** Areas (in map units) where no label may go, e.g. under the card's weather pill */
  avoid?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  /** Size of those names in map units (15 on the card; a small map on the phone needs bigger) */
  labelSize?: number;
  /** Explore's map: one dot per area with stories, bigger with more not heard yet; yellow until all are heard */
  areaPins?: AreaPin[];
  /** Radius of his marked spots in map units (6; Explore's smaller-scale map uses more) */
  markRadius?: number;
  /** Your roads (My journeys): every ride's rough road, drawn faint so roads ridden often come out darker */
  roads?: TrackPoint[][];
}
export interface AreaPin { id: string; lat: number; lon: number; label: string; unheard: number; total: number }

/** An area dot's radius in map units (Explore's map is ~0.55 px per unit on a phone). */
export const areaPinRadius = (p: AreaPin) => 11 + Math.min(9, 2.2 * Math.sqrt(p.unheard));

export const MAP_W = 660;
export const MAP_H = 500;
/** Zoom steps for the + and - buttons (km across). */
export const MAP_SPANS = [1.5, 3, 6, 12, 25, 50];
export const DEFAULT_SPAN_KM = 6;

/** The app's font, for text drawn into the sketches (an SVG drawn as an image does not inherit the page's). */
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Project lat/lon to map pixels around the centre (equirectangular: plenty at a few km). */
export function projector(center: LatLon, spanKm: number) {
  const pxPerKm = MAP_W / spanKm;
  const kx = 111.32 * Math.cos((center.lat * Math.PI) / 180);
  return (p: LatLon) => ({ x: MAP_W / 2 + (p.lon - center.lon) * kx * pxPerKm, y: MAP_H / 2 - (p.lat - center.lat) * 110.57 * pxPerKm });
}

/**
 * Suburb borders, ESTIMATED: OpenStreetMap has only suburb centre points in Gauteng (no boundaries), so each suburb
 * gets the area closer to its centre than to any other (a Voronoi cell, clipped to the map). Drawn faint in the
 * texture's sage so the sketch stays the main look; names only when zoomed in. The metro boundary is real (dashed).
 */
export function voronoiCells(pts: Array<{ x: number; y: number }>, box: { x0: number; y0: number; x1: number; y1: number }): Array<Array<{ x: number; y: number }>> {
  return pts.map((p, i) => {
    let poly = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
    for (let j = 0; j < pts.length && poly.length; j++) {
      if (j === i) continue;
      const q = pts[j];
      // Keep the half of the plane closer to p than to q: (v - mid) . (q - p) <= 0
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, nx = q.x - p.x, ny = q.y - p.y;
      if (!nx && !ny) continue;
      const side = (v: { x: number; y: number }) => (v.x - mx) * nx + (v.y - my) * ny;
      const out: Array<{ x: number; y: number }> = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const sa = side(a), sb = side(b);
        if (sa <= 0) out.push(a);
        if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) { const t = sa / (sa - sb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
      }
      poly = out;
    }
    return poly;
  });
}

function bordersSvg(b: NonNullable<MapInput['borders']>, at: (p: LatLon) => { x: number; y: number }, spanKm: number): string {
  const pad = 200;
  const seen = new Set<string>();
  const pts = b.suburbs.map((s) => ({ ...at(s), name: s.name })).filter((p) => {
    const k = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (seen.has(k) || p.x < -pad * 3 || p.x > MAP_W + pad * 3 || p.y < -pad * 3 || p.y > MAP_H + pad * 3) return false;
    seen.add(k); return true;
  });
  const cells = voronoiCells(pts, { x0: -pad, y0: -pad, x1: MAP_W + pad, y1: MAP_H + pad });
  const out: string[] = [];
  for (const c of cells) if (c.length > 2) out.push(`<path d="${c.map((v, i) => `${i ? 'L' : 'M'}${r1(v.x)} ${r1(v.y)}`).join('')}Z" fill="none" stroke="#8fa587" stroke-width="1.1" stroke-linejoin="round" opacity=".5"/>`);
  for (const line of b.metro) {
    const d = line.map((t, i) => { const p = at({ lat: t[0], lon: t[1] }); return `${i ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`; }).join('');
    out.push(`<path d="${d}" fill="none" stroke="#6f8a68" stroke-width="1.8" stroke-dasharray="7 6" opacity=".6"/>`);
  }
  if (spanKm <= 8) {
    for (const p of pts) if (p.x > 10 && p.x < MAP_W - 10 && p.y > 14 && p.y < MAP_H - 6) {
      out.push(`<text x="${r1(p.x)}" y="${r1(p.y)}" font-size="${spanKm <= 4 ? 12 : 10.5}" fill="#6f7f6c" opacity=".75" text-anchor="middle" letter-spacing=".3">${esc(p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name)}</text>`);
    }
  }
  return `<g class="borders">${out.join('')}</g>`;
}

/**
 * Names along the road (ride card): a dot on the line and the name beside it with a pale halo, above the dot or below
 * it, whichever is free. A name that would overlap another, an `avoid` box or the edge is left out.
 */
function labelsSvg(labels: MapPin[], at: (p: LatLon) => { x: number; y: number }, avoid: NonNullable<MapInput['avoid']>, size: number): string {
  const taken = [...avoid];
  const hits = (b: { x0: number; y0: number; x1: number; y1: number }) => b.x0 < 4 || b.y0 < 4 || b.x1 > MAP_W - 4 || b.y1 > MAP_H - 4
    || taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
  const out: string[] = [];
  for (const l of labels) {
    if (!l.label) continue;
    const q = at(l);
    const name = l.label.length > 24 ? `${l.label.slice(0, 23)}…` : l.label;
    const k = size / 15;
    const w = (name.length * 8.6 + 6) * k; // semibold at `size`
    const above = { x0: q.x - w / 2, y0: q.y - 10 * k - 22 * k, x1: q.x + w / 2, y1: q.y - 10 * k };
    const below = { x0: q.x - w / 2, y0: q.y + 10 * k, x1: q.x + w / 2, y1: q.y + 32 * k };
    const box = !hits(above) ? above : !hits(below) ? below : null;
    if (!box) continue;
    taken.push(box);
    out.push(`<circle cx="${r1(q.x)}" cy="${r1(q.y)}" r="${r1(4.5 * k)}" fill="#fffdf3" stroke="#4f6a4a" stroke-width="${r1(2.2 * k)}"/>`
      + `<text x="${r1(q.x)}" y="${r1(box.y1 - 6 * k)}" font-size="${size}" font-weight="600" fill="#3d5239" text-anchor="middle" stroke="#f4f5ec" stroke-width="${r1(4 * k)}" stroke-linejoin="round" paint-order="stroke" font-family="${SANS}">${esc(name)}</text>`);
  }
  return `<g class="labels">${out.join('')}</g>`;
}

/**
 * Explore's area dots: biggest (most unheard) drawn last so they sit on top; each name under its dot where it fits.
 * Dots are always drawn (they are what he taps); a name that would overlap another is left out until he zooms in.
 */
function areaPinsSvg(pins: AreaPin[], at: (p: LatLon) => { x: number; y: number }): string {
  const placed = pins.map((p) => ({ p, q: at(p), r: areaPinRadius(p) })).filter(({ q }) => q.x > -30 && q.x < MAP_W + 30 && q.y > -30 && q.y < MAP_H + 30)
    .sort((a, b) => a.p.unheard - b.p.unheard);
  const dots = placed.map(({ p, q, r }) => `<circle cx="${r1(q.x)}" cy="${r1(q.y)}" r="${r1(r)}" fill="${p.unheard ? '#f4dc7b' : '#cfdcc6'}" stroke="#fffef4" stroke-width="3" opacity=".95"/>`
    + (p.unheard ? `<text x="${r1(q.x)}" y="${r1(q.y + 6)}" font-size="16" font-weight="700" fill="#5d5330" text-anchor="middle" font-family="${SANS}">${p.unheard}</text>` : ''));
  const taken: Array<{ x0: number; y0: number; x1: number; y1: number }> = placed.map(({ q, r }) => ({ x0: q.x - r, y0: q.y - r, x1: q.x + r, y1: q.y + r }));
  const names: string[] = [];
  for (const { p, q, r } of [...placed].reverse()) {
    const name = p.label.length > 20 ? `${p.label.slice(0, 19)}…` : p.label;
    const w = name.length * 11.5 + 8;
    const b = { x0: q.x - w / 2, y0: q.y + r + 3, x1: q.x + w / 2, y1: q.y + r + 29 };
    if (b.x0 < 2 || b.x1 > MAP_W - 2 || b.y1 > MAP_H - 2 || taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0)) continue;
    taken.push(b);
    names.push(`<text x="${r1(q.x)}" y="${r1(b.y1 - 6)}" font-size="20" font-weight="600" fill="#3d5239" text-anchor="middle" stroke="#f4f5ec" stroke-width="5" stroke-linejoin="round" paint-order="stroke" font-family="${SANS}">${esc(name)}</text>`);
  }
  return `<g class="area-pins">${dots.join('')}${names.join('')}</g>`;
}

/** The map position (in map units, 660 x 500) back to a place: the inverse of `projector`. */
export function unproject(center: LatLon, spanKm: number, x: number, y: number): LatLon {
  const pxPerKm = MAP_W / spanKm;
  const kx = 111.32 * Math.cos((center.lat * Math.PI) / 180);
  return { lat: center.lat - (y - MAP_H / 2) / (110.57 * pxPerKm), lon: center.lon + (x - MAP_W / 2) / (kx * pxPerKm) };
}
/** How close and how far the map may zoom (km across). */
export const MIN_SPAN_KM = 0.4;
export const MAX_SPAN_KM = 300;

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
const terrain = (id: string, ox = 0, oy = 0) => `<defs><pattern id="${id}-terrain" width="100" height="100" patternUnits="userSpaceOnUse" patternTransform="translate(${r1(((ox % 100) + 100) % 100)} ${r1(((oy % 100) + 100) % 100)})"><path d="M-20 65Q40 0 100 30T160 0M-10 80Q40 20 100 45T160 10M-10 95Q45 40 100 60T160 30" fill="none" stroke="#aebda2" stroke-width=".7" opacity=".3"/></pattern><filter id="${id}-shadow"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity=".18"/></filter></defs>
<rect width="${MAP_W}" height="${MAP_H}" fill="#e7eadf"/><path d="M458 0 449 60 482 87 465 128 501 176 470 209 486 250 465 289 489 345 453 384 480 425 439 500H660V0Z" fill="#d9e2cb"/><path d="M0 330Q90 300 160 340T300 360 420 420 500 500H0Z" fill="#dde6d3"/><rect width="${MAP_W}" height="${MAP_H}" fill="url(#${id}-terrain)"/>`;

export function mapSvg(m: MapInput, label = 'Sketch of the ride: not for navigation', id = 'map'): string {
  const center = m.center ?? (m.track.length ? { lat: m.track[m.track.length - 1][0], lon: m.track[m.track.length - 1][1] } : null);
  // The scenery's fine pattern is pinned to the ground (a fixed point projected), so it moves when he pans.
  const ref = center ? projector(center, m.spanKm)({ lat: -26, lon: 28 }) : { x: 0, y: 0 };
  const parts: string[] = [terrain(id, ref.x, ref.y)];
  if (center) {
    const at = projector(center, m.spanKm);
    const onMap = (p: { x: number; y: number }, pad = 40) => p.x > -pad && p.x < MAP_W + pad && p.y > -pad && p.y < MAP_H + pad;
    if (m.borders) parts.push(bordersSvg(m.borders, at, m.spanKm));
    if (m.roads?.length) {
      const ds = m.roads.filter((t) => t.length > 1).map((t) => t.map((p, i) => { const q = at({ lat: p[0], lon: p[1] }); return `${i ? 'L' : 'M'}${r1(q.x)} ${r1(q.y)}`; }).join(''));
      parts.push(ds.map((d) => `<path d="${d}" fill="none" stroke="#fffdf3" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>`).join('')
        + ds.map((d) => `<path d="${d}" fill="none" stroke="#5d7a55" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity=".38"/>`).join(''));
    }
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
    if (m.areaPins?.length) parts.push(areaPinsSvg(m.areaPins, at));
    if (m.labels?.length) parts.push(labelsSvg(m.labels, at, m.avoid ?? [], m.labelSize ?? 15));
    for (const p of m.places) {
      const q = at(p); if (!onMap(q, 0)) continue;
      parts.push(`<circle cx="${r1(q.x)}" cy="${r1(q.y)}" r="4" fill="#fbfaf5" stroke="#8a9a80" stroke-width="2"/>`
        + (p.label ? `<text x="${r1(q.x)}" y="${r1(q.y - 10)}" font-size="12" fill="#6f7f6c" text-anchor="middle">${esc(p.label.length > 26 ? p.label.slice(0, 25) + '…' : p.label)}</text>` : ''));
    }
    for (const p of m.marks) {
      const q = at(p); if (!onMap(q, 0)) continue;
      const mr = m.markRadius ?? 6;
      parts.push(`<circle cx="${r1(q.x)}" cy="${r1(q.y)}" r="${mr}" fill="#2f4741" stroke="#fffef4" stroke-width="${r1(mr * 0.42)}"/>`);
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
