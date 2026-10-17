import { loadConfig, saveConfig } from './config/persist';
import { CLOUD_VOICES, CONFIG, CloudVoiceMode, ObdMode, applyTalkPreset, cleanBikeName, cleanRiderName, libraryVoice, mixSummary, nudgeMix } from './config/betty';
import { LIBRARY_ACCENTS, LIBRARY_VOICES } from './config/voiceLibrary';
import { CloudSpeaker, ElementPlayer, SOUND_TEST_LINES, STOCK_LINES } from './adapters/CloudSpeaker';
import { IdbClipStore } from './adapters/ClipStore';
import { PcmPlayer } from './adapters/PcmPlayer';
import { NO_OBD, StateAggregator } from './core/StateAggregator';
import { TriggerEngine, isSafeWindow } from './core/TriggerEngine';
import { placesFromHere, travelDirection } from './core/ambient';
import { Command, addMark, addNote, forgetLast, parseCommand } from './core/Commands';
import { RiderMemoryStore } from './adapters/RiderMemoryStore';
import { compassPoint } from './core/geo';
import { AudioQueue, Fate, QueueItem } from './core/AudioQueue';
import { ClaudeClient, voiceTags } from './core/ClaudeClient';
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
import { AreaSource, AreaStore, ToldStore } from './adapters/AreaSource';
import { TrackStore } from './adapters/TrackStore';
import { TrackPoint, addTrackPoint } from './core/Track';
import { RideLog } from './adapters/RideLog';
import { toRecord } from './core/RideMemory';
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
import { IncidentMemory } from './adapters/IncidentMemory';
import { LogEntry, formatLog } from './core/LineLog';
import { copyText, downloadText, mountShell } from './ui/Shell';
import { ReadyRow, mountHomeScreen } from './ui/screens/HomeScreen';
import { RideActions, mountRideScreen } from './ui/screens/RideScreen';
import { mountJourneysScreen } from './ui/screens/JourneysScreen';
import { mountExploreScreen } from './ui/screens/ExploreScreen';
import { mountSettingsScreen } from './ui/screens/SettingsScreen';
import { IdbAvatarStore, mountAvatarSetting } from './ui/avatar';
import { mountBackup } from './ui/backup';
import { rideTitle } from './ui/screens/HomeScreen';
import { drawRideCard, shareRideCard } from './ui/rideCard';
import { mountPullToRefresh, mountSheetDrag } from './ui/gestures';
import { SaidLine, rideView } from './ui/rideView';
import { BRAND, END_BUTTON, HOME, sampleLine } from './ui/copy';

loadConfig();

/** Build-time keys. Absent when the page is run outside Vite (the smoke test), where Betty simply has no keys. */
const ENV: Record<string, string | undefined> = import.meta.env ?? {};
/** Deployed: keys live on Betty's server (api/), not in this page. Local development uses VITE_ keys from .env. */
const SERVER = ENV.VITE_USE_SERVER === '1';
/** What she says when an answer is slow (usually a web search), and how slow counts. */
const HANG_ON = 'Hang on, let me check.';
const HANG_ON_AFTER_MS = 2500;

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

const feed = { weather: 'idle', traffic: 'idle', places: 'idle', areas: 'idle' };
const feedStatus = () => `Weather: ${feed.weather} | Traffic: ${feed.traffic} | Places: ${feed.places} | Area stories: ${feed.areas}`;

