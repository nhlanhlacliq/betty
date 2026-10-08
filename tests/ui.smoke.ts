import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="sim"></div><div id="tuning"></div>');
Object.assign(globalThis, { document: dom.window.document, window: dom.window });

const { StateAggregator } = await import('../src/core/StateAggregator');
const { TriggerEngine } = await import('../src/core/TriggerEngine');
const { AudioQueue } = await import('../src/core/AudioQueue');
const { mountSimPanel } = await import('../src/ui/SimPanel');
const { mountTuningPanel } = await import('../src/ui/TuningPanel');
const { CONFIG, resetConfig } = await import('../src/config/betty');

const q = <T extends Element>(root: Element, sel: string) => root.querySelector(sel) as T;
const fire = (el: Element, type: string) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));

// ---- simulator panel
const agg = new StateAggregator();
agg.push({ obd: true }); // simulated OBD on, so the OBD rows are live
const engine = new TriggerEngine();
const spoken: string[] = [];
const queue = new AudioQueue({ speak: (_t, d) => d(), stop: () => {} }, () => true);
const said: string[] = [];
let resets = 0;
let refreshes = 0;
const root = document.getElementById('sim')!;
const unmount = mountSimPanel(root, {
  agg, engine, queue, say: (ev) => said.push(ev.id), aloud: true, setAloud: () => {},
  zeroLean: () => {}, refreshFeeds: () => { refreshes++; }, resetRide: () => { resets++; }, feedStatus: () => 'feeds ok',
  lastPhrase: () => 'fallback (HTTP 400), 12 ms',
});
assert.match(root.textContent!, /SIMULATOR/);
assert.match(q(root, '.info').textContent!, /Safe window: YES/);

// tick the first sensor (GPS speed) and move its slider
const firstRow = root.querySelector('.row')!;
const cb = q<HTMLInputElement>(firstRow, 'input[type=checkbox]');
const range = q<HTMLInputElement>(firstRow, 'input[type=range]');
assert.equal(range.disabled, true);
cb.checked = true; fire(cb, 'change');
range.value = '130'; fire(range, 'input');
assert.equal(agg.current.speedKmh, 130, 'slider overrides speed');
cb.checked = false; fire(cb, 'change');
assert.equal(agg.current.speedKmh, 0, 'untick restores live value');

// buttons
const buttons = [...root.querySelectorAll('button')] as HTMLButtonElement[];
const byText = (t: string | RegExp) => buttons.find((b) => (typeof t === 'string' ? b.textContent === t : t.test(b.textContent!)))!;
byText('Accident 2 km').click();
assert.equal(agg.current.incidents.length, 1);
assert.equal(agg.current.incidents[0].distanceKm, 2);
byText('Clear incidents').click();
assert.equal(agg.current.incidents.length, 0);
byText('Inject fault P0171').click();
assert.deepEqual(agg.current.dtcs, ['P0171']);
byText('Reset ride').click(); assert.equal(resets, 1);
byText(/^engine_overtemp · P1$/).click();
assert.deepEqual(said, ['engine_overtemp'], 'fire button emits event');

// last-line source is visible in the info line
assert.match(q(root, '.info').textContent!, /Last line: fallback \(HTTP 400\), 12 ms/);

// ambient flavours have fire buttons
byText(/^ambient_banter · P3$/).click(); byText(/^local_fact · P3$/).click();
assert.deepEqual(said.slice(-2), ['ambient_banter', 'local_fact']);

// location preset overrides position and refetches feeds; nearby places are listed
const locSel = q<HTMLSelectElement>(root, 'select');
locSel.value = '2'; fire(locSel, 'change'); // Soweto
assert.equal(agg.current.lat, -26.2678); assert.equal(agg.current.lon, 27.8585); assert.equal(refreshes, 1);
agg.push({ nearbyPlaces: [{ id: 'w1', name: 'Vilakazi Street', distanceKm: 0.8, summary: 'x' }] });
assert.match(q(root, '.places').textContent!, /Vilakazi Street 0.8 km/);
locSel.value = ''; fire(locSel, 'change');
assert.equal(agg.current.lat, null, 'back to live position');

