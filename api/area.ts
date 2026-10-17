import { fromBetty, json } from './_shared.js';

/**
 * GET /api/area?lat=&lon= -> the suburb and town the rider is in (OpenStreetMap Nominatim reverse geocoding).
 * Nominatim's policy: at most 1 request a second, an identifying User-Agent, cache the results. The page asks a few
 * times a ride with coordinates rounded to about 1 km, and the answer is cached at Vercel's edge for a day.
 */
export async function GET(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'bad position' }, 400);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=16&lat=${r2(lat)}&lon=${r2(lon)}`, {
    headers: { 'user-agent': 'Betty motorcycle co-pilot (https://github.com/nhlanhlacliq/betty)', 'accept-language': 'en' },
  });
  if (!res.ok) return json({ error: `map service said HTTP ${res.status}` }, 502);
  const a: any = (await res.json().catch(() => ({})))?.address ?? {};
  // Zoom 14 gave only council wards in the metros (2026-10-16); 16 gives suburbs (Elmapark, Senaoane) and the city.
  const notWard = (x: unknown) => (typeof x === 'string' && x && !/\bward\s*\d+/i.test(x) ? x : null);
  // "City of Johannesburg Metropolitan Municipality" -> "Johannesburg", "Westonaria Local Municipality" -> "Westonaria"
  // (read out as place names on the ride of 2026-10-17).
  const plain = (x: unknown) => (typeof x === 'string' ? x.replace(/^City of\s+/i, '').replace(/\s+(Metropolitan|Local|District)\s+Municipality$/i, '').trim() : null);
  const metro = plain(a.county);
  const town = plain(notWard(a.city) || notWard(a.town) || notWard(a.village) || notWard(a.municipality) || notWard(metro)) || null;
  const suburb = notWard(a.suburb) || notWard(a.neighbourhood) || notWard(a.quarter) || null;
  return new Response(JSON.stringify({ suburb: suburb !== town ? suburb : null, town, region: a.state || null, country: a.country || null }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=86400' },
  });
}
