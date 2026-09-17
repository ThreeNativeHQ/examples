#!/usr/bin/env bash
# Play the native desktop build on a KDE Wayland host.
#
# Why this exists: the native runtime's UI overlay (briefing, loading screen, HUD — a WebKit
# view the runtime composites over the 3D window) reports TN_UI_OVERLAY:{"attached":true} on
# this desktop and then never appears. Its GTK window stays at the 200x200 GTK default and is
# never mapped. The same binary, on a plain X display with COMPOSITE+SHAPE and xcompmgr,
# composites the whole UI correctly — so this is the runtime's overlay against kwin/XWayland,
# not the game. Until the engine fixes that, run the game on a nested X server that has a
# compositing manager the runtime can drive.
#
#   bash tools/run-native.sh                 # nested window, playable
#   NATIVE_SIZE=1600x900 bash tools/run-native.sh
#
# Needs: xorg-server-xephyr and xcompmgr (Arch: sudo pacman -S xorg-server-xephyr xcompmgr).
set -euo pipefail

exe="${NATIVE_EXE:-dist-native/midway-open-pacific}"
size="${NATIVE_SIZE:-1280x720}"
[ -x "$exe" ] || { echo "no native build at $exe — run 'pnpm build:desktop' first" >&2; exit 1; }

# The parity lane built xcompmgr into /tmp when the package was absent; prefer a real install.
command -v xcompmgr >/dev/null || for p in /tmp/xcompmgr-proof.*/prefix/bin; do
  [ -x "$p/xcompmgr" ] && PATH="$p:$PATH" && export PATH && break
done
for need in Xephyr xcompmgr; do
  command -v "$need" >/dev/null || {
    echo "$need is missing: sudo pacman -S xorg-server-xephyr xcompmgr" >&2; exit 1; }
done

df="$(mktemp)"
Xephyr -displayfd 3 +extension COMPOSITE +extension SHAPE -screen "$size" -resizeable \
  -title "MIDWAY — native" 3>"$df" >/dev/null 2>&1 &
xephyr=$!
cleanup() { kill "${game:-}" "${comp:-}" "$xephyr" 2>/dev/null || true; rm -f "$df"; }
trap cleanup EXIT INT TERM

display=""
for _ in $(seq 1 100); do display="$(tr -d '[:space:]' <"$df")"; [ -n "$display" ] && break; sleep 0.1; done
[ -n "$display" ] || { echo "Xephyr never reported a display" >&2; exit 1; }
export DISPLAY=":$display"

# Without a compositing manager the runtime refuses to attach the overlay at all, and says so.
xcompmgr -n >/dev/null 2>&1 &
comp=$!
sleep 0.5

"$exe" --windowed --width "${size%x*}" --height "${size#*x}" "$@" &
game=$!
wait "$game"
