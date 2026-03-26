import { BikeState, TrafficIncident } from '../models/BikeState';

const TOMTOM_BASE = 'https://api.tomtom.com/traffic/services/5/incidentDetails';
const RADIUS_METERS = 5000; // 5 km

/**
 * Fetches nearby traffic incidents via TomTom Traffic Incidents API.
 * Updates every 5 minutes while riding.
 */
export class TrafficAPIClient {
  private apiKey: string;
  private lastFetch = 0;
  private readonly FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 min

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetch(lat: number, lon: number): Promise<Partial<BikeState>> {
    const now = Date.now();
    if (now - this.lastFetch < this.FETCH_INTERVAL_MS) {
      return {};
    }

    try {
      const bbox = this.boundingBox(lat, lon, RADIUS_METERS);
      const url =
        `${TOMTOM_BASE}/s3/${bbox}/10/1335/json` +
        `?key=${this.apiKey}&projection=EPSG4326&expandCluster=true`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Traffic API error: ${response.status}`);
      }

      const data = await response.json();
      this.lastFetch = now;

      const incidents: TrafficIncident[] = (data.incidents ?? [])
        .slice(0, 10)
        .map((inc: Record<string, unknown>, idx: number) => {
          const props = (inc.properties ?? {}) as Record<string, unknown>;
          const geo = (inc.geometry ?? {}) as Record<string, unknown>;
          const coords = (geo.coordinates ?? [0, 0]) as number[];
          return {
            id: String(props.id ?? idx),
            type: String(props.iconCategory ?? 'Unknown'),
            description: String(props.events?.[0]?.description ?? 'Traffic incident'),
            distanceKm: haversineKm(lat, lon, coords[1] ?? lat, coords[0] ?? lon),
            lat: coords[1] ?? lat,
            lon: coords[0] ?? lon,
          } satisfies TrafficIncident;
        })
        .filter((inc: TrafficIncident) => inc.distanceKm <= 5);

      return { trafficIncidents: incidents };
    } catch (err) {
      console.warn('[TrafficAPI] Fetch failed:', err);
      return {};
    }
  }

  private boundingBox(lat: number, lon: number, radiusM: number): string {
    const deltaLat = (radiusM / 111_000);
    const deltaLon = (radiusM / (111_000 * Math.cos((lat * Math.PI) / 180)));
    return [
      lon - deltaLon,
      lat - deltaLat,
      lon + deltaLon,
      lat + deltaLat,
    ]
      .map((v) => v.toFixed(6))
      .join(',');
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
