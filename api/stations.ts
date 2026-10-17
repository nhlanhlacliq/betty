import { env, fromBetty, json } from './_shared.js';

/**
 * GET /api/stations?lat=&lon= -> [{name, brand, area, lat, lon}]: petrol stations within 50 km, nearest first (TomTom
 * Search, category 7311; checked live near Heidelberg 2026-10-17: Engen, Sasol, Caltex, TotalEnergies...). Coordinates
 * are rounded to 2 decimals (about 1 km) and the answer is cached at the edge for a day. Search: 2,500 free a month;
 * the page asks only when fuel is low or he asks, and again after 10 km.
 */
export async function GET(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const key = env('TOMTOM_API_KEY');
  if (!key) return json({ error: 'server has no TOMTOM_API_KEY' }, 503);
  const q = new URL(req.url).searchParams;
  const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'lat and lon please' }, 400);
  const url = 'https://api.tomtom.com/search/2/nearbySearch/.json'
    + `?key=${encodeURIComponent(key)}&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&radius=50000&limit=100&categorySet=7311`;
  const res = await fetch(url);
  if (!res.ok) return json({ error: `TomTom said HTTP ${res.status}` }, 502);
  const out: any = await res.json().catch(() => ({}));
  const list = (out?.results ?? []).filter((r: any) => r?.position && r?.poi?.name).map((r: any) => ({
    name: String(r.poi.name),
    brand: r.poi.brands?.[0]?.name ? String(r.poi.brands[0].name) : null,
    area: r.address?.municipalitySubdivision || r.address?.municipality || null,
    lat: Number(r.position.lat), lon: Number(r.position.lon),
  }));
  return new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=86400' } });
}
