#!/usr/bin/env bash
#
# Execute the handoff.
#
# docs/MIDWAY-HANDOFF.md is the specification for this game's state, and the commands it names are
# the gates that decide whether that state holds. Reading them and retyping them by hand is how a
# gate quietly stops being run, so this extracts every fenced `sh` block from the document itself
# and runs it. The document is the source of truth: add a command there and it runs here.
#
# Two blocks are deliberately not gates and are skipped with the reason printed, never silently:
#   - the `claude --resume` line, which starts another agent rather than checking anything
#   - the `pnpm dev` line, which is a long-running server; it is started in the background instead
#
# Usage: bash tools/run-handoff.sh [--list]
set -uo pipefail

cd "$(dirname "$0")/.."
DOC="docs/MIDWAY-HANDOFF.md"
PORT="${MIDWAY_PORT:-5199}"
URL="http://127.0.0.1:${PORT}"

[ -f "$DOC" ] || { echo "handoff not found at $DOC"; exit 2; }

# Pull the fenced sh blocks out of the document, one command per line-continuation-joined entry.
mapfile -t COMMANDS < <(python3 - "$DOC" <<'PY'
import re, sys, pathlib
text = pathlib.Path(sys.argv[1]).read_text()
for block in re.findall(r"```sh\n(.*?)```", text, re.S):
    # Join backslash continuations so each command is one line.
    joined = re.sub(r"\\\n\s*", " ", block)
    for line in joined.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            print(line)
PY
)

skip_reason() {
  case "$1" in
    *"claude --resume"*) echo "starts another agent, not a gate" ;;
    *"pnpm dev"*)        echo "long-running server, started separately below" ;;
    *) echo "" ;;
  esac
}

if [ "${1:-}" = "--list" ]; then
  for c in "${COMMANDS[@]}"; do
    r="$(skip_reason "$c")"
    if [ -n "$r" ]; then printf 'SKIP  %s\n        (%s)\n' "$c" "$r"; else printf 'RUN   %s\n' "$c"; fi
  done
  exit 0
fi

# The browser gates need the game served. Reuse a running server; start one only if there is none.
STARTED_SERVER=""
if ! curl -fsS -o /dev/null "$URL/" 2>/dev/null; then
  echo "== starting dev server on ${PORT}"
  pnpm dev --host 127.0.0.1 --port "$PORT" --strictPort >/tmp/midway-handoff-vite.log 2>&1 &
  STARTED_SERVER=$!
  for _ in $(seq 1 40); do
    curl -fsS -o /dev/null "$URL/" 2>/dev/null && break
    sleep 1
  done
fi
curl -fsS -o /dev/null "$URL/" 2>/dev/null || { echo "no server on $URL"; exit 2; }
echo "== serving $URL"

cleanup() { [ -n "$STARTED_SERVER" ] && kill "$STARTED_SERVER" 2>/dev/null; }
trap cleanup EXIT

PASSED=0 FAILED=0 SKIPPED=0
FAILURES=()
for cmd in "${COMMANDS[@]}"; do
  reason="$(skip_reason "$cmd")"
  if [ -n "$reason" ]; then
    printf '\n== SKIP %s\n        %s\n' "$cmd" "$reason"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  printf '\n== RUN  %s\n' "$cmd"
  if MIDWAY_URL="$URL" bash -c "$cmd"; then
    printf '   PASS %s\n' "$cmd"
    PASSED=$((PASSED + 1))
  else
    printf '   FAIL %s\n' "$cmd"
    FAILED=$((FAILED + 1))
    FAILURES+=("$cmd")
  fi
done

printf '\n===== handoff executed: %d passed, %d failed, %d skipped =====\n' "$PASSED" "$FAILED" "$SKIPPED"
for f in "${FAILURES[@]:-}"; do [ -n "$f" ] && printf '  FAILED: %s\n' "$f"; done
exit $((FAILED > 0 ? 1 : 0))
