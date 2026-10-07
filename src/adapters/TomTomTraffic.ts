import { haversineKm, bboxAround } from '../core/geo';
import { TrafficIncident } from '../core/types';
import { TrafficProvider } from './TrafficSource';

/**
 * TomTom Traffic Incident Details v5. Needs a free API key (VITE_TOMTOM_API_KEY).
 * Response shape taken from TomTom's docs; NOT yet exercised against the live API: check on first run.
 */
export class TomTomTrafficProvider implements TrafficProvider {
  constructor(private key: string) {}

  async fetchIncidents(lat: number, lon: number, radiusKm: number): Promise<TrafficIncident[]> {
    const b = bboxAround(lat, lon, radiusKm);
    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},from,to,roadNumbers}}}';
    const url = 'https://api.tomtom.com/traffic/services/5/incidentDetails'
      + `?key=${encodeURIComponent(this.key)}`
      + `&bbox=${b.minLon.toFixed(5)},${b.minLat.toFixed(5)},${b.maxLon.toFixed(5)},${b.maxLat.toFixed(5)}`
      + `&fields=${encodeURIComponent(fields)}&language=en-GB&timeValidityFilter=present`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TomTom HTTP ${res.status}`);
    const j = await res.json();
    const out: TrafficIncident[] = [];
    for (const inc of j.incidents ?? []) {
      const g = inc.geometry; const p = inc.properties ?? {};
      const pts: number[][] = g?.type === 'Point' ? [g.coordinates] : (g?.coordinates ?? []);
      if (!pts.length) continue;
      let best = Infinity, bl = lat, bo = lon;
      for (const [x, y] of pts) {
        const d = haversineKm({ lat, lon }, { lat: y, lon: x });
        if (d < best) { best = d; bl = y; bo = x; }
      }
      if (best > radiusKm) continue;
      out.push({
        id: String(p.id ?? `${bl},${bo}`),
        description: p.events?.[0]?.description ?? 'a traffic incident',
        roadName: p.roadNumbers?.[0] ?? p.from ?? undefined,
        severity: typeof p.magnitudeOfDelay === 'number' ? p.magnitudeOfDelay : 0,
        distanceKm: Math.round(best * 10) / 10,
        lat: bl, lon: bo,
      });
    }
    return out.sort((a, b2) => a.distanceKm - b2.distanceKm);
  }
}
