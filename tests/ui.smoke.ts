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
  refreshFeeds: () => { refreshes++; }, resetRide: () => { resets++; }, feedStatus: () => 'feeds ok',
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
agg.push({ nearbyPlaces: [{ id: 'w1', name: 'Vilakazi Street', distanceKm: 0.8, summary: 'x', lat: 0, lon: 0, interest: 1 }] });
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

// new sensor rows and the jolt button
const altCb = q<HTMLInputElement>(rowOf('Altitude'), 'input[type=checkbox]'); const altRange = q<HTMLInputElement>(rowOf('Altitude'), 'input[type=range]');
assert.equal(altRange.value, '0', 'unknown altitude shows as 0 on the slider, not "null"');
altCb.checked = true; fire(altCb, 'change'); altRange.value = '1650'; fire(altRange, 'input');
assert.equal(agg.current.altitudeM, 1650);
altCb.checked = false; fire(altCb, 'change'); assert.equal(agg.current.altitudeM, null);
byText(/Rough patch/).click(); assert.equal(agg.current.jolts, 5);
assert.ok(!byText('Zero lean'), 'lean no longer comes from the phone tilt, nothing to zero');

// weather override
const wxCb = [...root.querySelectorAll('input[type=checkbox]')].find((c) => c.parentElement?.textContent?.includes('Override live weather')) as HTMLInputElement;
wxCb.checked = true; fire(wxCb, 'change');
assert.equal(agg.current.weather?.rainChanceNextHourPct, 70);
assert.ok(Math.abs(agg.current.weather!.sunsetAt! - Date.now() - 180 * 60_000) < 5000, 'simulated sunset is 3 hours out by default');
for (const id of ['fuel_range', 'sunset_soon', 'ride_debrief']) assert.ok(byText(new RegExp(`^${id} · P`)), `${id} can be fired from the simulator`);
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
for (const label of ['Longest line', 'Traffic min delay', 'Sunset warning', 'Fuel consumption', 'Fuel range warning']) assert.ok(nums.some((n) => n.parentElement?.textContent?.startsWith(label)), `${label} is tunable`);
const cons = nums.find((n) => n.parentElement?.textContent?.startsWith('Fuel consumption'))!;
cons.value = '5.1'; fire(cons, 'change');
assert.equal(CONFIG.fuel.lPer100, 5.1); CONFIG.fuel.lPer100 = 4.4;
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
  assert.equal(name.value, 'sir', 'name box shows the current name');
  name.value = '  Captain  '; ev(name, 'change');
  assert.equal(CONFIG.riderName, 'Captain'); assert.equal(name.value, 'Captain');
  assert.match(page.window.localStorage.getItem('betty.config.v1')!, /"riderName":"Captain"/, 'name is remembered');
  name.value = ''; ev(name, 'change');
  assert.equal(name.value, 'sir', 'empty falls back to the default');

  const bike = doc.getElementById('bikename') as HTMLInputElement;
  assert.equal(bike.value, 'the bike');
  bike.value = ' Rocinante '; ev(bike, 'change');
  assert.equal(CONFIG.bikeName, 'Rocinante');
  assert.match(page.window.localStorage.getItem('betty.config.v1')!, /"bikeName":"Rocinante"/, 'bike name is remembered');

  // the per-ride switch for headset buttons: off by default, remembered
  const btnBox = doc.getElementById('buttons') as HTMLInputElement;
  assert.equal(btnBox.checked, false, 'off by default: it pauses music from other apps');
  btnBox.checked = true; ev(btnBox, 'change');
  assert.equal(CONFIG.headsetButtons, true); assert.match(page.window.localStorage.getItem('betty.config.v1')!, /"headsetButtons":true/);
  btnBox.checked = false; ev(btnBox, 'change');

  const obd = doc.getElementById('obdmode') as HTMLSelectElement;
  assert.equal(obd.value, 'off');
  obd.value = 'mock'; ev(obd, 'change');
  assert.equal(CONFIG.obdMode, 'mock');
  name.value = 'Boss'; ev(name, 'change');
  [...doc.querySelectorAll('#tuning button')].find((b) => b.textContent?.startsWith('Reset all'))!.dispatchEvent(new page.window.Event('click'));
  assert.equal(name.value, 'sir'); assert.equal(bike.value, 'the bike'); assert.equal(obd.value, 'off', 'reset to defaults is reflected on the main screen');
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

  // ---- app shell: navigation, home ride mode, readiness, settings dials, explore
  {
    const click = (el: Element) => el.dispatchEvent(new page.window.Event('click', { bubbles: true }));
    const shown = () => [...doc.querySelectorAll<HTMLElement>('[data-screen]')].filter((s) => !s.hidden).map((s) => s.dataset.screen);
    assert.deepEqual(shown(), ['home'], 'opens on home, one screen at a time');
    assert.equal(doc.getElementById('homeheadline')!.textContent, 'The road is yours.');
    assert.equal(doc.getElementById('profileinitial')!.textContent, 'S', 'his initial on the avatar');
    assert.deepEqual([...doc.querySelectorAll('.tab-bar [data-nav]')].map((b) => b.querySelector('span')!.textContent!.trim()), ['Ride', 'Journeys', 'Explore', 'Garage'], 'four tabs');
    assert.ok(!doc.querySelector('i[data-icon]'), 'every icon placeholder became an SVG');
    click(doc.querySelector('[data-nav="journeys"]')!);
    assert.deepEqual(shown(), ['journeys']); assert.ok(doc.querySelector('[data-nav="journeys"]')!.classList.contains('active'));
    assert.match(doc.getElementById('journeylist')!.textContent!, /Your story starts on the road/, 'no rides yet');
    click(doc.querySelector('[data-nav="settings"]')!);
    assert.deepEqual(shown(), ['settings']);
    click(doc.querySelector('[data-screen="settings"] [data-go="workshop"]')!);
    assert.deepEqual(shown(), ['workshop']); assert.ok(doc.querySelector('[data-nav="settings"]')!.classList.contains('active'), 'the Workshop lives under settings');
    click(doc.querySelector('[data-screen="workshop"] [data-back]')!);
    assert.deepEqual(shown(), ['settings'], 'back returns to where you came from');
    click(doc.querySelector('[data-nav="home"]')!);
    assert.match(doc.getElementById('homecondition')!.textContent!, /first ride/, 'no rides to show yet');

    // ride mode tiles drive the #real checkbox main.ts reads at START
    const real = doc.getElementById('real') as HTMLInputElement;
    const tile = (m: string) => doc.querySelector(`[data-mode="${m}"]`) as HTMLElement;
    assert.equal(real.checked, true); assert.ok(tile('real').classList.contains('active'));
    click(tile('sim')); assert.equal(real.checked, false); assert.ok(tile('sim').classList.contains('active')); assert.ok(!tile('real').classList.contains('active'));
    assert.equal(doc.getElementById('modetitle')!.textContent, 'Desk test', 'the dock shows the mode chosen in the sheet');
    click(tile('real')); assert.equal(real.checked, true);

    // readiness sheet: filled when opened, closes on its button and on the backdrop
    const sheet = doc.querySelector('[data-sheet="ready"]') as HTMLElement;
    click(doc.querySelector('[data-sheet-open="ready"]')!);
    assert.equal(sheet.hidden, false);
    assert.match(doc.getElementById('readyrows')!.textContent!, /GPS.*Voice.*Gemini, Aoede.*Brain.*No key: canned lines only/);
    assert.match(doc.getElementById('readytitle')!.textContent!, /^Check: /, 'a problem (no GPS here, no Claude key) is flagged');
    click(sheet); assert.equal(sheet.hidden, true, 'tap on the backdrop closes it');

    // settings: humour and character sliders, talk presets, visual companion
    const humour = doc.getElementById('humour') as HTMLInputElement;
    assert.equal(humour.value, '75'); assert.equal(doc.getElementById('humourval')!.textContent, '75%');
    humour.value = '30'; ev(humour, 'change');
    assert.equal(CONFIG.persona.humour, 30); assert.match(page.window.localStorage.getItem('betty.config.v1')!, /"humour":30/);
    const blend = doc.getElementById('blend') as HTMLInputElement;
    blend.value = '80'; ev(blend, 'change'); assert.equal(CONFIG.persona.tars, 80); assert.equal(doc.getElementById('blendval')!.textContent, '80% TARS');
    const talk = doc.getElementById('talkpreset') as HTMLSelectElement;
    assert.equal(talk.value, 'balanced', 'defaults are Balanced');
    talk.value = 'minimal'; ev(talk, 'change');
    assert.equal(CONFIG.ambient.silenceWeight, 60); assert.equal(CONFIG.ambientCooldownMs, 240_000);
    CONFIG.ambient.banterWeight = 33; page.window.dispatchEvent(new page.window.Event('betty-config'));
    assert.equal(talk.value, 'custom', 'a tuned mix is custom'); assert.match(doc.getElementById('talkhint')!.textContent!, /custom mix/);
    talk.value = 'balanced'; ev(talk, 'change'); assert.equal(CONFIG.ambient.banterWeight, 40);
    const gs = doc.getElementById('glanceswitch') as HTMLInputElement;
    assert.equal(gs.checked, true); gs.checked = false; ev(gs, 'change'); assert.equal(CONFIG.showGlance, false); gs.checked = true; ev(gs, 'change');
    const lv = doc.getElementById('listenvoice') as HTMLSelectElement;
    assert.equal(lv.value, 'chirp', 'stories at home in Chirp by default'); lv.value = 'phone'; ev(lv, 'change'); assert.equal(CONFIG.listenVoice, 'phone'); lv.value = 'chirp'; ev(lv, 'change');
    for (const [id, key] of [['cardplaces', 'cardPlaces'], ['cardmetro', 'cardMetro']] as const) {
      const box = doc.getElementById(id) as HTMLInputElement;
      assert.equal(box.checked, true, `${id} on by default`); box.checked = false; ev(box, 'change'); assert.equal(CONFIG[key], false); box.checked = true; ev(box, 'change');
    }
    const boost = doc.getElementById('voiceboost') as HTMLInputElement;
    assert.equal(boost.value, '6'); assert.equal(doc.getElementById('voiceboostval')!.textContent, '+6 dB');
    boost.value = '12'; ev(boost, 'change'); assert.equal(CONFIG.voiceBoostDb, 12); assert.match(page.window.localStorage.getItem('betty.config.v1')!, /"voiceBoostDb":12/);
    boost.value = '0'; ev(boost, 'input'); assert.equal(doc.getElementById('voiceboostval')!.textContent, 'Off'); boost.value = '6'; ev(boost, 'change');
    const ro = doc.getElementById('ridingonly') as HTMLInputElement;
    assert.equal(ro.checked, true, 'riding time only by default'); ro.checked = false; ev(ro, 'change'); assert.equal(CONFIG.ridingTimeOnly, false); ro.checked = true; ev(ro, 'change');
    assert.equal((doc.getElementById('buttonsback') as HTMLButtonElement).hidden, true, 'nothing to take back before a ride');
    const fuelBox = (id: string) => doc.getElementById(id) as HTMLInputElement;
    assert.deepEqual(['tankl', 'reservel', 'lper100', 'fuelprice'].map((id) => fuelBox(id).value), ['11', '1', '4.4', '30.25'], 'his fuel figures by default');
    assert.match(doc.getElementById('pricesub')!.textContent!, /Yours, set 17 Oct/);
    fuelBox('lper100').value = '5'; ev(fuelBox('lper100'), 'change'); assert.equal(CONFIG.fuel.lPer100, 5);
    fuelBox('lper100').value = '99'; ev(fuelBox('lper100'), 'change'); assert.equal(CONFIG.fuel.lPer100, 5, 'nonsense is refused'); assert.equal(fuelBox('lper100').value, '5');
    fuelBox('fuelprice').value = '31,10'; ev(fuelBox('fuelprice'), 'change'); assert.equal(CONFIG.fuel.pricePerL, 31.1); assert.equal(CONFIG.fuel.priceSource, 'manual');
    assert.match(page.window.localStorage.getItem('betty.config.v1')!, /"lPer100":5/);
    CONFIG.fuel.lPer100 = 4.4; CONFIG.fuel.pricePerL = 30.25; page.window.dispatchEvent(new page.window.Event('betty-config'));

    // Garage search: rows that match stay, the rest of the Garage hides; help topics and commands are offered
    const gsearch = doc.getElementById('garagesearch') as HTMLInputElement;
    const shownCards = () => [...doc.querySelectorAll('#garagecards > .settings-card')].filter((c) => !c.classList.contains('search-hide')).map((c) => c.querySelector('h2')!.textContent);
    gsearch.value = 'consumption'; ev(gsearch, 'input');
    assert.deepEqual(shownCards(), ['In your garage'], 'only the card with it');
    const garageRows = [...doc.querySelectorAll('#garagecards .settings-card:not(.search-hide) > .setting')].filter((r) => !r.classList.contains('search-hide'));
    assert.equal(garageRows.length, 1); assert.match(garageRows[0].textContent!, /Average consumption/);
    const found = doc.getElementById('garagefound')!;
    assert.equal(found.hidden, false); assert.match(found.textContent!, /"Consumption 4\.6"/); assert.match(found.textContent!, /Fuel range and costs/);
    gsearch.value = 'louder'; ev(gsearch, 'input'); assert.deepEqual(shownCards(), ['Voice & audio']);
    gsearch.value = 'zzzz'; ev(gsearch, 'input'); assert.match(found.textContent!, /Nothing matches/);
    gsearch.value = ''; ev(gsearch, 'input');
    assert.equal(found.hidden, true); assert.equal(doc.querySelectorAll('#garagecards .search-hide').length, 0, 'cleared: everything back');
    // Help: the topics, a topic opened from Garage, its own search
    assert.ok(doc.querySelectorAll('#helpbody details.help-topic').length >= 10);
    click(doc.querySelector('[data-nav="settings"]')!);
    click(doc.querySelector('#garagecards [data-help="commands"]')!);
    assert.equal((doc.querySelector('[data-screen="help"]') as HTMLElement).hidden, false, 'Help is open');
    assert.equal((doc.getElementById('help-commands') as HTMLDetailsElement).open, true);
    assert.match(doc.getElementById('help-commands')!.textContent!, /"Quiet for ten minutes".*"End ride".*"Mark this spot".*"Consumption 4\.6"/s);
    const hsearch = doc.getElementById('helpsearch') as HTMLInputElement;
    hsearch.value = 'detour'; ev(hsearch, 'input');
    assert.equal(doc.querySelectorAll('#helpbody details:not(.search-hide)').length, 1); assert.equal((doc.getElementById('help-routes') as HTMLDetailsElement).open, true);
    hsearch.value = ''; ev(hsearch, 'input');
    click(doc.querySelector('[data-screen="help"] [data-back]')!);
    assert.equal((doc.querySelector('[data-screen="settings"]') as HTMLElement).hidden, false, 'back to the Garage');

    // Reminders: the starting set, Done, editing in the sheet, the odometer
    const rlist = doc.getElementById('reminderlist')!;
    const rowsNow = () => [...rlist.querySelectorAll('.reminder-row')].map((r) => [...r.querySelectorAll('b, small, .reminder-state, [data-done], [data-undo]')].map((x) => x.textContent).join(' '));
    assert.equal(rowsNow().length, 5, 'the most pressing five'); assert.match(rlist.textContent!, /BMW G 310 GS schedule from the handbook\. Set the odometer first/);
    click(rlist.querySelector('[data-showall]')!); assert.equal(rowsNow().length, 12, 'Show all');
    assert.match(rowsNow().join('|'), /Chain clean and lube Every 600 km · last done: a guess in 600 km Done/);
    assert.match(rowsNow().join('|'), /Engine oil and filter Every 10,000 km or a year · last done: a guess in 10,000 km or in 12 months Done/);
    assert.match(rowsNow().join('|'), /Brake fluid, entire system Every 2 years · last done: a guess in 2 years/);
    const odoBox = doc.getElementById('odometer') as HTMLInputElement;
    odoBox.value = '23,450'; ev(odoBox, 'change');
    assert.equal(JSON.parse(page.window.localStorage.getItem('betty.service.v1')!).odoKm, 23450);
    assert.match(rowsNow().join('|'), /Chain clean and lube Every 600 km · last done: a guess in 600 km/, 'setting the odometer keeps what is due');
    assert.match(rowsNow().join('|'), /Engine oil and filter Every 10,000 km or a year · last done: a guess in 6,550 km/, 'the schedule lines up with the odometer');
    click(rlist.querySelector('[data-edit="chain"]')!);
    assert.equal((doc.querySelector('[data-sheet="reminder"]') as HTMLElement).hidden, false);
    (doc.getElementById('reminderago') as HTMLInputElement).value = '550';
    doc.getElementById('reminderform')!.dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    assert.match(rowsNow()[0], /^Chain clean and lube Every 600 km Soon: in 50 km Done/, 'lubed 550 km ago: soon, and first');
    click(rlist.querySelector('[data-done="chain"]')!);
    assert.match(rowsNow().join('|'), /Chain clean and lube Every 600 km Done just now · next in 600 km Undo/, 'Done turns into Undo');
    click(rlist.querySelector('[data-undo="chain"]')!);
    assert.match(rowsNow()[0], /^Chain clean and lube Every 600 km Soon: in 50 km Done/, 'Undo: back to how it was');
    click(rlist.querySelector('[data-done="chain"]')!);
    click(doc.querySelector('[data-nav="home"]')!); click(doc.querySelector('[data-nav="settings"]')!);
    assert.match(rowsNow().join('|'), /Chain clean and lube Every 600 km in 600 km Done/, 'after leaving the Garage: Done again');
    click(rlist.querySelector('[data-edit="chain"]')!);
    const notDone = doc.getElementById('reminderundo') as HTMLButtonElement;
    assert.equal(notDone.hidden, false); assert.match(notDone.textContent!, /^Mark as not done \(back to /);
    click(notDone);
    assert.match(rowsNow()[0], /^Chain clean and lube Every 600 km Soon: in 50 km/, 'marked not done from the sheet');
    click(rlist.querySelector('[data-edit="chain"]')!); assert.equal((doc.getElementById('reminderundo') as HTMLButtonElement).hidden, true, 'nothing left to take back');
    doc.querySelector<HTMLElement>('[data-sheet="reminder"] [data-sheet-close]')!.click();
    click(rlist.querySelector('[data-done="chain"]')!);
    assert.match(rowsNow().join('|'), /Chain clean and lube Every 600 km Done just now · next in 600 km/);
    click(doc.getElementById('reminderadd')!);
    (doc.getElementById('remindername') as HTMLInputElement).value = 'Brake fluid';
    (doc.getElementById('remindertime') as HTMLInputElement).value = '2'; (doc.getElementById('reminderunit') as HTMLSelectElement).value = '365';
    doc.getElementById('reminderform')!.dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    assert.match(rowsNow().join('|'), /Brake fluid Every 2 years in 2 years/);
    gsearch.value = 'chain'; ev(gsearch, 'input'); assert.ok(shownCards().includes('Reminders')); gsearch.value = ''; ev(gsearch, 'input');
    page.window.localStorage.removeItem('betty.service.v1');
    CONFIG.persona.humour = 75; CONFIG.persona.tars = 50;

    // explore: notes and marked spots, with Forget
    const { RiderMemoryStore } = await import('../src/adapters/RiderMemoryStore');
    RiderMemoryStore.save({ notes: [{ at: 1, text: 'tyres at 2.2 bar' }], marks: [{ at: 2, lat: -26.1, lon: 28.1, note: 'pothole', near: 'Edenvale' }] });
    page.window.dispatchEvent(new page.window.Event('betty-memory'));
    const ex = doc.getElementById('explorelist')!;
    assert.match(ex.textContent!, /pothole.*Near Edenvale.*Open map.*tyres at 2\.2 bar/s, 'newest first');
    click(doc.querySelector('[data-tab="notes"]')!); assert.ok(!/pothole/.test(ex.textContent!), 'the Notes tab shows notes only');
    click(doc.querySelector('[data-tab="all"]')!);
    click(ex.querySelector('[data-forget^="note"]')!);
    assert.ok(!/tyres/.test(ex.textContent!)); assert.equal(RiderMemoryStore.load().notes.length, 0);
    RiderMemoryStore.save({ notes: [], marks: [] }); page.window.dispatchEvent(new page.window.Event('betty-memory'));
  }

  // voice picker: lists English voices (en-ZA first), remembers the choice, survives the list arriving late
  {
    const vsel = doc.getElementById('voice') as HTMLSelectElement;
    assert.deepEqual([...vsel.options].map((o) => o.textContent), ['Automatic (no voices listed by this browser)']);
    const listeners: Array<() => void> = [];
    const voices = [
      { voiceURI: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', lang: 'en-US' }, { voiceURI: 'u.tessa', name: 'Tessa', lang: 'en-ZA' },
      { voiceURI: 'u.amelie', name: 'Amelie', lang: 'fr-CA' }, { voiceURI: 'u.daniel', name: 'Daniel', lang: 'en-GB' }, { voiceURI: 'com.apple.voice.premium.en-AU.Karen', name: 'Karen', lang: 'en-AU' },
    ];
    // jsdom has no speech engine; main.ts asked for the list once already, so drive its refresh through the reset event
    (page.window as any).speechSynthesis = { getVoices: () => voices, addEventListener: (_: string, f: () => void) => listeners.push(f), speak() {}, cancel() {}, resume() {}, speaking: false };
    page.window.dispatchEvent(new page.window.Event('betty-config'));
    assert.deepEqual([...vsel.options].map((o) => o.textContent),
      ['Automatic (phone default)', 'Tessa (en-ZA)', 'Daniel (en-GB)', 'Karen (en-AU, premium)', 'Samantha (en-US, basic)'], 'English only, South African first, quality shown');
    vsel.value = 'u.daniel'; ev(vsel, 'change');
    assert.equal(CONFIG.voiceURI, 'u.daniel');
    assert.match(page.window.localStorage.getItem('betty.config.v1')!, /"voiceURI":"u.daniel"/);
    page.window.dispatchEvent(new page.window.Event('betty-config'));
    assert.equal(vsel.value, 'u.daniel', 'choice survives the list being rebuilt');
    delete (page.window as any).speechSynthesis;
    CONFIG.voiceURI = '';
  }

  // fuel range: unknown until FILLED UP is tapped, then the configured full-tank range
  assert.equal(doc.getElementById('range')!.textContent, '-');
  doc.getElementById('filled')!.dispatchEvent(new page.window.Event('click'));
  assert.equal(doc.getElementById('range')!.textContent, '227');
  assert.match(page.window.localStorage.getItem('betty.fuel.v1')!, /"kmSinceFill":0/, 'fill-up is remembered');
  assert.match(doc.getElementById('status')!.textContent!, /Range reset to 227 km/);

  // LOG panel on the real page: starts empty, wired to storage
  assert.match(doc.getElementById('logpanel')!.textContent!, /LOG \(saved on this device\)/);
  assert.match(doc.querySelector('.logview')!.textContent!, /No lines logged yet/);

  // LOG panel behaviour: lists rides, filters to one, and clears
  const { mountLogPanel } = await import('../src/ui/LogPanel');
  const r1 = new Date(2026, 9, 9, 16, 30).getTime(), r2 = new Date(2026, 9, 10, 8, 5).getTime();
  let stored = [
    { id: 'a', at: r1 + 5000, rideId: r1, head: '[P4] startup (claude, 1200 ms)', text: 'Afternoon, sir.', fate: 'spoken' },
    { id: 'b', at: r2 + 9000, rideId: r2, head: '[P2] rain_soon (fallback: timeout, 2500 ms)', text: 'Rain within the hour.', fate: 'spoken' },
  ];
  const lhost = doc.createElement('div'); doc.body.append(lhost);
  const r0 = new Date(2026, 9, 5, 7, 45).getTime();
  const remembered = [{ startedAt: r0, minutes: 95, distanceKm: 88, weather: 'showers, 17 C', places: ['Soweto'], events: ['rain'] }];
  const panel = mountLogPanel(lhost, { entries: () => stored, rides: () => remembered, clear: () => { stored = []; } });
  const lsel = lhost.querySelector('select') as HTMLSelectElement; const lview = lhost.querySelector('.logview') as HTMLElement;
  assert.deepEqual([...lsel.options].map((o) => o.textContent), ['Latest ride: 2026-10-10 08:05 (1 lines)', 'All rides (3 rides, 2 lines)', '2026-10-10 08:05 (1 lines)', '2026-10-09 16:30 (1 lines)', '2026-10-05 07:45 (summary only)']);
  assert.equal(lsel.value, 'latest', 'opens on the latest ride');
  assert.match(lview.textContent!, /Rain within the hour/); assert.ok(!/Afternoon, sir\.|95 min/.test(lview.textContent!), 'earlier rides are not in the default view');
  lsel.value = 'all'; ev(lsel, 'change');
  assert.match(lview.textContent!, /Ride 2026-10-05 07:45: 95 min, 88 km, showers, 17 C/); assert.match(lview.textContent!, /Talked about: Soweto/);
  assert.match(lhost.querySelector('.info')!.textContent!, /3 ride\(s\), 2 saved line\(s\), 1 with a summary only/);
  assert.match(lview.textContent!, /Afternoon, sir\./); assert.match(lview.textContent!, /fallback: timeout/);
  lsel.value = String(r2); ev(lsel, 'change');
  assert.ok(!lview.textContent!.includes('Afternoon, sir.'), 'filtered to one ride'); assert.match(lview.textContent!, /Rain within the hour/);
  stored = [...stored, { id: 'c', at: r2 + 20_000, rideId: r2, head: '[audio]', text: 'speech never reported finishing, moving on', fate: '' }];
  panel.refresh();
  assert.equal(lsel.value, String(r2), 'refresh keeps the chosen ride'); assert.match(lview.textContent!, /never reported finishing/);
  const lbtn = (t: string) => [...lhost.querySelectorAll('button')].find((b) => b.textContent === t)!;
  for (const t of ['Refresh', 'Copy', 'Share', 'Save file', 'Clear saved log']) assert.ok(lbtn(t), `${t} button`);
  lbtn('Clear saved log').dispatchEvent(new page.window.Event('click'));
  assert.ok(!lview.textContent!.includes('Afternoon, sir.'), 'saved lines are gone');
  assert.match(lview.textContent!, /95 min, 88 km/, "clearing the log leaves Betty's ride memory alone");
  assert.deepEqual([...lsel.options].map((o) => o.textContent), ['Latest ride: 2026-10-05 07:45 (summary only)', 'All rides (1 rides, 0 lines)', '2026-10-05 07:45 (summary only)']);

  // ---- a whole simulated ride on the real page: START, a line is logged, END waits for the sign-off, then shuts down
  {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const realFetch = globalThis.fetch, realNow = Date.now;
    let skew = 0;
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch; // no network in tests
    Date.now = () => realNow() + skew; // lets the test make the ride "long enough" to earn a sign-off
    try {
      const startBtn = doc.getElementById('start') as HTMLButtonElement;
      const endBtn = doc.getElementById('end') as HTMLButtonElement;
      const endText = doc.getElementById('endtext')!;
      const logText = () => doc.getElementById('log')!.textContent!;
      const click = (el: Element) => el.dispatchEvent(new page.window.Event('click', { bubbles: true }));
      const screen = (id: string) => !(doc.querySelector(`[data-screen="${id}"]`) as HTMLElement).hidden;
      const sheetOpen = (id: string) => !(doc.querySelector(`[data-sheet="${id}"]`) as HTMLElement).hidden;
      /** End ride asks first: the button opens a sheet, its End ride button ends it. */
      const endRide = () => { click(endBtn); assert.ok(sheetOpen('end'), 'End ride opens the sheet'); click(doc.getElementById('endconfirm')!); };
      const riding = () => screen('ride') && endText.textContent === 'End ride';
      const ended = () => !screen('ride') && doc.getElementById('sim')!.innerHTML === '';
      (doc.getElementById('real') as HTMLInputElement).checked = false;
      CONFIG.feeds.briefingWaitMs = 0; // the briefing would otherwise wait up to 10 s for weather the test does not serve

      const talkBtn = doc.querySelector('.locktalk') as HTMLElement;
      assert.equal(talkBtn.hidden, true, 'no talk button without a ride');
      click(startBtn); click(startBtn); // the second tap lands while it is still starting and must be ignored
      await wait(150);
      assert.ok(riding(), 'the ride screen shows');
      assert.equal(doc.getElementById('starttext')!.textContent, 'Back to the ride');
      assert.match(doc.getElementById('rideline')!.textContent!, /Desk test/); assert.equal(doc.getElementById('modepill')!.textContent, 'Desk test');
      assert.match(doc.getElementById('ridemap')!.innerHTML, /<svg class="map-art"/, 'the ride map is drawn');
      click(doc.querySelector('[data-nav="home"]')!); assert.ok(screen('ride'), 'Ride in the navigation goes back to the ride');
      assert.ok(doc.getElementById('ridekicker')!.textContent, 'the ride screen says what Betty is doing');
      assert.match(doc.getElementById('glancetitle')!.textContent!, /\S/, 'one glanceable cue');
      assert.equal(talkBtn.hidden, false, 'the lock screen offers TAP TO TALK during a ride');
      // chat: a typed question goes through the real pipeline and both sides appear on the timeline
      const chatIn = doc.getElementById('chatinput') as HTMLInputElement;
      chatIn.value = 'how far have we gone?';
      doc.querySelector('#chat form')!.dispatchEvent(new page.window.Event('submit', { cancelable: true }));
      await wait(50);
      const chatText = doc.getElementById('chat')!.textContent!;
      assert.match(chatText, /how far have we gone\?/); assert.match(chatText, /can't think that one through without a signal/);
      assert.match(chatText, /fallback: no API key · \d+ ms · P4 · rider_query/);
      assert.match(logText(), /rider_query \(fallback: no API key/);
      assert.match(logText(), /startup \(fallback: no API key/); assert.match(logText(), /Systems online\./);
      assert.equal((logText().match(/startup/g) ?? []).length, 1, 'one ride, not two');
      // commands are carried out on the phone, with no Claude call
      const tell = async (t: string) => { chatIn.value = t; doc.querySelector('#chat form')!.dispatchEvent(new page.window.Event('submit', { cancelable: true })); await wait(20); };
      await tell('Be quiet for ten minutes');
      assert.match(doc.getElementById('chat')!.textContent!, /Quiet for 10 minutes\. Alerts still come through\.command: quiet · on the phone/);
      assert.match(logText(), /\[command\]: quiet for 10 min/);
      await tell('talk to me'); assert.match(doc.getElementById('chat')!.textContent!, /I'm back\./);
      await tell('mark this spot'); assert.match(doc.getElementById('chat')!.textContent!, /no GPS fix/);
      await tell('remember that the chain needs lube');
      assert.match(doc.getElementById('memorypanel')!.textContent!, /MEMORY \(1 notes, 0 spots\)/);
      assert.match(doc.getElementById('memorypanel')!.textContent!, /the chain needs lube/);
      await tell('forget that'); assert.match(doc.getElementById('memorypanel')!.textContent!, /MEMORY \(0 notes/);
      await tell('repeat that'); assert.match(doc.getElementById('chat')!.textContent!, /command: repeat/);
      await tell('humour 40 percent'); assert.equal(CONFIG.persona.humour, 40); assert.match(doc.getElementById('chat')!.textContent!, /Humour at 40 percent\./);
      await tell('more TARS'); assert.equal(CONFIG.persona.tars, 75);
      await tell('switch to stories'); assert.equal(CONFIG.ambient.tourGuideWeight, 60);
      await tell('less chatty'); assert.equal(CONFIG.ambientCooldownMs, 150_000);
      await tell('balanced');
      await tell('status'); assert.match(doc.getElementById('chat')!.textContent!, /Humour 40 percent\. 25 percent JARVIS, 75 TARS\. Banter 40, tour guide 40, silence 20 percent, a remark every 2 minutes\./);
      assert.match(doc.getElementById('sim')!.textContent!, /SIMULATOR/);
      // the ride screen's ask sheet ("I'm listening.") and the conversation view
      click(doc.querySelector('[data-sheet-open="ask"]')!); assert.ok(sheetOpen('ask'));
      (doc.getElementById('asksheetinput') as HTMLInputElement).value = 'is it going to rain?';
      doc.getElementById('asksheetform')!.dispatchEvent(new page.window.Event('submit', { cancelable: true }));
      await wait(50);
      assert.ok(!sheetOpen('ask'), 'asking closes the sheet');
      assert.match(doc.getElementById('chatlist')!.textContent!, /is it going to rain\?/, 'the question is in the conversation');
      click(doc.querySelector('[data-screen="ride"] [data-go="chat"]') ?? doc.querySelector('[data-sheet="ask"] [data-go="chat"]')!);
      assert.ok(screen('chat'));
      (doc.getElementById('askinput') as HTMLInputElement).value = 'how far have we gone?';
      doc.getElementById('askform')!.dispatchEvent(new page.window.Event('submit', { cancelable: true }));
      await wait(50);
      assert.ok(doc.querySelectorAll('#chatlist .bubble.rider').length >= 2, 'typed in the chat screen too');
      click(doc.getElementById('chatback')!); assert.ok(screen('ride'), 'back to the ride');
      click(doc.getElementById('mute')!); await wait(20);
      assert.match(doc.getElementById('chat')!.textContent!, /Going quiet\./); assert.ok(doc.getElementById('mute')!.classList.contains('on'));
      click(doc.getElementById('mute')!); await wait(20);
      assert.match(doc.getElementById('chat')!.textContent!, /I'm back\./); assert.ok(!doc.getElementById('mute')!.classList.contains('on'));

      // a 2-minute ride earns no sign-off: END shuts down straight away
      skew += 2 * 60_000;
      endRide(); await wait(100);
      assert.ok(ended()); assert.ok(screen('home'), 'a ride too short to remember goes back home');
      assert.ok(!/ride_debrief/.test(logText()));
      assert.equal(talkBtn.hidden, true, 'talk button goes with the ride');

      // a 5-minute ride: she signs off, and the ride is not torn down until she has finished speaking
      click(startBtn); await wait(150);
      const aloud = [...doc.querySelectorAll('#sim input[type=checkbox]')].find((c) => c.parentElement?.textContent?.includes('Speak aloud')) as HTMLInputElement;
      aloud.checked = false; aloud.dispatchEvent(new page.window.Event('change')); // silent mode: speech takes real time
      skew += 5 * 60_000;
      endRide(); await wait(400);
      assert.match(endText.textContent!, /^Ending/, 'still ending while she speaks');
      assert.equal(doc.getElementById('rideheadline')!.textContent, 'Good ride.', 'the ride screen shows the sign-off');
      assert.match(doc.getElementById('ridesub')!.textContent!, /Ride done: 5 minutes/);
      assert.match(logText(), /ride_debrief \(fallback: no API key.*Ride done: 5 minutes and 0 kilometres\. Good one\. \[speaking now\]/);
      assert.match(doc.getElementById('sim')!.textContent!, /SIMULATOR/, 'nothing torn down yet');
      await wait(3300); // silent mode simulates about 3 s for this nine-word line
      assert.ok(ended());
      assert.ok(screen('story'), 'a remembered ride opens its story');
      assert.match(doc.getElementById('story')!.textContent!, /5 min/); assert.match(doc.getElementById('story')!.textContent!, /Ride done: 5 minutes/);
      assert.match(logText(), /Good one\. \[spoken\]/, 'she finished before the ride was torn down');
      assert.match(page.window.localStorage.getItem('betty.log.v1')!, /ride_debrief/, 'the sign-off is in the saved log');
      assert.match(page.window.localStorage.getItem('betty.log.v1')!, /\[sensors\].*simulated session; GPS altitude none.*ride so far: deepest lean 0 deg, 0 stops/, 'a sensor summary is logged at END RIDE');

      // a second tap during the sign-off ends the ride at once
      click(startBtn); await wait(150);
      const aloud2 = [...doc.querySelectorAll('#sim input[type=checkbox]')].find((c) => c.parentElement?.textContent?.includes('Speak aloud')) as HTMLInputElement;
      aloud2.checked = false; aloud2.dispatchEvent(new page.window.Event('change'));
      skew += 5 * 60_000;
      endRide(); await wait(300);
      assert.match(endText.textContent!, /^Ending/);
      click(endBtn); await wait(300);
      assert.ok(ended(), 'second tap skips the wait');
      assert.equal(endText.textContent, 'End ride');
      assert.match(logText(), /Good one\. \[cleared\]/);
    } finally { globalThis.fetch = realFetch; Date.now = realNow; }
  }

  // ---- the Workshop chat with no ride running: a desk session starts behind it, and is never a ride
  {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    try {
      const shownNow = () => [...doc.querySelectorAll<HTMLElement>('[data-screen]')].filter((x) => !x.hidden).map((x) => x.dataset.screen);
      const before = shownNow();
      const ridesBefore = page.window.localStorage.getItem('betty.rides.v1');
      const startupsBefore = (page.window.localStorage.getItem('betty.log.v1')!.match(/\] startup/g) ?? []).length;
      assert.match(doc.getElementById('chat')!.textContent!, /No ride running: sending a message starts a desk chat session/);
      const chatIn = doc.getElementById('chatinput') as HTMLInputElement;
      chatIn.value = 'what is the weather like?';
      doc.querySelector('#chat form')!.dispatchEvent(new page.window.Event('submit', { cancelable: true }));
      await wait(200);
      assert.match(doc.getElementById('chat')!.textContent!, /Desk chat session running/);
      assert.match(doc.getElementById('chat')!.textContent!, /what is the weather like\?/);
      assert.match(doc.getElementById('chat')!.textContent!, /rider_query/, 'she answered through the real pipeline');
      assert.deepEqual(shownNow(), before, 'no jump to the ride screen');
      const endDesk = [...doc.querySelectorAll('#chat button')].find((b) => b.textContent === 'End desk chat') as HTMLElement;
      endDesk.dispatchEvent(new page.window.Event('click', { bubbles: true }));
      await wait(150);
      assert.match(doc.getElementById('chat')!.textContent!, /No ride running/);
      assert.equal((page.window.localStorage.getItem('betty.log.v1')!.match(/\] startup/g) ?? []).length, startupsBefore, 'no briefing for a desk chat');
      assert.equal(page.window.localStorage.getItem('betty.rides.v1'), ridesBefore, 'a desk chat is not saved as a ride');
    } finally { globalThis.fetch = realFetch; }
  }

  for (const id of ['start', 'end', 'endconfirm', 'lock', 'chat', 'voicetestpanel', 'voice', 'voicetest', 'cloudvoice', 'cloudname', 'cloudtest', 'cloudsounds', 'cloudaccent', 'chirpstandin', 'geminimodel', 'chirplocale', 'filled', 'range', 'rangesrc', 'logpanel', 'memorypanel', 'whatsnewopen', 'whatsnewbadge', 'garagebadge', 'whatsnewlist', 'exportdata', 'importdata', 'minititle', 'glanceaction', 'glancedots', 'glanceprogress', 'islandcompact', 'islandtap', 'islandbrowse', 'islandactions', 'islandprogress', 'upaheadlist', 'knowme', 'knowprofile', 'knowdistil', 'routeform', 'routeinput', 'routethrilling', 'routeplan', 'routesummary', 'alt', 'dir', 'dirsrc', 'jolts', 'real', 'status', 'wake', 'log', 'sim', 'speed', 'lean', 'rpm', 'temp', 'fuel', 'rain', 'feeds']) {
    assert.ok(doc.getElementById(id), `#${id} exists`);
  }
  // cloud voice: mode and voice name are saved, and the name list is offered
  const cv = doc.getElementById('cloudvoice') as HTMLSelectElement; const cn = doc.getElementById('cloudname') as HTMLSelectElement;
  assert.equal(cv.value, 'stream'); assert.ok(cn.options.length >= 30); assert.equal(cn.value, 'Aoede');
  cn.value = 'Sulafat'; cn.dispatchEvent(new page.window.Event('change'));
  const ca = doc.getElementById('cloudaccent') as HTMLSelectElement;
  ca.value = 'Southern US'; ca.dispatchEvent(new page.window.Event('change'));
  assert.ok([...cn.options].every((o) => o.value.startsWith('en-us-')), 'only Southern US library voices listed'); assert.match(CONFIG.cloudVoiceName, /^en-us-/);
  cn.value = 'en-us-veda'; cn.dispatchEvent(new page.window.Event('change')); assert.equal(CONFIG.cloudVoiceName, 'en-us-veda');
  ca.value = 'standard'; ca.dispatchEvent(new page.window.Event('change'));
  cn.value = 'Sulafat'; cn.dispatchEvent(new page.window.Event('change'));
  cv.value = 'off'; cv.dispatchEvent(new page.window.Event('change'));
  assert.equal(CONFIG.cloudVoiceName, 'Sulafat'); assert.equal(CONFIG.cloudVoice, 'off'); assert.equal(cn.disabled, true);
  // the home panel slims and comes back with a tap on its handle, and remembers it
  const homeScreen = doc.querySelector('[data-screen="home"]')!;
  const handle = doc.querySelector('[data-screen="home"] .dock-handle') as HTMLElement;
  const slimBefore = homeScreen.classList.contains('dock-slim');
  handle.dispatchEvent(new page.window.Event('click', { bubbles: true }));
  assert.equal(homeScreen.classList.contains('dock-slim'), !slimBefore);
  assert.equal(JSON.parse(page.window.localStorage.getItem('betty.dock.v1')!).home, !slimBefore);
  handle.dispatchEvent(new page.window.Event('click', { bubbles: true }));
  assert.equal(homeScreen.classList.contains('dock-slim'), slimBefore);
  assert.match(doc.getElementById('whatsnewversion')!.textContent!, /Development build/);
  assert.match(doc.getElementById('whatsnewlist')!.textContent!, /mark this spot/);
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

  { // the voice chosen on the main screen is used when the phone has it, otherwise en-ZA
    const { synth, sp } = rig();
    const voices = [{ voiceURI: 'com.apple.voice.premium.en-GB.Serena', name: 'Serena (Premium)', lang: 'en-GB' }];
    (synth as any).getVoices = () => voices;
    sp.speak('default voice', () => {});
    assert.equal((synth.spoken[0] as any).lang, 'en-ZA'); assert.equal((synth.spoken[0] as any).voice, undefined);
    CONFIG.voiceURI = voices[0].voiceURI;
    sp.speak('picked voice', () => {});
    assert.equal((synth.spoken[1] as any).voice, voices[0]); assert.equal((synth.spoken[1] as any).lang, 'en-GB');
    CONFIG.voiceURI = 'a.voice.that.was.deleted';
    sp.speak('missing voice', () => {});
    assert.equal((synth.spoken[2] as any).lang, 'en-ZA', 'falls back if the chosen voice is gone');
    sp.stop(); resetConfig();
  }
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

// ---- CHAT panel
{
  const { mountChatPanel } = await import('../src/ui/ChatPanel');
  const host = document.createElement('div'); document.body.append(host);
  const asked: string[] = []; let push: (e: any) => void = () => {};
  const unmount = mountChatPanel(host, { ask: (t) => asked.push(t), listen: (fn) => { push = fn; return () => { push = () => {}; }; } });
  // (by element, not #chatinput: the real page's Workshop chat is always mounted and has that id too)
  const input = host.querySelector('form input') as HTMLInputElement; const form = host.querySelector('form')!;
  input.value = '   '; form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.deepEqual(asked, [], 'blank message not sent');
  input.value = 'is it going to rain?'; form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.deepEqual(asked, ['is it going to rain?']); assert.equal(input.value, '', 'box clears after sending');
  push({ from: 'rider', text: 'is it going to rain?', at: Date.now() });
  const request = { system: 'SYSTEM PROMPT HERE', messages: [{ role: 'user', content: 'Situation: He just said to you: "is it going to rain?"' }] };
  push({ from: 'betty', text: 'Seventy percent in the next hour.', at: Date.now(),
    ev: { id: 'rider_query', priority: 4, context: 'x', fallback: 'No signal, sorry.', createdAt: 0 },
    phrase: { text: 'Seventy percent in the next hour.', source: 'claude', detail: '', latencyMs: 912, request } });
  const bubbles = [...host.querySelectorAll('.bubble')];
  assert.equal(bubbles.length, 2); assert.ok(bubbles[0].classList.contains('rider')); assert.ok(bubbles[1].classList.contains('betty'));
  assert.match(bubbles[1].querySelector('.meta')!.textContent!, /^claude · 912 ms · P4 · rider_query/);
  const pre = bubbles[1].querySelector('pre') as HTMLElement;
  assert.equal(pre.hidden, true);
  const show = [...bubbles[1].querySelectorAll('button')].find((b) => b.textContent === 'Show prompt')!;
  show.click();
  assert.equal(pre.hidden, false); assert.match(pre.textContent!, /--- system ---\nSYSTEM PROMPT HERE/); assert.match(pre.textContent!, /--- to Claude ---\nSituation: He just said/);
  assert.equal(show.textContent, 'Hide prompt');
  const cmp = [...host.querySelectorAll('input[type=checkbox]')].find((c) => c.parentElement?.textContent?.includes('canned fallback')) as HTMLInputElement;
  assert.ok(!host.querySelector('.chatlist')!.classList.contains('compare'));
  cmp.checked = true; fire(cmp, 'change');
  assert.ok(host.querySelector('.chatlist')!.classList.contains('compare')); assert.match(bubbles[1].textContent!, /Fallback: No signal, sorry\./);
  unmount(); assert.equal(host.innerHTML, '');
}

// ---- VOICE TEST panel, with stand-ins for the phone's media pieces
{
  const { mountVoiceTestPanel, quietWav, toDb } = await import('../src/ui/VoiceTestPanel');
  const wav = new Uint8Array(await quietWav(1, 8000).arrayBuffer());
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF'); assert.equal(wav.length, 44 + 16000);
  assert.equal(toDb(1), 0); assert.equal(toDb(0.1), -20); assert.equal(toDb(0), -Infinity);

  const handlers = new Map<string, any>(); const logs: string[] = []; let played = 0;
  let micAllowed = true; let speed: number | null = 62;
  const track = { label: 'Cardo Packtalk', stop() {} };
  const deps = {
    mediaSession: { setActionHandler: (a: string, f: any) => { if (a === 'seekforward') throw new Error('unsupported'); if (f) handlers.set(a, f); else handlers.delete(a); }, metadata: null } as any,
    getUserMedia: async (c: any) => { constraints.push(c); if (!micAllowed) { const err = new Error('denied'); err.name = 'NotAllowedError'; throw err; } return { getAudioTracks: () => [track], getTracks: () => [track] } as any; },
    makeRecorder: () => { const r: any = { start() {}, stop() { r.ondataavailable({ data: new Blob(['x'.repeat(2048)]) }); r.onstop(); } }; return r; },
    recorderType: () => 'audio/mp4',
    makeAudio: () => ({ play: async () => { played++; }, pause() {}, paused: false, loop: false, src: '' }) as any,
    makeAudioContext: undefined,
    objectUrl: () => 'blob:test',
    listInputs: async () => [{ deviceId: 'phone', label: 'iPhone Microphone' }, { deviceId: 'helmet', label: 'Cardo Packtalk' }],
  };
  const constraints: any[] = [];
  const host = document.createElement('div'); document.body.append(host);
  const panel = mountVoiceTestPanel(host, { speed: () => speed, log: (m) => logs.push(m) }, deps);
  const btn = (t: RegExp) => [...host.querySelectorAll('button')].find((b) => t.test(b.textContent!))!;
  btn(/Start listening/).click(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(played, 1, 'the silent track starts so the page can receive buttons');
  assert.ok(handlers.has('nexttrack') && handlers.has('play') && !handlers.has('seekforward'));
  assert.match(logs.at(-1)!, /listening for headset buttons \(page accepts: play, pause, previous track, next track, skip back, stop\)/);
  handlers.get('nexttrack')(); handlers.get('nexttrack')(); handlers.get('play')();
  assert.match(host.textContent!, /Heard: next track x2, play x1/);
  assert.ok(logs.includes('[voice test] headset button reached the page: next track'));

  // test 2: a button press opens the mic
  const tick = [...host.querySelectorAll('input[type=checkbox]')].find((c) => c.parentElement?.textContent?.includes('open the mic')) as HTMLInputElement;
  tick.checked = true;
  const realTimeout = globalThis.setTimeout;
  (globalThis as any).setTimeout = (f: any) => realTimeout(f, 0); // recordings take no real time in the test
  try {
    handlers.get('pause')(); await new Promise((r) => realTimeout(r, 20));
    assert.match(logs.at(-1)!, /recording: .* · 62 km\/h · Cardo Packtalk · loudest not measured · opened by the pause button · audio\/mp4, 2 KB/);
    // test 3: recording from the screen, at a standstill without a ride, then a refusal
    speed = null;
    btn(/Record 5 seconds/).click(); await new Promise((r) => realTimeout(r, 20));
    assert.match(host.querySelector('.recs')!.textContent!, /no ride running · Cardo Packtalk/);
    assert.equal(host.querySelectorAll('.rec audio').length, 2);
    // pick the helmet mic explicitly
    // (by tag: jsdom's id lookup misses it here because the real page in this test also has a #micpick)
    const pick = host.querySelector('select') as HTMLSelectElement;
    assert.deepEqual([...pick.options].map((o) => o.textContent), ['Automatic (helmet if connected)', 'iPhone Microphone', 'Cardo Packtalk']);
    assert.equal(constraints.at(-1).audio, true, "phone's choice by default");
    pick.value = 'helmet';
    btn(/Record 5 seconds/).click(); await new Promise((r) => realTimeout(r, 20));
    assert.deepEqual(constraints.at(-1).audio, { deviceId: { exact: 'helmet' } }, 'records from the chosen mic');
    btn(/Find mics/).click(); await new Promise((r) => realTimeout(r, 0));
    assert.match(logs.at(-1)!, /microphones offered: iPhone Microphone, Cardo Packtalk/);
    micAllowed = false;
    btn(/Record 5 seconds/).click(); await new Promise((r) => realTimeout(r, 20));
    assert.match(logs.at(-1)!, /mic did not open \(tapped on screen\): NotAllowedError/);
  } finally { (globalThis as any).setTimeout = realTimeout; }
  btn(/Stop listening/).click();
  assert.equal(handlers.size, 0, 'buttons handed back when the test stops');
  btn(/Start listening/).click(); await new Promise((r) => setTimeout(r, 0));
  handlers.get('pause')();
  assert.match(host.textContent!, /Heard: pause x1/, 'a new session counts from zero');
  btn(/Stop listening/).click();
  assert.ok(panel);
}

// ---- push-to-talk recording, with stand-ins for the mic
{
  const { PushToTalk, transcribe, chooseMic } = await import('../src/adapters/PushToTalk');
  const mics = [{ deviceId: 'phone', label: 'iPhone Microphone' }, { deviceId: 'helmet', label: 'V6' }];
  assert.equal(chooseMic(mics, '', ''), 'helmet', 'automatic: the helmet when one is connected');
  assert.equal(chooseMic(mics, 'phone', ''), 'phone', 'his pick wins');
  assert.equal(chooseMic(mics, 'old-id', 'V6'), 'helmet', 'found again by name when the id changed');
  assert.equal(chooseMic([mics[0]], '', ''), '', 'no headset: the phone decides');
  const track = { label: 'V6', stopped: false, stop() { this.stopped = true; } };
  let levels: number[] = []; let asked: any = null; let opened = 0;
  const deps = {
    getUserMedia: async (c: any) => { asked = c; opened++; return { getAudioTracks: () => [track], getTracks: () => [track] } as any; },
    makeRecorder: () => { const r: any = { start() {}, stop() { r.ondataavailable({ data: new Blob(['a'.repeat(3000)]) }); r.onstop(); } }; return r; },
    recorderType: () => 'audio/mp4',
    meter: (_s: any, on: (l: number) => void) => { const t = setInterval(() => on(levels.shift() ?? 0.01), 1); return () => clearInterval(t); },
    listInputs: async () => mics,
  };
  let clock = 0; const now = () => (clock += 100);
  const ptt = new PushToTalk(deps, () => ({ id: '', label: '' }), 8000, now);
  levels = [0.3, 0.4, 0.5, 0.3, ...Array(20).fill(0.01)];
  const clip = await ptt.record();
  assert.deepEqual(asked, { audio: { deviceId: { exact: 'helmet' } } }, 'listens on the chosen mic');
  assert.equal(clip.heardSpeech, true); assert.equal(clip.mic, 'V6'); assert.equal(clip.audio.size, 3000); assert.equal(clip.audio.type, 'audio/mp4');
  assert.equal(track.stopped, true, 'mic closed straight after: an open mic keeps the helmet in call mode and its button stops reaching Betty');
  assert.equal(ptt.listening, false);
  // a second press ends it early
  levels = Array(1000).fill(0.5);
  const p2 = ptt.record();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ptt.listening, true); ptt.stop();
  assert.equal((await p2).heardSpeech, true);
  // nothing said
  levels = Array(100).fill(0.02);
  assert.equal((await ptt.record()).heardSpeech, false);
  assert.equal(opened, 3, 'a fresh mic for each question');
  // Cardo on Android records nothing with call processing on
  const rawPtt = new PushToTalk(deps, () => ({ id: '', label: '', raw: true }), 8000, now);
  levels = [0.3, ...Array(20).fill(0.01)];
  await rawPtt.record();
  assert.deepEqual(asked, { audio: { deviceId: { exact: 'helmet' } , echoCancellation: false, noiseSuppression: false, autoGainControl: false } }, 'no call processing when asked');

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: any, init: any) => new Response(JSON.stringify(init.headers['content-type'] === 'audio/mp4' ? { text: ' how far to empty? ' } : {}))) as typeof fetch;
  try { assert.equal(await transcribe(clip.audio), 'how far to empty?'); } finally { globalThis.fetch = realFetch; }
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "voice is not set up yet (server has no GROQ_API_KEY)" }), { status: 503 })) as typeof fetch;
  try { await assert.rejects(transcribe(clip.audio), /not set up/); } finally { globalThis.fetch = realFetch; }
}
{
  const { toneWav } = await import('../src/adapters/audio');
  assert.equal(toneWav(440, 140).size, 44 + 2240 * 2, 'a 140 ms tone at 16 kHz');
}
// ---- Betty's look: his own picture or GIF, circle-cropped, kept on the phone
{
  const { prepareAvatar, applyAvatar, mountAvatarSetting, MemoryAvatarStore, MAX_AVATAR_BYTES } = await import('../src/ui/avatar');
  const gif = new Blob(['GIF89a...'], { type: 'image/gif' });
  assert.equal(await prepareAvatar(gif, async () => { throw new Error('a GIF must not be resized'); }), gif, 'GIFs kept as they are, so they keep moving');
  await assert.rejects(prepareAvatar(new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)], { type: 'image/gif' })), /under 6 MB/);
  await assert.rejects(prepareAvatar(new Blob(['x'], { type: 'text/plain' })), /not a picture/);
  const small = new Blob(['jpg'], { type: 'image/jpeg' });
  let side = 0;
  assert.equal(await prepareAvatar(new Blob(['big photo'], { type: 'image/jpeg' }), async (_b, s) => { side = s; return small; }), small, 'still photos are shrunk');
  assert.equal(side, 320);

  const av = new JSDOM(`<!doctype html><div class="orb resting"></div><label><input type="file" id="avatarfile" /></label><button id="avatarreset" hidden></button>`);
  const d = av.window.document;
  (globalThis as any).URL.revokeObjectURL ??= () => {};
  applyAvatar(d, gif, () => 'blob:one');
  assert.ok(d.documentElement.classList.contains('has-avatar')); assert.equal(d.documentElement.style.getPropertyValue('--orb-image'), 'url("blob:one")');
  applyAvatar(d, null);
  assert.ok(!d.documentElement.classList.contains('has-avatar')); assert.equal(d.documentElement.style.getPropertyValue('--orb-image'), '');

  const store = new MemoryAvatarStore(); const toasts: string[] = [];
  const realCreate = URL.createObjectURL; (URL as any).createObjectURL = () => 'blob:test';
  try {
    mountAvatarSetting(d, store, (m) => toasts.push(m));
    const input = d.getElementById('avatarfile') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [gif], configurable: true });
    input.dispatchEvent(new av.window.Event('change'));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.blob, gif, 'kept'); assert.ok(d.documentElement.classList.contains('has-avatar'));
    assert.equal((d.getElementById('avatarreset') as HTMLButtonElement).hidden, false); assert.match(toasts.at(-1)!, /GIF keeps moving/);
    (d.getElementById('avatarreset') as HTMLButtonElement).dispatchEvent(new av.window.Event('click'));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.blob, null); assert.ok(!d.documentElement.classList.contains('has-avatar')); assert.match(toasts.at(-1)!, /usual self/);
  } finally { (URL as any).createObjectURL = realCreate; }
  // the styles keep the companion's movement for a picture: same breathing, round, eyes hidden
  const css = (await import('node:fs')).readFileSync(new URL('../src/ui/styles/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.has-avatar \.orb, \.has-avatar \.orb\.speaking, \.has-avatar \.orb\.quiet \{ animation-name: breathe-round; \}/);
  assert.match(css, /@keyframes breathe-round/);
}
// ---- moving phones: everything Betty keeps, out to one file and back in
{
  const { makeBackup, parseBackup, restoreBackup, describeBackup } = await import('../src/ui/backup');
  const { MemoryAvatarStore } = await import('../src/ui/avatar');
  const fakeStorage = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(), m } as any;
  };
  const oldPhone = fakeStorage({ 'betty.rides.v1': JSON.stringify([{}, {}]), 'betty.memory.v1': JSON.stringify({ notes: [{}], marks: [{}, {}] }), 'betty.config.v1': '{"riderName":"Nhlanhla"}', 'other.app': 'not ours' });
  const pic = new MemoryAvatarStore(); await pic.put(new Blob(['GIF89a'], { type: 'image/gif' }));
  const b = await makeBackup(oldPhone, pic, new Date('2026-10-17T10:00:00Z'));
  assert.deepEqual(Object.keys(b.storage).sort(), ['betty.config.v1', 'betty.memory.v1', 'betty.rides.v1'], 'only Betty\'s own entries');
  const text = JSON.stringify(b);
  const parsed = parseBackup(text);
  assert.equal(describeBackup(parsed), '2 rides, 0 lines, 1 notes, 2 marked spots, her picture, from 2026-10-17');
  const newPhone = fakeStorage({ 'betty.log.v1': '[1]', 'other.app': 'keep me' }); const newPic = new MemoryAvatarStore();
  await restoreBackup(parsed, newPhone, newPic);
  assert.equal(newPhone.getItem('betty.config.v1'), '{"riderName":"Nhlanhla"}'); assert.equal(newPhone.getItem('betty.log.v1'), null, 'replaced, not merged');
  assert.equal(newPhone.getItem('other.app'), 'keep me', 'other sites\' data untouched');
  assert.equal(await newPic.blob!.text(), 'GIF89a'); assert.equal(newPic.blob!.type, 'image/gif');
  assert.throws(() => parseBackup('{"hello":1}'), /not a Betty backup/); assert.throws(() => parseBackup('nope'), /not a Betty backup/);
  assert.throws(() => parseBackup(JSON.stringify({ ...b, storage: { 'evil.key': 'x' } })), /damaged/);
}
// ---- Garage > What's new: unread count on the card and the tab, cleared by opening it
{
  const { unreadCount, totalItems, mountWhatsNew } = await import('../src/ui/WhatsNew');
  const log = [{ date: 'b', items: ['new one', 'new two'] }, { date: 'a', items: ['old'] }];
  assert.equal(unreadCount(log, null), 2, 'first visit: only the newest day counts'); assert.equal(unreadCount(log, 1), 2); assert.equal(unreadCount(log, 3), 0);
  const w = new JSDOM(`<!doctype html><button id="whatsnewopen"></button><small id="whatsnewsub"></small><b id="whatsnewbadge"></b><b id="garagebadge"></b><p id="whatsnewversion"></p><div id="whatsnewlist"></div>`);
  const d = w.window.document; let seen: number | null = 1;
  mountWhatsNew(d, { get: () => seen, set: (n) => { seen = n; } }, log, null);
  assert.equal(d.getElementById('garagebadge')!.textContent, '2'); assert.equal((d.getElementById('garagebadge') as HTMLElement).hidden, false);
  assert.match(d.getElementById('whatsnewsub')!.textContent!, /2 new updates/);
  assert.equal(d.querySelectorAll('#whatsnewlist li.new').length, 2, 'the new ones are marked');
  d.getElementById('whatsnewopen')!.dispatchEvent(new w.window.Event('click'));
  assert.equal(seen, totalItems(log)); assert.equal((d.getElementById('whatsnewbadge') as HTMLElement).hidden, true); assert.match(d.getElementById('whatsnewsub')!.textContent!, /Up to date/);
}
// ---- traffic: every 5 minutes, and not while parked
{
  const { TrafficSource } = await import('../src/adapters/TrafficSource');
  CONFIG.feeds.pollTrafficMs = 300_000;
  let calls = 0; let moving = false;
  const src = new TrafficSource({ fetchIncidents: async () => { calls++; return []; } }, () => ({ lat: -26.15, lon: 28.15 }), () => {}, () => moving);
  await (src as any).tick(true); assert.equal(calls, 1, 'one look at the start');
  (src as any).lastAt = 0; await (src as any).tick(false); assert.equal(calls, 1, 'parked: no poll even when due');
  moving = true; await (src as any).tick(false); assert.equal(calls, 2, 'moving and due: poll');
  await (src as any).tick(false); assert.equal(calls, 2, 'not due again for 5 minutes');
  resetConfig();
}
// ---- a ride's story: riding and stopped time (ride of 2026-10-17: 80 minutes parked made a 3 h 39 ride)
{
  const { mountJourneysScreen } = await import('../src/ui/screens/JourneysScreen');
  const { CONFIG } = await import('../src/config/betty');
  const j = new JSDOM(`<!doctype html><div id="journeylist"></div><div id="journeytotals"></div><div id="story"></div>`);
  const d = j.window.document;
  const ride = { startedAt: Date.now(), minutes: 219, movingMin: 139, distanceKm: 93.4, fuelL: 4.1, costR: 124, weather: null, places: [], events: [] };
  const view = mountJourneysScreen(d, { show() {}, onShow() {} } as any, { rides: () => [ride], entries: () => [], track: () => [], copyRide: async () => true, saveRide() {}, toast() {}, shareRide: async () => {} });
  view.open(ride.startedAt);
  const story = d.getElementById('story')!.textContent!;
  assert.match(story, /139\s*Minutes riding/); assert.match(story, /2h 19m riding/); assert.match(story, /1h 20m stopped/);
  assert.match(story, /93\.4 km and 2h 19m riding/);
  assert.match(story, /R124\s*Fuel, 4\.1 L/, 'what the ride cost');
  assert.match(d.getElementById('journeytotals')!.textContent!, /R124 on fuel this month over 1 ride · about R1\.33 a km/);
  assert.match((d.querySelector('.time-split .bar i') as HTMLElement).style.width, /^63%/);
  CONFIG.ridingTimeOnly = false; view.open(ride.startedAt);
  assert.match(d.getElementById('story')!.textContent!, /219\s*Minutes/, 'switched off: the whole time'); assert.ok(d.querySelector('.time-split'), 'the split still shows');
  CONFIG.ridingTimeOnly = true;
}

