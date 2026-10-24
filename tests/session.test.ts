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
  await wait(600); // the briefing (canned without a key)
  assert.ok(spoken.some((t) => /online/i.test(t)), `the briefing is spoken: ${spoken.join(' | ')}`);
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

  // END RIDE: too short to keep, but everything kept as it went is on the "phone".
  const { kept } = ride.wrapUp();
  assert.equal(kept, false, 'a ride of seconds is not kept');
  await ride.signOff(() => false);
  ride.shutdown();
  assert.ok(data.has('betty.told.v1'), 'what she has told is kept as it goes');
  assert.match(data.get('betty.log.v1') ?? '', /\[command\]/, 'the log is saved through the shared store');
  assert.match(data.get('betty.log.v1') ?? '', /\[sensors\]/, 'a sensor line at the end');
  console.log('ride session tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
