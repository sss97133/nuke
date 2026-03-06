#!/usr/bin/env bash
# Backfill missing prices by calling existing extractors' re_enrich endpoints.
# Each extractor fetches the lot page from the auction house and extracts the real price.
#
# Usage: dotenvx run -- bash scripts/backfill-auction-prices.sh [source]
#   source: bj | bonhams | mecum | all (default: all)
#
# Extractors used:
#   - extract-barrett-jackson (re_enrich action, direct HTTP, free)
#   - extract-bonhams (re_enrich action, JSON-LD parsing, free)
#   - extract-mecum (re_enrich action, __NEXT_DATA__ parsing, free)
#
# Each re_enrich call processes up to BATCH_SIZE vehicles concurrently.
# The extractor picks vehicles where discovery_source matches and sale_price IS NULL.
set -e

if [ -z "${VITE_SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use dotenvx run --)" >&2
  exit 1
fi

SOURCE="${1:-all}"
BATCH_SIZE=50
CONCURRENCY=5
SLEEP_BETWEEN=2

call_re_enrich() {
  local func_name="$1"
  local display_name="$2"
  local batch="$3"
  local conc="$4"

  echo ""
  echo "=== Re-enriching: $display_name (batch=$batch, concurrency=$conc) ==="
  local total_success=0
  local total_failed=0
  local round=0

  while true; do
    round=$((round + 1))
    local result
    result=$(curl -sS -X POST \
      "$VITE_SUPABASE_URL/functions/v1/$func_name" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"action\": \"re_enrich\", \"limit\": $batch, \"concurrency\": $conc}" \
      --max-time 120 2>&1) || {
      echo "  Round $round: curl error, retrying in 10s..."
      sleep 10
      continue
    }

    local success failed total msg
    success=$(echo "$result" | jq -r '.success_count // .success // 0' 2>/dev/null || echo 0)
    failed=$(echo "$result" | jq -r '.failed // 0' 2>/dev/null || echo 0)
    total=$(echo "$result" | jq -r '.total // 0' 2>/dev/null || echo 0)
    msg=$(echo "$result" | jq -r '.message // empty' 2>/dev/null || echo "")

    # Handle different response formats
    if echo "$result" | jq -e '.success == true' >/dev/null 2>&1; then
      success=$(echo "$result" | jq -r '.success_count // .success_field // 0' 2>/dev/null)
      # If success is "true" (boolean), use the total field
      if [ "$success" = "true" ] || [ "$success" = "0" ]; then
        success=$(echo "$result" | jq -r 'if .success == true then (.total // 0) else 0 end' 2>/dev/null || echo 0)
      fi
    fi

    total_success=$((total_success + ${success:-0}))
    total_failed=$((total_failed + ${failed:-0}))

    echo "  Round $round: processed=$total success=$success failed=$failed (cumulative: $total_success success, $total_failed failed)"

    # Show field breakdown if available
    local fields
    fields=$(echo "$result" | jq -r '.field_counts // empty' 2>/dev/null)
    if [ -n "$fields" ] && [ "$fields" != "null" ] && [ "$fields" != "{}" ]; then
      echo "    Fields: $fields"
    fi

    # Stop if no candidates remain
    if [ "${total:-0}" -eq 0 ] || [ -n "$msg" ]; then
      echo "  Done: $display_name ($total_success enriched, $total_failed failed)"
      break
    fi

    sleep "$SLEEP_BETWEEN"
  done
}

if [ "$SOURCE" = "bj" ] || [ "$SOURCE" = "all" ]; then
  call_re_enrich "extract-barrett-jackson" "Barrett-Jackson" "$BATCH_SIZE" "$CONCURRENCY"
fi

if [ "$SOURCE" = "bonhams" ] || [ "$SOURCE" = "all" ]; then
  call_re_enrich "extract-bonhams" "Bonhams" "$BATCH_SIZE" "$CONCURRENCY"
fi

if [ "$SOURCE" = "mecum" ] || [ "$SOURCE" = "all" ]; then
  call_re_enrich "extract-mecum" "Mecum" "$BATCH_SIZE" "$CONCURRENCY"
fi

echo ""
echo "=== COMPLETE ==="
echo "Run again to continue processing remaining rows."
echo "Check progress: dotenvx run -- bash scripts/backfill-auction-prices.sh"
