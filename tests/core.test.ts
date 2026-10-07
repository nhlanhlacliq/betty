import assert from 'node:assert/strict';
import { TriggerEngine, isSafeWindow } from '../src/core/TriggerEngine';
import { AudioQueue, Speaker } from '../src/core/AudioQueue';
import { StateAggregator, initialState } from '../src/core/StateAggregator';
import { bboxAround, haversineKm } from '../src/core/geo';
import { CONFIG, resetConfig } from '../src/config/betty';
import { BikeState, NearbyPlace, TrafficIncident, TriggerEvent, WeatherState } from '../src/core/types';
import { ClaudeClient, buildClaudeRequest, extractText } from '../src/core/ClaudeClient';
import { BANTER_MODES, banterContext, banterTopics, chooseAmbient, freshPlace, pickMode, pickTopic } from '../src/core/ambient';
import { RideStats } from '../src/core/RideStats';
import { RideRecord, describeRide, describeTotals, toRecord, upsertRide } from '../src/core/RideMemory';
import { parseWikiPlaces } from '../src/adapters/PlaceSource';

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
  const e = new TriggerEngine(now, () => 0.99); // rng pinned to "silence" so no ambient slot fires in this test
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
// ClaudeClient: text is taken from the first text block, not blindly from content[0]
{
  assert.equal(extractText({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: ' Hello. ' }] }), 'Hello.');
  assert.equal(extractText({ content: [{ type: 'thinking', thinking: 'x' }] }), null);
  assert.equal(extractText({ content: [{ type: 'text', text: '  ' }] }), null);
  assert.equal(extractText({ type: 'error' }), null);
}

// ---- ambient personality
const place = (over: Partial<NearbyPlace> = {}): NearbyPlace => ({
  id: 'p1', name: 'Testville', distanceKm: 1, summary: 'Testville was founded as a railway siding.', ...over,
});
const SLOT = () => CONFIG.ambientCooldownMs + 5001;
const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

