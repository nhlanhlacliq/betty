import { CONFIG } from '../config/betty';
import { AudioQueue } from '../core/AudioQueue';
import { StateAggregator } from '../core/StateAggregator';
import { TriggerEngine, isSafeWindow } from '../core/TriggerEngine';
import { BikeState, TRIGGER_IDS, TrafficIncident, TriggerEvent, WeatherState } from '../core/types';
import { button, checkbox, el } from './dom';

export interface SimContext {
  agg: StateAggregator;
  engine: TriggerEngine;
  queue: AudioQueue;
  say(ev: TriggerEvent): void;
  setAloud(on: boolean): void;
  aloud: boolean;
  zeroLean(): void;
  refreshFeeds(): void;
  resetRide(): void;
  feedStatus(): string;
  /** Where the last line came from: claude or fallback, with the reason and latency. */
  lastPhrase(): string;
}

/** Desk locations for developing the tour-guide flavour. Overrides lat/lon and refetches the feeds. */
export const LOCATION_PRESETS: Array<[string, number, number]> = [
  ['Edenvale', -26.14, 28.15],
  ['Johannesburg CBD', -26.2041, 28.0473],
  ['Soweto', -26.2678, 27.8585],
  ['Sandton', -26.1076, 28.0567],
  ['Pretoria', -25.7479, 28.2293],
  ['Cape Town', -33.9249, 18.4241],
];

type NumKey = 'speedKmh' | 'leanDeg' | 'rpm' | 'engineTempC' | 'throttlePct' | 'fuelPct';
const SENSORS: Array<[NumKey, string, number, number, number, string]> = [
  ['speedKmh', 'GPS speed', 0, 180, 1, 'km/h'],
  ['leanDeg', 'Lean angle', -60, 60, 1, '°'],
  ['rpm', 'RPM (OBD2)', 0, 10000, 100, ''],
  ['engineTempC', 'Engine temp (OBD2)', 50, 130, 1, '°C'],
  ['throttlePct', 'Throttle (OBD2)', 0, 100, 1, '%'],
  ['fuelPct', 'Fuel (OBD2)', 0, 100, 1, '%'],
];

function rangeRow(label: string, min: number, max: number, step: number, unit: string, init: number, onInput: (v: number) => void) {
  const row = el('div', 'row');
  const name = el('span', 'name', label);
  const range = el('input'); range.type = 'range';
  range.min = String(min); range.max = String(max); range.step = String(step); range.value = String(init);
  const val = el('span', 'val');
  const show = () => { val.textContent = `${range.value}${unit}`; };
  range.oninput = () => { show(); onInput(Number(range.value)); };
  show();
  row.append(name, range, val);
  return { row, name, range, val, show };
}

