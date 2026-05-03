#!/usr/bin/env bash
# WS-1 bulk catch-up wrapper for photo-30d-analyze.sh
#
# Purpose: pull ~90 days of iCloud photos into the Nuke pipeline after the
# 2026-04-02 stall caused by a bare `osxphotos` invocation (cron PATH issue).
#
# Usage: bash scripts/photo-bulk-intake.sh
# Override window: FROM_DATE=YYYY-MM-DD bash scripts/photo-bulk-intake.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_PATH="${LOG_PATH:-$REPO_ROOT/output/photo-bulk-run-2026-05-03.log}"
FROM_DATE="${FROM_DATE:-2026-02-02}"
EXPORT_DIR="${EXPORT_DIR:-/Users/skylar/.nuke/photo-bulk-90d}"

mkdir -p "$(dirname "$LOG_PATH")" "$EXPORT_DIR"

{
  echo "=== $(date -Iseconds) photo-bulk-intake starting ==="
  echo "FROM_DATE=$FROM_DATE"
  echo "EXPORT_DIR=$EXPORT_DIR"
  echo "LOG_PATH=$LOG_PATH"
} | tee -a "$LOG_PATH"

# Delegate to the patched analyze script (line 19 PATH-fix + dynamic FROM_DATE).
FROM_DATE="$FROM_DATE" \
EXPORT_DIR="$EXPORT_DIR" \
LOG="$LOG_PATH" \
  bash "$REPO_ROOT/scripts/photo-30d-analyze.sh" 2>&1 | tee -a "$LOG_PATH"

echo "=== $(date -Iseconds) photo-bulk-intake done ===" | tee -a "$LOG_PATH"
