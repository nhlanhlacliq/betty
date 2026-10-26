import { CONFIG, ObdMode, applyMode, applyTalkPreset, currentDials, currentMode, currentTalkPreset, mixSummary, nudgeLength, nudgeMix, nudgeVoice, setMixShare } from '../config/betty';
import { saveConfig } from '../config/persist';
import { AudioQueue, Fate, QueueItem, SpeakTag, Speaker } from '../core/AudioQueue';
import { ClaudeClient, Phrase, restAfter } from '../core/ClaudeClient';
import { Command, addMark, addNote, forgetLast, parseCommand } from '../core/Commands';
import { kmToReserve } from '../core/Fuel';
import { saysDetour, saysFilledUp } from '../core/Heard';
import type { LatLon } from '../core/geo';
import { pastRecall } from '../core/PastRides';
import { liveRecords } from '../core/Records';
import { ServiceBook, canUndo, dueInfo, dueText, findReminder, islandReminder, markDone, undoDone } from '../core/Reminders';
import { toRecord } from '../core/RideMemory';
import { RoadMemory } from '../core/RoadMemory';
import { checkpoints } from '../core/RouteAhead';
import { roughSpots } from '../core/RoughSpots';
import { NO_OBD, StateAggregator } from '../core/StateAggregator';
import { TrackPoint, addTrackPoint } from '../core/Track';
import { TriggerEngine, isSafeWindow } from '../core/TriggerEngine';
import { placesFromHere } from '../core/ambient';
import { AMBIENT_IDS, BikeState, DataSource, TriggerEvent } from '../core/types';
import { AreaSource, ToldStore, researchAhead } from '../adapters/AreaSource';
import { FuelStore } from '../adapters/FuelStore';
import { HorizonDismissed } from '../adapters/HorizonDismissed';
import { IncidentMemory } from '../adapters/IncidentMemory';
import { LandmarkSource, LandmarkTold } from '../adapters/LandmarkSource';
import { StopStore, researchStops } from '../adapters/AreaSource';
import { stopsArea } from '../core/Stops';
import { GearStore } from '../adapters/GearStore';
import { LineBankStore } from '../adapters/LineBankStore';
import { LineLogStore } from '../adapters/LineLogStore';
import { PlaceSource } from '../adapters/PlaceSource';
import { ProfileStore } from '../adapters/ProfileStore';
import { RideLog } from '../adapters/RideLog';
import { RiderMemoryStore } from '../adapters/RiderMemoryStore';
import { RoadCells } from '../adapters/RoadCells';
import { RoadStore } from '../adapters/RoadStore';
import { RouteStore } from '../adapters/RouteStore';
import { fetchRouteWeather } from '../adapters/RouteWeather';
import { ServiceStore } from '../adapters/ServiceStore';
import { StationSource } from '../adapters/StationSource';
import { TrackStore } from '../adapters/TrackStore';
import { TrafficProvider, TrafficSource } from '../adapters/TrafficSource';
import { WeatherSource } from '../adapters/WeatherSource';
import { Glance, GlanceAction, RideInput, SaidLine, glanceCues, horizonSpoken } from '../ui/rideView';
import { LineLogger, settled } from './LineLogger';

/** One thing on the chat timeline: something he typed, or something she said (asked or unprompted). */
export type ChatEntry =
  | { from: 'rider'; text: string; at: number }
  | { from: 'betty'; text: string; at: number; ev: TriggerEvent; phrase: Phrase }
  /** Her reply to a command ("quiet for ten minutes"): carried out on the phone, no Claude call */
  | { from: 'betty'; text: string; at: number; command: string };

/** What she says when an answer is slow (usually a web search), and how slow counts. */
export const HANG_ON = 'Hang on, let me check.';
const HANG_ON_AFTER_MS = 2500;
/** Longest END RIDE waits for the sign-off before shutting down regardless. */
export const SIGN_OFF_LIMIT_MS = 45_000;

