#!/usr/bin/env bash
# Pull the last N days of Skylar's iCloud photos to local disk, then run vision over each
# and write structured observations to the database.
#
# PREREQUISITE: Full Disk Access granted to Terminal + Python.app in System Settings.
# If this fails with TCC errors, that is what needs fixing — not the script.
#
# History: 2026-04-02 the cron-driven invocation stalled because `osxphotos` was called
# bare and cron's PATH does not include /opt/homebrew/bin. Line 19 hard-codes the
# absolute path to prevent recurrence.

set -euo pipefail

EXPORT_DIR="${EXPORT_DIR:-/Users/skylar/.nuke/photo-30d-batch}"
FROM_DATE="${FROM_DATE:-$(date -v-90d +%Y-%m-%d)}"
LOG="${LOG:-/Users/skylar/nuke/logs/photo-sync/photo-30d-analyze.log}"

mkdir -p "$EXPORT_DIR" "$(dirname "$LOG")"
echo "=== $(date -Iseconds) photo-30d-analyze starting ===" | tee -a "$LOG"
echo "EXPORT_DIR=$EXPORT_DIR  FROM_DATE=$FROM_DATE" | tee -a "$LOG"

# Phase 1: trigger iCloud download via PhotoKit (uses Photos.app, bypasses raw-FS TCC for missing assets)
/opt/homebrew/bin/osxphotos export "$EXPORT_DIR" \
  --from-date "${FROM_DATE}T00:00:00" \
  --download-missing --use-photokit \
  --convert-to-jpeg --jpeg-quality 0.85 \
  --update \
  --report "${EXPORT_DIR}/_export_report.json" \
  --retry 3 \
  2>&1 | tee -a "$LOG"

count=$(find "$EXPORT_DIR" -type f \( -name "*.jpeg" -o -name "*.jpg" -o -name "*.JPG" -o -name "*.JPEG" \) | wc -l | tr -d ' ')
echo "=== Phase 1 done. Files exported: $count ===" | tee -a "$LOG"

if [ "$count" -eq 0 ]; then
  echo "ERROR: zero files exported. TCC almost certainly still blocked." | tee -a "$LOG"
  echo "Confirm: System Settings → Privacy & Security → Full Disk Access AND Photos." | tee -a "$LOG"
  exit 1
fi

# Phase 2: hand the batch to the analyzer
exec /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
  /Users/skylar/nuke/scripts/analyze-photos-deep.py \
  --input-dir "$EXPORT_DIR" \
  --since "$FROM_DATE" \
  --owner-attribution iphoto \
  --write-db \
  2>&1 | tee -a "$LOG"
