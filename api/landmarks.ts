import { fromBetty, json } from './_shared.js';

/**
 * GET /api/landmarks?tile=<lat>,<lon>&size=<deg>  (a tile's south-west corner; size 0.05 to 0.25, default 0.1)
 * -> {wd: [Wikidata rows], osm: [Overpass elements], osmFailed?: true}
 *
 * Landmarks he may ride past (owner, 2026-10-26: the Hartebeesthoek satellite dishes went unmentioned). Wikidata first
 * (every item with coordinates, with its types, English description and Wikipedia article: checked live, it has the
 * SANSA ground station, the HartRAO telescope and Gladysvale Cave), OpenStreetMap second (named things tagged as
 * telescopes, monuments, viewpoints, passes...). The public Overpass servers are often full (all four were busy on
 * 2026-10-26), so OSM is fail-soft: Wikidata alone still answers. The phone parses both (core/Landmarks) and keeps
 * the tile; the edge keeps it a week (a day when OSM failed, so it is asked again).
 */
const UA = 'Betty motorcycle co-pilot (https://github.com/nhlanhlacliq/betty)';
const OVERPASS = ['overpass-api.de', 'overpass.kumi.systems', 'overpass.private.coffee'];

const sparql = (s: number, w: number, n: number, e: number) => `SELECT ?p ?pLabel ?pDescription ?loc ?typeLabel ?article WHERE {
  SERVICE wikibase:box { ?p wdt:P625 ?loc. bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral. bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral. }
  OPTIONAL { ?p wdt:P31 ?type. }
  OPTIONAL { ?article schema:about ?p; schema:isPartOf <https://en.wikipedia.org/>. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 3000`;

const overpassQuery = (b: string) => `[out:json][timeout:20];(
nwr["man_made"~"^(telescope|satellite_dish|antenna|lighthouse|tower|dam|mineshaft|observatory|bridge)$"]["name"](${b});
nwr["tourism"~"^(attraction|viewpoint|museum|theme_park|zoo)$"]["name"](${b});
nwr["historic"]["name"](${b});
nwr["natural"~"^(peak|cave_entrance|cliff|gorge|valley)$"]["name"](${b});
nwr["waterway"="waterfall"]["name"](${b});
nwr["mountain_pass"="yes"]["name"](${b});
nwr["leisure"~"^(nature_reserve|stadium)$"]["name"](${b});
nwr["highway"="raceway"]["name"](${b});
);out center tags 400;`;

async function overpass(data: string): Promise<any[] | null> {
  for (const host of OVERPASS) {
    try {
      const res = await fetch(`https://${host}/api/interpreter`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
        body: `data=${encodeURIComponent(data)}`, signal: AbortSignal.timeout(8_000), // the public servers are often full: give up quickly, Wikidata still answers
      });
      if (res.ok) return (((await res.json()) as any).elements ?? []).map((x: any) => ({ type: x.type, id: x.id, lat: x.lat, lon: x.lon, center: x.center, tags: x.tags }));
    } catch { /* next mirror */ }
  }
  return null;
}

export async function GET(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const q = new URL(req.url).searchParams;
  const m = q.get('tile')?.match(/^(-?\d{1,2}(?:\.\d{1,3})?),(-?\d{1,3}(?:\.\d{1,3})?)$/);
  const size = Number(q.get('size') ?? 0.1);
  if (!m || !(size >= 0.05 && size <= 0.25)) return json({ error: 'bad tile' }, 400);
  const s = Number(m[1]), w = Number(m[2]);
  if (Math.abs(s) > 89 || Math.abs(w) > 179) return json({ error: 'bad tile' }, 400);
  const n = Math.round((s + size) * 1000) / 1000, e = Math.round((w + size) * 1000) / 1000;
  const wdAsk = fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql(s, w, n, e))}`, {
    headers: { accept: 'application/sparql-results+json', 'user-agent': UA }, signal: AbortSignal.timeout(25_000),
  }).then(async (r) => (r.ok ? (((await r.json()) as any).results?.bindings ?? []) : null)).catch(() => null);
  const [wdRows, osm] = await Promise.all([wdAsk, overpass(overpassQuery(`${s},${w},${n},${e}`))]);
  if (wdRows === null && osm === null) return json({ error: 'Wikidata and OpenStreetMap both failed' }, 502);
  // Only the fields the phone reads, and Wikidata items without an English name left out.
  const wd = (wdRows ?? []).filter((b: any) => b?.pLabel?.value && !/^Q\d+$/.test(b.pLabel.value))
    .map((b: any) => Object.fromEntries(['p', 'pLabel', 'pDescription', 'loc', 'typeLabel', 'article'].filter((k) => b[k]).map((k) => [k, { value: b[k].value }])));
  const partial = wdRows === null || osm === null;
  return new Response(JSON.stringify({ wd, osm: osm ?? [], ...(osm === null ? { osmFailed: true } : {}), ...(wdRows === null ? { wdFailed: true } : {}) }), {
    headers: { 'content-type': 'application/json', 'cache-control': partial ? 'public, s-maxage=86400' : 'public, s-maxage=604800, stale-while-revalidate=86400' },
  });
}
