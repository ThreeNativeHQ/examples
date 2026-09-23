#!/usr/bin/env bash
# Hands-off native benchmark: run a desktop artifact on a private Xvfb, click AIRBORNE START, fly
# for a fixed time, and summarise the runtime's own telemetry from the click onwards.
#
#   bash tools/capture-lock.sh bash tools/bench-native.sh <artifact> [seconds=120] [outdir]
#
# Must run inside tools/capture-lock.sh (it provides the throwaway display). xcompmgr is started
# because the UI overlay does not composite without one on Xvfb.
set -u
ART=$(realpath "${1:?artifact}")
SECS=${2:-120}
OUT=${3:-/tmp/bench-native-$(date +%s)}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
LOG=$OUT/raw.log

xcompmgr >/dev/null 2>&1 &
COMP=$!
"$ART" >"$LOG" 2>&1 &
GAME=$!
trap 'kill $GAME $COMP 2>/dev/null; sleep 1; kill -9 $GAME 2>/dev/null' EXIT

# The briefing publishes six interactive regions; AIRBORNE START is the last of them.
for _ in $(seq 1 120); do grep -q 'TN_UI_HIT_REGIONS:{"count":6' "$LOG" && break; sleep 1; done
grep -q 'TN_UI_HIT_REGIONS:{"count":6' "$LOG" || { echo "bench-native: briefing never published its regions"; exit 2; }
sleep 3
REGIONS=$(grep 'TN_UI_HIT_REGIONS:{"count":6' "$LOG" | tail -n 1 | grep -oE '"regions":\[[^]]*\]' | tr -d '"regions:[]')
WIN=$(xdotool search --sync --onlyvisible --name 'MIDWAY' | head -n 1)
eval "$(xdotool getwindowgeometry --shell "$WIN")"
read -r CX CY < <(echo "$REGIONS" | tr ',' '\n' | tail -n 4 | paste -sd' ' |
  awk -v x="$X" -v y="$Y" -v w="$WIDTH" -v h="$HEIGHT" '{printf "%d %d\n", x + ($1 + $3 / 2) * w, y + ($2 + $4 / 2) * h}')
START=$(wc -l <"$LOG")
xdotool mousemove "$CX" "$CY" sleep 0.3 click 1
for _ in $(seq 1 20); do grep -q 'TN_UI_HIT_REGIONS:{"count":5' <(tail -n +"$START" "$LOG") && break; sleep 0.5; done
grep -q 'TN_UI_HIT_REGIONS:{"count":5' <(tail -n +"$START" "$LOG") || { echo "bench-native: AIRBORNE START click did not start the flight"; exit 3; }
sleep "$SECS"
node "$HERE/bench-native-summary.mjs" "$LOG" "$START" | tee "$OUT/summary.txt"
