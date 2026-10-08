import type { Priority, TriggerId } from '../core/types';

export type ObdMode = 'off' | 'mock';

export interface Config {
  /** useLean off (default): P2/P3 lines are never held back. The phone's lean reading proved too jumpy to gate on. */
  safeWindow: { useLean: boolean; maxLeanDeg: number };
  thresholds: {
    overtempC: number; lowFuelPct: number; rainChancePct: number;
    trafficRadiusKm: number; trafficMinSeverity: number;
    /** Warn this many minutes before sunset */
    sunsetWarnMin: number;
  };
  /** Fuel range by distance since the last fill-up (used while there is no OBD fuel reading) */
  fuel: { rangeKm: number; warnKmLeft: number };
  priorities: Record<TriggerId, Priority>;
  cooldownsMs: Record<TriggerId, number>;
  /** Min gap between ambient slots (enforced in TriggerEngine; the queue speaks whatever it is given) */
  ambientCooldownMs: number;
  /** A queued P3 older than this is dropped */
  ambientMaxAgeMs: number;
  milestoneEveryMin: number;
  /** Ambient flavour mix (relative weights) and how far out a place still counts as "here" */
  ambient: { banterWeight: number; tourGuideWeight: number; silenceWeight: number; placeRadiusKm: number };
  /** 'off' = no engine data at all, Betty runs on GPS, lean and feeds. 'mock' = simulated OBD2. Real OBD2 is Phase 4. */
  obdMode: ObdMode;
  /** What Betty calls the rider. A single letter is spoken as its name by the speech engine ("en"). */
  riderName: string;
  /** What Betty calls the motorcycle */
  bikeName: string;
  claudeModel: string;
  /** Value for thinking.type that turns thinking off. Model-specific: Haiku takes 'disabled', Sonnet 5.5 'between_tools'. */
  claudeThinkingOff: string;
  maxSpokenSentences: number;
  feeds: {
    pollWeatherMs: number; pollTrafficMs: number; refetchDistanceKm: number; placeRefetchKm: number;
    fallbackLocation: { lat: number; lon: number; label: string };
  };
}

