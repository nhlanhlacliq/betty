import { env, fromBetty, json } from './_shared.js';

const FIELDS = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},from,to,roadNumbers,delay,length}}}';
/** Largest area the page may ask about, in degrees (about 55 km across): a few km around the rider is normal. */
const MAX_SPAN_DEG = 0.5;

/** GET /api/traffic?bbox=minLon,minLat,maxLon,maxLat: TomTom incidents in that box, with the key added here. */
export async function GET(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const key = env('TOMTOM_API_KEY');
  if (!key) return json({ error: 'server has no TOMTOM_API_KEY' }, 503);
  const b = (new URL(req.url).searchParams.get('bbox') ?? '').split(',').map(Number);
  const [minLon, minLat, maxLon, maxLat] = b;
  if (b.length !== 4 || b.some((n) => !Number.isFinite(n)) || maxLon <= minLon || maxLat <= minLat
    || maxLon - minLon > MAX_SPAN_DEG || maxLat - minLat > MAX_SPAN_DEG) {
    return json({ error: 'bbox must be minLon,minLat,maxLon,maxLat and at most 0.5 degrees across' }, 400);
  }
  const url = 'https://api.tomtom.com/traffic/services/5/incidentDetails'
    + `?key=${encodeURIComponent(key)}&bbox=${b.map((n) => n.toFixed(5)).join(',')}`
    + `&fields=${encodeURIComponent(FIELDS)}&language=en-GB&timeValidityFilter=present`;
  const res = await fetch(url);
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
}
