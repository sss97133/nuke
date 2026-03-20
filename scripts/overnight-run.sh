#!/bin/bash
# scripts/overnight-run.sh — Overnight autonomous extraction orchestrator
#
# Launches all extraction streams as background processes, monitors progress,
# and runs post-processing after streams complete.
#
# Usage:
#   dotenvx run -- bash scripts/overnight-run.sh
#   dotenvx run -- bash scripts/overnight-run.sh --skip-snapshots
#   dotenvx run -- bash scripts/overnight-run.sh --skip-mining
#   dotenvx run -- bash scripts/overnight-run.sh --post-only

set -uo pipefail
cd "$(dirname "$0")/.."

DATE=$(date +%Y-%m-%d)
mkdir -p logs

SKIP_SNAPSHOTS=false
SKIP_MINING=false
SKIP_EXTRACTION=false
SKIP_ENRICHMENT=false
POST_ONLY=false

for arg in "$@"; do
  case $arg in
    --skip-snapshots) SKIP_SNAPSHOTS=true;;
    --skip-mining) SKIP_MINING=true;;
    --skip-extraction) SKIP_EXTRACTION=true;;
    --skip-enrichment) SKIP_ENRICHMENT=true;;
    --post-only) POST_ONLY=true;;
  esac
done

PIDS=()
NAMES=()

log() {
  echo "[$(date +%H:%M:%S)] $*" | tee -a "logs/overnight-orchestrator-${DATE}.log"
}

launch() {
  local name=$1
  shift
  log "LAUNCH: $name"
  "$@" &
  local pid=$!
  PIDS+=($pid)
  NAMES+=("$name")
  log "  PID $pid"
}

wait_for_all() {
  log "Waiting for ${#PIDS[@]} streams to complete..."
  local i=0
  while true; do
    local running=0
    for idx in "${!PIDS[@]}"; do
      if kill -0 "${PIDS[$idx]}" 2>/dev/null; then
        running=$((running + 1))
      fi
    done
    if [[ $running -eq 0 ]]; then
      break
    fi

    # Progress report every 15 minutes
    i=$((i + 1))
    if [[ $((i % 90)) -eq 0 ]]; then  # 90 * 10s = 15 min
      log "PROGRESS: $running/${#PIDS[@]} streams still running"
      for idx in "${!PIDS[@]}"; do
        if kill -0 "${PIDS[$idx]}" 2>/dev/null; then
          log "  RUNNING: ${NAMES[$idx]} (PID ${PIDS[$idx]})"
        else
          wait "${PIDS[$idx]}" 2>/dev/null
          local code=$?
          log "  DONE: ${NAMES[$idx]} (exit $code)"
        fi
      done

      # Log tail of each stream
      for f in logs/overnight-*-${DATE}.log; do
        [[ -f "$f" ]] && log "  $(basename "$f"): $(wc -l < "$f") lines, last: $(tail -1 "$f" | head -c 120)"
      done
    fi

    sleep 10
  done
  log "All streams complete."
}

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 1: LAUNCH STREAMS
# ──────────────────────────────────────────────────────────────────────────────

if [[ "$POST_ONLY" != "true" ]]; then

log "============================================"
log "OVERNIGHT RUN STARTED"
log "============================================"

# Stream A: Snapshot Extraction (regex, no LLM)
if [[ "$SKIP_SNAPSHOTS" != "true" ]]; then
  launch "snapshots" \
    node scripts/mass-extract-snapshots.mjs all 2000 200 \
    > "logs/overnight-snapshots-${DATE}.log" 2>&1
fi

# Stream B: Comment Library Mining via Ollama
if [[ "$SKIP_MINING" != "true" ]]; then
  launch "mining" \
    bash scripts/run-mine-library.sh --provider ollama --batch-size 80 \
    > "logs/overnight-mining-${DATE}.log" 2>&1
fi

# Stream C: v3 Description Extraction via Ollama
if [[ "$SKIP_EXTRACTION" != "true" ]]; then
  launch "extraction" \
    node scripts/local-description-discovery.mjs \
      --provider ollama --max 5000 --continue --parallel 2 \
    > "logs/overnight-extraction-${DATE}.log" 2>&1
fi

# Stream D: Enrichment Sweep (pure DB, $0)
if [[ "$SKIP_ENRICHMENT" != "true" ]]; then
  launch "enrichment" \
    bash scripts/run-enrichment-sweep.sh all 10000 \
    > "logs/overnight-enrichment-${DATE}.log" 2>&1
fi

wait_for_all

fi  # end POST_ONLY check

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 2: POST-PROCESSING
# ──────────────────────────────────────────────────────────────────────────────

log ""
log "============================================"
log "POST-PROCESSING"
log "============================================"

# 2A: Bridge extractions to field evidence
log "Running: bridge-extractions-to-field-evidence..."
node scripts/bridge-extractions-to-field-evidence.mjs >> "logs/overnight-bridge-${DATE}.log" 2>&1
log "  Bridge complete (exit $?)"

# 2B: Validate extractions
log "Running: validate-extractions..."
node scripts/validate-extractions.mjs >> "logs/overnight-validate-${DATE}.log" 2>&1
log "  Validate complete (exit $?)"

# 2C: Promote library extractions
log "Running: promote-library-extractions..."
node scripts/promote-library-extractions.mjs >> "logs/overnight-promote-${DATE}.log" 2>&1
log "  Promote complete (exit $?)"

# ──────────────────────────────────────────────────────────────────────────────
# PHASE 3: MORNING REPORT
# ──────────────────────────────────────────────────────────────────────────────

log ""
log "============================================"
log "MORNING REPORT"
log "============================================"

# Mining stats
log "Mining stats:"
node scripts/mine-comments-for-library.mjs --stats 2>&1 | tee -a "logs/overnight-orchestrator-${DATE}.log"

# Count overnight output
for f in logs/overnight-*-${DATE}.log; do
  [[ -f "$f" ]] || continue
  ERRORS=$(grep -c "ERR\|FAIL\|error" "$f" 2>/dev/null || echo 0)
  LINES=$(wc -l < "$f")
  log "  $(basename "$f"): $LINES lines, $ERRORS errors"
done

# Generate report file
REPORT="logs/overnight-report-${DATE}.txt"
cat > "$REPORT" << REPORT_EOF
=== Overnight Run Report: ${DATE} ===
Completed: $(date)

Streams:
$(for idx in "${!NAMES[@]}"; do echo "  ${NAMES[$idx]}: PID ${PIDS[$idx]}"; done)

Log sizes:
$(for f in logs/overnight-*-${DATE}.log; do [[ -f "$f" ]] && echo "  $(basename "$f"): $(wc -l < "$f") lines"; done)

Error counts:
$(for f in logs/overnight-*-${DATE}.log; do [[ -f "$f" ]] && echo "  $(basename "$f"): $(grep -c 'ERR\|FAIL\|error' "$f" 2>/dev/null || echo 0) errors"; done)
REPORT_EOF

log "Report written to: $REPORT"
log "============================================"
log "OVERNIGHT RUN COMPLETE"
log "============================================"
