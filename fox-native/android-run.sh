#!/usr/bin/env bash
# Bundle the portable entry, patch it into an existing debug APK, re-sign, install, run, capture.
# Avoids gradle entirely so a concurrent build in the monorepo cannot swap the asset underneath.
# Usage: ./android-run.sh <label>
set -u
LABEL=${1:-run}
P=/home/joao/projects/threenative/sandbox/fox-native
A=/home/joao/projects/threenative/threenative-engine/packages/runtime-native/android
BT=$HOME/Android/Sdk/build-tools/35.0.0
ADB=$HOME/Android/Sdk/platform-tools/adb
S=${ANDROID_SERIAL:-emulator-5556}
W=$P/.threenative/apk

cd "$P" || exit 1
node node_modules/@threenative/runtime-native/scripts/bundle.mjs \
  --project . --entry src/game.ts --target android \
  --output .threenative/build/game.js >/dev/null 2>&1 || { echo "bundle failed"; exit 1; }

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
$ADB -s "$S" shell am start -n com.threenative.game/com.threenative.runtime.MystralActivity >/dev/null 2>&1
sleep 8
PID=$($ADB -s "$S" shell pidof com.threenative.game)
$ADB -s "$S" exec-out screencap -p > "$P/artifacts/probe/run-$LABEL.png"
echo "variant=$LABEL alive=${PID:-DEAD}"
$ADB -s "$S" logcat -d | grep -E "TN_NATIVE_SMOKE|TN_NATIVE_START_FAILED|signal 6|WebGPU\] Device error|\[error\]" | tail -6
