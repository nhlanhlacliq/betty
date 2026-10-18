import { CONFIG } from '../../src/config/betty';
import { AudioQueue, QueueItem } from '../../src/core/AudioQueue';
import { ClaudeClient, restAfter, voiceTags } from '../../src/core/ClaudeClient';
import type { LatLon } from '../../src/core/geo';
import { StateAggregator } from '../../src/core/StateAggregator';
import { TriggerEngine, isSafeWindow } from '../../src/core/TriggerEngine';
import type { BikeState, DataSource, TriggerEvent } from '../../src/core/types';
import { WeatherSource } from '../../src/adapters/WeatherSource';
import { ExpoGeoSource } from './adapters/ExpoGeoSource';
import { ExpoSpeaker, setUpAudio } from './adapters/ExpoSpeaker';
import { SERVER_HEADERS, api } from './server';

/**
 * A ride in the native app: the same pipeline as the web app's main.ts (sources -> StateAggregator -> TriggerEngine
 * -> ClaudeClient -> AudioQueue -> Speaker), wired with native adapters. Wiring only, no business logic: that stays
 * in ../src/core so both apps behave the same.
 *
 * First slice (2026-10-18): GPS, weather, Claude through the server, the phone's voice, optional real OBD. Not yet:
 * traffic, places, area stories, routes, push-to-talk, saved rides/log, cloud voices, background running.
 */
export interface Line { at: number; head: string; text: string; item: QueueItem | null }
export interface RideHooks {
  line: (l: Line) => void;
  state: (s: BikeState) => void;
  /** An OBD2 source to add (real reader), or none */
  obd?: DataSource;
}

export async function startRide(h: RideHooks) {
  const agg = new StateAggregator();
  const pos = (): LatLon => {
    const s = agg.current;
    return s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : CONFIG.feeds.fallbackLocation;
  };
  const log = (head: string, text: string) => h.line({ at: Date.now(), head, text, item: null });
  agg.addSource(new ExpoGeoSource((m) => log('[gps]', m)));
  agg.addSource(new WeatherSource(pos, () => {}));
  if (h.obd) agg.addSource(h.obd);

  const engine = new TriggerEngine();
  const claude = new ClaudeClient(undefined, 2500, 6000, api('/api/phrase'), SERVER_HEADERS);
  await setUpAudio();
  const speaker = new ExpoSpeaker((m) => log('[audio]', m));
  const queue = new AudioQueue(speaker, () => isSafeWindow(agg.current));

  const say = async (ev: TriggerEvent) => {
    // His answers: the first sentence is queued as soon as it is written (see ClaudeClient PhraseOptions). React
    // Native's fetch cannot stream yet, so for now it arrives with the whole answer; expo/fetch streams (next step).
    let early: QueueItem | null = null;
    const p = await claude.phrase(ev, agg.current, ev.riderSaid ? { early: (t) => { early = queue.enqueue(t, ev.priority, ev.id); } } : {});
    const rest = early && p.early ? restAfter(p.text, p.early) : p.text;
    const item = (rest ? queue.enqueue(rest, ev.priority, ev.id) : null) ?? early;
    h.line({ at: Date.now(), head: `[P${ev.priority}] ${ev.id} (${p.source}${p.detail ? `: ${p.detail}` : ''}, ${p.latencyMs} ms)`, text: voiceTags(p.text, false) || '(silent)', item });
    return item;
  };

  const unsub = agg.subscribe((s) => {
    h.state(s);
    engine.evaluate(s).forEach((ev) => void say(ev));
    queue.pump();
  });
  await agg.start();

  // The briefing once there is a GPS fix and weather (up to the configured wait), as on the web.
  let ended = false;
  void (async () => {
    const until = Date.now() + CONFIG.feeds.briefingWaitMs;
    while (!ended && Date.now() < until && (agg.current.weather === null || agg.current.lat == null)) await new Promise((r) => setTimeout(r, 250));
    if (!ended) void say(engine.startup(agg.current));
  })();

  return {
    ask: (text: string) => void say(engine.ask(text, agg.current)),
    /** Stop reacting, say the sign-off, then tear down (as main.ts does). */
    async end() {
      ended = true;
      unsub();
      const item = await say(engine.force('ride_debrief', agg.current));
      const until = Date.now() + 45_000;
      while (item && (item.fate === 'queued' || item.fate === 'speaking') && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
      agg.stop();
      queue.clear();
    },
  };
}
export type Ride = Awaited<ReturnType<typeof startRide>>;
