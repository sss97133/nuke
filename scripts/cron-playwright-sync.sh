#!/bin/bash
cd /Users/skylar/nuke
export PATH="/opt/homebrew/bin:$PATH"

LOG_FILE="/Users/skylar/nuke/logs/playwright-sync.log"
mkdir -p "$(dirname "$LOG_FILE")"

echo "=== Playwright Sync $(date) ===" >> "$LOG_FILE"

# Load environment and run sync
dotenvx run -- node scripts/sync-auctions-playwright.js all >> "$LOG_FILE" 2>&1

# Keep log file manageable (last 1000 lines)
tail -1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
