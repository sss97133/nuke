#!/bin/bash
# Morning health check — designed to be called by Claude Code scheduled tasks
# Outputs structured report to stdout for the scheduled task to process
# Usage: dotenvx run -- bash scripts/scheduled/morning-health-check.sh

set -euo pipefail
cd /Users/skylar/nuke

SUPABASE_URL="${VITE_SUPABASE_URL}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
REPORT_FILE=".claude/HEALTH_REPORT.md"
TIMESTAMP=$(date "+%Y-%m-%d %H:%M")

echo "## Nuke Health Report — $TIMESTAMP"
echo ""

# 1. DB Stats
echo "### Platform Stats"
DB_STATS=$(curl -s "$SUPABASE_URL/functions/v1/db-stats" -H "Authorization: Bearer $SERVICE_KEY" 2>/dev/null)
if [ $? -eq 0 ] && echo "$DB_STATS" | jq . >/dev/null 2>&1; then
  echo "- Vehicles: $(echo $DB_STATS | jq -r '.vehicles // "N/A"')"
  echo "- Images: $(echo $DB_STATS | jq -r '.images // "N/A"')"
  echo "- Comments: $(echo $DB_STATS | jq -r '.comments // "N/A"')"
  echo "- Nuke estimates: $(echo $DB_STATS | jq -r '.nuke_estimates // "N/A"') ($(echo $DB_STATS | jq -r '.details.valuations.coverage_pct // "?"')%)"
  echo ""
else
  echo "- **CRITICAL**: db-stats endpoint failed"
  echo ""
fi

