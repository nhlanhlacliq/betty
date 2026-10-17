import { env, fromBetty, json } from './_shared.js';

/**
 * POST /api/route {link?: string, stops?: string[], from?: {lat, lon}, thrilling?: boolean}
 * -> {name, stops, km, minutes, delayMin, legs, points, mapsUrl, thrilling}
 *
 * The owner plans rides in Google Maps (2026-10-17): he shares the directions and pastes the link, or types places
 * ("Heidelberg, Villiers, Clarens"). The stops become one TomTom motorcycle route (traffic-aware; "thrilling" prefers
 * winding roads). Betty follows it for time left, stops and leaving the route; Google Maps still gives the turns.
 * TomTom free per month: Routing 20,000, Search 2,500.
 */
export interface Stop { name: string; lat: number; lon: number; named: boolean }

const COORD = /^(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)$/;
const MAX_STOPS = 40;
const MAX_POINTS = 800;

/** Only these hosts are ever fetched or parsed: a pasted link must not make the server fetch anything else. */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const isGoogleMaps = (u: URL) => /(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith('/maps');

/**
 * The stops in a full Google Maps directions URL, in order: /maps/dir/<stop>/<stop>/.../data=...
 * A stop is "lat,lon" (a point he dragged the route through) or a place name; a name's coordinates are in the data
 * blob as !3d<lat>!4d<lon>, one pair per named stop in the same order (checked on his link, 2026-10-17).
 * Names without coordinates come back with NaN for the caller to look up.
 */
export function parseGoogleMapsDir(full: string): Stop[] {
  const u = new URL(full);
  const m = u.pathname.match(/\/maps\/dir\/(.*)$/);
  if (!m) return [];
  const segs = m[1].split('/');
  const dataAt = segs.findIndex((s) => s.startsWith('data=') || s.startsWith('@'));
  const data = dataAt >= 0 ? segs.slice(dataAt).join('/') : '';
  const pairs = [...data.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)].map((p) => ({ lat: Number(p[1]), lon: Number(p[2]) }));
  const stops: Stop[] = [];
  let named = 0;
  for (const raw of dataAt >= 0 ? segs.slice(0, dataAt) : segs) {
    const s = decodeURIComponent(raw.replace(/\+/g, ' ')).trim();
    if (!s || /^my location$/i.test(s)) continue; // empty = "from where I am"
    const c = s.match(COORD);
    if (c) { stops.push({ name: `${Number(c[1]).toFixed(3)}, ${Number(c[2]).toFixed(3)}`, lat: Number(c[1]), lon: Number(c[2]), named: false }); continue; }
    const p = pairs[named++];
    stops.push({ name: s, lat: p ? p.lat : NaN, lon: p ? p.lon : NaN, named: true });
  }
  return stops;
}

/** Follows a maps.app.goo.gl short link to the full Google Maps URL (the browser cannot: CORS). */
export async function resolveLink(link: string, fetcher: typeof fetch = fetch): Promise<string> {
  let u: URL;
  try { u = new URL(link.trim()); } catch { throw new Error('That is not a link.'); }
  if (isGoogleMaps(u)) return u.toString();
  if (!SHORT_HOSTS.has(u.hostname)) throw new Error('Paste a Google Maps directions link (Share in Google Maps).');
  const res = await fetcher(u.toString(), { redirect: 'manual' });
  const to = res.headers.get('location');
  if (!to) throw new Error('Google Maps did not open that link.');
  const full = new URL(to, u);
  if (!isGoogleMaps(full)) throw new Error('That link does not open a Google Maps route.');
  return full.toString();
}

/**
 * The best search result for what he typed: an exact name first (a town over a suburb), else TomTom's own order.
 * Without this "Clarens" from Edenvale gave "Clarens Park, Edenvale" (a suburb nearby), not the town (2026-10-17).
 */
export function pickResult(results: any[], q: string): any {
  const want = q.trim().toLowerCase();
  const nameOf = (r: any) => String(r?.poi?.name ?? r?.address?.freeformAddress ?? '').split(',')[0].trim().toLowerCase();
  const exact = results.filter((r) => nameOf(r) === want);
  return exact.find((r) => r.entityType === 'Municipality') ?? exact[0] ?? results[0];
}

/**
 * A typed stop: towns and suburbs first (TomTom idxSet=Geo), then anything (a business like "BMW Motorrad Fourways",
 * an address). Searching everything first found "Clarens" as a street near Edenvale, not the town (2026-10-17).
 */
