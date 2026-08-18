#!/usr/bin/env bash
# Patch the current native bundle into the debug APK, re-sign, install, run, screenshot.
# Gradle is bypassed on purpose: another build in the monorepo can otherwise swap the asset.
# Usage: ./android-play.sh <label> [seconds]
set -u
LABEL=${1:-play}
WAIT=${2:-12}
P=/home/joao/projects/threenative/sandbox/fox-native
A=/home/joao/projects/threenative/threenative-engine/packages/runtime-native/android
BT=$HOME/Android/Sdk/build-tools/35.0.0
ADB=$HOME/Android/Sdk/platform-tools/adb
S=${ANDROID_SERIAL:-emulator-5556}
W=$P/.threenative/apk
mkdir -p "$W"

python3 - "$A/app/build/outputs/apk/debug/app-debug.apk" "$P/.threenative/build/game.js" "$W/patched.apk" <<'PY'
import sys, zipfile
src, payload, out = sys.argv[1], sys.argv[2], sys.argv[3]
data = open(payload, 'rb').read()
target = 'assets/scripts/main.js'
zin = zipfile.ZipFile(src)
with zipfile.ZipFile(out, 'w') as zout:
    for item in zin.infolist():
        if item.filename.startswith('META-INF/') and item.filename.rsplit('.', 1)[-1] in ('RSA', 'SF', 'MF'):
            continue
        blob = data if item.filename == target else zin.read(item.filename)
        info = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        info.compress_type = item.compress_type
        info.external_attr = item.external_attr
        zout.writestr(info, blob)
PY

"$BT/zipalign" -f -p 4 "$W/patched.apk" "$W/aligned.apk"
"$BT/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android \
  --key-pass pass:android --out "$W/signed.apk" "$W/aligned.apk" 2>/dev/null
$ADB -s "$S" install -r "$W/signed.apk" >/dev/null 2>&1
$ADB -s "$S" logcat -c
$ADB -s "$S" shell am start -n com.mystral.engine/.MystralActivity >/dev/null 2>&1
sleep "$WAIT"
echo "alive=$($ADB -s "$S" shell pidof com.mystral.engine)"
$ADB -s "$S" exec-out screencap -p > "$P/artifacts/probe/$LABEL.png"
$ADB -s "$S" logcat -d | grep -E "TN_NATIVE_SMOKE|TN_NATIVE_START_FAILED|signal 6|ThreeNativeWGPU|TN_PROBE" | tail -5
