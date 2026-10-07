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
assert.equal(CONFIG.ambient.banterWeight, 40);
resetConfig();
console.log('ui smoke tests passed');
