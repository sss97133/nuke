#!/bin/bash
# close-all-gaps.sh — Master Launcher for Recall Gap Closure
#
# Phase 1: Discovery (parallel, ~5 min)
#   - Bonhams Playwright sale discovery
#   - BH Auction Playwright discovery
#
# Phase 2: Extraction (parallel, ~8h)
#   - BJ: bj-queue-extractor.ts --workers 3
#   - GAA: per-page crawl loop
#   - RM: process_with_fallback
#   - Gooding: discover_and_enqueue + batch
#   - Bonhams: catalog per sale (done in Phase 1)
#   - BH: lot per URL (done in Phase 1)
#
# Phase 3: Verification
#   - Vehicle count per source before/after
#
# Expected recovery: +28,000-40,000 vehicles
#
# Usage:
#   cd /Users/skylar/nuke && dotenvx run -- bash scripts/close-all-gaps.sh

set -euo pipefail
cd "$(dirname "$0")/.."

log() { echo "[$(date '+%H:%M:%S')] [CLOSE-GAPS] $*"; }

query() {
  dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c \"$1\"" 2>/dev/null | grep -v 'dotenvx' | grep -v 'injecting'
}

log "=============================================="
log "  CLOSE ALL RECALL GAPS — MASTER LAUNCHER"
log "=============================================="
log ""

# =============================================
# BASELINE COUNTS
# =============================================
log "=== BASELINE VEHICLE COUNTS ==="
BASELINE_TOTAL=$(query "SELECT COUNT(*) FROM vehicles;" | tr -d ' \n')
log "Total vehicles: $BASELINE_TOTAL"
log ""
log "Per source:"
query "SELECT discovery_source, COUNT(*) AS cnt FROM vehicles GROUP BY discovery_source ORDER BY cnt DESC LIMIT 20;"
log ""

BJ_PENDING=$(query "SELECT COUNT(*) FROM import_queue WHERE listing_url LIKE '%barrett-jackson%' AND status='pending';" | tr -d ' \n')
log "BJ URLs pending in queue: $BJ_PENDING"
log ""

# =============================================
# PHASE 1: DISCOVERY (parallel)
# =============================================
log "=== PHASE 1: DISCOVERY ==="

# Bonhams Playwright discovery (background)
if [ -f "scripts/bonhams-discover-sales.ts" ]; then
  log "Starting Bonhams Playwright discovery (background)..."
  dotenvx run -- npx tsx scripts/bonhams-discover-sales.ts > /tmp/bonhams-discover.log 2>&1 &
  BONHAMS_PID=$!
  log "  PID: $BONHAMS_PID"
else
  log "SKIP: scripts/bonhams-discover-sales.ts not found"
  BONHAMS_PID=""
fi

# BH Auction Playwright discovery (background)
if [ -f "scripts/bh-auction-discover.ts" ]; then
  log "Starting BH Auction Playwright discovery (background)..."
  dotenvx run -- npx tsx scripts/bh-auction-discover.ts > /tmp/bh-discover.log 2>&1 &
  BH_PID=$!
  log "  PID: $BH_PID"
else
  log "SKIP: scripts/bh-auction-discover.ts not found"
  BH_PID=""
fi

# Wait for Phase 1 to complete
if [ -n "$BONHAMS_PID" ]; then
  log "Waiting for Bonhams discovery (PID $BONHAMS_PID)..."
  wait "$BONHAMS_PID" 2>/dev/null || true
  log "Bonhams discovery complete. Log: /tmp/bonhams-discover.log"
  tail -5 /tmp/bonhams-discover.log 2>/dev/null || true
fi

if [ -n "$BH_PID" ]; then
  log "Waiting for BH discovery (PID $BH_PID)..."
  wait "$BH_PID" 2>/dev/null || true
  log "BH discovery complete. Log: /tmp/bh-discover.log"
  tail -5 /tmp/bh-discover.log 2>/dev/null || true
fi

log ""

# =============================================
# PHASE 2: EXTRACTION (parallel)
# =============================================
log "=== PHASE 2: EXTRACTION ==="

# BJ Queue Extractor — biggest impact, runs longest
if [ -f "scripts/bj-queue-extractor.ts" ]; then
  log "Starting BJ queue extractor (3 workers, background)..."
  dotenvx run -- npx tsx scripts/bj-queue-extractor.ts --workers 3 --batch-size 50 > /tmp/bj-extractor.log 2>&1 &
  BJ_PID=$!
  log "  PID: $BJ_PID (log: /tmp/bj-extractor.log)"
