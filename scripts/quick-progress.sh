#!/bin/bash
while true; do
  clear
  echo "════════════════════════════════════════════════════════════"
  echo "  IMAGE BACKFILL - LIVE PROGRESS"
  echo "════════════════════════════════════════════════════════════"
  echo ""
  cd /Users/skylar/nuke && source .env.local && psql "$SUPABASE_URL/rest/v1/" -c "
    SELECT 
      COUNT(*) as total_images,
      COUNT(CASE WHEN ai_last_scanned IS NOT NULL THEN 1 END) as processed,
      COUNT(CASE WHEN ai_last_scanned IS NULL THEN 1 END) as remaining,
      ROUND(100.0 * COUNT(CASE WHEN ai_last_scanned IS NOT NULL THEN 1 END) / COUNT(*), 1) as percent_done
    FROM vehicle_images 
    WHERE vehicle_id IS NOT NULL;
  " 2>/dev/null || echo "Counting..."
  
  echo ""
  echo "Last check: $(date '+%H:%M:%S')"
  echo ""
  echo "Refreshing in 5 seconds... (Ctrl+C to stop)"
  sleep 5
done
