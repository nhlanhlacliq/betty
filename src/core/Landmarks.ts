/**
 * Landmarks he rides past (owner, 2026-10-26: rode past the Hartebeesthoek satellite dishes "and she said nothing").
 * Wikipedia articles near him (PlaceSource) miss things that have no long article. These come from Wikidata (every item
 * with coordinates has a type: "ground station", "radio telescope", "school") and OpenStreetMap (tags: man_made=
 * telescope, historic=monument...). The TYPE is what lets her pick a satellite array over a farm school.
 * Pure: parsing, scoring and "passing it now". The rules (what counts as interesting, how near) are CONFIG.landmarks.
 */
import { CONFIG } from '../config/betty';
import { angleDiff, bearingDeg, haversineKm, LatLon, relativeDirection } from './geo';

export interface Landmark {
  /** Wikidata Q-id, or osm:<type>/<id> */
  id: string;
  name: string;
  /** What it is, in words: Wikidata types ("ground station") or OSM tag values ("telescope", "viewpoint") */
  kinds: string[];
  lat: number;
  lon: number;
  /** Wikidata's one-line description */
  about?: string;
  /** Its English Wikipedia article title, if there is one */
  wiki?: string;
  /** Researched notes (api/story, kind landmark), once he has come near it */
  notes?: string[];
}

export type LandmarkRules = typeof CONFIG.landmarks;

const rxCache = new Map<string, RegExp>();
const rx = (p: string) => { let r = rxCache.get(p); if (!r) { r = new RegExp(p, 'i'); rxCache.set(p, r); } return r; };

/** How interesting it is: the best weight of the rules its kinds (or name) match; 0 when a skip rule matches or none do. */
export function interest(l: Landmark, rules: LandmarkRules = CONFIG.landmarks): number {
  const words = [...l.kinds, l.about ?? ''].join(' | ');
  if (rules.skip.some((p) => rx(p).test(words)) && !rules.kinds.some((k) => k.weight >= 3 && rx(k.pattern).test(words))) return 0;
  let best = 0;
  for (const k of rules.kinds) if (k.weight > best && (rx(k.pattern).test(words) || rx(k.pattern).test(l.name))) best = k.weight;
  return best;
}

export interface Passing { landmark: Landmark; km: number; side: string | null; score: number; also?: Landmark[] }

/** The other worthwhile things at the same site (within rules.clusterKm): told together, counted as told together. */
export function sameSite(p: Passing, list: Landmark[], rules: LandmarkRules = CONFIG.landmarks): Landmark[] {
  return list.filter((l) => l.id !== p.landmark.id && interest(l, rules) >= rules.minWeight && haversineKm(p.landmark, l) <= rules.clusterKm);
}

/**
 * The landmark he is passing NOW: within rules.hereKm, not behind him (within rules.aheadDeg of his course, when he
 * has one), not told recently; the most interesting, nearest first. Null when there is none.
 */
export function passingNow(list: Landmark[], pos: LatLon, headingDeg: number | null, toldAt: (id: string) => number | undefined, now: number, rules: LandmarkRules = CONFIG.landmarks): Passing | null {
  let best: Passing | null = null;
  for (const l of list) {
    const score0 = interest(l, rules);
    if (score0 < rules.minWeight) continue;
    const at = toldAt(l.id);
    if (at !== undefined && now - at < rules.retellDays * 86_400_000) continue;
    const km = haversineKm(pos, l);
    if (km > rules.hereKm) continue;
    const bearing = bearingDeg(pos, l);
    if (headingDeg !== null && km > 0.15 && Math.abs(angleDiff(headingDeg, bearing)) > rules.aheadDeg) continue;
    const score = score0 / (0.3 + km);
    if (!best || score > best.score) best = { landmark: l, km, side: headingDeg === null ? null : relativeDirection(headingDeg, bearing), score };
  }
  return best;
}

/** Worth researching (api/story) ahead of time: interesting enough and within rules.researchKm. */
export function toResearch(list: Landmark[], pos: LatLon, rules: LandmarkRules = CONFIG.landmarks): Landmark[] {
  return list.filter((l) => !l.notes && interest(l, rules) >= rules.researchFrom && haversineKm(pos, l) <= rules.researchKm)
    .sort((a, b) => haversineKm(pos, a) - haversineKm(pos, b));
}

