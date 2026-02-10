#!/bin/bash
# investigator.sh — URL Discovery Agent
# Runs Phase 0 extractors then periodic rediscovery

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [INVESTIGATOR] $*"; }

call_fn() {
  local fn="$1"
  shift
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/$fn\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$*'" 2>/dev/null
}

# ============================================================
# INITIAL DISCOVERY RUN
# ============================================================

log "=== Phase 0A: RM Sotheby's API (14 auctions) ==="
for code in PA26 AZ26 CC26 MI26 S0226 PA25 AZ25 MO25 MI25 MT25 PA24 AZ24 MO24 MT24; do
  log "  RM Sotheby's: $code"
  RESULT=$(call_fn "extract-rmsothebys" "{\"action\": \"process\", \"auction\": \"$code\", \"save_to_db\": true}")
  LOTS=$(echo "$RESULT" | jq -r '.lots_processed // .count // 0' 2>/dev/null)
  log "  RM $code: $LOTS lots processed"
  sleep 3
done

log "=== Phase 0B: GAA Classic Cars crawl ==="
RESULT=$(call_fn "extract-gaa-classics" '{"action": "crawl", "type": "all"}')
log "  GAA: $(echo "$RESULT" | jq -c '{discovered: .discovered, processed: .processed}' 2>/dev/null)"

log "=== Phase 0D: Gooding discover + batch ==="
call_fn "extract-gooding" '{"action": "discover"}' > /dev/null
RESULT=$(call_fn "extract-gooding" '{"action": "batch", "limit": 500}')
log "  Gooding: $(echo "$RESULT" | jq -c '{processed: .processed, new: .new_vehicles}' 2>/dev/null)"

log "=== Phase 0C: BH Auction batch ==="
RESULT=$(call_fn "extract-bh-auction" '{"batch": true}')
log "  BH: $(echo "$RESULT" | jq -c '{processed: .processed, lots: .lots_found}' 2>/dev/null)"

log "=== Phase 0E: Bonhams catalogs ==="
# Try catalog extraction for known sale patterns
for sale_url in "https://cars.bonhams.com/auction/28509/" "https://cars.bonhams.com/auction/28510/" "https://cars.bonhams.com/auction/28511/"; do
  RESULT=$(call_fn "extract-bonhams" "{\"catalog_url\": \"$sale_url\"}")
  log "  Bonhams: $(echo "$RESULT" | jq -c '{success: .success, lots: .lots_processed}' 2>/dev/null)"
  sleep 3
done

log "=== Specialty Builder URL Discovery ==="
bash "$(dirname "$0")/discover-builder-urls.sh" 2>/dev/null || log "  Builder discovery script not found or failed"

log "Initial discovery complete."

# ============================================================
# PERIODIC REDISCOVERY (every hour)
# ============================================================
while [ "$(date +%s)" -lt "$END_TIME" ]; do
  sleep 3600

  [ "$(date +%s)" -ge "$END_TIME" ] && break

  log "=== Hourly rediscovery ==="

  # Re-run GAA in case new listings appeared
  RESULT=$(call_fn "extract-gaa-classics" '{"action": "crawl", "type": "all"}')
  log "  GAA refresh: $(echo "$RESULT" | jq -c '{discovered: .discovered}' 2>/dev/null)"

  # Re-run Gooding batch for any new lots
  RESULT=$(call_fn "extract-gooding" '{"action": "batch", "limit": 100, "offset": 0}')
  log "  Gooding refresh: $(echo "$RESULT" | jq -c '{processed: .processed}' 2>/dev/null)"

  log "Rediscovery cycle complete."
done

log "Investigator shutting down."
