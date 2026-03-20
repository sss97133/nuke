#!/bin/bash
# Hourly smoke test — quick connectivity check for all integrations
# Usage: dotenvx run -- bash scripts/scheduled/smoke-test.sh

set -euo pipefail
cd /Users/skylar/nuke

SUPABASE_URL="${VITE_SUPABASE_URL}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
PASS=0
FAIL=0
RESULTS=""

check() {
  local name="$1"
  local cmd="$2"
  local start=$(date +%s%N)
  if eval "$cmd" >/dev/null 2>&1; then
    local end=$(date +%s%N)
    local ms=$(( (end - start) / 1000000 ))
    RESULTS="$RESULTS\n| $name | OK | ${ms}ms |"
    PASS=$((PASS + 1))
  else
    RESULTS="$RESULTS\n| $name | **FAIL** | - |"
    FAIL=$((FAIL + 1))
  fi
}

# Test endpoints
check "db-stats" "curl -sf '$SUPABASE_URL/functions/v1/db-stats' -H 'Authorization: Bearer $SERVICE_KEY'"
check "universal-search" "curl -sf '$SUPABASE_URL/functions/v1/universal-search?q=porsche' -H 'Authorization: Bearer $SERVICE_KEY'"
check "coordinator" "curl -sf -X POST '$SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator' -H 'Authorization: Bearer $SERVICE_KEY' -H 'Content-Type: application/json' -d '{\"action\": \"brief\"}'"
check "nuke.ag" "curl -sf 'https://nuke.ag'"
check "postgres" "PGPASSWORD='RbzKq32A0uhqvJMQ' psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c 'SELECT 1' -t"

TOTAL=$((PASS + FAIL))

echo "## Smoke Test — $TIMESTAMP"
echo ""
echo "| Service | Status | Latency |"
echo "|---------|--------|---------|"
echo -e "$RESULTS"
echo ""
echo "**Overall: $PASS/$TOTAL passing**"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "**ALERT: $FAIL service(s) failing**"
  # Send Telegram alert
  /Users/skylar/bin/claude-notify --alert "critical" "Smoke test: $FAIL/$TOTAL services FAILING. Run /nuke-ops:smoke-test for details." 2>/dev/null || true
  exit 1
fi
