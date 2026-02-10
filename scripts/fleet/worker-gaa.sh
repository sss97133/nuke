#!/bin/bash
# worker-gaa.sh — GAA Classic Cars Worker
# Single crawl call, then enrichment passes

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [GAA-WORKER] $*"; }

call_fn() {
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-gaa-classics\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$1'" 2>/dev/null
}

log "Starting GAA Classic Cars extraction"

# Full inventory crawl
log "Crawling current inventory..."
RESULT=$(call_fn '{"action": "crawl", "type": "inventory"}')
log "Inventory: $(echo "$RESULT" | jq -c '{success: .success, discovered: .discovered, processed: .processed}' 2>/dev/null)"

sleep 5

# Past results
log "Crawling past results..."
RESULT=$(call_fn '{"action": "crawl", "type": "results"}')
log "Results: $(echo "$RESULT" | jq -c '{success: .success, discovered: .discovered, processed: .processed}' 2>/dev/null)"

sleep 5

# Combined crawl
log "Full crawl (all)..."
RESULT=$(call_fn '{"action": "crawl", "type": "all"}')
log "All: $(echo "$RESULT" | jq -c '{success: .success, discovered: .discovered, processed: .processed}' 2>/dev/null)"

log "GAA worker complete."
