# Betty native (React Native + Expo)

The iPhone and Android app. Started 2026-10-18 (owner chose React Native + Expo over Swift/Kotlin and Capacitor).
Read the repo's `CLAUDE.md` first: behaviour rules, triggers and the owner's preferences apply here unchanged.

## How it fits with the web app

- Betty's brain is shared, not copied: the app imports `../src/core` and `../src/config` (and adapters that only use
  `fetch`, such as `../src/adapters/WeatherSource.ts`). `metro.config.js` adds `../src` to Metro's watch folders;
  `tsconfig.json` includes those folders so `npm run typecheck` here checks them too.
- Anything that touches the phone (GPS, speech, Bluetooth, storage, audio) is a NATIVE ADAPTER in `native/src/adapters/`,
  implementing the same interfaces as the web adapters (`DataSource`, `Speaker`, `ObdTransport`).
- `native/src/rig.ts` is the ride pipeline (the counterpart of `startRide` in `src/main.ts`): wiring only, no business
  logic. If something needs logic, put it in `src/core` with tests so the web app gets it too.
- Never import from `src/ui`, `src/main.ts` or a browser adapter here (they use `window`, `localStorage`, the DOM).
- The web app stays live at https://betty-zeta.vercel.app until the native app replaces it.
- The app calls Betty's server (`native/src/server.ts`) for Claude and, later, voices, traffic and transcription. It
  sends `x-betty-origin` because it has no page origin (`api/_shared.ts` `fromBetty`).

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
