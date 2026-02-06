#!/bin/bash
# Continuous BaT Extraction Script
# Run this to keep extracting BaT listings in parallel
# Usage: ./scripts/continuous-bat-extraction.sh

set -e
cd /Users/skylar/nuke

echo "Starting continuous BaT extraction..."
echo "Press Ctrl+C to stop"

# Function to run extraction batch
run_batch() {
  dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/bat-queue-worker" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"batch_size\": 50}"' 2>/dev/null
}

# Function to check pending count
check_pending() {
  PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "SELECT COUNT(*) FROM import_queue WHERE listing_url LIKE '%bringatrailer%' AND status = 'pending';" 2>/dev/null | tr -d ' '
}

# Function to crawl a year
crawl_year() {
  local year=$1
  local start_page=$2
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/bat-year-crawler\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"action\": \"crawl\", \"crawl_type\": \"year_$year\", \"pages\": 100, \"start_page\": $start_page}'" 2>/dev/null
}

iteration=0
while true; do
  iteration=$((iteration + 1))
  pending=$(check_pending)
  echo "[$(date '+%H:%M:%S')] Iteration $iteration - Pending: $pending"

  # Run 5 parallel extraction batches
  for i in 1 2 3 4 5; do
    run_batch &
  done

  # Every 10 iterations, trigger year crawling
  if [ $((iteration % 10)) -eq 0 ]; then
    echo "[$(date '+%H:%M:%S')] Running year discovery crawl..."
    for year in 2014 2015 2016 2017 2018 2019 2020 2021; do
      crawl_year $year $((iteration * 10)) &
    done
  fi

  # Wait for batches to complete
  wait

  # Check if we should stop (no pending items)
  if [ "$pending" -lt 10 ]; then
    echo "[$(date '+%H:%M:%S')] Low pending count ($pending). Checking for more to discover..."
    # Trigger discovery
    for year in 2014 2015 2016 2017 2018 2019; do
      crawl_year $year 1 &
    done
    wait

    new_pending=$(check_pending)
    if [ "$new_pending" -lt 10 ]; then
      echo "[$(date '+%H:%M:%S')] Still low pending ($new_pending). Sleeping 60 seconds..."
      sleep 60
    fi
  fi

  # Small delay between iterations
  sleep 5
done
