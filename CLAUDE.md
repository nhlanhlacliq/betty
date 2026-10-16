# CLAUDE.md — Betty

Context for any Claude Code instance picking this project up. Read this first.

## What Betty is

An always-on voice co-pilot for a motorcycle (owner: Nhlanhla, 2018 BMW G 310 GS, Gauteng, South Africa).
She talks to the rider through Bluetooth helmet comms, reads bike/ride data, and speaks proactively
like a co-pilot with personality, not like an alert system. Warm, dry wit, direct, max 2 short sentences.
She calls the rider by `CONFIG.riderName` (default "sir") and the motorcycle by `CONFIG.bikeName` (default
"the bike"). Both are editable on the main screen and persisted. The system prompt is built per request by
`bettySystemPrompt()`, so a change applies to the next line.

The rider can also speak to her ("Hey Betty, how's the bike?"). That voice-input path is not built yet.

## Owner preferences

Direct, concise communication. No hedging, no over-explaining. Hold him to account plainly: if something
is wrong or risky, say so.

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 1 Voice foundation | Scaffold, GPS speed, TTS to helmet, "Systems online", trigger engine, audio queue | Done (web app) |
| 2 Data feeds | Weather, traffic, phone IMU lean, TPMS BLE, mock OBD2 | Weather (Open-Meteo), traffic (TomTom, key optional), IMU lean, mock OBD2 done. TPMS outstanding |
| 3 AI brain | Claude-phrased speech, session memory, voice input "Hey Betty", chat test mode | Phrasing and ambient personality (banter + grounded tour guide) done. Memory, voice input, chat test mode outstanding |
| 4 Hardware | Raspberry Pi 4 under seat, real OBD2 via ELM327, standalone, local Piper TTS, Porcupine wake word | Not started |

History: Phase 1 was first scaffolded as Expo/React Native, then converted to a Vite web app on request
("just make it a webapp for now"). The Expo code is deleted. Do not reintroduce React Native unless asked.

## Stack

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

Run typecheck + test before declaring any change done.

## Architecture

Data sources push partial state -> StateAggregator merges into one `BikeState` (real values, with simulator
overrides layered on top) -> TriggerEngine evaluates each update and emits deduplicated `TriggerEvent`s ->
ClaudeClient turns an event into speech (or a canned fallback) -> AudioQueue decides when it may be spoken ->
Speaker outputs audio.

