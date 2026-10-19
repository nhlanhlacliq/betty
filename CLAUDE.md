# CLAUDE.md — Betty

Context for any Claude Code instance picking this project up. Read this first.

## What Betty is

An always-on voice co-pilot for a motorcycle (owner: Nhlanhla, 2018 BMW G 310 GS, Gauteng, South Africa).
She talks to the rider through Bluetooth helmet comms, reads bike/ride data, and speaks proactively
like a co-pilot with personality, not like an alert system. Warm, dry wit, direct, max 2 short sentences.
She calls the rider by `CONFIG.riderName` (default "sir") and the motorcycle by `CONFIG.bikeName` (default
"the bike"). Both are editable on the main screen and persisted. The system prompt is built per request by
`bettySystemPrompt()`, so a change applies to the next line.

The rider can also speak to her: push-to-talk from the headset button or the screen (see Voice input). No wake word yet.

## Owner preferences

Direct, concise communication. No hedging, no over-explaining. Hold him to account plainly: if something
is wrong or risky, say so.

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 1 Voice foundation | Scaffold, GPS speed, TTS to helmet, "Systems online", trigger engine, audio queue | Done (web app) |
| 2 Data feeds | Weather, traffic, phone IMU lean, TPMS BLE, mock OBD2 | Weather (Open-Meteo), traffic (TomTom), GPS lean, mock OBD2, places, area names, routes, petrol stations done. TPMS outstanding |
| 3 AI brain | Claude-phrased speech, session memory, voice input "Hey Betty", chat test mode | Done: phrasing, ambient personality, area stories, web search, ride memory, notes/marked spots, push-to-talk voice input, chat. Wake word left for Phase 4 |
| 4 Hardware | Raspberry Pi 4 under seat, real OBD2 via ELM327, standalone, local Piper TTS, Porcupine wake word | Not started; real OBD2 now goes through the native app (protocol in `core/Elm327.ts`) |
| 5 Native app | React Native + Expo in `native/`, iOS and Android, sharing `src/core` | First slice 2026-10-18, NOT RUN ON A PHONE YET: see Native app below and `native/README.md` |

History: Phase 1 was first scaffolded as Expo/React Native, then converted to a Vite web app on request
("just make it a webapp for now"). The Expo code is deleted. Do not reintroduce React Native unless asked.
2026-10-18: the owner CHOSE React Native + Expo (dev builds, not Expo Go) for the native app, iOS and Android, reusing
`src/core` as is. His ELM327 "mini" is Bluetooth CLASSIC ("not compatible with Apple devices"): Android only; iPhone
OBD needs a BLE or Wi-Fi reader. He builds Android APKs and sideloads to his iPhone from Xcode (free Apple ID = 7 days).

## Stack

Two apps, one brain: the web app (below) and the native app in `native/` (React Native + Expo SDK 58, its own
`package.json` and `node_modules`, see `native/README.md`). Both use `src/core` and `src/config`.

- Vite 6 + TypeScript (strict), vanilla DOM UI (no framework). Entry: `index.html` -> `src/main.ts`.
- Tests: `tsx` with plain `node:assert`; UI smoke test uses `jsdom` (dev dependency). No test framework.
- Claude API called directly from the browser via `fetch` (see ClaudeClient). Model id lives in `src/config/betty.ts`
  (`claudeModel`); verify it is current before shipping.
- Deploy target: Vercel (static Vite build, output `dist/`).

## Commands

```
npm install
npm run dev         # http://localhost:5173 (also --host for LAN)
npm run typecheck   # tsc --noEmit, must be clean
npm test            # core logic tests + jsdom UI smoke test, must pass
npm run build       # production build to dist/
```

Run typecheck + test before declaring any change done. If `src/core`, `src/config` or `native/` changed, also run
`cd native && npm run typecheck && npm run bundle` (the native app compiles the shared code too).

## Architecture

Data sources push partial state -> StateAggregator merges into one `BikeState` (real values, with simulator
overrides layered on top) -> TriggerEngine evaluates each update and emits deduplicated `TriggerEvent`s ->
ClaudeClient turns an event into speech (or a canned fallback) -> AudioQueue decides when it may be spoken ->
Speaker outputs audio.

```
src/
  main.ts                  Wiring only. Builds the rig on Start riding, mounts screens and panels. No business logic.
  config/betty.ts          CONFIG (live, mutable), DEFAULT_CONFIG, applyConfig/resetConfig, Betty system prompt
  config/persist.ts        localStorage save/load of the tunable subset of CONFIG (UI-only, never imported by core)
  core/                    Pure logic. NO browser/hardware imports. Must stay unit-testable in Node.
    types.ts               BikeState, TriggerEvent, TriggerId, TRIGGER_IDS, Priority, DataSource
    StateAggregator.ts     Merges DataSource updates; override layer for the simulator; failed sources degrade
    TriggerEngine.ts       When should Betty speak; per-trigger cooldown/dedupe; force(); isSafeWindow()
    AudioQueue.ts          Priority queue + Speaker interface; generation guard against stale onDone
    ClaudeClient.ts        Event -> Phrase {text, source claude|fallback, detail, latencyMs}; buildClaudeRequest (pure)
    ambient.ts             chooseAmbient (weighted, injectable RNG), freshPlace, banterTopics/pickTopic/pickMode
    RideStats.ts           Running totals for the current ride (distance, stops, lean, alerts, places)
    LineLog.ts             LogEntry, mergeLog (upsert by id, capped at 1500), ridesInLog, formatLog (plain text)
    RideMemory.ts          RideRecord, toRecord, upsertRide, describeRide/describeTotals (cross-ride memory, pure)
    geo.ts                 haversineKm, bboxAround, bearingDeg, angleDiff, compassPoint, relativeDirection
    GpsLean.ts             Lean estimated from GPS speed and turn rate: atan(v * turnRate / g)
    Elm327.ts              ELM327 OBD2 protocol: init, PID answers, supported-PID map, fault codes, ElmSession (native app)
  adapters/                Everything that touches a browser API, network or hardware
    WebGeoSource.ts        navigator.geolocation -> speed/lat/lon/course/altitude + lean estimate (GpsLean)
    WebMotionSource.ts     accelerometer -> hard-jolt count; compass heading for when GPS has no course
    WebSpeaker.ts          speechSynthesis (prime() must run inside a tap on iOS)
    SwitchableSpeaker.ts   Wraps a speaker; "silent" mode simulates duration so queue behaviour is observable
    WakeLock.ts            Screen wake lock so the browser doesn't throttle GPS/timers
    MockObdSource.ts       Simulated RPM/temp/fuel; temp ramps toward overtemp; reset()
    WeatherSource.ts       Open-Meteo (no key). Polls by time or distance moved
    TrafficSource.ts       Polls a TrafficProvider; idle without one
    TomTomTraffic.ts       TomTom incidentDetails v5 provider (needs VITE_TOMTOM_API_KEY)
    PlaceSource.ts         Wikipedia geosearch + intro extracts -> BikeState.nearbyPlaces (tour-guide grounding)
    RideLog.ts             localStorage store for past rides (Betty's cross-ride memory)
    LineLogStore.ts        localStorage store for everything she has said (`betty.log.v1`)
  ui/
    Shell.ts               Screens/sheets/toast; data-go, data-back, data-nav, data-sheet-open hooks; nav redirect while riding;
                           docks the Workshop beside the phone on a wide screen; followDock (map ends at the dock)
    copy.ts                Every word the app shell shows (ride-screen kickers/headlines per trigger, home, glance labels)
    rideView.ts            Pure: ride state -> what the ride screen shows (orb mode, caption, glance cue). Tested in core tests
    icons.ts               SVG icon paths; <i data-icon="name"> placeholders are hydrated by the shell
    mapView.ts             Pure: track, position, places, incidents, marks -> SVG sketch map (no map library). Tested
    art.ts                 Decorative landscapes for ride cards
    styles/                tokens.css (palette, type), app.css (screens), devtools.css (Workshop panels, scoped .devtools)
    screens/               HomeScreen, RideScreen, ChatScreen (+ ask sheet), JourneysScreen (+ story), ExploreScreen, SettingsScreen
  core/Track.ts            (in core) ride path: addTrackPoint (15 m steps, capped), thinTrack
  adapters/TrackStore.ts   (in adapters) localStorage store for recent rides' paths (`betty.tracks.v1`)
    SimPanel.ts            SIMULATOR panel (mounted per ride)
    TuningPanel.ts         TUNING panel (always mounted)
    LogPanel.ts            LOG panel: view saved lines per ride, copy, share, save as a file, clear
    MemoryPanel.ts         MEMORY panel: notes and marked spots he asked her to keep (map link, Forget)
    ChangelogPanel.ts      WHAT'S NEW panel: src/changelog.ts plus the build time (Vite define __BUILD_TIME__)
    LockScreen.ts          Full-screen touch cover for riding; hold the unlock button for 1 s to get out
    dom.ts                 el/button/checkbox helpers
tests/core.test.ts         Pure logic tests
tests/ui.smoke.ts          Drives both panels in jsdom, then loads the real index.html with main.ts (name box, OBD switch)
```

**Key rule: core/ never imports from adapters/ or ui/ and never touches `window`/`navigator`.** Moving from phone to
Pi (Phase 4) must only mean swapping adapters that implement `DataSource` and `Speaker`. The native app depends on this:
it imports `src/core` directly (Metro watches `../src`), so a browser API in core breaks the native build.

## Triggers

| Id | Default priority | Fires when | Default cooldown |
|---|---|---|---|
| startup | P4 | Ride starts | 0 |
| engine_overtemp | P1 | temp >= 105 C | 60 s |
| dtc_detected | P1 | any fault code present | 10 min |
| low_fuel | P2 | fuel <= 15% | 10 min |
| rain_soon | P2 | raining now, or chance next hour >= 60% | 15 min |
| traffic_incident | P2 | new incident within 5 km and severity >= 2 (once per incident id) | 2 min |
| ride_milestone | P3 | every 45 min of riding | 2 min |
| rider_query | P4 | rider asks (simulator button for now; voice later) | 0 |
| fuel_range | P2 | OBD off, a fill-up is on record, and estimated range left <= 60 km | 15 min |
| sunset_soon | P2 | sunset is within 45 min (once per evening) | 6 h |
| ride_debrief | P4 | END RIDE, for a ride of 3 min or 1 km and up | 0 |
| ambient_banter | P3 | ambient slot rolls banter (see Ambient personality) | 0 (paced by ambient gap) |
| local_fact | P3 | ambient slot rolls tour guide and an unmentioned place is in range | 0 (paced by ambient gap) |
| area_story | P3 | the first ambient slot after reaching an area with an untold story (owner, 2026-10-17: "add them to the normal speech"), then when the slot rolls tour guide (half the tour-guide rolls when a place is fresh too); never with tour guide weight 0 | 0 (paced by ambient gap) |
| ride_parked | P2 | standing still (under 3 km/h) for 10 min (`PARKED_MS`): asks once if he has parked, says "end ride"; then no time checks or ambient until he is back over 10 km/h | 10 min |
| marked_spot | P2 | a spot he marked is within 400 m, within 50 deg of his course, he is doing 15 km/h or more; each spot at most once in 10 min | 30 s |

All priorities, cooldowns and thresholds are read live from `CONFIG` at call time and can be edited in the TUNING
panel (persisted to localStorage). Adding a trigger = add the id to `TriggerId` + `TRIGGER_IDS`, entries in
`DEFAULT_CONFIG.priorities` and `.cooldownsMs`, a case in `TriggerEngine.describe`, an evaluate rule, and tests.

## Behaviour rules (do not weaken without being asked)

Priorities: P1 critical, P2 advisory, P3 ambient, P4 rider-initiated.

- P1 interrupts immediately, clears other queued items, and NEVER waits on the network: ClaudeClient returns the
  canned fallback for P1 (this follows the *configured* priority, so a trigger promoted to P1 also skips Claude).
- P2 waits for a safe window. By default the window is always open: the owner had the RPM condition removed
  (2026-10-08) and the lean condition switched off (2026-10-09, the phone IMU reads past 20 deg just from
  mounting and vibration). The lean hold survives as a TUNING checkbox (`safeWindow.useLean`, default off) for when
  a trustworthy lean source exists. Do not turn it on by default or reintroduce RPM unless asked.
- P3 waits for a safe window and is dropped if queued longer than `ambientMaxAgeMs` (60 s). How OFTEN ambient lines
  are made is paced by `ambientCooldownMs` in TriggerEngine. The queue no longer has its own time-based P3 drop: it
  silently discarded lines that had already been logged (2026-10-09 road test). Do not add one back.
- One line at a time: a line arriving while another plays waits and is spoken after it. Only P1 interrupts, plus the
  replies to going quiet and coming back (owner, 2026-10-18: the Quiet button, "be quiet", "talk to me"):
  `AudioQueue.interrupt` cuts off the current line (fate `interrupted`) and goes next, but never cuts off a P1 (it then
  goes right after it). Use `sayNow(text, true)` / `reply(..., true)` / `say(ev, true)` in main.ts for any other line
  that must not wait. Cutting in now: quiet, talk again, "repeat that" (voice, orb tap, next-track button) and the
  sign-off. Careful: never pass `say` straight to `forEach` (the index would arrive as `now`).
- Every line's fate is tracked on its `QueueItem` (`queued`, `speaking`, `spoken`, `expired`, `interrupted`,
  `cleared`) and shown in the log, so "logged but not heard" is always explained.
- `WebSpeaker` must ALWAYS call onDone: mobile speech engines swallow lines or never fire `onend`, which used to jam
  the queue for the rest of the ride. It retries a line once if it does not start within 3 s, writes it off after a
  deadline based on its length, calls `resume()` before each line, and reports problems to the log as `[audio]`.
- P4 always speaks next.
- No repeating herself: per-trigger cooldowns, per-incident dedupe, and ClaudeClient passes recent lines to Claude.
- Every API/hardware failure has a fallback. Sources failing must not crash the app.
- Target latency trigger -> speech under 3 s.
- AudioQueue uses a generation counter: `speechSynthesis.cancel()` still fires `onend` for the cancelled utterance,
  and without the guard that stale callback released the speaker mid-P1. There is a regression test; keep it.

## First real ride log: findings and fixes (86 min, 55 km, Edenvale to Pretoria)

What held up: all 67 lines came from Claude, no timeouts or network errors (so the offline line bank is not urgent),
every line with content was spoken, no `[audio]` problems. Latency 1.0 to 2.1 s, one at 3.5 s.

