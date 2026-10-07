# CLAUDE.md — Betty

Context for any Claude Code instance picking this project up. Read this first.

## What Betty is

An always-on voice co-pilot for a motorcycle (owner: Nhlanhla, 2018 BMW G 310 GS, Gauteng, South Africa).
She talks to the rider through Bluetooth helmet comms, reads bike/ride data, and speaks proactively
like a co-pilot with personality, not like an alert system. Warm, dry wit, direct, max 2 short sentences.

The rider can also speak to her ("Hey Betty, how's the bike?"). That voice-input path is not built yet.

## Owner preferences

Direct, concise communication. No hedging, no over-explaining. Hold him to account plainly: if something
is wrong or risky, say so.

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 1 Voice foundation | Scaffold, GPS speed, TTS to helmet, "Systems online", trigger engine, audio queue | Done (web app) |
| 2 Data feeds | Weather, traffic, phone IMU lean, TPMS BLE, mock OBD2 | Weather (Open-Meteo), traffic (TomTom, key optional), IMU lean, mock OBD2 done. TPMS outstanding |
| 3 AI brain | Claude-phrased speech, session memory, voice input "Hey Betty", chat test mode | Basic phrasing done. Memory, voice input, chat test mode, ambient personality (banter + tour guide) outstanding |
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
    ClaudeClient.ts        Event -> natural speech, with timeout + fallback
    geo.ts                 haversineKm, bboxAround
  adapters/                Everything that touches a browser API, network or hardware
    WebGeoSource.ts        navigator.geolocation -> speed/lat/lon/heading
    WebMotionSource.ts     deviceorientation -> approximate lean angle (needs zeroing)
    WebSpeaker.ts          speechSynthesis (prime() must run inside a tap on iOS)
    SwitchableSpeaker.ts   Wraps a speaker; "silent" mode simulates duration so queue behaviour is observable
    WakeLock.ts            Screen wake lock so the browser doesn't throttle GPS/timers
    MockObdSource.ts       Simulated RPM/temp/fuel; temp ramps toward overtemp; reset()
    WeatherSource.ts       Open-Meteo (no key). Polls by time or distance moved
    TrafficSource.ts       Polls a TrafficProvider; idle without one
    TomTomTraffic.ts       TomTom incidentDetails v5 provider (needs VITE_TOMTOM_API_KEY)
  ui/
    SimPanel.ts            SIMULATOR panel (mounted per ride)
    TuningPanel.ts         TUNING panel (always mounted)
    dom.ts                 el/button/checkbox helpers
tests/core.test.ts         Pure logic tests
tests/ui.smoke.ts          Drives both panels in jsdom (sliders, buttons, config edits)
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

All priorities, cooldowns and thresholds are read live from `CONFIG` at call time and can be edited in the TUNING
panel (persisted to localStorage). Adding a trigger = add the id to `TriggerId` + `TRIGGER_IDS`, entries in
`DEFAULT_CONFIG.priorities` and `.cooldownsMs`, a case in `TriggerEngine.describe`, an evaluate rule, and tests.

## Behaviour rules (do not weaken without being asked)

Priorities: P1 critical, P2 advisory, P3 ambient, P4 rider-initiated.

- P1 interrupts immediately, clears other queued items, and NEVER waits on the network: ClaudeClient returns the
  canned fallback for P1 (this follows the *configured* priority, so a trigger promoted to P1 also skips Claude).
- P2 waits for a safe window: RPM < 5000 and |lean| < 20 deg (both tunable).
- P3 waits for a safe window, is rate-limited by `ambientCooldownMs` (default 2 min, enforced in AudioQueue), and is
  dropped if queued longer than `ambientMaxAgeMs` (60 s).
- P4 always speaks next.
- No repeating herself: per-trigger cooldowns, per-incident dedupe, and ClaudeClient passes recent lines to Claude.
- Every API/hardware failure has a fallback. Sources failing must not crash the app.
- Target latency trigger -> speech under 3 s.
- AudioQueue uses a generation counter: `speechSynthesis.cancel()` still fires `onend` for the cancelled utterance,
  and without the guard that stale callback released the speaker mid-P1. There is a regression test; keep it.

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
  Requests `current=temperature_2m,precipitation,wind_speed_10m,weather_code` and
  `hourly=precipitation_probability&forecast_hours=3`. Rain chance = max of the first two hourly values.
  UNVERIFIED LIVE: the build environment could not reach the API. Check the first real response against the parser.
- **Traffic**: there is no keyless live-traffic-incident API. The real provider is TomTom Traffic Incident Details v5
  (free developer key, set `VITE_TOMTOM_API_KEY`; free-tier limits not confirmed from the docs read, check them).
  Parser follows TomTom's documented response shape but has NOT been run against the live API. Without a key,
  traffic is simulator-only. `TrafficProvider` is an interface: another provider is one small class.
- Both sources only update `BikeState.weather` / `.incidents`; triggers decide what to say.

## Browser constraints (learned the hard way, keep in mind)

- Geolocation, device motion and speech need HTTPS. `localhost` is exempt, so phone testing needs a deployed URL.
- iOS: motion permission (`DeviceOrientationEvent.requestPermission`) and speech priming must be triggered
  directly from a tap, before other awaits. `main.ts` does this at the top of `start()`.
- Backgrounded tab / locked screen = GPS and timers throttled, Betty effectively stops. Wake lock mitigates
  but does not solve it. This is the main limitation versus native and the reason for Phase 4.
- Lean angle from the phone is approximate (sensor fusion lags in sustained corners, handlebar vibration adds noise).
  Fine for the safe-window check; not suitable for logging real lean angles. Phone must be mounted upright,
  screen facing the rider, then zeroed with the bike upright.
- Web Bluetooth does not exist on iOS, so a browser cannot read an ELM327 dongle there. Real OBD2 = Phase 4 (Pi).

## Vercel deployment

- Framework preset: Vite. Build command `npm run build`, output directory `dist`. No `vercel.json` needed.
- Env vars (all optional): `VITE_ANTHROPIC_API_KEY`, `VITE_TOMTOM_API_KEY`.
  **Anything `VITE_`-prefixed is baked into the public JS bundle.** Acceptable only for a private personal deployment.
  Before sharing the URL with anyone, move the Claude call (and TomTom call) to Vercel serverless functions
  (`/api/phrase`, `/api/traffic`) that hold the keys server-side and point the clients at them.
  With no keys set, Betty uses fallback phrases and traffic is simulator-only; everything else works.
- Never commit `.env`. `.env.example` documents the variables.

## Backlog: chat-style test mode (NOT BUILT, spec for the next session)

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

## Backlog: ambient personality — snark and tour guide (NOT BUILT, spec for a later session)

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

## Next steps (suggested order)

1. Deploy to Vercel, test on the phone with helmet comms on a real ride (audio routing, GPS cadence, lean zeroing).
2. Verify Open-Meteo and TomTom parsers against live responses (see Feeds); fix any shape mismatch.
3. Move the Claude/TomTom calls behind Vercel serverless functions so keys are not exposed.
4. Build the chat-style test mode above.
5. Ambient personality (banter + grounded tour guide), see the backlog section above.
6. Session memory as a proper core module instead of the short list in ClaudeClient.
7. Voice input "Hey Betty" feeding the same `rider_query` path.
8. TPMS BLE (Web Bluetooth works on Android Chrome only; otherwise Phase 4).
9. Phase 4: Pi adapters (python-obd/ELM327, Piper TTS, Porcupine). Hardware BOM was estimated around R2,180 total.

## Conventions

- TypeScript strict. Keep `core/` pure and covered by tests; adapters and ui stay thin.
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