export function mountSimPanel(root: HTMLElement, ctx: SimContext): () => void {
  root.innerHTML = '';
  const wrap = el('details', 'panel');
  wrap.open = true;
  wrap.append(el('summary', '', 'SIMULATOR'));
  const refreshers: Array<(s: BikeState) => void> = [];
  const info = el('div', 'info');
  wrap.append(info);

  // --- sensors: tick "manual" to override the live value with the slider
  wrap.append(el('h3', '', 'Sensors (tick to override the live value)'));
  for (const [key, label, min, max, step, unit] of SENSORS) {
    const r = rangeRow(label, min, max, step, unit, 0, (v) => { if (cb.checked) ctx.agg.setOverride(key, v); });
    const { wrap: cbWrap, cb } = checkbox('', false, (on) => {
      r.range.disabled = !on;
      if (on) ctx.agg.setOverride(key, Number(r.range.value)); else ctx.agg.clearOverride(key);
    });
    r.range.disabled = true;
    r.row.prepend(cbWrap);
    wrap.append(r.row);
    refreshers.push((s) => { if (!cb.checked) { r.range.value = String(s[key]); r.show(); } });
  }

  // --- weather
  wrap.append(el('h3', '', 'Weather'));
  const wx = { rainChance: 70, rainNow: 0, temp: 22, wind: 15 };
  const applyWx = () => {
    const w: WeatherState = {
      tempC: wx.temp, windKmh: wx.wind, rainNowMm: wx.rainNow, rainChanceNextHourPct: wx.rainChance,
      summary: 'simulated', fetchedAt: Date.now(),
    };
    ctx.agg.setOverride('weather', w);
  };
  const wxRows = [
    rangeRow('Rain chance next hr', 0, 100, 5, '%', wx.rainChance, (v) => { wx.rainChance = v; if (wxCb.checked) applyWx(); }),
    rangeRow('Rain now', 0, 5, 0.1, ' mm', wx.rainNow, (v) => { wx.rainNow = v; if (wxCb.checked) applyWx(); }),
    rangeRow('Air temp', -5, 45, 1, '°C', wx.temp, (v) => { wx.temp = v; if (wxCb.checked) applyWx(); }),
    rangeRow('Wind', 0, 100, 1, ' km/h', wx.wind, (v) => { wx.wind = v; if (wxCb.checked) applyWx(); }),
  ];
  const { wrap: wxCbWrap, cb: wxCb } = checkbox('Override live weather with these', false, (on) => {
    wxRows.forEach((r) => (r.range.disabled = !on));
    if (on) applyWx(); else ctx.agg.clearOverride('weather');
  });
  wxRows.forEach((r) => (r.range.disabled = true));
  wrap.append(wxCbWrap, ...wxRows.map((r) => r.row));

  // --- location
  wrap.append(el('h3', '', 'Location (for weather, traffic and nearby places)'));
  const locRow = el('div', 'row');
  const loc = el('select');
  const live = el('option', '', 'Live GPS / fallback'); live.value = '';
  loc.append(live);
  LOCATION_PRESETS.forEach(([name], i) => { const o = el('option', '', name); o.value = String(i); loc.append(o); });
  loc.onchange = () => {
    const preset = loc.value === '' ? null : LOCATION_PRESETS[Number(loc.value)];
    if (preset) { ctx.agg.setOverride('lat', preset[1]); ctx.agg.setOverride('lon', preset[2]); }
    else { ctx.agg.clearOverride('lat'); ctx.agg.clearOverride('lon'); }
    ctx.refreshFeeds();
  };
  const placesInfo = el('div', 'info places');
  locRow.append(el('span', 'name', 'Simulate being in'), loc);
  wrap.append(locRow, placesInfo);
  refreshers.push((s) => {
    placesInfo.textContent = s.nearbyPlaces.length
      ? `Nearby (Wikipedia): ${s.nearbyPlaces.map((p) => `${p.name} ${p.distanceKm} km`).join(', ')}`
      : 'Nearby (Wikipedia): none loaded';
  });

  // --- traffic incidents + faults
  wrap.append(el('h3', '', 'Traffic, faults, actions'));
  const bar = el('div', 'bar');
  let incSeq = 0;
  const addIncident = (distanceKm: number, severity: number, description: string, roadName: string) => {
    const list: TrafficIncident[] = [...(ctx.agg.getOverride('incidents') ?? [])];
    list.push({ id: `sim-${++incSeq}`, description, roadName, severity, distanceKm, lat: 0, lon: 0 });
    ctx.agg.setOverride('incidents', list);
  };
  bar.append(
    button('Accident 2 km', () => addIncident(2, 3, 'an accident', 'the N3')),
    button('Road closure 1 km', () => addIncident(1, 4, 'a road closure', 'Modderfontein Rd')),
    button('Minor slowdown 8 km', () => addIncident(8, 1, 'a slowdown', 'the R24')),
    button('Clear incidents', () => ctx.agg.clearOverride('incidents')),
  );
  const dtcBtn = button('Inject fault P0171', () => {
    if (ctx.agg.hasOverride('dtcs')) { ctx.agg.clearOverride('dtcs'); dtcBtn.textContent = 'Inject fault P0171'; }
    else { ctx.agg.setOverride('dtcs', ['P0171']); dtcBtn.textContent = 'Clear fault'; }
  });
  bar.append(
    dtcBtn,
    button('Zero lean', () => ctx.zeroLean()),
    button('Refresh feeds', () => ctx.refreshFeeds()),
    button('Reset ride', () => ctx.resetRide()),
  );
  wrap.append(bar);
  wrap.append(checkbox('Speak aloud (off = silent, simulated duration)', ctx.aloud, (on) => ctx.setAloud(on)).wrap);

  // --- fire triggers
  wrap.append(el('h3', '', 'Fire a trigger now (ignores cooldown, uses current priority)'));
  const fire = el('div', 'bar');
  for (const id of TRIGGER_IDS) {
    const b = button('', () => ctx.say(ctx.engine.force(id, ctx.agg.current)));
    refreshers.push(() => { b.textContent = `${id} · P${CONFIG.priorities[id]}`; });
    fire.append(b);
  }
  wrap.append(fire);
  root.append(wrap);

  const updateInfo = () => {
    const s = ctx.agg.current;
    const q = ctx.queue;
    info.textContent =
      `Safe window: ${isSafeWindow(s) ? 'YES' : 'NO'} | Speaking: ${q.speakingPriority === null ? 'idle' : 'P' + q.speakingPriority}`
      + ` | Queued: ${q.pending} | Last line: ${ctx.lastPhrase()} | ${ctx.feedStatus()}`;
  };
  const unsub = ctx.agg.subscribe((s) => { refreshers.forEach((f) => f(s)); updateInfo(); });
  const timer = setInterval(updateInfo, 500);
  refreshers.forEach((f) => f(ctx.agg.current));
  updateInfo();

  return () => { unsub(); clearInterval(timer); root.innerHTML = ''; };
}
