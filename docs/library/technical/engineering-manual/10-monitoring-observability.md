# Chapter 10: Monitoring and Observability

## What This Subsystem Does

Monitoring answers one question: is the system working? The platform has no centralized observability stack (no Grafana, no Datadog). Instead, it uses a combination of database views, edge function health endpoints, shell scripts, cron jobs, and agent-written reports. This chapter documents every monitoring surface and the decision trees for diagnosing failures.

---

## Health Check Endpoints

### db-stats

**Location:** `supabase/functions/db-stats/index.ts`

The primary health endpoint. Returns a comprehensive JSON snapshot of database state in a single call using 4 parallel Postgres connections for maximum speed.

```bash
curl -s "$SUPABASE_URL/functions/v1/db-stats" \
  -H "Authorization: Bearer $SERVICE_KEY" | jq
```

Returns:
- **Table row estimates** (via `pg_class.reltuples`): vehicles, vehicle_images, vehicle_observations, auction_comments, nuke_estimates, bat_user_profiles, import_queue, source_targets, external_identities, comment_discoveries, description_discoveries, vehicle_events
- **Queue stats**: import_queue grouped by status (pending, processing, complete, failed, skipped)
- **Vehicle events by platform**: source_platform counts with comment coverage
- **Vehicles by source**: per-source totals with description coverage percentages
- **Listing page snapshots**: per-platform snapshot counts and success rates
- **Identity claims**: external identities total, claimed, unclaimed
- **AI analysis**: comment_discoveries + description_discoveries counts

The function uses `pg_class` row estimates for large tables (avoiding slow `COUNT(*)`) and exact counts only for small tables.

### ralph-wiggum-rlm-extraction-coordinator

**Location:** `supabase/functions/ralph-wiggum-rlm-extraction-coordinator/index.ts`

The coordination brief endpoint. Provides queue health, top failing domains, error patterns, source staleness, and recommended next actions.

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "brief"}' | jq
```

Returns a structured brief with:
- Queue health snapshot
- Top failing domains with error pattern categorization
- Source mapping and scrape staleness
- Recommended next actions (human-readable)

---

## Queue Health

### queue_lock_health View

A live view that shows current lock state across all queue tables:

```sql
SELECT * FROM queue_lock_health;
```

Returns one row per queue table with active locks:

| Column | Description |
|--------|-------------|
| `table_name` | Queue table name (`import_queue`, `bat_extraction_queue`, `document_ocr_queue`) |
| `locked_count` | Total records currently locked (status = processing) |
| `stale_count` | Records locked for more than 30 minutes |
| `oldest_lock` | Timestamp of the oldest active lock |
| `newest_lock` | Timestamp of the most recent lock |

**Alert condition:** `stale_count > 0` means something crashed mid-processing. Run `release_stale_locks()`.

### release_stale_locks()

PostgreSQL function that reclaims stuck queue records across all queue tables:

```sql
-- Preview what would be released (safe, read-only)
SELECT * FROM release_stale_locks(dry_run := true);

-- Release all locks older than 30 minutes (default threshold)
SELECT * FROM release_stale_locks();

