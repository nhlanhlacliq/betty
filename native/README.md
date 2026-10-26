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

Android (set up on this Mac 2026-10-27, without Android Studio):
1. `brew install openjdk@17` and `brew install --cask android-commandlinetools`, then
   `yes | sdkmanager --sdk_root=$HOME/Library/Android/sdk --licenses` and
   `sdkmanager --sdk_root=$HOME/Library/Android/sdk "platform-tools" "platforms;android-36" "build-tools;36.0.0"`
   (Gradle fetches the NDK and anything else it needs on the first build).
2. Each terminal (or `~/.zshrc`): `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 PATH=$JAVA_HOME/bin:$PATH
   ANDROID_HOME=$HOME/Library/Android/sdk`.
3. A standalone APK to send (WhatsApp/Drive; the phone allows "install unknown apps"): `CI=1 npx expo prebuild -p
   android --no-install`, then `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`
   (~18 min the first time, ~4 min after). APK: `android/app/build/outputs/apk/release/app-release.apk` (~25 MB, 64-bit
   ARM phones only; drop the flag for all ABIs). It is signed with the DEBUG key (fine for sideloading, not the Play
   Store) and carries `native/.env` (voice-server login), so only send it to people you trust with that token.
   `android/` is generated and git-ignored: change app.json or a plugin, never the folder.
4. `plugins/withLibraryBuildConfig.js` (in app.json): AGP 9 no longer makes BuildConfig for libraries and
   react-native-bluetooth-classic needs it; the first build failed without it.
5. On a phone by USB: Developer options and USB debugging on, `adb devices`, then `npm run android` (development build;
   `npm start` serves the JavaScript).
6. Android has no Betty Link (iPhone-only module): rides there use the Daily-call voice.

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
- THIRD PHONE TEST 2026-10-25 09:03 (soundcore, music): WORKING: every turn heard and answered, her first sound
  2.1-2.6 s after release, music paused at the press and handed back after every answer, mic rate matched (16 kHz).
  Left: first words cut off while the headset switches (~1.5 s from stereo, ~0.7 s when pressed again soon):
  a "speak now" beep in the headset once the mic is live, and the button shows "Wait for the beep" (amber) until
  then. Server: get_weather tries the town part of "Suburb, Town", takes "here" (and his own suburb) as his position.
- FOURTH TEST 2026-10-25 09:16: no beep heard (played at the instant the headset's hands-free sound was still
  starting: now 0.35 s after the mic is live, 0.2 s, louder, logged "beep: speak now"); music came back loud with no
  fade (now: at release the session goes off so the music resumes, then on with duckOthers, so it plays DUCKED under
  her answer and iPhone fades it back up when she is done); her voice low against mastered music (the voice server
  ignored CONFIG.voiceBoostDb: the module now applies it on the phone, default +6 dB, soft limiter).
- 2026-10-25 later: "dip" at +10 dB still not loud enough over his music, and iOS fixes how far a duck dips (apps
  cannot set it). So `CONFIG.musicWhileSpeaking` (Garage > Voice & audio > Your music while she talks): pause (no
  mixing until she is done; back at full volume), dip (default), keep (mixWithOthers). Beep -> a soft two-note chime
  (G5, C6, bell decay, ~-20 dB) 0.25 s after the mic is live (he heard the beep, "slow and loud").
- V6 TEST 2026-10-25 09:37 (owner's notes by voice, in the log): the V6 mic is clearly better (peaks -1 to -11 dB,
  long multi-part questions heard whole). Fixed after: the chime came ~0.5 s after the mic was live (he counted:
  words before it were heard): now 0.05 s after the mic engine starts (a chime AT the press is not possible: the
  helmet mic takes 0.9-1.7 s to come on; the music pausing is the "pressed" cue); a softer five-note chime (C6 D6 E6
  G6 C7, marimba-like, ~-25 dB); the music came back mid-answer during a lookup: it now waits while she is thinking
  (bot-llm-started/stopped) or a tool runs (llm-function-call-started/stopped), and the no-answer fallback waits up
  to 30 s while she works. Prompt: what she runs on (she said "the phone's own speech system").
- V6 TEST 2026-10-25 10:01: chime too loud (now -8 dB); still feels late: the switch to hands-free is 0.8 s when pressed
  soon after a turn and 1.4-1.7 s after music (the earlier counting test lost "one two" there). Now: the session is put
  straight back on (mixing, music untouched) after each hand-back so a press starts from a live session, and the
  "mic on" log line gives each step's time (music paused, hands-free, helmet mic, mic engine) to find the rest.
  Server: "Let me check." only when she starts a lookup in silence (she often announces it herself: it doubled up).
