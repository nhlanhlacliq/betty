import { JourneyStore } from '../adapters/JourneyStore';
import { LineLogStore } from '../adapters/LineLogStore';
import { RideLog } from '../adapters/RideLog';
import { RoadStore } from '../adapters/RoadStore';
import { TrackStore } from '../adapters/TrackStore';
import type { LogEntry } from '../core/LineLog';
import type { RideRecord } from '../core/RideMemory';

/**
 * Small ride helpers both apps' screens use (My journeys, the ride story, the ride card). Pure apart from the
 * names he gave rides (JourneyStore).
 */
const day = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { weekday: 'long' });

/** His name for the ride if he gave it one (My journeys > Rename), otherwise "Sunday near Sandton". */
export const rideTitle = (r: RideRecord) => JourneyStore.name(r.startedAt) ?? (r.places[0] ? `${day(r.startedAt)} near ${r.places[0]}` : `${day(r.startedAt)} ride`);

/** "1h 05m", "42 min" */
export const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`);

/** What she said on a ride: her spoken lines only, not silences, drops or diagnostics. */
export const spokenLines = (entries: LogEntry[], rideId: number) =>
  entries.filter((e) => e.rideId === rideId && /^\[P\d\]/.test(e.head) && e.text && !e.text.startsWith('('));

/** The trigger of a logged line ("[P3] area_story (claude...)" -> "area_story"). */
export const triggerOf = (head: string) => head.match(/^\[P\d\] (\w+)/)?.[1] ?? '';

/** Every ride under this is a "short one" (a quick test, a restart): Select > Short rides. */
export const SHORT_MIN = 5;
export const SHORT_KM = 2;

/**
 * Delete a ride and everything kept with it (owner, 2026-10-18): the record, its lines, both copies of its road, its
 * star and name. The fuel count and the odometer stay. The caller refuses the running ride and tells its line logger
 * (`forgetRide`) so the next save does not put the lines back.
 */
export function deleteRideData(rideId: number) {
  RideLog.remove(rideId); LineLogStore.removeRide(rideId); TrackStore.remove(rideId); RoadStore.remove(rideId);
  JourneyStore.forget(rideId);
}
