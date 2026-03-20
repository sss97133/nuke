#!/bin/bash
# scripts/run-enrichment-sweep.sh
# Data Quality Enrichment Sweep — runs enrich-bulk strategies sequentially
#
# Usage:
#   dotenvx run -- bash scripts/run-enrichment-sweep.sh              # run all strategies
#   dotenvx run -- bash scripts/run-enrichment-sweep.sh mine_descriptions  # run one strategy
#   dotenvx run -- bash scripts/run-enrichment-sweep.sh stats        # check current gaps

set -euo pipefail

URL="$VITE_SUPABASE_URL"
KEY="$SUPABASE_SERVICE_ROLE_KEY"
STRATEGY=${1:-"all"}
LIMIT=${2:-500}

run_strategy() {
  local strat=$1
  local total=0
  local rounds=0
  echo ""
  echo "══════════════════════════════════════════════"
  echo "  Strategy: $strat"
  echo "══════════════════════════════════════════════"
  while true; do
    rounds=$((rounds + 1))
    RESULT=$(curl -s -X POST "$URL/functions/v1/enrich-bulk" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"strategy\": \"$strat\", \"limit\": $LIMIT}")

    # Extract processed count (different strategies use different field names)
    PROCESSED=$(echo "$RESULT" | jq -r '
      .updates_applied //
      .updated //
      .suggestions_created //
      .total //
      0')
    DURATION=$(echo "$RESULT" | jq -r '.duration_ms // "?"')
    SUCCESS=$(echo "$RESULT" | jq -r '.success // false')

    if [ "$SUCCESS" != "true" ]; then
      echo "  ERROR: $(echo "$RESULT" | jq -r '.error // "unknown"')"
      break
    fi

    echo "  $(date +%H:%M:%S) | round $rounds | processed: $PROCESSED | ${DURATION}ms"
    total=$((total + PROCESSED))

    # Stop if no more work
    [ "$PROCESSED" -eq 0 ] 2>/dev/null && break
    [ "$PROCESSED" = "null" ] && break

    # Rate limit: pause between batches
    sleep 2
  done
  echo "  ── $strat complete: $total total across $rounds rounds ──"
}

before_stats() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║  Data Quality Enrichment Sweep               ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
  echo "Capturing baseline stats..."
  curl -s -X POST "$URL/functions/v1/enrich-bulk" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{"strategy": "stats"}' | jq '{total: .total, sources: .sources, coverage: .field_coverage_pct}'
  echo ""
}

after_stats() {
  echo ""
  echo "══════════════════════════════════════════════"
  echo "  Post-sweep verification"
  echo "══════════════════════════════════════════════"
  curl -s -X POST "$URL/functions/v1/enrich-bulk" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{"strategy": "stats"}' | jq '{total: .total, sources: .sources, coverage: .field_coverage_pct}'
}

if [ "$STRATEGY" = "stats" ]; then
  before_stats
  exit 0
fi

if [ "$STRATEGY" = "all" ]; then
  before_stats

  # Execution order matters:
  # 1. mine_descriptions — unlocks VINs for later steps
  # 2. derive_fields — body_style for search
  # 3. backfill_location — city/state for search
  # 4. cross_reference — sale_price, asking_price, description
  # 5. vin_decode — now has more VINs from step 1
  # 6. smart_primary_image — cosmetic fix
  # 7. vin_link_suggestions — generates human review queue

  run_strategy "mine_descriptions"
  run_strategy "derive_fields"
  run_strategy "backfill_location"
  run_strategy "cross_reference"
  run_strategy "vin_decode"
  run_strategy "smart_primary_image"
  run_strategy "vin_link_suggestions"

  # Recalculate all quality scores
  echo ""
  echo "══════════════════════════════════════════════"
  echo "  Recalculating quality scores..."
  echo "══════════════════════════════════════════════"
  curl -s -X POST "$URL/functions/v1/backfill-quality-scores" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{"force_all": true}' | jq '{processed: .processed, average: .average_score}'

  after_stats
else
  run_strategy "$STRATEGY"
fi
