import { haversineKm, bboxAround } from '../core/geo';
import { TrafficIncident } from '../core/types';
import { TrafficProvider } from './TrafficSource';

/** TomTom says "Closed", "Slow traffic", "Stationary traffic"; Betty needs something she can say mid-sentence. */
const phrase = (d: string) => {
  const t = d.trim();
  if (!t) return 'a traffic incident';
  if (/^closed$/i.test(t)) return 'a road closure';
  return t[0].toLowerCase() + t.slice(1);
};

/** Turns a TomTom incidentDetails v5 response into incidents within radiusKm, nearest first, without duplicates. */
export function parseTomTom(j: any, lat: number, lon: number, radiusKm: number): TrafficIncident[] {
  const out: TrafficIncident[] = [];
  const seen = new Set<string>();
  for (const inc of j?.incidents ?? []) {
    const g = inc.geometry; const p = inc.properties ?? {};
    const pts: number[][] = g?.type === 'Point' ? [g.coordinates] : (g?.coordinates ?? []);
    if (!pts.length) continue;
    let best = Infinity, bl = lat, bo = lon;
    for (const [x, y] of pts) {
      const d = haversineKm({ lat, lon }, { lat: y, lon: x });
      if (d < best) { best = d; bl = y; bo = x; }
    }
    if (best > radiusKm) continue;
    const description = phrase(String(p.events?.[0]?.description ?? ''));
    // The same closure is reported once per direction: keep one.
    const ends = [p.from, p.to].filter(Boolean).map(String).sort().join('|');
    const key = ends ? `${description}|${ends}` : String(p.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: String(p.id ?? `${bl},${bo}`),
      description,
      roadName: p.roadNumbers?.[0] ?? p.from ?? undefined,
      severity: typeof p.magnitudeOfDelay === 'number' ? p.magnitudeOfDelay : 0,
      distanceKm: Math.round(best * 10) / 10,
      lat: bl, lon: bo,
      delaySec: typeof p.delay === 'number' ? p.delay : null,
      lengthM: typeof p.length === 'number' ? Math.round(p.length) : null,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * TomTom Traffic Incident Details v5. Needs a free API key (VITE_TOMTOM_API_KEY).
 * Checked against the live API for Gauteng on 2026-10-09: the response matches this parser.
 */
export class TomTomTrafficProvider implements TrafficProvider {
  constructor(private key: string) {}

  async fetchIncidents(lat: number, lon: number, radiusKm: number): Promise<TrafficIncident[]> {
    const b = bboxAround(lat, lon, radiusKm);
    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},from,to,roadNumbers,delay,length}}}';
    const url = 'https://api.tomtom.com/traffic/services/5/incidentDetails'
      + `?key=${encodeURIComponent(this.key)}`
      + `&bbox=${b.minLon.toFixed(5)},${b.minLat.toFixed(5)},${b.maxLon.toFixed(5)},${b.maxLat.toFixed(5)}`
      + `&fields=${encodeURIComponent(fields)}&language=en-GB&timeValidityFilter=present`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TomTom HTTP ${res.status}`);
    return parseTomTom(await res.json(), lat, lon, radiusKm);
  }
}