async function geocode(q: string, key: string, near: { lat: number; lon: number } | null, fetcher: typeof fetch): Promise<Stop> {
  const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
  for (const idx of ['&idxSet=Geo', '']) {
    const res = await fetcher(`https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${key}&countrySet=ZA&limit=5${idx}${bias}`);
    const out: any = await res.json().catch(() => ({}));
    const r = pickResult(out?.results ?? [], q);
    if (res.ok && r?.position) {
      const name = r.poi?.name || (idx ? r.address?.municipality || r.address?.municipalitySubdivision : '') || r.address?.freeformAddress || q;
      return { name, lat: r.position.lat, lon: r.position.lon, named: true };
    }
  }
  throw new Error(`Could not find "${q}".`);
}

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371, d = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * d) / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(((b.lon - a.lon) * d) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/** A Google Maps link for the turns, for typed routes (a pasted link is handed back as it is). */
export function mapsUrlFor(stops: Stop[]): string {
  const dest = stops[stops.length - 1];
  const via = stops.slice(0, -1).slice(0, 9); // Google takes about 9 waypoints
  return `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}${via.length ? `&waypoints=${via.map((s) => `${s.lat},${s.lon}`).join('%7C')}` : ''}&travelmode=driving`;
}

export async function POST(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const key = env('TOMTOM_API_KEY');
  if (!key) return json({ error: 'routes are not set up (server has no TOMTOM_API_KEY)' }, 503);
  const body: any = await req.json().catch(() => null);
  const from = body?.from && Number.isFinite(body.from.lat) && Number.isFinite(body.from.lon) ? { lat: Number(body.from.lat), lon: Number(body.from.lon) } : null;
  const thrilling = body?.thrilling === true;
  try {
    let stops: Stop[] = [];
    let mapsUrl = '';
    if (typeof body?.link === 'string' && body.link.trim()) {
      const full = await resolveLink(body.link);
      stops = parseGoogleMapsDir(full);
      if (!stops.length) throw new Error('No stops in that link. Share the directions, not a single place.');
      mapsUrl = body.link.trim();
    } else if (Array.isArray(body?.stops)) {
      stops = body.stops.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, MAX_STOPS)
        .map((s: string) => { const c = s.match(COORD); return c ? { name: s, lat: Number(c[1]), lon: Number(c[2]), named: false } : { name: s, lat: NaN, lon: NaN, named: true }; });
      if (!stops.length) throw new Error('Where to? Type a place.');
    } else throw new Error('Where to? Type a place or paste a Google Maps link.');
    if (stops.length > MAX_STOPS) throw new Error(`That route has more than ${MAX_STOPS} stops.`);
    // One at a time, so each lookup is biased towards the stop before it.
    let near = from;
    for (let i = 0; i < stops.length; i++) {
      if (!Number.isFinite(stops[i].lat)) stops[i] = await geocode(stops[i].name, key, near, fetch);
      near = stops[i];
    }
    if (!mapsUrl) mapsUrl = mapsUrlFor(stops);
    // From where he is, unless he is already at the first stop.
    const locs = from && km(from, stops[0]) > 0.3 ? [from, ...stops] : stops;
    if (locs.length < 2) throw new Error('A route needs somewhere to go: add a second place.');
    const q = new URLSearchParams({ key, travelMode: 'motorcycle', traffic: 'true', routeType: thrilling ? 'thrilling' : 'fastest' });
    if (thrilling) { q.set('hilliness', 'normal'); q.set('windingness', 'high'); }
    const path = locs.map((l) => `${l.lat.toFixed(6)},${l.lon.toFixed(6)}`).join(':');
    const res = await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${path}/json?${q}`);
    const out: any = await res.json().catch(() => ({}));
    const route = out?.routes?.[0];
    if (!res.ok || !route) return json({ error: `TomTom could not plan it: ${out?.detailedError?.message ?? out?.error?.description ?? `HTTP ${res.status}`}` }, 502);
    const all: Array<[number, number]> = route.legs.flatMap((l: any) => l.points.map((p: any) => [Math.round(p.latitude * 1e5) / 1e5, Math.round(p.longitude * 1e5) / 1e5]));
    const step = Math.max(1, (all.length - 1) / (MAX_POINTS - 1));
    const points = all.length <= MAX_POINTS ? all : Array.from({ length: MAX_POINTS }, (_, i) => all[Math.round(i * step)]);
    const s = route.summary;
    const last = stops[stops.length - 1];
    const loop = stops.length > 1 && km(stops[0], last) < 0.3;
    return json({
      name: loop ? `Loop from ${stops[0].name}` : last.name,
      stops, km: Math.round(s.lengthInMeters / 100) / 10, minutes: Math.round(s.travelTimeInSeconds / 60),
      delayMin: Math.round((s.trafficDelayInSeconds ?? 0) / 60),
      legs: route.legs.map((l: any) => ({ km: Math.round(l.summary.lengthInMeters / 100) / 10, minutes: Math.round(l.summary.travelTimeInSeconds / 60) })),
      points, mapsUrl, thrilling,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