/** A promise, or an error after `ms`. */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what} took longer than ${ms / 1000} s`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

/** Her voice as the ride uses it. A cloud voice can fetch audio ahead (`prefetch`) and say when a clip is in (`ready`). */
export interface RideVoice {
  speaker: Speaker;
  /** False in the Workshop's silent mode: lines are timed, not spoken, and no audio is fetched. */
  aloud(): boolean;
  prefetch?(text: string, tag: SpeakTag): void;
  ready?(text: string, tag: SpeakTag): Promise<unknown>;
  /** Her sound is not reaching him (native: the phone's own speaker, no helmet). With CONFIG.onPhoneSpeaker 'alerts'
   *  her own remarks are left out meanwhile. */
  away?(): boolean;
}

/** What the app does when the ride changes. All optional: the native app and the web app each listen to what they show. */
export interface RideEvents {
  /** Something on the ride screen may have changed (state, her line, quiet, route...). */
  changed?(): void;
  /** Every update of the bike state. */
  state?(s: BikeState): void;
  chat?(e: ChatEntry): void;
  /** Her newest line (for "repeat that" and the lock screens). */
  lastLine?(text: string): void;
  /** The fuel count was reset (he filled up). */
  fuelChanged?(): void;
  /** Notes or marked spots changed. */
  memoryChanged?(): void;
  /** A setting changed by voice (CONFIG is already saved). */
  configChanged?(): void;
  /** He said "end ride": the app runs its own end (which calls wrapUp/signOff/shutdown). */
  endRequested?(): void;
  toast?(msg: string): void;
}

export interface RideDeps {
  /** Phone sensors in use (false = a simulated desk test) */
  real: boolean;
  /** The Workshop's desk chat: same rig, simulated, no briefing, never saved as a ride */
  desk: boolean;
  /** Betty's server is there (area stories, petrol stations, line bank, stories ahead) */
  server: boolean;
  claude: ClaudeClient;
  voice: RideVoice;
  logger: LineLogger;
  /** The platform's sensors: GPS, motion */
  sensors: DataSource[];
  /** A line on what the sensors delivered (motion diagnostics), for the `[sensors]` log line */
  sensorNote?: () => string;
  traffic: TrafficProvider | null;
  /** Switch the engine feed (web: the mock); without it OBD stays off. Called with 'off' at the end. */
  setObd?: (mode: ObdMode, push: (p: Partial<BikeState>) => void) => void;
  events?: RideEvents;
}

/** The island's maintenance cue: overdue, or due within 500 km or a week. */
const islandService = (book: ServiceBook | null) => {
  const d = book ? islandReminder(book, Date.now()) : null;
  return d ? { name: d.r.name, text: dueText(d), due: d.state === 'due', kmLeft: d.kmLeft, key: d.r.id } : null;
};
const howLong = (min: number) => min === 60 ? 'an hour' : min === 30 ? 'half an hour' : min % 60 === 0 ? `${min / 60} hours` : `${min} minute${min === 1 ? '' : 's'}`;
const describe = (c: Command) => c.kind === 'preset' ? `preset ${c.preset}` : c.kind === 'mix' ? `${c.what} ${c.step > 0 ? 'up' : 'down'}`
  : c.kind === 'humour' || c.kind === 'persona' ? `${c.kind} ${c.set !== undefined ? `set ${c.set}` : `step ${c.step}`}`
    : c.kind === 'quiet' ? `quiet ${c.minutes === null ? 'until told' : `for ${c.minutes} min`}` : c.kind === 'mark' ? `mark${c.note ? `: ${c.note}` : ''}`
      : c.kind === 'remember' ? `remember: ${c.fact}` : c.kind;

/**
 * A ride (or a desk session), shared by the web app and the native app: sources -> StateAggregator -> TriggerEngine ->
 * ClaudeClient -> AudioQueue -> her voice, plus everything kept on the phone as the ride goes, her commands and his
 * questions. What differs per app comes in through `RideDeps` (sensors, voice, OBD, screens); this file has no
 * browser or React Native code.
 */
export class RideSession {
  readonly agg = new StateAggregator();
  readonly engine = new TriggerEngine();
  readonly queue: AudioQueue;
  readonly claude: ClaudeClient;
  /** The road ridden so far (the map, and kept with the ride) */
  readonly track: TrackPoint[] = [];
  /** What each feed is doing, for the Workshop */
  readonly feeds = { weather: 'idle', traffic: 'idle', places: 'idle', areas: 'idle', landmarks: 'idle' };
  readonly real: boolean;
  readonly desk: boolean;
  /** What she is saying now (once audible), the last line she finished, and his side of a conversation. */
  speaking: SaidLine | null = null;
  lastSaid: SaidLine | null = null;
  lastLine = '';
  talk: 'off' | 'listening' | 'thinking' = 'off';
  /** Set once END RIDE has begun */
  ending = false;
  private alive = true;
  private dismissed: string[];
  private heardTimer: ReturnType<typeof setTimeout> | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private unsub: () => void = () => {};
  private odoSaved = 0;
  private roadMem: RoadMemory | null;
  private stations = new StationSource();
  private weather: WeatherSource;
  private trafficSrc: TrafficSource;
  private places: PlaceSource;

  constructor(private d: RideDeps) {
    this.real = d.real; this.desk = d.desk;
    this.claude = d.claude;
    this.claude.useBank(LineBankStore); // her own alert lines when Claude cannot be asked (no signal, or a P1)
    const { agg, engine } = this;
    const pos = (): LatLon => {
      const s = agg.current;
      return s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : CONFIG.feeds.fallbackLocation;
    };
    this.weather = new WeatherSource(pos, (m) => { this.feeds.weather = m; });
    // Live traffic only on a real ride (not desk or simulated sessions), every 5 minutes, and not while parked.
    this.trafficSrc = new TrafficSource(d.real && !d.desk ? d.traffic : null, pos, (m) => { this.feeds.traffic = m; }, () => agg.current.speedKmh >= 5);
    this.places = new PlaceSource(pos, (m) => { this.feeds.places = m; });
    if (d.real && !d.desk) for (const s of d.sensors) agg.addSource(s);
    agg.addSource(this.weather);
    agg.addSource(this.trafficSrc);
    agg.addSource(this.places);

    const rides = RideLog.load();
    engine.setHistory(rides);
    if (!d.desk && d.real) engine.setRecords(liveRecords(rides)); // "your longest ride yet", "1,000 km together"
    this.dismissed = HorizonDismissed.load();
    engine.setKnownIncidents([...IncidentMemory.load(), ...this.dismissed]);
    d.logger.rideId = engine.rideSnapshot().startedAt; // ties each logged line to its ride record
    engine.setFuelKm(FuelStore.load());
    engine.setMemory(RiderMemoryStore.load());
    engine.setToldNotes(ToldStore.load());
    engine.setLandmarksTold(LandmarkTold.load());
    engine.setStopsLookup((area) => StopStore.get(area));
    if (d.real && !d.desk) engine.setGears(GearStore.load()); // the gears learned on earlier rides
    engine.setRoute(RouteStore.get()); // the route he planned, if any
    // Where he has ridden before: new roads, familiar ones (real rides only). Saved each minute and at the end.
    this.roadMem = !d.desk && d.real ? new RoadMemory(RoadCells.load(() => {
      const detailed = TrackStore.all(), rough = RoadStore.all(); // the detailed road where kept, the rough copy for older rides
      return [...Object.values(detailed), ...Object.entries(rough).filter(([id]) => !detailed[id]).map(([, t]) => t)];
    })) : null;
    engine.setRoadMemory(this.roadMem);
    engine.setRoughSpots(roughSpots(rides)); // bumps and hard brakes that keep happening in the same place
    // "What did we talk about on Saturday?": the saved log of the ride his words point at.
    engine.setPastRecall((said) => { d.logger.save(); return pastRecall(RideLog.load(), LineLogStore.load(), said, Date.now()); });
    engine.setServiceBook(ServiceStore.load()); // what is due (the briefing, answers and sign-off mention it)
    engine.setProfile(CONFIG.useProfile ? ProfileStore.get() : null); // what he chose to share, used lightly
    // History and culture of the area (researched on Betty's server). Each change of what it is doing goes in the log.
    // Landmarks he rides past (Wikidata + OpenStreetMap, researched once as he nears the best ones). Server only.
    if (d.server && !d.desk) agg.addSource(new LandmarkSource(
      () => { const s = agg.current; return s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null; },
      () => [agg.current.area?.town, agg.current.area?.region, 'South Africa'].filter(Boolean).join(', '),
      (m) => { this.log('[landmarks]', m); this.feeds.landmarks = m; },
    ));
    if (d.server) agg.addSource(new AreaSource(pos, () => new Set(engine.toldNoteIds()), (m) => { if (m !== this.feeds.areas) this.log('[areas]', m); this.feeds.areas = m; }));

    this.queue = new AudioQueue(d.voice.speaker, () => isSafeWindow(agg.current), Date.now, (item, fate) => this.onFate(item, fate), (item) => this.onHeard(item));
  }

  /** CONFIG.briefingFirst: settles once the briefing has been said (true) or will not be (false) */
  /** Areas whose good stops were asked for this ride (once each) */
  private stopsAsked = new Set<string>();
  private briefing: Promise<boolean> | null = null;
  private briefingSettled = false;
  private briefingItem: { item: QueueItem; settle: (covered: boolean) => void } | null = null;

  private get ev(): RideEvents { return this.d.events ?? {}; }
  log(head: string, text: string) { return this.d.logger.add(head, text); }
  private changed() { this.ev.changed?.(); }
  private configChanged() { saveConfig(); this.ev.configChanged?.(); }

  /** Her voice is audible: the ride screen shows the line from now (or 6 s after she started, whichever is first). */
  private onHeard(item: QueueItem) {
    clearTimeout(this.heardTimer);
    if (item.fate !== 'speaking') return;
    this.speaking = { text: item.text, tag: item.tag, priority: item.priority, at: Date.now() };
    this.changed();
  }
  private onFate(item: QueueItem, fate: Fate) {
    if (this.briefingItem?.item === item && fate !== 'queued' && fate !== 'speaking') { this.briefingItem.settle(fate === 'spoken'); this.briefingItem = null; }
    const said: SaidLine = { text: item.text, tag: item.tag, priority: item.priority, at: Date.now() };
    if (fate === 'speaking') { clearTimeout(this.heardTimer); this.heardTimer = setTimeout(() => this.onHeard(item), 6000); }
    else {
      if (this.speaking && this.speaking.text === item.text) this.speaking = null;
      if (fate === 'spoken') { this.lastSaid = said; clearTimeout(this.heardTimer); }
    }
    this.d.logger.saveSoon();
    this.d.logger.onChange();
    this.changed();
  }
  private setLast(text: string) { this.lastLine = text; this.ev.lastLine?.(text); }

  /** Start the feeds, the engine feed and the briefing. */
  async start() {
    const { agg, engine, d } = this;
    // The weather where he will be along the route, when he gets there: now, then every 30 minutes; and stories for
    // the towns on it researched before he arrives (if they were not when he planned it).
    const routeWx = async () => {
      const now = engine.routeNow();
      if (!now || d.desk) return;
      const l = await fetchRouteWeather(checkpoints(now.route, now.progress));
      if (l && this.alive) { engine.setRouteWeather(l); this.log('[route]', `weather ahead: ${l.map((w) => `${w.name} ${w.rainPct}%`).join(', ') || 'nothing ahead'}`); }
    };
    void routeWx();
    this.timers.push(setInterval(() => void routeWx(), 30 * 60_000));
    if (d.server && !d.desk) { const r0 = engine.routeNow()?.route; if (r0) void researchAhead(r0.stops.filter((s, i) => s.named && i > 0), (msg) => this.log('[areas]', msg)); }
    // Saved as the ride goes, not only at END RIDE: a phone can kill the app without warning.
    this.timers.push(setInterval(() => this.remember(), 60_000));
    this.timers.push(setInterval(() => this.logSensors(), 15 * 60_000));
    this.timers.push(setInterval(() => this.changed(), 5000)); // lets a finished line settle back to idle

    this.unsub = agg.subscribe((s) => {
      if (s.lat != null && s.lon != null) addTrackPoint(this.track, { lat: s.lat, lon: s.lon });
      this.ev.state?.(s);
      // Petrol stations ahead once the fuel is getting low (within 40 km of the warning), for her warning and answers.
      const toReserve = s.obd ? null : engine.fuelKmLeft();
      if (d.server && !d.desk && toReserve !== null && toReserve <= CONFIG.fuel.warnKmLeft + 40 && s.lat != null && s.lon != null) {
        void this.stations.near(s.lat, s.lon).then((l) => engine.setStations(l));
      }
      // Stopped a while: the good places here are looked up once (kept per area), in time for her suggestion.
      const here = CONFIG.stopsOn && d.server && !d.desk ? stopsArea(s.area) : null;
      if (here && !this.stopsAsked.has(here) && StopStore.get(here) === null && engine.stillForMs() >= CONFIG.stops.researchAfterSec * 1000) {
        this.stopsAsked.add(here);
        this.log('[stops]', `finding good stops in ${here}`);
        void researchStops(here, [s.area?.region, 'South Africa'].filter(Boolean).join(', '))
          .then((l) => this.log('[stops]', `${here}: ${l.length ? l.map((x) => x.name).join(', ') : 'none found'}`), (e) => this.log('[stops]', `${here}: lookup failed (${(e as Error).message})`));
      }
      engine.evaluate(s).forEach((ev) => void this.say(ev));
      this.queue.pump();
      this.changed();
    });
    await agg.start();
    this.setObd(CONFIG.obdMode);
    // The pre-ride briefing: wait (briefly) for the weather and a GPS fix, so she has something to tell him.
    if (!d.desk) {
      let settle: (covered: boolean) => void = () => {};
      if (CONFIG.briefingFirst) {
        this.briefing = new Promise<boolean>((r) => { settle = (c) => { if (!this.briefingSettled) { this.briefingSettled = true; r(c); } }; });
        setTimeout(() => settle(false), CONFIG.feeds.briefingWaitMs + CONFIG.lineRules.briefingHoldMaxMs); // never held for long
      }
      void (async () => {
        const until = Date.now() + CONFIG.feeds.briefingWaitMs;
        const ready = () => agg.current.weather !== null && (!this.real || agg.current.lat != null);
        await new Promise((r) => setTimeout(r, 0)); // let the ride finish setting up first
        while (Date.now() < until && !ready()) await new Promise((r) => setTimeout(r, 250));
        if (!this.alive || this.ending) return settle(false);
        const item = await this.say(engine.startup(agg.current));
        if (!item) return settle(false);
        this.briefingItem = { item, settle };
      })();
    }
  }

  /** The engine feed: on (the mode) or off. */
  setObd(mode: ObdMode) {
    if (this.d.setObd) this.d.setObd(mode, (p) => this.agg.push(p));
    else if (mode === 'off') this.agg.push(NO_OBD);
  }

  refreshFeeds() { this.weather.refresh(); this.trafficSrc.refresh(); this.places.refresh(); }

  /** Workshop: reset the ride (cooldowns, talk memory, queue, the screen's lines). */
  reset() {
    this.engine.reset(); this.claude.forgetTalk(); this.queue.clear(); this.d.logger.clearScreen();
    this.d.logger.rideId = this.engine.rideSnapshot().startedAt;
  }

  /** Everything kept on the phone as the ride goes. */
  remember() {
    const { engine, agg, d } = this;
    const w = agg.current.weather;
    const rec = d.desk ? null : toRecord(engine.rideSnapshot(), w ? `${w.summary}, ${w.tempC} C` : null, CONFIG.fuel);
    if (rec) RideLog.save(rec);
    FuelStore.save(engine.kmSinceFill());
    // Betty's odometer (service reminders): only real rides count, as a delta so an odometer set mid-ride is kept.
    if (!d.desk && d.real) { const km = engine.rideSnapshot().distanceKm; ServiceStore.addKm(km - this.odoSaved); this.odoSaved = km; engine.setServiceBook(ServiceStore.load()); }
    IncidentMemory.save(engine.announcedIncidents());
    if (this.roadMem?.cellsThisRide) RoadCells.save(this.roadMem.merged());
    TrackStore.save(engine.rideSnapshot().startedAt, this.track);
    if (!d.desk) RoadStore.save(engine.rideSnapshot().startedAt, this.track);
    ToldStore.save(engine.toldNoteIds());
    LandmarkTold.save(engine.landmarksTold());
    if (!d.desk && d.real && Object.keys(engine.gearBins()).length) GearStore.save(engine.gearBins());
  }

  /** What the sensors actually delivered, written into the log now and then and at END RIDE. */
  logSensors() {
    const s = this.agg.current; const r = this.engine.rideSnapshot();
    this.log('[sensors]', `${this.real ? (this.d.sensorNote?.() ?? 'phone sensors') : 'simulated session'}; `
      + `GPS altitude ${s.altitudeM ?? 'none'}, course ${s.headingDeg == null ? 'none' : Math.round(s.headingDeg) + ' deg'}; `
      + `ride so far: deepest lean ${r.maxLeanDeg} deg, ${r.stops} stops, ${r.hardBrakes} hard brakes, ${r.hardAccels} hard pulls, ${r.jolts} jolts`);
  }

  /**
   * Phrase an event and queue it. `now`: cut off whatever she is saying (never a P1), e.g. the sign-off. His questions
   * are streamed: the first sentence is queued the moment it is written (`onFirst` is told, to cancel "Hang on"), and
   * only the rest once the answer is complete.
   */
  say = async (ev: TriggerEvent, now = false, onFirst?: () => void): Promise<QueueItem | null> => {
    const { voice } = this.d;
    const { queue, engine, agg } = this;
    // A warning that came up before her briefing waits for it; one the briefing covers is not said again.
    if (ev.priority === 2 && this.briefing && !this.briefingSettled) {
      const covered = await this.briefing;
      if (covered && CONFIG.lineRules.briefingCovers.includes(ev.id)) {
        this.log(`[P2] ${ev.id}`, '(left out: the briefing covered it)');
        return null;
      }
    }
    const tag = { priority: ev.priority, id: ev.id };
    let earlyItem: QueueItem | null = null;
    const early = ev.riderSaid ? (sentence: string) => {
      onFirst?.();
      if (voice.aloud()) voice.prefetch?.(sentence, tag);
      earlyItem = now ? queue.interrupt(sentence, ev.priority, ev.id) : queue.enqueue(sentence, ev.priority, ev.id);
      this.setLast(sentence);
    } : undefined;
    const p = await this.claude.phrase(ev, agg.current, { early });
    // Her own lines (slow cloud voices) are queued only once their audio is in, so they never block an answer.
    if (p.text && voice.aloud() && ev.priority === 3) await voice.ready?.(p.text, tag);
    // Safety stays serious: an ambient line that comes back while a critical condition is active is dropped. So is
    // one that arrives after he asked for quiet.
    const critical = AMBIENT_IDS.includes(ev.id) && engine.ambientBlocked(agg.current);
    const hushed = ev.priority === 3 && engine.quietLeftMin() > 0;
    const away = ev.priority === 3 && CONFIG.onPhoneSpeaker === 'alerts' && !!voice.away?.();
    const onCall = ev.priority === 3 && this.onCall;
    const text = critical || hushed || away || onCall ? '' : p.text;
    const meta = `${p.source}${p.detail ? ': ' + p.detail : ''}, ${p.latencyMs} ms`;
    const line = this.log(`[P${ev.priority}] ${ev.id} (${meta})`, text || (critical ? '(dropped: critical alert active)' : hushed ? '(dropped: he asked for quiet)' : away ? '(dropped: her sound is on the phone speaker)' : onCall ? '(dropped: you were on a call)' : '(silent)'));
    // What is still to be said: all of it, or what follows the first sentence that already went ahead.
    const toSay = p.early && earlyItem ? restAfter(text, p.early) : text;
    if (toSay && voice.aloud()) voice.prefetch?.(toSay, tag); // fetch the audio while it waits its turn
    const rest = !toSay ? null : now && !earlyItem ? queue.interrupt(toSay, ev.priority, ev.id) : queue.enqueue(toSay, ev.priority, ev.id);
    line.item = rest ?? earlyItem;
    this.ev.chat?.({ from: 'betty', text: line.text, at: Date.now(), ev, phrase: p });
    this.d.logger.onChange();
    if (text) this.setLast(text);
    return line.item;
  };

  /**
   * The voice server's conversation is talking (his turn, or her answer through the call): her own lines wait and the
   * one playing stops, so two voices never talk at once (first phone tests, 2026-10-24: a status update and her answer
   * played together). A critical alert still goes. Off: the waiting lines play in the usual order.
   */
  conversation(on: boolean) {
    if (on === this.talking) return;
    this.talking = on;
    if (on) this.queue.cutOff();
    this.applyHold();
  }
  private talking = false;
  /** A phone call is on (native, CallKit). With CONFIG.quietOnCall her lines wait until it ends (a critical alert
   *  still goes), her own remarks are dropped, and the one she was saying stops. */
  private onCall = false;
  phoneCall(on: boolean) {
    const quiet = on && CONFIG.quietOnCall;
    if (quiet === this.onCall) return;
    this.onCall = quiet;
    this.log('[voice]', quiet ? 'on a call: her lines wait, her own remarks are left out' : 'call over: her lines carry on');
    if (quiet) { this.queue.cutOff(); this.queue.dropAmbient(); }
    this.applyHold();
  }
  get inCall() { return this.onCall; }
  private applyHold() { const h = this.talking || this.onCall; if (h !== this.queue.isHeld) this.queue.hold(h); }

  /** A line said at once from the phone. `now`: cut off whatever she is saying (going quiet, coming back), never a P1. */
  sayNow(text: string, now = false) {
    if (this.d.voice.aloud()) this.d.voice.prefetch?.(text, { priority: 4, id: 'voice' });
    this.log('[P4] voice', text).item = now ? this.queue.interrupt(text, 4, 'voice') : this.queue.enqueue(text, 4, 'voice');
    this.d.logger.onChange();
  }
  /** Her reply to a command: instant, from the phone, no Claude call (so it also works without signal). */
  private reply(text: string, command: string, now = false) { this.sayNow(text, now); this.ev.chat?.({ from: 'betty', text, at: Date.now(), command }); }
  private remembered(m: ReturnType<typeof RiderMemoryStore.load>) { RiderMemoryStore.save(m); this.engine.setMemory(m); this.ev.memoryChanged?.(); }

  /** A maintenance job done ("chain done", the voice server's reminder_done): the reminder and when it is next due, or null. */
  reminderDone(what: string): { name: string; next: string } | null {
    const book = ServiceStore.load();
    const r = findReminder(book.items, what);
    if (!r) return null;
    const next = markDone(book, r.id, Date.now());
    ServiceStore.save(next);
    this.engine.setServiceBook(next);
    return { name: r.name, next: dueText(dueInfo(next.items.find((x) => x.id === r.id)!, next.odoKm, Date.now())) };
  }

  /** "End ride" (a command or the voice server's end_ride): the app runs its end. False when there is no ride to end. */
  requestEnd(): boolean {
    if (!this.alive || this.desk || this.ending) return false;
    this.ev.endRequested?.();
    return true;
  }

  /** He filled up (the button, Horizon's card, or said so in passing). */
  filledUp() { this.engine.filledUp(); FuelStore.save(0); this.ev.fuelChanged?.(); }

  /** Horizon: he dismissed a traffic card. Hidden for a week, and she will not announce or brief him on it. */
  dismiss(key: string) { HorizonDismissed.add(key); this.dismissed = HorizonDismissed.load(); this.engine.knowIncident(key); this.changed(); }

  /** Repeat her last line ("repeat that", next track, the orb). False when she has said nothing yet. */
  repeat() { if (!this.lastLine) return false; this.sayNow(this.lastLine, true); return true; }

  toggleQuiet() { this.obey(this.engine.quietLeftMin() > 0 ? { kind: 'talk' } : { kind: 'quiet', minutes: null }); this.changed(); }

  /** Horizon's one button per card. False for a card whose action is the app's own (Up ahead opens a sheet). */
  island(kind: GlanceAction, g: Glance): boolean {
    if (kind === 'filled') { this.filledUp(); this.ev.toast?.(`Fill-up noted: about ${Math.round(kmToReserve(CONFIG.fuel))} km of range.`); this.changed(); }
    else if (kind === 'ask-rain') void this.ask('Is the rain going to last, and will it catch me on this ride?');
    else if (kind === 'ask-traffic') void this.ask('Tell me about the traffic on my way.');
    else if (kind === 'ask-place') void this.ask(`Tell me about ${g.value}.`);
    else if (kind === 'story') {
      const ev = this.engine.force('area_story', this.agg.current);
      if (ev.context) void this.say(ev); else void this.ask('Tell me something about this area.');
    } else return false;
    return true;
  }

  /** What the ride screen is built from (ui/rideView `rideView`, `glanceCues`). */
  rideInput(): RideInput {
    const { agg, engine } = this;
    const s = agg.current;
    const told = new Set(engine.toldNoteIds());
    const snap = engine.rideSnapshot();
    const routeNow = engine.routeNow();
    return {
      now: Date.now(), state: s, speaking: this.speaking, lastSaid: this.lastSaid, talk: this.talk, quietMin: engine.quietLeftMin(), ending: this.ending,
      distanceKm: snap.distanceKm, minutesOut: CONFIG.ridingTimeOnly ? snap.movingMin : snap.minutesOut, fuelKmLeft: s.obd ? null : engine.fuelKmLeft(), fuelWarnKm: CONFIG.fuel.warnKmLeft,
      rainChancePct: CONFIG.thresholds.rainChancePct, trafficRadiusKm: CONFIG.thresholds.trafficRadiusKm,
      untoldStories: s.areaNotes.filter((n) => !told.has(n.id)).length, showGlance: CONFIG.showGlance,
      route: routeNow?.progress ? { name: routeNow.route.name, leftKm: routeNow.progress.leftKm, leftMin: routeNow.progress.leftMin, next: routeNow.progress.next, offKm: routeNow.progress.offKm, doneKm: routeNow.progress.doneKm, detour: engine.onDetour() } : null,
      fuelRangeKm: Math.round(kmToReserve(CONFIG.fuel)),
      service: islandService(engine.serviceBook()),
      dismissed: this.dismissed,
    };
  }

  /** Voice stage 3: things he tells her to do rather than asks. */
  obey(c: Command) {
    const { engine, agg, queue } = this;
    this.log('[command]', describe(c));
    switch (c.kind) {
      case 'repeat': this.reply(this.lastLine || "I haven't said anything yet.", 'repeat', true); return;
      case 'quiet':
        engine.setQuiet(c.minutes === null ? Infinity : Date.now() + c.minutes * 60_000);
        queue.dropAmbient();
        this.reply(c.minutes === null
          ? "Going quiet. Say talk to me when you want me back. Alerts still come through."
          : `Quiet for ${howLong(c.minutes)}. Alerts still come through.`, 'quiet', true);
        return;
      case 'talk':
        if (engine.quietLeftMin() > 0) { engine.setQuiet(0); this.reply("I'm back.", 'talk again', true); } else this.reply('I never left.', 'talk again', true);
        return;
      case 'mark': {
        const s = agg.current;
        if (s.lat == null || s.lon == null) { this.reply("I've got no GPS fix, so I can't mark this spot.", 'mark'); return; }
        const near = placesFromHere(s).filter((p) => p.distanceKm <= 3).sort((a, b) => a.distanceKm - b.distanceKm)[0]?.name ?? null;
        this.remembered(addMark(RiderMemoryStore.load(), { at: Date.now(), lat: s.lat, lon: s.lon, note: c.note, near }));
        this.reply(`Marked${near ? `, near ${near}` : ''}.`, 'mark');
        return;
      }
      case 'remember':
        this.remembered(addNote(RiderMemoryStore.load(), c.fact, Date.now()));
        this.reply("Noted. I'll remember that.", 'remember');
        return;
      case 'humour': case 'persona': {
        const pz = CONFIG.persona;
        const field = c.kind === 'humour' ? 'humour' : 'tars';
        pz[field] = Math.min(100, Math.max(0, c.set ?? pz[field] + (c.step ?? 0)));
        this.configChanged();
        this.reply(c.kind === 'humour'
          ? pz.humour === 0 ? 'Humour at zero. Facts only.' : pz.humour === 100 ? 'Humour at a hundred percent. You asked for it.' : `Humour at ${pz.humour} percent.`
          : `${100 - pz.tars} percent JARVIS, ${pz.tars} percent TARS.`, c.kind);
        return;
      }
      case 'settings': {
        const pz = CONFIG.persona;
        const quiet = engine.quietLeftMin();
        this.reply(`Humour ${pz.humour} percent. ${100 - pz.tars} percent JARVIS, ${pz.tars} TARS. ${mixSummary()}`
          + (quiet === Infinity ? ' Quiet until you say otherwise.' : quiet > 0 ? ` Quiet for another ${quiet} minutes.` : ''), 'settings');
        return;
      }
      case 'preset': case 'mix': {
        // The Settings screen's "How often should I talk?" by voice, and nudges to the mix (owner, 2026-10-17).
        if (c.kind === 'preset') applyTalkPreset(c.preset); else nudgeMix(c.what, c.step);
        this.configChanged();
        const name = c.kind === 'preset' ? `${c.preset[0].toUpperCase()}${c.preset.slice(1)}. ` : '';
        this.reply(`${name}${mixSummary()}`, c.kind);
        return;
      }
      case 'fuelset': {
        if (c.what === 'consumption') CONFIG.fuel.lPer100 = c.value;
        else { CONFIG.fuel.pricePerL = c.value; CONFIG.fuel.priceSource = 'manual'; CONFIG.fuel.priceAt = Date.now(); }
        this.configChanged();
        this.reply(c.what === 'consumption'
          ? `${c.value} litres per hundred. That's about ${Math.round(kmToReserve(CONFIG.fuel))} kilometres to reserve on a full tank.`
          : `Petrol at R${c.value.toFixed(2)} a litre. Noted.`, 'fuelset');
        return;
      }
      case 'done': {
        const r = this.reminderDone(c.what);
        this.reply(r ? `${r.name}: done. Next one ${r.next}.` : "I don't have a reminder for that. They're in the Garage.", 'done');
        return;
      }
      case 'undone': {
        const book = ServiceStore.load();
        const r = findReminder(book.items, c.what);
        if (!r || !canUndo(r)) { this.reply(r ? `${r.name} wasn't marked done, so there's nothing to take back.` : "I don't have a reminder for that.", 'undone'); return; }
        const next = undoDone(book, r.id);
        ServiceStore.save(next);
        engine.setServiceBook(next);
        this.reply(`${r.name}: not done after all. Back to ${dueText(dueInfo(next.items.find((x) => x.id === r.id)!, next.odoKm, Date.now()))}.`, 'undone');
        return;
      }
      case 'volume': {
        const was = CONFIG.voiceBoostDb;
        const db = nudgeVoice(c);
        this.configChanged();
        const phone = CONFIG.cloudVoice === 'off' ? ' The phone voice cannot go louder, though.' : '';
        this.reply(db === was ? (db >= 16 ? "That's as loud as I go." : "That's as soft as I go.")
          : db === 0 ? 'Back to my plain level.' : `${db > was ? 'Louder' : 'Softer'}: plus ${db} decibels. Better?${db > was ? phone : ''}`, 'volume');
        return;
      }
      case 'length': {
        const n = nudgeLength(c.step);
        this.configChanged();
        this.reply(n === 1 ? 'One sentence at a time.' : `Up to ${n} sentences a line.`, 'length');
        return;
      }
      case 'mixset': {
        setMixShare(c.what, c.pct);
        this.configChanged();
        this.reply(mixSummary(), 'mixset');
        return;
      }
      case 'mode': {
        if (c.action === 'save' && c.name) {
          CONFIG.modes = { ...CONFIG.modes, [c.name]: currentDials() };
          this.configChanged();
          this.reply(`Saved as ${c.name} mode. Say "switch to ${c.name} mode" to come back to it.`, 'mode');
        } else if (c.action === 'use' && c.name) {
          const m = CONFIG.modes[c.name];
          if (!m) { this.reply(`I don't have a ${c.name} mode. Set me up how you like, then say "save this as ${c.name} mode".`, 'mode'); return; }
          applyMode(m); this.configChanged();
          this.reply(`${c.name[0].toUpperCase()}${c.name.slice(1)} mode. ${mixSummary()}`, 'mode');
        } else {
          const name = currentMode() ?? currentTalkPreset();
          this.reply(name ? `${name[0].toUpperCase()}${name.slice(1)} mode. ${mixSummary()}` : `A custom mix. ${mixSummary()}`, 'mode');
        }
        return;
      }
      case 'ahead':
        this.reply(this.alive ? horizonSpoken(glanceCues(this.rideInput())) : 'No ride running, so nothing on the horizon yet.', 'ahead');
        return;
      case 'end':
        if (!this.requestEnd()) this.reply('There is no ride to end.', 'end'); // else her sign-off follows, and the ride's story opens
        return;
      case 'forget': {
        const { memory, gone } = forgetLast(RiderMemoryStore.load());
        if (gone) this.remembered(memory);
        this.reply(gone === 'note' ? 'Forgotten.' : gone === 'mark' ? "That spot's unmarked." : "There's nothing to forget.", 'forget');
      }
    }
  }

  /** Something he said to her, typed or spoken: one path for both. */
  ask = async (text: string): Promise<QueueItem | null> => {
    const { engine, agg, d } = this;
    this.ev.chat?.({ from: 'rider', text, at: Date.now() });
    // Said in passing, anywhere in a sentence: "I was just filling up", "we're taking a bit of a detour".
    const noted: string[] = [];
    if (saysFilledUp(text)) {
      this.filledUp();
      this.log('[heard]', `fill-up: range reset to ${Math.round(kmToReserve(CONFIG.fuel))} km`);
      noted.push(`The phone has just recorded his fill-up from what he said: fuel range reset to about ${Math.round(kmToReserve(CONFIG.fuel))} km.`);
    }
    if (saysDetour(text) && engine.routeNow() && !engine.onDetour()) {
      engine.setDetour(true);
      this.log('[heard]', 'detour: no off-route lines until he is back on the route');
      noted.push('He is taking a detour on purpose: you will not mention being off the route until he is back on it.');
    }
    let command = parseCommand(text);
    // "Checked the weather?" is not maintenance: a "done" with no reminder of that name is a question for her.
    if ((command?.kind === 'done' || command?.kind === 'undone') && !findReminder(ServiceStore.load().items, command.what)) command = null;
    if (command) { this.obey(command); return null; }
    // "Where can I fill up?": the stations near him, if they can be had in a couple of seconds.
    const here = agg.current;
    if (d.server && !d.desk && /\b(fuel|petrol|gas|garage|station|fill up|filling|refuel|reserve|tank)\b/i.test(text) && here.lat != null && here.lon != null) {
      engine.setStations(await within(this.stations.near(here.lat, here.lon), 2500, 'stations').catch(() => this.stations.list));
    }
    // A web search takes a few seconds: rather than silence, she says she is on it.
    const slow = setTimeout(() => this.sayNow(HANG_ON), HANG_ON_AFTER_MS);
    try { return await this.say(engine.ask(text, agg.current, noted), false, () => clearTimeout(slow)); } finally { clearTimeout(slow); }
  };

  /**
   * END RIDE, step 1: stop reacting to the ride (no new alerts or banter; the queue and voice stay alive) and save it.
   * Returns the ride id and whether it is kept in My journeys.
   */
  wrapUp(): { rideId: number; kept: boolean } {
    this.ending = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.remember();
    this.logSensors();
    this.unsub();
    this.changed();
    const rideId = this.engine.rideSnapshot().startedAt;
    return { rideId, kept: !this.desk && RideLog.load().some((x) => x.startedAt === rideId) };
  }

  /**
   * Step 2: her sign-off for a ride worth remembering, cutting in, and waiting for it to finish (up to 45 s), unless
   * `hurry()` says he tapped "stop now" (looked at while it is still being written, too).
   */
  async signOff(hurry: () => boolean) {
    const debrief = !this.desk && toRecord(this.engine.rideSnapshot(), null) ? this.engine.force('ride_debrief', this.agg.current) : null;
    let item: QueueItem | null = null;
    if (debrief) {
      const said = this.say(debrief, true).then((it) => { item = it; });
      while (!hurry() && item === null) { if (await Promise.race([said.then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), 150))])) break; }
    }
    const deadline = Date.now() + SIGN_OFF_LIMIT_MS;
    this.talking = false; this.onCall = false;
    this.queue.hold(false); // a conversation (or a call) that was still on must not hold the sign-off back
    while (item && !settled((item as QueueItem).fate) && !hurry() && Date.now() < deadline) await new Promise((res) => setTimeout(res, 150));
    if (item && !settled((item as QueueItem).fate)) this.log('[audio]', `sign-off not finished: ${hurry() ? 'stopped by a second tap on End ride' : 'still playing after 45 s'}`);
  }

  /** Step 3: shut down (anything still waiting belongs to a ride that is over, and is cut off). */
  shutdown() {
    this.alive = false;
    this.queue.clear();
    this.setObd('off');
    this.agg.stop();
    clearTimeout(this.heardTimer);
    this.speaking = null; this.lastSaid = null; this.talk = 'off';
    this.d.logger.save();
  }
}