// OBD off: engine rows and the fault button are disabled and their overrides dropped
const rowOf = (label: string) => [...root.querySelectorAll('.row')].find((r) => r.textContent!.includes(label))!;
const rpmCb = q<HTMLInputElement>(rowOf('RPM'), 'input[type=checkbox]');
rpmCb.checked = true; fire(rpmCb, 'change');
assert.equal(agg.hasOverride('rpm'), true);
agg.push({ obd: false });
assert.equal(rpmCb.disabled, true); assert.equal(rpmCb.checked, false); assert.equal(agg.hasOverride('rpm'), false);
assert.match(rowOf('RPM').textContent!, /OBD off/);
assert.equal(q<HTMLInputElement>(rowOf('GPS speed'), 'input[type=checkbox]').disabled, false, 'GPS row unaffected');
assert.equal(byText(/fault/).disabled, true);
agg.push({ obd: true });
assert.equal(rpmCb.disabled, false);

// weather override
const wxCb = [...root.querySelectorAll('input[type=checkbox]')].find((c) => c.parentElement?.textContent?.includes('Override live weather')) as HTMLInputElement;
wxCb.checked = true; fire(wxCb, 'change');
assert.equal(agg.current.weather?.rainChanceNextHourPct, 70);
unmount(); assert.equal(root.innerHTML, '');

// ---- tuning panel: edits mutate live CONFIG
const troot = document.getElementById('tuning')!;
mountTuningPanel(troot);
const sel = q<HTMLSelectElement>(troot, 'select'); // first = startup
sel.value = '3'; fire(sel, 'change');
assert.equal(CONFIG.priorities.startup, 3);
const nums = [...troot.querySelectorAll('input[type=number]')] as HTMLInputElement[];
const ambient = nums.find((n) => n.parentElement?.textContent?.startsWith('Min gap'))!;
assert.equal(ambient.value, '120', 'ambient gap defaults to 2 min');
ambient.value = '30'; fire(ambient, 'change');
assert.equal(CONFIG.ambientCooldownMs, 30_000);
const leanHold = [...troot.querySelectorAll('input[type=checkbox]')].find((c) => c.parentElement?.textContent?.includes('while leaned past')) as HTMLInputElement;
assert.equal(leanHold.checked, false, 'lean hold is off by default');
leanHold.checked = true; fire(leanHold, 'change');
assert.equal(CONFIG.safeWindow.useLean, true);
const banterW = nums.find((n) => n.parentElement?.textContent?.startsWith('Banter weight'))!;
assert.equal(banterW.value, '40');
banterW.value = '0'; fire(banterW, 'change');
assert.equal(CONFIG.ambient.banterWeight, 0);
assert.ok([...troot.querySelectorAll('button')].some((b) => /Forget past rides \(0 remembered\)/.test(b.textContent!)), 'memory control present');
const overtemp = nums.find((n) => n.parentElement?.textContent?.startsWith('Engine overtemp'))!;
overtemp.value = '999'; fire(overtemp, 'change');
assert.equal(CONFIG.thresholds.overtempC, 130, 'clamped to max');
[...troot.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Reset'))!.click();
assert.equal(CONFIG.ambientCooldownMs, 120_000); assert.equal(CONFIG.priorities.startup, 4);
assert.equal(CONFIG.ambient.banterWeight, 40); assert.equal(CONFIG.safeWindow.useLean, false);
resetConfig();

// ---- main screen: the real index.html wired by main.ts (catches a missing element id or a broken listener)
{
  const { readFileSync } = await import('node:fs');
  const page = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/, ''), { url: 'https://betty.test/' });
  Object.assign(globalThis, { document: page.window.document, window: page.window, localStorage: page.window.localStorage });
  await import('../src/main');
  const doc = page.window.document;
  const ev = (el: Element, type: string) => el.dispatchEvent(new page.window.Event(type, { bubbles: true }));

  const name = doc.getElementById('ridername') as HTMLInputElement;
  assert.equal(name.value, 'N', 'name box shows the current name');
  name.value = '  Captain  '; ev(name, 'change');
  assert.equal(CONFIG.riderName, 'Captain'); assert.equal(name.value, 'Captain');
  assert.match(page.window.localStorage.getItem('betty.config.v1')!, /"riderName":"Captain"/, 'name is remembered');
  name.value = ''; ev(name, 'change');
  assert.equal(name.value, 'N', 'empty falls back to the default');

  const obd = doc.getElementById('obdmode') as HTMLSelectElement;
  assert.equal(obd.value, 'off');
  obd.value = 'mock'; ev(obd, 'change');
  assert.equal(CONFIG.obdMode, 'mock');
  name.value = 'Boss'; ev(name, 'change');
  [...doc.querySelectorAll('#tuning button')].find((b) => b.textContent?.startsWith('Reset all'))!.dispatchEvent(new page.window.Event('click'));
  assert.equal(name.value, 'N'); assert.equal(obd.value, 'off', 'reset to defaults is reflected on the main screen');
  // lock screen: covers the page, swallows presses, and only a held press on its button unlocks
  const { mountLockScreen } = await import('../src/ui/LockScreen');
  const cover = doc.querySelector('.lockcover') as HTMLElement;
  assert.equal(cover.hidden, true);
  doc.getElementById('lock')!.dispatchEvent(new page.window.Event('click'));
  assert.equal(cover.hidden, false, 'LOCK SCREEN shows the cover');
  const host = doc.createElement('div'); doc.body.append(host);
  const ls = mountLockScreen(host, 30);
  const c2 = host.querySelector('.lockcover') as HTMLElement; const b2 = host.querySelector('.lockbtn') as HTMLElement;
  ls.lock(); ls.setInfo('87', 'Rain ahead.');
  assert.equal(ls.locked, true); assert.match(c2.textContent!, /87/); assert.match(c2.textContent!, /Rain ahead\./);
  let leaked = 0; host.addEventListener('click', () => leaked++);
  const tap = new page.window.Event('click', { bubbles: true, cancelable: true });
  c2.dispatchEvent(tap);
  assert.equal(leaked, 0, 'presses do not get through'); assert.equal(tap.defaultPrevented, true);
  ev(b2, 'pointerdown'); ev(b2, 'pointerup');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(ls.locked, true, 'a quick tap does not unlock');
  ev(b2, 'pointerdown');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(ls.locked, false, 'holding the button unlocks');

  for (const id of ['toggle', 'lock', 'real', 'status', 'wake', 'log', 'sim', 'speed', 'lean', 'rpm', 'temp', 'fuel', 'rain', 'feeds']) {
    assert.ok(doc.getElementById(id), `#${id} exists`);
  }
  resetConfig();
}

