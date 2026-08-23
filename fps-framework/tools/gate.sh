#!/bin/sh
# Run one or more scenarios against a freshly-managed dev server and report each exit code.
#
# The runner brings its own server up on a strict port and tears it down again, so a scenario
# can never silently attach to a stale one left behind by an earlier run — which happened, and
# cost a full debugging cycle chasing "fixed" code that was never actually served.
#
# Logs land in $GATE_LOGS (default ./proof-artifacts/gates) so a failing assertion can be read
# back without re-running the capture.
set -u

logs="${GATE_LOGS:-proof-artifacts/gates}"
port="${GATE_PORT:-4192}"
mkdir -p "$logs"

status=0
for name in "$@"; do
  timeout 900 tools/capture-lock.sh npx threenative-playtest \
    --scenario "playtests/$name.playtest.json" \
    --url "http://127.0.0.1:$port" \
    --browser-recipe webgpu --headed \
    --server-command "pnpm dev --host 127.0.0.1 --port $port --strictPort" \
    >"$logs/$name.json" 2>&1
  code=$?
  echo "$name EXIT=$code"
  [ "$code" -eq 0 ] || status=1
done
exit "$status"