// chooser: weights respected, silence respected, zero weights = silent
{
  const w = { banterWeight: 50, tourGuideWeight: 30, silenceWeight: 20 };
  const rng = seeded(42);
  const n = { ambient_banter: 0, local_fact: 0, none: 0 };
  for (let i = 0; i < 10_000; i++) n[chooseAmbient(w, true, rng) ?? 'none']++;
  assert.ok(Math.abs(n.ambient_banter / 10_000 - 0.5) < 0.03, 'banter share');
  assert.ok(Math.abs(n.local_fact / 10_000 - 0.3) < 0.03, 'tour guide share');
  assert.ok(Math.abs(n.none / 10_000 - 0.2) < 0.03, 'silence share');
  assert.equal(chooseAmbient(w, false, () => 0.6), null, 'tour-guide roll with no fresh place is silence, not banter');
  assert.equal(chooseAmbient({ banterWeight: 0, tourGuideWeight: 0, silenceWeight: 0 }, true, () => 0), null);
  assert.equal(chooseAmbient({ banterWeight: 0, tourGuideWeight: 0, silenceWeight: 10 }, true, () => 0), null);
}
// freshPlace: nearest unmentioned within radius
{
  const ps = [place({ id: 'far', distanceKm: 9 }), place({ id: 'b', distanceKm: 2 }), place({ id: 'a', distanceKm: 1 })];
  assert.equal(freshPlace(ps, new Set(), 4)?.id, 'a');
  assert.equal(freshPlace(ps, new Set(['a']), 4)?.id, 'b');
  assert.equal(freshPlace(ps, new Set(['a', 'b']), 4), null, 'out-of-radius place is not used');
}
// engine: one ambient slot per cooldown, nothing right at ride start, banter never runs dry
{
  const e = new TriggerEngine(now, () => 0); // rng 0 = banter
  const s = { ...initialState(), speedKmh: 60, weather: wx() };
  assert.equal(e.evaluate(s).length, 0, 'no ambient at ride start');
  clock += SLOT();
  const a = e.evaluate(s);
  assert.equal(a[0].id, 'ambient_banter'); assert.equal(a[0].priority, 3);
  assert.equal(a[0].fallback, '', 'no canned banter');
  assert.match(a[0].context, /Topic for this remark:/); assert.match(a[0].context, /Background/);
  assert.equal(e.evaluate(s).length, 0, 'slot used');
  clock += SLOT();
  assert.equal(e.evaluate({ ...s, rpm: 8000 }).length, 0, 'waits for the safe window');
  const topicOf = (ev: TriggerEvent) => ev.context.split('\n')[0];
  const modeOf = (ev: TriggerEvent) => ev.context.split('\n')[1];
  const seen = [a[0]];
  seen.push(e.evaluate(s)[0]);
  for (let i = 0; i < 20; i++) { clock += SLOT(); const r = e.evaluate(s); assert.equal(r.length, 1, 'banter never runs out'); seen.push(r[0]); }
  for (let i = 1; i < seen.length; i++) {
    assert.notEqual(topicOf(seen[i]), topicOf(seen[i - 1]), 'never the same topic twice in a row');
    assert.notEqual(modeOf(seen[i]), modeOf(seen[i - 1]), 'never the same delivery twice in a row');
  }
  assert.ok(new Set(seen.slice(0, 5).map((x) => topicOf(x).replace(/\d+/g, ''))).size >= 4, 'early remarks spread over different topics');
}
// engine: tour guide is grounded and never repeats a place
{
  const e = new TriggerEngine(now, () => 0.5); // rng 0.5 = tour guide with default weights
  const s = { ...initialState(), nearbyPlaces: [place()] };
  clock += SLOT();
  const a = e.evaluate(s);
  assert.equal(a[0].id, 'local_fact');
  assert.match(a[0].context, /Testville was founded as a railway siding/);
  clock += SLOT();
  assert.equal(e.evaluate(s).length, 0, 'same place is not mentioned twice');
  clock += SLOT();
  assert.equal(e.evaluate({ ...s, nearbyPlaces: [place(), place({ id: 'p2', name: 'Otherton', summary: 'Otherton has a dam.' })] })[0].id, 'local_fact');
  assert.equal(e.force('local_fact', s).context, '', 'forced with nothing fresh has nothing to go on');
  e.reset(); clock += SLOT();
  assert.equal(e.evaluate(s).length, 1, 'reset clears mentioned places');
}
// engine: zero weights = ambient silent; critical condition blocks ambient
{
  CONFIG.ambient.banterWeight = 0; CONFIG.ambient.tourGuideWeight = 0;
  const quiet = new TriggerEngine(now, () => 0);
  clock += SLOT();
  assert.equal(quiet.evaluate({ ...initialState(), nearbyPlaces: [place()] }).length, 0, 'zero weights are silent');
  resetConfig();

  const e = new TriggerEngine(now, () => 0);
  const hot = { ...initialState(), engineTempC: 110 };
  e.evaluate(hot); // overtemp fires, now in cooldown
  CONFIG.cooldownsMs.engine_overtemp = 3_600_000;
  clock += SLOT();
  assert.equal(e.ambientBlocked(hot), true);
  assert.equal(e.evaluate(hot).length, 0, 'no banter while overtemp is active');
  assert.equal(e.evaluate(initialState()).length, 1, 'banter resumes once it clears');
  assert.equal(e.ambientBlocked({ ...initialState(), fuelPct: 10 }), false, 'P2 low fuel does not block');
  CONFIG.priorities.low_fuel = 1;
  assert.equal(e.ambientBlocked({ ...initialState(), fuelPct: 10 }), true, 'follows configured priority');
  resetConfig();
}
// ride stats: distance, corners, stops, alerts; a quiet tab does not invent riding time
const ride0 = () => new RideStats(now).snapshot();
{
  const st = new RideStats(now);
  const tick = (over: Partial<BikeState>, ms: number) => { clock += ms; st.update({ ...initialState(), rpm: 3000, fuelPct: 80, ...over }); };
  tick({ speedKmh: 60 }, 0);
  for (let i = 0; i < 60; i++) tick({ speedKmh: 60, leanDeg: i < 15 ? 25 : 2 }, 5000); // 5 min at 60 km/h
  tick({ speedKmh: 0, engineTempC: 96 }, 5000);
  tick({ speedKmh: 0 }, 5000);
  st.noteEvent('low fuel'); st.notePlace('Edenvale'); st.notePlace('Edenvale');
  const sn = st.snapshot();
  assert.ok(Math.abs(sn.distanceKm - 5) < 0.2, `about 5 km, got ${sn.distanceKm}`);
  assert.equal(sn.stops, 1); assert.equal(sn.maxLeanDeg, 25); assert.equal(sn.corneringPct, 25);
  assert.equal(sn.maxEngineTempC, 96); assert.equal(sn.fuelStartPct, 80);
  assert.deepEqual(sn.places, ['Edenvale']); assert.equal(sn.events[0].what, 'low fuel');
  tick({ speedKmh: 100 }, 600_000); // tab was asleep for 10 minutes
  assert.ok(st.snapshot().distanceKm - sn.distanceKm < 0.5, 'a long gap is capped');
}
// ride memory: desk tests are not remembered, records upsert and are capped, descriptions read plainly
{
  assert.equal(toRecord({ ...ride0(), minutesOut: 1, distanceKm: 0 }, null), null, 'too short to remember');
  const rec = toRecord({ ...ride0(), startedAt: 1000, minutesOut: 42.4, distanceKm: 31.5, places: ['Soweto'],
    events: [{ what: 'low fuel', atMin: 5 }, { what: 'low fuel', atMin: 20 }] }, 'clear, 22 C')!;
  assert.deepEqual(rec, { startedAt: 1000, minutes: 42, distanceKm: 31.5, weather: 'clear, 22 C', places: ['Soweto'], events: ['low fuel'] });
  let h: RideRecord[] = upsertRide([], rec);
  h = upsertRide(h, { ...rec, minutes: 50 });
  assert.equal(h.length, 1, 'same ride is updated, not duplicated'); assert.equal(h[0].minutes, 50);
  for (let i = 0; i < 40; i++) h = upsertRide(h, { ...rec, startedAt: 2000 + i });
  assert.equal(h.length, 30); assert.equal(h.at(-1)!.startedAt, 2039);
  const d = describeRide(rec, 1000 + 3 * 86_400_000);
  assert.match(d, /3 days ago: 42 minutes, 31.5 km/); assert.match(d, /Soweto/); assert.match(d, /low fuel/);
  assert.match(describeRide(rec, 1000 + 86_400_000), /yesterday/);
  assert.match(describeTotals([rec, { ...rec, startedAt: 5 }]), /2 ride\(s\).*63 km/);
}
// banter topics: wide pool, grows with the ride and with memory, no current speed or rpm
{
  const at = new Date(2026, 0, 1, 7);
  const ids = (i: Parameters<typeof banterTopics>[0]) => banterTopics(i).map((t) => t.id);
  const base = { history: [] as RideRecord[], at, placeRadiusKm: 4 };
  assert.deepEqual(ids({ ...base, s: initialState(), ride: ride0() }), ['time', 'open'], 'bare minimum always has something');
  const rec: RideRecord = { startedAt: at.getTime() - 2 * 86_400_000, minutes: 40, distanceKm: 30, weather: 'rain, 14 C', places: ['Soweto'], events: ['rain'] };
  const full = {
    ...base, history: [rec, rec],
    s: { ...initialState(), speedKmh: 0, rpm: 8123, fuelPct: 55, engineTempC: 91, weather: wx(), incidents: [inc()],
      nearbyPlaces: [place({ distanceKm: 9, id: 'far', name: 'Faraway' }), place()] },
    ride: { ...ride0(), minutesOut: 50, movingMin: 40, distanceKm: 37, stops: 2, maxLeanDeg: 28, corneringPct: 30, maxEngineTempC: 97,
      fuelStartPct: 80, events: [{ what: 'rain', atMin: 12 }], places: ['Edenvale'] },
  };
  assert.deepEqual(ids(full), ['time', 'weather', 'duration', 'distance', 'fuel', 'engine', 'corners', 'stops', 'standing',
    'traffic', 'location', 'earlier', 'places', 'last_ride', 'totals', 'open']);
  const text = banterTopics(full).map((t) => t.text).join(' ');
  assert.match(text, /near Testville/); assert.ok(!/Faraway/.test(text), 'location respects the radius');
  assert.match(text, /down 25 since setting off/); assert.match(text, /rain at 12 minutes/); assert.match(text, /2 days ago: 40 minutes/);
  assert.ok(!/8123/.test(text), 'no rpm in banter');
  assert.ok(!/137/.test(banterTopics({ ...full, s: { ...full.s, speedKmh: 137 } }).map((t) => t.text).join(' ')), 'no current speed in banter');

  // picking: fresh first, then least recently used; a changed fact makes a topic fresh again
  const ts = banterTopics(full);
  const used = new Map(ts.map((t, i) => [t.id, { bucket: t.bucket, seq: i + 1 }]));
  assert.equal(pickTopic(ts, used, () => 0.9)!.id, 'time', 'all used: oldest comes round');
  used.set('fuel', { bucket: 'different', seq: 99 });
  assert.equal(pickTopic(ts, used, () => 0.9)!.id, 'fuel', 'changed fact is fresh');
  assert.equal(pickTopic(ts, new Map(), () => 0)!.id, 'time'); assert.equal(pickTopic([], new Map()), null);
  for (const m of BANTER_MODES) for (const r of [0, 0.5, 0.99]) assert.notEqual(pickMode(m.id, () => r).id, m.id);
  const ctx = banterContext(ts[4], BANTER_MODES[3], ts);
  assert.match(ctx.split('\n')[0], /Fuel is at 55/); assert.match(ctx, /question/);
  assert.ok(!ctx.split('\n')[2].includes('Fuel is at 55'), 'topic is not repeated in the background');
  assert.match(ctx.split('\n')[2], /Weather: clear/);
}
// engine remembers alerts and places for later banter, and takes past rides
{
  const e = new TriggerEngine(now, () => 0);
  const s = { ...initialState(), speedKmh: 50, fuelPct: 10, nearbyPlaces: [place()] };
  e.evaluate(s); e.force('local_fact', s);
  const sn = e.rideSnapshot();
  assert.equal(sn.events[0].what, 'low fuel'); assert.deepEqual(sn.places, ['Testville']);
  e.setHistory([{ startedAt: 1, minutes: 30, distanceKm: 20, weather: null, places: [], events: [] }]);
  const all = Array.from({ length: 12 }, () => e.force('ambient_banter', s).context).join('\n');
  assert.match(all, /Topic for this remark: Your memory of his last ride/);
  assert.match(all, /Topic for this remark: Earlier this ride you flagged: low fuel/);
  e.reset();
  assert.equal(e.rideSnapshot().events.length, 0, 'reset starts a new ride');
}
// prompt builder: only the supplied place notes, flavour instructions attached
{
  const e = new TriggerEngine(now);
  const s: BikeState = { ...initialState(), nearbyPlaces: [place(), place({ id: 'p2', name: 'Otherton', distanceKm: 2, summary: 'Otherton has a dam.' })] };
  const req = buildClaudeRequest(e.force('local_fact', s), s, ['earlier line']);
  const user = req.messages[0].content;
  assert.match(user, /railway siding/); assert.ok(!/Otherton/.test(user), 'only the chosen place is supplied');
  assert.match(user, /earlier line/); assert.ok(!/Bike state/.test(user), 'no telemetry for ambient flavours');
  assert.match(buildClaudeRequest(e.force('low_fuel', s), s, []).messages[0].content, /Bike state/);
  assert.match(req.system, /ONLY source/);
  assert.deepEqual(req.thinking, { type: CONFIG.claudeThinkingOff });
  assert.ok(!/ONLY source|quip/.test(buildClaudeRequest(e.force('low_fuel', s), s, []).system), 'alerts get no flavour prompt');
}
// queue: an empty line is never spoken
{
  const sp = new FakeSpeaker();
  const q = new AudioQueue(sp, () => true, now);
  q.enqueue('', 3); q.enqueue('   ', 2);
  assert.equal(sp.spoken.length, 0); assert.equal(q.pending, 0);
}
// ClaudeClient: source reporting, silence, fallback reasons
{
  const realFetch = globalThis.fetch;
  const reply = (status: number, body: unknown) => { globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch; };
  const ev = (over: Partial<TriggerEvent> = {}): TriggerEvent => ({ id: 'low_fuel', priority: 2, context: 'Fuel is at 10 percent.', fallback: 'Fuel is low.', createdAt: 0, ...over });
  const s = initialState();
  const banter = ev({ id: 'ambient_banter', priority: 3, context: 'Ride context: x', fallback: '' });
  try {
    reply(200, { content: [{ type: 'text', text: 'Tank is nearly empty.' }] });
    const c = new ClaudeClient('key');
    let p = await c.phrase(ev(), s);
    assert.equal(p.source, 'claude'); assert.equal(p.text, 'Tank is nearly empty.'); assert.equal(c.last, p);

    reply(200, { content: [{ type: 'text', text: 'SILENT.' }] });
    p = await c.phrase(banter, s);
    assert.equal(p.text, '', 'SILENT reply means say nothing'); assert.equal(p.source, 'claude'); assert.match(p.detail, /silence/);

    reply(400, { type: 'error' });
    p = await c.phrase(ev(), s);
    assert.equal(p.source, 'fallback'); assert.equal(p.text, 'Fuel is low.'); assert.equal(p.detail, 'HTTP 400');
    p = await c.phrase(banter, s);
    assert.equal(p.text, '', 'ambient has no canned fallback'); assert.match(p.detail, /HTTP 400, staying silent/);

    let called = 0;
    globalThis.fetch = (async () => { called++; return new Response('{}'); }) as typeof fetch;
    p = await c.phrase(ev({ id: 'engine_overtemp', priority: 1 }), s);
    assert.equal(called, 0, 'P1 never calls the network'); assert.equal(p.source, 'fallback');
    p = await new ClaudeClient(undefined).phrase(ev(), s);
    assert.equal(p.detail, 'no API key'); assert.equal(called, 0);
  } finally { globalThis.fetch = realFetch; }
}
// Wikipedia parser: distance computed, thin stubs and pages without coordinates dropped, nearest first
{
  const long = 'Edenvale is a town on the East Rand in Gauteng. It is part of the Ekurhuleni Metropolitan Municipality.';
  const ps = parseWikiPlaces({ query: { pages: [
    { pageid: 2, title: 'Far Place', extract: long, coordinates: [{ lat: -26.17, lon: 28.15 }] },
    { pageid: 1, title: 'Edenvale, South Africa', extract: long, coordinates: [{ lat: -26.141, lon: 28.152 }] },
    { pageid: 3, title: 'Stub', extract: 'Too short.', coordinates: [{ lat: -26.14, lon: 28.15 }] },
    { pageid: 4, title: 'No coords', extract: long },
    { pageid: 5, title: 'List of ambassadors', extract: long, coordinates: [{ lat: -26.14, lon: 28.15 }] },
  ] } }, { lat: -26.14, lon: 28.15 });
  assert.deepEqual(ps.map((p) => p.id), ['wiki-1', 'wiki-2']);
  assert.equal(ps[0].name, 'Edenvale'); assert.ok(ps[0].distanceKm < 1 && ps[1].distanceKm > 3);
  assert.deepEqual(parseWikiPlaces({}, { lat: 0, lon: 0 }), []);
}
console.log('all core tests passed');
