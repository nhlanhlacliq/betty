import { CONFIG } from '../../../src/config/betty';
import { RiderMemory, addMark, addNote, describeMemory } from '../../../src/core/Commands';
import { describeStations, kmToReserve, stationsAhead } from '../../../src/core/Fuel';
import { pastRecall } from '../../../src/core/PastRides';
import { describeDue } from '../../../src/core/Reminders';
import { checkpoints, weatherLine } from '../../../src/core/RouteAhead';
import { LineLogStore } from '../../../src/adapters/LineLogStore';
import { RideLog } from '../../../src/adapters/RideLog';
import { RiderMemoryStore } from '../../../src/adapters/RiderMemoryStore';
import { fetchRouteWeather } from '../../../src/adapters/RouteWeather';
import { ServiceStore } from '../../../src/adapters/ServiceStore';
import { StationSource } from '../../../src/adapters/StationSource';
import type { RideSession } from '../../../src/app/RideSession';
import type { PhoneTool } from './VoiceSession';

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

/**
 * The tools the voice server asks the PHONE to carry out (voice/betty_voice/tools.py lists them): the phone owns the
 * ride, its memory and settings, all in the shared stores (src/adapters, the same the web app keeps). Each returns
 * facts or {error} that she says plainly.
 */
export function phoneTools(ride: RideSession): Record<string, PhoneTool> {
  const { engine, agg } = ride;
  const memory = () => RiderMemoryStore.load();
  const save = async (m: RiderMemory) => { RiderMemoryStore.save(m); engine.setMemory(m); };
  const here = () => { const s = agg.current; return s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null; };
  const stations = new StationSource(); // through Betty's server (src/adapters/server)

  return {
    filled_up: async () => { ride.filledUp(); return { ok: true, range_km_to_reserve: Math.round(kmToReserve(CONFIG.fuel)) }; },
    set_quiet: async (a) => {
      const min = Number(a.minutes ?? 0);
      engine.setQuiet(min > 0 ? Date.now() + min * 60_000 : Infinity);
      ride.queue.dropAmbient();
      // "Until Heidelberg" needs a place watch: until then it is quiet until he says to talk again.
      return { ok: true, quiet_for: min > 0 ? `${min} minutes` : a.until_place ? `until he says to talk again (no place watch yet for ${a.until_place})` : 'until he says to talk again' };
    },
    talk_again: async () => { engine.setQuiet(0); return { ok: true }; },
    mark_spot: async (a) => {
      const h = here();
      if (!h) return { error: 'No GPS fix, so the spot cannot be marked.' };
      const near = agg.current.area?.suburb ?? agg.current.area?.town ?? null;
      await save(addMark(memory(), { at: Date.now(), lat: h.lat, lon: h.lon, note: String(a.note ?? ''), near }));
      return { ok: true, near };
    },
    remember_note: async (a) => { await save(addNote(memory(), String(a.note ?? ''), Date.now())); return { ok: true }; },
    my_notes_and_spots: async () => ({ kept: describeMemory(memory(), here(), Date.now()) || 'Nothing kept yet.' }),
    fuel_stations_ahead: async () => {
      const h = here();
      if (!h) return { error: 'No GPS fix, so stations cannot be found.' };
      const list = await stations.near(h.lat, h.lon, true);
      const fuel = engine.fuelNow();
      const ahead = stationsAhead(list, h, agg.current.headingDeg);
      return { stations: describeStations(ahead, Math.round(fuel?.kmToEmpty ?? 0)), range_km_to_reserve: engine.fuelKmLeft() };
    },
    // The weather at each stop when he gets there: what the ride fetched (every 30 min), or fetched now.
    weather_along_route: async () => {
      const now = engine.routeNow();
      if (!now) return { error: 'No route is planned.' };
      const cps = checkpoints(now.route, now.progress);
      let wx = engine.routeWeather();
      if (!wx.length) { wx = (await fetchRouteWeather(cps)) ?? []; if (wx.length) engine.setRouteWeather(wx); }
      if (!wx.length) return { error: 'The weather along the route could not be fetched just now.' };
      return { route: now.route.name, stops: wx.map((w) => ({ place: w.name, arrive_about: hhmm(w.at), weather: weatherLine(w).replace('°', ' C') })) };
    },
    // An earlier ride from the saved log ("Saturday", "the ride to Clarens"; the last ride when nothing matches).
    recall_ride: async (a) => {
      const when = String(a.when ?? 'last ride');
      const found = pastRecall(RideLog.load(), LineLogStore.load(), `remember ${when}`, Date.now());
      return found ? { ride: found } : { error: `No saved ride matches "${when}".` };
    },
    maintenance_due: async () => ({ reminders: describeDue(ServiceStore.load(), Date.now(), true), odometer_km: Math.round(ServiceStore.load().odoKm) }),
    reminder_done: async (a) => {
      const r = ride.reminderDone(String(a.what ?? ''));
      return r ? { ok: true, reminder: r.name, next_due: r.next } : { error: `There is no reminder for "${a.what}".` };
    },
    // The phone says her sign-off and closes the ride, a moment after this answer has reached the server.
    end_ride: async () => {
      if (ride.ending) return { error: 'The ride is already ending.' };
      setTimeout(() => ride.requestEnd(), 1500);
      return { ok: true, note: 'The phone is ending the ride and says your sign-off itself: say nothing more, or at most "Right."' };
    },
  };
}
