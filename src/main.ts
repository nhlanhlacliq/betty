import { loadConfig, saveConfig } from './config/persist';
import { CONFIG, ObdMode, cleanBikeName, cleanRiderName } from './config/betty';
import { NO_OBD, StateAggregator } from './core/StateAggregator';
import { TriggerEngine, isSafeWindow } from './core/TriggerEngine';
import { placesFromHere, travelDirection } from './core/ambient';
import { Command, addMark, addNote, forgetLast, parseCommand } from './core/Commands';
import { RiderMemoryStore } from './adapters/RiderMemoryStore';
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
import { ChatEntry, mountChatPanel } from './ui/ChatPanel';
import { mountVoiceTestPanel } from './ui/VoiceTestPanel';
import { mountTuningPanel } from './ui/TuningPanel';
import { mountLockScreen } from './ui/LockScreen';
import { mountLogPanel } from './ui/LogPanel';
import { mountMemoryPanel } from './ui/MemoryPanel';
import { mountChangelogPanel } from './ui/ChangelogPanel';
import { LineLogStore } from './adapters/LineLogStore';
import { FuelStore } from './adapters/FuelStore';
import { HeadsetButtons } from './adapters/HeadsetButtons';
import { PushToTalk, browserPttDeps, transcribe, within } from './adapters/PushToTalk';
import { beep } from './adapters/audio';
import { IncidentMemory } from './adapters/IncidentMemory';
import { LogEntry } from './core/LineLog';

loadConfig();

/** Build-time keys. Absent when the page is run outside Vite (the smoke test), where Betty simply has no keys. */
const ENV: Record<string, string | undefined> = import.meta.env ?? {};
/** Deployed: keys live on Betty's server (api/), not in this page. Local development uses VITE_ keys from .env. */
const SERVER = ENV.VITE_USE_SERVER === '1';
/** What she says when an answer is slow (usually a web search), and how slow counts. */
const HANG_ON = 'Hang on, let me check.';
const HANG_ON_AFTER_MS = 2500;

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
  setObd: (mode: ObdMode) => void; unsub: () => void; unmountSim: () => void; unmountChat: () => void; buttons: HeadsetButtons; releaseMic: () => void; wake: WakeLock; remember: () => void; memTimer: number; logSensors: () => void; sensorTimer: number;
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
  clear: () => { unsaved = []; LineLogStore.clear(); },
});
mountMemoryPanel($('memorypanel'), {
  load: () => RiderMemoryStore.load(),
  save: (m) => { RiderMemoryStore.save(m); rig?.engine.setMemory(m); },
});
mountChangelogPanel($('changelogpanel'));

// Lock screen: covers everything so nothing can be pressed by accident; hold its button to get back.
/** Set while a ride runs: start or finish talking to Betty. */
let talkNow: (() => void) | null = null;
const lockScreen = mountLockScreen($('lockroot'), 1000, () => talkNow?.());
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

const wakeEl = $('wake');
const showWake = (s: WakeStatus | null) => {
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
  nameInput.value = CONFIG.riderName; bikeInput.value = CONFIG.bikeName; fillVoices(); buttonsBox.checked = CONFIG.headsetButtons; obdSel.value = CONFIG.obdMode; rig?.setObd(CONFIG.obdMode);
});

let starting = false;
async function start() {
  if (starting) return; // a double tap must not build two rides
  starting = true;
  try { await beginRide(); } finally { starting = false; }
}