What was wrong, and the fix (all in place, with tests built from the real lines):
- **The model spoke its own second thoughts** twice ("Wait, that breaks the two-sentence and word limits...
  Corrected:"). `cleanSpoken` in `ClaudeClient` now runs on every reply: keeps only the first thought, treats
  `SILENT` anywhere in an ambient reply as silence, drops ambient lines that talk about "the notes"/instructions
  (alerts keep the rest and are never silenced; an unusable alert reply falls back to the canned line), and caps
  the reply at `maxSpokenSentences`.
- **Third person ("Betty finds that...") and "pick up the pace"**: I "fixed" both and the owner had both REVERTED
  the next day. The co-pilot and the bike are two separate characters, the co-pilot is the go-between for rider and
  bike, and speaking of herself in the third person is wanted character, even if the bike is also named Betty.
  The pace line was fine in context. Owner: "do not make the system more dull." Do not add first-person rules or
  blanket bans on what she may say; ask first. The banter-only rule (never dare him, never suggest going faster or
  leaning further) stands, as he has not objected to it. He also had the sentence telling her that she and the bike
  are "two separate characters" and that she is the "go-between" taken OUT of the prompt (2026-10-09): the prompt just
  names the bike and leaves the relationship to her. Do not put it back.
- **"Sir," at the head of almost every line.** `cleanSpoken` removes his name from a line when either of the last
  two lines used it. The prompt rule alone ("rarely") was ignored.
- **32 "stops" in 76 minutes.** GPS speed flickering around walking pace in traffic counted each dip. A stop now
  needs 4 s at a standstill after having got above 15 km/h. Stops and hard braking are bucketed in sixes so they
  stop dominating banter (they were "fresh" after every single stop).
- **"Leaning past 15 degrees for none of the moving time"**: 0 percent after rounding. Now phrased as "almost all
  straight so far". The GPS lean estimate reads low in town: slow corners are under the 15 km/h floor.
- **"Betty's tank gauge says 270 km"**: the banter topic now says there is no gauge to read.
- **Dull tour-guide lines** (a suburb, a school): the owner wanted her more interesting, not quieter. The source
  is now richer (see Feeds: Places) and the prompt asks for the best story (a name's origin, a founder, an event)
  instead of telling her to be picky and stay silent.
- **Line length** is tunable (`maxSpokenSentences`, TUNING "Longest line", 1 to 5). The prompt, `max_tokens` and
  `cleanSpoken` all follow it.
- **Jolts**: the owner saw and heard no jolt count on the ride. Unknown whether the accelerometer delivered nothing,
  the threshold (8 m/s2) is too high for a damped mount, or it simply stayed under 5. The log now gets a
  `[sensors]` line every 15 min and at END RIDE (motion readings, hardest knock, jolts, compass, GPS altitude and
  course, lean, stops, hard brakes) so the next log answers it. Tune `JOLT_MS2` from the "hardest knock" figure.

Still open, owner's call: his TUNING had the milestone at about every 5 min and the ambient gap at 60 s, which gave
18 near-identical time checks ("N minutes out, and Betty suspects the road/clock/scenery..."). The default is 45
min. Banter repeated a question three times ("which road will you remember longest") and a gag twice.
The log was exported before END RIDE, so the sign-off is still unverified on a real ride.

Dev note: Node's `fetch` on this Mac fails with ETIMEDOUT in about 250 ms when the network is slow (connection
attempt timeout). For live checks from scripts use
`NODE_OPTIONS=--network-family-autoselection-attempt-timeout=8000`. It is not an API or app fault.

## Fuel from the tank and the dash average (2026-10-17, owner's figures and picks 3 + 5)

`core/Fuel.ts` (pure, tested) replaced the guessed `fuel.rangeKm` (280): `CONFIG.fuel` = tankL 11, reserveL 1, lPer100
4.4 (his dash average), warnKmLeft 60 (now km BEFORE RESERVE), pricePerL 30.25, priceSource manual/auto, priceAt.
227 km to reserve, 23 km of reserve. Garage > In your garage: Tank (litres, of which reserve), Average consumption,
Petrol price (text boxes with a decimal keypad: a number box drops "31,10"); voice: "consumption 4.6", "petrol price
31.20" (`{kind: 'fuelset'}`). Her fuel lines (`fuelNote`): km to reserve, litres left, km to empty, on reserve.
- Stations ahead: `api/stations` (TomTom nearbySearch, category 7311, 50 km, 100 results, rounded coords, a day at
  the edge; Search is 2,500 free a month) via `adapters/StationSource`, asked only once he is within 40 km of the
  warning, or when his question mentions fuel/petrol/station (waits up to 2.5 s), and again after 10 km.
  `stationsAhead`: on the route (within 1.5 km of its line, by km along it, `projectOnRoute`) or, without one, within
  60 deg of his heading by straight line x 1.25; a brand within 2 km of a nameless one goes first. Used in the
  `fuel_range` warning (and its canned line) and in answers.
- Route check: `routeFuelPlan`/`describeFuelPlan` on the Where to? sheet (`#routefuel`) and in the briefing: fits, or
  "fill up by <last named stop before reserve>".
- Cost: `toRecord(..., CONFIG.fuel)` keeps `fuelL` and `costR` (price of the day) per ride; story stat, ride card
  (4th number), Journeys `fuelSpend` line (this month, R a km). Older rides have none.
- Price: `adapters/FuelPrice` at app load (server only): when `priceDue` (set before the last first-Wednesday
  change), Claude with a forced web search for the inland ULP 95 price; `parsePrice` takes 10 to 80. Checked live
  2026-10-17: "30.25" for October, his figure. His own figure wins until the next change.

## Fuel range, sunset, debrief (built 2026-10-10)

- **Fuel range by distance** (for as long as there is no fuel gauge): the rider taps FILLED UP on the main screen;
  the engine counts km since then (`setFuelKm`/`filledUp`/`kmSinceFill`/`fuelKmLeft`) against `CONFIG.fuel.rangeKm`
  (was 280; since 2026-10-17 worked out from the tank and his consumption, see the section above) and fires `fuel_range` at `fuel.warnKmLeft` (60).
  The count carries across rides via `adapters/FuelStore` (`betty.fuel.v1`), saved every minute and at END RIDE.
  With no fill-up recorded there is no estimate and no warning. With OBD on, the real `low_fuel` alert is used
  instead. She is told it is an estimate, not a gauge. Also a banter topic (`range`) and part of `rider_query`.
- **Sunset**: Open-Meteo `daily=sunrise,sunset` (local ISO strings; `nextTime` picks the first still ahead) fills
  `WeatherState.sunriseAt/sunsetAt`. `sunset_soon` fires once when sunset is within `thresholds.sunsetWarnMin`.
  Banter gets a `daylight` topic inside the last two hours. The simulator's weather override has a "Sunset in" slider.
- **Debrief / END RIDE**: `stop()` in `main.ts` first stops reacting to the ride (unsubscribes, so no new lines),
  then says `ride_debrief` through the normal queue (after any line already playing) and WAITS for it to finish
  before tearing anything down: owner's request, 2026-10-10. The button reads "ENDING RIDE... (tap to stop now)";
  a second tap skips the wait, and it gives up after 45 s regardless. Canned fallback gives minutes, km and stops.
  No map or written report yet. The smoke test runs a whole simulated ride through this path.
- Open-Meteo response shape was checked against the live API on 2026-10-10 (current, hourly, daily all match).

## Saved log

Every line (and every `[audio]` problem) is saved on the device with its time, ride, source (`claude`/`fallback` and
why), latency and fate (`spoken`, `not spoken: waited too long`, ...). `main.ts` writes it 2 s after a change, when
the page is hidden, and at END RIDE; a line still waiting or playing is re-saved once its fate settles. `rideId` is
the ride's start time and matches `RideRecord.startedAt`, so the export can head each ride with its duration and
distance. The LOG panel (always mounted, under TUNING) also lists remembered rides that have no saved lines (summary only:
duration, distance, weather, places, alerts). It opens on the LATEST ride (the newest one with lines; owner's
request 2026-10-14, exporting everything by default was confusing); any single ride or All rides can be picked.
Copy, Share and Save file take exactly what is shown, and the file is named after it (`betty-ride-<start>.txt` or
`betty-all-rides-<date>.txt`). Clear removes saved lines only. The on-screen log above it still shows only the current ride's latest 10. This is the main tool for
judging a road test afterwards: ask the owner to share it.

## OBD mode (switch on the main screen, persisted)

`CONFIG.obdMode`: `off` (default until the hardware exists) or `mock`. A disabled "Real OBD2" option marks where
Phase 4 slots in: add a mode value and start the real adapter in `setObd` in `main.ts`.

- `BikeState.obd` says whether an OBD2 feed is live. The feed sets it (`MockObdSource` pushes `obd: true`); switching
  off pushes `NO_OBD`, which also zeroes rpm/temp/throttle/fuel/dtcs so nothing stale lingers.
- With `obd` false: no engine alerts (overtemp, fault, low fuel), nothing engine-related blocks ambient, banter has
  no fuel/engine/revs topics, Claude is told engine data is not connected, `rider_query` answers from ride stats
  and weather, the dashboard shows `-`, and the simulator's OBD sliders and fault button are disabled.
- GPS speed, lean, weather, traffic, places, ride stats and memory work the same in both modes.
- The switch works mid-ride. Anything new that reads rpm, engineTempC, throttlePct, fuelPct or dtcs must check
  `s.obd` first.

## App shell (UI, design v3 BUILT 2026-10-17 from the owner's design at betty-riding-companion.vastox257.chatgpt.site)

The design will keep changing, so it is split by what changes: wording in `ui/copy.ts`, colours/type in
`ui/styles/tokens.css`, layout in `ui/styles/app.css`, what the ride screen decides to show in `ui/rideView.ts`, the
map in `ui/mapView.ts` (both pure, tested in core tests), markup in `index.html`. Screens and sheets are STATIC sections
in index.html (`data-screen`, `data-sheet`), shown and hidden by `ui/Shell.ts`, so every control exists at load and
main.ts binds ids as before. Do not switch to re-rendering whole screens with innerHTML: it would drop main.ts's
listeners. Add a screen = a `<section data-screen>`, its id in `ScreenId` (and `NAV_OF`), a `ui/screens/*` module if it
has dynamic content, and a smoke test.
- Layout: everything lives in `.device`. On a computer it is a framed phone (414 x up to 896) with the Workshop docked
  beside it (1100 px and up; the shell moves the section into `#studio`). On a phone (520 px and down) the device IS
  the screen, 100vw x 100dvh; `--status-h` is the safe-area top (the real status bar), the tab bar and docks keep clear
  of the home indicator. Screens are absolutely positioned between status bar and tab bar, so nothing can be taller or
  wider than the phone (owner asked for proper mobile width/height; the screenshot check measures no overflow at
  360x640, 375x667, 390x844, 430x932). Riding hides the tab bar (`[data-view="ride"]` on <html>).
- Tabs: FOUR (owner, 2026-10-17): Ride, Journeys, Explore, Garage. Chat is NOT a tab.
- Home (Ride tab): full-screen map (sketch of the last ride), greeting, and the ride dock: Betty's orb (tap = hello),
  "How are we riding?" (sheet with Free ride / Desk test driving the hidden `#real`), Let's ride (`#start`), readiness
  line (Details sheet with FILLED UP). `followDock` keeps `--dock-h` = the dock's height so the map ends at the dock.
- Riding: map with the glance card (`pickGlance`) on top, live pill, Workshop and Quiet (headset icon) buttons; the dock
  has km / min / speed, Betty (mini orb = repeat last line, kicker + state, the ask button, the microphone =
  push-to-talk, her line), Lock and End ride (`#end` opens the confirm sheet, `#endconfirm` ends, during the sign-off
  `#end` ends at once; `#endtext` holds the label). The note under it: area, weather, warnings, voice.
- Chat (owner, 2026-10-17: "add the chat in the ride screen when riding or in the workshop when not riding"):
  while riding, the dock's speech-bubble button opens the "I'm listening." sheet (type, chips, Use microphone, Ask
  Betty; as in the design) and "See the whole conversation" opens the chat screen (`ui/screens/ChatScreen`): bubbles of
  everything said, chips, composer, mic. Not riding: the Workshop CHAT panel is always mounted; sending with no ride
  running starts a DESK SESSION (`start({ desk: true })`): the same rig, simulated, no briefing, no wake lock, no ride
  screen, no debrief, never saved as a ride; "End desk chat" stops it, and Let's ride replaces it with a real ride.
  `riding()` in main.ts = a rig that is not a desk session (nav redirect, start/end buttons).
- The design shows routes, turn-by-turn and destinations: Betty has none (route awareness is backlog), so nothing fake
  was built: the "Where to?" button became the ride-mode picker, the turn card is the glance cue, the map is a sketch
  of the real GPS track (`core/Track`, kept per ride in `adapters/TrackStore`, `betty.tracks.v1`).
- SVG ids must be unique per drawing (`mapSvg(..., id)`, `scenery` counter): a `url(#id)` that resolves into a hidden
  copy draws nothing (the position marker vanished once).
- My journeys: totals, rides, a ride's story (map of the road taken, moments, every line, copy/save the log). Explore:
  marked spots, notes, area stories (tabs). Garage: personality (narration presets, humour, JARVIS/TARS, visual
  companion), voices, names, fuel range, OBD, headset buttons, Workshop link.
- Betty's look (2026-10-17): Settings > "Choose a picture or GIF" (`ui/avatar.ts`). Kept on the phone in IndexedDB
  (`betty-avatar`), never uploaded. GIF/WebP/APNG kept as they are (up to 6 MB, so they stay animated); still photos
  are centre-cropped and shrunk to 320 px JPEG. `applyAvatar` sets `--orb-image` and `.has-avatar` on <html>; app.css
  then shows the picture in every orb as a true circle with the same sway/breathing (`breathe-round`: the companion's
  rotate/scale without the blob reshaping), speaking pace, quiet fade and listening ring; the eyes are hidden.

- Installable app (2026-10-17): `public/manifest.webmanifest` (standalone, portrait, the app's cream colours), icons
  in `public/icons/` drawn by `scripts/make-icons.ts` (no dependencies; rerun it to change them), `public/favicon.svg`,
  apple-touch-icon and title for the iPhone home screen. `public/sw.js` (registered in main.ts, not on localhost):
  pages network-first with the last good copy offline, `/assets/*` and icons cache-first (hashed names, trimmed to
  40), `/api/*` and other origins never touched. So the app now OPENS WITHOUT SIGNAL (the offline-loading backlog item;
  Claude, voices, weather and traffic still need signal). UNVERIFIED: headset buttons and mic from the installed app.
- Your data (2026-10-17): Garage > Export all data / Import a backup (`ui/backup.ts`): every `betty.*` localStorage
  entry plus her picture (base64) in one JSON file, shared through the share sheet (or downloaded); import validates,
  shows what is in it, asks, REPLACES all betty.* entries (other keys untouched), then reloads. Voice clips are not in
  it (made again on demand). Refused during a ride.
- What's new (2026-10-17): moved from the Workshop to Garage (`ui/WhatsNew.ts`): a card with the unread count, the
  same count as a badge on the Garage tab, and a sheet listing `src/changelog.ts` with the unread items marked. Seen =
  how many items he has seen (`betty.seen.v1`; entries are only added at the top); opening the sheet marks all read;
  a first visit counts only the newest day. Keep writing changelog entries: they now show as a badge.
- Gestures (2026-10-17, `ui/gestures.ts`): screens scroll inside the fixed frame (and the installed app has no
  browser refresh), so pull-to-refresh is our own: pull down at the top of any screen, a pill follows ("Release to
  refresh" past 64 px damped), letting go saves the log and reloads. Disabled while a ride or desk session runs (a
  reload would end it), inside sheets, lists and fields. Every sheet can be dragged down to close: from its handle,
  or from its body when scrolled to the top; past 110 px or a quick flick it closes, otherwise it snaps back.
- Share this ride (2026-10-17): the ride's story has "Share this ride" and "Hide where I start and finish" (on by
  default). `ui/rideCard.ts` draws a 1080 x 1350 PNG on a canvas in the app's colours: RIDDEN WITH BETTY, title and
  date, the map sketch (the same `mapSvg`, given an xmlns and drawn as an image; the track's first and last 0.5 km cut
  by `core/RideCard.trimEnds` so home is not on it), km / time / places, and "Betty said" with `bestLine` (area story
  > place > banter > time check > answer > sign-off > briefing; alerts never; voice tags removed; ~140 chars best) next
  to her orb or his picture (a GIF gives its first frame). Shared with the share sheet (WhatsApp, Instagram, Photos),
  downloaded where there is none. Layout: the quote is measured first and gets the room it needs, the map takes the
  rest (first render on his phone had the quote box squeezed to nothing and the date placed for a two-line title);
  with no road (rides before tracks were kept, or too short once trimmed) the map scenery shows with a note.
  The ride's weather (`RideRecord.weather`, "partly cloudy, 22 C") is a pill in the map's top corner like the app's
  condition pill: `weatherPill` -> "Partly cloudy · 22°C" with a drawn sun/cloud/rain/storm/fog glyph.
- Swipe back (2026-10-17, `mountSwipeBack`): from within 36 px of the left edge on a ride's story, the chat and the
  Workshop (`BACK_SCREENS`), the screen follows the finger and goes back past 90 px or a quick flick.
- No sideways scrolling: Explore and Garage scrolled left/right (Explore's tabs reach past the page padding; Garage's
  dropdowns had a fixed width). `.screen` clips sideways and cards/controls shrink to fit; Explore's tab row still
  scrolls on its own. Not measured on a phone here (no browser): if a screen still moves sideways, find what is wide.
- Map pan and zoom (2026-10-17, `ui/mapGestures.ts`) on home and ride: one finger / mouse drags, two fingers pinch,
  double tap or double click zooms in 2x, wheel zooms; spans 0.4 to 300 km. During the gesture only the drawn SVG is
  translated/scaled (CSS transform); on release `viewAfter` (pure, tested) turns it into a new centre and span and the
  sketch is drawn again. Ride: the first move stops "follow me" (`manual` view; zoom buttons then zoom that view); the
  target button lights up and brings back following. Home: the target resets to the fitted view (route or last ride).
  The terrain pattern is pinned to a ground point so it moves with a pan. `.ride-map` has touch-action none and
  pull-to-refresh ignores it. Not tried on a phone yet.
