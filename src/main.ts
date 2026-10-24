import { loadConfig, saveConfig } from './config/persist';
import { CLOUD_VOICES, CONFIG, CloudVoiceMode, ObdMode, cleanBikeName, cleanRiderName, chirpVoice, libraryVoice, voiceStyle } from './config/betty';
import { LIBRARY_ACCENTS, LIBRARY_VOICES } from './config/voiceLibrary';
import { CloudSpeaker, ElementPlayer, SOUND_TEST_LINES, STOCK_LINES } from './adapters/CloudSpeaker';
import { IdbClipStore } from './adapters/ClipStore';
import { PcmPlayer } from './adapters/PcmPlayer';
import { NO_OBD, StateAggregator } from './core/StateAggregator';
import { TriggerEngine } from './core/TriggerEngine';
import { travelDirection } from './core/ambient';
import { describeFuelPlan, fuelLeft, kmToReserve, routeFuelPlan } from './core/Fuel';
import { refreshFuelPrice } from './adapters/FuelPrice';
import { ServiceStore } from './adapters/ServiceStore';
import { RiderMemoryStore } from './adapters/RiderMemoryStore';
import { compassPoint } from './core/geo';
import { AudioQueue } from './core/AudioQueue';
import { ClaudeClient, voiceTags } from './core/ClaudeClient';
import { AreaNote, BikeState } from './core/types';
import { MockObdSource } from './adapters/MockObdSource';
import { WebGeoSource } from './adapters/WebGeoSource';
import { WebMotionSource } from './adapters/WebMotionSource';
import { WebSpeaker } from './adapters/WebSpeaker';
import { SwitchableSpeaker } from './adapters/SwitchableSpeaker';
import { AreaStore, ToldStore, researchAhead } from './adapters/AreaSource';
import { TrackStore } from './adapters/TrackStore';
import { RoadStore } from './adapters/RoadStore';
import { JourneyStore } from './adapters/JourneyStore';
import { SharePack, makePack, mergeSpots, mergeStories, rideAsRoute } from './core/Share';
import { LineBankStore } from './adapters/LineBankStore';
import { checkpoints, rideAgainStops, weatherLine } from './core/RouteAhead';
import { fetchRouteWeather } from './adapters/RouteWeather';
import { groupByMonth } from './core/Journeys';
import { drawMonthCard } from './ui/monthCard';
import { RideLog } from './adapters/RideLog';
import { rideMinutes } from './core/RideMemory';
import { TomTomTrafficProvider } from './adapters/TomTomTraffic';
import { WakeLock, WakeStatus } from './adapters/WakeLock';
import { mountSimPanel } from './ui/SimPanel';
import { ChatEntry, mountChatPanel } from './ui/ChatPanel';
import { mountChatScreen } from './ui/screens/ChatScreen';
import { mountVoiceTestPanel } from './ui/VoiceTestPanel';
import { mountTuningPanel } from './ui/TuningPanel';
import { mountLockScreen } from './ui/LockScreen';
import { mountLogPanel } from './ui/LogPanel';
import { mountMemoryPanel } from './ui/MemoryPanel';
import { mountWhatsNew } from './ui/WhatsNew';
import { LineLogStore } from './adapters/LineLogStore';
import { FuelStore } from './adapters/FuelStore';
import { HeadsetButtons } from './adapters/HeadsetButtons';
import { PushToTalk, browserPttDeps, transcribe, within } from './adapters/PushToTalk';
import { beep } from './adapters/audio';
import { formatLog } from './core/LineLog';
import { RideSession } from './app/RideSession';
import { FATE_LABELS, LineLogger } from './app/LineLogger';
import { ScreenId, copyText, downloadText, mountShell } from './ui/Shell';
import { ReadyRow, mountHomeScreen } from './ui/screens/HomeScreen';
import { RideActions, mountRideScreen } from './ui/screens/RideScreen';
import { mountJourneysScreen } from './ui/screens/JourneysScreen';
import { mountExploreScreen } from './ui/screens/ExploreScreen';
import { mountSettingsScreen } from './ui/screens/SettingsScreen';
import { mountHelpScreen } from './ui/screens/HelpScreen';
import { mountReminders, readinessRow } from './ui/RemindersCard';
import { IdbAvatarStore, mountAvatarSetting } from './ui/avatar';
import { mountBackup, shareJson } from './ui/backup';
import { RouteStore, mountRoutePlanner } from './ui/RoutePlanner';
import { BorderTiles } from './adapters/BorderTiles';
import { ProfileStore, mountKnowMe } from './ui/KnowMe';
import { PlannedRoute } from './core/Route';
import { rideTitle } from './ui/screens/HomeScreen';
import { drawRideCard, shareRideCard } from './ui/rideCard';
import { CardExtras, CardExtrasSource } from './adapters/CardExtras';
import { pickLabels } from './core/RideCard';
import { spanFor } from './ui/mapView';
import { mountEdgeStretch, mountPullToRefresh, mountSheetDrag, mountSwipeBack, rememberSpot, takeSpot } from './ui/gestures';
import { glanceCues, horizonLine, rideView } from './ui/rideView';
import { BRAND, END_BUTTON, HOME, sampleLine } from './ui/copy';
import { applyMotion, mountPressFeel } from './ui/motion';

loadConfig();
applyMotion();
mountPressFeel();
window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => applyMotion());

/** Build-time keys. Absent when the page is run outside Vite (the smoke test), where Betty simply has no keys. */
const ENV: Record<string, string | undefined> = import.meta.env ?? {};
/** Deployed: keys live on Betty's server (api/), not in this page. Local development uses VITE_ keys from .env. */
const SERVER = ENV.VITE_USE_SERVER === '1';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// The app shell: screens, sheets and the toast (markup in index.html, see ui/Shell.ts).
const shell = mountShell();
const startBtn = $<HTMLButtonElement>('start');
const endBtn = $<HTMLButtonElement>('end');
const endText = $('endtext');
const realBox = $<HTMLInputElement>('real');
const statusEl = $('status');
const logEl = $('log');
const setStatus = (msg: string, err = false) => {
  statusEl.textContent = msg; statusEl.className = err ? 'err' : '';
  if (msg) shell.toast(msg, err);
};

const IDLE_FEEDS = { weather: 'idle', traffic: 'idle', places: 'idle', areas: 'idle' };
const feedStatus = () => { const feed = rig?.s.feeds ?? IDLE_FEEDS; return `Weather: ${feed.weather} | Traffic: ${feed.traffic} | Places: ${feed.places} | Area stories: ${feed.areas}`; };

/** A ride (app/RideSession, shared with the native app) plus what only the web app has around it. */
interface Rig {
  s: RideSession; agg: StateAggregator; engine: TriggerEngine; queue: AudioQueue; say: RideSession['say'];
  setObd: (mode: ObdMode) => void; real: boolean; /** A desk session for the Workshop chat: not a ride */ desk: boolean; unmountSim: () => void; buttons: HeadsetButtons; releaseMic: () => void; wake: WakeLock;
}
let rig: Rig | null = null;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const renderLog = () => {
  logEl.innerHTML = logger.lines.slice(0, 10)
    .map((l) => `<div>${esc(l.head)}: ${esc(l.text)}${l.item ? ` <span class="fate">[${FATE_LABELS[l.item.fate]}]</span>` : ''}</div>`).join('');
};
/** Everything she said and every note, saved on the phone (app/LineLogger). */
const logger = new LineLogger(() => renderLog());
const newLine = (head: string, text: string) => logger.add(head, text);
const saveLog = () => logger.save();
// A phone browser can drop the tab without warning; save whenever the page is hidden.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveLog(); });
window.addEventListener('pagehide', saveLog);

/** Problems the speech engine reports (a line that would not start, or never finished). Shown, not swallowed. */
const speechProblem = (msg: string) => {
  newLine('[audio]', msg);
  renderLog();
};

