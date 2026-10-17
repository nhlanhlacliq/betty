import { LatLon, angleDiff, bearingDeg, haversineKm } from './geo';
import { PlannedRoute, RouteProgress, projectOnRoute, stopsAhead } from './Route';

/**
 * Fuel without a fuel sensor (owner, 2026-10-17): range from the tank and his dash's average consumption instead of a
 * guessed km figure, petrol stations ahead when it gets low, and what each ride cost. Pure, so it is tested.
 * His G 310 GS: 11 L tank of which 1 L is reserve, 4.4 L/100 km on the dash, petrol at R30.25 a litre (his figures).
 */
export interface FuelSetup {
  tankL: number;
  reserveL: number;
  /** The dash's average consumption */
  lPer100: number;
  /** Warn this many km before reserve */
  warnKmLeft: number;
  /** Rand per litre */
  pricePerL: number;
  /** 'manual' = his figure (wins until the next monthly price change), 'auto' = looked up by web search */
  priceSource: 'manual' | 'auto';
  /** When the price was set (ms) */
  priceAt: number;
}

const usable = (f: FuelSetup) => Math.max(0, f.tankL - f.reserveL);
const per100 = (f: FuelSetup) => Math.max(0.5, f.lPer100);
/** Km from a full tank until the reserve starts (10 L at 4.4 L/100 km = 227 km). */
export const kmToReserve = (f: FuelSetup) => (usable(f) / per100(f)) * 100;
/** Km the reserve itself lasts (1 L = 23 km). */
export const reserveKm = (f: FuelSetup) => (Math.max(0, f.reserveL) / per100(f)) * 100;
export const litresFor = (km: number, f: FuelSetup) => (km * per100(f)) / 100;
export const costOf = (km: number, f: FuelSetup) => Math.round(litresFor(km, f) * f.pricePerL);

/** What is left after riding `kmSinceFill` on a full tank. */
export function fuelLeft(kmSinceFill: number, f: FuelSetup) {
  const litres = Math.max(0, f.tankL - litresFor(kmSinceFill, f));
  const toReserve = kmToReserve(f) - kmSinceFill;
  return {
    litres: Math.round(litres * 10) / 10,
    /** Km before the reserve starts (0 once on it) */
    kmToReserve: Math.max(0, Math.round(toReserve)),
    /** Km until empty */
    kmToEmpty: Math.max(0, Math.round(kmToReserve(f) + reserveKm(f) - kmSinceFill)),
    onReserve: toReserve <= 0,
  };
}

/**
 * South Africa's fuel prices change on the first Wednesday of the month. A price set before this month's change is
 * out of date (his own figure included: it wins only until the next change).
 */
export function firstWednesday(year: number, month: number): number {
  const d = new Date(year, month, 1);
  d.setDate(1 + ((3 - d.getDay() + 7) % 7));
  return d.getTime();
}
export function lastPriceChange(now: number): number {
  const d = new Date(now);
  const thisMonth = firstWednesday(d.getFullYear(), d.getMonth());
  return thisMonth <= now ? thisMonth : firstWednesday(d.getFullYear(), d.getMonth() - 1);
}
export const priceDue = (f: FuelSetup, now: number) => f.priceAt < lastPriceChange(now);

/** The price from a reply to the monthly lookup: the first rand figure that looks like a litre of petrol. */
export function parsePrice(reply: string): number | null {
  for (const m of reply.replace(/,(\d{2})\b/g, '.$1').matchAll(/(\d{1,2}\.\d{1,2})/g)) {
    const v = Number(m[1]);
    if (v >= 10 && v <= 80) return Math.round(v * 100) / 100;
  }
  return null;
}

/** A petrol station from TomTom's search (api/stations.ts). */
export interface Station { name: string; brand: string | null; area: string | null; lat: number; lon: number }
export interface StationAhead { name: string; area: string | null; km: number }

/** Straight lines are shorter than roads: a rough allowance when there is no route to measure along. */
const ROAD_FACTOR = 1.25;
const AHEAD_DEG = 60;
/** On the route = within this of its line. */
const ON_ROUTE_KM = 1.5;

