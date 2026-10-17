import { fromBetty, json } from './_shared.js';

/**
 * GET /api/area?lat=&lon= -> the suburb and town the rider is in (OpenStreetMap Nominatim reverse geocoding).
 * Nominatim's policy: at most 1 request a second, an identifying User-Agent, cache the results. The page asks a few
 * times a ride with coordinates rounded to about 1 km, and the answer is cached at Vercel's edge for a day.
 */
export async function GET(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const u = new URL(req.url);
  // GET /api/area?q=<area, region> -> {lat, lon}: where an area is, for areas Explore's map has no position for yet
  // (found before positions were kept, 2026-10-17). Nominatim search, South Africa only, cached a week.
  const q = u.searchParams.get('q')?.trim();
  if (q) {
    if (q.length > 120) return json({ error: 'too long' }, 400);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=za&q=${encodeURIComponent(q)}`, {
      headers: { 'user-agent': 'Betty motorcycle co-pilot (https://github.com/nhlanhlacliq/betty)', 'accept-language': 'en' },
    });
    if (!res.ok) return json({ error: `map service said HTTP ${res.status}` }, 502);
    const hit: any = ((await res.json().catch(() => [])) as any[])[0];
    if (!hit) return json({ error: 'not found' }, 404);
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    return new Response(JSON.stringify({ lat: r3(Number(hit.lat)), lon: r3(Number(hit.lon)) }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=604800' },
    });
  }
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
