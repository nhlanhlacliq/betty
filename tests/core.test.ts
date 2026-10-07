import assert from 'node:assert/strict';
import { TriggerEngine, isSafeWindow } from '../src/core/TriggerEngine';
import { AudioQueue, Speaker } from '../src/core/AudioQueue';
import { StateAggregator, initialState } from '../src/core/StateAggregator';
import { bboxAround, haversineKm } from '../src/core/geo';
import { CONFIG, resetConfig } from '../src/config/betty';
import { TrafficIncident, WeatherState } from '../src/core/types';

let clock = 1_000_000;
const now = () => clock;

class FakeSpeaker implements Speaker {
  spoken: string[] = []; stopped = 0; done?: () => void;
  speak(t: string, d: () => void) { this.spoken.push(t); this.done = d; }
  stop() { this.stopped++; }
}
const wx = (over: Partial<WeatherState> = {}): WeatherState => ({
  tempC: 20, windKmh: 10, rainNowMm: 0, rainChanceNextHourPct: 0, summary: 'clear', fetchedAt: 0, ...over,
});
const inc = (over: Partial<TrafficIncident> = {}): TrafficIncident => ({
  id: 'a', description: 'an accident', severity: 3, distanceKm: 2, lat: 0, lon: 0, ...over,
});

// overtemp fires P1 once, then respects cooldown
{
  const e = new TriggerEngine(now);
  const s = { ...initialState(), engineTempC: 108 };
  const a = e.evaluate(s); assert.equal(a[0].id, 'engine_overtemp'); assert.equal(a[0].priority, 1);
  assert.equal(e.evaluate(s).length, 0, 'dedupe within cooldown');
  clock += 61_000;
  assert.equal(e.evaluate(s).length, 1, 'refires after cooldown');
}
// low fuel is P2
assert.equal(new TriggerEngine(now).evaluate({ ...initialState(), fuelPct: 10 })[0].priority, 2);

// rain: fires on chance or on rain now; not below threshold
{
  const e = new TriggerEngine(now);
  assert.equal(e.evaluate({ ...initialState(), weather: wx({ rainChanceNextHourPct: 20 }) }).length, 0);
  const r = e.evaluate({ ...initialState(), weather: wx({ rainChanceNextHourPct: 80 }) });
  assert.equal(r[0].id, 'rain_soon'); assert.equal(r[0].priority, 2);
  assert.equal(new TriggerEngine(now).evaluate({ ...initialState(), weather: wx({ rainNowMm: 0.5 }) })[0].id, 'rain_soon');
}
// traffic: radius, severity and per-incident dedupe
{
  const e = new TriggerEngine(now);
  assert.equal(e.evaluate({ ...initialState(), incidents: [inc({ distanceKm: 9 })] }).length, 0, 'outside radius');
  assert.equal(e.evaluate({ ...initialState(), incidents: [inc({ severity: 1 })] }).length, 0, 'below min severity');
  const t = e.evaluate({ ...initialState(), incidents: [inc()] });
  assert.equal(t[0].id, 'traffic_incident');
  assert.match(t[0].fallback, /accident/);
  clock += 200_000;
  assert.equal(e.evaluate({ ...initialState(), incidents: [inc()] }).length, 0, 'same incident not re-announced');
  assert.equal(e.evaluate({ ...initialState(), incidents: [inc({ id: 'b' })] }).length, 1, 'new incident announced');
}
// runtime config: priority + cooldown changes take effect immediately
{
  CONFIG.priorities.low_fuel = 1;
  assert.equal(new TriggerEngine(now).evaluate({ ...initialState(), fuelPct: 10 })[0].priority, 1);
  CONFIG.cooldownsMs.engine_overtemp = 0;
  const e = new TriggerEngine(now); const s = { ...initialState(), engineTempC: 110 };
  assert.equal(e.evaluate(s).length, 1); assert.equal(e.evaluate(s).length, 1, 'zero cooldown refires');
  resetConfig();
  assert.equal(CONFIG.priorities.low_fuel, 2); assert.equal(CONFIG.cooldownsMs.engine_overtemp, 60_000);
}
// engine.force ignores cooldown; reset clears state
{
  const e = new TriggerEngine(now); const s = { ...initialState(), engineTempC: 110 };
  e.evaluate(s);
  assert.equal(e.evaluate(s).length, 0);
  assert.equal(e.force('engine_overtemp', s).id, 'engine_overtemp');
  e.reset();
  assert.equal(e.evaluate(s).length, 1, 'reset clears cooldowns');
}
// safe window follows config
assert.equal(isSafeWindow({ ...initialState(), rpm: 3000, leanDeg: 5 }), true);
assert.equal(isSafeWindow({ ...initialState(), rpm: 6000, leanDeg: 5 }), false);
assert.equal(isSafeWindow({ ...initialState(), rpm: 3000, leanDeg: 30 }), false);
CONFIG.safeWindow.maxRpm = 7000;
assert.equal(isSafeWindow({ ...initialState(), rpm: 6000, leanDeg: 5 }), true); resetConfig();