mountTuningPanel($('tuning'));
// Voice input, stage 0: always available, ride or not. Findings go into the saved log.
mountVoiceTestPanel($('voicetestpanel'), {
  speed: () => (rig ? rig.agg.current.speedKmh : null),
  mic: () => CONFIG.micDeviceId,
  buttonsBusy: () => !!rig?.buttons.holding,
  setMic: (id, label) => { CONFIG.micDeviceId = id; CONFIG.micLabel = label; saveConfig(); },
  micRaw: () => CONFIG.micRaw,
  setMicRaw: (on) => { CONFIG.micRaw = on; saveConfig(); },
  log: (msg) => { newLine('[voice-test]', msg); renderLog(); },
});
/** Everyone following the chat timeline (the CHAT panel while a ride runs). */
const chatListeners = new Set<(e: ChatEntry) => void>();
const toChat = (e: ChatEntry) => chatListeners.forEach((f) => f(e));
mountLogPanel($('logpanel'), {
  entries: () => { saveLog(); return LineLogStore.load(); },
  rides: () => RideLog.load(),
  clear: () => { logger.forgetUnsaved(); LineLogStore.clear(); },
});
const memoryCtx = {
  load: () => RiderMemoryStore.load(),
  save: (m: ReturnType<typeof RiderMemoryStore.load>) => { RiderMemoryStore.save(m); rig?.engine.setMemory(m); },
};
mountMemoryPanel($('memorypanel'), memoryCtx);
// Explore's Listen: a story read out at home, in Chirp by default (Garage > Stories at home). Each clip is made once
// and kept on the phone (its own store, so ride clips do not push stories out); a story heard to the end counts as told.
const storyClips = new IdbClipStore('betty-stories', 400);
const listenStory = (note: AreaNote, onEnd: (heard: boolean) => void) => {
  let stopped = false, stopPlay = () => {};
  testPlayer.prime(); testSpeaker.stop(); // inside the tap (iPhone)
  const text = voiceTags(note.text, false);
  const finish = (heard: boolean) => {
    if (stopped) return;
    stopped = true;
    if (heard) ToldStore.save([...new Set([...ToldStore.load(), note.id])]);
    onEnd(heard);
  };
  const phone = () => { if (!stopped) { testSpeaker.speak(text, () => finish(true)); stopPlay = () => testSpeaker.stop(); } };
  const body = (engine: 'chirp' | 'gemini') => {
    const chirp = chirpVoice();
    return engine === 'gemini'
      ? { text: voiceTags(note.text, true), engine, voice: CONFIG.cloudVoiceName, style: voiceStyle('area_story', 3), model: CONFIG.geminiModel }
      : { text, engine, voice: chirp.name, locale: chirp.locale };
  };
  const clip = async (engine: 'chirp' | 'gemini') => {
    const b = body(engine), key = JSON.stringify(b);
    const kept = await storyClips.get(key);
    if (kept) return kept;
    const res = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: key });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const got = await res.blob();
    void storyClips.put(key, got);
    return got;
  };
  if (!SERVER || CONFIG.listenVoice === 'phone') phone();
  else {
    void (async () => {
      let audio: Blob | null = null;
      for (const engine of CONFIG.listenVoice === 'gemini' ? ['gemini', 'chirp'] as const : ['chirp'] as const) {
        try { audio = await clip(engine); break; } catch { /* the next voice, then the phone */ }
      }
      if (stopped) return;
      if (!audio) { phone(); return; }
      const url = URL.createObjectURL(audio);
      stopPlay = testPlayer.play(url, () => { URL.revokeObjectURL(url); finish(true); }, () => { URL.revokeObjectURL(url); phone(); });
    })();
  }
  return () => { if (!stopped) { stopPlay(); finish(false); } };
};
mountExploreScreen(document, shell, {
  ...memoryCtx,
  stories: () => Object.entries(AreaStore.all()).map(([key, kept]) => ({ key, notes: kept.notes ?? [], at: kept.at ?? 0, lat: kept.lat, lon: kept.lon })),
  told: () => new Set(rig ? rig.engine.toldNoteIds() : ToldStore.load()),
  listen: listenStory,
  // Areas found before positions were kept: looked up one a second (Nominatim's rule), each kept for good.
  locate: (areas) => {
    if (!SERVER) return;
    void (async () => {
      for (const a of areas) {
        try {
          const region = a.key.split('|')[1] ?? 'South Africa';
          const res = await fetch(`/api/area?q=${encodeURIComponent(`${a.name}, ${region}`)}`);
          if (res.ok) { const p = await res.json(); if (Number.isFinite(p?.lat)) { AreaStore.place(a.key, { lat: p.lat, lon: p.lon }); window.dispatchEvent(new Event('betty-memory')); } }
        } catch { /* tried again next visit */ }
        await new Promise((r) => setTimeout(r, 1100));
      }
    })();
  },
  // Ride there: Where to? opens on the Ride tab with the place filled in; he picks twisty roads or not and taps Plan.
  rideThere: (place) => {
    shell.show('home');
    $<HTMLInputElement>('routeinput').value = place;
    shell.openSheet('mode');
    shell.toast(`${place} is in Where to? Tap Plan.`);
  },
});
// The ride card's place names and metro line: fetched when a ride's story opens (slow the first time), kept per ride.
const cardExtras = new CardExtrasSource();
const cardWanted = () => SERVER && (CONFIG.cardPlaces || CONFIG.cardMetro);
const rideLogText = (rideId: number) => { saveLog(); return formatLog(LineLogStore.load(), RideLog.load(), rideId); };
RoadStore.seed(TrackStore.all()); // rides kept before the rough copies existed
const journeys = mountJourneysScreen(document, shell, {
  rides: () => RideLog.load(),
  entries: () => { saveLog(); return LineLogStore.load(); },
  track: (rideId) => TrackStore.get(rideId),
  roads: () => RoadStore.all(),
  prepareCard: (rideId) => { const t = TrackStore.get(rideId); return cardWanted() && t.length > 1 && !cardExtras.kept(rideId) ? cardExtras.prepare(rideId, t) : null; },
  // On the story map every name shows (it is private); the card leaves his start and finish off when asked.
  mapExtras: (rideId) => {
    const x = cardWanted() ? cardExtras.kept(rideId) : null;
    if (!x) return null;
    const t = TrackStore.get(rideId);
    return { labels: CONFIG.cardPlaces ? pickLabels(x.samples, spanFor(t), []).map((l) => ({ lat: l.lat, lon: l.lon, label: l.name })) : [], metro: CONFIG.cardMetro ? x.metro : null };
  },
  copyRide: (rideId) => copyText(rideLogText(rideId)),
  saveRide: (rideId) => { if (!downloadText(`betty-ride-${new Date(rideId).toISOString().slice(0, 16).replace(':', '')}.txt`, rideLogText(rideId))) shell.toast('Saving a file is not available here'); },
  toast: (msg) => shell.toast(msg),
  // A picture of the ride to share (owner, 2026-10-17): map sketch, numbers, her best line, her orb or his picture.
  shareRide: async (rideId, hideEnds, status) => {
    const r = RideLog.load().find((x) => x.startedAt === rideId);
    if (!r) return;
    saveLog();
    const lines = LineLogStore.load()
      .filter((e) => e.rideId === rideId && /^\[P\d\]/.test(e.head) && e.text && !e.text.startsWith('('))
      .map((e) => ({ trigger: e.head.match(/^\[P\d\] (\w+)/)?.[1] ?? '', text: e.text }));
    const track = TrackStore.get(rideId);
    // Wait for the places along the road (they started loading when the story opened), but not for ever.
    let extras: CardExtras | null = null;
    if (cardWanted() && track.length > 1) {
      extras = cardExtras.kept(rideId);
      if (!extras) {
        status('Finding the places on your road...');
        extras = await Promise.race([cardExtras.prepare(rideId, track), new Promise<null>((res) => setTimeout(() => res(null), 40_000))]);
      }
    }
    status('Making your ride card...');
    try {
      const png = await drawRideCard(document, {
        ride: r, title: rideTitle(r), track, lines, avatar: await avatarStore.get().catch(() => null), hideEnds,
        extras: extras ? { ...extras, places: CONFIG.cardPlaces, metroLine: CONFIG.cardMetro } : null,
      });
      status('Opening share...');
      const how = await shareRideCard(document, png, `betty-ride-${new Date(rideId).toISOString().slice(0, 10)}.png`);
      if (how === 'saved') shell.toast('Ride card saved to your downloads.');
    } catch (e) { shell.toast(`Could not make the ride card: ${(e as Error).message}`, true); }
  },
  // Ride this again (Route: what is ahead): the ride's road as stops, routed by TomTom, waiting in Where to?.
  rideAgain: async (rideId, status) => {
    const r = RideLog.load().find((x) => x.startedAt === rideId);
    const detailed = TrackStore.get(rideId);
    const road = detailed.length > 1 ? detailed : RoadStore.get(rideId);
    if (!r || road.length < 2) { shell.toast('No road kept for this ride to follow.'); return; }
    status('Planning the route...');
    try {
      const res = await fetch('/api/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stops: rideAgainStops(road), thrilling: false }) });
      const out: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
      const route: PlannedRoute = { ...out, name: `Again: ${rideTitle(r)}`, plannedAt: Date.now() };
      RouteStore.set(route); planner.paint(); rig?.engine.setRoute(route); window.dispatchEvent(new window.Event('betty-config'));
      shell.show('home'); shell.openSheet('mode');
      shell.toast(`Planned: ${Math.round(route.km)} km. Save it to keep it.`);
    } catch (e) { shell.toast(`Could not plan it: ${(e as Error).message}`, true); }
  },
  // Send this ride to a friend's Betty: its road as a route to ride, and the stories of the places on it.
  shareToFriend: async (rideId) => {
    const r = RideLog.load().find((x) => x.startedAt === rideId);
    const detailed = TrackStore.get(rideId);
    const road = detailed.length > 1 ? detailed : RoadStore.get(rideId);
    if (!r) return;
    const route = rideAsRoute(r, road, rideTitle(r), sharer(), rideMinutes(r, true));
    const all = AreaStore.all();
    const stories = Object.fromEntries(Object.entries(all).filter(([k]) => r.places.some((p) => k.split('|')[0] === p)).map(([k, a]) => [k, { notes: a.notes, lat: a.lat, lon: a.lon }]));
    await shareWithFriend(makePack(sharer(), new Date(), { routes: route ? [route] : [], stories }), 'A ride');
  },
  // Delete a ride (owner, 2026-10-18): the record, its lines, both copies of its road, its card extras, star and name.
  deleteRide: (rideId) => {
    if (rig && !rig.desk && rig.engine.rideSnapshot().startedAt === rideId) return false;
    saveLog();
    logger.forgetRide(rideId); // or the next save would put its lines back
    RideLog.remove(rideId); LineLogStore.removeRide(rideId); TrackStore.remove(rideId); RoadStore.remove(rideId);
    JourneyStore.forget(rideId); cardExtras.forget(rideId);
    return true;
  },
  // The month's recap card (Journeys 8): every road of the month, the numbers, her best line of the month.
  shareMonth: async (key, status) => {
    const month = groupByMonth(RideLog.load(), CONFIG.ridingTimeOnly).find((g) => g.key === key);
    if (!month) return;
    saveLog();
    status('Making your month card...');
    const ids = new Set(month.rides.map((r) => r.startedAt));
    const roads = RoadStore.all();
    const lines = LineLogStore.load().filter((e) => e.rideId != null && ids.has(e.rideId) && /^\[P\d\]/.test(e.head) && e.text && !e.text.startsWith('('))
      .map((e) => ({ trigger: e.head.match(/^\[P\d\] (\w+)/)?.[1] ?? '', text: e.text }));
    try {
      const png = await drawMonthCard(document, { month, roads: month.rides.map((r) => roads[String(r.startedAt)] ?? []).filter((t) => t.length > 1), lines,
        avatar: await avatarStore.get().catch(() => null), duration: (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}` : `${min} min`) });
      status('Opening share...');
      const how = await shareRideCard(document, png, `betty-${key}.png`);
      if (how === 'saved') shell.toast('Month card saved to your downloads.');
    } catch (e) { shell.toast(`Could not make the month card: ${(e as Error).message}`, true); }
  },
});
mountWhatsNew(document); // Garage > What's new, with the unread count on the card and the Garage tab

// Lock screen: covers everything so nothing can be pressed by accident; hold its button to get back.
/** Set while a ride runs: start or finish talking to Betty. */
let talkNow: (() => void) | null = null;
const lockScreen = mountLockScreen($('lockroot'), 1000, () => talkNow?.());
$('lock').addEventListener('click', () => lockScreen.lock());
document.querySelectorAll('[data-lock]').forEach((b) => b.addEventListener('click', () => { shell.closeSheet(); lockScreen.lock(); }));
const showLocked = (speed: number) => lockScreen.setInfo(String(speed), voiceTags(rig?.s.lastLine ?? '', false));

// What Betty calls the rider. Applies from the next line she speaks.
const nameInput = $<HTMLInputElement>('ridername');
nameInput.value = CONFIG.riderName;
nameInput.addEventListener('change', () => {
  CONFIG.riderName = cleanRiderName(nameInput.value);
  nameInput.value = CONFIG.riderName;
  saveConfig();
});

// Fuel range by distance, for as long as there is no fuel gauge to read. The count carries on across rides.
const showRange = (kmSinceFill: number | null) => {
  $('range').textContent = kmSinceFill === null ? '-' : String(fuelLeft(kmSinceFill, CONFIG.fuel).kmToReserve);
  $('rangesrc').textContent = kmSinceFill === null ? 'tap FILLED UP' : `km to reserve, ${Math.round(kmSinceFill)} since fill`;
};
showRange(FuelStore.load());
const fuelText = () => {
  const since = rig ? rig.engine.kmSinceFill() : FuelStore.load();
  if (since === null) return 'Tap Filled up to start counting';
  const f = fuelLeft(since, CONFIG.fuel);
  return f.onReserve ? `On reserve: about ${f.kmToEmpty} km to empty` : `${f.kmToReserve} km to reserve · ${f.litres} L left`;
};
/** After a fill-up (the button, Horizon, or said in passing during a ride): what the screens show. */
const afterFill = () => {
  showRange(0);
  for (const id of ['readyfuel', 'garagefuel']) { const out = document.getElementById(id); if (out) out.textContent = fuelText(); }
  setStatus(`Fill-up noted. Range reset to ${Math.round(kmToReserve(CONFIG.fuel))} km.`);
};
document.querySelectorAll('[data-filled]').forEach((b) => b.addEventListener('click', () => {
  if (rig) rig.s.filledUp(); // tells afterFill
  else { FuelStore.save(0); afterFill(); }
}));

const bikeInput = $<HTMLInputElement>('bikename');
bikeInput.value = CONFIG.bikeName;
bikeInput.addEventListener('change', () => {
  CONFIG.bikeName = cleanBikeName(bikeInput.value);
  bikeInput.value = CONFIG.bikeName;
  saveConfig();
});

// Voice picker. The list arrives late on most browsers, and downloaded voices (iPhone: Settings > Accessibility >
// Spoken Content > Voices) only show up once they are installed, so it is rebuilt whenever the browser says it changed.
const voiceSel = $<HTMLSelectElement>('voice');
const fillVoices = () => {
  const all = 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];
  const english = all.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const rank = (v: SpeechSynthesisVoice) => (v.lang.toLowerCase() === 'en-za' ? 0 : 1);
  voiceSel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = ''; auto.textContent = all.length ? 'Automatic (phone default)' : 'Automatic (no voices listed by this browser)';
  voiceSel.append(auto);
  for (const v of [...english].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))) {
    const o = document.createElement('option');
    // Apple's voice ids say which quality the browser was actually given; show it, since a downloaded Premium voice
    // is not always handed to Safari.
    const id = v.voiceURI.toLowerCase();
    const quality = id.includes('premium') ? ', premium' : id.includes('enhanced') ? ', enhanced' : id.includes('compact') ? ', basic' : '';
    o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang}${quality})`;
    voiceSel.append(o);
  }
  // A saved voice that is no longer installed stays saved, but the box shows what will actually be used.
  voiceSel.value = english.some((v) => v.voiceURI === CONFIG.voiceURI) ? CONFIG.voiceURI : '';
};
fillVoices();
if ('speechSynthesis' in window) window.speechSynthesis.addEventListener?.('voiceschanged', fillVoices);
voiceSel.addEventListener('change', () => { CONFIG.voiceURI = voiceSel.value; saveConfig(); });
const testSpeaker = new WebSpeaker();
$('voicetest').addEventListener('click', () => {
  if (rig) return; // not over the top of a ride in progress
  testSpeaker.stop();
  testSpeaker.speak(`Hello ${cleanRiderName(CONFIG.riderName)}, this is how I sound.`, () => {});
});

// Cloud voice (Google): engine mode, voice name, and a test that plays an alert and a banter line as a ride would.
const cloudSel = $<HTMLSelectElement>('cloudvoice');
const cloudName = $<HTMLSelectElement>('cloudname');
// Accent: the 30 standard voices (Chirp has them too), or a group from Gemini's accent library (Gemini only).
const cloudAccent = $<HTMLSelectElement>('cloudaccent');
const STANDARD = 'standard';
for (const [value, label] of [[STANDARD, 'Standard American (Chirp has these too)'], ...LIBRARY_ACCENTS.map((a) => [a, `${a} (Gemini only)`])]) {
  const o = document.createElement('option'); o.value = value; o.textContent = label; cloudAccent.append(o);
}
const fillNames = (accent: string) => {
  cloudName.innerHTML = '';
  for (const [label, gender] of [['Female voices', 'female'], ['Male voices', 'male'], ['Neutral voices', 'neutral']] as const) {
    const group = document.createElement('optgroup'); group.label = label;
    const add = (value: string, text: string) => { const o = document.createElement('option'); o.value = value; o.textContent = text; group.append(o); };
    if (accent === STANDARD) { for (const [name, desc, g] of CLOUD_VOICES) if (g === gender) add(name, `${name} (${g}, ${desc})`); }
    else for (const v of LIBRARY_VOICES) if (v.accent === accent && v.gender === gender) add(v.id, `${v.name} (${v.about})`);
    if (group.children.length) cloudName.append(group);
  }
};
cloudAccent.addEventListener('change', () => {
  fillNames(cloudAccent.value);
  CONFIG.cloudVoiceName = cloudName.value; saveConfig(); // the first voice of that accent until he picks one
});
// Chirp has no accent voices: with one picked, alerts come from this standard voice (closest by pitch and tone).
const standInSel = $<HTMLSelectElement>('chirpstandin');
{
  const auto = document.createElement('option'); auto.value = ''; auto.textContent = 'Automatic (same gender)'; standInSel.append(auto);
  for (const [name, desc, g] of CLOUD_VOICES) { const o = document.createElement('option'); o.value = name; o.textContent = `${name} (${g}, ${desc})`; standInSel.append(o); }
}
standInSel.addEventListener('change', () => { CONFIG.chirpStandIn = standInSel.value; saveConfig(); });
const geminiSel = $<HTMLSelectElement>('geminimodel');
const chirpSel = $<HTMLSelectElement>('chirplocale');
const showCloud = () => {
  const accent = libraryVoice(CONFIG.cloudVoiceName)?.accent ?? STANDARD;
  cloudAccent.value = accent; fillNames(accent);
  cloudSel.value = CONFIG.cloudVoice; cloudName.value = CONFIG.cloudVoiceName; geminiSel.value = CONFIG.geminiModel; chirpSel.value = CONFIG.chirpLocale;
  cloudName.disabled = cloudAccent.disabled = geminiSel.disabled = chirpSel.disabled = CONFIG.cloudVoice === 'off';
  // Chirp's accent only matters for the standard voices; with a library voice it follows the accent.
  chirpSel.disabled ||= accent !== STANDARD;
  standInSel.value = CONFIG.chirpStandIn; standInSel.disabled = CONFIG.cloudVoice === 'off' || accent === STANDARD;
};
geminiSel.addEventListener('change', () => { CONFIG.geminiModel = geminiSel.value as typeof CONFIG.geminiModel; saveConfig(); });
chirpSel.addEventListener('change', () => { CONFIG.chirpLocale = chirpSel.value as typeof CONFIG.chirpLocale; saveConfig(); });
showCloud();
cloudSel.addEventListener('change', () => { CONFIG.cloudVoice = cloudSel.value as CloudVoiceMode; saveConfig(); showCloud(); });
cloudName.addEventListener('change', () => { CONFIG.cloudVoiceName = cloudName.value; saveConfig(); });
/** Stock phrases and sound-test clips, kept on the phone so Gemini makes each one only once per voice. */
const clipStore = new IdbClipStore();
const testPlayer = new ElementPlayer();
const testPcm = new PcmPlayer();
$('cloudtest').addEventListener('click', () => {
  if (rig) return; // not over the top of a ride in progress
  testPlayer.prime(); testPcm.prime(); // inside the tap, or iPhone will not play the audio that arrives later
  testSpeaker.stop();
  const notes: string[] = [];
  const waits: string[] = [];
  const sec = (ms: number) => `${Math.round(ms / 100) / 10} s`;
  const t = new CloudSpeaker(testSpeaker, () => testPlayer, (m) => notes.push(m), undefined, undefined, undefined, testPcm,
    (engine, streamed, ms) => waits.push(`${engine === 'chirp' ? 'Chirp' : 'Gemini'}${streamed ? ' streamed' : ''} ${sec(ms)}`), clipStore);
  const name = cleanRiderName(CONFIG.riderName);
  // The three kinds of line a ride has, fetched the way a ride fetches them: alert, answer, and banter (which a ride
  // fetches whole, ahead, and only queues once it is ready). The status shows how long each waited for its audio.
  const alert = { priority: 2 as const, id: 'rain_soon' }, answer = { priority: 4 as const, id: 'rider_query' }, banter = { priority: 3 as const, id: 'ambient_banter' };
  const lines = [`Rain in about twenty minutes, ${name}. Worth finding some cover.`,
    'Thirty-five kilometres so far, and no traffic on your way. <laugh> Enjoy it while it lasts.',
    "Forty minutes in and the road is behaving. <sigh> Can't say the same for the taxis."];
  setStatus('Testing the cloud voice: an alert, an answer, then a bit of banter.');
  const bReady = t.ready(lines[2], banter);
  t.speak(lines[0], () => {
    t.speak(lines[1], () => {
      const tb = Date.now();
      void bReady.then(() => {
        const held = Date.now() - tb;
        t.speak(lines[2], () => {
          setStatus(`Waited for audio: alert ${waits[0] ?? '?'}, answer ${waits[1] ?? '?'}, banter ${waits[2] ?? '?'} (fetched ahead${held > 100 ? `, held back ${sec(held)} more` : ''}).`
            + (notes.length ? ` ${notes.join('; ')}.` : ''), notes.length > 0);
        }, banter);
      });
    }, answer);
  }, alert);
});

// Every voice sound she may use, one line each, in Gemini: to hear and judge them. Kept on the phone after the first
// play, so pressing it again costs nothing (until the voice, model or style changes).
let soundsBusy = false;
$('cloudsounds').addEventListener('click', () => {
  if (rig || soundsBusy) return;
  if (CONFIG.cloudVoice === 'off' || CONFIG.cloudVoice === 'chirp') { setStatus('The sounds are Gemini only: pick a Gemini option under Cloud voice first.', true); return; }
  testPlayer.prime(); testPcm.prime();
  testSpeaker.stop();
  soundsBusy = true;
  const notes: string[] = [];
  const t = new CloudSpeaker(testSpeaker, () => testPlayer, (m) => notes.push(m), undefined, undefined, undefined, testPcm, undefined, clipStore);
  const tag = { priority: 3 as const, id: 'voice' }; // P3 is Gemini in every Gemini mode
  void (async () => {
    for (let i = 0; i < SOUND_TEST_LINES.length; i++) {
      const [sound, line] = SOUND_TEST_LINES[i];
      setStatus(`Sound ${i + 1} of ${SOUND_TEST_LINES.length}: <${sound}>, "${voiceTags(line, false)}"`);
      await t.whenGeminiFree(); // ten Gemini lines in a row: stay under its 10-a-minute limit
      await t.ready(line, tag);
      await new Promise<void>((done) => t.speak(line, done, tag));
      await new Promise((r) => setTimeout(r, 600));
    }
    soundsBusy = false;
    setStatus(`Sound test done.${notes.length ? ` ${notes.join('; ')}.` : ' Kept on the phone: the next test is instant and free.'}`, notes.length > 0);
  })();
});

/** A line from Betty outside a ride (the home orb, the settings sample), in her cloud voice when it is on. */
const helloOrb = $('helloorb');
const sayOutsideRide = (text: string) => {
  if (rig) return;
  testPlayer.prime(); testPcm.prime(); // inside the tap
  testSpeaker.stop();
  const t = new CloudSpeaker(testSpeaker, () => testPlayer, () => {}, undefined, undefined, undefined, testPcm, undefined, clipStore);
  helloOrb.className = 'orb speaking';
  t.speak(text, () => { helloOrb.className = 'orb resting'; }, { priority: 4, id: 'voice' });
};
mountSettingsScreen(document, shell, { sample: () => sayOutsideRide(sampleLine(CONFIG.persona.humour)), fuelText });
mountHelpScreen(document, shell);
mountReminders(document, shell, { load: () => ServiceStore.load(), save: (b) => { ServiceStore.save(b); rig?.engine.setServiceBook(b); } });
// The offline line bank: her alert lines written ahead, refilled once a day while there is signal.
if (SERVER) setTimeout(() => void LineBankStore.refill(), 8000);
// The petrol price, once a month after the first-Wednesday change (his own figure wins until then).
if (SERVER) void refreshFuelPrice().then((p) => { if (p !== null) { saveConfig(); window.dispatchEvent(new window.Event('betty-config')); } });
// Betty's look: the default companion or his own picture/GIF, kept on the phone.
// Pull down to refresh (never while a ride or desk session runs: a reload would end it); drag a sheet down to close.
mountPullToRefresh(document, { canRefresh: () => rig === null, reload: () => {
  saveLog();
  const el = document.querySelector<HTMLElement>(`[data-screen="${shell.current}"]`);
  const ride = Number(document.getElementById('story')?.dataset.ride);
  rememberSpot({ screen: shell.current, scroll: el?.scrollTop ?? 0, ...(shell.current === 'story' && ride ? { ride } : {}) });
  location.reload();
} });
mountSheetDrag(document, shell);
mountEdgeStretch(document); // a tiny stretch at the top and bottom edges instead of the iPhone's bounce
mountSwipeBack(document, shell); // swipe from the left edge: back from a ride's story, the chat, the Workshop
const avatarStore = new IdbAvatarStore();
mountAvatarSetting(document, avatarStore, (m, err) => shell.toast(m, err));
// Your data: everything in one file, to move to a new phone.
mountBackup(document, localStorage, avatarStore, {
  busy: () => rig !== null, toast: (m, err) => shell.toast(m, err),
  confirm: (m) => window.confirm(m), reload: () => setTimeout(() => location.reload(), 600),
  // A friend's Betty shared routes, spots or stories: add them to hers (owner's backlog, 2026-10-18).
  mergeShare: (p) => {
    for (const r of p.routes) RouteStore.save(r);
    const mem = RiderMemoryStore.load();
    const marks = mergeSpots(mem.marks, p.spots, p.from);
    const spotsAdded = marks.length - mem.marks.length;
    if (spotsAdded) { RiderMemoryStore.save({ ...mem, marks }); rig?.engine.setMemory({ ...mem, marks }); }
    const { merged, added } = mergeStories(AreaStore.all(), p.stories);
    for (const [k, a] of Object.entries(merged)) if (p.stories[k]) AreaStore.put(k, a.notes, a.lat != null && a.lon != null ? { lat: a.lat, lon: a.lon } : undefined);
    window.dispatchEvent(new window.Event('betty-memory'));
    planner.paint();
    return `Added from ${p.from}: ${[p.routes.length && `${p.routes.length} route${p.routes.length === 1 ? '' : 's'} (in Where to?)`, spotsAdded && `${spotsAdded} spot${spotsAdded === 1 ? '' : 's'}`, added && `${added} stor${added === 1 ? 'y' : 'ies'}`].filter(Boolean).join(', ') || 'nothing new'}.`;
  },
});
/** The name a shared file goes out under ("sir" is Betty's default for him, not a name). */
const sharer = () => (cleanRiderName(CONFIG.riderName).toLowerCase() === 'sir' ? 'A friend' : cleanRiderName(CONFIG.riderName));
/** Send something to a friend's Betty: a file through the share sheet (core/Share). */
const shareWithFriend = async (pack: SharePack, what: string) => {
  const how = await shareJson(document, pack, `betty-share-${new Date().toISOString().slice(0, 10)}.json`, `${what} from ${pack.from}'s Betty`);
  if (how === 'saved') shell.toast('Saved to your downloads: send it to your friend, who imports it in Garage > Your data.');
};
// Explore: send all his marked spots and area stories to a friend's Betty.
document.getElementById('exploreshare')?.addEventListener('click', () => {
  const stories = Object.fromEntries(Object.entries(AreaStore.all()).map(([k, a]) => [k, { notes: a.notes, lat: a.lat, lon: a.lon }]));
  void shareWithFriend(makePack(sharer(), new Date(), { spots: RiderMemoryStore.load().marks, stories }), 'Spots and stories');
});
// Installable app, and it opens with no signal (public/sw.js). Not on localhost, where it would cache dev builds.
if ('serviceWorker' in navigator && !/^(localhost|127\.)/.test(location.hostname)) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

let wakeOk = true;
const wakeEl = $('wake');
const showWake = (s: WakeStatus | null) => {
  wakeOk = s === null || s === 'on';
  paintRide();
  wakeEl.className = s === 'on' ? 'ok' : 'err';
  wakeEl.textContent = s === null ? ''
    : s === 'on' ? 'Screen will stay awake while this page is open and in front.'
      : s === 'off' ? 'Screen is NOT being kept awake. Tap the page, or set Auto-Lock to Never in the phone settings.'
        : 'This browser cannot keep the screen awake. Set Auto-Lock to Never in the phone settings before riding.';
};

// Headset buttons for Betty: a per-ride choice because it pauses music from other apps.
const buttonsBox = $<HTMLInputElement>('buttons');
buttonsBox.checked = CONFIG.headsetButtons;
buttonsBox.addEventListener('change', () => { CONFIG.headsetButtons = buttonsBox.checked; saveConfig(); });

// OBD mode: off = GPS, lean and feeds only. Switchable before or during a ride.
const obdSel = $<HTMLSelectElement>('obdmode');
obdSel.value = CONFIG.obdMode;
obdSel.addEventListener('change', () => {
  CONFIG.obdMode = obdSel.value as ObdMode;
  saveConfig();
  rig?.setObd(CONFIG.obdMode);
});
// TUNING's "Reset all to defaults" also resets these two, so show what is now in force.
window.addEventListener('betty-config', () => {
  applyMotion();
  nameInput.value = CONFIG.riderName; bikeInput.value = CONFIG.bikeName; fillVoices(); showCloud(); buttonsBox.checked = CONFIG.headsetButtons; obdSel.value = CONFIG.obdMode; rig?.setObd(CONFIG.obdMode);
  paintBrand(); paintRide();
});
nameInput.addEventListener('change', () => paintBrand());

/** His initial on the avatar, and the footer. */
const titleCase = (t: string) => t.replace(/^\p{L}/u, (c) => c.toUpperCase());
function paintBrand() {
  const name = titleCase(cleanRiderName(CONFIG.riderName));
  $('profileinitial').textContent = name.slice(0, 1);
  $('footer').textContent = BRAND.footer.join('  ·  ');
  $('stagenote').textContent = rig ? (rig.desk ? 'desk chat running' : rig.real ? 'riding' : 'desk test running') : 'phone layout';
}

// ---- the rider screens
const VOICE_MODES: Record<CloudVoiceMode, string> = { stream: 'Gemini', mixed: 'Gemini + Chirp', chirp: 'Chirp', gemini: 'Gemini', off: 'Phone voice' };
const readiness = (): ReadyRow[] => {
  const real = realBox.checked;
  const nav = window.navigator;
  const voiceName = libraryVoice(CONFIG.cloudVoiceName)?.name ?? CONFIG.cloudVoiceName;
  const brain = SERVER ? 'Claude, keys on the server' : ENV.VITE_ANTHROPIC_API_KEY ? 'Claude, local key' : 'No key: canned lines only';
  return [
    { icon: 'pin', label: 'GPS', value: real ? (nav && 'geolocation' in nav ? 'Phone GPS and motion' : 'Not available here') : 'Simulated (desk test)', ok: !real || (!!nav && 'geolocation' in nav) },
    { icon: 'volume', label: 'Voice', value: CONFIG.cloudVoice === 'off' ? 'Phone voice' : `${VOICE_MODES[CONFIG.cloudVoice]}, ${voiceName}`, ok: true },
    { icon: 'headset', label: 'Talking to her', value: CONFIG.headsetButtons ? 'Headset buttons and Ask Betty' : 'Ask Betty button', ok: true },
    { icon: 'spark', label: 'Brain', value: brain, ok: SERVER || !!ENV.VITE_ANTHROPIC_API_KEY },
    { icon: 'gauge', label: 'Engine data', value: CONFIG.obdMode === 'mock' ? 'Simulated (mock)' : 'Off: GPS only', ok: true },
    { icon: 'wrench', label: 'Maintenance', ...readinessRow(ServiceStore.load(), Date.now()) },
    { icon: 'lock', label: 'Screen', value: nav && 'wakeLock' in nav ? 'Kept awake while riding' : 'Set Auto-Lock to Never', ok: !!nav && 'wakeLock' in nav },
  ];
};
// Map suburb borders (Garage > The map, off by default): tiles kept on the phone, both maps repaint as they arrive.
const borderTiles = new BorderTiles(() => { homeRef?.repaintMap(); rideRef?.repaintMap(); });
let homeRef: { repaintMap(): void } | null = null;
let rideRef: { repaintMap(): void } | null = null;
const bordersFor = (center: { lat: number; lon: number }, spanKm: number) => (CONFIG.mapBorders && SERVER ? borderTiles.forView(center, spanKm) : null);
const home = mountHomeScreen(document, shell, {
  borders: bordersFor,
  hello: () => sayOutsideRide(HOME.hello(cleanRiderName(CONFIG.riderName))), readiness, fuelText,
  rides: () => RideLog.load(), track: (rideId) => TrackStore.get(rideId), home: () => CONFIG.feeds.fallbackLocation,
  route: () => RouteStore.get(),
});
homeRef = home;
// Let Betty know me: his rider profile (Garage), passed to a running ride whenever it changes.
mountKnowMe(document, {
  enabled: () => CONFIG.useProfile,
  setEnabled: (on) => { CONFIG.useProfile = on; saveConfig(); },
  changed: () => rig?.engine.setProfile(CONFIG.useProfile ? ProfileStore.get() : null),
  toast: (m, err) => shell.toast(m, err),
  copy: (t) => copyText(t),
});
// Where to? A Google Maps link or typed places, planned by TomTom on Betty's server; Betty follows it on the ride.
const planner = mountRoutePlanner(document, {
  // What is ahead (2026-10-18): the weather at each stop when he would get there leaving now, and the stories researched.
  weather: (r) => fetchRouteWeather(checkpoints(r, null, 1e9, 40)),
  // Plan it with Betty: the places he rides most (to vary from), and where he is.
  known: () => { const n = new Map<string, number>(); for (const r of RideLog.load()) for (const p of r.places) n.set(p, (n.get(p) ?? 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 20); },
  area: () => { const a = rig?.agg.current.area ?? null; return a ? [a.suburb, a.town].filter(Boolean).join(', ') : null; },
  storiesAhead: SERVER ? (r) => researchAhead(r.stops.filter((s, i) => s.named && i > 0)) : undefined,
  fuelNote: (r) => (CONFIG.obdMode === 'off' ? describeFuelPlan(routeFuelPlan(r, CONFIG.fuel, rig ? rig.engine.kmSinceFill() : FuelStore.load())) : ''),
  position: async () => {
    const s = rig?.agg.current;
    if (s?.lat != null && s.lon != null) return { lat: s.lat, lon: s.lon };
    if (!('geolocation' in navigator)) return null;
    return new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null), { timeout: 6000, maximumAge: 120_000 }));
  },
  onChange: (r) => { rig?.engine.setRoute(r); window.dispatchEvent(new window.Event('betty-config')); paintRide(); },
  toast: (m, err) => shell.toast(m, err),
});
/** A ride is running (not just a desk chat session). */
const riding = () => !!rig && !rig.desk;
// While a ride runs, "Ride" in the navigation goes to the ride, not the start page.
// ...and once it has ended, nothing goes back to the empty ride screen (back from the ride's story, say).
shell.setRedirect((id) => (id === 'home' && riding() ? 'ride' : id === 'ride' && !rig ? 'home' : id));
paintBrand();
/** Set while a ride runs: what the ride screen's buttons do. */
let rideHooks: RideActions | null = null;
const rideScreen = mountRideScreen(document, {
  talk: () => rideHooks?.talk(), repeat: () => rideHooks?.repeat(), toggleQuiet: () => rideHooks?.toggleQuiet(), ask: (t) => rideHooks?.ask(t),
  island: (k, g) => rideHooks?.island(k, g), dismiss: (key) => rideHooks?.dismiss?.(key),
}, bordersFor);
rideRef = rideScreen;
// Chat: a conversation view during a ride (the chat button in the ride dock), and the developer chat in the
// Workshop, which also works without a ride by starting a desk session behind it.
const chatListen = (fn: (e: ChatEntry) => void) => { chatListeners.add(fn); return () => { chatListeners.delete(fn); }; };
const chatScreen = mountChatScreen(document, shell, { ask: (t) => rideHooks?.ask(t), talk: () => rideHooks?.talk(), listen: chatListen });
/** Ask from the Workshop chat: through the ride if one runs, otherwise through a desk session started for it. */
const askFromWorkshop = async (text: string) => {
  if (!rig) await start({ desk: true });
  rideHooks?.ask(text);
};
const workshopChat = mountChatPanel($('chat'), {
  ask: (text) => { void askFromWorkshop(text); },
  listen: chatListen,
  session: () => rig?.desk
    ? { text: 'Desk chat session running (simulated, nothing saved as a ride).', action: { label: 'End desk chat', run: () => void stop() } }
    : rig ? { text: rig.real ? 'Talking to the ride in progress.' : 'Talking to the desk test in progress.' }
      : { text: 'No ride running: sending a message starts a desk chat session.', action: { label: 'Start desk chat', run: () => void start({ desk: true }) } },
});
/** Marked spots, for the map (re-read when memory changes, not every second). */
let markPins = RiderMemoryStore.load().marks;
window.addEventListener('betty-memory', () => { markPins = RiderMemoryStore.load().marks; });
/** The ride-in-progress bar and the Ride tab's live dot: on while a real ride runs (not during the sign-off). */
let rideBarText = '';
function paintRideBar() {
  const on = riding() && endNow === null;
  document.documentElement.classList.toggle('riding-bar', on);
  const bar = document.getElementById('ridebar');
  if (bar) bar.hidden = !on;
  document.querySelector('.tab[data-nav="home"]')?.classList.toggle('live', on);
  if (!on || !rig) return;
  const snap = rig.engine.rideSnapshot();
  const min = Math.floor(CONFIG.ridingTimeOnly ? snap.movingMin : snap.minutesOut);
  const text = `Riding · ${Math.round(snap.distanceKm)} km · ${min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}` : `${min} min`}`;
  if (text !== rideBarText) { rideBarText = text; const t = document.getElementById('ridebartext'); if (t) t.textContent = text; }
}
function paintRide() {
  const r = rig;
  if (!r) return;
  paintRideBar(); // only once a ride exists: at load, `endNow` and `riding` further down are not set up yet
  const s = r.agg.current;
  const input = r.s.rideInput();
  const view = rideView(input);
  // Horizon's top card on Betty's Lock screen and the phone's (Now Playing), unless switched off in Garage.
  // Read out and on the lock screens even with the card hidden (a phone in the pocket).
  const top = CONFIG.island.lockLine ? horizonLine(glanceCues(input)) : '';
  lockScreen.setHorizon(top);
  r.buttons.setNowPlaying(top);
  const minLabel = document.getElementById('rideminlabel');
  if (minLabel) minLabel.textContent = CONFIG.ridingTimeOnly ? 'min riding' : 'min out';
  const moving = s.speedKmh >= 3 ? 'On the road' : 'Parked';
  const here = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : r.real ? null : CONFIG.feeds.fallbackLocation;
  const voiceName = libraryVoice(CONFIG.cloudVoiceName)?.name ?? CONFIG.cloudVoiceName;
  const where = [s.area?.suburb, s.area?.town].filter(Boolean).join(', ');
  const routeNow = r.engine.routeNow();
  rideScreen.paint(view, {
    status: moving, mode: r.real ? 'Live' : 'Desk test',
    line: [where || (r.real ? 'Free ride' : 'Desk test, simulated'), s.weather ? `${Math.round(s.weather.tempC)}°, ${s.weather.summary}` : '',
      r.real && !wakeOk ? 'screen may sleep' : '', r.real && !here ? 'waiting for GPS' : '', voiceName].filter(Boolean).join(' · '),
    quiet: input.quietMin > 0, listening: r.s.talk === 'listening',
  }, {
    center: here, here, headingDeg: travelDirection(s), track: r.s.track,
    places: s.nearbyPlaces.map((p) => ({ lat: p.lat, lon: p.lon, label: p.name })),
    incidents: s.incidents.map((i) => ({ lat: i.lat, lon: i.lon, label: i.description })),
    marks: markPins,
    route: routeNow?.route.points, routeStops: routeNow?.route.stops.filter((x) => x.named).map((x) => ({ lat: x.lat, lon: x.lon, label: x.name })),
  });
  chatScreen.setState(view.state, view.orb, r.s.talk === 'listening');
  paintBrand();
}

/** The dashboard numbers in the Workshop, on every update. */
const paintDash = (s: BikeState, engine: TriggerEngine) => {
  showLocked(s.speedKmh);
  $('speed').textContent = String(s.speedKmh);
  $('lean').textContent = s.leanDeg.toFixed(0);
  $('rpm').textContent = s.obd ? String(s.rpm) : '-';
  $('temp').textContent = s.obd ? String(s.engineTempC) : '-';
  $('fuel').textContent = s.obd ? String(Math.round(s.fuelPct)) : '-';
  $('rain').textContent = s.weather ? String(s.weather.rainChanceNextHourPct) : '-';
  $('alt').textContent = s.altitudeM == null ? '-' : String(s.altitudeM);
  const dir = travelDirection(s);
  $('dir').textContent = dir == null ? '-' : compassPoint(dir).split('-').map((w) => w[0].toUpperCase()).join('');
  $('dirsrc').textContent = dir == null ? ' ' : s.headingDeg != null && s.speedKmh >= 10 ? 'GPS course' : 'compass';
  $('jolts').textContent = String(engine.rideSnapshot().jolts);
  showRange(engine.kmSinceFill());
  // Where he is and how many area stories she has (or what the area feed is doing: researching, an error).
  const told = new Set(engine.toldNoteIds());
  const areaNames = [s.area?.town, s.area?.suburb].filter(Boolean).join(', ');
  const areaLine = s.areaNotes.length
    ? `Area: ${areaNames}, ${s.areaNotes.filter((n) => !told.has(n.id)).length} of ${s.areaNotes.length} stories untold`
    : `Area stories: ${rig?.s.feeds.areas ?? 'idle'}`;
  $('feeds').textContent = s.weather
    ? `${s.weather.summary}, ${s.weather.tempC}°C, wind ${s.weather.windKmh} km/h | ${s.incidents.length} traffic incident(s) nearby | ${areaLine}`
    : feedStatus();
};

let starting = false;
async function start(opts: { desk?: boolean } = {}) {
  if (starting) return; // a double tap must not build two rides
  starting = true;
  try {
    if (rig?.desk && !opts.desk) await stop(); // a real ride replaces the Workshop's desk chat session
    if (!rig) await beginRide(opts.desk ?? false);
  } finally { starting = false; }
}

/**
 * Build the ride: the shared RideSession (app/RideSession.ts) with the browser's sensors, voice, mock OBD, headset
 * buttons and push-to-talk around it. A desk session (the Workshop chat with no ride running) is the same rig,
 * simulated, without the briefing, the screen lock or the ride screen, and is never saved as a ride.
 */
async function beginRide(desk: boolean) {
  // Must run synchronously inside the tap (iOS speech, sound and motion permission rules).
  WebSpeaker.prime();
  const player = new ElementPlayer();
  player.prime(); // the cloud voice's clips arrive later; iPhone only lets them play on an element unlocked in a tap
  const pcm = new PcmPlayer();
  if (CONFIG.cloudVoice === 'stream') pcm.prime(); // streamed answers play through Web Audio, unlocked here too
  const buttons = new HeadsetButtons();
  if (CONFIG.headsetButtons) buttons.prime(); // starting it pauses music from other apps: the rider chose this
  const real = !desk && realBox.checked;
  const motionOk = real ? await WebMotionSource.requestPermission() : false;

  const motion = new WebMotionSource();
  const obd = new MockObdSource();
  const key = ENV.VITE_TOMTOM_API_KEY as string | undefined;
  const provider = key ? new TomTomTrafficProvider(key) : SERVER ? new TomTomTrafficProvider(null) : null;
  const sensors = real ? [new WebGeoSource((m) => setStatus(m, true)), ...(motionOk ? [motion] : [])] : [];
  if (real && !motionOk) setStatus('Motion sensors unavailable: no jolt count or compass. GPS still gives speed, lean and heading.', true);

  // The cloud voice plays on the headset buttons' own track while they are Betty's (another sound source could take
  // the buttons away), otherwise on its own element. The phone voice is its backup for every line.
  const cloud = new CloudSpeaker(new WebSpeaker(speechProblem), () => (buttons.holding ? buttons : player), speechProblem, undefined, undefined, undefined, pcm, undefined, clipStore);
  // Her stock phrases in her Gemini voice, ready before they are needed (from the phone after the first ride).
  if (CONFIG.cloudVoice !== 'off' && CONFIG.cloudVoice !== 'chirp') for (const l of STOCK_LINES) cloud.prefetch(l, { priority: 4, id: 'voice' });
  const speaker = new SwitchableSpeaker(cloud);

  const s: RideSession = new RideSession({
    real, desk, server: SERVER, logger,
    claude: new ClaudeClient(ENV.VITE_ANTHROPIC_API_KEY || undefined, 2500, 6000, SERVER ? '/api/phrase' : undefined),
    voice: { speaker, aloud: () => speaker.aloud, prefetch: (t, tag) => cloud.prefetch(t, tag), ready: (t, tag) => cloud.ready(t, tag) },
    sensors, traffic: provider,
    sensorNote: () => (motionOk ? motion.diagnostics() : 'motion sensor: permission not granted'),
    // The OBD feed is started and stopped by the mode switch, so it is not one of the aggregator's own sources.
    setObd: (mode, push) => { obd.stop(); if (mode === 'mock') { obd.reset(); obd.start(push); } else push(NO_OBD); },
    events: {
      changed: () => paintRide(),
      state: (st) => paintDash(st, s.engine),
      chat: toChat,
      lastLine: () => showLocked(s.agg.current.speedKmh),
      fuelChanged: afterFill,
      memoryChanged: () => window.dispatchEvent(new window.Event('betty-memory')),
      configChanged: () => window.dispatchEvent(new window.Event('betty-config')),
      endRequested: () => void stop(),
      toast: (m) => shell.toast(m),
    },
  });
  const { agg, engine, queue } = s;

  const unmountSim = mountSimPanel($('sim'), {
    agg, engine, queue, say: s.say,
    aloud: speaker.aloud,
    setAloud: (on) => { speaker.aloud = on; },
    refreshFeeds: () => s.refreshFeeds(),
    resetRide: () => { s.reset(); obd.reset(); },
    feedStatus,
    lastPhrase: () => {
      const p = s.claude.last;
      return p ? `${p.source}${p.detail ? ' (' + p.detail + ')' : ''}, ${p.latencyMs} ms` : 'none yet';
    },
  });

  const wake = new WakeLock(showWake);
  if (!desk) await wake.enable();
  /** Tones go through the headset buttons' own track when it is running, so they do not steal the buttons. */
  const tone = (freq: number) => { if (!buttons.tone(freq)) beep(freq); };

  // ---- talking to her: headset play/pause (if switched on) or the lock screen's talk button
  const ptt = new PushToTalk(browserPttDeps(), () => ({ id: CONFIG.micDeviceId, label: CONFIG.micLabel, raw: CONFIG.micRaw }));
  const setTalk = (t: RideSession['talk']) => { s.talk = t; paintRide(); };
  const talk = async () => {
    if (ptt.listening) { ptt.stop(); return; } // second press: done talking
    queue.hold(true); // she must not start a line over him
    lockScreen.setTalk(true, true);
    setTalk('listening');
    tone(880);
    newLine('[voice]', 'listening');
    try {
      const clip = await ptt.record();
      if (clip.stalled) newLine('[voice]', 'the recorder did not stop cleanly; the mic will be reopened next time');
      buttons.resume(); // the mic stopped the loop: without it the next press never arrives
      tone(440);
      lockScreen.setTalk(true, false);
      setTalk('thinking');
      queue.hold(true, true); // he has finished: his answer (and "hang on") may go, banter still waits
      if (!clip.heardSpeech) { newLine('[voice]', `heard nothing (${clip.ms} ms from ${clip.mic}, loudest ${clip.peakDb ?? '?'} dB)`); s.sayNow("I didn't hear anything. Try again?"); return; }
      const t0 = Date.now();
      let text: string;
      try {
        text = await within(transcribe(clip.audio), 12000, 'transcription');
      } catch (e) {
        const why = (e as Error).message;
        newLine('[voice]', `could not turn speech into words: ${why}`);
        queue.hold(false);
        s.sayNow(/not set up/.test(why) ? "Talking to me isn't set up yet." : "Sorry, I couldn't make that out. Try again?");
        return;
      }
      newLine('[voice]', `heard "${text}" in ${Date.now() - t0} ms (${Math.round(clip.ms / 100) / 10} s from ${clip.mic}, loudest ${clip.peakDb ?? '?'} dB)`);
      if (!text) { queue.hold(false); s.sayNow("Sorry, I didn't catch that."); return; }
      await s.ask(text); // her answer is queued before anything she was holding back
    } catch (e) {
      newLine('[voice]', `mic did not open: ${(e as Error).name}: ${(e as Error).message}`);
    } finally {
      buttons.resume();
      lockScreen.setTalk(true, false);
      queue.hold(false);
      setTalk('off');
    }
  };
  /** Next track: say the last line again, as it was. */
  const repeat = () => { s.repeat(); };
  talkNow = () => void talk();
  rideHooks = {
    talk: () => void talk(),
    repeat: () => { if (!s.repeat()) shell.toast("She hasn't said anything yet."); },
    ask: (text) => { void s.ask(text); },
    toggleQuiet: () => s.toggleQuiet(),
    dismiss: (key) => { s.dismiss(key); shell.toast('Dismissed for a week.'); },
    // The island's one button per card (Up ahead is a sheet of this page; the rest is the ride's).
    island: (kind, g) => { if (!s.island(kind, g) && kind === 'upahead') { fillUpAhead(); shell.openSheet('upahead'); } },
  };
  /** The "Up ahead" sheet: the route's named stops still to come, how far and when he gets there. */
  const fillUpAhead = () => {
    const now = engine.routeNow();
    const list = document.getElementById('upaheadlist')!;
    if (!now) { list.innerHTML = '<p class="sub">No route planned. Plan one in How are we riding? on the Ride screen.</p>'; return; }
    const { route, progress: p } = now;
    document.getElementById('upaheadtitle')!.textContent = route.name;
    document.getElementById('upaheadsub')!.textContent = p ? `${Math.round(p.leftKm)} km and about ${p.leftMin >= 60 ? `${Math.floor(p.leftMin / 60)} h ${String(p.leftMin % 60).padStart(2, '0')}` : `${p.leftMin} min`} to go${p.offKm > 0.4 ? ` · ${p.offKm.toFixed(1)} km off the route` : ''}` : `${Math.round(route.km)} km planned`;
    (document.getElementById('upaheadmaps') as HTMLAnchorElement).href = route.mapsUrl;
    // What is ahead: the named stops and a point every 40 km, with arrival time (stays counted) and the weather there then.
    const wx = engine.routeWeather();
    const rows = checkpoints(route, p, 40, 12).map((c) => ({ ...c, w: wx.find((w) => w.name === c.name) ?? null }));
    list.innerHTML = rows.length ? rows.map((x) => `<div class="sheet-row${x.named ? '' : ' minor'}"><b>${esc(x.name)}</b><span>${x.km} km · ${new Date(Date.now() + x.inMin * 60_000).toTimeString().slice(0, 5)}${x.w ? ` · ${esc(weatherLine(x.w))}` : ''}</span></div>`).join('')
      : '<p class="sub">Nothing left but the road.</p>';
  };
  lockScreen.setTalk(true);
  // Previous track: Betty lets go (owner, 2026-10-17): the mic closes (ending call mode) and the buttons go back to
  // whichever app plays next. She keeps working; a tap on "Give Betty the buttons back" takes them again (a page can
  // only start sound from a tap, and once music plays the buttons are the music app's).
  const backBtn = document.getElementById('buttonsback') as HTMLButtonElement | null;
  const takeButtons = () => buttons.start({ talk: () => void talk(), repeat, letGo }, (msg) => { newLine('[voice]', msg); });
  const letGo = () => {
    if (!buttons.holding) return;
    buttons.tone(330);
    window.setTimeout(() => {
      ptt.release();
      buttons.stop();
      newLine('[voice]', 'previous track: Betty let go of the mic and the headset buttons (tap "Give Betty the buttons back" to take them again)');
      if (backBtn) backBtn.hidden = false;
    }, 350);
  };
  if (backBtn) {
    backBtn.hidden = true;
    backBtn.onclick = () => { // inside the tap, so the phone lets the silent track start
      buttons.prime();
      const ok = takeButtons();
      backBtn.hidden = ok;
      newLine('[voice]', ok ? 'headset buttons are Betty\'s again' : 'could not take the headset buttons back');
      shell.toast(ok ? 'The buttons are Betty\'s again.' : 'Could not take the buttons back.');
    };
  }
  if (CONFIG.headsetButtons) {
    const ok = takeButtons();
    newLine('[voice]', ok ? 'headset buttons: play/pause talks to Betty, next track repeats her last line, previous track lets go' : 'headset buttons are not available in this browser');
  }

  rig = { s, agg, engine, queue, say: s.say, setObd: (m) => s.setObd(m), real, desk, unmountSim, buttons, releaseMic: () => ptt.release(), wake };
  await s.start();
  endText.textContent = END_BUTTON.idle;
  workshopChat.refresh();
  paintRide();
  if (desk) { setStatus('Desk chat session started: simulated, nothing saved as a ride.'); return; }
  realBox.disabled = true;
  home.setRiding(true);
  chatScreen.setRiding(true);
  shell.show('ride');
  if (!statusEl.textContent) setStatus(real ? 'Keep this screen open while riding.' : 'Simulated session: no phone sensors in use.');
}

/** Set while END RIDE is waiting for her to finish; calling it ends the ride at once. */
let endNow: (() => void) | null = null;

/**
 * END RIDE: stop reacting to the ride, let her say the sign-off (after whatever line is already playing) and
 * finish it, and only then shut everything down. A second tap on the button skips the wait.
 */
async function stop() {
  const r = rig;
  if (!r || endNow) return;
  let hurry = false;
  endNow = () => { hurry = true; };
  endText.textContent = END_BUTTON.ending;
  shell.closeSheet();
  const { rideId, kept } = r.s.wrapUp(); // no new alerts or banter from here on; the queue and voice stay alive
  // The story of the ride opens NOW, while she signs off (owner, 2026-10-17: the summary sometimes never came: it
  // waited up to 45 s for the sign-off, and only opened if he was still on the ride screen by then).
  if (kept) { journeys.renderStory(rideId); shell.show('story'); }
  // Her sign-off cuts in (owner, 2026-10-18); a tap on "stop now" counts while it is still being written, too.
  await r.s.signOff(() => hurry);

  r.s.shutdown();
  r.unmountSim();
  r.buttons.stop();
  r.releaseMic();
  const back = document.getElementById('buttonsback'); if (back) { back.hidden = true; (back as HTMLButtonElement).onclick = null; }
  talkNow = null;
  rideHooks = null;
  lockScreen.setTalk(false);
  if (!r.desk) await r.wake.disable();
  showWake(null);
  rig = null;
  endNow = null;
  paintRideBar();
  endText.textContent = END_BUTTON.idle;
  realBox.disabled = false;
  home.setRiding(false);
  chatScreen.setRiding(false);
  workshopChat.refresh();
  paintBrand();
  // The story again with her sign-off line in it; a ride too short to keep says so instead of vanishing. If he went
  // back to the ride (or chat) screen while she signed off, take him off it: with the ride over it is an empty page
  // whose End ride does nothing (owner's bug, 2026-10-18: "stuck on that page").
  const onRide = shell.current === 'ride' || shell.current === 'chat';
  if (kept) { if (shell.current === 'story') journeys.renderStory(rideId); else if (onRide) { journeys.renderStory(rideId); shell.show('story'); } }
  else if (!r.desk) {
    if (onRide) shell.show('home');
    shell.toast('A short one: rides under 3 minutes and 1 km are not kept in My journeys.');
  }
  setStatus('');
}

$('ridebar').addEventListener('click', () => shell.show('ride'));
// Start riding (or, while a ride runs, go back to it). End ride asks first; during the sign-off it ends at once.
startBtn.addEventListener('click', () => { if (riding()) shell.show('ride'); else if (!starting) void start(); });
// With no ride at all (never expected, but it once left him stuck): End ride just takes him home.
endBtn.addEventListener('click', () => { if (endNow) endNow(); else if (riding()) shell.openSheet('end'); else if (!rig) shell.show('home'); });
$('endconfirm').addEventListener('click', () => { if (endNow) endNow(); else if (rig) void stop(); else { shell.closeSheet(); shell.show('home'); } });

// Last, once every screen is mounted (their onShow handlers fill them in). After a pull-to-refresh: back to the screen he was on (and the same ride's story), scrolled where it was.
{
  const spot = takeSpot();
  if (spot && spot.screen !== 'home') {
    if (spot.screen === 'story' && spot.ride) { shell.show('journeys'); journeys.open(spot.ride); } // back goes to the journeys
    else if (spot.screen === 'help') { shell.show('settings'); shell.show('help'); } // back goes to the Garage
    else shell.show(spot.screen as ScreenId);
    const el = document.querySelector<HTMLElement>(`[data-screen="${spot.screen}"]`);
    if (el) requestAnimationFrame(() => { el.scrollTop = spot.scroll; });
  }
}
