/**
 * The shared ride (src/app/RideSession) in plain Node: no window, document or localStorage, as in the native app.
 * Storage is an in-memory store through src/adapters/kv, the network is switched off, her voice finishes at once.
 *
 *   npx tsx tests/session.test.ts
 */
import assert from 'node:assert/strict';
import { useStore } from '../src/adapters/kv';
import { CONFIG } from '../src/config/betty';
import { ClaudeClient } from '../src/core/ClaudeClient';
import type { SpeakTag, Speaker } from '../src/core/AudioQueue';
import type { BikeState, DataSource } from '../src/core/types';
import { LineLogger } from '../src/app/LineLogger';
import { ChatEntry, RideSession } from '../src/app/RideSession';
import { RiderMemoryStore } from '../src/adapters/RiderMemoryStore';
import { backupOf, collect, describeBackup, parseBackup, restoreStorage } from '../src/app/backup';

assert.equal(typeof (globalThis as any).window, 'undefined', 'runs without a browser');
assert.equal(typeof (globalThis as any).localStorage, 'undefined');

const data = new Map<string, string>();
useStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } });
(globalThis as any).fetch = async () => { throw new Error('offline (test)'); };
CONFIG.feeds.briefingWaitMs = 200;

const spoken: string[] = [];
const speaker: Speaker = {
  speak(text: string, onDone: () => void, tag?: SpeakTag) { spoken.push(text); tag?.heard?.(); setTimeout(onDone, 5); },
  stop() {},
};
/** A GPS that has him standing at Edenvale. */
const gps: DataSource = { start(push) { push({ lat: -26.14, lon: 28.15, speedKmh: 0 } as Partial<BikeState>); }, stop() {} };

