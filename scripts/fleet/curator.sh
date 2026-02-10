#!/bin/bash
# curator.sh — Queue Management Agent
# Resets stuck items, re-queues failures, manages priorities

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [CURATOR] $*"; }

query() {
  dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c \"$1\"" 2>/dev/null | grep -v 'dotenvx' | grep -v 'injecting'
}

exec_sql() {
  dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c \"$1\"" 2>/dev/null | grep -v 'dotenvx' | grep -v 'injecting'
}

log "Curator started."

while [ "$(date +%s)" -lt "$END_TIME" ]; do

  # 1. Reset stuck processing items (locked > 10 minutes)
  STUCK_RESET=$(exec_sql "
    UPDATE import_queue
    SET status='pending', locked_at=NULL, locked_by=NULL
    WHERE status='processing'
      AND locked_at < NOW() - INTERVAL '10 minutes';
  " 2>/dev/null | grep -oE '[0-9]+' | tail -1)
  [ "${STUCK_RESET:-0}" -gt 0 ] && log "Reset $STUCK_RESET stuck processing items"

  # 2. Re-queue failed items with < 3 attempts
  REQUEUED=$(exec_sql "
    UPDATE import_queue
    SET status='pending', error_message=NULL, locked_at=NULL, locked_by=NULL
    WHERE status='failed'
      AND attempts < 3
      AND (listing_url LIKE '%broadarrow%'
        OR listing_url LIKE '%vanguard%'
        OR listing_url LIKE '%velocity%'
        OR listing_url LIKE '%icon4x4%'
        OR listing_url LIKE '%bonhams%'
        OR listing_url LIKE '%bhauction%'
        OR listing_url LIKE '%ringbrothers%'
        OR listing_url LIKE '%coolnvintage%'
        OR listing_url LIKE '%brabus%');
  " 2>/dev/null | grep -oE '[0-9]+' | tail -1)
  [ "${REQUEUED:-0}" -gt 0 ] && log "Re-queued $REQUEUED failed items (< 3 attempts)"

  # 3. Check domain progress and prioritize domains with few remaining
  DOMAIN_PENDING=$(query "
    SELECT
      CASE
        WHEN listing_url LIKE '%broadarrow%' THEN 'broadarrow'
        WHEN listing_url LIKE '%vanguard%' THEN 'vanguard'
        WHEN listing_url LIKE '%velocity%' THEN 'velocity'
        WHEN listing_url LIKE '%icon4x4%' THEN 'icon4x4'
        WHEN listing_url LIKE '%bonhams%' THEN 'bonhams'
        WHEN listing_url LIKE '%gooding%' THEN 'gooding'
        WHEN listing_url LIKE '%gaa%' THEN 'gaa'
        WHEN listing_url LIKE '%bhauction%' THEN 'bhauction'
        ELSE NULL
      END as domain,
      COUNT(*)
    FROM import_queue
    WHERE status='pending'
    GROUP BY 1
    HAVING CASE
      WHEN listing_url LIKE '%broadarrow%' THEN 'broadarrow'
      WHEN listing_url LIKE '%vanguard%' THEN 'vanguard'
      WHEN listing_url LIKE '%velocity%' THEN 'velocity'
      WHEN listing_url LIKE '%icon4x4%' THEN 'icon4x4'
      WHEN listing_url LIKE '%bonhams%' THEN 'bonhams'
      WHEN listing_url LIKE '%gooding%' THEN 'gooding'
      WHEN listing_url LIKE '%gaa%' THEN 'gaa'
      WHEN listing_url LIKE '%bhauction%' THEN 'bhauction'
      ELSE NULL
    END IS NOT NULL
    ORDER BY 2;
  ")

  if [ -n "$(echo "$DOMAIN_PENDING" | tr -d '[:space:]')" ]; then
    log "Pending by domain:"
    echo "$DOMAIN_PENDING" | while read -r line; do
      [ -n "$line" ] && log "  $line"
    done
  fi

  sleep 600
done

log "Curator shutting down."
