#!/bin/sh
# Same as gate.sh, but serves the production build instead of the dev server.
#
# Every scenario in this project measures `pnpm dev`: unminified modules, HMR, and the
# @threenative/ui dev overlay polling every entity's debug() at 10 Hz. A 2026-08-22 DevTools
# trace put that overlay at 681 ms of self time and attributed 22.8% of every 33-100 ms hitch
# to the garbage collector it feeds. Frame budgets measured that way describe a configuration
# no player runs. Run `pnpm build` before this.
set -u

logs="${GATE_LOGS:-proof-artifacts/gates-prod}"
port="${GATE_PORT:-4310}"
mkdir -p "$logs"

status=0
for name in "$@"; do
  timeout 900 tools/capture-lock.sh npx threenative-playtest \
    --scenario "playtests/$name.playtest.json" \
    --url "http://127.0.0.1:$port" \
    --browser-recipe webgpu --headed \
    --server-command "npx vite preview --host 127.0.0.1 --port $port --strictPort" \
    >"$logs/$name.json" 2>&1
  code=$?
  echo "$name EXIT=$code"
  [ "$code" -eq 0 ] || status=1
done
exit "$status"
