import { CONFIG } from '../../../src/config/betty';
import { RiderMemory, addMark, addNote, describeMemory } from '../../../src/core/Commands';
import { describeStations, kmToReserve, stationsAhead } from '../../../src/core/Fuel';
import { StationSource } from '../../../src/adapters/StationSource';
import { RiderMemoryStore } from '../../../src/adapters/RiderMemoryStore';
import type { RideSession } from '../../../src/app/RideSession';
import type { PhoneTool } from './VoiceSession';

/**
 * The tools the voice server asks the PHONE to carry out (voice/betty_voice/tools.py lists them): the phone owns the
 * ride, its memory and settings. Each returns facts or {error} that she says plainly. Not in the native app yet:
 * earlier rides, maintenance and planned routes (they live in the web app for now).
 */
export function phoneTools(ride: RideSession): Record<string, PhoneTool> {
  const { engine, agg } = ride;
  // Notes and spots are the shared store's (src/adapters/RiderMemoryStore), the same the web app keeps.
  const memory = { get current() { return RiderMemoryStore.load(); } };
  const save = async (m: RiderMemory) => { RiderMemoryStore.save(m); engine.setMemory(m); };
  const here = () => { const s = agg.current; return s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null; };
  const stations = new StationSource(); // through Betty's server (src/adapters/server)
  const notYet = async () => ({ error: 'That is not on this phone yet.' });

  return {
    filled_up: async () => { ride.filledUp(); return { ok: true, range_km_to_reserve: Math.round(kmToReserve(CONFIG.fuel)) }; },
    set_quiet: async (a) => {
      const min = Number(a.minutes ?? 0);
      engine.setQuiet(min > 0 ? Date.now() + min * 60_000 : Infinity);
      // "Until Heidelberg" needs a place watch: until then it is quiet until he says to talk again.
      return { ok: true, quiet_for: min > 0 ? `${min} minutes` : a.until_place ? `until he says to talk again (no place watch yet for ${a.until_place})` : 'until he says to talk again' };
    },
    talk_again: async () => { engine.setQuiet(0); return { ok: true }; },
    mark_spot: async (a) => {
      const h = here();
      if (!h) return { error: 'No GPS fix, so the spot cannot be marked.' };
      const near = agg.current.area?.suburb ?? agg.current.area?.town ?? null;
      await save(addMark(memory.current, { at: Date.now(), lat: h.lat, lon: h.lon, note: String(a.note ?? ''), near }));
      return { ok: true, near };
    },
    remember_note: async (a) => { await save(addNote(memory.current, String(a.note ?? ''), Date.now())); return { ok: true }; },
    my_notes_and_spots: async () => ({ kept: describeMemory(memory.current, here(), Date.now()) || 'Nothing kept yet.' }),
    fuel_stations_ahead: async () => {
      const h = here();
      if (!h) return { error: 'No GPS fix, so stations cannot be found.' };
      const list = await stations.near(h.lat, h.lon, true);
      const fuel = engine.fuelNow();
      const ahead = stationsAhead(list, h, agg.current.headingDeg);
      return { stations: describeStations(ahead, Math.round(fuel?.kmToEmpty ?? 0)), range_km_to_reserve: engine.fuelKmLeft() };
    },
    weather_along_route: async () => ({ error: 'No route is planned on this phone.' }),
    recall_ride: notYet,
    maintenance_due: notYet,
  };
}