/** The tile a point is in (its south-west corner), and the tiles around it, rules.tileDeg on a side. */
export function tileOf(p: LatLon, size = CONFIG.landmarks.tileDeg): { lat: number; lon: number } {
  const f = (n: number) => Math.round(Math.floor(n / size) * size * 1000) / 1000;
  return { lat: f(p.lat), lon: f(p.lon) };
}
export function tilesNear(p: LatLon, size = CONFIG.landmarks.tileDeg): Array<{ lat: number; lon: number }> {
  const t = tileOf(p, size), out: Array<{ lat: number; lon: number }> = [];
  // the neighbours he may reach within hereKm of an edge: the tile itself plus any whose edge is close
  const near = CONFIG.landmarks.hereKm / 111 + 0.005;
  for (const dLat of [-1, 0, 1]) for (const dLon of [-1, 0, 1]) {
    const c = { lat: Math.round((t.lat + dLat * size) * 1000) / 1000, lon: Math.round((t.lon + dLon * size) * 1000) / 1000 };
    const inLat = p.lat >= c.lat - near && p.lat <= c.lat + size + near;
    const inLon = p.lon >= c.lon - near && p.lon <= c.lon + size + near;
    if (inLat && inLon) out.push(c);
  }
  return out;
}

/** Wikidata SPARQL rows (?p ?pLabel ?pDescription ?loc ?typeLabel ?article) -> landmarks, one per item. */
export function parseWikidata(json: any): Landmark[] {
  const rows: any[] = json?.results?.bindings ?? [];
  const byId = new Map<string, Landmark>();
  for (const b of rows) {
    const v = (k: string): string => b?.[k]?.value ?? '';
    const id = v('p').split('/').pop() ?? '';
    const name = v('pLabel');
    const m = v('loc').match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (!id || !m || !name || /^Q\d+$/.test(name)) continue; // no English label: nothing she could say
    let l = byId.get(id);
    if (!l) {
      l = { id, name, kinds: [], lat: Number(m[2]), lon: Number(m[1]) };
      const about = v('pDescription'); if (about) l.about = about;
      const wiki = v('article'); if (wiki) l.wiki = decodeURIComponent(wiki.split('/wiki/')[1] ?? '').replace(/_/g, ' ');
      byId.set(id, l);
    }
    const kind = v('typeLabel');
    if (kind && !/^Q\d+$/.test(kind) && !l.kinds.includes(kind)) l.kinds.push(kind);
  }
  return [...byId.values()];
}

/** The OSM tags that say what a thing is, in words ("man_made=telescope" -> "telescope"). */
const OSM_KEYS = ['man_made', 'tourism', 'historic', 'natural', 'waterway', 'leisure', 'mountain_pass', 'building', 'amenity'];
/** Overpass elements (out center tags) -> landmarks. An element with a wikidata tag keeps the Q-id, so it merges. */
export function parseOverpass(json: any): Landmark[] {
  const out: Landmark[] = [];
  for (const e of json?.elements ?? []) {
    const t = e?.tags ?? {};
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (!t.name || lat == null || lon == null) continue;
    const kinds = OSM_KEYS.filter((k) => t[k] && t[k] !== 'no').map((k) => (t[k] === 'yes' ? k : String(t[k])).replace(/_/g, ' '));
    out.push({ id: t.wikidata || `osm:${e.type}/${e.id}`, name: t['name:en'] || t.name, kinds, lat, lon, ...(t.description ? { about: String(t.description).slice(0, 200) } : {}) });
  }
  return out;
}

/** One entry per thing: same id, or the same name within 300 m (Wikidata's facts win, OSM's kinds are added). */
export function mergeLandmarks(...lists: Landmark[][]): Landmark[] {
  const out: Landmark[] = [];
  for (const list of lists) for (const l of list) {
    const twin = out.find((o) => o.id === l.id || (o.name.toLowerCase() === l.name.toLowerCase() && haversineKm(o, l) < 0.3));
    if (!twin) { out.push({ ...l, kinds: [...l.kinds] }); continue; }
    for (const k of l.kinds) if (!twin.kinds.includes(k)) twin.kinds.push(k);
    twin.about ??= l.about; twin.wiki ??= l.wiki;
  }
  return out;
}

/** Her context for passing it: what it is, where, and what is known (notes, else the one-line description). */
export function landmarkContext(p: Passing): string {
  const l = p.landmark;
  const what = l.kinds.slice(0, 3).join(', ');
  const where = p.side ? `, ${p.side}` : '';
  const facts = l.notes?.length ? `Notes on it: ${l.notes.join(' ')}` : l.about ? `What is known about it: ${l.about}.` : 'Nothing more is known about it than its name and what it is.';
  const also = p.also?.length ? ` Also at the same site: ${p.also.slice(0, 3).map((a) => `${a.name}${a.kinds[0] ? ` (${a.kinds[0]})` : ''}`).join(', ')}.` : '';
  return `He is passing ${l.name}${what ? ` (${what})` : ''}, about ${p.km < 1 ? `${Math.max(100, Math.round(p.km * 10) * 100)} metres` : `${p.km.toFixed(1)} km`} away${where}.${also} ${facts}`;
}