// ---- a ride's story: Share this ride hands over the ride and the "hide where I start and finish" choice
{
  const { mountJourneysScreen } = await import('../src/ui/screens/JourneysScreen');
  const j = new JSDOM(`<!doctype html><div id="journeylist"></div><div id="journeytotals"></div><div id="story"></div>`);
  const d = j.window.document;
  const ride = { startedAt: 1_760_000_000_000, minutes: 95, distanceKm: 120, weather: 'clear, 24 C', places: ['Germiston'], events: [] };
  const shared: Array<[number, boolean]> = [];
  const shell: any = { show() {}, onShow() {} };
  let release = () => {};
  let extras: any = null;
  let fetched = () => {};
  const view = mountJourneysScreen(d, shell, { rides: () => [ride], entries: () => [], track: () => [[-26.1, 28.0], [-26.1, 28.2]], copyRide: async () => true, saveRide() {}, toast() {},
    mapExtras: () => extras, prepareCard: () => new Promise((r) => { fetched = () => r(null); }),
    shareRide: async (id: number, hide: boolean, status: (t: string) => void) => {
      shared.push([id, hide]); status('Making your ride card...');
      await new Promise<void>((r) => { release = r; });
    } });
  view.open(ride.startedAt);
  assert.ok(!d.querySelector('.time-split'), 'an older ride has no riding time: no split');
  assert.match(d.getElementById('story')!.textContent!, /95\s*Minutes/);
  const btn = d.querySelector('[data-share]') as HTMLButtonElement;
  assert.ok(btn, 'Share this ride is on the story'); assert.equal((d.querySelector('[data-hideends]') as HTMLInputElement).checked, true, 'home hidden by default');
  assert.ok(!d.querySelector('.story-map')!.innerHTML.includes('Sandton'), 'no names until fetched');
  extras = { labels: [{ lat: -26.1, lon: 28.1, label: 'Sandton' }], metro: [[[-26.2, 28.1], [-26.0, 28.1]]] };
  fetched(); await new Promise((r) => setTimeout(r, 5));
  assert.match(d.querySelector('.story-map')!.innerHTML, />Sandton</, 'the story map fills in the names once fetched');
  assert.match(d.querySelector('.story-map')!.innerHTML, /stroke-dasharray="7 6"/, 'and the metro line');
  const label = btn.innerHTML;
  btn.dispatchEvent(new j.window.Event('click', { bubbles: true }));
  assert.equal(btn.disabled, true, 'disabled while making the card'); assert.equal(btn.textContent, 'Making your ride card...', 'the step shows on the button');
  btn.dispatchEvent(new j.window.Event('click', { bubbles: true }));
  assert.equal(shared.length, 1, 'a second tap does nothing while busy');
  release(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(btn.disabled, false); assert.equal(btn.innerHTML, label, 'its label comes back');
  (d.querySelector('[data-hideends]') as HTMLInputElement).checked = false;
  btn.dispatchEvent(new j.window.Event('click', { bubbles: true }));
  release(); await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(shared, [[ride.startedAt, true], [ride.startedAt, false]]);
}
// ---- a long ride's story: lists fold to a few items with Show all / Show less
{
  const { mountJourneysScreen } = await import('../src/ui/screens/JourneysScreen');
  const j = new JSDOM(`<!doctype html><div id="journeylist"></div><div id="journeytotals"></div><div id="story"></div>`);
  const d = j.window.document;
  const ride = { startedAt: 1_760_000_000_000, minutes: 219, distanceKm: 93, weather: null, places: ['A', 'B', 'C', 'D', 'E', 'F'], events: ['x'] };
  const entries = Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, at: ride.startedAt + i * 60_000, rideId: ride.startedAt, head: '[P3] area_story (claude)', text: `line ${i}` }));
  const view = mountJourneysScreen(d, { show() {}, onShow() {} } as any, { rides: () => [ride], entries: () => entries as any, track: () => [], copyRide: async () => true, saveRide() {}, toast() {}, shareRide: async () => {} });
  view.open(ride.startedAt);
  const lists = [...d.querySelectorAll('.moments')];
  assert.equal(lists.length, 2); assert.ok(lists.every((l) => l.classList.contains('folded')), 'both long lists start folded');
  assert.equal(lists[1].querySelectorAll('li:not(.more)').length, 5, 'five lines show'); assert.equal(lists[1].querySelectorAll('li.more').length, 25);
  const btns = [...d.querySelectorAll<HTMLButtonElement>('[data-fold]')];
  assert.equal(btns[1].textContent, 'Show all 30 things she said');
  btns[1].dispatchEvent(new j.window.Event('click', { bubbles: true }));
  assert.ok(!lists[1].classList.contains('folded')); assert.equal(btns[1].textContent, 'Show less'); assert.equal(btns[1].getAttribute('aria-expanded'), 'true');
  assert.ok(lists[0].classList.contains('folded'), 'the other list stays as it was');
  btns[1].dispatchEvent(new j.window.Event('click', { bubbles: true }));
  assert.equal(btns[1].textContent, 'Show all 30 things she said');
  const short = { ...ride, startedAt: 2, places: ['A'], events: [] };
  const v2 = mountJourneysScreen(d, { show() {}, onShow() {} } as any, { rides: () => [short], entries: () => [], track: () => [], copyRide: async () => true, saveRide() {}, toast() {}, shareRide: async () => {} });
  v2.open(2); assert.equal(d.querySelectorAll('[data-fold]').length, 0, 'short lists are not folded');
}
// ---- Explore: area cards, open/close, search, not heard yet, Listen (marks told when heard to the end)
{
  const { mountExploreScreen } = await import('../src/ui/screens/ExploreScreen');
  const j = new JSDOM(`<!doctype html><input id="exploresearch" /><div id="exploretabs"></div><div id="explorelist"></div>`);
  const d = j.window.document; const ev = (el: Element, type = 'click') => el.dispatchEvent(new j.window.Event(type, { bubbles: true }));
  const notes = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, area: 'Randburg', topic: `Topic ${i}`, text: i === 6 ? 'named after the rand currency' : `story ${i}` }));
  const told = new Set<string>(['r0']);
  const listens: Array<{ id: string; end: (h: boolean) => void; stopped: boolean }> = [];
  mountExploreScreen(d, { show() {}, onShow() {} } as any, {
    load: () => ({ notes: [{ at: 5, text: 'chain lube at 600 km' }], marks: [] }), save() {},
    stories: () => [{ key: 'Randburg|G', at: 2, notes }, { key: 'Soweto|G', at: 1, notes: [{ id: 'so1', area: 'Soweto', topic: 'Name', text: 'South Western Townships' }] }],
    told: () => told,
    listen: (note, end) => { const l = { id: note.id, end, stopped: false }; listens.push(l); return () => { l.stopped = true; end(false); }; },
  });
  const list = d.getElementById('explorelist')!;
  const cards = () => [...list.querySelectorAll<HTMLElement>('.area-card')];
  assert.deepEqual(cards().map((c) => c.dataset.area), ['Randburg', 'Soweto'], 'one card per area, newest first');
  assert.match(cards()[0].textContent!, /8 stories · 7 not heard yet/); assert.ok(!list.querySelector('.stories'), 'cards start closed');
  assert.match(list.textContent!, /chain lube/, 'notes still listed');
  ev(list.querySelector('[data-areaopen="Randburg"]')!);
  const lis = () => [...list.querySelectorAll('.stories li')];
  assert.equal(lis().filter((l) => !l.classList.contains('more')).length, 3, 'three stories, then Show all');
  assert.equal(lis()[7].classList.contains('heard'), true, 'heard ones last');
  ev(list.querySelector('[data-fold]')!);
  assert.equal(list.querySelector('[data-fold] span')!.textContent, 'Show less');
  ev(list.querySelector('[data-listen="r1"]')!);
  assert.equal(listens[0].id, 'r1'); assert.ok(list.querySelector('[data-listen="r1"]')!.classList.contains('on'), 'playing shows Stop');
  assert.ok(!list.querySelector('.stories')!.classList.contains('folded'), 'the opened list stays open while it plays');
  ev(list.querySelector('[data-listen="r2"]')!);
  assert.ok(listens[0].stopped, 'another story stops the first'); assert.equal(listens[1].id, 'r2');
  told.add('r2'); listens[1].end(true);
  assert.ok(!list.querySelector('.listen.on')); assert.match(cards()[0].textContent!, /6 not heard yet/, 'heard to the end counts');
  ev(list.querySelector('[data-listen="r3"]')!); ev(list.querySelector('[data-listen="r3"]')!);
  assert.ok(listens[2].stopped, 'tapping it again stops it');
  const search = d.getElementById('exploresearch') as HTMLInputElement;
  search.value = 'rand currency'; ev(search, 'input');
  assert.deepEqual(cards().map((c) => c.dataset.area), ['Randburg']); assert.equal(lis().length, 1, 'only the matching story, card opened');
  assert.ok(!/chain lube/.test(list.textContent!));
  search.value = 'clarens'; ev(search, 'input'); assert.match(list.textContent!, /Nothing matches/);
  search.value = ''; ev(search, 'input');
  ev(d.querySelector('[data-tab="unheard"]')!);
  assert.ok(!/chain lube/.test(list.textContent!), 'not heard yet: stories only');
  assert.ok(!lis().some((l) => l.classList.contains('heard')), 'and none already heard');
}
// ---- Explore: story of the day on top (Listen, More from), the tally, New tags
{
  const { mountExploreScreen } = await import('../src/ui/screens/ExploreScreen');
  const j = new JSDOM(`<!doctype html><input id="exploresearch" /><p id="explorestats" hidden></p><div id="exploretabs"></div><div id="explorelist"></div>`);
  const d = j.window.document; const ev = (el: Element, type = 'click') => el.dispatchEvent(new j.window.Event(type, { bubbles: true }));
  const told = new Set<string>();
  const now = new Date(2026, 9, 17, 9).getTime();
  const listens: string[] = [];
  mountExploreScreen(d, { show() {}, onShow() {} } as any, {
    load: () => ({ notes: [], marks: [{ at: 1, lat: 0, lon: 0, note: 'x', near: null }] }), save() {}, told: () => told, now: () => now,
    stories: () => [{ key: 'Soweto|G', at: now - 86_400_000, notes: [{ id: 'so1', area: 'Soweto', topic: 'Name', text: 'South Western Townships' }] },
      { key: 'Old|G', at: now - 30 * 86_400_000, notes: [{ id: 'o1', area: 'Old', topic: 'T', text: 'old story' }] }],
    listen: (note, end) => { listens.push(note.id); told.add(note.id); end(true); return () => {}; },
  });
  const list = d.getElementById('explorelist')!;
  const dayCard = () => list.querySelector('.day-card');
  assert.ok(dayCard(), 'story of the day on top'); const id = dayCard()!.querySelector<HTMLElement>('[data-listen]')!.dataset.listen!;
  assert.match(d.getElementById('explorestats')!.textContent!, /2 areas · 0 of 2 stories heard · 1 spot · 1 new this week/);
  assert.equal(list.querySelectorAll('.new').length, 1, 'New on the area found this week only');
  ev(dayCard()!.querySelector('[data-listen]')!);
  assert.deepEqual(listens, [id]); assert.equal(dayCard()!.querySelector<HTMLElement>('[data-listen]')!.dataset.listen, id, 'heard: the same story stays for the day');
  assert.match(dayCard()!.textContent!, /Hear it again/); assert.match(d.getElementById('explorestats')!.textContent!, /1 of 2 stories heard/);
  const area = dayCard()!.querySelector<HTMLElement>('[data-more]')!.dataset.more!;
  ev(dayCard()!.querySelector('[data-more]')!);
  assert.ok([...list.querySelectorAll<HTMLElement>('.area-card')].find((c) => c.dataset.area === area)!.classList.contains('open'), 'More from opens that area');
  const s = d.getElementById('exploresearch') as HTMLInputElement; s.value = 'old'; ev(s, 'input');
  assert.ok(!dayCard(), 'not while searching');
}
// ---- Explore's map: dots for areas and spots, tap one for its sheet, Ride there, areas without a place get located
{
  const { mountExploreScreen } = await import('../src/ui/screens/ExploreScreen');
  const { projector } = await import('../src/ui/mapView');
  const j = new JSDOM(`<!doctype html><input id="exploresearch" /><button id="exploremode"><span>Map</span></button><div id="exploretabs"></div>
    <div id="exploremap" hidden><div id="exploreart"></div><button id="explorefit"></button><p id="explorehint"></p></div><div id="explorelist"></div><div id="explorepinbody"></div>`);
  const d = j.window.document; const ev = (el: Element, type = 'click') => el.dispatchEvent(new j.window.Event(type, { bubbles: true }));
  const opened: string[] = []; const rides: string[] = []; const located: string[][] = [];
  const kept = [
    { key: 'Sandton|G', at: 3, lat: -26.1, lon: 28.05, notes: [{ id: 's1', area: 'Sandton', topic: 'Horses', text: '15,000 horses' }] },
    { key: 'Soweto|G', at: 2, lat: -26.25, lon: 27.86, notes: [{ id: 'w1', area: 'Soweto', topic: 'Name', text: 'South Western Townships' }] },
    { key: 'Lenasia|G', at: 1, notes: [{ id: 'l1', area: 'Lenasia', topic: 'Name', text: 'Lenz and Asia' }] },
  ];
  const shell: any = { show() {}, onShow() {}, openSheet: (id: string) => opened.push(id), closeSheet() {} };
  mountExploreScreen(d, shell, {
    load: () => ({ notes: [], marks: [{ at: 1, lat: -26.2, lon: 28.0, note: 'pothole', near: 'Edenvale' }] }), save() {},
    stories: () => kept, told: () => new Set(['w1']), listen: () => () => {},
    locate: (a) => located.push(a.map((x) => x.name)), rideThere: (p) => rides.push(p),
  });
  ev(d.getElementById('exploremode')!);
  assert.equal(d.getElementById('exploremap')!.hidden, false); assert.equal(d.getElementById('explorelist')!.hidden, true, 'map instead of the list');
  assert.equal(d.getElementById('exploremode')!.textContent, 'List', 'the button now goes back to the list');
  const svg = d.getElementById('exploreart')!.innerHTML;
  assert.match(svg, />Sandton</); assert.match(svg, />Soweto</); assert.ok(!svg.includes('Lenasia'), 'no place yet: no dot');
  assert.match(svg, /fill="#f4dc7b"/, 'yellow for unheard'); assert.match(svg, /fill="#cfdcc6"/, 'sage when all heard');
  assert.deepEqual(located, [['Lenasia']], 'areas without a place are looked up once');
  assert.match(d.getElementById('explorehint')!.textContent!, /Finding 1 more area/);
  // Tap Sandton's dot: jsdom boxes are 0 x 0, so a map unit is a pixel and the map's middle is at (0, 0).
  const { fitView } = await import('../src/core/Explore');
  const v = fitView([{ lat: -26.1, lon: 28.05 }, { lat: -26.25, lon: 27.86 }, { lat: -26.2, lon: 28.0 }]);
  const at = projector(v.center, v.spanKm)({ lat: -26.1, lon: 28.05 });
  d.getElementById('exploremap')!.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true, clientX: at.x - 330, clientY: at.y - 250 }));
  assert.deepEqual(opened, ['explorepin']); assert.match(d.getElementById('explorepinbody')!.textContent!, /Sandton.*15,000 horses/s, 'the sheet shows its stories');
  ev(d.querySelector('#explorepinbody [data-ridethere]')!);
  assert.deepEqual(rides, ['Sandton'], 'Ride there plans to the area');
  const far = projector(v.center, v.spanKm)({ lat: -25.0, lon: 29.0 });
  d.getElementById('exploremap')!.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true, clientX: far.x - 330, clientY: far.y - 250 }));
  assert.equal(opened.length, 1, 'a tap on nothing opens nothing');
  const spot = projector(v.center, v.spanKm)({ lat: -26.2, lon: 28.0 });
  d.getElementById('exploremap')!.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true, clientX: spot.x - 330, clientY: spot.y - 250 }));
  assert.match(d.getElementById('explorepinbody')!.textContent!, /pothole/, 'a spot opens too');
  ev(d.querySelector('[data-tab="notes"]')!);
  assert.equal(d.getElementById('exploremap')!.hidden, true, 'notes have no place: the list shows');
}
// ---- Where to? plans through Betty's server, keeps the route, clears it
{
  const { mountRoutePlanner, routeRequest, RouteStore } = await import('../src/ui/RoutePlanner');
  assert.deepEqual(routeRequest('Heidelberg, Villiers then Clarens', true, null), { stops: ['Heidelberg', 'Villiers', 'Clarens'], thrilling: true });
  assert.deepEqual(routeRequest(' https://maps.app.goo.gl/x ', false, { lat: 1, lon: 2 }), { link: 'https://maps.app.goo.gl/x', thrilling: false, from: { lat: 1, lon: 2 } });
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
  const w = new JSDOM(`<!doctype html><form id="routeform"><input id="routeinput" /><button id="routeplan" type="submit">Plan</button></form><input type="checkbox" id="routethrilling" />
    <div id="routesummary" hidden><b id="routename"></b><small id="routestats"></small><a id="routemaps"></a><button id="routeclear"></button></div>`);
  const d = w.window.document; const changes: any[] = []; const sent: any[] = [];
  const route = { name: 'Clarens', stops: [{ name: 'Heidelberg', named: true }, { name: 'Clarens', named: true }], km: 307.3, minutes: 199, delayMin: 0, legs: [], points: [[1, 2], [3, 4]], mapsUrl: 'https://maps', thrilling: true };
  mountRoutePlanner(d, { position: async () => ({ lat: -26.14, lon: 28.15 }), onChange: (r) => changes.push(r), toast() {},
    fetcher: (async (_u: any, init: any) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify(route)); }) as typeof fetch });
  (d.getElementById('routeinput') as HTMLInputElement).value = 'Heidelberg, Clarens'; (d.getElementById('routethrilling') as HTMLInputElement).checked = true;
  d.getElementById('routeform')!.dispatchEvent(new w.window.Event('submit', { cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sent[0], { stops: ['Heidelberg', 'Clarens'], thrilling: true, from: { lat: -26.14, lon: 28.15 } });
  assert.equal(RouteStore.get()!.name, 'Clarens'); assert.equal((d.getElementById('routesummary') as HTMLElement).hidden, false);
  assert.match(d.getElementById('routestats')!.textContent!, /307 km · about 3 h 19 · twisty roads · via Heidelberg/);
  d.getElementById('routeclear')!.dispatchEvent(new w.window.Event('click'));
  assert.equal(RouteStore.get(), null); assert.equal(changes.at(-1), null);
  delete (globalThis as any).localStorage;
}
// ---- Let Betty know me: paste, distil, read, save; switch it off; forget
{
  const { mountKnowMe, ProfileStore } = await import('../src/ui/KnowMe');
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
  const k = new JSDOM(`<!doctype html><input type="checkbox" id="knowme" /><small id="knowsub"></small><blockquote id="knowask"></blockquote><button id="knowcopy"></button>
    <textarea id="knowsource"></textarea><input type="file" id="knowfile" /><button id="knowdistil">Distil</button><textarea id="knowprofile"></textarea><button id="knowsave"></button><button id="knowforget"></button>`);
  const d = k.window.document; let on = false; let changes = 0; const sent: any[] = [];
  mountKnowMe(d, { enabled: () => on, setEnabled: (v) => { on = v; }, changed: () => { changes++; }, toast() {}, copy: async () => true,
    fetcher: (async (_u: any, init: any) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ profile: 'Rides a G 310 GS; loves history.' })); }) as typeof fetch });
  assert.match(d.getElementById('knowask')!.textContent!, /Summarise what you know about me/);
  (d.getElementById('knowsource') as HTMLTextAreaElement).value = 'ChatGPT says: he rides a BMW G 310 GS in Gauteng and loves history.';
  d.getElementById('knowdistil')!.dispatchEvent(new k.window.Event('click'));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, 1); assert.equal((d.getElementById('knowprofile') as HTMLTextAreaElement).value, 'Rides a G 310 GS; loves history.');
  assert.equal(ProfileStore.get(), null, 'nothing kept until he saves');
  d.getElementById('knowsave')!.dispatchEvent(new k.window.Event('click'));
  assert.equal(ProfileStore.get(), 'Rides a G 310 GS; loves history.'); assert.equal(on, true, 'saving switches it on'); assert.ok(changes >= 1);
  d.getElementById('knowforget')!.dispatchEvent(new k.window.Event('click'));
  assert.equal(ProfileStore.get(), null);
  delete (globalThis as any).localStorage;
}
console.log('ui smoke tests passed');
