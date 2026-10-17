import { fromBetty, json } from './_shared.js';

/**
 * GET /api/borders?tile=<lat>,<lon>  (a 0.1 degree tile, about 10 km; its south-west corner)
 * -> {suburbs: [{name, lat, lon}], metro: [[[lat, lon], ...], ...]}
 *
 * For the map's optional suburb borders (owner, 2026-10-17, "like the Property24 map", off by default). OpenStreetMap
 * has no suburb boundaries around Gauteng, only suburb CENTRE points (26 around Edenvale) and council wards; the metro
 * boundaries (admin_level 6) are real. So the page draws ESTIMATED borders between the centres and the real metro line.
 * Overpass, cached at Vercel's edge for a week (the data hardly changes), identifying User-Agent.
 */
/** 0.1 degree (~10 km): each Overpass call takes ~20 s, so few, larger tiles (0.05 needed ~16 for one view). */
const TILE = 0.1;
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

export async function GET(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const m = new URL(req.url).searchParams.get('tile')?.match(/^(-?\d{1,2}\.\d{2}),(-?\d{1,3}\.\d{2})$/);
  if (!m) return json({ error: 'bad tile' }, 400);
  const s = Number(m[1]), w = Number(m[2]);
  if (Math.abs((s / TILE) - Math.round(s / TILE)) > 1e-6 || Math.abs((w / TILE) - Math.round(w / TILE)) > 1e-6) return json({ error: 'bad tile' }, 400);
  const n = s + TILE, e = w + TILE;
  const bbox = `${s},${w},${n},${e}`;
  // One query: the suburb points, then the metro boundary ways crossing the tile (with geometry). The public Overpass
  // servers are shared and slow (18 s, then HTTP 429 when two went at once, 2026-10-17): one request per tile, a
  // mirror when the main one is busy, a week at the edge, and the page keeps tiles for good.
  const data = `[out:json][timeout:25];node["place"~"^(suburb|neighbourhood|quarter)$"]["name"](${bbox});out;relation["boundary"="administrative"]["admin_level"="6"](${bbox});way(r)(${bbox});out geom;`;
  const ask = (host: string) => fetch(`https://${host}/api/interpreter`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Betty motorcycle co-pilot (https://github.com/nhlanhlacliq/betty)' },
    body: `data=${encodeURIComponent(data)}`,
  });
  try {
    let res = await ask('overpass-api.de');
    if (!res.ok) res = await ask('overpass.kumi.systems');
    if (!res.ok) return json({ error: `map data service said HTTP ${res.status}` }, 502);
    const all: any[] = ((await res.json()) as any).elements ?? [];
    const a = { elements: all.filter((x) => x.type === 'node') }, b = { elements: all.filter((x) => x.type === 'way') };
    const suburbs = (a.elements ?? []).filter((x: any) => x.tags?.name && !/\bward\b/i.test(x.tags.name))
      .map((x: any) => ({ name: String(x.tags.name), lat: r5(x.lat), lon: r5(x.lon) }));
    // Each boundary way, cut to the tile (with a little margin) and thinned to a point every ~40 m.
    const inside = (p: any) => p.lat >= s - 0.01 && p.lat <= n + 0.01 && p.lon >= w - 0.01 && p.lon <= e + 0.01;
    const lines: Array<Array<[number, number]>> = [];
    for (const way of b.elements ?? []) {
      let cur: Array<[number, number]> = [];
      for (const p of way.geometry ?? []) {
        if (!inside(p)) { if (cur.length > 1) lines.push(cur); cur = []; continue; }
        const last = cur[cur.length - 1];
        if (!last || Math.abs(last[0] - p.lat) + Math.abs(last[1] - p.lon) > 0.0004) cur.push([r5(p.lat), r5(p.lon)]);
      }
      if (cur.length > 1) lines.push(cur);
    }
    return new Response(JSON.stringify({ suburbs, metro: lines }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=604800, stale-while-revalidate=86400' },
    });
  } catch (err) {
    return json({ error: `map data service failed: ${(err as Error).message}` }, 502);
  }
}