- COUNTING TEST 2026-10-25 10:19 (V6): with music playing a press took 1.65-1.8 s (music pause ~850 ms: iPhone waits for
  the music app; hands-free ~420; mic engine ~420) and "one" (sometimes "two") was lost, as he starts at the music
  going quiet; pressed right after her answer: 0.9-1.0 s, every word heard (hands-free ~770 ms: the Bluetooth link,
  the floor). Now one step: straight to hands-free without mixing (pauses the music in the same activation).
  UNVERIFIED: the music app still resumes afterwards (if not, back to two steps and look for another way).
- 2026-10-25 10:26 (V6): one step works, the music still comes back (hands-free + pause ~1.2 s, then the mic engine
  ~0.43 s; total ~1.65 s with music on, ~0.9 s without). He said "one" at the chime and it was heard, so the chime
  was late by about its own length: it now plays (its own AVAudioPlayer) as soon as the headset is hands-free, while
  the mic engine starts, so it ends about when the mic opens. Log: "chime: speak now".

## Rides on Betty Link (2026-10-25, owner: "go ahead"; BUILT, NOT YET ON A RIDE)

`CONFIG.voiceLink` (default ON; Garage > Talking to Betty > Betty Link; next ride). rig.ts makes a `LinkSession`
(native/src/voice/LinkSession.ts, same surface as VoiceSession, so the ride screen, lock cover and headset code are
unchanged) and a `LinkSpeaker` as the ride's speaker: her OWN lines go to the server as `say` (TTSSpeakFrame, in her
context) and play in the same stream as her answers: one voice. onDone when the module reports "quiet" (or a
deadline); a line with no audio within 4 s, or with no connection, goes to the backup (ChirpSpeaker -> phone voice).
`stop` (server: InterruptionWorkerFrame) cuts her line when the queue does (alert first, quiet, his press). The hold
on her own lines while she answers now runs from bot-llm-started to the module's "quiet" (bot-started-speaking would
also fire for her own lines). Betty Link stays up through the sign-off (it is her voice), then closes. With Betty Link:
open mic and headset buttons are refused with a toast (they need the call); expo-audio (AudioFocus) is not touched.
Checked from the Mac against a local server: say -> her voice; stop -> 0.0 s more audio; a second say plays; "what did
you just tell me about?" -> she knew (prompt now says to stand by her own lines: she called a test line unconfirmed).
NOT YET: open mic on the link, the handlebar button, the locked screen (needs a ride), Android.
- FIRST RIDE ON BETTY LINK 2026-10-25 11:09 (V6, music, pocket): music dips and comes back, her voice clear, one voice.
  But the music came up BETWEEN her sentences: a streamed answer is two lines (first sentence early, then the rest)
  and LinkSpeaker only finished a line on "quiet", i.e. after the music was handed back. Now the module sends
  "drained" when her audio is all played (LinkSpeaker finishes, the queue sends the next line at once) and hands the
  music back only after 2 s of real silence (was 0.8 s for her own lines).
- SECOND RIDE 2026-10-25 11:22: hold-to-talk on a ride worked (chime, whole questions, her first sound 2.2-2.4 s).
  Bug from the "drained" change: "speaking" was only reported once per stretch, so her second line in a row never
  "started", LinkSpeaker gave up after 4 s, cut it and the phone's Chirp took over (fighting the module for the sound),
  and the lines behind it were still queued at END RIDE ("cleared"). Now "drained" also resets it, so each line reports
  "speaking".
- LISTEN-ONLY RIDE 2026-10-25 11:42 (24 min, 6 km, pocket, V6, music): owner "worked really well": every line spoken,
  music dipped and back. The link dropped at 11:59 on patchy signal ("Socket is not connected") and never came back
  (the backup Chirp carried on). LinkSession now reconnects after a drop: 2, 5, 10, 20, then every 30 s until END RIDE.

## Three ways to talk on Betty Link (2026-10-25, owner: "one at a time, or none"; BUILT, NOT YET ON A RIDE)

