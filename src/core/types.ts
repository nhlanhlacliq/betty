export type Priority = 1 | 2 | 3 | 4; // P1 critical, P2 advisory, P3 ambient, P4 rider-initiated

export type TriggerId =
  | 'startup' | 'engine_overtemp' | 'dtc_detected' | 'low_fuel'
  | 'rain_soon' | 'traffic_incident' | 'ride_milestone' | 'rider_query'
  | 'ambient_banter' | 'local_fact';

export const TRIGGER_IDS: TriggerId[] = [
  'startup', 'engine_overtemp', 'dtc_detected', 'low_fuel',
  'rain_soon', 'traffic_incident', 'ride_milestone', 'rider_query',
  'ambient_banter', 'local_fact',
];

/** Ambient flavours: no canned fallback, silence is a valid output. */
export const AMBIENT_IDS: TriggerId[] = ['ambient_banter', 'local_fact'];

export interface WeatherState {
  tempC: number;
  windKmh: number;
  rainNowMm: number;
  rainChanceNextHourPct: number;
  summary: string;
  fetchedAt: number;
}

export interface TrafficIncident {
  id: string;
  description: string;
  roadName?: string;
  /** 0 unknown, 1 minor, 2 moderate, 3 major, 4 closure/undefined */
  severity: number;
  distanceKm: number;
  lat: number;
  lon: number;
}

/** A notable place near the rider, with the only facts Betty may use about it. */
export interface NearbyPlace {
  id: string;
  name: string;
  distanceKm: number;
  summary: string;
}

export interface BikeState {
  timestamp: number;
  // OBD2 (mocked until Phase 4)
  rpm: number;
  engineTempC: number;
  throttlePct: number;
  fuelPct: number;
  dtcs: string[];
  // GPS
  speedKmh: number;
  lat: number | null;
  lon: number | null;
  headingDeg: number | null;
  // IMU
  leanDeg: number;
  // Feeds
  weather: WeatherState | null;
  incidents: TrafficIncident[];
  nearbyPlaces: NearbyPlace[];
}

export interface TriggerEvent {
  id: TriggerId;
  priority: Priority;
  /** Plain-English situation passed to Claude */
  context: string;
  /** Spoken if Claude is unavailable. Empty = stay silent (ambient flavours). */
  fallback: string;
  createdAt: number;
}

export interface DataSource {
  start(onUpdate: (partial: Partial<BikeState>) => void): void | Promise<void>;
  stop(): void;
}