-- Release locks older than 1 hour
SELECT * FROM release_stale_locks(stale_threshold_minutes := 60);
```

The function covers four tables:
1. `import_queue` -- resets `status` from `processing` to `pending`
2. `bat_extraction_queue` -- same pattern
3. `document_ocr_queue` -- resets from `classifying`/`extracting`/`linking` to `pending`
4. `vehicle_images` -- resets `ai_processing_status` from `processing` to `pending`

Returns a table showing: queue name, count released, oldest lock timestamp, sample IDs.

### Stale Lock Cron

Job 188 runs `release_stale_locks()` hourly as a safety net. The effective worst-case stuck time is 90 minutes (30 minutes until stale threshold + up to 60 minutes until the next cron run).

```sql
-- Check the cron job
SELECT jobid, schedule, active, jobname
FROM cron.job
WHERE jobname ILIKE '%stale%';
```

### Queue Status Query

For a quick import_queue breakdown:

```sql
SELECT status, count(*) as cnt
FROM import_queue
GROUP BY status
ORDER BY cnt DESC;
```

---

## Identity Engagement Stats

`identity_engagement_stats` is a materialized view that pre-computes per-handle engagement metrics across all external identities:

| Column | Description |
|--------|-------------|
| `identity_id` | FK to external_identities |
| `total_comments` | Total comments posted |
| `vehicles_commented_on` | Distinct vehicles engaged with |
| `total_bids` | Total bids placed |
| `highest_bid` | Maximum bid amount |
| `total_likes_received` | Community endorsement count |
| `avg_expertise_score` | Derived expertise rating |
| `first_activity` | Earliest known activity |
| `last_activity` | Most recent activity |
| `active_months` | Count of distinct active months |
| `seller_comments` | Comments on own listings |

Used by the MCP connector to show identity preview data when linking external handles to user profiles.

```sql
-- Refresh the view (safe to run concurrently)
REFRESH MATERIALIZED VIEW CONCURRENTLY identity_engagement_stats;
```

---

## Expected Daily Throughput

These are baseline minimums. Falling below them for 48+ hours indicates a problem.

| Source | Metric | Expected Minimum | How to Check |
|--------|--------|-------------------|-------------|
| BaT | New URLs discovered | 20/day | `SELECT count(*) FROM import_queue WHERE listing_url ILIKE '%bringatrailer%' AND created_at > now() - interval '24 hours'` |
| Cars & Bids | New URLs discovered | 5/day | Same pattern with `%carsandbids%` |
| Collecting Cars | New URLs discovered | 3/day | Same pattern with `%collectingcars%` |
| Craigslist | New URLs discovered | 10/day (when running) | Check `craigslist_listing_queue` |
| KSL | New URLs discovered | 10/day | Same pattern with `%ksl%` |
| FB Marketplace | New vehicles per sweep | 50+ (when running) | Check `marketplace_listings` recent rows |
| Vehicles created | Total across all sources | 10/day | `SELECT count(*) FROM vehicles WHERE created_at > now() - interval '24 hours'` |
| Comments extracted | BaT comments | 100/day (when backfill active) | `SELECT count(*) FROM auction_comments WHERE created_at > now() - interval '24 hours'` |
| Import queue processed | Items completed | 20/day | `SELECT count(*) FROM import_queue WHERE status = 'complete' AND processed_at > now() - interval '24 hours'` |

---

## Alert Conditions

There is no automated alerting system. These conditions should be checked by health check scripts or agent sessions.

| Condition | Severity | Check |
|-----------|----------|-------|
| Source dead (0 new items in 48h) | WARNING | `SELECT source_slug, max(last_polled_at) FROM listing_feeds WHERE enabled GROUP BY source_slug HAVING max(last_polled_at) < now() - interval '48 hours'` |
| Queue backlog (>10K pending) | WARNING | `SELECT count(*) FROM import_queue WHERE status = 'pending'` |
| Stale locks (>0) | WARNING | `SELECT * FROM queue_lock_health WHERE stale_count > 0` |
| Feed poll failures (error_count > 5) | WARNING | `SELECT display_name, error_count, last_error FROM listing_feeds WHERE error_count > 5 AND enabled` |
| Lock waiters (>0) | CRITICAL | `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'` |
| Long queries (>60s) | CRITICAL | `SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '60 seconds'` |
| Frontend down | CRITICAL | `curl -s -o /dev/null -w "%{http_code}" https://nuke.ag` (should return 200) |
| db-stats endpoint fails | CRITICAL | Non-200 response from `/functions/v1/db-stats` |

---

## Cron Job Monitoring

Query the pg_cron run history to find failures:

```sql
-- Failed cron jobs in the last 24 hours
SELECT
  j.jobname,
  jrd.status,
  jrd.start_time,
  jrd.end_time,
  jrd.return_message
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE jrd.start_time > now() - interval '24 hours'
  AND jrd.status = 'failed'
ORDER BY jrd.start_time DESC
LIMIT 20;

-- Job success rate by job
SELECT
  j.jobname,
  count(*) FILTER (WHERE jrd.status = 'succeeded') as succeeded,
  count(*) FILTER (WHERE jrd.status = 'failed') as failed,
  max(jrd.start_time) as last_run
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE jrd.start_time > now() - interval '7 days'
GROUP BY j.jobname
HAVING count(*) FILTER (WHERE jrd.status = 'failed') > 0
ORDER BY failed DESC;

-- All active cron jobs with their schedules
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE active = true
ORDER BY jobname;
```