# 2. Queue Status (via direct psql)
echo "### Queue Health"
QUEUE_STATUS=$(PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -c "
SELECT json_build_object(
  'pending', count(*) FILTER (WHERE status = 'pending'),
  'processing', count(*) FILTER (WHERE status IN ('processing', 'pending_review', 'pending_strategy')),
  'failed', count(*) FILTER (WHERE status = 'failed'),
  'stale_locks', count(*) FILTER (WHERE locked_at < now() - interval '30 minutes' AND locked_by IS NOT NULL AND status NOT IN ('complete', 'skipped', 'failed'))
) FROM import_queue;
" 2>/dev/null)

if [ $? -eq 0 ]; then
  echo "- Pending: $(echo $QUEUE_STATUS | jq -r '.pending')"
  echo "- Processing: $(echo $QUEUE_STATUS | jq -r '.processing')"
  echo "- Failed: $(echo $QUEUE_STATUS | jq -r '.failed')"
  STALE=$(echo $QUEUE_STATUS | jq -r '.stale_locks')
  if [ "$STALE" -gt 0 ] 2>/dev/null; then
    echo "- **WARNING**: $STALE stale locks detected"
  else
    echo "- Stale locks: 0"
  fi
  echo ""
else
  echo "- **WARNING**: Could not query import_queue"
  echo ""
fi

# 2b. Listing Artery — the check that was missing on 2026-07-13.
# No feed polled for 13 days while cron 419 fired every 15 min and reported
# success the whole time: `SELECT net.http_post(...)` returns "1 row" no matter
# what the HTTP call does, so the success was of QUEUEING, not of polling.
# Nothing in this report looked at listing_feeds, so the artery died silently.
# Success is rows landed, not exit 0 — hence both the poll clock and throughput.
echo "### Listing Artery"
ARTERY=$(PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -c "
SELECT json_build_object(
  'minutes_since_poll', (SELECT round(extract(epoch FROM now() - max(last_polled_at))/60)::int FROM listing_feeds),
  'enabled', (SELECT count(*) FROM listing_feeds WHERE enabled),
  'polled_1h', (SELECT count(*) FROM listing_feeds WHERE enabled AND last_polled_at > now() - interval '1 hour'),
  'stalled_7d', (SELECT count(*) FROM listing_feeds WHERE enabled AND (last_polled_at IS NULL OR last_polled_at < now() - interval '7 days')),
  'vehicles_24h', (SELECT count(*) FROM vehicles WHERE created_at > now() - interval '24 hours'),
  'erroring', (SELECT count(*) FROM listing_feeds WHERE enabled AND last_error IS NOT NULL)
);
" 2>/dev/null)

ARTERY_ALERT=""
if [ $? -eq 0 ] && [ -n "$ARTERY" ]; then
  MINS=$(echo "$ARTERY" | jq -r '.minutes_since_poll // 99999')
  POLLED_1H=$(echo "$ARTERY" | jq -r '.polled_1h')
  STALLED=$(echo "$ARTERY" | jq -r '.stalled_7d')
  V24=$(echo "$ARTERY" | jq -r '.vehicles_24h')
  ERRORING=$(echo "$ARTERY" | jq -r '.erroring')
  echo "- Enabled feeds: $(echo "$ARTERY" | jq -r '.enabled') (polled in last hour: $POLLED_1H)"
  echo "- Vehicles created in 24h: $V24"
  # The artery is a clock: if the newest poll across ALL feeds is over an hour
  # old, the 15-min cron is not doing work no matter what its SQL returned.
  if [ "$MINS" -gt 60 ] 2>/dev/null; then
    echo "- **CRITICAL**: no feed polled in ${MINS} minutes — artery stopped"
    ARTERY_ALERT="ARTERY STOPPED ${MINS}m"
  else
    echo "- Last poll: ${MINS}m ago"
  fi
  # Throughput, not just liveness — feeds can "poll" and ingest nothing.
  if [ "$V24" -eq 0 ] 2>/dev/null; then
    echo "- **CRITICAL**: 0 vehicles created in 24h — polling but nothing lands"
    ARTERY_ALERT="${ARTERY_ALERT:+$ARTERY_ALERT, }0 vehicles/24h"
  fi
  # Head-of-line block signature: the sweep is oldest-first, so a feed left
  # behind for a week means something ahead of it is not finishing.
  [ "$STALLED" -gt 0 ] 2>/dev/null && echo "- **WARNING**: $STALLED enabled feeds not polled in 7 days"
  [ "$ERRORING" -gt 0 ] 2>/dev/null && echo "- Feeds carrying last_error: $ERRORING"
  echo ""
else
  echo "- **WARNING**: Could not query listing_feeds"
  echo ""
fi

# 3. Database Health
echo "### Database Health"
DB_HEALTH=$(PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -c "
SELECT json_build_object(
  'active_connections', (SELECT count(*) FROM pg_stat_activity WHERE state = 'active'),
  'lock_waiters', (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'),
  'long_queries', (SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '60 seconds')
);
" 2>/dev/null)

if [ $? -eq 0 ]; then
  CONNS=$(echo $DB_HEALTH | jq -r '.active_connections')
  LOCKS=$(echo $DB_HEALTH | jq -r '.lock_waiters')
  LONG=$(echo $DB_HEALTH | jq -r '.long_queries')
  echo "- Active connections: $CONNS"
  [ "$LOCKS" -gt 0 ] 2>/dev/null && echo "- **CRITICAL**: $LOCKS lock waiters!" || echo "- Lock waiters: 0"
  [ "$LONG" -gt 0 ] 2>/dev/null && echo "- **WARNING**: $LONG queries running > 60s" || echo "- Long queries: 0"
  echo ""
else
  echo "- **WARNING**: Could not check database health"
  echo ""
fi

# 4. Edge Function Errors (last 24h via coordinator)
echo "### Coordinator Brief"
BRIEF=$(curl -s -X POST "$SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "brief"}' 2>/dev/null)

if echo "$BRIEF" | jq . >/dev/null 2>&1; then
  echo '```'
  echo "$BRIEF" | jq -r '.summary // .message // "No summary available"' 2>/dev/null || echo "Brief returned non-standard format"
  echo '```'
else
  echo "- Coordinator brief: unavailable"
fi

echo ""

# 5. Frontend
echo "### Frontend"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://nuke.ag" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
  echo "- nuke.ag: OK (HTTP $HTTP_CODE)"
else
  echo "- **WARNING**: nuke.ag returned HTTP $HTTP_CODE"
fi

echo ""
echo "---"
echo "*Generated by morning-health-check.sh*"

# Send Telegram summary
V_COUNT=$(echo "${DB_STATS:-{}}" | jq -r '.vehicles // "?"' 2>/dev/null || echo "?")
Q_PENDING=$(echo "${QUEUE_STATUS:-{}}" | jq -r '.pending // "?"' 2>/dev/null || echo "?")
L_WAITERS=$(echo "${DB_HEALTH:-{}}" | jq -r '.lock_waiters // "?"' 2>/dev/null || echo "?")
if [ -n "$ARTERY_ALERT" ]; then
  # Escalate: a stopped artery is the failure that ran 13 days unnoticed.
  /Users/skylar/bin/claude-notify --alert "critical" "ARTERY: ${ARTERY_ALERT} — listings not flowing. Vehicles=${V_COUNT}, Queue pending=${Q_PENDING}" 2>/dev/null || true
else
  /Users/skylar/bin/claude-notify --alert "info" "Morning health: Vehicles=${V_COUNT}, Queue pending=${Q_PENDING}, Locks=${L_WAITERS}, Frontend=HTTP ${HTTP_CODE:-?}, Artery=${POLLED_1H:-?} feeds/hr" 2>/dev/null || true
fi
