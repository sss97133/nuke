#!/bin/bash
# cleanup-orchestrator.sh
# Runs the full data cleanup pipeline in order.
# Safe to leave running — each step is idempotent.
set -e
cd /Users/skylar/nuke

log() { echo "[$(date '+%H:%M:%S')] $1"; }

# Wait for a process to finish by name
wait_for() {
  local name=$1
  while pgrep -f "$name" > /dev/null 2>&1; do
    sleep 10
  done
  log "  $name finished"
}

# === Phase 1: Wait for currently running scripts ===
log "=== Waiting for running scripts to finish ==="

if pgrep -f "fix-auction-source" > /dev/null 2>&1; then
  log "  Waiting for fix-auction-source.cjs..."
  wait_for "fix-auction-source"
fi

if pgrep -f "fix-model-field" > /dev/null 2>&1; then
  log "  Waiting for fix-model-field.cjs..."
  wait_for "fix-model-field"
fi

# === Phase 2: Run classify-blank-sources (needs auction_source normalization done) ===
log "=== Running classify-blank-sources.cjs ==="
dotenvx run -- node scripts/classify-blank-sources.cjs 2>&1
log "  classify-blank-sources complete"

# === Phase 3: Wait for dedup to finish ===
if pgrep -f "dedupe-vehicles" > /dev/null 2>&1; then
  log "  Waiting for dedupe-vehicles.cjs..."
  wait_for "dedupe-vehicles"
fi

# === Phase 4: Add unique index to prevent future duplication ===
log "=== Adding partial unique index on listing_url ==="
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_listing_url_unique
ON vehicles (listing_url)
WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url != '';
" 2>&1 || log "  Index creation failed (may already exist or have remaining dupes)"

# === Phase 5: Wait for location agent (it auto-runs Phase 2 → 3 → 4) ===
if pgrep -f "location-agent" > /dev/null 2>&1; then
  log "  Waiting for location-agent to finish all phases..."
  wait_for "location-agent"
fi
log "  Location agent complete"

# === Final Status ===
log "=== ALL CLEANUP COMPLETE ==="
bash scripts/data-cleanup-status.sh