async function beginRide() {
  // Must run synchronously inside the tap (iOS speech, sound and motion permission rules).
  WebSpeaker.prime();
  const buttons = new HeadsetButtons();
  if (CONFIG.headsetButtons) buttons.prime(); // starting it pauses music from other apps: the rider chose this
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
  const provider = key ? new TomTomTrafficProvider(key) : SERVER ? new TomTomTrafficProvider(null) : null;
  const traffic = new TrafficSource(provider, pos, (m) => { feed.traffic = m; });

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
  engine.setKnownIncidents(IncidentMemory.load());
  currentRideId = engine.rideSnapshot().startedAt; // ties each logged line to its ride record
  engine.setFuelKm(FuelStore.load());
  engine.setMemory(RiderMemoryStore.load());
  // Saved as the ride goes, not only at END RIDE: a phone browser can kill the tab without warning.
  const remember = () => {
    const w = agg.current.weather;
    const rec = toRecord(engine.rideSnapshot(), w ? `${w.summary}, ${w.tempC} C` : null);
    if (rec) RideLog.save(rec);
    FuelStore.save(engine.kmSinceFill());
    IncidentMemory.save(engine.announcedIncidents());
  };
  const memTimer = window.setInterval(remember, 60_000);
  // What the sensors actually delivered, written into the log now and then and at END RIDE.
  const logSensors = () => {
    const s = agg.current; const r = engine.rideSnapshot();
    newLine('[sensors]', `${real ? (motionOk ? motion.diagnostics() : 'motion sensor: permission not granted') : 'simulated session'}; `
      + `GPS altitude ${s.altitudeM ?? 'none'}, course ${s.headingDeg == null ? 'none' : Math.round(s.headingDeg) + ' deg'}; `
      + `ride so far: deepest lean ${r.maxLeanDeg} deg, ${r.stops} stops, ${r.hardBrakes} hard brakes, ${r.hardAccels} hard pulls, ${r.jolts} jolts`);
    renderLog();
  };
  const sensorTimer = window.setInterval(logSensors, 15 * 60_000);
  const claude = new ClaudeClient(ENV.VITE_ANTHROPIC_API_KEY || undefined, 2500, 6000, SERVER ? '/api/phrase' : undefined);
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
    toChat({ from: 'betty', text: line.text, at: Date.now(), ev, phrase: p });
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
      engine.reset(); claude.forgetTalk(); obd.reset(); queue.clear(); lines.length = 0; renderLog();
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
  /** Tones go through the headset buttons' own track when it is running, so they do not steal the buttons. */
  const tone = (freq: number) => { if (!buttons.tone(freq)) beep(freq); };
  const sayNow = (text: string) => { newLine('[P4] voice', text).item = queue.enqueue(text, 4); renderLog(); };
  /** Her reply to a command: instant, from the phone, no Claude call (so it also works without signal). */
  const reply = (text: string, command: string) => { sayNow(text); toChat({ from: 'betty', text, at: Date.now(), command }); };
  const remembered = (m: ReturnType<typeof RiderMemoryStore.load>) => { RiderMemoryStore.save(m); engine.setMemory(m); window.dispatchEvent(new window.Event('betty-memory')); };
  const howLong = (min: number) => min === 60 ? 'an hour' : min === 30 ? 'half an hour' : min % 60 === 0 ? `${min / 60} hours` : `${min} minute${min === 1 ? '' : 's'}`;
  /** Voice stage 3: things he tells her to do rather than asks. */
  const obey = (c: Command) => {
    newLine('[command]', c.kind === 'quiet' ? `quiet ${c.minutes === null ? 'until told' : `for ${c.minutes} min`}` : c.kind === 'mark' ? `mark${c.note ? `: ${c.note}` : ''}` : c.kind === 'remember' ? `remember: ${c.fact}` : c.kind);
    switch (c.kind) {
      case 'repeat': reply(lastLine || "I haven't said anything yet.", 'repeat'); return;
      case 'quiet':
        engine.setQuiet(c.minutes === null ? Infinity : Date.now() + c.minutes * 60_000);
        queue.dropAmbient();
        reply(c.minutes === null
          ? "Going quiet. Say talk to me when you want me back. Alerts still come through."
          : `Quiet for ${howLong(c.minutes)}. Alerts still come through.`, 'quiet');
        return;
      case 'talk':
        if (engine.quietLeftMin() > 0) { engine.setQuiet(0); reply("I'm back.", 'talk again'); } else reply('I never left.', 'talk again');
        return;
      case 'mark': {
        const s = agg.current;
        if (s.lat == null || s.lon == null) { reply("I've got no GPS fix, so I can't mark this spot.", 'mark'); return; }
        const near = placesFromHere(s).filter((p) => p.distanceKm <= 3).sort((a, b) => a.distanceKm - b.distanceKm)[0]?.name ?? null;
        remembered(addMark(RiderMemoryStore.load(), { at: Date.now(), lat: s.lat, lon: s.lon, note: c.note, near }));
        reply(`Marked${near ? `, near ${near}` : ''}.`, 'mark');
        return;
      }
      case 'remember':
        remembered(addNote(RiderMemoryStore.load(), c.fact, Date.now()));
        reply("Noted. I'll remember that.", 'remember');
        return;
      case 'forget': {
        const { memory, gone } = forgetLast(RiderMemoryStore.load());
        if (gone) remembered(memory);
        reply(gone === 'note' ? 'Forgotten.' : gone === 'mark' ? "That spot's unmarked." : "There's nothing to forget.", 'forget');
      }
    }
  };
  /** Something he said to her, typed or spoken: one path for both. */
  const askBetty = async (text: string) => {
    toChat({ from: 'rider', text, at: Date.now() });
    const command = parseCommand(text);
    if (command) { obey(command); renderLog(); return null; }
    // A web search takes a few seconds: rather than silence, she says she is on it.
    const slow = window.setTimeout(() => sayNow(HANG_ON), HANG_ON_AFTER_MS);
    try { return await say(engine.ask(text, agg.current)); } finally { window.clearTimeout(slow); }
  };

  // ---- talking to her: headset play/pause (if switched on) or the lock screen's talk button
  const ptt = new PushToTalk(browserPttDeps(), () => ({ id: CONFIG.micDeviceId, label: CONFIG.micLabel, raw: CONFIG.micRaw }));
  const talk = async () => {
    if (ptt.listening) { ptt.stop(); return; } // second press: done talking
    queue.hold(true); // she must not start a line over him
    lockScreen.setTalk(true, true);
    tone(880);
    newLine('[voice]', 'listening'); renderLog();
    try {
      const clip = await ptt.record();
      if (clip.stalled) newLine('[voice]', 'the recorder did not stop cleanly; the mic will be reopened next time');
      buttons.resume(); // the mic stopped the loop: without it the next press never arrives
      tone(440);
      lockScreen.setTalk(true, false);
      queue.hold(true, true); // he has finished: his answer (and "hang on") may go, banter still waits
      if (!clip.heardSpeech) { newLine('[voice]', `heard nothing (${clip.ms} ms from ${clip.mic}, loudest ${clip.peakDb ?? '?'} dB)`); sayNow("I didn't hear anything. Try again?"); return; }
      const t0 = Date.now();
      let text: string;
      try {
        text = await within(transcribe(clip.audio), 12000, 'transcription');
      } catch (e) {
        const why = (e as Error).message;
        newLine('[voice]', `could not turn speech into words: ${why}`);
        queue.hold(false);
        sayNow(/not set up/.test(why) ? "Talking to me isn't set up yet." : "Sorry, I couldn't make that out. Try again?");
        return;
      }
      newLine('[voice]', `heard "${text}" in ${Date.now() - t0} ms (${Math.round(clip.ms / 100) / 10} s from ${clip.mic}, loudest ${clip.peakDb ?? '?'} dB)`);
      if (!text) { queue.hold(false); sayNow("Sorry, I didn't catch that."); return; }
      await askBetty(text); // her answer is queued before anything she was holding back
    } catch (e) {
      newLine('[voice]', `mic did not open: ${(e as Error).name}: ${(e as Error).message}`);
    } finally {
      buttons.resume();
      lockScreen.setTalk(true, false);
      queue.hold(false);
      renderLog();
    }
  };
  /** Next track: say the last line again, as it was. */
  const repeat = () => { if (lastLine) sayNow(lastLine); };
  talkNow = () => void talk();
  lockScreen.setTalk(true);
  if (CONFIG.headsetButtons) {
    const ok = buttons.start({ talk: () => void talk(), repeat }, (msg) => { newLine('[voice]', msg); renderLog(); });
    newLine('[voice]', ok ? 'headset buttons: play/pause talks to Betty, next track repeats her last line' : 'headset buttons are not available in this browser');
  }

  const unmountChat = mountChatPanel($('chat'), {
    ask: (text) => { void askBetty(text); },
    listen: (fn) => { chatListeners.add(fn); return () => { chatListeners.delete(fn); }; },
  });

  rig = { agg, engine, queue, say, setObd, unsub, unmountSim, unmountChat, buttons, releaseMic: () => ptt.release(), wake, remember, memTimer, logSensors, sensorTimer };
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
  window.clearInterval(r.sensorTimer);
  r.remember();
  r.logSensors();
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
  r.unmountChat();
  r.buttons.stop();
  r.releaseMic();
  talkNow = null;
  lockScreen.setTalk(false);
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
