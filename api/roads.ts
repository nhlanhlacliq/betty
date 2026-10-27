import { fromBetty, json } from './_shared.js';

/**
 * GET /api/roads?tile=<lat>,<lon>&size=<deg>  (a tile's south-west corner; size 0.01 to 0.05, default 0.02)
 * -> {ways: [[id, oneway, name, [dLat, dLon, dLat, dLon, ...]]]}
 *
 * The roads in one small square, from OpenStreetMap, so the phone can follow the road he is on (core/PathAhead,
 * owner 2026-10-27). Compact: coordinates as integers of 1e-5 degrees (about a metre), each the change from the one
 * before; oneway 1 (in that order), -1 (the reverse), 0. Shared points are exactly equal, which is how the phone
 * finds the junctions. Only roads a motorcycle uses (tracks included: he rides gravel). The edge keeps a tile a month.
 */
const UA = 'Betty motorcycle co-pilot (https://github.com/nhlanhlacliq/betty)';
const OVERPASS = ['overpass-api.de', 'overpass.kumi.systems', 'overpass.private.coffee'];
const KINDS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track|road';

async function overpass(data: string): Promise<any[] | null> {
  for (const host of OVERPASS) {
    try {
      const res = await fetch(`https://${host}/api/interpreter`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
        body: `data=${encodeURIComponent(data)}`, signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) return (((await res.json()) as any).elements ?? []);
    } catch { /* next mirror */ }
  }
  return null;
}

const ONEWAY_FWD = /^(yes|true|1)$/i;
export function packWays(elements: any[]): Array<[number, number, string, number[]]> {
  const out: Array<[number, number, string, number[]]> = [];
  for (const e of elements) {
    if (e?.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 2) continue;
    const t = e.tags ?? {};
    const oneway = t.oneway === '-1' ? -1 : ONEWAY_FWD.test(t.oneway ?? '') || t.junction === 'roundabout' || t.highway === 'motorway' ? 1 : 0;
    const d: number[] = [];
    let lat = 0, lon = 0;
    for (const g of e.geometry) {
      const a = Math.round(g.lat * 1e5), b = Math.round(g.lon * 1e5);
      d.push(a - lat, b - lon); lat = a; lon = b;
    }
    out.push([Number(e.id), oneway, String(t.ref ?? t.name ?? '').slice(0, 60), d]); // the id: a road crossing a tile edge is in both tiles
  }
  return out;
}

export async function GET(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const q = new URL(req.url).searchParams;
  const m = q.get('tile')?.match(/^(-?\d{1,2}(?:\.\d{1,3})?),(-?\d{1,3}(?:\.\d{1,3})?)$/);
  const size = Number(q.get('size') ?? 0.02);
  if (!m || !(size >= 0.01 && size <= 0.05)) return json({ error: 'bad tile' }, 400);
  const s = Number(m[1]), w = Number(m[2]);
  if (Math.abs(s) > 89 || Math.abs(w) > 179) return json({ error: 'bad tile' }, 400);
  const n = Math.round((s + size) * 1000) / 1000, e = Math.round((w + size) * 1000) / 1000;
  const els = await overpass(`[out:json][timeout:25];way["highway"~"^(${KINDS})$"](${s},${w},${n},${e});out tags geom qt;`);
  if (els === null) return json({ error: 'OpenStreetMap is busy, try again later' }, 502);
  return new Response(JSON.stringify({ ways: packWays(els) }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=2592000, stale-while-revalidate=604800' },
  });
}
