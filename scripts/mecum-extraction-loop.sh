#!/bin/bash
# Continuous Mecum extraction until all pending are processed

LOG_FILE="logs/mecum-extraction-loop.log"
BATCH_SIZE=200
WORKERS=3

echo "═══════════════════════════════════════════════" | tee -a $LOG_FILE
echo "  Mecum Continuous Extraction" | tee -a $LOG_FILE
echo "  Started: $(date)" | tee -a $LOG_FILE
echo "  Batch: $BATCH_SIZE | Workers: $WORKERS" | tee -a $LOG_FILE
echo "═══════════════════════════════════════════════" | tee -a $LOG_FILE

ITERATION=0
while true; do
  ITERATION=$((ITERATION + 1))

  # Check how many pending remain
  PENDING=$(dotenvx run -- bash -c 'PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "SELECT count(*) FROM vehicles WHERE discovery_source = '\''mecum'\'' AND status = '\''pending'\'';"' 2>/dev/null | tr -d ' ')

  echo "" | tee -a $LOG_FILE
  echo "[$(date +%H:%M:%S)] Iteration $ITERATION - $PENDING pending" | tee -a $LOG_FILE

  if [ "$PENDING" -lt 10 ]; then
    echo "✅ All done! Less than 10 pending remaining." | tee -a $LOG_FILE
    break
  fi

  # Run extraction batch
  dotenvx run -- node scripts/mecum-proper-extract.js $BATCH_SIZE $WORKERS 2>&1 | tee -a $LOG_FILE

  # Brief pause between batches
  sleep 5
done

echo "" | tee -a $LOG_FILE
echo "═══════════════════════════════════════════════" | tee -a $LOG_FILE
echo "  Extraction Complete: $(date)" | tee -a $LOG_FILE
echo "═══════════════════════════════════════════════" | tee -a $LOG_FILE
