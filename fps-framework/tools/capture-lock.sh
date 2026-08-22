#!/usr/bin/env bash
# Serialise headed WebGPU captures.
#
# CLAUDE.md tells you to look at the game, and on this machine that means a
# HEADED Chromium with `--enable-features=Vulkan` — headless serves WebGPU from
# SwiftShader and hands back a black canvas. The cost is that each capture holds
# a real GPU context rendering a ~380k-triangle scene at 60 fps, and several of
# those at once starves the compositor and makes the whole desktop stutter.
#
# So: one capture at a time, machine-wide. Wrap every capture command in this.
#
#   tools/capture-lock.sh node tour-tmp.mjs /tmp/shots
#   tools/capture-lock.sh npx @threenative/playtest --scenario ... --headed
#
# Waits for its turn rather than failing, so it is safe to call from several
# agents or shells at once. Set CAPTURE_LOCK_TIMEOUT to bound the wait.
# It also forces Chromium onto XWayland. Under a native Wayland session on this
# host, `chromium.launch({ headless: false })` spawns the process but never
# answers the CDP pipe, so Playwright sits until `Timeout 180000ms exceeded` and
# dies — and every failed launch strands about five processes. That is what a
# pile-up of "concurrent browsers" here usually is: hung launches, not captures.
# Unsetting WAYLAND_DISPLAY takes launch from a 120s+ timeout to ~175ms.
set -euo pipefail

lock="${CAPTURE_LOCK_FILE:-/tmp/threenative-capture.lock}"
timeout="${CAPTURE_LOCK_TIMEOUT:-900}"

if [ "$#" -eq 0 ]; then
  echo "usage: tools/capture-lock.sh <command> [args...]" >&2
  exit 64
fi

exec 9>"$lock"
if ! flock --wait "$timeout" 9; then
  echo "capture-lock: another capture held the display for ${timeout}s; giving up." >&2
  exit 75
fi

# Reap anything a previous timed-out launch stranded; we hold the lock, so no
# live capture can own these.
pkill -f playwright_chromiumdev_profile >/dev/null 2>&1 || true

exec env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 "$@"
