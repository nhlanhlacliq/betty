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

/** Initial compass bearing from a to b, 0-360 clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLon = (b.lon - a.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Signed smallest turn from a to b in degrees, -180..180 (positive = clockwise, i.e. to the right). */
export const angleDiff = (a: number, b: number) => ((b - a + 540) % 360) - 180;

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassPoint = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const SIDES = ['ahead', 'ahead on his right', 'on his right', 'behind him on the right', 'behind him', 'behind him on the left', 'on his left', 'ahead on his left'];
/** Where something lies for a rider travelling on headingDeg, given the bearing to it. */
export const relativeDirection = (headingDeg: number, bearingToIt: number) =>
  SIDES[Math.round((((bearingToIt - headingDeg) % 360) + 360) % 360 / 45) % 8];