---

## Cost Monitoring

The system has no dedicated cost tracking dashboard. Costs are estimated from usage patterns.

| Component | Unit Cost | Expected Daily Usage | Daily Cost |
|-----------|-----------|---------------------|------------|
| Firecrawl scrapes | ~$0.01/scrape | ~100-300 scrapes | $1-3 |
| Claude Haiku extraction | ~$0.001/call | ~50-200 calls | $0.05-0.20 |
| Claude Sonnet (when used) | ~$0.01/call | ~5-20 calls | $0.05-0.20 |
| Supabase (Pro plan) | Fixed | N/A | ~$25/month base |
| Supabase egress/storage | Variable | Depends on snapshot volume | $2-5/day |
| **Total pipeline** | | | **~$5-10/day** |

To track Firecrawl usage, check the Firecrawl dashboard or count successful scrapes:

```sql
SELECT
  date_trunc('day', fetched_at) as day,
  count(*) as total_scrapes,
  count(*) FILTER (WHERE fetch_method = 'firecrawl') as firecrawl_scrapes,
  count(*) FILTER (WHERE success) as successful
FROM listing_page_snapshots
WHERE fetched_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;
```

---

## How to Diagnose a Dead Pipeline

### No new BaT vehicles today?

```
1. Check listing_feeds: is BaT feed enabled? last_polled_at recent?
   SELECT display_name, enabled, last_polled_at, error_count, last_error
   FROM listing_feeds WHERE source_slug = 'bat';

2. Check import_queue: any BaT URLs pending?
   SELECT status, count(*)
   FROM import_queue
   WHERE listing_url ILIKE '%bringatrailer%'
     AND created_at > now() - interval '48 hours'
   GROUP BY status;

3. Check process-import-queue cron: running? errors?
   SELECT jrd.status, jrd.start_time, jrd.return_message
   FROM cron.job_run_details jrd
   JOIN cron.job j ON j.jobid = jrd.jobid
   WHERE j.jobname ILIKE '%import%' OR j.jobname ILIKE '%queue%'
   ORDER BY jrd.start_time DESC LIMIT 10;

4. Check for stale locks:
   SELECT * FROM queue_lock_health;
   SELECT * FROM release_stale_locks(dry_run := true);

5. Check if extraction is rate-limited:
   SELECT failure_category, count(*)
   FROM import_queue
   WHERE listing_url ILIKE '%bringatrailer%'
     AND status IN ('pending', 'failed')
     AND updated_at > now() - interval '24 hours'
   GROUP BY failure_category;

6. Check archiveFetch: are snapshots being saved?
   SELECT platform, count(*), count(*) FILTER (WHERE success) as ok
   FROM listing_page_snapshots
   WHERE fetched_at > now() - interval '24 hours'
     AND platform = 'bat'
   GROUP BY platform;
```

### No new vehicles from any source?

```
1. Is process-import-queue running at all?
   SELECT * FROM queue_lock_health;
   -- If locked_count > 0 with recent newest_lock, it's running.
   -- If locked_count = 0 and pending items exist, the cron may be disabled.

2. Are there pending items in the queue?
   SELECT status, count(*) FROM import_queue GROUP BY status;
   -- If pending = 0, the discovery system is the problem (Chapter 9).
   -- If pending > 0, the extraction system is the problem.

3. Check for database locks blocking the pipeline:
   SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';
   -- If > 0, something is blocking. Investigate with:
   SELECT pid, state, wait_event_type, left(query, 100) as query
   FROM pg_stat_activity
   WHERE wait_event_type = 'Lock';

4. Check edge function logs for errors:
   -- Use Supabase MCP: get_logs with service "edge-function"
   -- Or check the Supabase dashboard > Edge Functions > Logs
```

### Queue growing but nothing completing?

