import { loadConfig, saveConfig } from './config/persist';
import { CONFIG, ObdMode, cleanBikeName, cleanRiderName } from './config/betty';
import { NO_OBD, StateAggregator } from './core/StateAggregator';
import { TriggerEngine, isSafeWindow } from './core/TriggerEngine';
import { travelDirection } from './core/ambient';
import { compassPoint } from './core/geo';
import { AudioQueue, Fate, QueueItem } from './core/AudioQueue';
import { ClaudeClient } from './core/ClaudeClient';
import { LatLon } from './core/geo';
import { AMBIENT_IDS, TriggerEvent } from './core/types';
import { MockObdSource } from './adapters/MockObdSource';
import { WebGeoSource } from './adapters/WebGeoSource';
import { WebMotionSource } from './adapters/WebMotionSource';
import { WebSpeaker } from './adapters/WebSpeaker';
import { SwitchableSpeaker } from './adapters/SwitchableSpeaker';
import { WeatherSource } from './adapters/WeatherSource';
import { TrafficSource } from './adapters/TrafficSource';
import { PlaceSource } from './adapters/PlaceSource';
import { RideLog } from './adapters/RideLog';
import { toRecord } from './core/RideMemory';
import { TomTomTrafficProvider } from './adapters/TomTomTraffic';
import { WakeLock, WakeStatus } from './adapters/WakeLock';
import { mountSimPanel } from './ui/SimPanel';
import { mountTuningPanel } from './ui/TuningPanel';
import { mountLockScreen } from './ui/LockScreen';
import { mountLogPanel } from './ui/LogPanel';
import { LineLogStore } from './adapters/LineLogStore';
import { FuelStore } from './adapters/FuelStore';
import { LogEntry } from './core/LineLog';

loadConfig();

/** Build-time keys. Absent when the page is run outside Vite (the smoke test), where Betty simply has no keys. */
const ENV: Record<string, string | undefined> = import.meta.env ?? {};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = $<HTMLButtonElement>('toggle');
const realBox = $<HTMLInputElement>('real');
const statusEl = $('status');
const logEl = $('log');
const setStatus = (msg: string, err = false) => { statusEl.textContent = msg; statusEl.className = err ? 'err' : ''; };

const feed = { weather: 'idle', traffic: 'idle', places: 'idle' };
const feedStatus = () => `Weather: ${feed.weather} | Traffic: ${feed.traffic} | Places: ${feed.places}`;

interface Rig {
  agg: StateAggregator; engine: TriggerEngine; queue: AudioQueue; say: (ev: TriggerEvent) => Promise<QueueItem | null>;
  setObd: (mode: ObdMode) => void; unsub: () => void; unmountSim: () => void; wake: WakeLock; remember: () => void; memTimer: number;
}
let rig: Rig | null = null;
interface LogLine { id: string; at: number; rideId: number; head: string; text: string; item: QueueItem | null }
/** What the screen shows: the current ride, newest first. */
const lines: LogLine[] = [];
/** Lines from this page session whose saved copy may be out of date (new, or still waiting to be spoken). */
let unsaved: LogLine[] = [];
let currentRideId = 0;
let lineSeq = 0;
const newLine = (head: string, text: string): LogLine => {
  const at = Date.now();
  const line: LogLine = { id: `${at}-${++lineSeq}`, at, rideId: currentRideId || at, head, text, item: null };
  lines.unshift(line);
  unsaved.push(line);
  saveLogSoon();
  return line;
};
const FATE_LABELS: Record<Fate, string> = {
  queued: 'waiting to speak', speaking: 'speaking now', spoken: 'spoken', expired: 'not spoken: waited too long',
  interrupted: 'cut off by a critical alert', cleared: 'cleared',
};
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const renderLog = () => {
  logEl.innerHTML = lines.slice(0, 10)
    .map((l) => `<div>${esc(l.head)}: ${esc(l.text)}${l.item ? ` <span class="fate">[${FATE_LABELS[l.item.fate]}]</span>` : ''}</div>`).join('');
};
const toEntry = (l: LogLine): LogEntry => ({
  id: l.id, at: l.at, rideId: l.rideId, head: l.head, text: l.text, fate: l.item ? FATE_LABELS[l.item.fate] : '',
});
const SETTLED: Fate[] = ['spoken', 'expired', 'interrupted', 'cleared'];
/** Write the log to the phone. Lines still waiting or playing stay on the list so their final fate gets saved too. */
const saveLog = () => {
  LineLogStore.save(unsaved.map(toEntry));
  unsaved = unsaved.filter((l) => l.item && !SETTLED.includes(l.item.fate));
};
let saveTimer: number | undefined;
const saveLogSoon = () => { if (saveTimer === undefined) saveTimer = window.setTimeout(() => { saveTimer = undefined; saveLog(); }, 2000); };
// A phone browser can drop the tab without warning; save whenever the page is hidden.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveLog(); });
window.addEventListener('pagehide', saveLog);

