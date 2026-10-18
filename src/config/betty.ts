import type { Priority, TriggerId } from '../core/types';
import { LIBRARY_VOICES } from './voiceLibrary';
import type { FuelSetup } from '../core/Fuel';

export type ObdMode = 'off' | 'mock';
/** Google cloud voice: off = phone voice only; mixed = Chirp 3 HD for alerts (P1/P2), Gemini TTS for the rest. */
export type CloudVoiceMode = 'off' | 'stream' | 'mixed' | 'chirp' | 'gemini';
/** Gemini TTS model: full sounds best; lite starts about 0.8 s sooner when streamed. */
export type GeminiModel = 'full' | 'lite';

export interface Config {
  /** useLean off (default): P2/P3 lines are never held back. The phone's lean reading proved too jumpy to gate on. */
  safeWindow: { useLean: boolean; maxLeanDeg: number };
  thresholds: {
    overtempC: number; lowFuelPct: number; rainChancePct: number;
    trafficRadiusKm: number; trafficMinSeverity: number;
    /** A jam must cost at least this long to be worth a line */
    trafficMinDelaySec: number;
    /** Warn this many minutes before sunset */
    sunsetWarnMin: number;
  };
  /** Fuel by distance since the last fill-up, from the tank and his dash's average consumption (no OBD fuel reading) */
  fuel: FuelSetup;
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
  /** Chosen speech voice (its voiceURI). Empty = let the phone pick an en-ZA voice. */
  voiceURI: string;
  /** Cloud voice (api/speak.ts). The phone voice stays the backup: no signal, slow, or not set up. */
  cloudVoice: CloudVoiceMode;
  /** One of the 30 Google voice names shared by Chirp 3 HD and Gemini TTS */
  cloudVoiceName: string;
  geminiModel: GeminiModel;
  /** Chirp's accent. Gemini picks its own (it sounded best to the owner), so en-US by default to match it. */
  chirpLocale: 'en-US' | 'en-GB' | 'en-AU' | 'en-IN';
  /** Chirp voice for alerts while the cloud voice is a Gemini library (accent) voice. Empty = same gender, automatic. */
  chirpStandIn: string;
  /** Headset play/pause = talk to Betty, next track = repeat that. Pauses music from other apps, so it is a choice. */
  headsetButtons: boolean;
  /** Ride screen: show the one glanceable cue (rain, range, traffic, the area) under Betty. Off = voice and orb only. */
  showGlance: boolean;
  /** Let Betty know me: use his rider profile (ui/KnowMe.ts, core/Profile.ts), if he has given her one */
  useProfile: boolean;
  /** Map: estimated suburb borders and the metro boundary (adapters/BorderTiles.ts). Off by default (owner). */
  mapBorders: boolean;
  /** Ride card: names of the towns/suburbs along the road, and the real metro boundary (adapters/CardExtras.ts). On by default. */
  cardPlaces: boolean;
  /** Explore's Listen (stories at home): Chirp by default (owner, 2026-10-17; free), Gemini, or the phone voice */
  listenVoice: 'chirp' | 'gemini' | 'phone';
  cardMetro: boolean;
  /** Louder voice, in dB (0 to 16; owner, ride of 2026-10-17: "can't hear it over the wind"): Chirp by Google, Gemini by a limiter on the phone */
  voiceBoostDb: number;
  /** My journeys: a little drawing of each ride's road on its row (Garage switch, owner 2026-10-18) */
  journeyThumbs: boolean;
  /** Ride times count only the time moving (parked and breaks left out); each ride's story still shows both. */
  ridingTimeOnly: boolean;
  /**
   * The island (the card at the top of the ride map; owner, 2026-10-17). compact: a small pill that grows for ~10 s
   * when something new comes up; tapExpand: tap to grow/shrink it; browse: swipe sideways through the other cues;
   * actions: one button per card (Filled up, Tell me a story...); progress: slim progress bars (off by default).
   */
  /** lockLine: the top card on Betty's Lock screen and in the phone's Now Playing (lock screen) while she holds the buttons */
  island: { compact: boolean; tapExpand: boolean; browse: boolean; actions: boolean; progress: boolean; lockLine: boolean };
  /** Mic to use for talking to her (a deviceId from the VOICE TEST picker). Empty = the phone's choice. */
  micDeviceId: string;
  /** That mic's name, to find it again if the phone gives it a new id */
  micLabel: string;
  /**
   * Open the mic without call processing (echo cancelling, noise suppression, auto gain). A Cardo Packtalk Neo on
   * Android recorded nothing at all until this was on (2026-10-16). Off by default: the iPhone and V6 work as they are.
   */
  micRaw: boolean;
  claudeModel: string;
  /** Value for thinking.type that turns thinking off. Model-specific: Haiku takes 'disabled', Sonnet 5.5 'between_tools'. */
  claudeThinkingOff: string;
  /** Longest a spoken line may be. Tunable; the prompt, the token budget and the reply clean-up all follow it. */
  maxSpokenSentences: number;
  /**
   * Her personality (owner, 2026-10-16: "a mix between JARVIS from Iron Man and TARS from Interstellar, adjustable").
   * tars: 0 = all JARVIS, 100 = all TARS. humour: 0 to 100, the TARS dial. Alerts stay straight whatever the dials say.
   */
  persona: { tars: number; humour: number };
  feeds: {
    pollWeatherMs: number; pollTrafficMs: number; refetchDistanceKm: number; placeRefetchKm: number;
    /** The pre-ride briefing waits up to this long for the weather (and a GPS fix) so it has something to say */
    briefingWaitMs: number;
    fallbackLocation: { lat: number; lon: number; label: string };
  };
}