```
1. Items are being claimed but never released:
   SELECT locked_by, locked_at, now() - locked_at as age
   FROM import_queue
   WHERE status = 'processing'
   ORDER BY locked_at ASC
   LIMIT 10;

2. If all locks are stale (>30 min old):
   SELECT * FROM release_stale_locks();
   -- Then check what's killing the workers.

3. If locks are fresh but items never complete:
   -- The extractor is failing silently.
   -- Check edge function logs for the specific extractor.

4. If the queue is growing faster than extraction:
   -- Increase batch_size in process-import-queue invocation
   -- Or run additional concurrent invocations
```

---

## Agent Reports

The platform uses agent-written markdown reports for observability. Health check scripts and Claude Code scheduled tasks write reports to `.claude/` for consumption by other agents.

| File | Written By | Content |
|------|-----------|---------|
| `.claude/HEALTH_REPORT.md` | `scripts/scheduled/morning-health-check.sh` | Daily health: DB stats, queue status, lock waiters, coordinator brief, frontend status |
| `.claude/SMOKE_TEST.md` | `.claude-plugin/skills/smoke-test.md` | On-demand: end-to-end test of key functions |
| `.claude/HANDOFF.md` | Any agent via `claude-handoff` | Session handoff notes for agent continuity |

### Morning Health Check

**Location:** `scripts/scheduled/morning-health-check.sh`

Runs daily (designed for Claude Code scheduled tasks). Outputs a severity-rated report:

```bash
dotenvx run -- bash scripts/scheduled/morning-health-check.sh
```

The script:
1. Calls `db-stats` endpoint for platform statistics
2. Queries `import_queue` directly via psql for queue health and stale locks
3. Queries `pg_stat_activity` for connection count, lock waiters, long queries
4. Calls `ralph-wiggum-rlm-extraction-coordinator` for a coordination brief
5. Checks `https://nuke.ag` HTTP status
6. Sends a one-line Telegram summary via `claude-notify`

Output is written to `.claude/HEALTH_REPORT.md` in this format:

```
## Nuke Health Report -- 2026-03-20 08:00

### Platform Stats
- Vehicles: 141234
- Images: 1023456
- Comments: 364000
- Nuke estimates: 5678 (4.0%)

### Queue Health
- Pending: 234
- Processing: 5
- Failed: 12
- Stale locks: 0

### Database Health
- Active connections: 8
- Lock waiters: 0
- Long queries: 0

### Coordinator Brief
[structured brief output]

### Frontend
- nuke.ag: OK (HTTP 200)
```

---

## Known Problems

1. **No automated alerting.** All monitoring is pull-based. If nobody runs the health check, nobody sees the problem. A push-based alert system (Telegram bot, email, PagerDuty) that fires on critical conditions would catch outages faster.

2. **No historical metrics storage.** Health check results are overwritten each run. There is no time-series data to show trends (queue growing over time, extraction rate declining, error rate increasing). A simple `health_snapshots` table with periodic inserts would enable trend analysis.

3. **Firecrawl cost tracking is approximate.** There is no direct integration with the Firecrawl billing API. Cost estimates come from counting `listing_page_snapshots` rows with `fetch_method = 'firecrawl'`, which does not account for failed scrapes that still consume credits.

4. **No discovery throughput materialized view.** The chapter spec calls for a `discovery_throughput` view (day x source -> urls_queued, extracted, failed). This view does not exist in the current database. The closest equivalent is manual queries against `import_queue` grouped by date and source URL pattern.

5. **No discovery health check function.** There is no deployed `discovery-health-check` edge function. Discovery health must be assessed manually by checking `listing_feeds` last_polled_at timestamps and counting recent `import_queue` inserts per source.

6. **Cron job run details retention.** pg_cron's `job_run_details` table is not automatically pruned. On long-running instances, it can grow to millions of rows and slow down monitoring queries. A periodic cleanup of rows older than 30 days is recommended:

   ```sql
   DELETE FROM cron.job_run_details WHERE end_time < now() - interval '30 days';
   ```

7. **Agent report freshness is not validated.** `.claude/HEALTH_REPORT.md` has a timestamp in its header, but nothing checks whether the report is stale. An agent reading a 3-day-old report might assume the system is healthy when it has since failed.
