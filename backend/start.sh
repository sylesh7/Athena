#!/bin/bash
# backend/start.sh — production process supervisor for the Docker image.
#
# Athena's backend is 5 processes that talk to each other over localhost
# (broker.ts hardcodes http://localhost:$PROVIDER_PORT, monitor.py listens on
# http://localhost:8000/mcp) — see lib/config.ts and agents/broker.ts. That
# only resolves correctly when every process shares one network namespace, so
# they all run in this single container rather than as separate services.
# Only the entrypoint's port is meant to be reachable from outside.
set -e
cd "$(dirname "$0")"

pids=()

term_handler() {
  echo "[start.sh] caught signal, stopping child processes..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait
  exit 0
}
trap term_handler TERM INT

python3 mcp-monitor/monitor.py &
pids+=("$!")

npx tsx agents/provider1.ts &
pids+=("$!")

npx tsx agents/provider2.ts &
pids+=("$!")

npx tsx agents/provider3.ts &
pids+=("$!")

npx tsx stream/entrypoint.ts &
pids+=("$!")

# If any one process dies, the container is unhealthy — stop the rest and
# exit non-zero so the host's restart policy (see railway.json) restarts it.
wait -n "${pids[@]}"
exit_code=$?
echo "[start.sh] a process exited (code $exit_code) — stopping the rest."
for pid in "${pids[@]}"; do
  kill "$pid" 2>/dev/null || true
done
exit "$exit_code"
