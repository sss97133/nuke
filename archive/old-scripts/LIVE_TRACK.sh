#!/bin/bash
echo "🔄 Starting live tracker..."
while true; do
  clear
  echo "════════════════════════════════════════════════════════════"
  echo "  IMAGE BACKFILL - REAL-TIME PROGRESS"  
  echo "════════════════════════════════════════════════════════════"
  echo ""
  
  # Count images processed (each has "Context:" in log)
  if [ -f context-backfill.log ]; then
    PROCESSED=$(grep -c "Context:" context-backfill.log 2>/dev/null || echo "0")
    TOTAL=2734
    REMAINING=$((TOTAL - PROCESSED))
    PERCENT=$((PROCESSED * 100 / TOTAL))
    
    echo "  Total Images:    $TOTAL"
    echo "  Processed:       $PROCESSED ($PERCENT%)"
    echo "  Remaining:       $REMAINING"
    echo ""
    
    # Simple progress bar
    BARS=$((PERCENT / 2))
    printf "  ["
    for i in $(seq 1 $BARS); do printf "█"; done
    for i in $(seq $BARS 50); do printf "░"; done  
    printf "] $PERCENT%%\n"
    echo ""
    
    echo "  Last 5 images:"
    tail -10 context-backfill.log | grep "Context:" | tail -5 | sed 's/^/    /'
  else
    echo "  Waiting for log file..."
  fi
  
  echo ""
  echo "  $(date '+%H:%M:%S') | Refreshing every 3s | Ctrl+C to stop"
  sleep 3
done