// ---- WebSpeaker: whatever the speech engine does, onDone is called exactly once so the queue never jams
{
  const { WebSpeaker } = await import('../src/adapters/WebSpeaker');
  type U = { text: string; onstart?: () => void; onend?: () => void; onerror?: (e: { error: string }) => void };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const rig = () => {
    const synth = { speaking: false, spoken: [] as U[], cancels: 0, resumes: 0,
      speak(u: any) { this.spoken.push(u); }, cancel() { this.cancels++; }, resume() { this.resumes++; } };
    const problems: string[] = [];
    const sp = new WebSpeaker((m) => problems.push(m), synth, (text) => ({ text }) as any, { startMs: 20, perWordMs: 0, baseMs: 80 });
    return { synth, problems, sp };
  };

  { // normal line
    const { synth, problems, sp } = rig(); let done = 0;
    sp.speak('hello there', () => done++);
    assert.equal(synth.resumes, 1, 'engine is un-paused before every line');
    synth.spoken[0].onstart!(); synth.spoken[0].onend!(); synth.spoken[0].onend!();
    await wait(120);
    assert.equal(done, 1, 'done exactly once'); assert.deepEqual(problems, []);
  }
  { // swallowed: never starts. One retry, then give up and move on.
    const { synth, problems, sp } = rig(); let done = 0;
    sp.speak('lost line', () => done++);
    await wait(30);
    assert.equal(synth.spoken.length, 2, 'retried once'); assert.equal(done, 0);
    await wait(40);
    assert.equal(done, 1, 'gave up and released the queue'); assert.equal(synth.spoken.length, 2);
    assert.match(problems.join('|'), /retrying.*line skipped/);
  }
  { // retry works
    const { synth, sp } = rig(); let done = 0;
    sp.speak('second time lucky', () => done++);
    await wait(30);
    synth.spoken[1].onstart!(); synth.spoken[0].onend!(); // late event from the abandoned first attempt is ignored
    assert.equal(done, 0);
    synth.spoken[1].onend!();
    assert.equal(done, 1);
  }
  { // starts but never reports the end: the deadline releases the queue
    const { synth, problems, sp } = rig(); let done = 0;
    sp.speak('never ends', () => done++);
    synth.spoken[0].onstart!();
    await wait(120);
    assert.equal(done, 1); assert.match(problems[0], /never reported finishing/); assert.equal(synth.spoken.length, 1, 'no retry once it started');
  }
  { // engine error before starting retries; stop() means no callback at all
    const { synth, sp } = rig(); let done = 0;
    sp.speak('errors', () => done++);
    synth.spoken[0].onerror!({ error: 'synthesis-failed' });
    assert.equal(synth.spoken.length, 2);
    sp.stop();
    synth.spoken[1].onend!();
    await wait(120);
    assert.equal(done, 0, 'a stopped line never calls back'); assert.ok(synth.cancels >= 1);
  }
}
console.log('ui smoke tests passed');
