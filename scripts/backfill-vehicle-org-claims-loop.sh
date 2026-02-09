#!/usr/bin/env bash
# Run backfill in small batches until done. Use: dotenvx run -- bash scripts/backfill-vehicle-org-claims-loop.sh
set -e
export BATCH_SIZE=500
while true; do
  out=$(dotenvx run -- npx tsx scripts/backfill-vehicle-org-claims.ts 2>&1)
  echo "$out"
  echo "$out" | grep -q "Done\." && break
  echo "$out" | grep -q "Error:" && exit 1
  sleep 0.5
done
