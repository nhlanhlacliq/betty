/**
 * BikeState — Single source of truth for all sensor and API data.
 * Populated by L2 adapters, consumed by L3 StateAggregator.
 */
export interface TrafficIncident {
  id: string;
  type: string;
  description: string;
  distanceKm: number;
  lat: number;
  lon: number;
}

export interface BikeState {
  timestamp: number;

  // OBD2
  rpm: number;
  speed: number;           // km/h
  coolantTemp: number;     // °C
  throttlePos: number;     // 0–100%
  engineLoad: number;      // 0–100%
  fuelStatus: string;      // e.g. "Open loop - insufficient engine temp"
  batteryVoltage: number;  // Volts
  dtcCodes: string[];      // Active fault codes

  // GPS
  gpsLat: number;
  gpsLon: number;
  gpsHeading: number;      // Degrees (0 = North)
  gpsAltitude: number;     // Meters

  // IMU
  leanAngle: number;       // Degrees (0 = upright)
  gForce: number;          // Lateral G
  braking: boolean;        // true when decel > 0.3g

  // TPMS
  frontTyrePSI: number;
  rearTyrePSI: number;

  // Weather API
  weatherCondition: string; // e.g. "Rain", "Clear"
  weatherTemp: number;      // °C

  // Traffic API
  trafficIncidents: TrafficIncident[];
}

export function createDefaultBikeState(): BikeState {
  return {
    timestamp: Date.now(),
    rpm: 0,
    speed: 0,
    coolantTemp: 20,
    throttlePos: 0,
    engineLoad: 0,
    fuelStatus: 'Unknown',
    batteryVoltage: 12.6,
    dtcCodes: [],
    gpsLat: -26.1367,  // Edenvale, South Africa
    gpsLon: 28.1595,
    gpsHeading: 0,
    gpsAltitude: 1600,
    leanAngle: 0,
    gForce: 0,
    braking: false,
    frontTyrePSI: 36,
    rearTyrePSI: 42,
    weatherCondition: 'Unknown',
    weatherTemp: 20,
    trafficIncidents: [],
  };
}