else
  log "SKIP: scripts/bj-queue-extractor.ts not found"
  BJ_PID=""
fi

# GAA per-page crawl (background)
log "Starting GAA per-page crawl (background)..."
bash scripts/fleet/worker-gaa.sh 28800 > /tmp/gaa-worker.log 2>&1 &
GAA_PID=$!
log "  PID: $GAA_PID"

# RM Sotheby's with fallback (background)
log "Starting RM Sotheby's with HTML fallback (background)..."
bash scripts/fleet/worker-rmsothebys.sh 28800 > /tmp/rm-worker.log 2>&1 &
RM_PID=$!
log "  PID: $RM_PID"

# Gooding discover + batch from queue (background)
log "Starting Gooding discover_and_enqueue + batch (background)..."
bash scripts/fleet/worker-gooding.sh 28800 > /tmp/gooding-worker.log 2>&1 &
GOODING_PID=$!
log "  PID: $GOODING_PID"

log ""
log "All extraction workers launched. Monitoring progress..."
log ""

# =============================================
# PROGRESS MONITORING
# =============================================
monitor_progress() {
  while true; do
    sleep 300  # Every 5 minutes

    # Check if BJ is still running
    if [ -n "$BJ_PID" ] && ! kill -0 "$BJ_PID" 2>/dev/null; then
      log "BJ extractor finished"
      BJ_PID=""
    fi

    CURRENT_TOTAL=$(query "SELECT COUNT(*) FROM vehicles;" | tr -d ' \n')
    NEW=$((CURRENT_TOTAL - BASELINE_TOTAL))
    BJ_DONE=$(query "SELECT COUNT(*) FROM import_queue WHERE listing_url LIKE '%barrett-jackson%' AND status='complete';" | tr -d ' \n')
    BJ_REMAIN=$(query "SELECT COUNT(*) FROM import_queue WHERE listing_url LIKE '%barrett-jackson%' AND status='pending';" | tr -d ' \n')

    log "PROGRESS: +$NEW vehicles (total: $CURRENT_TOTAL) | BJ: $BJ_DONE complete, $BJ_REMAIN pending"

    # Check if all workers are done
    ALL_DONE=true
    [ -n "$BJ_PID" ] && kill -0 "$BJ_PID" 2>/dev/null && ALL_DONE=false
    kill -0 "$GAA_PID" 2>/dev/null && ALL_DONE=false
    kill -0 "$RM_PID" 2>/dev/null && ALL_DONE=false
    kill -0 "$GOODING_PID" 2>/dev/null && ALL_DONE=false

    if [ "$ALL_DONE" = true ]; then
      log "All workers completed!"
      break
    fi
  done
}

monitor_progress

# =============================================
# PHASE 3: VERIFICATION
# =============================================
log ""
log "=== PHASE 3: VERIFICATION ==="

FINAL_TOTAL=$(query "SELECT COUNT(*) FROM vehicles;" | tr -d ' \n')
DELTA=$((FINAL_TOTAL - BASELINE_TOTAL))

log ""
log "=============================================="
log "  RESULTS"
log "=============================================="
log "Baseline:  $BASELINE_TOTAL vehicles"
log "Final:     $FINAL_TOTAL vehicles"
log "Added:     +$DELTA vehicles"
log ""

log "Per-source (last 12h):"
query "SELECT discovery_source, COUNT(*) AS cnt FROM vehicles WHERE created_at > NOW() - INTERVAL '12 hours' GROUP BY discovery_source ORDER BY cnt DESC;"
log ""

log "BJ queue status:"
query "SELECT status, COUNT(*) FROM import_queue WHERE listing_url LIKE '%barrett-jackson%' GROUP BY status ORDER BY COUNT(*) DESC;"
log ""

log "Data quality (last 12h):"
query "SELECT
  COUNT(*) AS total,
  COUNT(CASE WHEN year IS NOT NULL THEN 1 END) AS has_year,
  COUNT(CASE WHEN make IS NOT NULL THEN 1 END) AS has_make,
  COUNT(CASE WHEN vin IS NOT NULL THEN 1 END) AS has_vin,
  ROUND(AVG(CASE WHEN year IS NOT NULL THEN 1.0 ELSE 0.0 END) * 100, 1) AS year_pct
FROM vehicles WHERE created_at > NOW() - INTERVAL '12 hours';"

log ""
log "=============================================="
log "  CLOSE ALL GAPS COMPLETE"
log "=============================================="
