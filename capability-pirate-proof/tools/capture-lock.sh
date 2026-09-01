#!/usr/bin/env bash
set -euo pipefail
lock_file="${TMPDIR:-/tmp}/threenative-capture.lock"
exec 9>"$lock_file"
flock 9
display_number=97
while [ -e "/tmp/.X${display_number}-lock" ]; do display_number=$((display_number + 1)); done
Xvfb ":${display_number}" -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
xvfb_pid=$!
cleanup() { kill "$xvfb_pid" 2>/dev/null || true; wait "$xvfb_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
export DISPLAY=":${display_number}"
export XDG_SESSION_TYPE=x11
"$@"
