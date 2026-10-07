import { loadConfig } from './config/persist';
import { CONFIG } from './config/betty';
import { StateAggregator } from './core/StateAggregator';
import { TriggerEngine, isSafeWindow } from './core/TriggerEngine';
import { AudioQueue } from './core/AudioQueue';
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
import { TomTomTrafficProvider } from './adapters/TomTomTraffic';
import { WakeLock } from './adapters/WakeLock';
import { mountSimPanel } from './ui/SimPanel';
import { mountTuningPanel } from './ui/TuningPanel';

loadConfig();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = $<HTMLButtonElement>('toggle');
const realBox = $<HTMLInputElement>('real');
const statusEl = $('status');
const logEl = $('log');
const setStatus = (msg: string, err = false) => { statusEl.textContent = msg; statusEl.className = err ? 'err' : ''; };

const feed = { weather: 'idle', traffic: 'idle', places: 'idle' };
const feedStatus = () => `Weather: ${feed.weather} | Traffic: ${feed.traffic} | Places: ${feed.places}`;

interface Rig {
  agg: StateAggregator; unsub: () => void; unmountSim: () => void; wake: WakeLock;
}
let rig: Rig | null = null;
const lines: string[] = [];

mountTuningPanel($('tuning'));

async function start() {
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
  const key = import.meta.env.VITE_TOMTOM_API_KEY as string | undefined;
  const traffic = new TrafficSource(key ? new TomTomTrafficProvider(key) : null, pos, (m) => { feed.traffic = m; });

  const places = new PlaceSource(pos, (m) => { feed.places = m; });

  if (real) {
    agg.addSource(new WebGeoSource((m) => setStatus(m, true)));
    if (motionOk) agg.addSource(motion); else setStatus('Motion sensors unavailable: lean stays 0.', true);
  }
  agg.addSource(obd);
  agg.addSource(weather);
  agg.addSource(traffic);
  agg.addSource(places);

  const engine = new TriggerEngine();
  const claude = new ClaudeClient(import.meta.env.VITE_ANTHROPIC_API_KEY || undefined);
  const speaker = new SwitchableSpeaker(new WebSpeaker());
  const queue = new AudioQueue(speaker, () => isSafeWindow(agg.current));

  const say = async (ev: TriggerEvent) => {
    const p = await claude.phrase(ev, agg.current);
    // Safety stays serious: an ambient line that comes back while a critical condition is active is dropped.
    const dropped = AMBIENT_IDS.includes(ev.id) && engine.ambientBlocked(agg.current);
    const text = dropped ? '' : p.text;
    const meta = `${p.source}${p.detail ? ': ' + p.detail : ''}, ${p.latencyMs} ms`;
    lines.unshift(`[P${ev.priority}] ${ev.id} (${meta}): ${text || (dropped ? '(dropped: critical alert active)' : '(silent)')}`);
    logEl.innerHTML = lines.slice(0, 10).map((l) => `<div>${l.replace(/</g, '&lt;')}</div>`).join('');
    queue.enqueue(text, ev.priority);
  };

  const unsub = agg.subscribe((s) => {
    $('speed').textContent = String(s.speedKmh);
    $('lean').textContent = s.leanDeg.toFixed(0);
    $('rpm').textContent = String(s.rpm);
    $('temp').textContent = String(s.engineTempC);
    $('fuel').textContent = String(Math.round(s.fuelPct));
    $('rain').textContent = s.weather ? String(s.weather.rainChanceNextHourPct) : '-';
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
    zeroLean: () => motion.zero(),
    refreshFeeds: () => { weather.refresh(); traffic.refresh(); places.refresh(); },
    resetRide: () => { engine.reset(); obd.reset(); queue.clear(); lines.length = 0; logEl.innerHTML = ''; },
    feedStatus,
    lastPhrase: () => {
      const p = claude.last;
      return p ? `${p.source}${p.detail ? ' (' + p.detail + ')' : ''}, ${p.latencyMs} ms` : 'none yet';
    },
  });

  const wake = new WakeLock();
  await wake.enable();
  await agg.start();
  say(engine.startup());
  rig = { agg, unsub, unmountSim, wake };
  toggle.textContent = 'END RIDE';
  toggle.classList.add('stop');
  realBox.disabled = true;
  if (!statusEl.textContent) setStatus(real ? 'Keep this screen open while riding.' : 'Simulated session: no phone sensors in use.');
}

async function stop() {
  rig?.unsub();
  rig?.agg.stop();
  rig?.unmountSim();
  await rig?.wake.disable();
  window.speechSynthesis?.cancel();
  rig = null;
  toggle.textContent = 'START RIDE';
  toggle.classList.remove('stop');
  realBox.disabled = false;
  setStatus('');
}

toggle.addEventListener('click', () => { rig ? stop() : start(); });