/** Problems the speech engine reports (a line that would not start, or never finished). Shown, not swallowed. */
const speechProblem = (msg: string) => {
  newLine('[audio]', msg);
  renderLog();
};

mountTuningPanel($('tuning'));
mountLogPanel($('logpanel'), {
  entries: () => { saveLog(); return LineLogStore.load(); },
  rides: () => RideLog.load(),
  clear: () => { unsaved = []; LineLogStore.clear(); },
});

// Lock screen: covers everything so nothing can be pressed by accident; hold its button to get back.
const lockScreen = mountLockScreen($('lockroot'));
$('lock').addEventListener('click', () => lockScreen.lock());
let lastLine = '';
const showLocked = (speed: number) => lockScreen.setInfo(String(speed), lastLine);

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
  $('range').textContent = kmSinceFill === null ? '-' : String(Math.max(0, Math.round(CONFIG.fuel.rangeKm - kmSinceFill)));
  $('rangesrc').textContent = kmSinceFill === null ? 'tap FILLED UP' : `km left, ${Math.round(kmSinceFill)} since fill`;
};
showRange(FuelStore.load());
$('filled').addEventListener('click', () => {
  rig?.engine.filledUp();
  FuelStore.save(0);
  showRange(0);
  setStatus(`Fill-up noted. Range reset to ${CONFIG.fuel.rangeKm} km.`);
});

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
    o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`;
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

const wakeEl = $('wake');
const showWake = (s: WakeStatus | null) => {
  wakeEl.className = s === 'on' ? 'ok' : 'err';
  wakeEl.textContent = s === null ? ''
    : s === 'on' ? 'Screen will stay awake while this page is open and in front.'
      : s === 'off' ? 'Screen is NOT being kept awake. Tap the page, or set Auto-Lock to Never in the phone settings.'
        : 'This browser cannot keep the screen awake. Set Auto-Lock to Never in the phone settings before riding.';
};

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
  nameInput.value = CONFIG.riderName; bikeInput.value = CONFIG.bikeName; fillVoices(); obdSel.value = CONFIG.obdMode; rig?.setObd(CONFIG.obdMode);
});

let starting = false;
async function start() {
  if (starting) return; // a double tap must not build two rides
  starting = true;
  try { await beginRide(); } finally { starting = false; }
}

async function beginRide() {
  // Must run synchronously inside the tap (iOS speech + motion permission rules).
  WebSpeaker.prime();
  const real = realBox.checked;
  const motionOk = real ? await WebMotionSource.requestPermission() : false;

  const agg = new StateAggregator();
  const motion = new WebMotionSource();
  const obd = new MockObdSource();
  const pos = (): LatLon => {
    const s = agg.current;
    return s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : CONFIG.feeds.fallbackLocation;
  };
  const weather = new WeatherSource(pos, (m) => { feed.weather = m; });
  const key = ENV.VITE_TOMTOM_API_KEY as string | undefined;
  const traffic = new TrafficSource(key ? new TomTomTrafficProvider(key) : null, pos, (m) => { feed.traffic = m; });

  const places = new PlaceSource(pos, (m) => { feed.places = m; });

  if (real) {
    agg.addSource(new WebGeoSource((m) => setStatus(m, true)));
    if (motionOk) agg.addSource(motion); else setStatus('Motion sensors unavailable: no jolt count or compass. GPS still gives speed, lean and heading.', true);
  }
  agg.addSource(weather);
  agg.addSource(traffic);
  agg.addSource(places);

  // The OBD feed is started and stopped by the mode switch, so it is not one of the aggregator's own sources.
  const setObd = (mode: ObdMode) => {
    obd.stop();
    if (mode === 'mock') { obd.reset(); obd.start((p) => agg.push(p)); } else agg.push(NO_OBD);
  };

  const engine = new TriggerEngine();
  engine.setHistory(RideLog.load());
  currentRideId = engine.rideSnapshot().startedAt; // ties each logged line to its ride record
  engine.setFuelKm(FuelStore.load());
  // Saved as the ride goes, not only at END RIDE: a phone browser can kill the tab without warning.
  const remember = () => {
    const w = agg.current.weather;
    const rec = toRecord(engine.rideSnapshot(), w ? `${w.summary}, ${w.tempC} C` : null);
    if (rec) RideLog.save(rec);
    FuelStore.save(engine.kmSinceFill());
  };
  const memTimer = window.setInterval(remember, 60_000);
  const claude = new ClaudeClient(ENV.VITE_ANTHROPIC_API_KEY || undefined);
  const speaker = new SwitchableSpeaker(new WebSpeaker(speechProblem));
  const queue = new AudioQueue(speaker, () => isSafeWindow(agg.current), Date.now, () => { renderLog(); saveLogSoon(); });

  const say = async (ev: TriggerEvent) => {
    const p = await claude.phrase(ev, agg.current);
    // Safety stays serious: an ambient line that comes back while a critical condition is active is dropped.
    const dropped = AMBIENT_IDS.includes(ev.id) && engine.ambientBlocked(agg.current);
    const text = dropped ? '' : p.text;
    const meta = `${p.source}${p.detail ? ': ' + p.detail : ''}, ${p.latencyMs} ms`;
    const line = newLine(`[P${ev.priority}] ${ev.id} (${meta})`, text || (dropped ? '(dropped: critical alert active)' : '(silent)'));
    line.item = queue.enqueue(text, ev.priority); // the item carries its fate: waiting, speaking, spoken, or why not
    renderLog();
    if (text) { lastLine = text; showLocked(agg.current.speedKmh); }
    return line.item;
  };

  const unsub = agg.subscribe((s) => {
    $('speed').textContent = String(s.speedKmh);
    showLocked(s.speedKmh);
    $('lean').textContent = s.leanDeg.toFixed(0);
    $('rpm').textContent = s.obd ? String(s.rpm) : '-';
    $('temp').textContent = s.obd ? String(s.engineTempC) : '-';
    $('fuel').textContent = s.obd ? String(Math.round(s.fuelPct)) : '-';
    $('rain').textContent = s.weather ? String(s.weather.rainChanceNextHourPct) : '-';
    $('alt').textContent = s.altitudeM == null ? '-' : String(s.altitudeM);
    const dir = travelDirection(s);
    $('dir').textContent = dir == null ? '-' : compassPoint(dir).split('-').map((w) => w[0].toUpperCase()).join('');
    $('dirsrc').textContent = dir == null ? '\u00a0' : s.headingDeg != null && s.speedKmh >= 10 ? 'GPS course' : 'compass';
    $('jolts').textContent = String(engine.rideSnapshot().jolts);
    showRange(engine.kmSinceFill());
    $('feeds').textContent = s.weather
      ? `${s.weather.summary}, ${s.weather.tempC}°C, wind ${s.weather.windKmh} km/h | ${s.incidents.length} traffic incident(s) nearby`
      : feedStatus();
    engine.evaluate(s).forEach(say);
    queue.pump();
  });

  const unmountSim = mountSimPanel($('sim'), {
    agg, engine, queue, say,
    aloud: speaker.aloud,
    setAloud: (on) => { speaker.aloud = on; },
    refreshFeeds: () => { weather.refresh(); traffic.refresh(); places.refresh(); },
    resetRide: () => {
      engine.reset(); obd.reset(); queue.clear(); lines.length = 0; renderLog();
      currentRideId = engine.rideSnapshot().startedAt; // the screen starts clean; the saved log keeps the earlier lines
    },
    feedStatus,
    lastPhrase: () => {
      const p = claude.last;
      return p ? `${p.source}${p.detail ? ' (' + p.detail + ')' : ''}, ${p.latencyMs} ms` : 'none yet';
    },
  });

  const wake = new WakeLock(showWake);
  await wake.enable();
  await agg.start();
  setObd(CONFIG.obdMode);
  say(engine.startup());
  rig = { agg, engine, queue, say, setObd, unsub, unmountSim, wake, remember, memTimer };
  toggle.textContent = 'END RIDE';
  toggle.classList.add('stop');
  realBox.disabled = true;
  if (!statusEl.textContent) setStatus(real ? 'Keep this screen open while riding.' : 'Simulated session: no phone sensors in use.');
}

/** Longest END RIDE will wait for the sign-off before shutting down regardless. */
const SIGN_OFF_LIMIT_MS = 45_000;
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
  toggle.textContent = 'ENDING RIDE... (tap to stop now)';
  window.clearInterval(r.memTimer);
  r.remember();
  r.unsub(); // no new alerts or banter from here on; the queue and speaker stay alive

  // A sign-off for any ride worth remembering.
  const debrief = toRecord(r.engine.rideSnapshot(), null) ? r.engine.force('ride_debrief', r.agg.current) : null;
  const item = debrief ? await r.say(debrief) : null;
  const deadline = Date.now() + SIGN_OFF_LIMIT_MS;
  while (item && !SETTLED.includes(item.fate) && !hurry && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 150));
  }

  r.queue.clear(); // anything still waiting belongs to a ride that is over (and cuts her off if the wait was skipped)
  r.setObd('off');
  r.agg.stop();
  r.unmountSim();
  saveLog();
  await r.wake.disable();
  showWake(null);
  rig = null;
  endNow = null;
  toggle.textContent = 'START RIDE';
  toggle.classList.remove('stop');
  realBox.disabled = false;
  setStatus('');
}

toggle.addEventListener('click', () => {
  if (endNow) endNow(); else if (rig) void stop(); else if (!starting) void start();
});
