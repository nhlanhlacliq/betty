export interface LatLon { lat: number; lon: number }

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bboxAround(lat: number, lon: number, radiusKm: number) {
  const dLat = radiusKm / 111.2;
  const dLon = radiusKm / (111.2 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}
