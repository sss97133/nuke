#!/bin/bash
# Wayback overnight indexer - 7 hours
cd /Users/skylar/nuke
LOG="/Users/skylar/nuke/logs/wayback-overnight.log"
mkdir -p /Users/skylar/nuke/logs

echo "[$(date)] Starting 7-hour Wayback session" > "$LOG"

END=$(($(date +%s) + 25200))
COUNT=0
TOTAL=0

while [ $(date +%s) -lt $END ]; do
  COUNT=$((COUNT + 1))

  RESULT=$(dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/wayback-indexer" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"mode\":\"batch\",\"batch_size\":10}" --max-time 120' 2>/dev/null)

  V=$(echo "$RESULT" | grep -oE '"vehicles_extracted":[0-9]+' | grep -oE '[0-9]+')

  if [ -n "$V" ] && [ "$V" -gt 0 ] 2>/dev/null; then
    TOTAL=$((TOTAL + V))
    echo "[$(date)] Batch $COUNT: +$V vehicles (session: $TOTAL)" >> "$LOG"
  else
    echo "[$(date)] Batch $COUNT: 0 extracted" >> "$LOG"
  fi

  # Status check every 10 batches
  if [ $((COUNT % 10)) -eq 0 ]; then
    STATUS=$(dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/wayback-indexer" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"mode\":\"status\"}"' 2>/dev/null)
    DB_TOTAL=$(echo "$STATUS" | grep -oE '"wayback_vehicles":[0-9]+' | grep -oE '[0-9]+')
    echo "[$(date)] === DB TOTAL: $DB_TOTAL vehicles ===" >> "$LOG"
  fi

  sleep 90
done

echo "[$(date)] COMPLETE! Batches: $COUNT, Session: $TOTAL" >> "$LOG"