```
src/
  main.ts                  Wiring only. Builds the rig on START RIDE, mounts panels. No business logic.
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
Pi (Phase 4) must only mean swapping adapters that implement `DataSource` and `Speaker`.

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
- One line at a time: a line arriving while another plays waits and is spoken after it. Only P1 interrupts.
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

## Fuel range, sunset, debrief (built 2026-10-10)

- **Fuel range by distance** (for as long as there is no fuel gauge): the rider taps FILLED UP on the main screen;
  the engine counts km since then (`setFuelKm`/`filledUp`/`kmSinceFill`/`fuelKmLeft`) against `CONFIG.fuel.rangeKm`
  (default 280, a cautious guess for the 11 litre tank; tune it) and fires `fuel_range` at `fuel.warnKmLeft` (60).
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
- Web Bluetooth does not exist on iOS, so a browser cannot read an ELM327 dongle there. Real OBD2 = Phase 4 (Pi).

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
  say "I don't know" rather than guess. Lines she makes up herself are `UNPROMPTED_IDS` (no clock, no readings).
  Checked live: rain, sunset follow-up, traffic, fuel range, engine ("no engine data connected") and "what was
  the first thing I asked" all answered correctly from the state and the conversation.

- **Stage 2, push-to-talk (BUILT 2026-10-14)**. Stage 0 on the bike: play/pause, next and previous track reach the
  page; a button press CAN open the mic with no screen tap; the helmet mic ("V6") records once picked. Taking the
  buttons pauses music from other apps (iPhone gives buttons to the last app to start sound), so it is a per-ride
  switch on the start screen (`CONFIG.headsetButtons`, default off). Mapping (owner): play/pause = talk (press
  again to finish), next track = repeat her last line, previous track = nothing (owner said no).
  `HeadsetButtons` (silent loop + Media Session, primed inside the START tap), `PushToTalk` (mic from
  `CONFIG.micDeviceId`, chosen in the VOICE TEST picker; `core/SilenceDetector` stops 1.2 s after speech, gives up
  after 4 s of nothing, 8 s cap; mic closed straight after), tones at start and end, `AudioQueue.hold` so she does
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
  Not built yet: louder/softer, warning when he nears a marked spot (the road-hazard idea), quiet shown on screen.

## Backlog: chat-style test mode (spec; BUILT as stage 1 above, except scenario scripts)

Goal: talk to Betty from the desk as if you were the rider, against the live (or simulated) `BikeState`, to tune her
personality and see exactly what is sent to Claude, without riding.

Build it as a third panel, `src/ui/ChatPanel.ts`, mounted next to SIMULATOR (works in the same simulated session).

Behaviour:
1. Chat UI: message list + text input. The user types as the rider ("how's the bike?", "is it going to rain?",
   "any traffic ahead?"). Betty's replies appear as bubbles. Each bubble shows a small metadata line:
   source (`claude` or `fallback`), latency in ms, priority, and which trigger id if one fired it.
2. Rider messages are P4 and go through the SAME pipeline voice input will use later: text -> `rider_query` event
   (extend `TriggerEngine.describe` so the context includes the rider's actual words and the full relevant state:
   weather, nearest incident, temp, fuel, faults) -> ClaudeClient -> AudioQueue -> Speaker. Honour "Speak aloud".
3. Proactive speech (triggers firing from the simulator or evaluate()) also appears in the chat as Betty-initiated
   bubbles, so one timeline shows both what she said unprompted and what she said when asked.
4. "Show prompt" toggle on each Betty bubble: reveal the exact system prompt, situation text, bike-state JSON and
   "already said" list that were sent to Claude. This is the main tuning tool.
5. Multi-turn: add `ClaudeClient.converse(text, state)` that keeps a short rolling message history (last ~6 turns)
   so follow-ups work ("and tomorrow?"). Keep the 2-sentence spoken-style rule. This history IS the first cut of
   session memory (Phase 3); extract it into `core/SessionMemory.ts` when it grows.
6. Compare mode: a checkbox "Also show fallback" renders the canned fallback line under the Claude reply, to judge
   how much the AI phrasing adds.
7. Scenario scripts (stretch): named timelines that drive the simulator overrides, e.g. "overheat on the N3"
   (temp ramps 95 -> 112 over 60 s), "rain front" (rain chance 20 -> 90), "closure ahead". A dropdown plus
   Play/Stop. Scripts live in `src/ui/scenarios.ts` as plain data (array of `{atMs, set: {...overrides}}`).

Constraints:
- Without `VITE_ANTHROPIC_API_KEY` the chat must still work using fallbacks, and say so in the metadata line.
- Core stays pure: any new logic (history, prompt assembly) goes in `core/` with tests; the panel only renders.
- Prompt assembly should be a pure function `buildClaudeRequest(ev, state, history)` used by both ClaudeClient and
  the "Show prompt" view, so what you see is exactly what is sent.
- Add jsdom smoke tests in `tests/ui.smoke.ts` for: sending a message, bubble metadata, Show prompt, compare mode.
- Reuse this path later for voice: SpeechRecognition (Chrome/Android; iOS support is weak) -> same `rider_query` flow.

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

## Backlog: ambient personality — snark and tour guide (spec; built, see above)

Idea (from the owner): ambient (P3) remarks should not be only status commentary. Two flavours, mixed:
1. **Banter**: snarky, funny, dry. Affectionate teasing of the situation, never of the rider's skill or speed.
2. **Tour guide**: interesting knowledge about the area being ridden through (history, landmarks, odd facts), the
   way a local friend on the intercom would.
Betty should feel like a companion, so most ambient lines should be one of these, not "you've been out 45 minutes".

### Design decisions already made

- **Trust is the main risk.** A confident voice stating a wrong fact is worse than silence. Tour-guide lines must be
  GROUNDED: fetch facts for the current location, pass them to Claude as the only allowed source, and tell it to
  stay silent (return an empty string) if nothing supplied is interesting. Never let Claude "recall" local facts
  from its own training data for the spoken line. The existing prompt rule "never invent numbers, places or road
  names" stays and applies here.
- **Banter is grounded in the ride context** (time of day, weather, duration, steady speed, traffic, fuel, a long
  quiet stretch), not random jokes. Same rule: no invented numbers or places.
- **Safety stays serious.** P1 and P2 lines (overtemp, faults, low fuel, traffic, rain) are never snarky and never
  get a joke appended. No banter while any P1 condition is active. Never tease about speed or lean in a way that
  encourages riding harder, never comment on how fast he is going as praise.
- **Silence is a valid output.** If there is no grounded fact and nothing funny and true to say, say nothing.
  No canned banter fallback (canned jokes repeat and get annoying fast). Without Claude/network, ambient is silent.
- **Novelty.** Never repeat a place or fact in the same ride; keep a set of mentioned place ids (feeds the session
  memory work already on the backlog).
- Spoken style unchanged: 1 to 2 short sentences, plain spoken English, no markdown or emojis. South African
  context and register are welcome (en-ZA), without caricature.

### Proposed implementation

- New trigger ids (both P3, add to `TriggerId`/`TRIGGER_IDS`/`DEFAULT_CONFIG`): `ambient_banter`, `local_fact`.
  They share the existing P3 rules (safe window, `ambientCooldownMs`, `ambientMaxAgeMs`).
- **Chooser** (pure function in `core/`, injectable RNG for tests): when the ambient cooldown has elapsed and the
  safe window is open, pick `local_fact`, `ambient_banter`, or nothing using tunable weights. Add the weights to
  CONFIG and the TUNING panel (e.g. banter %, tour-guide %, silence %).
- **Place awareness** for tour guide: a `PlaceSource` adapter (DataSource) that, when the rider has moved more than
  ~1-2 km or the nearest notable place changes, fetches nearby notable places and short summaries and writes them to
  `BikeState` (e.g. `nearbyPlaces: {id, name, distanceKm, summary}[]`). Prefer firing `local_fact` when the area
  CHANGES (new suburb or landmark comes into range) rather than on a random timer.
- **Candidate data sources (all unverified, check before relying on them):**
  - Wikipedia GeoSearch (`action=query&list=geosearch&gscoord=<lat>|<lon>&gsradius=<m>`, with `origin=*` for CORS)
    plus the page summary REST endpoint for a short extract. Free, no key. Content is CC BY-SA, so keep it
    paraphrased and consider an attribution line in the log/UI.
  - Overpass API (OpenStreetMap) for named POIs (historic, tourism tags). Free, shared infrastructure, be gentle.
  - Reverse geocoding for suburb/locality names (Nominatim has a strict usage policy: about 1 request per second,
    no bulk use, and it expects an identifying referer/user agent). A cheaper alternative is to derive the area
    from the Wikipedia results themselves.
  - Cache results per rounded coordinate cell; round coordinates (about 2 decimals) before sending them to any third
    party. This is the rider's live location.
- **Prompt assembly**: extend the (future) pure `buildClaudeRequest(ev, state, history)` so `local_fact` includes only
  the supplied place snippets and `ambient_banter` includes the ride-context summary. Add per-flavour instructions to
  the system prompt, e.g. banter: "dry, affectionate, one quip, never mock the rider's riding"; tour guide: "one
  interesting fact from the supplied notes, tie it to where he is, say nothing if the notes are dull".
  Claude may return an empty string; `ClaudeClient` and the queue must treat that as "say nothing".
- **Simulator support (needed to develop this at a desk):** location presets or a lat/lon override in the SIMULATOR
  panel (Edenvale, Johannesburg CBD, Soweto, Sandton, Pretoria, Cape Town), buttons to fire `ambient_banter` and
  `local_fact`, and the grounding snippets shown under "Show prompt" in the chat test mode.
- **Tests:** chooser distribution with a seeded RNG (weights respected, silence respected); novelty (a mentioned
  place is never chosen twice); no ambient while a P1 condition is active; empty Claude reply produces no speech;
  prompt builder includes only supplied snippets. Add jsdom smoke tests for any new tuning controls.

### Acceptance criteria

- On a simulated ride through a new area, Betty produces a grounded tour-guide remark once, not again for that place.
- With only a weather/time context she can produce one believable quip that contains no invented specifics.
- Setting the tour-guide and banter weights to zero makes ambient silent; nothing else regresses.
- With an overtemp active, no banter or tour-guide line is spoken.

## Backlog: offline line bank (NOT BUILT, spec for a later session)

Goal: when the phone has no signal (or Claude is slow), Betty should still sound like Claude wrote the line, not
fall back to one fixed sentence or go silent. Owner agreed the approach on 2026-10-10 and asked for it to be parked.

**Do not build a replay cache** (store lines she has said, play them back). Her lines carry specifics ("fuel's at 55
percent", "thirty-six minutes in") that are wrong when replayed, and replaying repeats lines the rider has heard.

**Build a line bank instead**: while online, ask Claude in the background for lines likely to be needed soon, store
them on the device, use each at most once.
- **Alerts with placeholders.** A few variants per alert id with blanks, e.g. "Fuel's down to {fuel} percent, {rider},
  time to find a station." Fill the live value at speak time, so the wording is Claude's and the fact is current.
  This also upgrades P1, which today always speaks the one canned fallback because it never waits on the network.
  P1/P2 variants must stay straight (no jokes), same as the live rule.
- **Tour-guide lines ahead of time.** Place facts do not change: fetch places in a wider radius (about 10 km) and
  generate the `local_fact` line per place straight away. When the rider gets near, the line is already there.
  Strongest case; also removes the roughly 1 s latency. Direction ("ahead on his left") cannot be pre-written:
  generate without it, or leave a `{where}` placeholder.
- **Banter.** Weakest fit (the best banter reacts to what just happened). Pre-generate for slow-changing topics
  (time of day, weather as last fetched, last ride, totals) and numeric topics via placeholders.
- **Validity check before speaking**: a banked line is used only if what it was written for still holds (weather
  bucket unchanged, same part of day, place still unmentioned). Reuse the topic `bucket` ids in `core/ambient.ts`.
- **Shape**: pure `core/LineBank.ts` (store, take-once, validity, placeholder fill, refill policy) with tests; an
  adapter persists it in localStorage; `ClaudeClient.phrase` tries live Claude first and takes from the bank on
  `no API key`/`network error`/`timeout`/HTTP error, before the canned fallback. Report it in `Phrase.source` as a
  third value (`bank`) so the log shows it. Refill when online and the bank for an id runs low; cap the size.
- **Costs/limits**: a bank of 30 to 40 short Haiku lines per ride is a few cents, some unused. Banked lines cannot
  refer to what she said two minutes ago, so offline she is a little more generic.
- **Two things the bank does not cover**: (1) if Safari reloads the tab with no signal the app does not load at all;
  that needs a service worker caching the app shell, and is arguably more important. (2) Weather and traffic go
  stale offline regardless. GPS and the on-device speech voice keep working.
- **Order**: first measure (the saved LOG tags every line `claude` or `fallback: network error/timeout`, so a few
  real rides show how often it happens), then service worker, alert variants, tour-guide pre-generation, banter last.

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

## Backlog: settings by voice and personalities (PARTLY BUILT, see above; owner, 2026-10-16, "like TARS in Interstellar")

Goal: she reports her own settings and he changes them by voice, TARS style ("humour, 75 percent"). Builds on the
stage 3 command path (`parseCommand` -> carried out on the phone -> instant reply, works offline).
- **Status report**: "status" / "what are your settings" -> she reads them out: the flavour mix as percentages
  (banter / tour guide / silence, from `CONFIG.ambient` weights), how often she chats (`ambientCooldownMs`), line
  length (`maxSpokenSentences`), the active personality, and quiet if on ("Banter 40, tour guide 40, silence 20.
  Chat every two minutes. Quiet for another 8 minutes.").
- **Dials by voice**: "banter up/down", "tour guide up/down", "more/less chatty" (silence weight and/or the gap),
  "shorter/longer answers", "set banter to 70 percent". Steps of 10, the mix renormalised to 100, clamped. Reply
  states the new value. Saved with `saveConfig` so TUNING shows it.
- **New dial: humour** (0 to 100, the TARS one): goes into the banter/answer prompts as how dry and how often to joke.
  P1/P2 lines stay straight regardless (behaviour rules).
- **Personalities**: named presets of all the dials plus a prompt flavour, e.g. commute (quiet, short, alerts and
  answers only), weekend (chatty, banter-heavy), tour (tour guide heavy, longer lines), plus his own saved ones.
  "Switch to weekend mode", "what mode are you in". Also a picker on the main screen. Overlaps the "Moods/personas"
  idea below; this replaces it.
- Open questions for the owner before building: which presets and what is in each; whether a voice change lasts
  only for this ride or until changed back.

## Ideas backlog (owner asked for these to be recorded, 2026-10-10; none built unless marked)

Co-pilot:
- Voice input "Hey Betty" (notes below). Biggest single upgrade; unlocks her questions and remembering what he says.
- Route awareness: a destination gives fuel stops in range, weather where he will be in 30 min, distance/time left,
  tour-guide facts for places being approached.
- Fuel range without OBD: BUILT. Sunset and light warnings: BUILT.

Safety:
- Crash detection: hard impact then no movement starts a countdown, then messages an emergency contact with the
  location. A web page cannot send an SMS by itself, so this is a native-app or Pi feature done properly.
- Fatigue nudges from time in the saddle and time of day, naming the next stop.
- Road-hazard memory: remember where hard jolts or hard braking happened and warn on approach next time.
- Wind and cold: crosswind relative to heading, wind-chill at speed.

Personality and memory:
- Ride debrief: spoken sign-off BUILT. Still open: a written report with a map of the route.
- Longer memory: favourite roads, places visited, personal records, "last time we came through here it rained".
- Moods/personas: a quieter commuting mode, a chattier weekend mode, switchable on screen.
- Better voice (notes below).

Practical:
- Offline line bank and offline loading (see the backlog section above); home-screen install.
- Music ducking and quiet times (stay silent during a call, lower music while speaking).
- Maintenance log: chain lube, service intervals, tyre age by distance ridden, with reminders.
- Group rides: two riders running Betty share position ("your mate has dropped back").

Hardware (Phase 4): real engine data, tyre pressure sensors, a handlebar button ("repeat that", "quiet for ten
minutes", "mark this spot"; one physical button beats any on-screen control on a bike), camera clips saved on a hard
brake or a "mark this" press.

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
   (streamed) and banter. RISK, UNVERIFIED: Web Audio is a second sound source next to the headset-button track and
   might take the buttons away on iPhone. TO REVERT: pick "Gemini for her own remarks only" (the old `mixed`) on the
   main screen, or `git checkout before-gemini-stream` for the code (tag pushed). `adapters/CloudSpeaker` falls back to the phone voice
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

## Next steps (suggested order)

1. Deploy to Vercel, test on the phone with helmet comms on a real ride (audio routing, GPS cadence, lean zeroing).
2. Verify Open-Meteo and TomTom parsers against live responses (see Feeds); fix any shape mismatch.
3. Move the Claude/TomTom calls behind Vercel serverless functions so keys are not exposed.
4. Build the chat-style test mode above.
5. Ambient personality: done. Tune weights and prompts after real rides.
5b. Offline line bank + service worker (see the backlog section above), once the logs show how often signal drops.
6. Memory: ride stats and past-ride records are built. Still open: remembering what the rider says (needs voice input).
7. Voice input "Hey Betty" feeding the same `rider_query` path.
8. TPMS BLE (Web Bluetooth works on Android Chrome only; otherwise Phase 4).
9. Phase 4: Pi adapters (python-obd/ELM327, Piper TTS, Porcupine). Hardware BOM was estimated around R2,180 total.

## Conventions

- TypeScript strict. Keep `core/` pure and covered by tests; adapters and ui stay thin.
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