// aggregator overrides layer over real values and clear back
{
  const agg = new StateAggregator();
  agg.push({ speedKmh: 40 });
  agg.setOverride('speedKmh', 120);
  assert.equal(agg.current.speedKmh, 120);
  agg.push({ speedKmh: 45 });
  assert.equal(agg.current.speedKmh, 120, 'override wins over live updates');
  agg.clearOverride('speedKmh');
  assert.equal(agg.current.speedKmh, 45, 'real value restored');
}
// queue: P2 waits for safe window, P1 interrupts
{
  let safe = false;
  const sp = new FakeSpeaker();
  const q = new AudioQueue(sp, () => safe, now);
  q.enqueue('fuel low', 2);
  assert.equal(sp.spoken.length, 0, 'P2 held while unsafe');
  safe = true; q.pump();
  assert.deepEqual(sp.spoken, ['fuel low']);
  q.enqueue('engine hot', 1);
  assert.equal(sp.stopped, 1, 'P1 interrupts current speech');
  assert.equal(sp.spoken.at(-1), 'engine hot');
}
// queue: stale onDone from an interrupted utterance must not release the speaker
{
  const sp = new FakeSpeaker();
  const q = new AudioQueue(sp, () => true, now);
  q.enqueue('a', 2);
  const oldDone = sp.done!;
  q.enqueue('crit', 1);
  q.enqueue('b', 2);
  oldDone();
  assert.ok(!sp.spoken.includes('b'), 'stale callback ignored; crit still speaking');
  sp.done!();
  assert.ok(sp.spoken.includes('b'), 'b speaks after crit finishes');
}
// queue: ambient expiry + cooldown + clear
{
  let safe = false;
  const sp = new FakeSpeaker();
  const q = new AudioQueue(sp, () => safe, now);
  q.enqueue('nice road', 3);
  clock += 61_000; safe = true; q.pump();
  assert.equal(sp.spoken.length, 0, 'stale ambient dropped');
  q.enqueue('again', 3); assert.equal(sp.spoken.length, 1);
  sp.done!();
  q.enqueue('too soon', 3); assert.equal(q.pending, 0, 'ambient cooldown (2 min) enforced');
  clock += 121_000;
  q.enqueue('ok now', 3); assert.equal(sp.spoken.at(-1), 'ok now');
  q.clear(); assert.equal(q.pending, 0); assert.equal(q.speakingPriority, null);
}
// geo
assert.ok(Math.abs(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111.19) < 0.5);
{
  const b = bboxAround(-26, 28, 10);
  assert.ok(b.maxLat > -26 && b.minLat < -26 && b.maxLon > 28 && b.minLon < 28);
}
console.log('all core tests passed');
