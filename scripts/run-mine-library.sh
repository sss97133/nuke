#!/bin/bash
# scripts/run-mine-library.sh — Mining loop wrapper for mine-comments-for-library.mjs
#
# Loops mining in batches, stops after consecutive zero-extraction runs.
# Usage:
#   dotenvx run -- bash scripts/run-mine-library.sh                     # default: ollama, batches of 80
#   dotenvx run -- bash scripts/run-mine-library.sh --provider ollama   # explicit provider
#   dotenvx run -- bash scripts/run-mine-library.sh --batch-size 40     # smaller batches

set -uo pipefail
cd "$(dirname "$0")/.."

PROVIDER="ollama"
BATCH_SIZE=80
MAX_ZERO_RUNS=5

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --provider) PROVIDER="$2"; shift 2;;
    --batch-size) BATCH_SIZE="$2"; shift 2;;
    --max-zero) MAX_ZERO_RUNS="$2"; shift 2;;
    *) shift;;
  esac
done

DATE=$(date +%Y-%m-%d)
LOG="logs/mine-library-${DATE}.log"
mkdir -p logs

echo "=== Mining Loop Started: $(date) ===" | tee -a "$LOG"
echo "Provider: $PROVIDER | Batch: $BATCH_SIZE | Stop after $MAX_ZERO_RUNS zero runs" | tee -a "$LOG"

zero_count=0
total_runs=0
total_extractions=0

while true; do
  total_runs=$((total_runs + 1))
  echo "" | tee -a "$LOG"
  echo "── Run $total_runs ($(date +%H:%M:%S)) ──" | tee -a "$LOG"

  OUTPUT=$(node scripts/mine-comments-for-library.mjs --run "$BATCH_SIZE" --provider "$PROVIDER" --cap=0 2>&1)
  echo "$OUTPUT" >> "$LOG"

  # Extract extraction count from output
  EXTRACTIONS=$(echo "$OUTPUT" | grep -oP 'Extractions: \K\d+' | tail -1)
  EXTRACTIONS=${EXTRACTIONS:-0}

  echo "  Extractions this run: $EXTRACTIONS" | tee -a "$LOG"
  total_extractions=$((total_extractions + EXTRACTIONS))

  if [[ "$EXTRACTIONS" -eq 0 ]]; then
    zero_count=$((zero_count + 1))
    echo "  Zero-extraction run ($zero_count/$MAX_ZERO_RUNS)" | tee -a "$LOG"
    if [[ "$zero_count" -ge "$MAX_ZERO_RUNS" ]]; then
      echo "" | tee -a "$LOG"
      echo "=== STOPPED: $MAX_ZERO_RUNS consecutive zero-extraction runs ===" | tee -a "$LOG"
      break
    fi
  else
    zero_count=0
  fi

  # Check for "No groups to mine" (all done)
  if echo "$OUTPUT" | grep -q "No groups to mine"; then
    echo "" | tee -a "$LOG"
    echo "=== STOPPED: No more groups to mine ===" | tee -a "$LOG"
    break
  fi

  # Brief pause between runs
  sleep 5
done

echo "" | tee -a "$LOG"
echo "=== Mining Loop Complete: $(date) ===" | tee -a "$LOG"
echo "Total runs: $total_runs | Total extractions: $total_extractions" | tee -a "$LOG"