`CONFIG.talkMode` 'hold' | 'open' | 'buttons' (saved; `TalkChoice` on Home's ride sheet and in the ride menu; works
mid-ride; replaces the openMic/headsetButtons switches in the native app). Betty.tsx `applyTalk` puts it into effect on
either connection (the old call keeps its own open mic and silent-playlist buttons).
- OPEN MIC: LinkSession reconnects in the server's open mode (wake word "Betty", 8 s follow-ups without it; checked
  live: a sentence without "Betty" got no answer, "Betty, what is the capital of France?" got one) and calls
  `openMic(true)`: the module pauses his music, goes hands-free, hands the music back (it resumes at call quality),
  then runs ONE engine for his mic and her voice with the phone's echo cancelling (voice processing; its own ducking of
  other audio set to the minimum) so she does not hear or wake herself. The app's mic button mutes (nothing sent).
  The situation is sent every 15 s. "Betty" in a transcript stops her own line at once.
- HEADSET BUTTONS: `buttons(true)`: MPRemoteCommandCenter play/pause/next/previous + Now Playing "Betty", and
  near-silence looping on its own engine with the session NOT mixing (his music off while she holds them); after her
  lines and his turns it holds again. Play/pause = talk (his turn ends on his words or 10 s), next = repeat her line,
  previous = let go (back to hold to talk, music back). UNVERIFIED: that iPhone keeps Betty as Now Playing across
  the hands-free switches.


## Her voice at speed (2026-10-25, after the Pretoria ride; BUILT, NOT YET ON A RIDE)