interface Rig {
  agg: StateAggregator; engine: TriggerEngine; queue: AudioQueue; say: (ev: TriggerEvent) => Promise<QueueItem | null>;
  setObd: (mode: ObdMode) => void; unsub: () => void; real: boolean; /** A desk session for the Workshop chat: not a ride */ desk: boolean; unmountSim: () => void; buttons: HeadsetButtons; releaseMic: () => void; wake: WakeLock; remember: () => void; memTimer: number; logSensors: () => void; sensorTimer: number; paintTimer: number;
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
const memoryCtx = {
  load: () => RiderMemoryStore.load(),
  save: (m: ReturnType<typeof RiderMemoryStore.load>) => { RiderMemoryStore.save(m); rig?.engine.setMemory(m); },
};
mountMemoryPanel($('memorypanel'), memoryCtx);
mountExploreScreen(document, shell, {
  ...memoryCtx,
  stories: () => Object.fromEntries(Object.entries(AreaStore.all()).map(([area, kept]) => [area, kept.notes ?? []])),
  told: () => new Set(rig ? rig.engine.toldNoteIds() : ToldStore.load()),
});
const rideLogText = (rideId: number) => { saveLog(); return formatLog(LineLogStore.load(), RideLog.load(), rideId); };
const journeys = mountJourneysScreen(document, shell, {
  rides: () => RideLog.load(),
  entries: () => { saveLog(); return LineLogStore.load(); },
  track: (rideId) => TrackStore.get(rideId),
  copyRide: (rideId) => copyText(rideLogText(rideId)),
  saveRide: (rideId) => { if (!downloadText(`betty-ride-${new Date(rideId).toISOString().slice(0, 16).replace(':', '')}.txt`, rideLogText(rideId))) shell.toast('Saving a file is not available here'); },
  toast: (msg) => shell.toast(msg),
  // A picture of the ride to share (owner, 2026-10-17): map sketch, numbers, her best line, her orb or his picture.
  shareRide: async (rideId, hideEnds) => {
    const r = RideLog.load().find((x) => x.startedAt === rideId);
    if (!r) return;
    saveLog();
    const lines = LineLogStore.load()
      .filter((e) => e.rideId === rideId && /^\[P\d\]/.test(e.head) && e.text && !e.text.startsWith('('))
      .map((e) => ({ trigger: e.head.match(/^\[P\d\] (\w+)/)?.[1] ?? '', text: e.text }));
    shell.toast('Making your ride card...');
    try {
      const png = await drawRideCard(document, { ride: r, title: rideTitle(r), track: TrackStore.get(rideId), lines, avatar: await avatarStore.get().catch(() => null), hideEnds });
      const how = await shareRideCard(document, png, `betty-ride-${new Date(rideId).toISOString().slice(0, 10)}.png`);
      if (how === 'saved') shell.toast('Ride card saved to your downloads.');
    } catch (e) { shell.toast(`Could not make the ride card: ${(e as Error).message}`, true); }
  },
});
mountWhatsNew(document); // Garage > What's new, with the unread count on the card and the Garage tab

// Lock screen: covers everything so nothing can be pressed by accident; hold its button to get back.
/** Set while a ride runs: start or finish talking to Betty. */
let talkNow: (() => void) | null = null;
const lockScreen = mountLockScreen($('lockroot'), 1000, () => talkNow?.());
$('lock').addEventListener('click', () => lockScreen.lock());
document.querySelectorAll('[data-lock]').forEach((b) => b.addEventListener('click', () => { shell.closeSheet(); lockScreen.lock(); }));
let lastLine = '';
const showLocked = (speed: number) => lockScreen.setInfo(String(speed), voiceTags(lastLine, false));

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
const fuelText = () => {
  const since = rig ? rig.engine.kmSinceFill() : FuelStore.load();
  return since === null ? 'Tap Filled up to start counting' : `${Math.max(0, Math.round(CONFIG.fuel.rangeKm - since))} km left, ${Math.round(since)} since the fill`;
};
document.querySelectorAll('[data-filled]').forEach((b) => b.addEventListener('click', () => {
  rig?.engine.filledUp();
  FuelStore.save(0);
  showRange(0);
  for (const id of ['readyfuel', 'garagefuel']) { const out = document.getElementById(id); if (out) out.textContent = fuelText(); }
  setStatus(`Fill-up noted. Range reset to ${CONFIG.fuel.rangeKm} km.`);
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
// Betty's look: the default companion or his own picture/GIF, kept on the phone.
// Pull down to refresh (never while a ride or desk session runs: a reload would end it); drag a sheet down to close.
mountPullToRefresh(document, { canRefresh: () => rig === null, reload: () => { saveLog(); location.reload(); } });
mountSheetDrag(document, shell);
const avatarStore = new IdbAvatarStore();
mountAvatarSetting(document, avatarStore, (m, err) => shell.toast(m, err));
// Your data: everything in one file, to move to a new phone.
mountBackup(document, localStorage, avatarStore, {
  busy: () => rig !== null, toast: (m, err) => shell.toast(m, err),
  confirm: (m) => window.confirm(m), reload: () => setTimeout(() => location.reload(), 600),
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
    { icon: 'lock', label: 'Screen', value: nav && 'wakeLock' in nav ? 'Kept awake while riding' : 'Set Auto-Lock to Never', ok: !!nav && 'wakeLock' in nav },
  ];
};
const home = mountHomeScreen(document, shell, {
  hello: () => sayOutsideRide(HOME.hello(cleanRiderName(CONFIG.riderName))), readiness, fuelText,
  rides: () => RideLog.load(), track: (rideId) => TrackStore.get(rideId), home: () => CONFIG.feeds.fallbackLocation,
});
/** A ride is running (not just a desk chat session). */
const riding = () => !!rig && !rig.desk;
// While a ride runs, "Ride" in the navigation goes to the ride, not the start page.
shell.setRedirect((id) => (id === 'home' && riding() ? 'ride' : id));
paintBrand();
/** Set while a ride runs: what the ride screen's buttons do. */
let rideHooks: RideActions | null = null;
const rideScreen = mountRideScreen(document, {
  talk: () => rideHooks?.talk(), repeat: () => rideHooks?.repeat(), toggleQuiet: () => rideHooks?.toggleQuiet(), ask: (t) => rideHooks?.ask(t),
});
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
/** The road ridden so far (for the map, and kept with the ride afterwards). */
let rideTrack: TrackPoint[] = [];
/** Marked spots, for the map (re-read when memory changes, not every second). */
let markPins = RiderMemoryStore.load().marks;
window.addEventListener('betty-memory', () => { markPins = RiderMemoryStore.load().marks; });
/** What she is saying now, and the last line she finished (for the ride screen). */
let speakingNow: SaidLine | null = null;
let lastSaid: SaidLine | null = null;
let talkState: 'off' | 'listening' | 'thinking' = 'off';
const onFate = (item: QueueItem, fate: Fate) => {
  const said: SaidLine = { text: item.text, tag: item.tag, priority: item.priority, at: Date.now() };
  if (fate === 'speaking') speakingNow = said;
  else if (speakingNow && speakingNow.text === item.text) { speakingNow = null; if (fate === 'spoken') lastSaid = said; }
  paintRide();
};
function paintRide() {
  const r = rig;
  if (!r) return;
  const s = r.agg.current;
  const told = new Set(r.engine.toldNoteIds());
  const quietMin = r.engine.quietLeftMin();
  const snap = r.engine.rideSnapshot();
  const view = rideView({
    now: Date.now(), state: s, speaking: speakingNow, lastSaid, talk: talkState, quietMin, ending: endNow !== null,
    distanceKm: snap.distanceKm, minutesOut: snap.minutesOut, fuelKmLeft: s.obd ? null : r.engine.fuelKmLeft(), fuelWarnKm: CONFIG.fuel.warnKmLeft,
    rainChancePct: CONFIG.thresholds.rainChancePct, trafficRadiusKm: CONFIG.thresholds.trafficRadiusKm,
    untoldStories: s.areaNotes.filter((n) => !told.has(n.id)).length, showGlance: CONFIG.showGlance,
  });
  const moving = s.speedKmh >= 3 ? 'On the road' : 'Parked';
  const here = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : r.real ? null : CONFIG.feeds.fallbackLocation;
  const voiceName = libraryVoice(CONFIG.cloudVoiceName)?.name ?? CONFIG.cloudVoiceName;
  const where = [s.area?.suburb, s.area?.town].filter(Boolean).join(', ');
  rideScreen.paint(view, {
    status: moving, mode: r.real ? 'Live' : 'Desk test',
    line: [where || (r.real ? 'Free ride' : 'Desk test, simulated'), s.weather ? `${Math.round(s.weather.tempC)}°, ${s.weather.summary}` : '',
      r.real && !wakeOk ? 'screen may sleep' : '', r.real && !here ? 'waiting for GPS' : '', voiceName].filter(Boolean).join(' · '),
    quiet: quietMin > 0, listening: talkState === 'listening',
  }, {
    center: here, here, headingDeg: travelDirection(s), track: rideTrack,
    places: s.nearbyPlaces.map((p) => ({ lat: p.lat, lon: p.lon, label: p.name })),
    incidents: s.incidents.map((i) => ({ lat: i.lat, lon: i.lon, label: i.description })),
    marks: markPins,
  });
  chatScreen.setState(view.state, view.orb, talkState === 'listening');
  paintBrand();
}


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
 * Build the ride. A desk session (the Workshop chat with no ride running) is the same rig, simulated, without the
 * briefing, the screen lock or the ride screen, and is never saved as a ride.
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

  const agg = new StateAggregator();
  rideTrack = [];
  const motion = new WebMotionSource();
  const obd = new MockObdSource();
  const pos = (): LatLon => {
    const s = agg.current;
    return s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : CONFIG.feeds.fallbackLocation;
  };
  const weather = new WeatherSource(pos, (m) => { feed.weather = m; });
  const key = ENV.VITE_TOMTOM_API_KEY as string | undefined;
  const provider = key ? new TomTomTrafficProvider(key) : SERVER ? new TomTomTrafficProvider(null) : null;
  // Live traffic only on a real ride (not desk or simulated sessions), every 5 minutes, and not while parked.
  const traffic = new TrafficSource(real ? provider : null, pos, (m) => { feed.traffic = m; }, () => agg.current.speedKmh >= 5);

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
  engine.setToldNotes(ToldStore.load());
  // History and culture of the area (researched on Betty's server, so only when deployed with it).
  // Each change of what the area feed is doing goes in the saved log too ("researching Germiston", "ok, ...").
  if (SERVER) agg.addSource(new AreaSource(pos, () => new Set(engine.toldNoteIds()), (m) => { if (m !== feed.areas) { newLine('[areas]', m); renderLog(); } feed.areas = m; }));
  // Saved as the ride goes, not only at END RIDE: a phone browser can kill the tab without warning.
  const remember = () => {
    const w = agg.current.weather;
    const rec = desk ? null : toRecord(engine.rideSnapshot(), w ? `${w.summary}, ${w.tempC} C` : null);
    if (rec) RideLog.save(rec);
    FuelStore.save(engine.kmSinceFill());
    IncidentMemory.save(engine.announcedIncidents());
    TrackStore.save(engine.rideSnapshot().startedAt, rideTrack);
    ToldStore.save(engine.toldNoteIds());
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
  const paintTimer = window.setInterval(paintRide, 5000); // lets a finished line settle back to idle
  const claude = new ClaudeClient(ENV.VITE_ANTHROPIC_API_KEY || undefined, 2500, 6000, SERVER ? '/api/phrase' : undefined);
  // The cloud voice plays on the headset buttons' own track while they are Betty's (another sound source could take
  // the buttons away), otherwise on its own element. The phone voice is its backup for every line.
  const cloud = new CloudSpeaker(new WebSpeaker(speechProblem), () => (buttons.holding ? buttons : player), speechProblem, undefined, undefined, undefined, pcm, undefined, clipStore);
  // Her stock phrases in her Gemini voice, ready before they are needed (from the phone after the first ride).
  if (CONFIG.cloudVoice !== 'off' && CONFIG.cloudVoice !== 'chirp') for (const l of STOCK_LINES) cloud.prefetch(l, { priority: 4, id: 'voice' });
  const speaker = new SwitchableSpeaker(cloud);
  const queue = new AudioQueue(speaker, () => isSafeWindow(agg.current), Date.now, (item, fate) => { onFate(item, fate); renderLog(); saveLogSoon(); });

  const say = async (ev: TriggerEvent) => {
    const p = await claude.phrase(ev, agg.current);
    const tag = { priority: ev.priority, id: ev.id };
    // Her own lines (Gemini, 5 to 7 s) are queued only once their audio is in, so they never block an answer.
    if (p.text && speaker.aloud && ev.priority === 3) await cloud.ready(p.text, tag);
    // Safety stays serious: an ambient line that comes back while a critical condition is active is dropped. So is
    // one that arrives after he asked for quiet.
    const critical = AMBIENT_IDS.includes(ev.id) && engine.ambientBlocked(agg.current);
    const hushed = ev.priority === 3 && engine.quietLeftMin() > 0;
    const text = critical || hushed ? '' : p.text;
    const meta = `${p.source}${p.detail ? ': ' + p.detail : ''}, ${p.latencyMs} ms`;
    const line = newLine(`[P${ev.priority}] ${ev.id} (${meta})`, text || (critical ? '(dropped: critical alert active)' : hushed ? '(dropped: he asked for quiet)' : '(silent)'));
    if (text && speaker.aloud) cloud.prefetch(text, tag); // fetch the audio while it waits its turn
    line.item = queue.enqueue(text, ev.priority, ev.id); // the item carries its fate: waiting, speaking, spoken, or why not
    toChat({ from: 'betty', text: line.text, at: Date.now(), ev, phrase: p });
    renderLog();
    if (text) { lastLine = text; showLocked(agg.current.speedKmh); }
    return line.item;
  };

  const unsub = agg.subscribe((s) => {
    if (s.lat != null && s.lon != null) addTrackPoint(rideTrack, { lat: s.lat, lon: s.lon });
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
    // Where he is and how many area stories she has (or what the area feed is doing: researching, an error).
    const told = new Set(engine.toldNoteIds());
    const areaNames = [s.area?.town, s.area?.suburb].filter(Boolean).join(', ');
    const areaLine = s.areaNotes.length
      ? `Area: ${areaNames}, ${s.areaNotes.filter((n) => !told.has(n.id)).length} of ${s.areaNotes.length} stories untold`
      : `Area stories: ${feed.areas}`;
    $('feeds').textContent = s.weather
      ? `${s.weather.summary}, ${s.weather.tempC}°C, wind ${s.weather.windKmh} km/h | ${s.incidents.length} traffic incident(s) nearby | ${areaLine}`
      : feedStatus();
    engine.evaluate(s).forEach(say);
    queue.pump();
    paintRide();
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
  if (!desk) await wake.enable();
  await agg.start();
  setObd(CONFIG.obdMode);
  // The pre-ride briefing: wait (briefly) for the weather and a GPS fix, so she has something to tell him.
  void (async () => {
    const until = Date.now() + CONFIG.feeds.briefingWaitMs;
    const readyToBrief = () => agg.current.weather !== null && (!real || agg.current.lat != null);
    await new Promise((r) => setTimeout(r, 0)); // let the ride finish setting up first
    while (Date.now() < until && !readyToBrief()) await new Promise((r) => setTimeout(r, 250));
    if (rig?.engine === engine && !desk) say(engine.startup(agg.current)); // not if the ride ended while waiting
  })();
  /** Tones go through the headset buttons' own track when it is running, so they do not steal the buttons. */
  const tone = (freq: number) => { if (!buttons.tone(freq)) beep(freq); };
  const sayNow = (text: string) => {
    if (speaker.aloud) cloud.prefetch(text, { priority: 4, id: 'voice' });
    newLine('[P4] voice', text).item = queue.enqueue(text, 4, 'voice'); renderLog();
  };
  /** Her reply to a command: instant, from the phone, no Claude call (so it also works without signal). */
  const reply = (text: string, command: string) => { sayNow(text); toChat({ from: 'betty', text, at: Date.now(), command }); };
  const remembered = (m: ReturnType<typeof RiderMemoryStore.load>) => { RiderMemoryStore.save(m); engine.setMemory(m); window.dispatchEvent(new window.Event('betty-memory')); };
  const howLong = (min: number) => min === 60 ? 'an hour' : min === 30 ? 'half an hour' : min % 60 === 0 ? `${min / 60} hours` : `${min} minute${min === 1 ? '' : 's'}`;
  /** Voice stage 3: things he tells her to do rather than asks. */
  const obey = (c: Command) => {
    newLine('[command]', c.kind === 'preset' ? `preset ${c.preset}` : c.kind === 'mix' ? `${c.what} ${c.step > 0 ? 'up' : 'down'}` : c.kind === 'humour' || c.kind === 'persona' ? `${c.kind} ${c.set !== undefined ? `set ${c.set}` : `step ${c.step}`}` : c.kind === 'quiet' ? `quiet ${c.minutes === null ? 'until told' : `for ${c.minutes} min`}` : c.kind === 'mark' ? `mark${c.note ? `: ${c.note}` : ''}` : c.kind === 'remember' ? `remember: ${c.fact}` : c.kind);
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
      case 'humour': case 'persona': {
        const pz = CONFIG.persona;
        const field = c.kind === 'humour' ? 'humour' : 'tars';
        pz[field] = Math.min(100, Math.max(0, c.set ?? pz[field] + (c.step ?? 0)));
        saveConfig(); window.dispatchEvent(new window.Event('betty-config'));
        reply(c.kind === 'humour'
          ? pz.humour === 0 ? 'Humour at zero. Facts only.' : pz.humour === 100 ? 'Humour at a hundred percent. You asked for it.' : `Humour at ${pz.humour} percent.`
          : `${100 - pz.tars} percent JARVIS, ${pz.tars} percent TARS.`, c.kind);
        return;
      }
      case 'settings': {
        const pz = CONFIG.persona;
        const quiet = engine.quietLeftMin();
        reply(`Humour ${pz.humour} percent. ${100 - pz.tars} percent JARVIS, ${pz.tars} TARS. ${mixSummary()}`
          + (quiet === Infinity ? ' Quiet until you say otherwise.' : quiet > 0 ? ` Quiet for another ${quiet} minutes.` : ''), 'settings');
        return;
      }
      case 'preset': case 'mix': {
        // The Settings screen's "How often should I talk?" by voice, and nudges to the mix (owner, 2026-10-17).
        if (c.kind === 'preset') applyTalkPreset(c.preset); else nudgeMix(c.what, c.step);
        saveConfig(); window.dispatchEvent(new window.Event('betty-config'));
        const name = c.kind === 'preset' ? `${c.preset[0].toUpperCase()}${c.preset.slice(1)}. ` : '';
        reply(`${name}${mixSummary()}`, c.kind);
        return;
      }
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
    talkState = 'listening'; paintRide();
    tone(880);
    newLine('[voice]', 'listening'); renderLog();
    try {
      const clip = await ptt.record();
      if (clip.stalled) newLine('[voice]', 'the recorder did not stop cleanly; the mic will be reopened next time');
      buttons.resume(); // the mic stopped the loop: without it the next press never arrives
      tone(440);
      lockScreen.setTalk(true, false);
      talkState = 'thinking'; paintRide();
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
      talkState = 'off'; paintRide();
      renderLog();
    }
  };
  /** Next track: say the last line again, as it was. */
  const repeat = () => { if (lastLine) sayNow(lastLine); };
  talkNow = () => void talk();
  rideHooks = {
    talk: () => void talk(),
    repeat: () => { if (lastLine) sayNow(lastLine); else shell.toast("She hasn't said anything yet."); },
    ask: (text) => { void askBetty(text); },
    toggleQuiet: () => { obey(engine.quietLeftMin() > 0 ? { kind: 'talk' } : { kind: 'quiet', minutes: null }); renderLog(); paintRide(); },
  };
  lockScreen.setTalk(true);
  if (CONFIG.headsetButtons) {
    const ok = buttons.start({ talk: () => void talk(), repeat }, (msg) => { newLine('[voice]', msg); renderLog(); });
    newLine('[voice]', ok ? 'headset buttons: play/pause talks to Betty, next track repeats her last line' : 'headset buttons are not available in this browser');
  }

  rig = { agg, engine, queue, say, setObd, unsub, real, desk, unmountSim, buttons, releaseMic: () => ptt.release(), wake, remember, memTimer, logSensors, sensorTimer, paintTimer };
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
  endText.textContent = END_BUTTON.ending;
  shell.closeSheet();
  paintRide();
  window.clearInterval(r.memTimer);
  window.clearInterval(r.sensorTimer);
  window.clearInterval(r.paintTimer);
  r.remember();
  r.logSensors();
  r.unsub(); // no new alerts or banter from here on; the queue and speaker stay alive

  // A sign-off for any ride worth remembering.
  const debrief = !r.desk && toRecord(r.engine.rideSnapshot(), null) ? r.engine.force('ride_debrief', r.agg.current) : null;
  const item = debrief ? await r.say(debrief) : null;
  const deadline = Date.now() + SIGN_OFF_LIMIT_MS;
  while (item && !SETTLED.includes(item.fate) && !hurry && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 150));
  }

  r.queue.clear(); // anything still waiting belongs to a ride that is over (and cuts her off if the wait was skipped)
  r.setObd('off');
  r.agg.stop();
  r.unmountSim();
  r.buttons.stop();
  r.releaseMic();
  talkNow = null;
  rideHooks = null;
  speakingNow = null; lastSaid = null; talkState = 'off';
  lockScreen.setTalk(false);
  saveLog();
  if (!r.desk) await r.wake.disable();
  showWake(null);
  rig = null;
  endNow = null;
  endText.textContent = END_BUTTON.idle;
  realBox.disabled = false;
  home.setRiding(false);
  chatScreen.setRiding(false);
  workshopChat.refresh();
  paintBrand();
  // From the ride screen, straight to the story of the ride just finished (when it was long enough to remember).
  if (shell.current === 'ride' || (shell.current === 'chat' && !r.desk)) {
    const rideId = r.engine.rideSnapshot().startedAt;
    if (RideLog.load().some((x) => x.startedAt === rideId)) { journeys.renderStory(rideId); shell.show('story'); } else shell.show('home');
  }
  setStatus('');
}

// Start riding (or, while a ride runs, go back to it). End ride asks first; during the sign-off it ends at once.
startBtn.addEventListener('click', () => { if (riding()) shell.show('ride'); else if (!starting) void start(); });
endBtn.addEventListener('click', () => { if (endNow) endNow(); else if (riding()) shell.openSheet('end'); });
$('endconfirm').addEventListener('click', () => { if (endNow) endNow(); else if (rig) void stop(); });
