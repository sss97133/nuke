#!/bin/bash

# Simple real-time progress tracker

clear
echo "🔄 IMAGE BACKFILL - LIVE TRACKER"
echo "================================"
echo ""

TOTAL=2734
START_TIME=$(date +%s)

while true; do
  # Count processed images
  PROCESSED=$(cd /Users/skylar/nuke && node -e "
    import { createClient } from '@supabase/supabase-js';
    import dotenv from 'dotenv';
    import fs from 'fs';
    const env = dotenv.parse(fs.readFileSync('.env.local'));
    const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
    const { count } = await supabase.from('vehicle_images').select('*', { count: 'exact', head: true }).not('ai_last_scanned', 'is', null).not('vehicle_id', 'is', null);
    console.log(count || 0);
  " 2>/dev/null)
  
  REMAINING=$((TOTAL - PROCESSED))
  PERCENT=$((PROCESSED * 100 / TOTAL))
  
  # Calculate elapsed time
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TIME))
  MINUTES=$((ELAPSED / 60))
  SECONDS=$((ELAPSED % 60))
  
  # Calculate rate
  if [ $ELAPSED -gt 0 ]; then
    RATE=$((PROCESSED * 60 / ELAPSED))
  else
    RATE=0
  fi
  
  # Calculate ETA
  if [ $RATE -gt 0 ]; then
    ETA_MINUTES=$((REMAINING / RATE))
  else
    ETA_MINUTES=999
  fi
  
  # Clear and display
  clear
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║      IMAGE ANALYSIS BACKFILL - REAL-TIME PROGRESS              ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Progress bar
  BAR_WIDTH=50
  FILLED=$((PERCENT * BAR_WIDTH / 100))
  EMPTY=$((BAR_WIDTH - FILLED))
  printf "  ["
  printf "█%.0s" $(seq 1 $FILLED)
  printf "░%.0s" $(seq 1 $EMPTY)
  printf "]  %d%%\n\n" $PERCENT
  
  echo "  📊 PROGRESS"
  echo "  ───────────────────────────────────────────────────────────────"
  printf "  %-25s %'d\n" "Total Images:" $TOTAL
  printf "  %-25s %'d (%d%%)\n" "Processed:" $PROCESSED $PERCENT
  printf "  %-25s %'d\n" "Remaining:" $REMAINING
  echo ""
  
  echo "  ⚡ PERFORMANCE"
  echo "  ───────────────────────────────────────────────────────────────"
  printf "  %-25s %dm %ds\n" "Elapsed:" $MINUTES $SECONDS
  printf "  %-25s %d images/min\n" "Rate:" $RATE
  printf "  %-25s %d minutes\n" "ETA:" $ETA_MINUTES
  echo ""
  
  echo "  Updated: $(date '+%H:%M:%S')"
  echo "  ───────────────────────────────────────────────────────────────"
  echo ""
  echo "  Press Ctrl+C to stop monitoring (processing continues)"
  
  sleep 3
done

