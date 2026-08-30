#!/bin/bash
# PRD-228 Phase 0 — one ladder arm, built, installed, cold-launched and measured.
#
# Usage: tools/prd228-arm.sh <label> <scale> <antialias:true|false> <maxFps> <uncapped:0|1>
#
# Every arm records its own preflight, APK sha256, both thermal/battery ends, the full
# TN_FRAME_BUDGET window series and a SurfaceFlinger --timestats cross-check. An arm that
# cannot produce all of those exits non-zero rather than reporting a number.
set -euo pipefail

LABEL="$1"; SCALE="$2"; AA="$3"; MAXFPS="${4:-60}"; UNCAPPED="${5:-0}"; PANELHZ="${6:-60}"
GAME=/home/joao/projects/threenative/sandbox/fps-framework
ENGINE=/home/joao/projects/threenative/threenative-engine
PKG=com.threenative.bayview
SERIAL="${TN_SERIAL:-192.168.1.192:5555}"
OUT="$GAME/artifacts/prd228/$LABEL"
mkdir -p "$OUT"

export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export ANDROID_HOME=/home/joao/Android/Sdk
export ANDROID_SDK_ROOT=/home/joao/Android/Sdk
export PATH="$JAVA_HOME/bin:$PATH"
export THREENATIVE_RUNTIME_SOURCE="$ENGINE/packages/runtime-native"

cd "$GAME"

# The panel is pinned and then proved, never assumed. 120 is a slope arm; 60 is the gate.
adb -s "$SERIAL" shell settings put system peak_refresh_rate "$PANELHZ.0"
adb -s "$SERIAL" shell settings put system min_refresh_rate "$PANELHZ.0"

# --- 1. pin the arm's config, in git, before it is built -----------------------------
python3 - "$SCALE" "$AA" "$MAXFPS" <<'PY'
import re, sys
scale, aa, maxfps = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = open("threenative.config.ts").read()
cfg = re.sub(r"resolutionScale: [0-9.]+", f"resolutionScale: {scale}", cfg)
cfg = re.sub(r"maxFps: \d+", f"maxFps: {maxfps}", cfg)
open("threenative.config.ts", "w").write(cfg)
g = open("src/game.ts").read()
g = re.sub(r"antialias: (true|false)", f"antialias: {aa}", g)
open("src/game.ts", "w").write(g)
PY
grep -n "resolutionScale\|maxFps:" threenative.config.ts | tee "$OUT/config.txt"
grep -n "antialias" src/game.ts | tee -a "$OUT/config.txt"

# --- 2. build, and identify the exact binary ----------------------------------------
pnpm build:android >"$OUT/build.log" 2>&1 || { tail -20 "$OUT/build.log"; exit 1; }
APK="$GAME/dist-native/fps-framework.apk"
sha256sum "$APK" | tee "$OUT/apk.sha256"

# --- 3. install (Play Protect suppressed first, per the engine's guard) --------------
node -e "
  import('$ENGINE/packages/runtime-native/scripts/device-preflight.mjs').then((m) => {
    console.log(JSON.stringify(m.suppressPlayProtectOnAdbInstalls('$SERIAL')));
  }).catch((e) => { console.error(e.message); process.exit(1); });
"
adb -s "$SERIAL" install -r -d "$APK" >"$OUT/install.log" 2>&1 || { cat "$OUT/install.log"; exit 1; }
tail -2 "$OUT/install.log"

# --- 4. preflight: the machine is stated, not assumed --------------------------------
preflight() {
  node -e "
    import('$ENGINE/packages/runtime-native/scripts/device-preflight.mjs').then(async (m) => {
      const c = await m.assertDeviceReady('$SERIAL', {
        minBatteryPercent: 30, requireDischarging: true, maxThermalStatus: 'NONE',
        allowOverride: false, requireRefreshHz: $PANELHZ,
      });
      console.log(JSON.stringify(c));
    }).catch((e) => { console.error('PREFLIGHT_FAILED: ' + e.message); process.exit(1); });
  "
}
adb -s "$SERIAL" shell dumpsys battery | grep -E "level|temperature" | tee "$OUT/battery-before.txt"
preflight | tee "$OUT/preflight-before.json"

adb -s "$SERIAL" shell setprop debug.threenative.present_uncapped "$UNCAPPED"
echo "present_uncapped=$(adb -s "$SERIAL" shell getprop debug.threenative.present_uncapped)" | tee "$OUT/present-mode.txt"

# --- 5. one discarded launch per arm (per-install JIT warm-up) + the kept run.
#        Method rule 1's two whole-session discards are run once, before the ladder.
run_once() {
  local tag="$1" seconds="$2"
  adb -s "$SERIAL" shell am force-stop "$PKG"
  sleep 2
  local pid; pid="$(adb -s "$SERIAL" shell pidof "$PKG" || true)"
  [ -z "$(echo "$pid" | tr -d '[:space:]')" ] || { echo "cold launch failed: pid $pid still up"; exit 1; }
  adb -s "$SERIAL" logcat -c
  adb -s "$SERIAL" shell dumpsys SurfaceFlinger --timestats -clear -enable >/dev/null
  adb -s "$SERIAL" shell am start -W -n "$PKG/com.threenative.runtime.MystralActivity" >"$OUT/launch-$tag.txt"
  sleep "$seconds"
  adb -s "$SERIAL" logcat -d >"$OUT/logcat-$tag.txt"
  adb -s "$SERIAL" shell dumpsys SurfaceFlinger --timestats -dump >"$OUT/sf-$tag.txt"
}
run_once discard 35
run_once kept 220

preflight | tee "$OUT/preflight-after.json" || true
adb -s "$SERIAL" shell dumpsys battery | egrep -i "level|status|temperature|AC powered" | tee "$OUT/battery-after.txt"
adb -s "$SERIAL" shell dumpsys thermalservice | grep -m1 "Thermal Status" | tee -a "$OUT/battery-after.txt"
adb -s "$SERIAL" shell am force-stop "$PKG"

echo "ARM $LABEL complete -> $OUT"
