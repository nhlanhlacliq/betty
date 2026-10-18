import type { BikeState, WeatherState } from '../core/types';

/**
 * Workshop scenario scripts (owner's backlog; chat test mode spec item 7): named timelines that drive the simulator's
 * overrides, to test Betty at the desk. Plain data: `at` in seconds from Play, `set` overrides to apply, `clear` ones
 * to drop. `play` runs one and returns a Stop.
 */
type Overrides = Partial<Pick<BikeState, 'speedKmh' | 'engineTempC' | 'headingDeg' | 'leanDeg' | 'incidents' | 'jolts'>> & { weather?: Partial<WeatherState> };
export interface ScenarioStep { at: number; set?: Overrides; clear?: Array<keyof BikeState> }
export interface Scenario { name: string; note: string; steps: ScenarioStep[] }

const wx = (w: Partial<WeatherState>): Partial<WeatherState> => ({ tempC: 22, windKmh: 10, rainNowMm: 0, rainChanceNextHourPct: 10, summary: 'partly cloudy', fetchedAt: 0, sunriseAt: null, sunsetAt: null, ...w });
const ramp = (from: number, to: number, seconds: number, every: number, f: (v: number) => Overrides, start = 0): ScenarioStep[] =>
  Array.from({ length: Math.floor(seconds / every) + 1 }, (_, i) => ({ at: start + i * every, set: f(Math.round(from + ((to - from) * i * every) / seconds)) }));

export const SCENARIOS: Scenario[] = [
  { name: 'Overheat on the N3', note: 'Needs simulated OBD2. 100 km/h, engine 95 to 112 C over a minute.',
    steps: [{ at: 0, set: { speedKmh: 100 } }, ...ramp(95, 112, 60, 10, (v) => ({ engineTempC: v }))] },
  { name: 'Rain front', note: 'Rain chance 20 to 90% over a minute, then rain.',
    steps: [{ at: 0, set: { speedKmh: 80 } }, ...ramp(20, 90, 60, 15, (v) => ({ weather: wx({ rainChanceNextHourPct: v, summary: v > 60 ? 'showers' : 'partly cloudy' }) })), { at: 75, set: { weather: wx({ rainNowMm: 1.2, rainChanceNextHourPct: 95, summary: 'rain' }) } }] },
  { name: 'Closure ahead', note: 'Riding at 60, a road closure appears 1 km ahead after 10 s.',
    steps: [{ at: 0, set: { speedKmh: 60 } }, { at: 10, set: { incidents: [{ id: 'scn-closure', description: 'a road closure', roadName: 'Modderfontein Rd', severity: 4, distanceKm: 1, lat: 0, lon: 0 }] } }] },
  { name: 'Cold and windy', note: '6 C, gusts of 55 km/h from the east, riding north at 100.',
    steps: [{ at: 0, set: { speedKmh: 100, headingDeg: 0, weather: wx({ tempC: 6, windKmh: 25, windGustKmh: 55, windFromDeg: 90, summary: 'clear' }) } }] },
  { name: 'Rough road', note: 'A run of hard bumps at 50 km/h.',
    steps: [{ at: 0, set: { speedKmh: 50 } }, ...[3, 6, 9, 12].map((t, i) => ({ at: t, set: { jolts: 100 + i } }))] },
];

export interface ScenarioTarget { setOverride<K extends keyof BikeState>(k: K, v: BikeState[K]): void; clearOverride(k: keyof BikeState): void; current: BikeState }

/** Run a scenario against the simulator. `speed` > 1 runs it faster (tests). Returns Stop (which also clears what it set). */
export function play(s: Scenario, agg: ScenarioTarget, onStep: (i: number) => void = () => {}, speed = 1): () => void {
  const touched = new Set<keyof BikeState>();
  const timers = s.steps.map((step, i) => setTimeout(() => {
    for (const [k, v] of Object.entries(step.set ?? {})) {
      const key = k as keyof BikeState;
      touched.add(key);
      agg.setOverride(key, (key === 'weather' ? { ...(agg.current.weather ?? {}), ...(v as object) } : v) as never);
    }
    for (const k of step.clear ?? []) agg.clearOverride(k);
    onStep(i);
  }, (step.at * 1000) / speed));
  return () => { timers.forEach(clearTimeout); for (const k of touched) agg.clearOverride(k); };
}
