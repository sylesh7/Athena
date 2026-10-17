#!/bin/sh
# Container entrypoint. ATHENA_PROCESS picks what runs:
#   api | worker | keeper  -> that process alone
#   all                    -> worker (restarted if it exits) + API in one container, for hosts without a separate worker tier
set -e
P=${ATHENA_PROCESS:-api}
TSX=node_modules/.bin/tsx
export API_PORT=${PORT:-${API_PORT:-3100}}
# Render injects its public URL at runtime; use it for the API's own links unless they were set explicitly.
if [ -n "$RENDER_EXTERNAL_URL" ]; then
  export PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-$RENDER_EXTERNAL_URL}
  export SERVICE_URLS=${SERVICE_URLS:-$RENDER_EXTERNAL_URL/services/eurusd}
fi

if [ "$P" = all ]; then
  (while true; do "$TSX" src/worker.ts || true; echo "worker exited, restarting in 10s" >&2; sleep 10; done) &
  exec "$TSX" src/api.ts
fi
exec "$TSX" "src/$P.ts"
