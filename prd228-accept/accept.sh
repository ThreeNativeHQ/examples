#!/bin/bash
# PRD-228 Phase 4 acceptance: three captures of a scaffolded template, unplugged, cool, 60 Hz.
set -uo pipefail
A=/home/joao/projects/threenative/sandbox/prd228-accept
ENGINE=/home/joao/projects/threenative/threenative-engine
SERIAL="${TN_SERIAL:-192.168.1.192:5555}"
PKG=com.threenative.prd228accept
cd "$A"

cool() {
  adb -s "$SERIAL" shell am force-stop "$PKG"
  adb -s "$SERIAL" shell input keyevent KEYCODE_SLEEP
  for _ in $(seq 1 90); do
    s=$(adb -s "$SERIAL" shell dumpsys thermalservice | grep -m1 -oP 'Thermal Status: \K\d+')
    t=$(adb -s "$SERIAL" shell dumpsys battery | grep -oP 'temperature: \K\d+')
    if [ "$s" = "0" ]; then
      adb -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP
      adb -s "$SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1
      sleep 3
      echo "cooled to status $s at ${t}dC"
      return 0
    fi
    sleep 20
  done
  adb -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP
  echo "did not reach thermal NONE (status $s, ${t}dC)"
  return 1
}

for capture in 1 2 3; do
  OUT="$A/artifacts/accept-$capture"; mkdir -p "$OUT"
  echo "=== capture $capture ==="
  cool || { echo "CAPTURE $capture SKIPPED: would not cool"; continue; }
  sha256sum "$A/dist-native/prd228-accept.apk" > "$OUT/apk.sha256"
  node -e "
    import('$ENGINE/packages/runtime-native/scripts/device-preflight.mjs').then(async (m) => {
      const c = await m.assertDeviceReady('$SERIAL', {
        minBatteryPercent: 30, requireDischarging: true, maxThermalStatus: 'NONE',
        allowOverride: false, requireRefreshHz: 60,
      });
      console.log(JSON.stringify(c));
    }).catch((e) => { console.error('PREFLIGHT_FAILED: ' + e.message); process.exit(1); });
  " | tee "$OUT/preflight-before.json"
  grep -q PREFLIGHT_FAILED "$OUT/preflight-before.json" && { echo "CAPTURE $capture SKIPPED: preflight"; continue; }
  adb -s "$SERIAL" shell am force-stop "$PKG"; sleep 2
  pid="$(adb -s "$SERIAL" shell pidof "$PKG" || true)"
  [ -z "$(echo "$pid" | tr -d '[:space:]')" ] || { echo "CAPTURE $capture SKIPPED: cold launch failed"; continue; }
  adb -s "$SERIAL" logcat -c
  adb -s "$SERIAL" shell dumpsys SurfaceFlinger --timestats -clear -enable >/dev/null
  adb -s "$SERIAL" shell am start -W -n "$PKG/com.threenative.runtime.MystralActivity" > "$OUT/launch.txt"
  sleep 200
  adb -s "$SERIAL" logcat -d > "$OUT/logcat-kept.txt"
  adb -s "$SERIAL" shell dumpsys SurfaceFlinger --timestats -dump > "$OUT/sf-kept.txt"
  adb -s "$SERIAL" shell dumpsys battery | grep -E "level|temperature" > "$OUT/battery-after.txt"
  adb -s "$SERIAL" shell dumpsys thermalservice | grep -m1 "Thermal Status" >> "$OUT/battery-after.txt"
  adb -s "$SERIAL" shell am force-stop "$PKG"
  echo "capture $capture complete"
done
echo "ACCEPTANCE COMPLETE"
