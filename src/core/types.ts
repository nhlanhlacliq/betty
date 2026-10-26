import type { Landmark } from './Landmarks';
export type Priority = 1 | 2 | 3 | 4; // P1 critical, P2 advisory, P3 ambient, P4 rider-initiated

export type TriggerId =
  | 'startup' | 'engine_overtemp' | 'dtc_detected' | 'low_fuel'
  | 'rain_soon' | 'traffic_incident' | 'ride_milestone' | 'rider_query'
  | 'ambient_banter' | 'local_fact' | 'area_story' | 'marked_spot'
  | 'off_route' | 'route_stop' | 'route_arrived'
  | 'fuel_range' | 'sunset_soon' | 'ride_debrief' | 'ride_parked' | 'ride_record' | 'route_weather' | 'fatigue' | 'wind_cold' | 'new_road' | 'rough_patch' | 'landmark' | 'good_stop' | 'charging_low';

export const TRIGGER_IDS: TriggerId[] = [
  'startup', 'engine_overtemp', 'dtc_detected', 'low_fuel',
  'rain_soon', 'traffic_incident', 'ride_milestone', 'rider_query',
  'ambient_banter', 'local_fact', 'area_story', 'marked_spot',
  'off_route', 'route_stop', 'route_arrived',
  'fuel_range', 'sunset_soon', 'ride_debrief', 'ride_parked', 'ride_record', 'route_weather', 'fatigue', 'wind_cold', 'new_road', 'rough_patch', 'landmark', 'good_stop', 'charging_low',
];

/** Ambient flavours: no canned fallback, silence is a valid output. */
export const AMBIENT_IDS: TriggerId[] = ['ambient_banter', 'local_fact', 'area_story'];
/** Lines she makes up on her own (no alert, no question): they get no clock or bike readings, and may be silent. */
export const UNPROMPTED_IDS: TriggerId[] = [...AMBIENT_IDS, 'ride_milestone', 'ride_record', 'new_road', 'landmark'];

export interface WeatherState {
  tempC: number;
  windKmh: number;
  rainNowMm: number;
  rainChanceNextHourPct: number;
  summary: string;
  fetchedAt: number;
  /** Next sunrise and sunset at the rider's location (epoch ms), when the feed supplies them */
  sunriseAt: number | null;
  sunsetAt: number | null;
  /** Gusts (km/h) and where the wind blows FROM (degrees), for crosswind and wind chill (2026-10-18) */
  windGustKmh?: number;
  windFromDeg?: number;
}

export interface TrafficIncident {
  id: string;
  description: string;
  roadName?: string;
  /** 0 unknown, 1 minor, 2 moderate, 3 major, 4 closure/undefined */
  severity: number;
  distanceKm: number;
  /** 0,0 for simulator incidents, which have no real position */
  lat: number;
  lon: number;
  /** Extra time it costs, in seconds, when the provider knows it */
  delaySec?: number | null;
  /** Length of the affected stretch in metres */
  lengthM?: number | null;
}

/** A notable place near the rider, with the only facts Betty may use about it. */
export interface NearbyPlace {
  id: string;
  name: string;
  distanceKm: number;
  summary: string;
  lat: number;
  lon: number;
  /** How much there is to say about it (the article's size); the tour guide goes for the richest place in range */
  interest: number;
}

export interface BikeState {
  timestamp: number;
  /** True while an OBD2 feed (simulated or real) is supplying the engine fields below. False = ignore them. */
  obd: boolean;
  // OBD2 (simulated, or a real reader: core/Elm327)
  rpm: number;
  engineTempC: number;
  throttlePct: number;
  /** Only meaningful with fuelKnown: the owner's G 310 GS gives no fuel level (2026-10-27), so its range stays the
   *  estimate from distance since the fill-up even with a reader on. */
  fuelPct: number;
  fuelKnown: boolean;
  dtcs: string[];
  /** The rest a real reader gives (each only when the bike answers it); {} without one. */
  engine: EngineReadings;
  // GPS
  speedKmh: number;
  lat: number | null;
  lon: number | null;
  /** GPS course over ground; null when standing still */
  headingDeg: number | null;
  altitudeM: number | null;
  /** Estimated from GPS speed and turn rate (see GpsLean), or the simulator slider. Positive = right. */
  leanDeg: number;
  // Phone motion sensors (approximate, mount-dependent)
  /** Compass heading, used only when GPS has no course */
  compassDeg: number | null;
  /** Hard jolts counted by the accelerometer since the session started */
  jolts: number;
  // Feeds
  weather: WeatherState | null;
  incidents: TrafficIncident[];
  nearbyPlaces: NearbyPlace[];
  /** The suburb and town he is in (OpenStreetMap), and researched history/culture notes about them (api/story) */
  area: AreaInfo | null;
  areaNotes: AreaNote[];
  /** Landmarks around him (Wikidata + OpenStreetMap, core/Landmarks), with notes once researched */
  landmarks: Landmark[];
}

/** Engine values beyond the basics (core/Elm327 PIDS), as the bike reports them. */
export interface EngineReadings {
  /** Battery / charging voltage at the reader (ATRV): ~12.5 engine off, ~14 charging */
  batteryV?: number;
  /** The engine computer's own supply voltage (PID 42) */
  ecuV?: number;
  loadPct?: number;
  absLoadPct?: number;
  intakeC?: number;
  baroKpa?: number;
  timingDeg?: number;
  /** Fuel trims, percent: long term drifting far from 0 means the engine is correcting for something */
  stftPct?: number;
  ltftPct?: number;
  /** Commanded air/fuel equivalence (1 = stoichiometric) */
  lambda?: number;
  /** The bike's own speed (its wheel sensor), next to GPS speed */
  bikeSpeedKmh?: number;
  /** The engine warning light, and how many fault codes the engine computer holds (PID 01) */
  milOn?: boolean;
  dtcCount?: number;
  /** Seconds since the engine started (PID 1F) */
  runS?: number;
  /** Distance since the fault codes were last cleared (PID 31): a km counter, not the odometer */
  kmSinceClear?: number;
}

export interface TriggerEvent {
  id: TriggerId;
  priority: Priority;
  /** Plain-English situation passed to Claude */
  context: string;
  /** Spoken if Claude is unavailable. Empty = stay silent (ambient flavours). */
  fallback: string;
  /** What the rider actually said, when this is his question (typed in the chat panel now, spoken later) */
  riderSaid?: string;
  createdAt: number;
  /** The live values for a banked line's blanks (core/LineBank), for the alerts that have them */
  slots?: Record<string, string>;
  /** What she knows about him (his rider profile), when this line may use it, and how (core/Profile.ts) */
  profile?: { text: string; use: 'answer' | 'remark' | 'interests' };
}

export interface AreaInfo { suburb: string | null; town: string | null; region: string | null }
/** One researched story about an area: history or culture, from web search, kept on the phone. */
export interface AreaNote { id: string; area: string; topic: string; text: string }

export interface DataSource {
  start(onUpdate: (partial: Partial<BikeState>) => void): void | Promise<void>;
  stop(): void;
}
