#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Starting Cobalt API (10h duration limit)..."
docker compose up -d

echo "Waiting for API..."
for i in {1..30}; do
  if curl -sf -H "Accept: application/json" "http://127.0.0.1:9000/" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf -H "Accept: application/json" "http://127.0.0.1:9000/" >/dev/null; then
  echo "API did not become ready on http://localhost:9000" >&2
  exit 1
fi

echo "API is up (DURATION_LIMIT=$(docker exec cobalt printenv DURATION_LIMIT))"
echo "Starting web UI at http://127.0.0.1:5173 ..."
echo "UI talks to local API via /cobalt-api (10h duration limit)."
cd web
export WEB_DEFAULT_API="${WEB_DEFAULT_API:-/cobalt-api/}"
export WEB_LOCAL_HTTP=1
# Listen on all local interfaces so both localhost and 127.0.0.1 work
exec pnpm run dev --host 0.0.0.0 --port 5173 --strictPort