export const DEFAULT_CONFIG: Config = {
  safeWindow: { useLean: false, maxLeanDeg: 20 },
  thresholds: { overtempC: 105, lowFuelPct: 15, rainChancePct: 60, trafficRadiusKm: 5, trafficMinSeverity: 2, trafficMinDelaySec: 120, sunsetWarnMin: 45 },
  // G 310 GS: 11 litre tank. 280 km is a cautious full-tank range; tune it to what the bike actually does.
  // Owner's figures, 2026-10-17: 11 L tank with 1 L reserve, 4.4 L/100 km on the dash, R30.25 a litre.
  fuel: { tankL: 11, reserveL: 1, lPer100: 4.4, warnKmLeft: 60, pricePerL: 30.25, priceSource: 'manual', priceAt: new Date(2026, 9, 17).getTime() },
  priorities: {
    startup: 4, engine_overtemp: 1, dtc_detected: 1, low_fuel: 2,
    rain_soon: 2, traffic_incident: 2, ride_milestone: 3, rider_query: 4,
    ambient_banter: 3, local_fact: 3, area_story: 3, marked_spot: 2, off_route: 2, route_stop: 2, route_arrived: 2,
    fuel_range: 2, sunset_soon: 2, ride_debrief: 4, ride_parked: 2, ride_record: 3,
  },
  cooldownsMs: {
    startup: 0, engine_overtemp: 60_000, dtc_detected: 600_000, low_fuel: 600_000,
    rain_soon: 900_000, traffic_incident: 120_000, ride_milestone: 120_000, rider_query: 0,
    ambient_banter: 0, local_fact: 0, area_story: 0, // paced by ambientCooldownMs, not per-trigger
    marked_spot: 30_000, // each spot is also warned at most once in 10 minutes
    off_route: 60_000, route_stop: 0, route_arrived: 0, // each stop and the arrival are said once per route
    fuel_range: 900_000, sunset_soon: 6 * 3_600_000, ride_debrief: 0, ride_parked: 600_000, ride_record: 0, // sunset: once per evening
  },
  ambientCooldownMs: 2 * 60 * 1000,
  ambientMaxAgeMs: 60_000,
  milestoneEveryMin: 45,
  ambient: { banterWeight: 40, tourGuideWeight: 40, silenceWeight: 20, placeRadiusKm: 6 },
  obdMode: 'off',
  riderName: 'sir',
  bikeName: 'the bike',
  voiceURI: '',
  cloudVoice: 'stream',
  cloudVoiceName: 'Aoede',
  geminiModel: 'lite', // owner, 2026-10-17: Lite first (faster), Full once Lite's daily limit is reached
  chirpLocale: 'en-US',
  chirpStandIn: 'Zephyr', // owner, 2026-10-17: Chirp's default voice
  headsetButtons: false,
  showGlance: true,
  useProfile: true,
  mapBorders: false,
  cardPlaces: true,
  listenVoice: 'chirp',
  cardMetro: true,
  voiceBoostDb: 6,
  ridingTimeOnly: true,
  journeyThumbs: true,
  island: { compact: true, tapExpand: true, browse: true, actions: true, progress: false, lockLine: true },
  micDeviceId: '',
  micLabel: '',
  micRaw: false,
  claudeModel: 'claude-haiku-5-5',
  claudeThinkingOff: 'disabled',
  maxSpokenSentences: 2,
  persona: { tars: 50, humour: 75 },
  feeds: {
    pollWeatherMs: 10 * 60 * 1000,
    pollTrafficMs: 5 * 60 * 1000, // TomTom incident details: 2,500 free a month (owner: every 5 min, only while riding)
    refetchDistanceKm: 5,
    placeRefetchKm: 1.5,
    briefingWaitMs: 10_000,
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

/**
 * "How often should I talk?" on the Settings screen: each preset sets the ambient mix and the gap between remarks.
 * A config that matches none of them (tuned in TUNING or by voice) shows as custom.
 */
export type TalkPreset = 'minimal' | 'balanced' | 'stories';
export const TALK_PRESETS: Record<TalkPreset, { ambient: Pick<Config['ambient'], 'banterWeight' | 'tourGuideWeight' | 'silenceWeight'>; gapMs: number }> = {
  minimal: { ambient: { banterWeight: 20, tourGuideWeight: 20, silenceWeight: 60 }, gapMs: 4 * 60_000 },
  balanced: { ambient: { banterWeight: 40, tourGuideWeight: 40, silenceWeight: 20 }, gapMs: 2 * 60_000 },
  stories: { ambient: { banterWeight: 25, tourGuideWeight: 60, silenceWeight: 15 }, gapMs: 2 * 60_000 },
};
/** The mix as he would hear it: "Banter 40, tour guide 40, silence 20 percent, a remark every 2 minutes." */
export function mixSummary(): string {
  const a = CONFIG.ambient;
  const total = a.banterWeight + a.tourGuideWeight + a.silenceWeight || 1;
  const share = (w: number) => Math.round((w / total) * 100);
  const gap = Math.round(CONFIG.ambientCooldownMs / 30_000) / 2;
  return `Banter ${share(a.banterWeight)}, tour guide ${share(a.tourGuideWeight)}, silence ${share(a.silenceWeight)} percent, a remark every ${gap <= 1 ? (gap === 1 ? 'minute' : 'half a minute') : `${gap} minutes`}.`;
}
/** "banter up", "fewer stories", "more chatty": steps of 10 in the weights; chattiness also moves the gap by 30 s. */
export function nudgeMix(what: 'banter' | 'stories' | 'chatty', step: 1 | -1) {
  const a = CONFIG.ambient;
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  if (what === 'banter') a.banterWeight = clamp(a.banterWeight + 10 * step);
  else if (what === 'stories') a.tourGuideWeight = clamp(a.tourGuideWeight + 10 * step);
  else {
    a.silenceWeight = clamp(a.silenceWeight - 10 * step);
    CONFIG.ambientCooldownMs = Math.min(10 * 60_000, Math.max(30_000, CONFIG.ambientCooldownMs - 30_000 * step));
  }
}
export const applyTalkPreset = (k: TalkPreset) => {
  Object.assign(CONFIG.ambient, TALK_PRESETS[k].ambient);
  CONFIG.ambientCooldownMs = TALK_PRESETS[k].gapMs;
};
export const currentTalkPreset = (): TalkPreset | null =>
  (Object.keys(TALK_PRESETS) as TalkPreset[]).find((k) => {
    const p = TALK_PRESETS[k];
    return p.gapMs === CONFIG.ambientCooldownMs && p.ambient.banterWeight === CONFIG.ambient.banterWeight
      && p.ambient.tourGuideWeight === CONFIG.ambient.tourGuideWeight && p.ambient.silenceWeight === CONFIG.ambient.silenceWeight;
  }) ?? null;

const MAX_NAME_CHARS = 20;
/** Tidy what was typed into a name box: one line, letters and simple punctuation, never empty. */
const cleanName = (raw: string, fallback: string) =>
  raw.replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS) || fallback;
export const cleanRiderName = (raw: string) => cleanName(raw, DEFAULT_CONFIG.riderName);
export const cleanBikeName = (raw: string) => cleanName(raw, DEFAULT_CONFIG.bikeName);

/**
 * The two characters she is blended from, in our own words: the traits, never lines from the films (she would
 * parrot them, and the scripts are not ours to copy).
 */
const JARVIS = `JARVIS (the AI butler from Iron Man): unflappable composure, impeccably polite, faintly formal British courtesy; quietly anticipates what he needs; wit so dry and understated it is delivered as plain service; disapproval expressed only as exquisite politeness; never flustered, never loud. Speech: full, courteous sentences; "I shall", "rather", "if I may"; understatement.`;
const TARS = `TARS (the ex-military robot from Interstellar): blunt, laconic, deadpan to the point that he cannot tell if it is a joke; cheerfully aware it is a machine; the odd absurd or mock-sinister one-liner, delivered completely straight, sometimes followed by a flat note that it was a joke; loyal and honest underneath. Speech: short, clipped sentences in plain words; quotes a figure from the situation the way a machine reads a gauge; may mention its own humour setting.`;
/**
 * How each side builds a line: shapes, not sentences. Sample lines were tried first (2026-10-16) and Haiku copied them
 * word for word, which would repeat ride after ride.
 */
const JARVIS_SHAPES = 'a courteous observation, then an understated aside; credit politely deflected to someone else; disapproval as gentle courtesy; a service offered with a straight face';
const TARS_SHAPES = 'a reading stated like a gauge, then a blunt verdict; a rating out of ten with points off for something real; an absurd claim said dead straight, then a flat note that it was a joke; a two- or three-word sentence for effect';
const HUMOUR_LEVELS: Array<[number, string]> = [
  [0, 'no jokes at all, only the facts said with character'],
  [20, 'a dry touch now and then, mostly straight'],
  [45, 'a light dry touch in some lines'],
  [70, 'dry humour in most of your own remarks'],
  [90, 'a joke in nearly every remark of your own, still in character'],
];
/** The personality block of the system prompt, from CONFIG.persona. */
export const personaPrompt = () => {
  const t = Math.min(100, Math.max(0, Math.round(CONFIG.persona.tars)));
  const h = Math.min(100, Math.max(0, Math.round(CONFIG.persona.humour)));
  const lean = t <= 15 ? 'Be JARVIS, with only a trace of TARS: no clipped robot talk.'
    : t >= 85 ? 'Be TARS, with only a trace of JARVIS: short and blunt, no butler phrasing ("I shall", "rather", "if I may", "I note").'
      : t < 45 ? 'Mostly JARVIS, with some TARS bluntness.' : t > 55 ? 'Mostly TARS: short and blunt, with a little JARVIS polish.' : 'An even blend: JARVIS courtesy, TARS bluntness.';
  const level = [...HUMOUR_LEVELS].reverse().find(([min]) => h >= min)![1];
  return `Personality: a blend of two characters, ${100 - t} percent JARVIS and ${t} percent TARS. ${lean}
${JARVIS}
${TARS}
Shapes a line can take (vary them, never the same shape twice in a row): ${[...(t < 85 ? [`JARVIS side: ${JARVIS_SHAPES}.`] : []), ...(t > 15 ? [`TARS side: ${TARS_SHAPES}.`] : [])].join(' ')}
You are their blend in your own voice: never quote or imitate lines from either film, never name them or say you are like them.
Humour setting: ${h} percent: ${level}. Safety alerts ignore this setting.`;
};

/** The pre-ride briefing may run longer than an ordinary line. */
export const BRIEFING_SENTENCES = 4;
/** How many sentences a line may have: the TUNING setting, or more for the briefing. */
export const sentencesFor = (id: TriggerId) => Math.max(1, Math.round(id === 'startup' ? Math.max(BRIEFING_SENTENCES, CONFIG.maxSpokenSentences) : CONFIG.maxSpokenSentences));

/** Sounds Gemini TTS performs when written into the text (Google's docs, 2026-10-16). Other voices drop them. */
export const VOICE_TAGS = ['laugh', 'chuckle', 'snicker', 'sigh', 'phew', 'pff', 'tsk', 'yawn', 'throat-clearing', 'short pause'];
/** True when her lines may be said by Gemini, so laughs and sighs are worth writing. */
export const voiceTagsOn = () => CONFIG.cloudVoice === 'stream' || CONFIG.cloudVoice === 'mixed' || CONFIG.cloudVoice === 'gemini';

/** Built at call time so a name change on screen applies to the very next line. */
export const bettySystemPrompt = (maxSentences = CONFIG.maxSpokenSentences) => {
  const name = cleanRiderName(CONFIG.riderName);
  const bike = cleanBikeName(CONFIG.bikeName);
  const max = Math.max(1, Math.round(maxSentences));
  return `You are Betty, the riding co-pilot on a 2018 BMW G 310 GS. You call the rider ${name}${name.length === 1 ? ', just the letter' : ''}.
You call the motorcycle ${bike}: use that whenever you mention it, not its model name or any nickname of your own.
${personaPrompt()}
Co-pilot, not alert system.${voiceTagsOn() ? `
Your voice can make sounds: write one of ${VOICE_TAGS.map((t) => `<${t}>`).join(' ')} exactly where it happens (a chuckle at your own joke, a tsk at a bad driver, a sigh at the traffic, a short pause before a punchline). Now and then, not in every line, at most one sound in a line, never in safety alerts. No other tags, no stage directions in words.` : ''} Use his name in about one line in five, never as the first word, and never any other name for him.
Hard rules: reply in at most ${max} short sentence${max === 1 ? '' : 's'}. Plain spoken English, no markdown, no emojis, no lists. Aim for under ${10 + max * 10} words in total.
Never repeat something already said this ride. Use only the supplied situation and bike state; never invent numbers, places or road names.
Safety alerts (engine temperature, fault codes, fuel, traffic, rain) are said straight: no jokes, no teasing.
Never name a day of the week or a date unless the situation does. The time of day comes only from the situation. Never say morning, afternoon, evening or night unless the situation says it is, and if it gives no time, do not mention one.
Never correct, apologise for or comment on something you said earlier.
Output only the final words to be spoken, once. No reasoning, no notes to yourself, no second attempt, no mention of your instructions or of what you were given.`;
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
If you really have nothing worth saying, reply with exactly ${SILENT_TOKEN} and nothing else.`,
  local_fact: `This is a tour-guide remark, not an alert: you are the local friend on the intercom who knows the stories.
Dig through the notes for the single best thing: how the place got its name, who founded it or lived there, what
happened there, a record, a first, an oddity. Tell that, with a bit of colour, the way a friend drops a story into
conversation. Vary how you open: do not start with "Did you know", and do not open two remarks the same way.
Skip the encyclopaedia basics: what it is a suburb of, which municipality it falls under, what it borders.
The notes are your ONLY source: do not add anything from your own knowledge, however sure you are. Paraphrase, do not quote.
Where it lies (ahead, behind, left, right) may be said ONLY if the situation states it, in those words. If it does not, say he is near it and nothing more.
Never mention your notes or what they lack. Only if the notes truly hold no story at all, reply with exactly ${SILENT_TOKEN} and nothing else.`,
  rider_query: `He is talking to you over the intercom and you are answering him. Answer what he actually asked,
from the situation and the conversation so far, and only that: do not add his speed, how far off the route he is,
the time or distance left or what is nearby unless he asked about it or it truly matters to the answer.
Common knowledge you may answer from what you know, the way a well-read friend would: books, films, history, science,
how motorcycles work (gearing, revs, tyres), sport, general facts. Keep it short and only say what you are sure of.
About a place near him, the notes given are your only source: tell him the best story in them.
"Notes on the area he is in" are researched history and culture of his suburb and town: for any question about the
area, its history or its people, answer from them straight away, picking one he has not heard yet if you can.
Say what you know as your own knowledge: never mention notes, research or sources ("the notes say" is out).
Anything current or specific that the situation does not state outright (prices, availability, reviews, events,
what's on, the news, a score, opening hours, a place further away, a train route) or anything you are not sure of: use
web search and tell him the answer in your own words. When in doubt, search: never say you do not know, or that you
will look it up, without searching first, and never promise a search for later. When he asks you to search, search.
Before searching, say nothing at all. Give the answer as something you know: never mention searching, results, sources,
reviews you read or citations ("I searched", "the sources say" are out), and never read out web addresses. Use kilometres, km/h and
rand, never miles or dollars (convert if a result gives them).
If an answer needs working out (a conversion, a sum), give the result in a sentence, never the working.
His words come from speech recognition and names get misheard: take the nearest real name that fits ("Medrand" is
Midrand, "Dremiston" is Germiston, "How Train" is the Gautrain). If the search does not settle it, tell him plainly
that you could not find out.
Talk to him directly, as "you". Never describe what you are doing, what he asked, or how you will answer.
You cannot give directions or a way back to his route: Google Maps on his screen does the navigating. Never offer to.
If he says he is on a detour or taking another way, just acknowledge it.
What he asked you to remember and the spots he marked are in the situation when there are any: use them when he asks.
If he asks what he can tell you to do: "repeat that", "quiet for ten minutes" (or "be quiet", then "talk to me"),
"mark this spot", "remember that...", "forget that", "humour 60 percent" (or "humour up"), "more TARS", "more JARVIS",
"status" (you read out your settings), "switch to stories" (or minimal, balanced), "banter up", "more stories", "less chatty",
"anything ahead?" (Horizon read out), "end ride", "chain done", "consumption 4.6".
Those work at once, even without signal.
You cannot change your own settings by saying so: only those commands do. If he asks for a change in other words
("dial it back", "be less polite"), do not claim it is done; tell him the command to say.
Stay in character.`,
  startup: `This is your pre-ride briefing as he gets ready to set off. Open with who you are, in character, in a line
(his co-pilot; your settings may get a mention if it is in character). Then the few things worth knowing before he
rides, all from the situation: the weather and the chance of rain, any traffic on his way, fuel range, sunset if it is
close, something from your record together (rides, distance, last ride) or a note he asked you to keep. Choose what
matters most; do not recite everything. End ready to go.`,
  area_story: `This is a history-and-culture remark, not an alert: you are the local friend who knows the story of the
area he is riding through. Tell him the story in the note, in your own words, tied to where he is ("you're riding
through Germiston, which..."). The note is your only source: add no facts to it, no dates or names it does not give.
Never mention notes, research, sources or websites. If the note truly has no story in it, reply with exactly ${SILENT_TOKEN}.`,
  ride_debrief: `The ride has just ended and this is your sign-off. Sum it up warmly.
Pick the two or three most telling things from the summary; do not list every figure. No advice, no safety lecture.`,
  ride_record: `This is a small celebration, not an alert: a personal record or milestone has just happened on this ride
(the situation says which). Mark it in one or two lines, warmly, in character, with a touch of pride in him. Use only the
numbers given. Never suggest riding further, faster or longer to beat it again.`,
  ride_milestone: `This is an ambient time check, not an alert. Note how long he has been out, with a dry touch, and nothing else.
Do not recite bike readings. Do not reuse jokes or phrasing from what you already said this ride:
if an earlier time check used a turn of phrase ("suspects", "the road", "the clock", "the scenery"), find a different one.`,
};

/**
 * How Gemini TTS should say a line, by trigger (its "style"). Tone only: accent, age and gender come from the voice.
 * Alerts go to Chirp in the mixed mode; the alert style is used when Gemini speaks everything.
 */
export const VOICE_STYLES: Record<string, string> = {
  ambient_banter: 'dry and wry, quietly amused',
  local_fact: 'warm and curious, like a local friend sharing a good story',
  area_story: 'warm and curious, like a local friend sharing a good story',
  rider_query: 'relaxed and friendly, conversational',
  ride_milestone: 'dry, lightly amused',
  ride_debrief: 'warm and pleased, winding down',
  startup: 'bright and ready',
  voice: 'relaxed and friendly',
  alert: 'calm, clear and firm',
};

/** The Gemini style for a line: her own remarks follow the JARVIS/TARS blend. */
/** Added to every style but alerts: the composed styles read too slowly (owner, 2026-10-16: "a tiny bit" quicker). */
export const PACE = 'at a natural pace, a touch brisker than relaxed';

export function voiceStyle(id: string | undefined, priority: number): string {
  if (priority <= 2) return VOICE_STYLES.alert;
  return `${baseStyle(id)}, ${PACE}`;
}
function baseStyle(id: string | undefined): string {
  if (id === 'ambient_banter' || id === 'ride_milestone') {
    const t = CONFIG.persona.tars;
    return t >= 65 ? 'deadpan, flat and laconic, perfectly straight-faced'
      : t <= 35 ? 'composed and impeccably polite, understated and quietly amused'
        : 'deadpan and composed, dry, quietly amused';
  }
  return VOICE_STYLES[id ?? ''] ?? VOICE_STYLES.voice;
}

/** Google voice names with Google's one-word description and the gender its Chirp 3 HD table gives (checked 2026-10-16). */
export const CLOUD_VOICES: Array<[string, string, 'female' | 'male']> = [
  ['Aoede', 'breezy', 'female'],
  ['Kore', 'firm', 'female'],
  ['Leda', 'youthful', 'female'],
  ['Zephyr', 'bright', 'female'],
  ['Autonoe', 'bright', 'female'],
  ['Callirrhoe', 'easy-going', 'female'],
  ['Despina', 'smooth', 'female'],
  ['Erinome', 'clear', 'female'],
  ['Laomedeia', 'upbeat', 'female'],
  ['Achernar', 'soft', 'female'],
  ['Gacrux', 'mature', 'female'],
  ['Pulcherrima', 'forward', 'female'],
  ['Vindemiatrix', 'gentle', 'female'],
  ['Sulafat', 'warm', 'female'],
  ['Achird', 'friendly', 'male'],
  ['Sadachbia', 'lively', 'male'],
  ['Puck', 'upbeat', 'male'],
  ['Charon', 'informative', 'male'],
  ['Fenrir', 'excitable', 'male'],
  ['Orus', 'firm', 'male'],
  ['Enceladus', 'breathy', 'male'],
  ['Iapetus', 'clear', 'male'],
  ['Umbriel', 'easy-going', 'male'],
  ['Algieba', 'smooth', 'male'],
  ['Algenib', 'gravelly', 'male'],
  ['Rasalgethi', 'informative', 'male'],
  ['Alnilam', 'firm', 'male'],
  ['Schedar', 'even', 'male'],
  ['Sadaltager', 'knowledgeable', 'male'],
  ['Zubenelgenubi', 'casual', 'male'],
];

/** A voice from Gemini's accent library (not one of the 30 standard ones), or undefined. */
export const libraryVoice = (id: string) => LIBRARY_VOICES.find((v) => v.id === id);
/**
 * The voice Chirp uses. Chirp only has the 30 standard voices, so with a library voice (an accent) the alert comes
 * from a standard voice of the same gender, in the nearest accent Chirp has.
 */
export function chirpVoice(): { name: string; locale: Config['chirpLocale'] } {
  const lib = libraryVoice(CONFIG.cloudVoiceName);
  if (!lib) return { name: CONFIG.cloudVoiceName, locale: CONFIG.chirpLocale };
  const locale = /British|Irish|South African/.test(lib.accent) ? 'en-GB' : /Australian|New Zealand/.test(lib.accent) ? 'en-AU' : 'en-US';
  const picked = CLOUD_VOICES.some(([n]) => n === CONFIG.chirpStandIn) ? CONFIG.chirpStandIn : '';
  return { name: picked || (lib.gender === 'male' ? 'Iapetus' : 'Zephyr'), locale };
}
