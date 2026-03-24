#!/bin/bash
# mine-and-promote.sh — Automated library mining + promotion
# Runs mine-comments-for-library (50 groups via gemini free tier), then promotes results
# Designed for cron/scheduled execution every 6 hours
#
# Usage: dotenvx run -- bash scripts/scheduled/mine-and-promote.sh

set -euo pipefail
cd /Users/skylar/nuke

echo "=== Library Mine & Promote — $(date) ==="

# Step 1: Mine 50 make/model groups using Gemini (free tier, rate-limited)
echo "--- Mining comments (50 groups, gemini, cap=3 per group) ---"
dotenvx run -- node scripts/mine-comments-for-library.mjs --run 50 --provider gemini --cap=3 2>&1 || {
  echo "WARNING: Mining failed or partially completed"
}

# Step 2: Promote all staged extractions to canonical tables
echo "--- Promoting staged extractions ---"
dotenvx run -- node scripts/promote-library-extractions.mjs 2>&1

echo "=== Done — $(date) ==="
