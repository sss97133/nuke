#!/bin/bash
# Watch iCloud download progress for GMC K2500 albums and auto-sync when ready
# Usage: dotenvx run -- bash scripts/watch-icloud-and-sync.sh
#
# Checks every 60s. Once >50% of an album is local, kicks off the iphoto-intake sync.

cd /Users/skylar/nuke

VEHICLE_ID="a90c008a-3379-41d8-9eb2-b4eda365d74c"
BLUE_TOTAL=995
LWB_TOTAL=483
BLUE_SYNCED=false
LWB_SYNCED=false
THRESHOLD=0.50  # sync when 50%+ are local

check_local_count() {
  osxphotos query --album "$1" --not-missing --json 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null
}

echo "Watching iCloud downloads for GMC K2500 albums..."
echo "Will auto-sync each album once >50% of photos are local."
echo "---"

while true; do
  NOW=$(date '+%H:%M:%S')

  if [ "$BLUE_SYNCED" = false ]; then
    BLUE_LOCAL=$(check_local_count "1983 GMC K2500 BLUE")
    BLUE_PCT=$(python3 -c "print(f'{$BLUE_LOCAL/$BLUE_TOTAL*100:.0f}%')")
    echo "[$NOW] BLUE: $BLUE_LOCAL / $BLUE_TOTAL ($BLUE_PCT)"

    if python3 -c "exit(0 if $BLUE_LOCAL/$BLUE_TOTAL >= $THRESHOLD else 1)"; then
      echo "[$NOW] BLUE album ready — starting sync..."
      dotenvx run -- node scripts/iphoto-intake.mjs --sync --album "1983 GMC K2500 BLUE" --vehicle-id "$VEHICLE_ID" 2>&1 | tee /tmp/gmc_blue_sync.log
      BLUE_SYNCED=true
      echo "[$NOW] BLUE sync complete. Log: /tmp/gmc_blue_sync.log"
    fi
  fi

  if [ "$LWB_SYNCED" = false ]; then
    LWB_LOCAL=$(check_local_count "1983 GMC K2500 LWB")
    LWB_PCT=$(python3 -c "print(f'{$LWB_LOCAL/$LWB_TOTAL*100:.0f}%')")
    echo "[$NOW] LWB:  $LWB_LOCAL / $LWB_TOTAL ($LWB_PCT)"

    if python3 -c "exit(0 if $LWB_LOCAL/$LWB_TOTAL >= $THRESHOLD else 1)"; then
      echo "[$NOW] LWB album ready — starting sync..."
      dotenvx run -- node scripts/iphoto-intake.mjs --sync --album "1983 GMC K2500 LWB" --vehicle-id "$VEHICLE_ID" 2>&1 | tee /tmp/gmc_lwb_sync.log
      LWB_SYNCED=true
      echo "[$NOW] LWB sync complete. Log: /tmp/gmc_lwb_sync.log"
    fi
  fi

  if [ "$BLUE_SYNCED" = true ] && [ "$LWB_SYNCED" = true ]; then
    echo "Both albums synced. Done."
    exit 0
  fi

  sleep 60
done
