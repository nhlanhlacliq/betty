#!/usr/bin/env bash
# Build Betty's Android APK to send (WhatsApp/Drive). It installs OVER an earlier one and keeps her data, because it
# is signed with Betty's own key (native/credentials, git-ignored: keep a backup) and its versionCode goes up by one
# every build (app.json android.versionCode). Only needed when native code changed; JavaScript-only changes go out
# with scripts/publish-update.mjs instead.
#   native/scripts/build-apk.sh            # all phones (arm64 + 32-bit arm)
#   native/scripts/build-apk.sh --arm64    # 64-bit phones only (smaller, faster)
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Library/Android/sdk}
[ -f credentials/keystore.properties ] || { echo "No native/credentials/keystore.properties: restore Betty's key from your backup first."; exit 1; }
ABIS="arm64-v8a,armeabi-v7a"; [ "${1:-}" = "--arm64" ] && ABIS="arm64-v8a"

CODE=$(node -e 'const f="app.json",j=require("./"+f);j.expo.android.versionCode=(j.expo.android.versionCode||1)+1;require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\n");console.log(j.expo.android.versionCode)')
VERSION=$(node -p 'require("./app.json").expo.version')
echo "Building Betty $VERSION ($CODE)..."
CI=1 npx expo prebuild -p android --no-install >/dev/null
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures="$ABIS" --no-daemon -q)

APK=android/app/build/outputs/apk/release/app-release.apk
APKSIGNER=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
SIGNER=$("$APKSIGNER" verify --print-certs "$APK" | grep 'certificate DN' | head -1)
case "$SIGNER" in *"CN=Betty"*) ;; *) echo "WRONG KEY ($SIGNER): not sending this"; exit 1 ;; esac
RUNTIME=$(npx expo-updates runtimeversion:resolve --platform android 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).runtimeVersion))')
mkdir -p dist-apk
OUT="dist-apk/betty-$VERSION-$CODE.apk"
cp "$APK" "$OUT"
echo "$CODE $RUNTIME $(date -u +%FT%TZ)" >> dist-apk/builds.txt
echo "Built $OUT ($(du -h "$OUT" | cut -f1), runtime $RUNTIME). versionCode in app.json is now $CODE: commit it."
