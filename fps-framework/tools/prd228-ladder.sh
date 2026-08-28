#!/bin/bash
# PRD-228 Phase 0 — drive a ladder, cooling to a stated temperature before every arm so no
# rung is measured on the heat the previous rung left behind. Order is scrambled on purpose:
# thermal drift must not correlate with pixel count.
set -uo pipefail
GAME=/home/joao/projects/threenative/sandbox/fps-framework
SERIAL="${TN_SERIAL:-192.168.1.192:5555}"
COOL_TO="${TN_COOL_TO:-345}"   # deci-degrees C. The real gate is Thermal Status NONE, which preflight also enforces;
                               # this phone idles at ~34.3 dC screen-on, so a lower ceiling never clears.
cd "$GAME"

cool() {
  adb -s "$SERIAL" shell am force-stop com.threenative.bayview
  # Screen off while cooling. Screen-on at minimum brightness still adds more heat than this
  # phone sheds, so a ladder that never darkens the panel never reaches its next rung; the
  # preflight requires the screen back on, so it is woken before the arm starts.
  adb -s "$SERIAL" shell input keyevent KEYCODE_SLEEP
  for _ in $(seq 1 90); do
    t=$(adb -s "$SERIAL" shell dumpsys battery | grep -oP 'temperature: \K\d+')
    s=$(adb -s "$SERIAL" shell dumpsys thermalservice | grep -m1 -oP 'Thermal Status: \K\d+')
    if [ "$t" -le "$COOL_TO" ] && [ "$s" = "0" ]; then
      adb -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP
      adb -s "$SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1
      sleep 3
      echo "cooled: ${t}dC status $s"
      return 0
    fi
    sleep 20
  done
  adb -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP
  echo "cool-down timed out at ${t}dC status ${s}"; return 1
}

for spec in "$@"; do
  IFS=: read -r label scale aa maxfps uncapped panel <<<"$spec"
  echo "=== arm $label (scale $scale, aa $aa, maxFps $maxfps, uncapped $uncapped, ${panel}Hz) ==="
  cool || { echo "ARM $label SKIPPED: device would not cool"; continue; }
  tools/prd228-arm.sh "$label" "$scale" "$aa" "$maxfps" "$uncapped" "$panel" \
    2>&1 | tail -8 || echo "ARM $label FAILED"
done
echo "LADDER COMPLETE"