Owner: "struggling to hear her at higher speeds even though it was on 16 dB ... not too loud at lower speeds". Measured
on her live audio: Chirp arrives quiet (speech ~-26 dBFS, peaks -10) and dark (~5% of its energy at 1-4 kHz). The
boost WAS working: +16 dB = speech ~-11 dBFS with peaks at full scale, so more plain gain cannot help. Now
`VoiceChain` (BettyLinkModule.swift) runs her voice through high-pass 120 Hz -> presence shelf 1.8 kHz (0 to +6 dB) ->
compressor above -24 dBFS (ratio 1 to 3) -> gain -> peak limiter (-1 dBFS). `core/Loudness` `SpeedVoice` turns GPS
speed (via rig.ts `link.speed`) into the gain (`voiceBoostDb` + `voiceAtSpeedDb` x share, share 0 at 40 km/h to 1 at
120; up at once, down 6 km/h a second) and the share (presence and ratio, `setSpeedVoice`); above share 0.6 (~90 km/h)
her lines PAUSE his music instead of dipping it (`pauseMusicAtSpeed`, back to dip below ~75). Garage > Voice & audio:
Louder at speed (default +8), Pause your music at speed (default on). Simulated on her audio: town unchanged; at 120
km/h with +16, speech ~-9 dBFS and +3 dB in 1-4 kHz. Beyond that it is the phone and helmet volume.
Same day, from the log: `wornDevices` (ClaudeClient: a rating out of ten, her humour setting, coffee, used in her last
4 lines -> left out of the next, not for answers), `new_road` once per stretch of new road (re-armed on known roads),
GPS altitude jumps over 60 m ignored (RideStats), a talk press within 2.5 s after his sentence ended the turn ignored.
Seen, not fixed: "playback ready (was stopped)" (her play engine restarting mid-line, 15 times); she still narrates
lookups ("I need the weather for Pretoria, so I'll check it now"); answers pull in kept notes unasked ("you are on a
detour, as you told me": a note from an earlier ride).

### Rides of 2026-10-26: settings instead of fixes in the code

Owner: from now on fixes are settings or editable lists, not code tuned to one ride. All in `src/config/betty.ts`:
- `voiceAtSpeed` {fromKmh 40, fullKmh 120, pauseOnKmh 90, pauseOffKmh 75, fallKmhPerS 6}: the speeds `core/Loudness`
  SpeedVoice follows (Garage subtitles read them). Neither ride logged the music pause at 140 km/h although the logic
  works in tests: `LinkSession.speed` now logs the pause/dip BEFORE touching the module, catches and logs one failure
  ("her loudness at speed failed (...)"), and logs once at connect how it is set. NEXT RIDE: read those lines.
- `onPhoneSpeaker` 'alerts' (default) | 'talk': from 14:45 on 2026-10-26 every line played on the phone speaker.
  `LinkSession.onPhoneSpeaker()` reads the route (built-in Speaker/Receiver, no Bluetooth) and logs each change;
  RideSession leaves her P3 remarks out while `voice.away()` (log: "dropped: her sound is on the phone speaker").
- `timeChecksWhileStopped` false: time checks count riding minutes (`RideStats.movingMin`) and wait while still.
- `briefingFirst` true: P2 warnings raised before the briefing has played wait for it (at most `briefingHoldMaxMs`);
  those in `lineRules.briefingCovers` (fuel, rain, sunset) are left out once it was spoken.
- `noRidingAdvice` true + `lineRules.advice` {ownLines, alerts}: matching sentences are left out (own remarks: lean
  further, ease off, on this bend...; alerts: directions only). Answers untouched.
- `lineRules.worn` (+ "Shall we...?" endings, now also in answers: `wornInAnswers`), `lineRules.meta` (moved out of
  ClaudeClient's META regex, + "has been given"), `lineRules.storyKinds`/`storyRecall`: area stories and local facts
  see each other's earlier lines ("never a fact they gave"). `lineRules` is not persisted: the code's list wins.
The four switches are in Garage (personality card; Voice & audio for the helmet) and persisted.
Not fixed yet: "playback ready (was stopped)" restarts (4 a ride) and clips that played with no logged line.

### Landmarks you pass (BUILT 2026-10-26, NOT YET ON A RIDE; needs the web deploy for api/landmarks)

Owner rode past the Hartebeesthoek satellite dishes and she said nothing (Wikipedia geosearch picks the richest article
within 6 km, only when a tour-guide slot comes up). Now: `api/landmarks?tile=&size=` = Wikidata SPARQL (box; types,
English description, enwiki) + Overpass (named telescopes, monuments, viewpoints, passes...; three mirrors, fail-soft:
all four public servers were full on 2026-10-26), raw rows trimmed, a week at the edge (a day when one source failed).
`core/Landmarks` (pure, tested): parseWikidata/parseOverpass/mergeLandmarks, `interest` (CONFIG.landmarks.kinds
weights on the TYPE words, `skip` for schools, lodges, clinics...), `passingNow` (within hereKm 1.5, not behind him:
aheadDeg 110, not told within retellDays 30), `sameSite` (clusterKm 0.6: HartRAO's observatory, 26 m telescope and
MeerKAT dish are one line), `landmarkContext`. `adapters/LandmarkSource`: tiles near him (0.1 deg) from
`betty.landmarks.v1` or the server one at a time, the best one within researchKm 6 researched once via api/story
`kind: 'landmark'` (`betty.lmnotes.v1`); told times in `betty.lmtold.v1`. maxPerHour 4 (city centres); `never` list (taxa: Homo naledi has coordinates) always wins; only the TYPE and description are scored, never the name ("Pass Office"). Also checked live: Cradle of Humankind tile (Sterkfontein, Swartkrans, Kromdraai, Wonder Cave) and Johannesburg south (Apartheid Museum, James Hall, memorials). Trigger `landmark` (P3, unprompted): fires
the moment he passes, at least minGapMs 45 s after her last own remark, moving >= 15 km/h, not quiet/parked. Checked
live against Wikidata: the Hartebeesthoek tile scores the observatory, telescope, MeerKAT dish and Damhoekpas 3, the
biosphere reserve 2, schools/lodge/clinic 0. Switch: Garage > Betty's personality > Landmarks you pass (`landmarksOn`).
Not yet: landmarks in Explore; the web Garage switch (on by default there too).

### Good places to stop (BUILT 2026-10-26, NOT YET ON A RIDE)

Owner: coffee shops, restaurants "with genuine interest and value", without Google Places (Enterprise with ratings is
$35/1,000 after 1,000 free a month, re-billed every ride, and its terms forbid keeping results past 30 days).
api/story `kind: 'stops'` (stopsPrompt/parseStops): a model that searches the web picks up to 6 by reputation. The
provider is swappable on the server (`RESEARCH_PROVIDER`, default claude; `RESEARCH_MODEL` overrides Haiku): checked
live for Cullinan, Claude Haiku made 3 real searches (Tripadvisor ratings in its reasons, ~3.6 US cents); Gemini
3.5-flash-lite / 3.8-flash with google_search returned NO search queries (answers from memory, invented-looking
addresses); Groq compound models were not on the key. `core/Stops` (stopsArea = suburb else town, stopsNote),
`StopStore` (`betty.stops.v1`, AreaSource.ts; an area with none found is kept empty), looked up only when useful:
stopped `stops.researchAfterSec` 45 s (RideSession, once per area a ride) and for route stops (researchAhead).
Trigger `good_stop` (P3): stopped `sayAfterSec` 120 s in an area with stops, once per area a ride, fits the part of
day. Answers (web) and the voice server's situation (native, `voiceSituation`) carry the list: no server change.
Switch: Garage > Betty's personality > Good places to stop (`stopsOn`).

### Log of 2026-10-26 23:07 (desk test, phone speaker)
- Mic refused twice with `!pri` (AVAudioSession insufficientPriority: a call, Siri or another app held the audio), yet
  the module logged "mic on" and the server waited 10 s on silence. Now `startMic` returns why it failed, retries once
  after 0.4 s on `!pri`, resets the phase; `mic()` resolves "mic failed: busy|<reason>"; LinkSession ends the turn and
  `setup.onMicFailed` makes the phone say `CONFIG.phoneLines.micBusy` / `micFailed`. NEEDS A REBUILD (Swift).
- An answer spoke her planning ("I can avoid the time word... Keep it under 40 words, three sentences, no markdown"):
  the sentence filter had only taken out the matched part. Now `lineRules.metaRetry`: an answer/alert with
  `metaRetryFrom` (2) or more planning sentences is asked again once ("ONLY the words you say to him"), tools kept;
  new `lineRules.meta` patterns are about her RULES only, so a plan he asks for is untouched (tested).

### Quiet during calls (BUILT 2026-10-26, NOT YET ON A RIDE; needs a rebuild, the module links CallKit now)
A call held the mic and her press went nowhere. BettyLinkModule: `CXCallObserver` + `CallWatch` delegate ->
`onCall {active}` event and `inCall()`; `startMic` refuses at once during a call ("call"). LinkSession forwards
`onCall`; rig: `ride.phoneCall(on)` (and once at ride start if a call is already on). RideSession.phoneCall
(`CONFIG.quietOnCall`, default on, Garage > Voice & audio): cuts her current line (never a P1), drops queued P3,
holds the queue until the call ends (one hold with the voice server's conversation: `applyHold`), P3 made during the
call logged "(dropped: you were on a call)". A press during a call only logs (anything said would play into the call).

### Engine data over Bluetooth LE (BUILT 2026-10-27, NOT YET ON A RIDE; needs a rebuild: new native library)
Owner's Vgate iCar Pro BLE read the G 310 GS in Car Scanner: PIDs 01-20 plus 21 30 31 33 42 43 44 45 4D 4E, no fuel
level (2F). Biketune (same reader) shows the real odometer 29,859 km and the model K02: read with BMW's own requests
(mode 22 ids), not standard PIDs; PID 31 (29,295 km) is only "since codes cleared". Built:
- `react-native-ble-plx` 3.5.1 (installed with --legacy-peer-deps: the Daily config plugin's peers; app.json plugin
  with background central + NSBluetoothAlwaysUsageDescription, also put in ios/Betty/Info.plist directly; no prebuild
  --clean). Release simulator build OK (a Debug simulator build failed to link RNSVG/dev-launcher: the prebuilt RN
  core flavour, unrelated). `adapters/BleObdTransport`: scan (names CONFIG.obd.readerNames, else every named device),
  connect, the serial line found by what the characteristics can do (logged), 20-byte writes, answers up to ">".
- Reader choice saved (`CONFIG.obdReader`, "classic:<address>" for an Android Classic reader), picked in Home > How
  are we riding? > Engine data (both phones). Betty.tsx connects it at ride start (a toast if it fails).
- core/Elm327: 16 PIDs, `readStatus` (0101: warning light, code count), `isReadOnly`/`readOnly` (ONLY AT, 01, 03, 07,
  09, 22: never 04 clear codes or any write; a safety rule in code, not a setting), a schedule from
  `CONFIG.obd.read` (rpm/speed 0.5 s, coolant 5 s, slow ones 15-60 s), discovery of 01-60. ObdSource polls every
  250 ms, logs an engine snapshot every `logEveryMs` (5 min), stops when the reader is lost.
- `BikeState.fuelKnown` + `engine` (EngineReadings): fuel range by distance stays on with a reader that gives no fuel
  level (it used to switch off with `obd`). core/Engine: `engineNote` (answers, briefing, voice situation),
  `ChargeWatch` -> `charging_low` P2 (under 12.8 V at 2,500 rpm+ for 60 s, 60 s after a start ignored), sign-off with
  the coolant peak and lowest running voltage, `GearLearner` (ratio peaks, named only when all `obd.gears` are learned,
  `betty.gears.v1`). His 12.4 V at 1,600 rpm 28 s after a start: under the rules that is "settling", then judged.
NEXT: try mode 22 reads (odometer, service) in a Workshop probe; fuel model calibrated by fill-ups (stage 3).
