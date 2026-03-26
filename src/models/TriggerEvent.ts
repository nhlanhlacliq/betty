import { BikeState } from './BikeState';

/**
 * Priority classification for trigger events.
 * P1 = life-safety critical, P4 = rider voice query.
 */
export enum TriggerPriority {
  P1_CRITICAL = 1,
  P2_ADVISORY = 2,
  P3_AMBIENT = 3,
  P4_QUERY = 4,
}

/**
 * Trigger type identifiers — used for deduplication and routing.
 */
export enum TriggerType {
  // P1 Critical
  OVERTEMP = 'OVERTEMP',
  DTC_FAULT = 'DTC_FAULT',
  TYRE_PRESSURE_CRITICAL = 'TYRE_PRESSURE_CRITICAL',

  // P2 Advisory
  LOW_FUEL = 'LOW_FUEL',
  TYRE_PRESSURE_LOW = 'TYRE_PRESSURE_LOW',
  TRAFFIC_INCIDENT = 'TRAFFIC_INCIDENT',
  WEATHER_RAIN = 'WEATHER_RAIN',
  BATTERY_LOW = 'BATTERY_LOW',

  // P3 Ambient
  RIDE_MILESTONE = 'RIDE_MILESTONE',
  SCENIC_COMMENT = 'SCENIC_COMMENT',
  ENGINE_WARM = 'ENGINE_WARM',
  IDLE_OBSERVATION = 'IDLE_OBSERVATION',

  // P4 Query
  VOICE_QUERY = 'VOICE_QUERY',
}

export interface TriggerEvent {
  id: string;
  timestamp: number;
  priority: TriggerPriority;
  type: TriggerType;
  context: Record<string, unknown>;
  bikeState: BikeState;
  spoken: boolean;
}

export function createTriggerEvent(
  priority: TriggerPriority,
  type: TriggerType,
  context: Record<string, unknown>,
  bikeState: BikeState,
): TriggerEvent {
  return {
    id: generateId(),
    timestamp: Date.now(),
    priority,
    type,
    context,
    bikeState,
    spoken: false,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