- Slim panels (2026-10-17, `ui/dockSwipe.ts`): the home dock and the ride dock slide down to a slim bar (swipe down
  over 40 px) and back (swipe up, or tap the handle, now a button with a finger-sized target). Slim home: the
  orb, the route or mode name (`#minititle`) and a compact Let's ride; the greeting STAYS (owner). Slim ride: only Betty's
  row (orb, state, chat, microphone); stats, her line, Lock/End ride come back with the panel. `.dock-slim` on the
  screen; remembered per screen in `betty.dock.v1`. The map re-frames by itself (followDock's --dock-h). Swipes on
  fields, the microphone and her scrolling line are left alone; pull-to-refresh ignores both docks.
  The swipe moved the WHOLE screen on iPhone (the page scrolled/bounced with it): map screens are now overflow hidden
  with no overscroll, html/body overscroll-behavior none, and the dock's vertical touchmove calls preventDefault.
  While pulling, `dockStretch` gives it a little rubber-band give, pinned to the bottom edge (transform-origin bottom):
  full + down slides (the slim preview), up stretches (5% full, 14% slim, easing off), slim + down squashes 6%; it
  springs back with a slight overshoot.
- Edge stretch (2026-10-17, `mountEdgeStretch`): every screen's native bounce is off (overscroll-behavior-y none);
  pulling past the top or bottom stretches the screen up to 3.5% (`edgeStretch`, easing off), pinned at the edge he
  pulls from, springing back. Not on the map, the panels, sheets, fields or the chat list (they have their own).
- Pull-to-refresh keeps his place (2026-10-17; it went back to Home): `rememberSpot` puts the screen, the open story's
  ride (`#story[data-ride]`) and the scroll in sessionStorage; `takeSpot` at the very end of main.ts restores it once
  (home, journeys, story with journeys under it, explore, settings, workshop; never ride/chat).
- RIDE MENU (2026-10-18, owner: the wrench took him to the Workshop, the only way off the ride screen): the ride
  top bar's wrench is now a grid button (`#ridemenubtn`) opening the `ridemenu` sheet: Journeys, Explore, Garage as
  three big buttons; NO Workshop link (owner removed it; the Workshop is in the Garage). The tab bar stays hidden on the ride screen (map room,
  no small targets under gloves).
- RIDE IN PROGRESS BAR (2026-10-18, owner chose "option 1 plus live dot"): `#ridebar` (index.html, above the tab bar)
  on every screen but the ride while `riding()` and not signing off; `html.riding-bar` makes `.screen` end above it
  (bottom: tab height + 52px) so it covers nothing (search boxes, lists). Text "Riding · 42 km · 1h 10" (riding time
  per `ridingTimeOnly`); tap = `shell.show('ride')`. The Ride tab gets `.live` (green dot, pulses under `.motion`).
  `paintRideBar` runs from `paintRide` only once a ride exists (at load `endNow`/`riding` are not initialised yet: TDZ)
  and once more in `stop()`. End ride stays only on the ride screen (owner agreed). Checked in headless Chromium.
- Stuck after ending (owner's bug, 2026-10-18): going back to the ride screen during the sign-off left him on an empty
  ride screen whose End ride did nothing once the ride shut down. `stop()` now moves him to the story (kept ride) or
  home from ride/chat; a "stop now" tap counts while the sign-off is still being written; End ride with no ride goes
  home. Checked in headless Chromium with a 3-minute simulated ride.
- Ending a ride (2026-10-17): a remembered ride's story opens AT ONCE on End & see my story, while she signs off, and
  is re-rendered with her sign-off line after. (It used to wait up to 45 s for the sign-off and only open if he was
  still on the ride screen: "sometimes I don't get the ride summary".) A ride too short to keep (under 3 min and 1 km)
  goes home with a toast saying why. Once no ride runs, the ride screen redirects to home (so back from the story
  does not land on an empty ride).
- HORIZON (renamed from "the island" 2026-10-18, owner: a name that does not copy Apple; ranked Roadbook/Horizon, he
  chose Horizon). User-facing text says Horizon everywhere (Garage card, aria labels, Help); the CODE keeps the old
  names (`ui/island.ts`, `CONFIG.island`, `islandcompact` ids, `glance*`), do not rename them for nothing. For a phone
  in the pocket (owner: many riders do not mount it): `{kind: 'ahead'}` ("anything ahead?", "what's on the horizon?",
  "horizon check", "what's coming up?") -> `horizonSpoken(glanceCues(...))`, one sentence per card (max 5), said by the
  phone; `horizonLine` (top card, "Maintenance: Engine oil in 416 km") on Betty's Lock screen (`setHorizon`) and as the
  Media Session title while she holds the headset buttons, i.e. the PHONE's lock screen Now Playing (and possibly
  CarPlay's Now Playing; unverified). `CONFIG.island.lockLine` (Garage > Horizon > On the lock screen, default on;
  still enabled when the card itself is hidden). Both use the cues even with Show Horizon off.
- RIDE SCREEN LINE (2026-10-18, owner chose the combination): moving, her last line stays under her name after the
  30 s linger, DIMMED (`RideView.earlier`, `#ridesub.earlier`); stopped (< 3 km/h) or before her first line, a STATUS
  caption (`RIDE_STATES.parked/idle` in copy.ts). Captions are never written in her voice: "I'll be here when you're
  rolling" read like a line she failed to say.
- HORIZON DISMISS (2026-10-18, owner): traffic cards carry `Glance.dismiss` (= `incidentKey`); × (`#glancedismiss`, open card
  only) or a swipe up hides it: `adapters/HorizonDismissed` (`betty.dismissed.v1`, a week), `RideInput.dismissed` filters
  it out of `glanceCues` (the next nearest incident shows), and `engine.knowIncident` + `setKnownIncidents` at ride start
  keep her from announcing or briefing it. Only traffic is dismissable. Checked in headless Chromium.
- THE ISLAND (owner's name for the dark card at the top of the ride map; built 2026-10-17, `ui/island.ts`): the cues
  come from `glanceCues` (rideView.ts, pure: fuel range when under 1.5x the warning, rain, traffic, off route / route,
  sunset within the hour, the area, a nearby place, speed), each with a `key` (changes when the news does), a `short`
  form, one `action` and a `progress`. Behaviours, each a switch in Garage > The island (`CONFIG.island`; first four on
  by default, progress off): compact pill that grows for 10 s when the most pressing cue's key changes (the first cue
  of a ride and plain speed are not news); tap to grow and keep it open, tap to shrink; swipe sideways to browse (dots,
  back to the most pressing after 20 s); one button per card: Filled up (the data-filled flow), Will it last? (asks
  her about rain), Tell me (traffic), Up ahead (route: a sheet of the named stops still ahead with km and clock time,
  `stopsAhead`, and the finish), Tell me a story (forces an untold area_story), What's that? (asks about the place);
  progress bars for route done, fuel range left of a full tank, and the last hour of light. "Show the island" (the old
  Visual companion switch, `showGlance`) moved into that card. `islandView` is pure and tested. Not tried on a phone.
- Suburb borders (2026-10-17, owner chose option A, OFF by default: Garage > The map > Suburb borders). OpenStreetMap
  has NO suburb boundaries around Gauteng (only suburb centre points, 26 around Edenvale, plus council wards; checked
  with Overpass), Property24's are proprietary. So borders are ESTIMATED: `voronoiCells` (mapView.ts) gives each suburb
  the area closer to its centre than to any other, drawn faint sage (1.1 px, 50%), names only at 8 km across or
  closer, nothing beyond 30 km. The metro boundary (admin_level 6, real) is a darker dashed line. Data: `api/borders`
  per 0.1 degree tile (one Overpass query, mirror overpass.kumi.systems on failure, edge cache a week); Overpass takes
  ~20 s a tile and rate-limits (HTTP 429 with two at once), so `adapters/BorderTiles` fetches one tile at a time, only
  for views up to 12 km across, keeps tiles in `betty.borders.v1` for good, and repaints both maps as they arrive.
  0.05 degree tiles needed ~16 for one view (minutes): hence 0.1.
- Ride card place names and metro line (2026-10-17, owner: "labels and line", each a Garage > The map switch,
  `CONFIG.cardPlaces`/`cardMetro`, ON by default). The suburb borders were never on the card (hidden past 30 km
  across). `adapters/CardExtras` starts when a ride's story opens: `/api/area` at the ride's first and last point
  (their suburb, or town, is left off while "Hide where I start and finish" is ticked) and at 8 points spread along
  the trimmed road (`samplesAlong`), one a second (Nominatim); `/api/borders?box=` (whole 0.1 degrees, max 1.5 a side,
  ~30 s on Overpass for a 90 km ride) gives only the admin_level 6 lines. Kept per ride in `betty.cardmap.v1` (12,
  only when every lookup worked). Share waits up to 40 s for it. `pickLabels`: towns at 25 km across and up, suburbs
  below, each once at the middle of its run, at most 6 spread along; `labelsSvg` puts each name above or below its dot,
  drops overlaps and anything under the weather pill (`avoid`). `api/area` now strips "City of" / "Local
  Municipality" from every name (Westonaria was read out as "Westonaria Local Municipality").
  The ride's STORY map shows them too (owner: "so it doesn't have to fetch those when sharing"): `prepareCard` returns
  the fetch promise and the story map is repainted when it lands (`mapExtras`, every name: the story is private;
  `labelSize` 26 since that map is about half the card's scale). Share button: disabled while busy, each step on its
  label (`status` callback: Finding the places on your road / Making your ride card / Opening share), label restored.
- Story lists fold (2026-10-17, owner: "can be quite long"): `foldList` shows the first 4 moments / 5 lines, the rest
  `li.more` hidden by `.moments.folded`; a full-width `.text-button` "Show all N ..." / "Show less" (chevron turns)
  toggles the class. Lists only one item over the limit are shown whole.
## Service reminders (2026-10-17, owner: "yes build reminders")

HANDBOOK SCHEDULE (owner's photo of the G 310 GS handbook p. 140, 2026-10-17): `BIKES` holds bike schedules
(`bmw-g310gs`: yearly standard service; oil + filter 10,000 km or yearly; air filter, spark plug, valve clearance, fork
oil 20,000 km; fuel filters + hoses and intake silencer hoses + tank vent valve 40,000 km or 4 years; brake fluid 2
years (first after 1 year); running-in check left out) plus `RIDER_CARE` (chain 600 km, tyre pressures 14 days, tyre
age 5 years). `bikeBook` assumes schedule items done at the last milestone below the odometer (`assumed: true`, shown
as "last done: a guess"); `alignToOdometer` redoes that when he sets the odometer (his own and confirmed items keep
their km since); `upgradeBook` turns a book saved before this (no `bike`) into the schedule, dropping the generic
"Service" if untouched. `ServiceBook.bike` is the id: changing bikes is Backlog item 1.
`core/Reminders.ts` (pure, tested): `Reminder {id, name, everyKm|null, everyDays|null, lastKm, lastAt}`, `ServiceBook
{odoKm, items}`; `dueInfo` (ok / soon = within a tenth of the interval, at least 100 km or 7 days / due), `dueList`
(most pressing first), `dueText` ("in 80 km", "50 km overdue", "in 12 months"; en-US digit grouping so a voice reads
"9,350", not "9 350"), `markDone`, `starterBook` (chain 600 km, tyre pressures 14 days, service 10,000 km or a year:
COMMON GUIDANCE, not checked against the G 310 GS handbook; tyre age 5 years), `findReminder` (word stems: "lubed the
chain" -> chain), `describeDue`. `adapters/ServiceStore` (`betty.service.v1`, in the backup; first load saves the
starter set from that day, odometer 0). Betty's odometer = km of REAL rides (not desk sessions), added as a delta in
`remember()` each minute so an odometer he sets mid-ride is kept; setting the odometer in Garage shifts every
`lastKm` by the same amount (what is due does not change). Garage > Reminders (`ui/RemindersCard.ts`): odometer, rows
(tap = edit sheet `data-sheet="reminder"`: name, every km, or every N days/weeks/months/years, last done km ago and
date; Delete), Done, Add. NOT DONE (owner, 2026-10-17): `markDone` keeps `prev` (lastKm, lastAt, assumed) and
`undoDone` restores it; right after Done the row's button reads Undo (until he leaves the Garage), later the edit
sheet offers "Mark as not done (back to <date>)" while `prev` exists; voice `{kind: 'undone'}` ("chain not done",
"undo the oil"). ISLAND (2026-10-18): `islandReminder` (overdue, or within `ISLAND_KM` 500 / `ISLAND_DAYS` 7) -> `RideInput.service`
-> a `service` cue (wrench, "Maintenance", pill "Engine oil in 416 km", progress over the last 500 km), after sunset and
before the area; no button. `canUndo`: also a handbook item with no `prev` (his oil was marked Done before Undo shipped): back to
the milestone below the odometer, `assumed` again. Voice: `{kind: 'done', what}` ("chain done", "I lubed the chain", "the bike was serviced",
"mark tyre pressures as done"; after `end`, so "I'm done" still ends the ride); a "done" that matches no reminder is
passed to her as a question. She mentions due/soon items in the briefing and the sign-off, answers get them (all of
them when he asks about service/maintenance/chain/tyres), the home Details sheet has a Maintenance row.
NOT BUILT: a phone notification. A web page can only notify from the background with web push (a push server and
the installed app); for now reminders surface when he opens or rides with Betty.
iPhone zoom (same day): Safari zooms into any field under 16px when tapped (the search boxes were 14px); every field
is 16px on iOS (`@supports (-webkit-touch-callout: none)`). Android does not zoom.

## My journeys, improved (2026-10-18, owner's order 1+2, 3+4, 5-8)

Storage first: `MAX_REMEMBERED_RIDES` 30 -> 500, `TrackStore` 12 -> 30 detailed tracks, and `adapters/RoadStore`
(`betty.roads.v1`): a ROUGH copy of every ride's road (60 points, 4 decimals, ~1 KB, 500 rides), saved with the track
(real rides only) and seeded once from TrackStore. Rows and maps read `ctx.roads()` ONCE per render (not per row).
1. `core/Journeys` `groupByMonth` (newest month first, km, riding minutes, fuel): newest month open, older months one
   header line (`.month-head`, `data-month-toggle`); his open/closed choice survives repaints.
2. `ui/miniMap` `miniTrackSvg`: the road fitted into 56 px, map colours, start dot; `CONFIG.journeyThumbs` (Garage >
   In your garage > Road drawings in My journeys, owner asked for the switch).
3. Your roads: static `#roadscard` in index.html; `mapSvg` `roads` draws every rough road faint (opacity .38, so
   overlaps darken); `fitView` over all points; `attachMapGestures`; a tap (< 8 px move) is hit-tested against every
   road's segments (nearest within ~14 px) and opens that ride.
4. `core/Records` `rideRecords`: longest (km), longest in the saddle (riding time), furthest from the ride's own start
   (no home known), highest (`RideRecord.highM`, from `RideStats.highM`, max GPS altitude while moving, rides from
   2026-10-18 on), best month, weeks in a row (Monday weeks, counted back from this or last week) and best run, next km
   milestone (`KM_MILESTONES`) and ride count. Speed is deliberately not a record. Live: `ride_record` (P3, unprompted,
   flavour: celebrate, never suggest riding further/faster): passing his longest ride (>= 3 rides behind him, longest
   >= 10 km), once a ride; crossing a total-km milestone. Not while quiet or parked. `liveRecords(RideLog)` at start.

5-8 (same day): `monthNumbers` (this month so far vs last month at the SAME day of the month; 8 Monday weeks, i = 7 is
this week) -> `#journeymonth` card with week bars and Share <month>. `onThisDay`: owner asked for 1, 3, 6 and 12 months
ago (`LOOK_BACK`), not only a year; a month without the date is skipped; the longest ride that day. `findRides` (every
word in name, places, weather or the long date, so "Saturday", "October 2026" work) + `#journeystarred`; while finding,
the cards and months get `.search-hide` and `#journeyfound` lists the hits. `adapters/JourneyStore` (`betty.journeys.v1`,
starred ids and his names, cached in memory); `rideTitle` (HomeScreen) returns his name first, so it shows everywhere,
the ride card included. Story: Star / Rename (in-place field; Enter or blur saves, Escape cancels, empty = automatic).
`ui/monthCard.ts` `drawMonthCard` (reuses rideCard's exported canvas helpers): month, places, every rough road of the
month on one map (`fitView`), km / rides / riding / fuel, best line of the month (`bestLine`), shared like the ride card;
`ctx.shareMonth`, button on the month card and at the bottom of an opened older month.

Long names and delete (same day): rows are `div role=button tabindex=0` (iPhone Safari does not scroll inside a
<button>); `.ride-name` scrolls sideways, `.more` adds a right-edge fade while there is more (set after layout,
`markLongNames`); Enter/Space open a focused row. Delete: story page `[data-delete]` -> in-place confirm ->
`ctx.deleteRide` (main: refuses the running ride; `RideLog.remove`, `LineLogStore.removeRide`, `TrackStore.remove`,
`RoadStore.remove`, `JourneyStore.forget`, `cardExtras.forget`; filters `unsaved` so the next log save does not put
its lines back). Fuel count and odometer are NOT changed. SELECT MODE: `#journeyselect` (Select/Done) -> rows become
`role=checkbox` with a `.pick` tick in place of the drawing, a tap ticks; open months get Select all/none; sticky
`#journeyselectbar`: "N selected", Short ones (< 5 min or < 2 km, all rides), Cancel, Delete N -> in-bar confirm ->
`ctx.deleteRide` for each. Works on search/Starred results too. LATER THE SAME DAY (owner: the Select button took
space): no Select button; `#journeyselect` is a round PENCIL button at the top right of the header (`.edit-pencil`,
absolute; owner rejected a text "Edit" link that wrapped onto its own line, and kept the privacy pill), "Done" is in the
floating bar (`data-sel="done"`), the pencil only lights up (`.on`) and scrolls to `#journeylist` when tapped (owner:
Done at the top was awkward); "Short rides" (renamed from Short ones; toast says how many it ticked); the bar also has ★ Star / ☆ Unstar for the ticked rides; HOLD a row 450 ms (pointer moved > 8 px cancels, so swiping a long name is not a hold) to enter select
mode with it ticked, the click after the hold is swallowed; `-webkit-touch-callout: none` stops the iPhone menu; a
one-time toast "Tip: hold a ride..." (`betty.hint.hold`, only with 5+ rides). Starred = `.search-star` ☆/★ inside
the search box.

## Route: what is ahead (BUILT 2026-10-18; UNVERIFIED ON A RIDE)

`core/RouteAhead.ts` (pure, tested): `checkpoints(route, progress, everyKm=40, max=8)` = named stops still ahead plus a
point every 40 km between them, with km and minutes from now (planned minutes per km, plus `RouteStop.stayMin` of stops
passed on the way); `weatherAlong` picks each checkpoint's Open-Meteo HOURLY values at the hour he arrives (local ISO
times); `rainAhead` (>= 60% within 120 min); `describeRouteWeather`; `rideAgainStops` (start, points along, end as
"lat,lon" stops: api/route routes coordinates as they are). `routeProgress.leftMin` adds stays of stops still ahead.
`adapters/RouteWeather` `fetchRouteWeather`: ONE Open-Meteo request for all checkpoints (comma lists, checked live;
returns an array), 48 h, coords to 2 decimals. `adapters/AreaSource` `researchArea` (shared) and `researchAhead`
(towns at the named stops: api/area then api/story if not kept; one at a time). Engine: `setRouteWeather`,
`route_weather` P2 once per place a ride ("rain likely around Villiers at about 11:40"), route weather in the briefing
and in answers. main: weather at ride start and every 30 min (`routeWxTimer`), stories ahead at ride start (server).
Where to? (`ui/RoutePlanner`): `#routestops` (each named stop after the start: km, arrival if leaving now, weather
then, stories ready; a stay `select` for every stop but the finish, saved on the route), Save route
(`RouteStore.save`, `betty.routes.saved.v1`, 20) and `#savedroutes` (use, ×). My journeys: "Ride this again"
(`ctx.rideAgain`) when a road was kept: plans it, names it "Again: <title>", opens Where to?.

## The longer list, built 2026-10-18 (owner: "add the longer list items, excluding the hardware stage"); ALL UNVERIFIED ON A RIDE

- Voice dials: `{kind: 'length'}` ("shorter/longer answers", `nudgeLength`, 1-5), `{kind: 'mixset'}` ("banter 70
  percent": `setMixShare` keeps the other two in proportion; "silence N percent" works because the quiet command skips
  "silence" + a number), `{kind: 'mode'}` save/use/which: `CONFIG.modes` (name -> `SavedMode`: mix, gap, line length,
  persona), also offered in Garage > Narration ("(yours)").
- Fatigue (`fatigue` P2, core/Comfort): riding minutes since the last 15-minute stop >= 120 (60 between 22:00 and
  05:00), again every 60; names the next route stop. Wind and cold (`wind_cold` P2): Open-Meteo now also gives
  `wind_gusts_10m`/`wind_direction_10m`; gust across his heading >= 40 km/h (once in 30 min), wind chill at his speed
  (+ head wind) <= 5 C once a ride (formula: Environment Canada / JAG-TI, only at or below 10 C).
- New roads (core/RoadMemory, adapters/RoadCells `betty.cells.v1`): ~200 m cells (0.002 deg) with ride counts, seeded
  once from TrackStore (detailed) then RoadStore (rough) roads with gaps filled every 100 m, capped at 60,000 cells;
  each real ride adds itself (saved idempotently each minute: base + this ride's cells). `new_road` P3 (unprompted) when
  the last 10 cells are new (9 of 10), >= 3 rides behind him, once in 20 min, not while quiet/parked; answers get how
  often he has ridden this stretch.
- Memory across rides (core/PastRides): `PAST_CUE` (yesterday, last ride/week/month, weekdays, dates, remember, you
  said...) -> `pickRides` (a day, "yesterday", "last week", a date, narrowed or found by a place) -> `recallRide` (when,
  km, places, his questions from `[voice] heard "..."`, up to 8 of her lines) into the answer, via
  `engine.setPastRecall` (main reads RideLog + LineLogStore).
- Rough patches (core/RoughSpots): `RideStats.rough` (hard brake / a jolt, with position, 60 max) -> `RideRecord.rough`
  [lat, lon, 1|2]; amber dots on the ride's story map; a ~110 m cell with bumps on 2+ rides or hard brakes on 3+ rides
  -> `rough_patch` P2 within 300 m ahead (50 deg), once per spot in 10 min, never steering advice.
- Plan a ride with Betty: `api/plan` (Haiku + web search max 3, `planPrompt`: work out the distance the time allows,
  furthest stop at most half; "HOME" = back to the start; vary from the places he rides most; JSON) -> `parsePlan` ->
  the page routes the stops with api/route (`#routeask`); `PlannedRoute.why` shown in Where to?. Checked live: "a
  two-hour breakfast run, twisty, back by lunch" from Edenvale -> Heidelberg, Suikerbosrand, Nigel, home (the first
  version sent him to Hekpoort: too far, hence the distance rule). After deploy Haiku sent the same ask to Kaapsehoop
  (300 km): api/plan now uses SONNET (thinking between_tools; checked: Cullinan ~140 km, the Cradle), and the page
  checks the routed time against `wantedMinutes(ask)`: over 1.4x, api/plan is asked once more with `feedback` ("it
  came to 600 km and about 7 hours, he wants about 120 minutes").
- Share with a friend's Betty (core/Share): a `betty-share` JSON (routes, spots, stories) sent with the share sheet
  (`shareJson`) from a ride's page (the ride as a route: `rideAsRoute`, Google link through 10 points, plus its places'
  stories) or Explore (`#exploreshare`: all spots and stories). Garage > Import a backup recognises it (`parsePack`) and
  MERGES (`mergeSpots` skips spots within ~30 m and labels "(from X)", `mergeStories` adds only stories she lacks,
  routes go to saved routes); nothing replaced, no reload, his rides never enter the friend's journeys.
- Smarter web answers (`CONFIG.smartSearch`, Garage > Talking to Betty): forced-search answers go to
  `claude-sonnet-5-5` with thinking `between_tools` (Sonnet rejects "disabled") and NO tool_choice (Sonnet rejects
  forced tools: "not supported for this model"), the search asked for in the system prompt; max_tokens capped at 500
  (api/phrase limit). Checked live: the RPM question came back right (about 52 to 103 km/h in sixth), ~5.7 s.
- Workshop scenarios (`ui/scenarios.ts`, SIMULATOR > Scenarios): overheat on the N3, rain front, closure ahead, cold
  and windy, rough road; `play(scenario, agg)` sets overrides over time, Stop clears them.
- Offline line bank (core/LineBank, adapters/LineBankStore `betty.linebank.v1`): `BANK_SPEC` = alert ids with blanks;
  engine `slotsFor` puts the live values on each event (`TriggerEvent.slots`); `ClaudeClient.useBank`: when Claude
  cannot be asked (network error, timeout, HTTP error, no key, or a P1) a variant is filled and spoken (`source: 'bank'`)
  before the canned fallback; variants rotate, one with a missing value is skipped. Refilled at most once a day (server
  only), 4 alerts per api/phrase request, 3 variants each, "sir" written out becomes {rider}. Area stories' fallback is
  now the note itself ("You're riding through X. <note>"), and an ambient SILENT never falls back to it.
- NOT built from the list, and why: group rides (two Bettys sharing position live needs a realtime server and both
  phones online: with the native app), staying quiet during a phone call (a web page cannot see calls: native).

## Garage search and Help (2026-10-17, owner)

`ui/help.ts` is the content as data: `VOICE_COMMANDS` (groups of {say[], does, kind}; a core test runs EVERY phrase
through `parseCommand` and checks each command kind is listed: add a command -> add it here or the test fails),
`GOOD_QUESTIONS`, `HELP_TOPICS` ({id, title, keywords, html}; `commands` is written from VOICE_COMMANDS), `searchHelp`
(every word must match; title 3, keywords 2, body 1). `ui/screens/HelpScreen.ts`: the `help` screen (static section,
`<details>` per topic, its own search, swipe/Back to Garage, restorable after a refresh) and the Garage search
(`#garagesearch`: hides non-matching `.settings-card` children and cards with `.search-hide`, never `hidden`, which
rows use for their own state; `#garagefound` lists matching commands and topics). `[data-help="<topic id>"]` anywhere
opens Help at that topic (Garage Help card, the ask sheet's "What can I say?", the empty Journeys page). Keep the
help text true when behaviour changes: it states button mappings, limits (12 s, 10 min parked) and fuel defaults.

## Long ride of 2026-10-17 (219 min, 93 km): fixes, owner's answers per item

- **Web search** (owner: "we really need to fix that web search"): she said "I shall search that speed now" seven
  times without searching. `core/Heard.ts` `wantsSearch` (search / look it up / Google / internet / online, Whisper's
  "whipserge", "did you look it up?", and current things: price, availability, reviews, events, news, which bike
  should I get) makes `ClaudeClient` send `tool_choice: {type: 'tool', name: 'web_search'}` (checked live: works with
  Haiku 5.5 and thinking disabled, ~4 s; api/phrase accepts that tool_choice and nothing else). A reply that did not
  search and `putsOff` ("I shall search", "let me check", "I cannot confirm", "I don't know the book") is asked AGAIN
  with the search forced (`detail` says "searched on the second go"). The answer prompt now allows common knowledge
  (books, history, how bikes work, gearing; owner: Animal Farm), says search rather than "I don't know", km/h and
  rand, give results not working, never mention searching or sources (`META` drops "the results were...", "I
  searched"). Weak spot left: Haiku is poor at gearing sums from search snippets (RPM to road speed rambled); Sonnet
  for searched answers is the owner's option if it matters.
- **No padding**: answers only what he asked (no speed / off-route / time left unless asked). Never offer directions
  back to the route (she did: "Shall I give you the way back on track?").
- **Detour**: `saysDetour` anywhere in his words (before the command parse: "please remember I am on a detour" is
  also a remember command) -> `engine.setDetour(true)`: no `off_route` until he has left and come back on the route;
  answers are told it is by choice; the island says "On a detour".
- **Fill-up said in passing**: `saysFilledUp` ("I was just filling up some fuel", topped up, got petrol, full tank;
  not "where can I fill up", "I need petrol") clicks Filled up and tells her answer. Logged `[heard]`.
- **Parked** (~80 min at about 08:45-10:12 with time checks running): `ride_parked` (see Triggers), and an "end ride"
  voice command (`{kind: 'end'}`: "end ride", "end the ride please", "we're done for today"; runs `stop()`).
- **Riding vs stopped time** (owner: a setting, default on, and show both): `RideRecord.movingMin` (moving > 3 km/h);
  `rideMinutes(r, CONFIG.ridingTimeOnly)` for the Journeys list, totals, story, ride card and the live ride screen
  ("min riding"); the story shows a `.time-split` bar ("2h 19m riding / 1h 20m stopped"). Older rides have no
  movingMin and show their whole time. Time checks, the debrief and ride memory mention the split.
- **Time checks**: his 5 min TUNING stays (owner: "my default is fine"). Each gets a `MILESTONE_ANGLES` angle in turn
  plus distance/weather/area facts, and `ClaudeClient` passes her earlier lines of the same kind this ride
  (`byKind`, last 6, for every unprompted id) with "make this one different from all of them".
- **Louder voice** (owner: adjustable): `CONFIG.voiceBoostDb` 0-16, default 6, Garage > Voice & audio slider. Chirp:
  `volumeGainDb` on Google's side (`gainDb` in the api/speak body, so in the clip key). Gemini: kept clips stay as
  made; `core/Loudness` `boostWav` (gain + peak limiter, Gemini clips already peak at 0 dB, RMS -16.6) at play time,
  and the streamed path runs the same `Limiter` in PcmPlayer. The phone voice cannot go above 100%.
- **Recording cap 12 s** (was 8; many questions hit the cap in wind). Owner asked about "until silence or a button
  press": silence already ends it (1.2 s pause), and a press during a recording cannot reach the page (call mode).
- **Bumps**: the `surface` banter topic is gone and `JOLT_MS2` is 20 (about 2 g; was 8, 2,402 "jolts" on this ride).
- **Previous track = let go** (owner: "make her end call mode when previous track is selected"): `letGo` closes the
  mic (`ptt.release()`), plays a low tone and stops the button track (`buttons.stop()`), so the next app to play gets
  the buttons. Betty keeps working (her lines then play on the plain element, which on iPhone may pause his music).
  `#buttonsback` on the ride screen ("Give Betty the headset buttons back") primes and restarts them inside the tap.
  Taking them back with a button press is not possible from a web page once another app plays. UNVERIFIED ON A RIDE.
- Not changed (owner): the repeated Sandton story was his next-track repeat; CAR-BT_9578 was his CarPlay screen.

## Explore (2026-10-17, owner: "gets very long once you've started traveling"; plan: 1+2, then 4+5, then 3+6)

- 1 Area cards: `core/Explore` `areaCards` groups `AreaStore` entries by plain name (`plainArea` merges "Westonaria
  Local Municipality" into "Westonaria", same story text kept once), unheard first, newest area first; `filterCard`
  for the search box (`#exploresearch`, every word must match; an area-name match keeps all its stories, otherwise
  only matching stories and the card opens) and the "Not heard yet" tab. Card: ring (heard of total, unheard count in
  the middle), tap to open, stories folded to 3 (`ui/fold.ts`, shared with the ride page; `unfolded` keeps an opened
  list open across re-renders). Spots and notes are still listed first (newest first) and searchable.
- 2 Listen: `ctx.listen` in main.ts (`listenStory`): `CONFIG.listenVoice` chirp (DEFAULT, owner) / gemini / phone,
  Garage > Stories at home. Clips made once and kept in their own IndexedDB store (`betty-stories`, 400), Gemini falls
  back to Chirp, any failure to the phone voice. Heard to the END = told (`ToldStore`), so she will not tell it on a
  ride; stopping early does not count. Leaving the screen stops it.
- 4 Map (Map/List button `#exploremode`, `#exploremap`, static in index.html): `areaPins` in mapView (yellow with the
  unheard count, sage when all heard, radius grows with unheard; names placed where they fit, biggest first) plus his
  marked spots (`markRadius` 12). Pan/zoom with `attachMapGestures`; a tap (not a drag, < 8 px) is hit-tested against
  the projected dots (within ~14 px of the edge) and opens the `explorepin` sheet with the area card (open, Listen,
  Ride there) or the spot. `fitView` fits the VISIBLE part (the 660 x 500 sketch is cropped to a tall phone box). The
  Notes tab has no map (list shown). Search and tabs filter the dots. `.explore-map` is excluded from pull-to-refresh
  and edge stretch. Areas with no position: `ctx.locate` -> `/api/area?q=<name, region>` (Nominatim search, ZA, a week
  at the edge), one a second, `AreaStore.place`, repaint on `betty-memory`.
- 5 Ride there: `ctx.rideThere(name)` shows home, fills `#routeinput`, opens the `mode` sheet (he picks twisty and
  taps Plan; not auto-planned so he can choose). Areas only; spots have Open map.
- 3 Story of the day (`storyOfDay`): an unheard story picked by a hash of the local date (stable order by note id,
  no storage); the screen keeps the day's pick in memory so hearing it shows "Hear it again" instead of swapping it.
  On top of Everything / Area stories / Not heard yet, not while searching; Listen and "More from <area>" (opens and
  scrolls to the card).
- 6 Tally (`exploreStats`, `#explorestats`): areas, stories heard of all, spots, areas new this week (`NEW_FOR_MS`,
  from `at` = first researched), plus a New tag on those cards. Counts everything, not just the current filter.
- `AreaStore` now keeps where each area was found (`lat`/`lon`, his rounded position; `at` = first researched). Older
  areas get theirs the next time he rides through, or are looked up for the map (step 4).
## Simulator and tuning (dev tools, ship with the app)

START RIDE has a "Use real phone sensors" checkbox. Untick it on desktop for a fully simulated session (no GPS or
motion permission prompts; feeds fall back to `CONFIG.feeds.fallbackLocation`).

SIMULATOR panel (mounted while a ride runs):
- Sliders for GPS speed, lean, RPM, engine temp, throttle, fuel. Tick a row to override the live value; untick to
  restore the real one (implemented as `StateAggregator.setOverride/clearOverride`).
- Weather override (rain chance, rain now, air temp, wind).
- Inject traffic incidents (accident 2 km, closure 1 km, minor slowdown 8 km which is outside the default radius),
  inject/clear a fault code, zero lean, refresh feeds, reset ride (clears cooldowns, mock ramps, queue, log).
- "Speak aloud" off = silent mode: speech is simulated with a duration so you can watch queueing without audio.
- One button per trigger id to fire it now (ignores cooldown, uses the current priority).
- Info line: safe-window yes/no, what is speaking, queue length, feed status.

TUNING panel: per-trigger priority (P1-P4) and cooldown, ambient gap and max age, milestone interval, thresholds
(overtemp, fuel, rain chance, traffic radius/severity), safe-window limits, reset to defaults.

## Feeds

- **Weather**: Open-Meteo (`api.open-meteo.com/v1/forecast`), no key, CORS-enabled, free for non-commercial use.
  Also requests `daily=sunrise,sunset&forecast_days=2`. Verified against the live API on 2026-10-10.
  Requests `current=temperature_2m,precipitation,wind_speed_10m,weather_code` and
  `hourly=precipitation_probability&forecast_hours=3`. Rain chance = max of the first two hourly values.
- **Places (tour guide)**: Wikipedia in two steps. (1) `generator=geosearch` over `ambient.placeRadiusKm` (default
  6 km, API max 10) with `prop=info|coordinates`, up to 50 articles; list pages and stubs under 2,500 bytes are
  dropped and the 8 largest kept, since article size is the best cheap sign of a story. (2) For each, a separate
  request for the first 1,800 characters as plain text (the API caps it near 1,200), which reaches into the History
  section; section titles and bare lists are stripped. `NearbyPlace.interest` is the article size and `freshPlace`
  takes the richest unmentioned place in range, not the nearest. Requests go one at a time: eight in parallel got
  HTTP 429 in testing. A partly failed read is used but not cached. Checked live for Edenvale and Pretoria.
- **Traffic polling (owner, 2026-10-17)**: every 5 min (was 2), only on a real ride (no live traffic in desk or
  simulated sessions: inject from the simulator) and not while parked under 5 km/h (`TrafficSource` `moving`), plus
  a first look at ride start. Reason: TomTom Traffic Incident Details is 2,500 free a MONTH.
- **Traffic**: there is no keyless live-traffic-incident API. The real provider is TomTom Traffic Incident Details v5
  (free developer key, set `VITE_TOMTOM_API_KEY`; free-tier limits not confirmed from the docs read, check them).
  LIVE as of 2026-10-09: the owner added the key (in `.env` and in Vercel production env) and the parser
  (`parseTomTom`) was checked against a real Gauteng response. It now also reads `delay` (seconds) and `length`
  (metres), turns "Closed" into "a road closure", and merges the two directions of one closure. A city has dozens
  of incidents in range, so `worthMentioning` in TriggerEngine only passes ones that are in radius, severe enough,
  cost at least `thresholds.trafficMinDelaySec` (120 s), are not closures under 150 m, and, once he is moving with
  a GPS course, lie within 50 degrees of straight ahead. Without a key, traffic is simulator-only.
  Other providers looked at: HERE has a free tier whose traffic allowance sources disagree on; Waze has no public
  API (its data programme is for government partners; "Waze APIs" on the market are unofficial scrapers); Google and
  Mapbox offer traffic-aware routing rather than a free incident feed. TomTom's free quota is quoted as 2,500
  requests per day by some sources and per month by its pricing page: CHECK, because Betty polls every 2 minutes
  (about 60 calls on a 2 hour ride, fine daily, tight monthly). `TrafficProvider` is an interface: another provider is one small class.
- Both sources only update `BikeState.weather` / `.incidents`; triggers decide what to say.

## Browser constraints (learned the hard way, keep in mind)

- Geolocation, device motion and speech need HTTPS. `localhost` is exempt, so phone testing needs a deployed URL.
- iOS: motion permission (`DeviceOrientationEvent.requestPermission`) and speech priming must be triggered
  directly from a tap, before other awaits. `main.ts` does this at the top of `start()`.
- The `#wake` line under the status shows whether the screen wake lock is held (green) or not (red). The system
  drops the lock when the tab is hidden; `WakeLock` re-acquires it when the tab returns.
- Backgrounded tab / locked screen = GPS and timers throttled, Betty effectively stops. Wake lock mitigates
  but does not solve it. This is the main limitation versus native and the reason for Phase 4.
  EXCEPT while the page plays sound: with the headset-button loop running she kept working locked and in the
  background (2026-10-14). See voice input stage 2.
- Lean does NOT come from the phone's tilt sensor any more. On a handlebar mount it read past 20 degrees from
  mounting angle and vibration alone (road test, 2026-10-09). `GpsLean` estimates it from GPS speed and how fast the
  course is changing, which is independent of the mount. It is a balanced-turn estimate from about one fix per
  second: good for "how twisty", too coarse for a true peak angle, zero below 15 km/h. There is nothing to zero.
- Other senses added 2026-10-09, all UNVERIFIED ON THE BIKE: GPS altitude (climb/descent, wobble under 8 m ignored),
  GPS course (direction of travel, and where a place lies: ahead/behind/left/right), hard braking and hard
  acceleration from GPS speed change (about 0.35 g, in `RideStats`), accelerometer jolts (spikes over about 0.8 g,
  which engine vibration on a single may also trigger; tune `JOLT_MS2` after a real ride), and the phone compass as
  a heading when stopped (mount-dependent on iOS, treat as rough).
  These feed `RideStats`, banter topics and the tour-guide line; none of them triggers an alert.
- Place distances are recomputed from the current position (`placesFromHere`), not the fetch position.
- Web Bluetooth does not exist on iOS, so a browser cannot read an ELM327 dongle there. Real OBD2 = the native app
  (since 2026-10-18; it was Phase 4, the Pi).

## Vercel deployment

- Framework preset: Vite. Build command `npm run build`, output directory `dist`. `vercel.json` only sets the
  functions' region to Cape Town (`cpt1`, 2026-10-16, owner's OK): they ran in Washington (`iad1`) before. Measured
  from Gauteng afterwards: Claude about 1.0 s, Chirp 0.9 to 1.2 s (was 1.3 to 2 s). `x-vercel-id` shows `cpt1::cpt1`.
- KEYS LIVE ON THE SERVER since 2026-10-14. `api/phrase.ts`, `api/traffic.ts`, `api/transcribe.ts` are Vercel
  functions (web-standard `POST`/`GET` exports; `api/_shared.ts` is not an endpoint). Production env:
  `ANTHROPIC_API_KEY`, `TOMTOM_API_KEY`, `GROQ_API_KEY` (server-only, Secret) and `VITE_USE_SERVER=1`, which makes
  the page call `/api/*` instead of the providers. `VITE_ANTHROPIC_API_KEY`/`VITE_TOMTOM_API_KEY` were REMOVED from
  Vercel; they remain only in the local `.env` for `npm run dev`, where the page calls the providers directly.
- The functions refuse other origins (`fromBetty`), only allow Betty's models and a capped `max_tokens`, and cap the
  traffic box and audio size. That stops casual reuse, not a determined script: keep spend limits on the keys.
- `.vercelignore` excludes `.env*`. Before it existed, `vercel deploy` uploaded the local `.env` and Vite baked the
  VITE_ keys into the page even with them removed from Vercel's env. Server functions in an ESM package must import
  siblings with a `.js` extension (`./_shared.js`), or they crash with FUNCTION_INVOCATION_FAILED.
- Older deployment URLs (betty-<hash>-....vercel.app) still serve the old pages with the keys inside: rotate the
  Claude and TomTom keys, and/or delete old deployments.
- Never commit `.env`. `.env.example` documents the variables.

## Voice input, stages 0 and 1 (BUILT 2026-10-14)

Plan agreed with the owner: 0 hardware test, 1 typed conversation, 2 push-to-talk (cloud transcription, forces
the Vercel key proxy), 3 commands and memory ("quiet for ten minutes", "repeat that", "mark this spot"),
wake word last / on the Pi.
- **Stage 0, VOICE TEST panel** (`ui/VoiceTestPanel.ts`, always mounted): plays a looping near-silent WAV so the
  page becomes the phone's "now playing" app, registers Media Session handlers, and lists every headset button
  press that reaches the page. Optional: open the mic on a button press (does iOS allow it without a screen tap?).
  Records 5 s from the mic with the speed, the mic's name (is it the helmet?) and the loudest level, with playback
  and Save. Every finding is written to the saved log as `[voice-test]`. Browser pieces are injected (`VoiceDeps`)
  so the smoke test runs it with stand-ins.
  FIRST RESULTS (log of 2026-10-14, standing still): only `pause` reached the page (5 presses over 3 sessions; no
  next/previous track seen, either not pressed or not delivered). One button that reaches the page is enough for
  push-to-talk. The mic-on-button-press test was not run yet. The one recording came from "iPhone Microphone",
  not the helmet: the panel now has a "Record from" mic picker (`enumerateDevices`) and "Find mics", and logs the
  mics offered. Next: confirm the helmet mic appears and records, then record at speed.
- Sensors from the same log: the accelerometer works (about 60 readings a second). Hardest knocks 14 to 52 m/s2;
  jolts at the 8 m/s2 threshold ran 1 to 4 a minute on most rides but 484 in 28 minutes on one (probably the phone
  rattling in the mount). Threshold left as is for now; the owner has not asked for a change.
- Repeated closure: the same "Hendrik Potgieter Street" / "7th Street" closure near home was announced at the start
  of almost every ride. Announced incidents are now remembered for 7 days (`adapters/IncidentMemory`,
  `betty.incidents.v1`) by `incidentKey` (description + road, since TomTom ids may change), and not announced again.
- **Stage 1, CHAT panel** (`ui/ChatPanel.ts`, mounted per ride above SIMULATOR): this is the chat test mode spec
  below, minus scenario scripts. Typed text -> `TriggerEngine.ask(text, state)` -> `rider_query` event with
  `riderSaid` and a full `situationDigest` (banter facts + rain chance + traffic on his way + engine data or
  "not connected" + places nearby) -> `ClaudeClient` -> queue -> speaker, honouring Speak aloud. Her unprompted
  lines appear on the same timeline. Each of her bubbles shows source, latency, priority, trigger id, a Show
  prompt view of the exact request (`Phrase.request`, built even without a key) and, with the compare box ticked,
  the canned fallback. `ClaudeClient` keeps the last `TALK_MEMORY` (6) exchanges as real user/assistant turns
  for his questions only; Reset ride forgets them. The `rider_query` flavour prompt says answer what he asked and
  say "I don't know" rather than guess (superseded 2026-10-17: common knowledge allowed, search when unsure). Lines she makes up herself are `UNPROMPTED_IDS` (no clock, no readings).
  Checked live: rain, sunset follow-up, traffic, fuel range, engine ("no engine data connected") and "what was
  the first thing I asked" all answered correctly from the state and the conversation.

- **Stage 2, push-to-talk (BUILT 2026-10-14)**. Stage 0 on the bike: play/pause, next and previous track reach the
  page; a button press CAN open the mic with no screen tap; the helmet mic ("V6") records once picked. Taking the
  buttons pauses music from other apps (iPhone gives buttons to the last app to start sound), so it is a per-ride
  switch on the start screen (`CONFIG.headsetButtons`, default off). Mapping (owner): play/pause = talk (press
  again to finish), next track = repeat her last line, previous track = nothing (owner said no; since 2026-10-17 previous track = let go, see the long ride of 2026-10-17).
  `HeadsetButtons` (silent loop + Media Session, primed inside the START tap), `PushToTalk` (mic from
  `CONFIG.micDeviceId`, chosen in the VOICE TEST picker; `core/SilenceDetector` stops 1.2 s after speech, gives up
  after 4 s of nothing, 8 s cap, 12 s since 2026-10-17; mic closed straight after), tones at start and end, `AudioQueue.hold` so she does
  not talk over him (P1 still goes). Words go to `/api/transcribe` -> Groq `whisper-large-v3-turbo` (open-source
  Whisper; free tier 2,000 requests and 28,800 audio seconds a day, each request billed as at least 10 s; checked
  2026-10-14) with a hint of local names, then into the same `askBetty` path as the chat. The lock screen shows
  TAP TO TALK during a ride for when the buttons are not Betty's. Every step is logged as `[voice]`.
  Queue fix found on the way: items were sorted by the raw priority number, so a rider answer (P4) waited behind
  queued banter (P3). Order is now P1, P4, P2, P3.
  Still unverified: transcription quality at speed with wind, and the pause thresholds.
  GROQ_API_KEY set on Vercel 2026-10-16. Checked live: a spoken m4a clip ("Hey Betty, is it going to rain before
  I get to Edenvale?") came back word-perfect in about 1.5 s round trip from the owner's Mac.
  First stage 2 ride (2026-10-16): the first press worked end to end ("Hello, Pitty" -> answer in about 3.3 s from
  the end of speech), then NO further press reached the page, even with `resume()`. Changes: `PushToTalk` now keeps
  the mic open between questions until END RIDE (`release()`): closing it is the likely moment iPhone stopped
  sending the buttons. Cost: a helmet mic keeps the headset in call mode for the rest of the ride. Every press and
  any failed restart of the silent track is logged as `[voice]`. The clip came from "iPhone Microphone" with the
  helmet connected ("phone's choice"), so `chooseMic` now picks the saved mic by id, then by name (`micLabel`, ids
  can change), then any connected non-built-in mic; the picker's empty option is "Automatic (helmet if connected)".
  Whisper hint now includes "Hey Betty". UNVERIFIED ON THE PHONE.
  Correction from the owner: that ride's question was asked with TAP TO TALK, not the headset, and the second TAP
  also did nothing, and no line at all was logged after 16:37. So the recording path itself hangs on the second
  go (iPhone getUserMedia/MediaRecorder never answering is the likely cause), not only the buttons. Now: opening
  the mic times out after 6 s, the recorder is given up on 2 s after it is told to stop (`Clip.stalled`, the mic is
  reopened next time), transcription times out after 12 s, `hold` is always released, and each go logs
  `[voice] listening` first, so a hang shows exactly where it stopped.
- **Ride of 2026-10-16 16:48** (keep-mic-open version): TAP TO TALK worked four times in a row from "V6" (picked
  automatically), so the recording hang is fixed. The headset button still worked once only: one `button: pause`,
  then none. "It worked a few versions ago": the VOICE TEST on 2026-10-14 got five presses in one session, and the
  one thing talk-to-Betty adds that the test never had is the start/end tones, played from a separate Web Audio
  context. On iPhone that is the likely thief of the buttons. Tones now play ON the silent track itself
  (`HeadsetButtons.tone`, `toneWav`: swap src to the tone, back to the loop on `ended`); Web Audio `beep` is only
  used when the buttons are not Betty's. HeadsetButtons now also registers every action the VOICE TEST did
  (previous track, seek, stop do nothing, as the owner asked) and logs `silent track: pause/stalled/emptied`
  outside tones. The VOICE TEST button test refuses to run while a ride holds the buttons: its Stop set every
  handler to null, which also switched off Betty's (he opened it mid-ride at 16:49:39). Whisper hint gained
  Germiston, Bedfordview, Boksburg, Benoni, Midrand, Sandton ("Dremiston", "Jermiston" on this ride).
  UNVERIFIED ON THE PHONE: if presses still stop after the first, the `silent track:` lines say whether the track
  stopped.
  THEN the owner spotted the real cause (2026-10-16): with the mic kept open the iPhone's mic dot stays orange after
  he has finished, i.e. the helmet stays in CALL MODE, where its button sends call controls (answer/hang up), not
  play/pause. The keep-open change is reverted: `PushToTalk` closes the mic after every question (the 6 s/2 s
  time limits that fixed the tap hang stay). Consequence: a press DURING a recording cannot reach the page either
  (call mode), so a recording ends on the pause in his speech or the 8 s cap, not on a second press.
- **Rides of 2026-10-16 16:52 and 16:57: headset button and web search WORK.** Five presses in a row, mic closed
  after each; search answered Midrand and a J. Cole tour question, with "Hang on" covering 3 to 6 s. Fixed from
  them: an answer that narrated her instructions ("Since he asked about it, I'll say so plainly"), a Gautrain
  question answered from the ride data instead of searched, Whisper names ("Medrand", "Dremiston", "How Train").
  The answer prompt now says search when in doubt, treat misheard names as the nearest real one, talk to him as
  "you" and never describe what she is doing; `META` in cleanSpoken drops more such sentences. A first press that
  peaked at -31 dB counted as nothing and she said nothing: speech now starts at 0.025 (-32 dB), she waits 5 s, and
  "I didn't hear anything. Try again?" is spoken. Checked live: Medrand -> Midrand, How Train -> Gautrain lines,
  Dremiston -> Germiston, all from search in about 3 s.
- **Questions about places** (owner, 2026-10-16: "why is she not able to tell me about places i ask about?"): the
  answer digest held place NAMES only, and the answer prompt says "I don't know" rather than guess. Now
  `placesToExplain` adds notes (up to 900 characters each, at most 3) for any place whose name he used (any distance),
  the last place she talked about ("tell me more"), then the nearest; the prompt says those notes are her only source
  on a place. Checked live: "Tell me about Greenstone Hill" and "What else is interesting around here?" answered from
  the notes.
- **Web search for his questions** (owner, 2026-10-16: "she should still be able to go on wikipedia and the net to
  answer anything, especially if i ask about places not nearby"). `rider_query` requests with `riderSaid` carry
  Claude's server-side `web_search_20250305` (`WEB_SEARCH` in ClaudeClient; Haiku 5.5 takes the basic version, the
  `_20260209` one is Opus/Sonnet only), `max_uses: 2`, location Gauteng/ZA. Her own lines never search. The prompt
  says search only when the situation and notes do not cover it, say nothing before searching, never read out
  addresses or citations. `extractText` takes the text AFTER the last `web_search_tool_result`, joining the
  citation-split blocks. Answers get `RIDER_TIMEOUT_MS` (15 s); if one takes over 2.5 s, main.ts queues "Hang on,
  let me check." `AudioQueue.hold(true, true)` lets P4 through once he has finished talking while banter still
  waits. `api/phrase.ts` accepts no tool but that one, with `max_uses` <= 2. Cost: about $10 per 1,000 searches
  plus the result tokens. Checked live: Clarens (Free State) and Edenvale answered from search in about 3.4 s;
  the Clarens answer muddled two facts in its first sentence (Haiku summarising snippets). If that keeps happening,
  the owner's option is Sonnet for searched answers (slower, dearer).
  Rides of 2026-10-14 afternoon (VOICE TEST only; stage 2 not used yet):
  - **One press, then nothing**: opening the mic pauses the silent loop on iPhone, and a page that is not playing
    stops getting the buttons, so only the first press worked until the test was restarted. Both `HeadsetButtons`
    and the VOICE TEST panel now restart the loop after every recording and whenever it pauses
    (`resume()`, `playbackState = 'playing'`). Unverified on the phone.
  - **Runs in the background**: while the silent loop plays, Betty kept working with the screen locked and with
    another app in front (owner, 2026-10-14). iPhone keeps a page that is playing sound alive. This is the fix for
    the main limitation under Browser constraints, but only with the headset switch on (it costs his music).
  - **Helmet mic levels** (peaks): -26, -23, -17, -16, -1 dB talking at a standstill; -5 dB at 28 km/h, -34 dB at
    41 km/h (said nothing, or the V6 gates wind hard). The fixed speech level of 0.12 (-18 dB) would have missed
    quiet speech, so `SilenceDetector` now measures the background for 0.5 s and sets speech at 3x it (0.04 to
    0.15) and a pause at 1.6x (from 0.02). Every `[voice]` line logs the loudest level, to tune from.
- **Android (2026-10-16)**: a friend on Android Chrome with a Cardo Packtalk Neo got no button presses in the VOICE
  TEST. Chrome on Android only takes the media session (notification, headset buttons) for media at least 5 s long,
  and the silent loop was 1 s. `quietWav` is now 10 s. UNVERIFIED on Android: check the Betty media notification
  appears in the pull-down shade while the test listens. Second try, with another headset: still nothing, and the
  press OPENED A MUSIC APP, i.e. Android sent it to the last media app because Chrome held no media session. The
  VOICE TEST now logs whether the track is playing, that it is the 10 s loop, and the browser (user agent), and has
  a "faint hiss" option (`quietWav` level 300) to test whether Chrome ignores a track it cannot hear.
  After a proper reload buttons got through. Then RECORDING failed with the Cardo connected: every clip 0 KB and no
  level, from every mic offered (Default, Speakerphone, Headset earpiece, Bluetooth headset), "cancels as soon as it
  starts". His other (cheap Chinese) headset recorded fine on the same phone. Likely the Cardo refuses or drops the
  call-mode (SCO) link Android opens for the mic, and Android routes every mic through it while it is connected.
  The VOICE TEST now logs mic ended/muted/unmuted with times, recorder errors and the format, stops waiting when the
  mic ends, and has "Record without call processing" (echoCancellation/noiseSuppression/autoGainControl off).
  THAT WORKED: with call processing off the Cardo recorded. The checkbox is now a saved setting, `CONFIG.micRaw`
  (default off; iPhone + V6 are fine without it), and `PushToTalk` opens the mic the same way when it is on. Cost:
  no noise suppression, so more wind in the clip for Whisper. CONFIRMED by the owner the same evening: talking to
  Betty works on the friend's Android with the Cardo. Transcription at speed with it on is still unverified.
- **Stage 3, commands and memory (BUILT 2026-10-16, owner's request; UNVERIFIED ON A RIDE)**. `core/Commands.ts`
  `parseCommand` runs on his words (spoken or typed, in `askBetty`) BEFORE Claude: a match is carried out on the phone
  with a canned reply (instant, works offline, logged as `[command]`, shown in the chat as "on the phone, no AI call").
  A command only counts at the START of the sentence (after "hey Betty", "please", "can you"...), and the short ones
  only in short sentences, so "do you remember that ride" or "is it quiet on the N3" stay questions (tests list them).
  - "repeat that" / "say that again" / "what did you say": her last line again (as next track does).
  - "quiet for ten minutes" / "be quiet" / "shut up for half an hour" / "give me some peace for an hour":
    `TriggerEngine.setQuiet` stops banter, tour guide and time checks (missed slots and milestones are skipped, not
    saved up); alerts and answers still go; queued ambient lines are dropped (`AudioQueue.dropAmbient`). No length =
    until "talk to me" / "you can talk again" or END RIDE.
  - "mark this spot[, note]" / "remember this place because...": saves GPS position, the nearest place within 3 km and
    the note. "remember that X" / "make a note: X": saves a note. "forget that": removes the newest note or spot.
    Kept across rides (`adapters/RiderMemoryStore`, `betty.memory.v1`, 100 of each). `describeMemory` adds them to every
    answer's situation (newest first, with distance from here), so "where was that pothole I marked?" works.
    Checked live: pothole spot, chain note, and "what can I tell you to do?" all answered correctly.
  - MEMORY panel (under LOG) lists notes and spots, with a map link and Forget for each.
  Louder/softer BUILT 2026-10-18: `{kind: 'volume'}` ("louder", "speak up", "I can't hear you", "softer", "a bit
  quieter" (NOT the quiet command), "turn it down", "max volume", "normal volume") -> `nudgeVoice`, 4 dB steps on
  `voiceBoostDb` 0 to 16.
  ADDED 2026-10-17: "switch to stories/minimal/balanced" (the Settings presets), "banter up/down", "more/fewer stories"
  ("tour guide up/down"), "more/less chatty" ("talk more/less": silence weight -/+10 and the gap -/+30 s, 30 s to 10
  min); she replies with `mixSummary()`. A trailing "please" no longer stops a command matching.
  MARKED-SPOT WARNING (owner's road-hazard idea): `marked_spot` P2 fires once per spot per 10 min when it is within
  400 m and ahead (see Triggers). The line says what and how far; she must never tell him how to steer, which part of
  the lane or what speed (first live try said "keep left of centre" for a pothole in the left lane). Canned fallback
  "Marked spot ahead: <note>.". UNVERIFIED ON A RIDE.

## Claude call (verified live 2026-10-08)

- Model is `claude-haiku-5-5` (owner asked for a simple fast model; about 1 s per line). `CONFIG.claudeThinkingOff`
  must match the model: Haiku 5.5 takes `thinking: {type: 'disabled'}`, Sonnet 5.5 rejects that and wants
  `'between_tools'`. With thinking left on, the thinking block eats `max_tokens` and the reply is empty or cut off.
- Never read `content[0].text`; use `extractText` (first text block).
- Time of day: the model greeted with "Morning" at midday, then "corrected" itself in the next line. Every alert
  and answer now carries `Local time: HH:MM, <part of day>`, startup names the one greeting that fits the hour, and
  the system prompt forbids time-of-day words the situation does not give and any comment on earlier lines.
  In the small hours startup is told to skip the greeting; do NOT list the words to avoid, that made her say them.
  Ambient flavours get no clock (it made every quip open with the time). Checked live: 231 lines over seven hours
  of the day, 0 wrong.
- The API key must be scoped to a workspace, otherwise every call is a 400 and Betty silently uses fallbacks.
- The log and the SIMULATOR info line show the source of every line: `claude` or `fallback`, the reason, latency.

## Ambient personality (BUILT)

- Once per `ambientCooldownMs` (+5 s slack), in a safe window, with no P1 condition active, `TriggerEngine` rolls
  `chooseAmbient` with the TUNING weights (banter / tour guide / silence). A slot that rolls silence is used up.
  Nothing fires in the first gap after ride start.
- `local_fact` uses the nearest place in `BikeState.nearbyPlaces` within `ambient.placeRadiusKm` that has not been
  mentioned this ride; the place is marked mentioned when the event is created. A tour-guide roll with no fresh
  place is silence.
- `ambient_banter` never runs dry. `banterTopics` builds a pool from everything known: time of day, weather,
  duration, distance, fuel (and fuel used), engine temp, how twisty the road has been (lean), stops, standing still,
  traffic, nearest place name, alerts flagged earlier this ride, places already talked about, the last ride and
  ride totals from memory, plus an open "whatever strikes you" topic. `pickTopic` takes a topic whose fact has
  changed since last use (bucketed ids) or was never used; otherwise the least recently used one comes round.
  `pickMode` rotates the delivery (quip, observation, thought, question, callback), never the same twice in a row.
  The request names ONE topic and gives the rest as background. History: v1 sent the whole context every time and
  every quip was "middle of the night, N minutes in"; v2 used each angle once and ran out after five.
- Owner asked twice (2026-10-08) for banter about his riding, so the earlier "never tease speed or lean" design
  decision in the spec below is superseded: pace (average and top speed), current speed, revs and cornering are
  banter topics and she may tease them. What remains, on purpose: she never dares him or suggests going faster or
  leaning further, P1/P2 lines stay serious, and P3 only plays inside the safe window.
- `RideStats` (in the engine, fed by `evaluate`) tracks distance, moving time, stops, max lean, cornering share,
  max engine temp, fuel at start, alerts flagged and places mentioned. Update gaps are capped at 10 s so a
  throttled tab does not invent distance.
- Memory: `RideMemory` turns the stats into a `RideRecord`; `adapters/RideLog` keeps the last 30 in localStorage
  (`betty.rides.v1`), saved every minute and at END RIDE. Sessions under 3 min and 1 km are not remembered.
  TUNING has "Forget past rides". Memory is per device/browser. Questions she asks cannot be answered until voice
  input exists, so the question delivery is told to need no reply.
- Ambient flavours and `ride_milestone` get a flavour prompt (`FLAVOUR_PROMPTS`) and no bike-state JSON.
  The ambient flavours have an empty fallback: no key, an error, or a `SILENT` reply all mean she says nothing.
- `main.ts` drops an ambient line if a P1 condition became active while Claude was answering.
- PlaceSource: coordinates rounded to 2 decimals before the request, cached per cell, refetch after
  `feeds.placeRefetchKm`. List/index pages and stubs under 80 characters are skipped.
- Known weak spots: Haiku runs longer than 2 short sentences at times, and Wikipedia's nearest pages can be dull
  (schools, embassies). The prompt tells her to pick silence for dull notes; she does not always.

The original spec is kept below for reference.

## Offline line bank (BUILT 2026-10-18)

Built from the spec agreed on 2026-10-10 (alert variants with blanks; no replay cache). How it works: see "The longer
list" section above (`core/LineBank`, `adapters/LineBankStore`, `source: 'bank'`). Not built from that spec: tour-guide
lines written ahead per place, and banked banter. The service worker covers loading without signal.

## Personality dials: JARVIS/TARS blend and humour (BUILT 2026-10-16)

Owner: "a mix between JARVIS from Iron Man and TARS from Interstellar ... also adjustable". `CONFIG.persona`
{tars 0-100 (rest JARVIS), humour 0-100}, default 50/75, in TUNING ("Personality") and by voice. `personaPrompt()`
replaces the old "Tone:" line of the system prompt: both characters described in OUR words (traits and speech
habits), "shapes" a line can take per side, the blend percentages, and the humour level in words. Film lines are
NOT used: sample lines were tried and Haiku copied them word for word (they would repeat every ride); shapes work.
She must never name the films or say she is like them. Safety alerts ignore humour. Gemini's banter/milestone style
follows the blend (`voiceStyle`). Also from these checks: never name a day of the week or date the situation does
not give (she invented "Sunday cruise"), and `META` drops remarks about her earlier lines ("having already...").
Voice: "humour 60 percent", "set humor to 60", "humour up/down", "more/less jokes", "more TARS", "more JARVIS",
"full TARS", "JARVIS 70 percent", and "status" / "what are your settings" (humour, blend, flavour mix as percentages,
remark gap, quiet). Checked live at TARS 0/50/100 and humour 0/20/75/100: clearly different registers.

## Route planning (BUILT 2026-10-17; UNVERIFIED ON A RIDE)

Where to? lives in the ride-mode sheet ("How are we riding?"): one box takes places separated by commas ("Clarens",
"Heidelberg, Villiers, Clarens", "... then ...") or his shared Google Maps directions link, a "Twisty roads (thrilling
route)" tick, Plan. A quiet tip under the box (owner asked, "not too loud"): plan it in Google Maps, Share, paste. `ui/RoutePlanner.ts` posts to `api/route.ts` with his position (the ride's, or one GPS read):
- Link: only maps.app.goo.gl/goo.gl short links are fetched (redirect: manual, SSRF guard) and only Google Maps
  /maps/dir/ URLs parsed (`parseGoogleMapsDir`: "lat,lon" segments = dragged-through points, `named: false`; names
  get their coordinates from the !3d/!4d pairs in order). The link itself is kept as the "Open in Google Maps" link.
- Typed places: TomTom Search, towns first (idxSet=Geo, then everything), each biased to the stop before, and
  `pickResult` prefers an exact name and a town over a suburb ("Clarens" from Edenvale was "Clarens Park, Edenvale").
  A Google Maps link is built for the turns (about 9 waypoints).
- TomTom calculateRoute, travelMode=motorcycle, traffic, fastest or thrilling (hilliness normal, windingness high),
  from his position unless he is within 300 m of the first stop; up to 40 stops; points thinned to 800. Loops are
  named "Loop from <start>". Checked live: his link = Loop from BMW Motorrad Fourways, 255 km / 204 min from home;
  "Clarens" thrilling 339 km / 6 h; "Heidelberg, Villiers, Clarens" 307 km.
The route is kept on the phone (`betty.route.v1`, in the backup) until "Clear route". The home map shows it instead
of the last ride (dotted line, named stops as yellow pins), and the mode title reads "Free ride · <route>".
On the ride (`core/Route.ts`, pure): `routeProgress` finds him on the line (searching near the last index first, so a
loop's finish is not its start), gives km and minutes left (planned time scaled by distance), the next NAMED stop and
how far off the line he is. TriggerEngine: `off_route` P2 (over 0.4 km off for 20 s at 15 km/h+, once until back
under 0.15 km; she must not give directions, Google Maps does), `route_stop` P2 (a named stop within 1 km, once
each), `route_arrived` P2 (under 0.3 km left and past halfway). The briefing and his answers get `describeRoute`. Ride
map: the route dotted under the track; glance card "Your route: 212 km · 2 h 40, Villiers in 35 km" or "Off your
route". Weather along the route, fuel stops and stories ahead: built since (see "Route: what is ahead" and Fuel).

## Let Betty know me: rider profile (BUILT 2026-10-17; UNVERIFIED ON A RIDE)

Owner: "export context from Claude or ChatGPT ... incorporate it ... like a bit of salt in an already good meal"; a
slider was his idea but he was unsure, so the dose is fixed in code instead (one constant). Garage > Betty's
personality: "Let Betty know me" switch (`CONFIG.useProfile`, default on; does nothing without a profile) and "What
she knows about you" sheet: the question to ask ChatGPT/Claude (`ASK_ABOUT_ME`, Copy), a box to paste the answer or
load a .txt/.md/.json (a zip says to unzip and pick conversations.json), Distil -> `api/profile.ts` (Haiku, once;
for an export only HIS words: Claude `chat_messages` sender human, ChatGPT `mapping` author user; capped at 60k
characters; told to drop health, money, relationships, exact addresses, other people) -> an editable profile of at
most ~1,400 characters, Save / Forget. Without the server a short text can be used as it is. Kept in
`betty.profile.v1` (in the backup). Dose per line (`core/Profile.ts` `profileUse`, decided in TriggerEngine.force with
its rng): answers, briefing and sign-off always ("answer"); banter one in four (`PROFILE_BANTER_SHARE` 0.25,
"remark": only if it fits, never forced, not repeated in a ride); tour guide and area stories only to pick what he'd
find interesting ("interests"); alerts and time checks never. `profileNote` adds it under the situation with "never
say you were told this, never quote it, never list it". Checked live: a sample distilled well; "where should I stop
for coffee out west" used it naturally.

## Little animations (2026-10-18, owner picked 1, 2, 3, 5, 6, 8, 9 of a list + toasts; "one switch in settings")

`ui/motion.ts`: `motionOn` (CONFIG.motion, default on, AND not prefers-reduced-motion), `applyMotion` puts `.motion` on
<html> (at load, on `betty-config`, on a Reduce Motion change). EVERY such animation in app.css sits under `.motion`
(the "Little animations" block at the end) and every script-driven one checks `motionOn` first, so the one switch
(Garage > Betty's personality > Little animations, `#motionswitch`) turns all of them off. Pieces: toasts (Shell:
spring in, nudge when replaced, rise out, error shake, tap to close, longer for long text: those two are not motion);
her ride line word by word (`revealWords`, ~340 ms a word, squeezed into 9 s, only while `orb === 'speaking'`), and only
once her voice is AUDIBLE (owner: the words came before her voice): `SpeakTag.heard` is called by every speaker when audio
starts (Cloud: first streamed chunk / clip about to play; WebSpeaker `onstart`; silent mode at once; ExpoSpeaker
`onStart`), AudioQueue passes it once to `onHeard` (stale lines ignored), and main.ts sets `speakingNow` then (6 s
fallback). So the orb's speaking state follows the real audio too;
`countUp` on Journeys totals/month/records when the screen shows and the story's numbers, ONLY for a number that
changed since he last saw it, from the old value (owner: counting every time distracted; last seen per label in
`betty.counted.v1`; the first sight just shows); the story road draws itself once the WHOLE map is in view (`drawWhenSeen`: IntersectionObserver on the screen,
95%; owner agreed; `.ride-road` + `pathLength="1"` on the track paths in mapView, waits undrawn, `.drawing`, then
`.drawn` so the later repaint with place names does not redraw it) and its moments rise in one after another; reminders Done: a drawn tick, a sage flash,
rows slide to their new place (`positions`/`slideFrom`, FLIP); Undo flashes amber; What's new badges pop (`play(.., 'pop')`)
when the count goes up; `.primary/.secondary/.end-button` sink to 97% when pressed, and `mountPressFeel` vibrates 8 ms
on `.primary`/`.end-button` (Android; iPhone Safari cannot); Horizon `resize` (Web Animations width/height) only when it
grows, shrinks or changes card (not when a reading ticks), with `.island-body` held at its FINAL width and the card
clipping it (the text used to re-wrap into a tall vertical column mid-grow), and a yellow glow (`.news`) on a new top cue other than speed.
On the ride only her line and Horizon move (owner agreed: motion pulls the eye). Checked in headless Chromium.

## Native app (STARTED 2026-10-18; owner: "start setting it up without the reader")

Decision: React Native + Expo (development builds, not Expo Go), one codebase, reusing `src/core` as is. Rejected:
Swift + Kotlin (everything twice), Capacitor (weak at background audio and CarPlay). How to build, run and what is
next is in `native/README.md`: it is the native app's CLAUDE.md, keep it current.
- `native/src/rig.ts` = the ride pipeline (like `start()` in main.ts) with native adapters (`ExpoGeoSource`,
  `ExpoSpeaker`, `ElmClassicTransport` + `ObdSource`) plus the shared `WeatherSource`; `native/App.tsx` = a plain first
  screen (Let's ride / End ride, numbers, her lines, type a question, pick the paired reader on Android).
- OBD2: `src/core/Elm327.ts` (pure, tested): `ELM_INIT`, `PIDS` (rpm, coolant, speed, throttle, fuel), `cleanLines`,
  `readPid`, `supportedPids` (0100/0120 bitmaps), `parseDtcs` (CAN with its count byte and multi-frame; older buses
  three codes a line), `ElmSession` (init logs the reader version and the PIDs the bike lists; a PID with 3 misses in a
  row is dropped; a value the bike does not give is left out, never zero). `ObdTransport` = send a command, get the
  text up to ">". Not yet: battery voltage (`ATRV`), gear from rpm/speed.
- OPEN DECISION after the reader test: if the bike gives no fuel PID (012F), `obd: true` would switch off the km-based
  fuel range (the engine uses the estimate only when `s.obd` is false). Then fuel needs its own flag.
- Server: `fromBetty` also accepts `x-betty-origin` (the app has no page origin); `ClaudeClient` takes `proxyHeaders`.
- Building: the owner builds APKs himself and sideloads the iPhone from Xcode with a free Apple ID (7-day builds, 3
  apps). CarPlay entitlement and TestFlight need the paid Apple Developer Program. The Mac had NO Xcode, Java or
  Android SDK on 2026-10-18 (setup steps in `native/README.md`), so the first slice is checked by typecheck and by
  bundling the Android and iOS JavaScript only.
- `.vercelignore` excludes `native/`: it is not part of the web deploy.

## Scaling and pricing (owner's questions, 2026-10-19; ESTIMATES, not measured)

Assumptions: ~20 h riding a month per rider, ~800 lines/answers a month, ~120 characters a line, R18 to the dollar.
Prices checked 2026-10-19 (several from third-party pages: re-check before relying on them).

Running cost per rider per month (~R55-90, i.e. $3-5):
- Claude Haiku 5.5 ($0.10 in / $0.50 out per MTok; cache reads 0.1x): ~3,000 tokens a line + ~30 web searches at
  $0.01 -> ~$1-1.50. Area stories (Haiku + search, ~5c a new area, ~10 a month) ~$0.50, far less if shared.
- Chirp 3 HD: $30 per 1M characters after 1M free A MONTH PER ACCOUNT (not per rider). ~80k characters a rider: free
  for the owner alone; 100 riders ~8M -> ~$210/month (~$2 a rider). Cartesia would cost more at his volume (Pro ~$5
  for ~100k credits). Gemini TTS: dearer and Tier 1 = 10 requests/min, unusable for 100 riders (owner is considering
  dropping Gemini entirely to run as cheaply as possible).
- Hearing: Groq Whisper free tier likely still covers it; Deepgram ~$0.005-0.008 a listening minute (~$0.10/rider).
- PIPECAT ITSELF IS FREE (open source, BSD-2); the cost below is only if HOSTED on Pipecat Cloud (Daily). Self-hosted
  on a R100-150/month Johannesburg VPS (or Oracle's free tier) it is a small fixed server cost instead, and one
  cheap server serves many riders (the heavy work is at Claude/Google/Deepgram). Pipecat Cloud: $0.01 per CONNECTED minute: ~$1.20/rider if connected per conversation (~15 min a ride), ~$12 if
  connected the whole ride. Decide per-conversation vs per-ride before adopting it.

What breaks at 100 riders: free tiers are per account (above); OpenStreetMap Nominatim forbids heavy use (1 req/s,
no apps at scale: paid geocoder or self-host); TomTom free 2,500/month vs ~24,000 traffic polls (share per area);
Open-Meteo and Vercel Hobby are non-commercial (paid plans if charging; Vercel Pro ~$20); iPhone distribution needs
the Apple Developer Program ($99/yr; TestFlight up to 10,000 testers), Android Play account $25 once; accounts and
per-rider caps (the server only checks the origin today: a leaked copy could run up the bill), spend alerts on every
key; onboarding instead of his defaults ("sir", G 310 GS schedule, 11 L tank, inland petrol); POPIA (location data),
privacy notice and terms. Helps: shared server caches per area (stories, traffic, place names), common voice lines
made once, push-to-talk so hearing/Pipecat bill per question. Data stays on the phones: no big database to run.

Pricing (owner "just curious"; nothing decided):
- Fixed ~R700-1,500/month (Apple ~R150/month, Vercel Pro ~R360, paid traffic/geocoding, a small server, domain).
  App stores take 15% (small business). VAT only past R1M turnover.
- At ~R70 running cost, 100 riders, ~R1,000 fixed: R79 = loss; R99 = about break-even (~R400/month); R149 = ~R4,700
  profit/month; R199 = ~R8,900.
- Suggested shape: FREE (phone voice, safety alerts, reminders, journeys, a few questions a day: runs mostly on the
  phone, costs almost nothing); RIDER ~R99-129 (Chirp voice, personality, stories, ask anything, route planning, fair
  use ~30 h/month); PRO ~R199 (realtime Pipecat talk, smarter searched answers, OBD, higher limits); annual ~10
  months' price for 12 (riding is seasonal). Protect margin with a fair-use cap (an 80 h/month rider costs ~4x) and
  shared caching. Before pricing: measure real cost per ride (below), ask riders/clubs what they'd pay, check
  competitors' prices (not checked), start with a 10-20 rider beta at a founder price.

## Backlog (open items only; cleaned 2026-10-18)

Everything buildable in the web app is built (see the sections above), except the planning map. Next: THE NATIVE APP.

**Next up:**
0. **Faster spoken answers** (owner, 2026-10-19: "let's rather refocus on getting voice faster"). Measured chain today:
   end-of-speech wait 1.2 s + upload and Whisper ~1.5 s + Claude 1-2 s (search 3-6 s) + voice to first sound (Chirp
   ~1 s, Gemini streamed 2-3 s) = about 5-7 s. Plan, in order: (a) stream Claude's answer and send the first finished
   sentence to the voice while the rest is written; (b) prompt caching on her system prompt; (c) streamed Chirp (first
   sound ~0.3-0.5 s) for answers; (d) on-device live transcription in the native app with Whisper as backup; (e) tune
   the end-of-speech pause from ride logs (1.2 -> ~0.8 s); perceived: a tone the moment the question is caught, and
   "Hang on" sooner only when she is actually searching. Target: about 2.5-3.5 s.
   (a)+(b) BUILT 2026-10-19: `ClaudeClient.phrase(ev, s, {early})` streams his answers (`wire(req, true)`, api/phrase
   passes `text/event-stream` through), `StreamedMessage` rebuilds the content blocks, `firstSentence(answerSoFar())`
   (after the last search result; not a `putsOff`/META preface; cleaned with maxSentences 1) is handed over once;
   main.ts `say` queues it at once (cancelling "Hang on" via `onFirst`) and later only `restAfter(text, early)`.
   Her own lines are not streamed. `wire` sends `system` as one block with `cache_control` (request keeps the string).
   MEASURED LIVE (scripts/latency.live.ts, from the Mac): cache WORKS (4,943 tokens read per answer: web-search tool +
   system; first call writes); first sentence at 1.0-1.4 s vs the whole answer 1.1-2.1 s. Honest result: with her
   2-sentence answers the Claude-side gain is small (~0.1-0.7 s), and caching mostly cuts cost (reads at 0.1x); the
   bigger remaining wins are (c) voice and (d) transcription. Native: RN fetch cannot stream, so the early sentence
   arrives with the whole answer until expo/fetch is used.
0a. **Cost per ride, measured** (owner, 2026-10-19: before any pricing decision): log per ride Claude input/output and
   cache-read tokens (from `usage`), web searches, voice characters per engine (Chirp/Gemini/phone), transcription
   seconds, traffic/route/place/geocoding calls; turn them into rand with the prices in "Scaling and pricing"; show
   "this ride cost about R2.40" in the Workshop log/ride story and keep a monthly total. Replaces the estimates above.
0b. **Owner learns first, then we build** (owner, 2026-10-19: he wants to understand and explain these himself before
   they are coded, "rather than just hope you coded them properly"). Do NOT start these until he says so:
   - Betty as an agent for HIS QUESTIONS (not for triggers/safety, which stay in code): Claude gets tools to look up
     (route weather, stations ahead, past rides, reminders, live engine data) and to act (mark spot, set a reminder,
     change the route, quiet until a place); fast path kept for simple questions (each tool round trip ~1-2 s).
     Study: Scott Moss, Frontend Masters "Build an AI Agent from Scratch" and "AI Agents v2" (agent loop, tool
     calling, evals, human-in-the-loop, context management; uses OpenAI, ideas carry over).
   - EVALS: a fixed set of situations ("parked in Heidelberg, raining, asks about fuel") that score her answers on every
     prompt/model change, to catch regressions like "I shall search" before a ride. Same course (v2).
   - Speech-to-speech for live chat (owner, 2026-10-19, after asking how ChatGPT/Claude voice are so fast): one model
     that hears and speaks (OpenAI Realtime API, Gemini Live; ~0.3 s), interruptible, over one open connection. Cost:
     her conversation would not be Claude (personality, ride context, search and tools rebuilt there), dearer per
     minute, needs signal. Middle path: speech-to-speech only for back-and-forth chat, Claude for alerts and stories.
   - On-device AI hybrid (native; 2026-10-19): Apple's on-device model (iOS 26, ~3B) / Gemini Nano on Android,
     on-device speech recognition and premium voices for instant, offline replies (commands, "anything ahead?",
     acknowledgements, no-signal lines); Claude keeps everything that needs her brain. Upgrades the offline line bank.
   - Realtime pipeline (2026-10-19, owner curious about WebRTC + open-weight models): one WebRTC connection to a voice
     server running streaming STT + a fast LLM + streaming TTS, wired with Pipecat or LiveKit Agents (turn detection,
     interruptions). Own GPU with open models (Parakeet/faster-whisper, Llama/Qwen ~8B, Kokoro/Orpheus; Kyutai Moshi
     speech-to-speech ~0.2 s): ~0.5-0.8 s but a GPU near SA is scarce and costs roughly R15-40k a month always-on,
     and an 8B model is weaker than Claude. Hosted pieces instead (Deepgram STT, Groq LLM, Cartesia/ElevenLabs Flash
     TTS): ~0.8-1.2 s, pay per use. Cheap perceived wins either way: instant on-phone acknowledgement, pre-answered
     likely questions, interruptible speech, one persistent connection instead of several SA<->US requests.
     PIPECAT (owner interested, 2026-10-19): open source (BSD-2), Python server, supports Anthropic so Claude stays her
     brain; gives streaming STT while he talks, an open turn-detection model, sentence-streamed TTS, barge-in, one
     WebRTC link, swappable providers, function calling, React Native + JS clients. ~0.8-1.2 s with Claude. Costs: a
     long-running server (not Vercel functions; Pipecat Cloud or a VPS near SA), the conversation moves server-side
     (phone sends the ride situation over the link), reconnects on a ride. KEY RISK: always-on listening keeps a
     Bluetooth helmet in CALL MODE (what broke the headset button on 2026-10-16), so on the bike it is probably still
     push-to-talk: test on his V6 first. Suggested learning path: Pipecat quickstart on the Mac with Claude, then her
     personality prompt, then decide.
     LAB BUILT 2026-10-19 (`labs/pipecat-quickstart`, see labs/README.md): Deepgram hearing + Deepgram Aura voice +
     Claude Haiku with her prompt, cache on, thinking off. MEASURED on the Mac: question -> she speaks ~1.5-1.6 s
     (Claude 0.8-0.9 s, voice first audio ~0.4 s). Not yet: web search as a function call, Chirp (needs a Google
     service-account JSON). Helmet test skipped (owner: push-to-talk through the V6 is already proven on the web app).
     LIVE 2026-10-19 at https://voice.forme.africa/client (Vultr Johannesburg 1 GB, ~R100/month; owner chose Vultr over
     Lightsail/Absolute Hosting/Datakeepers; login user betty + VOICE_ACCESS_CODE in .env): ~1.55 s question to voice.
     Server details, access, firewall and redeploy: labs/README.md. Root password login stays ON (owner's choice).
   - Voice design review against Cathy Pearl, "Designing Voice User Interfaces" (O'Reilly, 2016): escalating
     no-match/no-input replies, implicit vs explicit confirmation (e.g. "we're done for today" ends the ride without
     asking: confirm?), teaching commands in the moment, barge-in (does a talk press stop her mid-line?), key fact
     first in alerts, end-of-speech timing, voice vs Horizon. Pre-LLM book; for riding distraction use NHTSA
     driver-distraction guidelines instead.
1. **Native app, iOS and Android** (owner, 2026-10-18: React Native + Expo, dev builds). Reuse `src/core` unchanged;
   rebuild the screens and the adapters. STARTED 2026-10-18 (section Native app). First milestone: Android with GPS, her voice and OBD over Bluetooth Classic
   (his ELM327 mini). Then the iPhone build from Xcode, background running, music ducking, local notifications.
   CarPlay "voice-based conversational apps" (iOS 26.4+, `CPVoiceControlTemplate`, entitlement requested from Apple:
   needs the paid developer account; verify the key in Apple's docs) and Siri App Intents last. The free Apple ID
   build expires every 7 days (re-run from Xcode), max 3 apps. Android Auto has no equivalent category (unverified).
2. **Comes with the native app:** reminder notifications (local, no push server), staying quiet during a phone call,
   group rides (two Bettys sharing position live: also needs a realtime server), crash detection (hard impact then
   no movement, countdown, message to an emergency contact), audio ducking instead of pausing his music, background
   running without the silent track, real call-mode control.
3. **Real OBD2** (Phase 4 item, now via the phone): the mini (Bluetooth Classic, Android only) for development; he
   plans a Vgate iCar Pro BLE 4.0 (iPhone and Android) next week. Not a Wi-Fi reader: the iPhone joins its network
   and may lose mobile data. First a 10-minute check with Car Scanner on Android: socket, protocol, which PIDs answer.
   Expected value: fault codes explained, real coolant temp (overtemp), battery/charging voltage (`ATRV`), RPM,
   throttle, load; gear from RPM/speed; fuel level only if the bike reports it. Alerts are built, they read mock data.
4. **A garage of bikes** (owner, 2026-10-18: "not now, save for a future iteration"). His vision: SEVERAL bikes, swipe
   left/right to pick the active one; each bike shown as a MODEL of the actual bike; AI looks the model up online and
   fills in its specs (tank, reserve, consumption, schedule...); optionally a PHOTO of his bike mapped onto the model;
   animations app-wide. Design notes:
   - The bike carries its tank and reserve (fuel range follows the bike) and its maintenance schedule (`BIKES` in
     core/Reminders.ts; `ServiceBook.bike` already stores the id).
   - Another bike's schedule, three ways: (a) RECOMMENDED: a photo of the handbook's maintenance page (what the owner
     did for the G 310 GS) sent to Claude (vision), which returns the items as JSON ({name, everyKm, everyDays,
     note}); he reviews and edits before saving; a spec-page photo can fill the tank the same way. (b) Type the
     model: web search, marked "from the web, check it". (c) Start blank: rider care (chain, tyres) only.
   - Switching: his own reminders and rider care stay, handbook items are swapped, the odometer is asked again. Each
     bike's book is kept separately (keyed by bike), so switching back restores it.
   - Rides record which bike (`RideRecord.bike`) so My journeys can total per bike. `CONFIG.bikeName` stays.
5. **A planning map in Where to?** (Mapbox was the owner's direction, drawn in the sketch style): see and adjust the
   route while planning. Left for the native app (a native map library there).

**Hardware (Phase 4):** tyre pressure sensors (TPMS BLE), Raspberry Pi, Piper TTS, Porcupine wake word, a physical
handlebar button, camera clips on a hard brake or a "mark this" press. Hardware BOM was estimated around R2,180.

**Housekeeping:**
- Every deploy leaves a new deployment URL: re-run `npx vercel rm betty --safe --yes` now and then (keeps the one the
  live alias points at). Pages from before 2026-10-14 had the Claude/TomTom keys inside (all deleted 2026-10-18);
  rotating those keys is still wise, not urgent.
- TomTom quota: Search is 2,500 a month free and serves routes, place names and petrol stations; watch it.
- Haiku weak spots to watch in logs: lines over 2 sentences, dull Wikipedia places, muddled search snippets (the
  Smarter web answers switch is the fix for the last).

**Unverified on a ride (check on the next rides, from the shared log):** forced web search, parked mode and "end
ride", detour, fill-up by voice, previous track letting go, louder voice (and "louder"/"softer"), 12 s recordings,
riding time, fuel range from consumption and stations ahead, reminders in the briefing/sign-off, Horizon (card,
"anything ahead?", lock-screen line), route following, route weather and stories ahead, marked-spot warnings, rough
patches, new roads, fatigue/wind/cold, records called out live, the offline line bank, map gestures, slim panels.

### Notes: a personal voice
1. Free first: iOS "Enhanced"/"Premium" voices (Settings > Accessibility > Spoken Content > Voices). BUILT: the
   Voice picker on the main screen lists the phone's English voices (en-ZA first), has a Test button, and saves the
   choice in `CONFIG.voiceURI`; `WebSpeaker` falls back to en-ZA if that voice is no longer installed. The list shows
   the quality Safari was given (basic/enhanced/premium, read from the voice id). Owner downloaded Premium Karen
   (2026-10-10); the picker still showed "Karen (basic)". CONFIRMED by research the same day: on iOS the Web Speech
   API only gets the pre-installed voices. An Apple engineer states "Optionally downloadable voices are not
   available" (developer.apple.com/forums/thread/723503), and Readium's Web Speech notes say the same and warn that
   installing higher-quality variants can make voices vanish from the list. Switching browser does not help: every
   iOS browser (Brave, Chrome, Firefox) runs on the same WebKit engine. No settings workaround was found.
   So in the browser a better voice means cloud TTS (option 2); on-device premium voices need a native app.
   **CLOUD VOICE BUILT 2026-10-16 (owner chose Google; keys pending, UNVERIFIED live)**: `api/speak.ts` (keys on the
   server: `GOOGLE_TTS_API_KEY` for Chirp 3 HD via texttospeech v1 `text:synthesize`, en-GB since there is no en-ZA,
   MP3; `GEMINI_API_KEY` for Gemini TTS via `v1beta/interactions`, model `GEMINI_TTS_MODEL` default
   `gemini-3.8-flash-tts`, WAV, with a per-line `style`). Both engines share the same 30 voice names, so she is one
   person. `CONFIG.cloudVoice`: `mixed` (default), `chirp`, `gemini`, `off`. Keys added to Vercel 2026-10-16 and both
   engines checked from the Mac: Chirp about 1 s a line, Gemini 5 to 7 s (`gemini-3.8-flash-lite-tts` no faster). So
   `mixed` = Gemini (with `VOICE_STYLES` by trigger id) ONLY for her unprompted P3 lines, Chirp for alerts and for
   everything he is waiting on (answers, command replies, startup, debrief). P3 lines wait for their audio
   (`CloudSpeaker.ready`, up to 12 s) BEFORE they are queued, so a slow clip never holds up an answer; one that
   arrives after he asked for quiet is dropped.
   GEMINI TIER 1 = 10 REQUESTS A MINUTE (2026-10-17, after billing): a ride start (7 stock phrases + briefing + first
   remarks) got 429 and Betty then dropped Gemini for the whole ride. Now `CloudSpeaker` keeps to `GEMINI_PER_MIN` (8):
   lines past it go to Chirp, stock-phrase fetches leave 4 of the 8 free (and are fetched on demand otherwise), a
   per-minute 429 pauses Gemini for the "retry in N s" Google gives (logged once), and only a per-day 429 or a 503
   ends Gemini for the ride. "Test sounds" now waits for room between lines. Each Gemini model also has its own
   DAILY limit (Lite: 100 a day on Tier 1, hit on 2026-10-17 after a day of tests): a per-day 429 switches to the
   other model for the ride (`modelsOut`), and only when both are out does Gemini stop. Default model is now Lite
   (owner), so Full is the overflow. FULL IS ALSO 100 A DAY on Tier 1 (00:34 log): 200 Gemini lines a day in all,
   reset time unconfirmed. Bug fixed from that log: a second refusal for a model already out (a request in flight)
   ended Gemini without trying the other model. Chirp's wait now grows with the line (2 s + 15 ms a character, at least
   3.5 s): the four-sentence briefing missed 3.5 s and went to the phone voice. Same log: the briefing named a
   closure already announced that week; it now leaves out `known`/announced incidents (and the `traffic` count topic),
   and any it does name count as announced so no alert repeats them.
   GEMINI FREE TIER = 10 REQUESTS A DAY for `gemini-3.8-flash-tts` (429 on the 11th, 2026-10-16): useless for a ride.
   A Gemini line that fails is asked of Chirp instead (same voice), and a 429 or 503 stops that engine for the rest of
   the ride (`unavailable`, logged once as `[audio]`). Real Gemini use needs billing on the AI Studio project (paid
   tier; text is then not used for training). Owner added billing with a $5 cap the same evening; Gemini works again.
   **STREAM MODE (2026-10-16, owner: loves Gemini, not Chirp; now the DEFAULT `cloudVoice: 'stream'`)**: Gemini for
   everything except alerts (P1/P2 stay Chirp, speed matters). Lines he waits for (P4) are STREAMED: api/speak with
   `stream: true` reads Gemini's server-sent events and returns plain PCM (16-bit LE, 24 kHz, mono, `audio/l16`);
   `PcmClip` collects the bytes (prefetch starts it the moment the line is written), `PcmPlayer` plays them through
   Web Audio as they arrive (0.3 s lead, 0.15 s buffers). First audio measured 2.8 to 3.2 s (full) / 2.2 to 2.8 s
   (lite) versus 5 to 6 s whole. Her own P3 lines are still fetched whole and queued when ready. Stock phrases
   (`STOCK_LINES`: "Hang on, let me check." etc.) are made at ride start so they play at once. No audio after
   `STREAM_WAIT_MS` (4.5 s), a failed stream or a Gemini clip that will not play -> Chirp says it (same voice), then
   the phone. `geminiModel` full/lite and `chirpLocale` (en-US default to match Gemini's accent; en-GB was the first
   choice and may be why the owner disliked Chirp) are on the main screen; the Test button plays alert (Chirp), answer
   (streamed) and banter, fetched as a ride fetches them (banter whole and ahead), and shows how long each waited for
   its audio (`onAudio`); the first version spoke banter cold and reported the whole alert's playing time, which looked
   like a 5 s failure. "Gemini for everything" now streams alerts and answers too. RISK, UNVERIFIED: Web Audio is a second sound source next to the headset-button track and
   might take the buttons away on iPhone. TO REVERT: pick "Gemini for her own remarks only" (the old `mixed`) on the
   main screen, or `git checkout before-gemini-stream` for the code (tag pushed).
   **Voice tags and pace (2026-10-16)**: when a Gemini mode is on, the system prompt lets her write `<laugh>` or
   `<sigh>` (now and then, at most once a line, never in alerts). `voiceTags(text, keep)` keeps the tags Gemini knows
   (`VOICE_TAGS`) for Gemini and strips every tag for Chirp, the phone voice and the lock screen; the chat and the log
   show them. ACCENTS: Gemini also has an extended library (`GET /v1beta/voices`: 2,089 voices, 763 English, with
   accent, gender, age and tone). `config/voiceLibrary.ts` holds 399 of them in seven groups (Southern US = Inland
   Southern + Gulf Coast, British southern English = Winchester, British regional, South African = "Cape Town
   English", Irish, Australian, New Zealand), regenerated by hand from that API. Main screen: Accent, then voice
   name filtered and grouped by gender. Library voices work with both Gemini models (checked) but NOT with Chirp, so
   in a Chirp mode an alert uses `chirpVoice()`: a standard voice of the same gender (Aoede / Iapetus) in the nearest
   Chirp accent, or the one he picks under "Chirp voice for alerts" (`chirpStandIn`; for Tavi the closest are Laomedeia,
   Zephyr, Achernar or Leda by pitch and tone). Default `chirpStandIn` is Zephyr (owner, 2026-10-17), and the automatic pick for a
   female voice is Zephyr too (male: Iapetus). api/speak accepts library ids (`en-us-veda`) for Gemini only. Owner's set (same night): laugh, chuckle, snicker, sigh, phew, pff, tsk, yawn, throat-clearing, short
   pause ("pgg" and "yarn" in his message read as pff and yawn); Chirp has no such tags (only pause markup, rate,
   pronunciations, SSML). "Test sounds" on the main screen plays `SOUND_TEST_LINES`, one per tag; all ten checked
   against Gemini (HTTP 200). Stock phrases and sound-test lines are fetched whole and KEPT ON THE PHONE
   (`adapters/ClipStore`, IndexedDB `betty-voice`, keyed by voice+model+style+text, cleared past 80) so Gemini makes
   each once per voice: owner saw Gemini cost 25c in a day of testing while Chirp was free. Every non-alert Gemini style ends with `PACE` ("at a natural pace, a touch brisker than relaxed"): the
   owner found the composed style slow and asked for "a tiny bit" quicker. Checked live: she uses both tags unprompted.

## History and culture of the area (BUILT 2026-10-16; UNVERIFIED ON A RIDE)

Owner: "not just Wikipedia but web search as well". `adapters/AreaSource` (only with the server): every 2 km moved,
`api/area` names the suburb and town (OpenStreetMap Nominatim reverse, zoom 16; zoom 14 gave only "Ekurhuleni Ward
19"; ward names are dropped and the metro used instead, so Edenvale reads as Ekurhuleni; cached at the edge a day,
identifying User-Agent, coordinates rounded to 2 decimals). For each area (`areasOf`: the town, plus the suburb when
it is not just "<town> South") the notes come from the phone (`betty.areas.v1`) or, the first time, from `api/story`:
Claude Haiku with web search (max 3 searches) writes up to 6 notes (name origin, founding, events, people,
landmarks, culture), only facts its results state, as JSON. Checked live: Germiston in about 5 s, six good notes
(John Jack and the Glasgow farm, the 1886 gold strike, the 1921 Rand Refinery, the railway junction, Germiston Lake,
Brenner and Els). Cost: a few searches plus reading, roughly 5 cents per new area, once. `area_story` (P3) tells one
untold note (`toldNotes`, kept across rides in `betty.told.v1`); when every note of an area has been told, the area
is researched again with the old topics excluded, at most once a ride. Notes also reach his answers ("Notes on the
area he is in"; the answer prompt says to answer area questions from them straight away; before that she offered to
search instead). Feed status shows "Area stories".

## Pre-ride briefing (2026-10-16, owner liked her answer to "tell me about yourself")

`startup` is now a briefing: who she is in character (with her settings), then what matters before setting off from a
full `situationDigest` (weather, rain chance, traffic on his way, fuel range, sunset, last ride and totals, kept
notes), skipping topics that only make sense mid-ride. Up to `BRIEFING_SENTENCES` (4) whatever TUNING says, an 8 s
Claude budget (it timed out at 2.5 s on 2026-10-16 and said "Systems online."), and main.ts waits up to
`feeds.briefingWaitMs` (10 s) for the weather and a GPS fix before asking. Canned fallback: "Systems online." plus the
weather and range when known. Also from that log: she claimed "Humour at 60 percent, bluntness up" when his words
were not a command; the answer prompt now says only the commands change settings, and to tell him the command. `adapters/CloudSpeaker` falls back to the phone voice
   for any line whose audio is not there in `WAIT_MS` (Chirp 3.5 s: about 2 s round trip from SA through Vercel; Gemini 5 s), fails, or will not play; a 503 (key
   not set) stops that engine for the session. Audio is prefetched as soon as a line is written and kept (40 clips),
   so a queued line and repeated phrases are instant. It plays on the headset buttons' own track while those are
   Betty's (`HeadsetButtons.play`), otherwise on an element unlocked in the START tap (`ElementPlayer`). Main screen:
   Cloud voice mode, Cloud voice name (with Google's one-word descriptions) and Test (an alert then a banter line);
   the phone voice picker is now labelled as the backup. Gemini free tier: Google may use the text to improve its
   products. Not checked live yet: Gemini latency, Chirp API-key auth, whether the buttons survive the clips.
2. Cloud TTS for real quality: Claude text -> TTS service -> audio played by the page. ElevenLabs can design or clone
   a voice (needs the speaker's consent); Azure has South African English neural voices. Adds roughly 0.5 to 1 s per
   line, needs signal (fall back to the phone voice), costs per character, and the key must sit behind a server
   function. The offline line bank could store the audio as well as the text.
3. Phase 4: Piper on the Pi, fully local, can be trained on a custom voice.

### Notes: voice input
- Steps: hear the rider, speech to text, text into the same `rider_query` path (see the chat test mode spec:
  `ClaudeClient.converse` with a short history), speak the reply.
- The mic must be the helmet's. Using a Bluetooth headset mic switches it to call mode (HFP), so Betty's voice and
  any music drop to phone-call quality while listening.
- Prefer push-to-talk over an always-on wake word: a wake word keeps the mic (and call-quality audio) on all ride
  and in a browser only works while the page is in front. A handlebar/headset button is the ideal trigger.
- Speech to text: Safari's SpeechRecognition on iPhone is unreliable (stops by itself, poor in noise). Dependable
  option: record a few seconds (MediaRecorder) and send to a transcription service; needs a server-side key.
- Push-to-talk from a Bluetooth headset (discussed 2026-10-10, NOT built, unverified on the owner's headset): a web
  page can receive the headset's play/pause and next/previous-track presses through the Media Session API, but only
  while the page is the phone's active audio source, which means Betty playing a continuous near-silent track.
  That would also keep the Bluetooth link awake (clipped first words). The long-press assistant button goes to
  Siri and cannot be intercepted. Costs: Betty would take those buttons away from a music app, and the mic still
  switches the headset to call quality while listening. First step is a tiny test: hold the media session and log
  which button presses actually reach the page on his headset and iPhone.
- Order: typed chat test mode first, then push-to-talk with cloud transcription, wake word last (likely on the Pi
  with Porcupine).

## Conventions

- Two apps share `src/core`/`src/config`: logic goes there (with tests), never into `native/src/rig.ts` or `src/main.ts`.
  A change in the shared code is checked in both (root `npm test`; `native` typecheck + bundle).
- The native app has its own notes and rules in `native/README.md`; update it with every native change.
- TypeScript strict. Keep `core/` pure and covered by tests; adapters and ui stay thin.
- Every change the owner would notice ALSO goes into Help (`src/ui/help.ts`): a new topic or the existing one updated,
  and any new voice command in `VOICE_COMMANDS` (owner, 2026-10-17). Changelog = what changed; Help = how it works now.
- CHANGELOG SHAPE (owner, 2026-10-18: "it needs a clean up"): `{id, kind: new|better|fixed, title, text, help?}`. ONE
  entry per feature per day describing how it works NOW; polish of something built the same day is folded into that
  entry (never "the pencil now scrolls", "records say what they count" as new lines); `fixed` only for something he
  had on an earlier day; one sentence, the how-to goes in Help (`help` = a HELP_TOPICS id, a test checks it exists).
  Ids never change: What's new keeps read state by id (`betty.seen.v2`), the badge counts unread new/better only.
  Older days fold to one line in the sheet; the newest day and any day with unread entries open.
- Every change the owner would notice gets a plain-words line in `src/changelog.ts` (shown in the app as WHAT'S NEW,
  under LOG, with the build time so he can tell a reload picked up the new version). Owner's request, 2026-10-16.
- Config values (thresholds, cooldowns, priorities, prompt) live in `config/betty.ts`, never inline.
- Betty's system prompt lives in `config/betty.ts`. Her output must be plain spoken English: no markdown, no emojis.
- Keep dependencies minimal (all dev: vite, typescript, tsx, @types/node, jsdom, @types/jsdom).
- Mock data (`MockObdSource`) is clearly labelled "mock" in the UI; keep it that way until real OBD2 exists.
- Any new UI panel gets a jsdom smoke test. The first version of SimPanel shipped with invisible sliders and only
  the smoke test caught it.

## Reference docs (not in this repo)

Earlier design work lives in the owner's claude.ai chat "Building an AI assistant for your bike": architecture
diagrams (System Overview, Data Flow), BETTY-SRS-001 (requirements, FR-/NFR- ids), BETTY-SAD-001 (architecture
design, 12 architectural decisions), and Betty-Build-Prompt.md. Requirement ids referenced there
(e.g. FR-T01..T10 triggers, NFR-S02 non-distraction, NFR-R03 fault tolerance) map to the modules above. Ask the
owner to drop those files into a `docs/` folder if deeper detail is needed.
