# /nuke-ops:debug-extraction

Debug extraction pipeline issues. Use when vehicles aren't extracting properly, queue is stuck, or data quality drops.

## Instructions

### 1. Identify the Problem Scope
```sql
-- Check extraction queue state
SELECT status, count(*),
  min(updated_at) as oldest,
  max(updated_at) as newest
FROM import_queue
GROUP BY status ORDER BY count DESC;

-- Check for stale locks
SELECT * FROM release_stale_locks(dry_run := true);

-- Recent extraction errors
SELECT source_url, error_message, updated_at
FROM import_queue
WHERE status = 'failed'
ORDER BY updated_at DESC LIMIT 20;
```

### 2. Check Agent Hierarchy State
```sql
-- Are crons running?
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('agent-tier-router', 'haiku-extraction-worker', 'sonnet-supervisor');

-- Recent agent activity
SELECT status, count(*), max(updated_at) as last_activity
FROM import_queue
WHERE updated_at > now() - interval '1 hour'
GROUP BY status;
```

### 3. Check Anthropic API Credits
```bash
cd /Users/skylar/nuke && dotenvx run -- bash -c 'echo "Key starts with: ${ANTHROPIC_API_KEY:0:10}..."'
```
If the key is exhausted, extraction will silently fail. Check Supabase secrets too:
```bash
supabase secrets list | grep ANTHROPIC
```

### 4. Check archiveFetch Cache
```sql
-- How many snapshots have inline HTML vs storage-migrated?
SELECT
  count(*) as total,
  count(html) as has_inline_html,
  count(html_storage_path) as has_storage_html,
  count(*) FILTER (WHERE html IS NULL AND html_storage_path IS NULL) as no_html_at_all
FROM listing_page_snapshots
WHERE created_at > now() - interval '7 days';
```

### 5. Test a Single Extraction
Pick a failed item and trace it:
```sql
SELECT id, source_url, status, error_message, locked_by, locked_at
FROM import_queue WHERE status = 'failed' LIMIT 1;
```
Then manually invoke the appropriate extractor on that URL and trace the error.

### 6. Report
Output findings with:
- Root cause identified (or top 3 hypotheses)
- Specific fix action
- Whether it's a code fix, config fix, or data fix
- Update HANDOFF.md with findings
