#!/bin/bash
# Fix duplicate+active auction_status in 5000-row batches via heredoc
export PGPASSWORD="RbzKq32A0uhqvJMQ"

total=0
while true; do
  remaining=$(psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
    -U postgres.qkgaybvrernstplzjaam -d postgres -t -A <<'EOSQL'
UPDATE vehicles SET auction_status = NULL
WHERE id IN (
  SELECT id FROM vehicles
  WHERE status = 'duplicate' AND auction_status = 'active'
  LIMIT 5000
);
SELECT COUNT(*) FROM vehicles WHERE status = 'duplicate' AND auction_status = 'active';
EOSQL
  )
  remaining=$(echo "$remaining" | grep -E '^[0-9]+$' | tail -1)
  total=$((357650 - remaining))
  echo "$(date +%H:%M:%S) Cleared: $total | Remaining: $remaining"

  if [ "$remaining" = "0" ] || [ -z "$remaining" ]; then
    break
  fi
  sleep 0.1
done
echo "DONE: $total total cleared"