export const DEFAULT_CONFIG: Config = {
  safeWindow: { useLean: false, maxLeanDeg: 20 },
  thresholds: { overtempC: 105, lowFuelPct: 15, rainChancePct: 60, trafficRadiusKm: 5, trafficMinSeverity: 2, sunsetWarnMin: 45 },
  // G 310 GS: 11 litre tank. 280 km is a cautious full-tank range; tune it to what the bike actually does.
  fuel: { rangeKm: 280, warnKmLeft: 60 },
  priorities: {
    startup: 4, engine_overtemp: 1, dtc_detected: 1, low_fuel: 2,
    rain_soon: 2, traffic_incident: 2, ride_milestone: 3, rider_query: 4,
    ambient_banter: 3, local_fact: 3,
    fuel_range: 2, sunset_soon: 2, ride_debrief: 4,
  },
  cooldownsMs: {
    startup: 0, engine_overtemp: 60_000, dtc_detected: 600_000, low_fuel: 600_000,
    rain_soon: 900_000, traffic_incident: 120_000, ride_milestone: 120_000, rider_query: 0,
    ambient_banter: 0, local_fact: 0, // paced by ambientCooldownMs, not per-trigger
    fuel_range: 900_000, sunset_soon: 6 * 3_600_000, ride_debrief: 0, // sunset: once per evening
  },
  ambientCooldownMs: 2 * 60 * 1000,
  ambientMaxAgeMs: 60_000,
  milestoneEveryMin: 45,
  ambient: { banterWeight: 40, tourGuideWeight: 40, silenceWeight: 20, placeRadiusKm: 4 },
  obdMode: 'off',
  riderName: 'sir',
  bikeName: 'the bike',
  claudeModel: 'claude-haiku-5-5',
  claudeThinkingOff: 'disabled',
  maxSpokenSentences: 2,
  feeds: {
    pollWeatherMs: 10 * 60 * 1000,
    pollTrafficMs: 2 * 60 * 1000,
    refetchDistanceKm: 5,
    placeRefetchKm: 1.5,
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

const MAX_NAME_CHARS = 20;
/** Tidy what was typed into a name box: one line, letters and simple punctuation, never empty. */
const cleanName = (raw: string, fallback: string) =>
  raw.replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS) || fallback;
export const cleanRiderName = (raw: string) => cleanName(raw, DEFAULT_CONFIG.riderName);
export const cleanBikeName = (raw: string) => cleanName(raw, DEFAULT_CONFIG.bikeName);

/** Built at call time so a name change on screen applies to the very next line. */
export const bettySystemPrompt = () => {
  const name = cleanRiderName(CONFIG.riderName);
  const bike = cleanBikeName(CONFIG.bikeName);
  return `You are Betty, the riding co-pilot on a 2018 BMW G 310 GS. You call the rider ${name}${name.length === 1 ? ', just the letter' : ''}.
You call the motorcycle ${bike}: use that whenever you mention it, not its model name or any nickname of your own.
Tone: warm, dry wit, direct. Co-pilot, not alert system. Use his name rarely, not in every line, and never any other name for him.
Hard rules: reply in at most ${DEFAULT_CONFIG.maxSpokenSentences} short sentences. Plain spoken English, no markdown, no emojis, no lists. Aim for under 25 words in total.
Never repeat something already said this ride. Use only the supplied situation and bike state; never invent numbers, places or road names.
Safety alerts (engine temperature, fault codes, fuel, traffic, rain) are said straight: no jokes, no teasing.
The time of day comes only from the situation. Never say morning, afternoon, evening or night unless the situation says it is, and if it gives no time, do not mention one.
Never correct, apologise for or comment on something you said earlier.
Output only the words to be spoken.`;
};

/** Reply that means "say nothing". Ambient flavours may choose it. */
export const SILENT_TOKEN = 'SILENT';

/** Extra instructions appended to the system prompt for the ambient flavours. */
export const FLAVOUR_PROMPTS: Partial<Record<TriggerId, string>> = {
  ambient_banter: `This is an ambient remark, not an alert: you are a companion on the intercom, not a dashboard.
The situation gives you one topic, a delivery, and background on the ride. Talk about the topic in that delivery.
The background is there for colour: use a detail from it only if it makes the remark better, never list it.
His riding is fair game: tease his pace, his revs, his cornering, his stops, the way a mate on the intercom would.
Keep it affectionate. The one line you do not cross: never dare him, and never suggest going faster or leaning further.
Every specific you mention must come from the situation. Say nothing factual about a place beyond its name and where the situation says it lies.
Look at what you already said this ride and do not reuse its jokes, images, openings or phrasing.
No running gags: if a subject (a price, the weather, a place) already appears in what you said, leave it alone this time.
South African register is welcome, without caricature.
If you really have nothing worth saying, reply with exactly ${SILENT_TOKEN}.`,
  local_fact: `This is a tour-guide remark, not an alert. Share one interesting fact about the place in the supplied notes,
the way a local friend on the intercom would. One fact only, the most surprising one.
The notes are your ONLY source: do not add anything from your own knowledge, however sure you are. Paraphrase, do not quote.
Where it lies (ahead, behind, left, right) may be said ONLY if the situation states it, in those words. If it does not, say he is near it and nothing more.
Be picky. Which municipality or region something falls under, what it borders, or that it simply exists is dull.
Never mention your notes or what they lack, and never apologise for a thin fact: say it well or not at all.
If the notes hold nothing a friend would bother mentioning, reply with exactly ${SILENT_TOKEN}.`,
  ride_debrief: `The ride has just ended and this is your sign-off. Sum it up warmly in two short sentences.
Pick the two or three most telling things from the summary; do not list every figure. No advice, no safety lecture.`,
  ride_milestone: `This is an ambient time check, not an alert. Note how long he has been out, with a dry touch, and nothing else.
Do not recite bike readings. Do not reuse jokes or phrasing from what you already said this ride.`,
};
