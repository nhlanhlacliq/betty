# Betty native (React Native + Expo)

The iPhone and Android app. Started 2026-10-18 (owner chose React Native + Expo over Swift/Kotlin and Capacitor).
Read the repo's `CLAUDE.md` first: behaviour rules, triggers and the owner's preferences apply here unchanged.

## How it fits with the web app

- Betty's brain is shared, not copied: the app imports `../src/core`, `../src/config`, `../src/app` and the adapters
  that only use `fetch` and the shared store (feeds, all the `*Store`s). `metro.config.js` adds `../src` to Metro's
  watch folders; `tsconfig.json` includes those folders so `npm run typecheck` here checks them too.
- THE RIDE ITSELF IS SHARED (2026-10-24, stage 1 of the port): `src/app/RideSession.ts` is the whole ride (sources ->
  engine -> Claude -> queue -> voice, saving rides/log/fuel/odometer/roads as it goes, her commands, his questions,
  Horizon's buttons, the sign-off) and `src/app/LineLogger.ts` the saved log. Both apps build one with their own
  `RideDeps` (sensors, voice, OBD, events). `native/src/rig.ts` is only that wiring plus the voice server.
- STORAGE: every shared store reads and writes through `src/adapters/kv`. The native app calls `openStore()`
  (`native/src/adapters/NativeStore.ts`) BEFORE anything reads a store (App.tsx waits for it, then `loadConfig()`):
  all `betty.*` AsyncStorage entries are loaded into memory, writes go back in batches (0.5 s, and at once when the
  app goes to the background). Same keys as the web app, so a web backup can be imported as it is (stage 5).
- SERVER: `native/src/server.ts` calls `setServer()` (src/adapters/server), so every `/api/...` request in the shared
  code goes to betty-zeta.vercel.app with `x-betty-origin`. Use `serverFetch` (the shared adapters' default fetcher).
- Anything that touches the phone (GPS, speech, Bluetooth, audio) is a NATIVE ADAPTER in `native/src/adapters/`,
  implementing the same interfaces as the web adapters (`DataSource`, `Speaker`, `ObdTransport`).
- If something needs logic, put it in `src/core` or `src/app` with tests so the web app gets it too.
- Never import from `src/main.ts`, a browser adapter or a DOM screen in `src/ui` (they use `window`, the DOM).
  Pure helpers in `src/ui` (`rideView.ts`, `copy.ts`, `mapView.ts`) are fine. `tests/session.test.ts` runs a whole
  RideSession in plain Node (no window, no localStorage): it fails if browser code creeps into the shared ride.
- The web app stays live at https://betty-zeta.vercel.app until the native app replaces it.
- The app calls Betty's server (`native/src/server.ts`) for Claude and, later, voices, traffic and transcription. It
  sends `x-betty-origin` because it has no page origin (`api/_shared.ts` `fromBetty`).

## Screens (stage 3 of the port, 2026-10-24; NOT YET RUN ON A PHONE)

Expo Router (`index.ts` loads the polyfill, then `expo-router/entry`; scheme `betty`). Routes in `native/src/app`
(NOT the repo's `src/app`, which is the shared RideSession):
- `_layout.tsx`: root Stack, `BettyProvider` (`src/state/Betty.tsx`: store ready, the ride, repaint tick throttled to
  250 ms, voice state, mode real/sim, open mic, OBD reader, log lines, start/end with "tap again to stop now", hello,
  toast), and `ui/Toast`.
- `(tabs)/_layout.tsx`: the web's four tabs (Ride, Journeys, Explore, Garage) as a custom tab bar, the ride-in-progress
  bar above it, the live dot on Ride; the Ride tab goes to the ride while one runs.
- `(tabs)/index.tsx` HOME (design v3): map sketch of the last ride or the planned route (pan/pinch/double tap,
  recentre), wordmark + initial, greeting and condition pill, dock: orb (tap = hello in Chirp), "How are we riding?"
  sheet (Free ride / Desk test, Open mic switch, Android OBD reader, Where to? = api/route with twisty, route summary,
  Open in Google Maps, Clear), Let's ride, the "before you go" sheet (readiness rows, fuel range, Filled up).
- `ride.tsx` RIDE: map following him (+/−/recentre, pan/pinch takes it off follow), live pill, menu sheet (Journeys,
  Explore, Garage), Quiet, Horizon (`ui/Horizon.tsx` on the shared `islandView`), dock: km / min / speed, mini orb (tap
  = repeat), kicker + state, her line (dimmed when earlier), chat button (ask sheet with chips), the MIC (hold to talk;
  with open mic a tap mutes/unmutes), Lock (cover, hold 1 s to unlock, big Tap to talk), End ride (confirm sheet;
  during the sign-off a tap stops at once), the note line; Up ahead sheet for a route. Her answers from the voice
  server are her line too (`VoiceSession.onSaid/onSpeaking`, wired in rig.ts). No ride -> back to the tabs.
- STAGE 4 (2026-10-24, NOT YET RUN ON A PHONE): `(tabs)/journeys.tsx` MY JOURNEYS (totals, fuel spend, On this day,
  month so far with week bars, Records + next milestone, Your roads map with tap-to-open, months (newest open), search
  + starred, hold a ride to select: Short rides / Star / Delete with confirm); `story/[id].tsx` THE RIDE'S STORY (orb,
  Star, Rename in place, blurb, numbers, riding/stopped bar, road map with rough spots, moments and her lines folded,
  Share the log (share sheet, plain text), Ride this again (api/route -> RouteStore -> Ride tab), Delete). After End
  ride a kept ride opens its story. `(tabs)/explore.tsx` EXPLORE (tally, story of the day, tabs Everything / Area
  stories / Not heard yet / Notes, search, area cards with heard ring + New tag + stories folded to 3 + Listen (Chirp,
  heard to the end = told) + Ride there (fills Where to? on Home), spots (Open map, Forget) and notes (Forget), Map mode
  with area pins + spots, tap a dot for its sheet; areas without a position looked up one a second).
  `(tabs)/garage.tsx` GARAGE (Help, Voice commands, What's new (sheet, badge on the tab), the log; personality:
  narration presets + his modes, humour and TARS steppers, little animations, Let Betty know me (+ the sheet: copy the
  question, paste, Distil via api/profile, Save, Forget), hear her voice; Horizon switches; voice (Chirp voice list,
  louder); names, fuel (Filled up, tank/reserve, consumption, price), road drawings, riding time only; Reminders
  (odometer = alignToOdometer, Done/Undo, edit/add sheet, delete, mark as not done); smarter web answers).
  `help.tsx` HELP (shared HELP_TOPICS drawn by `ui/Html.tsx`, search, `/help?topic=<id>`), `log.tsx` THE LOG (session
  lines, Share the whole saved log). Shared helpers moved for this: `src/app/rides.ts` (rideTitle, duration,
  spokenLines, triggerOf, deleteRideData), `src/app/whatsNew.ts` (read state), `ASK_ABOUT_ME` -> adapters/ProfileStore.
  NOT in the app yet: ride and month picture cards (web canvas), send to a friend's Betty, saved routes / plan with
  Betty, the map's suburb borders and card place names, her picture in the orb, the Workshop (simulator, tuning),
  Your data export/import (stage 5).
UI pieces in `native/src/ui`: `theme.ts` (the web's tokens), `Icon` (the web's icon paths via SvgXml), `Orb` (the
web's blob as an SVG path + radial gradient, breathing with Animated; still with Little animations off or Reduce
Motion), `MapSketch` (the shared `mapSvg` string in SvgXml; gestures with PanResponder and the shared `viewAfter`),
`Sheet`, `Buttons`, `Horizon`, `Toast`, `Card` (Card, Setting, Toggle, Stepper instead of sliders, Field, Choice, Fold,
Search), `Html`, `fuel.ts`. Pure helpers moved out of web DOM files so both apps use them:
`islandView` -> src/ui/rideView.ts, `routeRequest`/`routeStats` -> src/core/Route.ts, `readinessRow` ->
src/core/Reminders.ts (re-exported where they were). Not yet: slim docks, word-by-word line, her picture in the orb,
saved routes / plan-with-Betty / stop weather in Where to?, the ride's story after End ride (stage 4).

FIRST PHONE TEST OF STAGES 1-6 (2026-10-24 evening): the ride itself worked (briefing and lines from Claude, areas,
Horizon), but (1) EVERY voice turn reached the server as silence ("heard: ''", 67 s and 79 s of audio): her Chirp clips
play through expo-audio, whose default mode is the playback category, which silences the mic the Daily call uses.
Fix: `AudioFocus.setRecording` (VoiceSession turns it on while the call is open) keeps allowsRecording in every
mode. (2) The "silent" button track had a periodic LSB step = a 2.7 kHz whine: now 16-bit with random ±1 LSB.
(3) Background GPS failed: "add 'location' to UIBackgroundModes": app.json had it, but the ios/ folder was generated
before. RULE: after changing app.json or adding a package with a config plugin, run `npx expo prebuild --platform ios
--clean` before `expo run:ios` (ios/ is generated and is NOT regenerated by run:ios). (4) With the phone locked and
foreground-only GPS, JS was suspended (a time check took 99 s): fixed by (3).

## Stage 6 (2026-10-24; NOT YET RUN ON A PHONE)

- BACKGROUND RUNNING: `ExpoGeoSource` runs the ride's GPS as a background location task (`RIDE_GPS_TASK`, defined at
  load from index.ts; startLocationUpdatesAsync, 1 s, no auto-pause, blue pill on iOS, foreground-service notification
  on Android). Needs the "Always" location permission (asked at ride start; else Settings > Betty > Location >
  Always); without it, the old foreground watch and a `[gps]` log line saying so. app.json: UIBackgroundModes audio,
  voip, location; NSLocationAlwaysAndWhenInUseUsageDescription; expo-location background options; Android
  ACCESS_BACKGROUND_LOCATION + FOREGROUND_SERVICE(_LOCATION); expo-audio enableBackgroundPlayback.
- MUSIC DUCKING: `adapters/AudioFocus.ts` owns the audio mode (plays with the silent switch on, in the background):
  mixWithOthers when idle, duckOthers while a line of hers plays (ChirpSpeaker/ExpoSpeaker call lineStart/lineEnd;
  a 600 ms tail; a cut-off line lets the music back up), doNotMix kept for headset buttons later (`setExclusive`).
  UNVERIFIED: how it sits with the open voice-server call (Daily's playAndRecord session), and whether iOS lifts the
  duck when the mode goes back to mix while the session stays active.
- HEADSET BUTTONS (built after all, owner: "as long as I can try headset buttons mode and open mic"):
  `adapters/HeadsetButtons.ts`, a switch in "How are we riding?" (`CONFIG.headsetButtons`, saved; works mid-ride). An
  expo-audio playlist of three copies of `assets/silence.wav` (a minute, near-silent), looping, on the lock screen
  with next/previous shown; doNotMix (AudioFocus.setExclusive), so it PAUSES his music. Play/pause = the playlist
  pausing (not by us, 1.5 s quiet window after our own play/skip): hold-to-talk mode presses the mic and releases on
  his final transcript (`VoiceSession.onHeardRider`), after 10 s, or on the next press; open mic = mute/unmute.
  Next track = repeat her last line; previous = let go (buttons and music back, toast). UNVERIFIED: whether presses
  still arrive once the voice server's mic has opened (call mode, the web's old problem).

PHONE TESTS, 2026-10-24 evening (owner, standing still; logs in his Downloads):
- WORKS: hold-to-talk and open mic hear him (the setRecording fix), background GPS ("running in the background too"),
  web search through the voice server, open mic ignoring sentences without "Betty".
- FIXED after: (1) each of her sentences logged twice (the server sends a sentence when written and when spoken):
  `VoiceSession` shows it once. (2) Two voices at once (her status line and the conversation's answer): the rig calls
  `RideSession.conversation(on)` on his turn (`onRiderTurn`) and while she answers (`onSpeaking`), which cuts off the
  line playing (`AudioQueue.cutOff`, never a P1) and holds the queue; limits 30 s / 8 s / 60 s / 1.5 s so a lost event
  cannot mute her. (3) The briefing stopped when the call connected ("Chirp: no end after 275 chars"): ChirpSpeaker
  plays on when the phone pauses a clip (up to 3 times). (4) Talk mode and headset buttons are switches in the ride's
  menu sheet too. (5) The sign-off was "cleared" on both rides (unknown why): `signOff` now logs the reason.
- HEADSET BUTTONS DO NOT WORK WITH THE VOICE SERVER: the Daily call keeps the helmet in CALL MODE (HFP) for as long as
  it is connected, in every talk mode, so play/pause becomes a call control: the first press dropped the helmet's link
  (she played on the phone speaker), on the next ride one press worked, then none. The same cause as the web on
  2026-10-16. Fix options (OWNER'S CALL): buttons mode uses the web's old path (record with expo-audio only while he
  talks, Whisper, Claude, Chirp: ~5-7 s instead of ~2 s, helmet back in media mode after each question), or the call
  is closed between questions (reconnect ~10-14 s a press: too slow), or drop the buttons on iPhone.
- HELMET HANDS-FREE ONLY WHILE HE TALKS (owner chose this, 2026-10-25; BUILT, UNVERIFIED ON THE PHONE): our own
  local Expo module `modules/betty-audio-route` (Swift, iPhone only; autolinked from modules/, needs prebuild --clean)
  sets the sound while the call is open: playAndRecord always (the call needs it), but the Bluetooth link "call"
  (HFP, voiceChat, waits up to 1.5 s for the helmet mic) only while he talks, "media" (A2DP: stereo music, her voice,
  buttons are play/pause) otherwise; mix / duck / solo for his music. Daily is told `setDailyAudioMode('idle')` after
  joining and on each press so it stops re-applying its own call setting (it forces HFP + voiceChat:
  WebRTCModule+Daily.m), and AudioFocus no longer calls expo-audio's setAudioModeAsync during the call (it forces HFP
  with recording on). Push-to-talk: helmet mic on press, off with the mic after release. Open mic: hands-free while
  listening, stereo when muted. Her answers through the call duck his music too. Every helmet switch is logged as
  `[audio] helmet hands-free/stereo in N ms; in: ...; out: ...` (the route names show whether it worked). Headset
  buttons: pauses of the silent track within 2.5-3 s of a switch are played on, not taken as presses. Costs: up to
  ~1.5 s from press to mic (first word may clip), and a press during his turn cannot arrive (call mode).
  Android: no module, the old behaviour (recording allowed for the whole call).
- STILL TWO VOICES (owner, 2026-10-25): the hold worked, but a "cut off" clip kept PLAYING: expo-audio's
  `player.remove()` only drops the player from its registry (AudioComponentRegistry.swift), it never pauses.
  ChirpSpeaker now pauses before removing. Open mic: "Betty" in any transcript (interim too) starts his turn at once
  (her remark stops), instead of waiting for her answer to start.
- TEST 2026-10-25 00:21-00:36 (server journal + his log): the helmet switch WORKS (stereo 379 ms, hands-free 31-85 ms,
  routes V6 A2DP / V6 HFP), no two voices (a remark was cut when he said "Betty"), the sign-off played. But
  hold-to-talk heard nothing on some presses (1st and the last two of six: `heard: ''`). Suspected: two audio
  changes in flight finishing out of order (AudioFocus now runs them one at a time, ending on the latest); each press
  logs `[voice] mic on: in: ...; out: ...` to confirm which mic the call got.
- TEST 2026-10-25 00:38: HEADSET BUTTONS WORK (5 presses in a row: hands-free 0.6-0.8 s after the press, stereo after
  his words). Fixed after: the first press was lost to the ~9 s connect (the app now connects at ride start, and the
  server has no idle timeout for app sessions: they last the ride, ending when the app leaves); names misheard
  (Modderfontein, Betty as "Pretty"): Deepgram keyterms in every mode = Betty + LOCAL_NAMES (bot.py) + up to 40 names
  the app sends at connect (area, nearby places, route stops, bike name); her own lines now wait 4 s (was 1.5 s) after
  she stops in the conversation (an area story started between two of her sentences).
- MUSIC: open mic puts the music at call quality (the helmet is in call mode the whole time; nothing the app can
  change), and the music sometimes paused while she spoke (likely the duck switching the audio session under the
  call). Ducking without the call works.

## Status (first slice, 2026-10-18; NOTHING RUN ON A PHONE YET)

Built: a plain ride screen (`App.tsx`): Let's ride / End ride, speed, rpm, engine temperature, rain chance, her lines
with their fate, a box to type a question; GPS (`ExpoGeoSource`, foreground), weather, Claude through the server,
the phone's voice (`ExpoSpeaker`, expo-speech, en-ZA), the briefing and the sign-off; on Android, real OBD2 through
an ELM327 over Bluetooth Classic (`ElmClassicTransport` + `ObdSource`, protocol in `src/core/Elm327.ts`, tested).
Checked: `npm run typecheck` and `npm run bundle` (Android and iOS JavaScript bundles build). Not compiled natively
(the Mac had no Xcode, Java or Android SDK on 2026-10-18).

Next, in order (owner's plan): run it on his Android phone with the reader -> iPhone build from Xcode -> background
running (location task, audio session) -> saved rides and log (storage adapter) -> push-to-talk and headset buttons ->
cloud voices with ducking -> reminder notifications (local, expo-notifications) -> the real screens (port the web
design) -> CarPlay voice template and Siri App Intents (needs the paid Apple account) -> quiet during calls, crash
detection, group rides.

First run on the owner's iPhone 12 (2026-10-18): signing works with his free Personal Team (`ios.appleTeamId`
6DHA6234P3 in app.json, so a regenerated ios/ keeps it); the dev build installed, then CRASHED at launch in
`RNBluetoothClassic.init()` (assertion). Fix: `react-native.config.js` keeps that library out of the iOS build, and
`ElmClassicTransport` only `require`s it on Android. After that it RAN: briefing and typed answers from Claude in 1.2 to 2.3 s,
GPS and weather live; but SILENT (the default iOS audio session obeys the silent switch) and `<short pause>` showed:
`setUpAudio` (expo-audio `playsInSilentMode`, `mixWithOthers` for now) and `voiceTags(text, false)` for the phone voice
and the screen. Crash reports: `xcrun devicectl device info files --device <id>
--domain-type systemCrashLogs`, then `devicectl device copy from ...` (the .ips JSON has the faulting thread).

TALKING TO BETTY, step 2 (2026-10-19; NOT YET RUN ON A PHONE): `src/voice/VoiceSession.ts` joins the voice server
(voice/ in the repo, voice.forme.africa) with Pipecat's React Native client over Daily. Push-to-talk ("Hold to talk to
Betty" in App.tsx): the mic is on only while held (+0.4 s tail), so the helmet is in call mode only then; holding while
she speaks interrupts her (the server stops when it hears him). The connection opens on the first press and lasts the
ride (the server ends it when idle; the next press reconnects). `/start` gets {transport: daily, createDailyRoom, body:
{system (bettySystemPrompt + rider_query flavour, cloudVoice forced to chirp so no voice tags), greet: false,
situation}}; each press sends `situation` (`engine.voiceSituation`, src/core, shared with the web app). Phone tools in
`src/voice/phoneTools.ts` (ALL real since 2026-10-24, stage 2, on the shared stores): filled_up, set_quiet (minutes;
"until a place" falls back to until told; drops queued banter), talk_again, mark_spot / remember_note
(RiderMemoryStore), my_notes_and_spots, fuel_stations_ahead (StationSource through the server), weather_along_route
(the ride's route weather, fetched on the spot if the ride has none yet), recall_ride (`pastRecall` over RideLog +
LineLogStore; "the ride to Clarens" finds it by place, otherwise the last ride), maintenance_due (`describeDue`, all
reminders + odometer), reminder_done (`RideSession.reminderDone`), end_ride (answers, then 1.5 s later
`RideSession.requestEnd` -> App's end: the phone says the sign-off). Rides, reminders and routes in the native app are
its OWN until the web backup is imported (stage 5): on a fresh install they are empty.
HER VOICE (2026-10-24): `src/adapters/ChirpSpeaker.ts`: her own lines (briefing, alerts, banter, stories, sign-off) in
Chirp via `/api/speak` (MP3 saved to the cache with expo-file-system, played with expo-audio, 40 kept), fetched the
moment a line is written; not in within 2 s + 15 ms a character (min 3.5 s), failed or unplayable -> the phone voice
(`ExpoSpeaker`). Measured from the Mac: ~1.1 s warm, 4.1 s cold. RISK, UNVERIFIED: expo-audio playing while the Daily
call holds the iPhone's audio session (playAndRecord); if her lines go silent or quiet during a voice session, that
is where to look. His answers in a conversation still come from the voice server.
Login: Basic `app` + EXPO_PUBLIC_VOICE_TOKEN in `native/.env` (git-ignored; a
second Caddy user on the server, separate from the browser login). Packages: @pipecat-ai/client-js 1.14,
@pipecat-ai/react-native-daily-transport 1.8, @daily-co/react-native-daily-js 0.88.0 (Daily's table for Expo 57; the
Pipecat transport asks for 0.86), @daily-co/react-native-webrtc 124.0.6-daily.2, async-storage 3.x, background-timer,
get-random-values 1.x (imported first in index.ts), Expo plugin @daily-co/config-plugin-rn-daily-js 0.0.13 (lists Expo
55-57; we are on 58: the main risk) with mic only; iOS UIBackgroundModes audio + voip. Installed with --legacy-peer-deps.
Not yet: music ducking for her answers (Daily's audio session), the fallback to the current path without signal.
OPEN MIC (2026-10-23, owner: to test hands-free on the bike; NOT YET RUN ON A PHONE): an "Open mic" switch in App.tsx
(off by default, not saved). On: `VoiceSession.setMode('open')` reconnects with body {mode: 'open', ptt: false} and the
mic ON for the whole connection; the server answers only sentences with "Betty" in them, then follow-ups for 8 s
without the name, a turn ends after 1 s of quiet, talking over her needs 3 words (voice/bot.py `open_mic_strategies`).
The big button becomes mute/unmute (robots, phone calls). The situation is sent every 15 s (no presses to carry it).
Costs: the helmet stays in CALL MODE all ride (music at call quality, its button sends call controls), Deepgram bills
every open minute (~R8 an hour). Push-to-talk is unchanged when the switch is off.

Known risks:
- `react-native-bluetooth-classic` (1.73.0-rc.17) is a legacy native module, "untested on New Architecture"
  (expo-doctor). If it fails on RN 0.88, replace it with a small local Expo module in Kotlin (`npx create-expo-module
  --local`): RFCOMM socket to UUID 00001101-0000-1000-8000-00805F9B34FB, write, read until ">". `ObdTransport` stays.
- If the bike has no fuel PID (012F), `obd: true` would switch off the km-based fuel range (TriggerEngine uses the
  estimate only when `s.obd` is false). Decide after the reader test which PIDs the bike gives (`ElmSession` logs
  "bike supports PIDs ..." on connect).
- The owner's reader is Bluetooth Classic: Android only. iPhone needs a BLE (react-native-ble-plx) or Wi-Fi (TCP to
  192.168.0.10:35000) transport behind the same `ObdTransport`.

## Setting up a Mac to build (one time)

The app uses native modules, so it runs as a DEVELOPMENT BUILD, not in Expo Go.

Android:
1. Install Android Studio (it brings the Android SDK and a Java runtime). In its SDK Manager install the latest
   platform and build tools.
2. In `~/.zshrc`: `export ANDROID_HOME=$HOME/Library/Android/sdk` and
   `export PATH=$PATH:$ANDROID_HOME/platform-tools`; open a new terminal.
3. On the phone: Developer options on, USB debugging on; connect by USB, accept the prompt (`adb devices` lists it).
4. `cd native && npm install && npm run android` builds, installs and starts it. After that, `npm start` serves the
   JavaScript and the app reloads on save.
5. A standalone APK to keep or share: `cd android && ./gradlew assembleRelease` after the first run (the APK is in
   `android/app/build/outputs/apk/release/`), or in the cloud with `npx eas-cli@latest build -p android --profile preview`
   (needs an Expo account and an `eas.json` with `"android": {"buildType": "apk"}`).

iPhone (free Apple ID):
1. Install Xcode from the App Store, open it once, then `sudo xcode-select -s /Applications/Xcode.app`.
2. `brew install cocoapods` (or `sudo gem install cocoapods`).
3. Xcode > Settings > Accounts: add the Apple ID (a free "Personal Team").
4. On the iPhone: Settings > Privacy & Security > Developer Mode on (restart), connect by cable, trust the Mac.
5. `cd native && npm run ios -- --device` builds and installs. First time: set the signing team for the app target in
   Xcode (`ios/Betty.xcworkspace`) if asked, and on the phone trust the developer under Settings > General > VPN &
   Device Management.
6. A free account's builds STOP OPENING AFTER 7 DAYS: run step 5 again (nothing on the phone is lost). At most 3 such
   apps at once. CarPlay, TestFlight and push need the paid Apple Developer Program ($99 a year); Bluetooth, background
   location/audio and local notifications work with the free account.

## Commands (run in `native/`)

```
npm install
npm run typecheck   # tsc over the app AND the shared ../src/core and ../src/config
npm run bundle      # builds the Android and iOS JavaScript bundles (catches Metro resolution errors), output deleted after
npm run android     # build + install the dev build on a connected Android phone (needs the Android setup)
npm run ios         # same for iPhone (needs Xcode); add -- --device for a real phone
npm start           # dev server for an installed dev build
npx expo install <pkg>   # ALWAYS this, not npm install, for Expo/RN packages (SDK-matched versions)
npx expo-doctor     # config and dependency check (the bluetooth-classic warning is known, see Known risks)
```

Before declaring a change done: `npm run typecheck` and `npm run bundle` here, and `npm run typecheck && npm test` in
the repo root (the shared core is tested there).

## Rules

- `ios/` and `android/` are GENERATED (Continuous Native Generation, gitignored). Never edit them; configure native
  behaviour in `app.json` and config plugins.
- Navigation: no Expo Router yet (one screen). When a second screen arrives, use Expo Router as `AGENTS.md` says.
- Expo changes every SDK: check the versioned docs for SDK 58 (`https://docs.expo.dev/versions/v58.0.0/`, add `.md`
  to a docs URL for plain text) before using an Expo API. See `AGENTS.md` (Expo's own notes).
- Same conventions as the web app: changelog + Help for anything the owner would notice (once the app has its own
  What's new / Help, they come from the same `src/changelog.ts` and `src/ui/help.ts` data), CLAUDE.md kept current.

## Voice lab: Betty Link (option C, 2026-10-25; BUILT, NOT YET RUN ON THE PHONE)

Owner, after the call-based voice kept breaking in new ways: "explore C on the side". Garage > Voice lab
(`src/app/lab.tsx`), separate from rides (refuses to run during one). Her conversation over ONE plain WebSocket to the
same voice server (`wss://voice.forme.africa/ws-client`, the app login), instead of Daily/WebRTC:
- `modules/betty-link` (Swift, iPhone only) owns ALL the phone's sound: `.playback` + A2DP (stereo, music mixes on)
  except while he holds the button: `.playAndRecord` + hands-free (helmet mic, waits up to 1.5 s for it), a separate
  capture engine taps the mic -> 16 kHz 16-bit mono binary frames; off again = engine dropped, back to `.playback`.
  Her voice: binary 24 kHz 16-bit frames (paced in real time by the server) on one player node, flushed on
  "bot-interrupted". Logs: mic on/off in N ms with the route, loudest level of the turn, "her first sound N ms after
  you let go".
- Server: `voice/betty_voice/link.py` (BettyLinkSerializer: binary = audio, JSON = RTVI messages) and bot.py's
  websocket branch (first text message = the start body), same pipeline as Daily. New client message `say` (also for
  option A): one of her own lines spoken IN the conversation (TTSSpeakFrame, added to her context).
- Checked from the Mac against a local server (scratch script): "say" -> 1.6 s of her voice; a spoken question ->
  heard, interrupted her, answer's first audio 2.4 s after release.
- Not in the lab yet: open mic, the phone tools (answer "not available"), ducking (music mixes at full level),
  background/lock screen, headset buttons (the lab is about the audio path first).
- FIRST PHONE TEST 2026-10-25 07:50 (phone speaker + built-in mic, NO HELMET): 10 turns, all heard, no overlaps;
  connect 285 ms; her first sound 1.3-1.6 s after release (5.5 s with two weather lookups); mic on ~0.55 s; a press
  cut her off cleanly. Fixed: no position (now asks for location, sends the suburb). NEXT: the same with the V6 and music.
- SECOND PHONE TEST 2026-10-25 08:53 (soundcore Space One Pro headphones, music on): his music stopped at the press and
  never came back, he was not understood ("It", then nothing, at -18/-21 dB), and he heard none of her answers (sent and
  "played"). Causes and fixes in BettyLinkModule.swift: (1) the stereo -> hands-free switch looks like "headphones
  gone" to music apps, which pause for good: now the session is off when idle, a press first takes the sound WITHOUT
  mixing (an interruption: music pauses as for Siri), and after her answer the session goes off with
  notifyOthersOnDeactivation (music resumes); her own lines while idle duck the music instead. (2) the mic engine was
  likely made mid-switch with the old rate (garble): it waits until the announced rate matches the hardware (3 tries)
  and converts from each buffer's own format; the log says what rate the mic audio really has. (3) the player kept
  "playing" into the hands-free output that was gone: a NEW engine for every stretch of her speech, only once the
  headset is back in stereo.

