#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Smoke test for POST /v1/events against the Mustang VIN (6F07C219593).
#
# NOT YET RUNNABLE — requires:
#   1. WS-A's `shop` source registered in observation_sources (P1-T3).
#   2. WS-D's api_keys migration ported + check_api_key_rate_limit RPC live.
#   3. `supabase functions deploy api-v1-events --no-verify-jwt` executed
#      by Skylar (auto mode rule 5: prod modifications require confirmation).
#   4. An issued API key with scope `events:write:vehicle:6F07C219593` or
#      `events:write:all` exported as $NUKE_API_KEY.
#
# Once those are in place:
#   chmod +x scripts/test-v1-events-mustang.sh
#   NUKE_API_KEY=nk_live_... ./scripts/test-v1-events-mustang.sh
#
# To register in package.json once unblocked:
#   "test:v1-events": "bash scripts/test-v1-events-mustang.sh"
# ---------------------------------------------------------------------------

set -uo pipefail

# Hard-fail until Skylar deploys + greenlights.
if [[ "${RUN_V1_EVENTS_SMOKE:-0}" != "1" ]]; then
  echo "[guard] This script is intentionally gated. Set RUN_V1_EVENTS_SMOKE=1 to run."
  echo "        It assumes:"
  echo "          - api-v1-events is deployed"
  echo "          - shop source exists in observation_sources"
  echo "          - api_keys migration is applied"
  echo "          - NUKE_API_KEY env var is set with appropriate scope"
  exit 64
fi

if [[ -z "${NUKE_API_KEY:-}" ]]; then
  echo "[fatal] NUKE_API_KEY must be set." >&2
  exit 65
fi

VIN="6F07C219593"
HOST="${NUKE_HOST:-https://nuke.ag}"
ENDPOINT="${HOST}/v1/events"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build the success envelope (informed by the Mustang dogfood session).
SUCCESS_BODY=$(cat <<JSON
{
  "schema_version": "1.0",
  "event_type": "service",
  "vehicle_ref": { "vin": "${VIN}" },
  "occurred_at": "${NOW}",
  "submitted_at": "${NOW}",
  "agent": { "id": "smoke-test", "version": "ws-b-v1", "session_id": "smoke-$(date +%s)" },
  "payload": {
    "summary": "Engine refresh \u2014 peripherals pulled, sludge in valley",
    "narrative": "Pulled valve covers; heavy sludge in valve galley. Deferred engine pull to morning.",
    "work_performed": ["pulled valve covers", "photographed door tag", "read plugs"],
    "condition_observations": [
      { "system": "top_end", "finding": "sludge in valve galley", "severity": "concern" }
    ],
    "labor_minutes": 90
  },
  "agent_inferred": false
}
JSON
)

call() {
  local label="$1"; shift
  echo "==== ${label} ===="
  curl -sS -o /tmp/v1-events-resp.json -w "HTTP %{http_code}  (%{time_total}s)\n" "$@"
  echo "----"
  cat /tmp/v1-events-resp.json | (jq . 2>/dev/null || cat)
  echo
  echo
}

# 1. Success: valid scope + valid envelope.
call "1. SUCCESS — valid envelope, scoped key" \
  -X POST "${ENDPOINT}" \
  -H "X-API-Key: ${NUKE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "${SUCCESS_BODY}"

# 2. Invalid envelope — missing vehicle_ref.
call "2. INVALID ENVELOPE — missing vehicle_ref" \
  -X POST "${ENDPOINT}" \
  -H "X-API-Key: ${NUKE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"schema_version":"1.0","event_type":"service","occurred_at":"'"${NOW}"'","payload":{"summary":"x"}}'

# 3. Scope mismatch — try writing to a VIN the key isn't scoped to.
call "3. SCOPE MISMATCH — wrong VIN for key" \
  -X POST "${ENDPOINT}" \
  -H "X-API-Key: ${NUKE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"schema_version":"1.0","event_type":"service","vehicle_ref":{"vin":"NOTOURVIN12345678"},"occurred_at":"'"${NOW}"'","payload":{"summary":"should 403"}}'

# 4. Expired / invalid key.
call "4. EXPIRED / INVALID KEY" \
  -X POST "${ENDPOINT}" \
  -H "X-API-Key: nk_live_definitely_not_a_real_key_0000" \
  -H "Content-Type: application/json" \
  -d "${SUCCESS_BODY}"

# 5. VIN not found — well-formed VIN that isn't in NUKE.
call "5. VIN NOT FOUND — vehicle absent from NUKE" \
  -X POST "${ENDPOINT}" \
  -H "X-API-Key: ${NUKE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"schema_version":"1.0","event_type":"service","vehicle_ref":{"vin":"ZZZZZZ9999999"},"occurred_at":"'"${NOW}"'","payload":{"summary":"should 404"}}'

echo "Smoke test complete. Inspect status codes:"
echo "  Expected: 1=201, 2=400, 3=403, 4=401, 5=404"