/**
 * The stations ahead of him, nearest first. With a planned route: the ones on it (within 1.5 km of the line), by
 * distance along it. Without one: the ones roughly in the direction he is going (any, when there is no heading), by
 * straight-line distance with a road allowance. Branded stations go before a nameless one only a little nearer.
 */
export function stationsAhead(list: Station[], here: LatLon, headingDeg: number | null, route?: PlannedRoute | null, p?: RouteProgress | null): StationAhead[] {
  const out: Array<StationAhead & { branded: boolean }> = [];
  for (const st of list) {
    let km: number | null = null;
    if (route && p) {
      const on = projectOnRoute(route, st, p.index);
      if (on && on.offKm <= ON_ROUTE_KM && on.km > p.doneKm) km = on.km - p.doneKm + on.offKm;
    } else {
      const straight = haversineKm(here, st);
      if (headingDeg == null || straight < 0.5 || Math.abs(angleDiff(headingDeg, bearingDeg(here, st))) <= AHEAD_DEG) km = straight * ROAD_FACTOR;
    }
    if (km != null) out.push({ name: st.brand || st.name, area: st.area, km: Math.round(km * 10) / 10, branded: !!st.brand });
  }
  out.sort((a, b) => a.km - b.km);
  // A known brand within 2 km of the nearest goes first (nameless "gas stations" are sometimes gas, or gone).
  const firstBrand = out.findIndex((x) => x.branded);
  if (firstBrand > 0 && out[firstBrand].km - out[0].km <= 2) out.unshift(...out.splice(firstBrand, 1));
  return out.map(({ branded: _, ...x }) => x);
}

/** "Engen in Heidelberg in about 14 km; after that the next is 64 km." for her lines, with whether he makes it. */
export function describeStations(ahead: StationAhead[], kmToEmpty: number): string {
  if (!ahead.length) return `No petrol station found ahead within about 50 km; he has about ${kmToEmpty} km until empty.`;
  const where = (x: StationAhead) => `${x.name}${x.area ? ` in ${x.area}` : ''}, about ${Math.round(x.km)} km ahead`;
  const first = ahead[0];
  const after = ahead.find((x) => x.km > first.km + 5);
  const reach = first.km < kmToEmpty - 10 ? 'he makes it comfortably' : first.km < kmToEmpty ? 'he should just make it' : 'it is further than his fuel by this estimate';
  return `Petrol stations ahead: ${where(first)} (${reach})${after ? `; after that the next is ${Math.round(after.km)} km` : '; nothing else found within about 50 km'}.`;
}

/** Whether a planned route fits in the fuel he has, and where to fill up if not (the last named stop before reserve). */
export function routeFuelPlan(route: PlannedRoute, f: FuelSetup, kmSinceFill: number | null) {
  const range = kmSinceFill == null ? kmToReserve(f) : fuelLeft(kmSinceFill, f).kmToReserve;
  const fits = route.km <= range;
  const start = { index: -1, doneKm: 0 } as RouteProgress;
  const before = stopsAhead(route, start).filter((s) => s.km <= range - 10).pop() ?? null;
  return { fits, rangeKm: Math.round(range), routeKm: Math.round(route.km), stopBy: fits ? null : before, fullTank: kmSinceFill == null };
}

/** The plan in words, for the route sheet and her briefing. */
export function describeFuelPlan(plan: ReturnType<typeof routeFuelPlan>): string {
  const range = `${plan.rangeKm} km before reserve${plan.fullTank ? ' on a full tank' : ''}`;
  if (plan.fits) return `Fits in the tank: ${plan.routeKm} km, with ${range}.`;
  return `Needs a fuel stop: ${plan.routeKm} km, with ${range}. ${plan.stopBy ? `Fill up by ${plan.stopBy.name} (${Math.round(plan.stopBy.km)} km in).` : `Fill up within the first ${Math.max(10, plan.rangeKm - 10)} km.`}`;
}