const chat: ChatEntry[] = [];
let ended = 0, changes = 0;
const logger = new LineLogger();
const ride = new RideSession({
  real: true, desk: false, server: false, logger,
  claude: new ClaudeClient(undefined, 500, 500), // no key: canned lines
  voice: { speaker, aloud: () => true },
  sensors: [gps], traffic: null,
  events: { chat: (e) => chat.push(e), endRequested: () => { ended++; }, changed: () => { changes++; } },
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

void (async () => {
  await ride.start();
  // Warnings that come up before the briefing wait for it (CONFIG.briefingFirst); one it covers is not said again.
  const warn = (id: 'fuel_range' | 'traffic_incident', fallback: string) => void ride.say({ id, priority: 2, createdAt: Date.now(), context: '', fallback });
  warn('fuel_range', 'Fuel is getting low.');
  warn('traffic_incident', 'Closure ahead.');
  await wait(600); // the briefing (canned without a key)
  assert.ok(spoken.some((t) => /online/i.test(t)), `the briefing is spoken: ${spoken.join(' | ')}`);
  assert.ok(/online/i.test(spoken[0]), `the briefing goes first: ${spoken.join(' | ')}`);
  assert.ok(spoken.includes('Closure ahead.') && !spoken.includes('Fuel is getting low.'), `fuel left to the briefing, the closure said after it: ${spoken.join(' | ')}`);
  assert.ok(logger.lines.some((l) => l.head === '[P2] fuel_range' && /briefing covered/.test(l.text)), 'and the log says why');
  assert.equal(ride.agg.current.lat, -26.14, 'GPS reaches the state');

  // Commands, carried out on the phone with no AI call.
  await ride.ask('be quiet');
  assert.equal(ride.engine.quietLeftMin(), Infinity, 'quiet until told');
  await ride.ask('mark this spot, pothole');
  assert.equal(RiderMemoryStore.load().marks.at(-1)?.note, 'pothole', 'the spot is kept through the shared store');
  await ride.ask('talk to me');
  assert.equal(ride.engine.quietLeftMin(), 0);
  await ride.ask('end ride');
  assert.equal(ended, 1, '"end ride" asks the app to end');
  assert.ok(chat.some((e) => e.from === 'betty' && 'command' in e && e.command === 'mark'), 'command replies reach the chat');

  // A question: no key, so a canned answer, still queued and spoken.
  await ride.ask('what is the weather doing?');
  await wait(50);
  assert.ok(ride.lastLine.length > 0, 'she answered');
  assert.ok(ride.rideInput().state === ride.agg.current, 'the ride screen input is built');
  assert.ok(changes > 0, 'the screen is told to repaint');

  // One voice at a time: while the voice server's conversation talks, her own lines wait, then play.
  ride.conversation(true);
  const before = spoken.length;
  ride.sayNow('A status update.');
  await wait(30);
  assert.equal(spoken.length, before, 'her line waits while the conversation talks');
  ride.conversation(false);
  await wait(30);
  assert.equal(spoken.at(-1), 'A status update.', 'and plays once it is over');

  // A phone call (CONFIG.quietOnCall): her lines wait until it is over, her own remarks are left out.
  ride.phoneCall(true);
  const n0 = spoken.length;
  ride.sayNow('After the call.');
  await ride.say({ id: 'ambient_banter', priority: 3, createdAt: Date.now(), context: '', fallback: 'A quip.' });
  ride.conversation(true); ride.conversation(false); // the voice server finishing must not release the call's hold
  await wait(30);
  assert.equal(spoken.length, n0, 'nothing plays during the call');
  assert.ok(logger.lines.some((l) => /dropped: you were on a call/.test(l.text) || /on a call/.test(l.text)), 'logged');
  ride.phoneCall(false);
  await wait(30);
  assert.equal(spoken.at(-1), 'After the call.', 'played once the call is over');
  assert.ok(!spoken.includes('A quip.'), 'her own remark was left out');

  // END RIDE: too short to keep, but everything kept as it went is on the "phone".
  const { kept } = ride.wrapUp();
  assert.equal(kept, false, 'a ride of seconds is not kept');
  await ride.signOff(() => false);
  ride.shutdown();
  assert.ok(data.has('betty.told.v1'), 'what she has told is kept as it goes');
  assert.match(data.get('betty.log.v1') ?? '', /\[command\]/, 'the log is saved through the shared store');
  assert.match(data.get('betty.log.v1') ?? '', /\[sensors\]/, 'a sensor line at the end');
  // The data backup (shared by both apps): out of one store, into another, the same betty.* entries come back.
  data.set('other.key', 'kept out');
  const file = JSON.stringify(backupOf(collect([...data.keys()], { getItem: (k) => data.get(k) ?? null, setItem: () => {}, removeItem: () => {} }), null));
  const back = parseBackup(file);
  assert.ok(!('other.key' in back.storage), 'only betty.* entries go in a backup');
  const phone = new Map<string, string>([['betty.old.v1', 'gone after restore'], ['not.betty', 'stays']]);
  restoreStorage(back, [...phone.keys()], { getItem: (k) => phone.get(k) ?? null, setItem: (k, v) => { phone.set(k, v); }, removeItem: (k) => { phone.delete(k); } });
  assert.equal(phone.get('betty.log.v1'), data.get('betty.log.v1'), 'the log comes back as it was');
  assert.ok(!phone.has('betty.old.v1') && phone.get('not.betty') === 'stays', 'restore replaces betty.* entries only');
  assert.match(describeBackup(back), /^\d+ rides, \d+ lines, 0 notes, 1 marked spots/);
  assert.throws(() => parseBackup('{"app":"betty","version":1,"storage":{"x":"1"}}'), /damaged/);

  // Landmarks (2026-10-26): a tile asked once and kept, the best one ahead researched once, all through the shared store.
  const { LandmarkSource, LandmarkNotes } = await import('../src/adapters/LandmarkSource');
  const asked: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    asked.push(String(url));
    if (String(url).startsWith('/api/landmarks')) return new Response(JSON.stringify({ wd: [{ p: { value: 'x/Q1' }, pLabel: { value: 'HartRAO' }, loc: { value: 'Point(27.685 -25.887)' }, typeLabel: { value: 'radio telescope' } }], osm: [], osmFailed: true }));
    assert.match(String(init?.body), /"kind":"landmark".*"area":"HartRAO"/);
    return new Response(JSON.stringify({ notes: [{ text: 'HartRAO began as a NASA tracking station in 1961.' }] }));
  }) as typeof fetch;
  const pushed: any[] = [];
  const lm = new LandmarkSource(() => ({ lat: -25.85, lon: 27.65 }), () => 'Hartbeespoort', () => {}, fake);
  lm.start((p) => pushed.push(p)); lm.stop();
  await wait(20);
  assert.equal(asked.filter((u) => u.startsWith('/api/landmarks')).length, 1, 'one tile asked');
  assert.deepEqual(LandmarkNotes.all().Q1, ['HartRAO began as a NASA tracking station in 1961.'], 'researched once and kept');
  assert.equal(pushed.at(-1).landmarks[0].notes.length, 1, 'the notes reach the state');
  await lm.tick();
  assert.equal(asked.length, 2, 'next time: from the phone, nothing asked again');
  console.log('ride session tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
