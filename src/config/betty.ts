import type { Priority, TriggerId } from '../core/types';

export interface Config {
  safeWindow: { maxRpm: number; maxLeanDeg: number };
  thresholds: {
    overtempC: number; lowFuelPct: number; rainChancePct: number;
    trafficRadiusKm: number; trafficMinSeverity: number;
  };
  priorities: Record<TriggerId, Priority>;
  cooldownsMs: Record<TriggerId, number>;
  /** Min gap between spoken P3 remarks (enforced in AudioQueue) */
  ambientCooldownMs: number;
  /** A queued P3 older than this is dropped */
  ambientMaxAgeMs: number;
  milestoneEveryMin: number;
  claudeModel: string;
  maxSpokenSentences: number;
  feeds: {
    pollWeatherMs: number; pollTrafficMs: number; refetchDistanceKm: number;
    fallbackLocation: { lat: number; lon: number; label: string };
  };
}

export const DEFAULT_CONFIG: Config = {
  safeWindow: { maxRpm: 5000, maxLeanDeg: 20 },
  thresholds: { overtempC: 105, lowFuelPct: 15, rainChancePct: 60, trafficRadiusKm: 5, trafficMinSeverity: 2 },
  priorities: {
    startup: 4, engine_overtemp: 1, dtc_detected: 1, low_fuel: 2,
    rain_soon: 2, traffic_incident: 2, ride_milestone: 3, rider_query: 4,
  },
  cooldownsMs: {
    startup: 0, engine_overtemp: 60_000, dtc_detected: 600_000, low_fuel: 600_000,
    rain_soon: 900_000, traffic_incident: 120_000, ride_milestone: 120_000, rider_query: 0,
  },
  ambientCooldownMs: 2 * 60 * 1000,
  ambientMaxAgeMs: 60_000,
  milestoneEveryMin: 45,
  claudeModel: 'claude-sonnet-5-5',
  maxSpokenSentences: 2,
  feeds: {
    pollWeatherMs: 10 * 60 * 1000,
    pollTrafficMs: 2 * 60 * 1000,
    refetchDistanceKm: 5,
    // Used only when the phone has no GPS fix (desktop / simulated sessions)
    fallbackLocation: { lat: -26.14, lon: 28.15, label: 'Edenvale (fallback)' },
  },
};

/** Live, mutable config. Modules read it at call time, so UI changes take effect immediately. */
export const CONFIG: Config = structuredClone(DEFAULT_CONFIG);

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepAssign(target: any, src: any) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepAssign(target[k], v);
    else if (v !== undefined) target[k] = v;
  }
}
export const applyConfig = (p: DeepPartial<Config>) => deepAssign(CONFIG, p);
export const resetConfig = () => deepAssign(CONFIG, structuredClone(DEFAULT_CONFIG));

export const BETTY_SYSTEM_PROMPT = `You are Betty, the riding co-pilot for Nhlanhla's 2018 BMW G 310 GS.
Tone: warm, dry wit, direct. Co-pilot, not alert system.
Hard rules: reply in at most ${DEFAULT_CONFIG.maxSpokenSentences} short sentences. Plain spoken English, no markdown, no emojis, no lists.
Never repeat something already said this ride. Use only the supplied situation and bike state; never invent numbers, places or road names.
Output only the words to be spoken.`;
