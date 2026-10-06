# Chapter 6: Database Operations

## What This Subsystem Does

The database is a Supabase-managed PostgreSQL instance. It is the foundation of the entire platform -- every vehicle record, observation, image reference, extraction result, and analysis signal lives here. Operating it safely requires discipline: batching large writes, respecting statement timeouts, checking for lock cascades, and never running DDL while active queries are in flight. This chapter documents every operational procedure and the hard rules that prevent the outages and data corruption that plagued the system before the March 2026 triage.

---

## Hard Rules

These rules exist because every one of them was learned from an actual incident. Violating them caused API outages, data corruption, or runaway costs.

### Rule 1: Batch All Large Writes

**Never run unbounded UPDATE/DELETE on large tables.**

On 2026-02-27, a single `UPDATE vehicles SET auction_source = ...` ran for 30+ minutes, blocked PostgREST schema cache reload, and caused a full API outage (PGRST002) across all REST endpoints.

```sql
-- WRONG: locks entire table for 30+ minutes
UPDATE vehicles SET auction_source = 'barrett-jackson'
WHERE auction_source = 'Barrett-Jackson';

-- RIGHT: batch in chunks
DO $$
DECLARE batch_size INT := 1000; affected INT;
BEGIN
  LOOP
    UPDATE vehicles SET auction_source = 'barrett-jackson'
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE auction_source = 'Barrett-Jackson'
      LIMIT batch_size
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);  -- Let autovacuum and other queries breathe
  END LOOP;
END $$;
```

The 1,000-row batch size is deliberate. On the `vehicles` table (~1.2M rows), batches of 1,000 complete in under 1 second each. The `pg_sleep(0.1)` between batches prevents lock starvation.

### Rule 2: Respect Statement Timeouts

**Never set `statement_timeout` above 120 seconds.**

| Role | Timeout | Why |
|------|---------|-----|
| `postgres` | 120s | Enforces batching rule |
| `anon` | 15s | Protects public REST API from slow queries |
| `authenticated` | 15s | Protects authenticated REST API |
| `authenticator` | 15s | PostgREST connection role |

If a migration needs longer than 120 seconds, it MUST be batched. The only exception is the `dedup-vehicles` function, which uses a direct Postgres connection (bypassing PostgREST) and sets its own timeout.

### Rule 3: Check Lock Impact After Every Write

**After EVERY SQL write, check your lock impact:**

```sql
SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';
```

If the count is > 0, you caused a lock cascade. Stop and investigate:

```sql
-- See what's waiting on what
SELECT
  blocked.pid AS blocked_pid,
  blocked.query AS blocked_query,
  blocking.pid AS blocking_pid,
  blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid
JOIN pg_locks l ON l.locktype = bl.locktype
  AND l.database = bl.database
  AND l.relation = bl.relation
  AND l.page = bl.page
  AND l.tuple = bl.tuple
  AND l.pid != bl.pid
JOIN pg_stat_activity blocking ON blocking.pid = l.pid
WHERE blocked.wait_event_type = 'Lock';
```

### Rule 4: No DDL While Queries Are Active

**Do not run DDL (CREATE INDEX, ALTER TABLE, DROP) while other queries are active on the same table.**

Check first:

```sql
SELECT count(*) FROM pg_stat_activity
WHERE state = 'active'
AND query ILIKE '%vehicles%';
```

If count > 2, WAIT. DDL acquires AccessExclusiveLock which blocks ALL reads and writes on the table.

### Rule 5: No Duplicate Analytics Queries

**Before running `count(*)` or heavy SELECTs, check if someone else is already running one:**

```sql
SELECT left(query, 80) FROM pg_stat_activity
WHERE state = 'active'
AND pid != pg_backend_pid();
```

Two agents running `SELECT count(*) FROM vehicles` simultaneously wastes resources and can trigger lock contention.

### Rule 6: PostgREST Schema Reload

**If you break PostgREST (PGRST002 errors), fix it:**

```sql
NOTIFY pgrst, 'reload schema';
```

PostgREST caches the database schema. After DDL changes (new tables, new columns, altered types), the cache is stale. The `NOTIFY` command forces an immediate reload.

This also happens automatically after running migrations through the Supabase MCP, but if you ran raw DDL, you need to trigger it manually.

---

## Pipeline Registry

The `pipeline_registry` table maps every computed field to the function that owns it. This prevents multiple agents from writing to the same field with different logic.

### Querying Ownership

```sql
-- Who owns a field?
SELECT owned_by, description, do_not_write_directly
FROM pipeline_registry
WHERE table_name = 'vehicles' AND column_name = 'nuke_estimate';

-- What does a function write?
SELECT table_name, column_name, description
FROM pipeline_registry
WHERE owned_by = 'compute-vehicle-valuation';

-- All protected fields
SELECT table_name, column_name, owned_by, write_via
FROM pipeline_registry
WHERE do_not_write_directly = true
ORDER BY table_name, column_name;
```

### Protected Fields (Never Write Directly)

These fields are computed by specific pipeline functions. Writing to them directly creates data forks:

| Field | Owned By |
|-------|----------|
| `vehicles.nuke_estimate` | `compute-vehicle-valuation` |
| `vehicles.nuke_estimate_confidence` | `compute-vehicle-valuation` |
| `vehicles.signal_score` | `analyze-market-signals` |
| `vehicles.completion_percentage` | `calculate-profile-completeness` |
| `vehicles.quality_grade` | `calculate-vehicle-scores` |
| `vehicle_images.ai_processing_status` | `photo-pipeline-orchestrator` |
| `vehicle_images.ai_caption` | `photo-pipeline-orchestrator` |

---

## Migration Procedures

### Applying a Migration via Supabase MCP

The preferred method is using the Supabase MCP tool:

```
mcp__supabase__apply_migration({
  project_id: "qkgaybvrernstplzjaam",
  name: "add_vehicle_fingerprint",
  query: "ALTER TABLE vehicles ADD COLUMN fingerprint TEXT;"
})
```

### Applying via CLI

```bash
cd /Users/skylar/nuke

# Create a new migration file
supabase migration new add_vehicle_fingerprint

# Edit the file
# supabase/migrations/<timestamp>_add_vehicle_fingerprint.sql

# Apply locally (if using local dev)
supabase db push

# Apply to production
supabase db push --db-url "$SUPABASE_DB_URL"
```

### Migration Safety Checklist

Before applying any migration:

1. **Check active queries** on affected tables
2. **Estimate row count** of affected table
3. **If > 10,000 rows affected**, batch the operation
4. **If DDL** (CREATE INDEX, ALTER TABLE), use `CONCURRENTLY` where possible
5. **After DDL**, run `NOTIFY pgrst, 'reload schema'`
6. **After large writes**, check lock impact
7. **After large writes**, run VACUUM on affected table

### Creating Indexes Safely

```sql
-- WRONG: blocks all reads/writes during creation
CREATE INDEX idx_vehicles_make ON vehicles (make);

-- RIGHT: allows reads/writes during creation (slower but non-blocking)
CREATE INDEX CONCURRENTLY idx_vehicles_make ON vehicles (make);
```

Note: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.

---

## Vacuum Procedures

After large deletes or updates, Postgres needs to reclaim space. The autovacuum daemon handles this normally, but after bulk operations (like the March 2026 delete of 56K+ vehicles), manual vacuuming is needed.

### Check Vacuum Status

```sql
SELECT
  relname,
  n_dead_tup,
  n_live_tup,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 10000
ORDER BY n_dead_tup DESC;
```

### Run Manual Vacuum

```sql
-- Standard vacuum (reclaims space for reuse, does not return to OS)
VACUUM vehicles;

-- Verbose vacuum (shows progress)
VACUUM VERBOSE vehicles;

-- Full vacuum (compacts table, returns space to OS, but locks table exclusively)
-- ONLY use during maintenance windows
VACUUM FULL vehicles;
```

### Vacuum After Bulk Deletes

The March 2026 triage deleted 56K+ vehicles (8,056 'deleted' + 48,305 'merged') plus 1.97M child rows. After bulk deletes of this scale:

```sql
-- 1. Vacuum the parent table
VACUUM vehicles;

-- 2. Vacuum all affected child tables
VACUUM vehicle_images;
VACUUM status_metadata;
VACUUM detection_jobs;
VACUUM price_history;

-- 3. Analyze to update query planner statistics
ANALYZE vehicles;
ANALYZE vehicle_images;
```

---

## Stale Lock Management

### Check for Stale Locks

```sql
-- Use the built-in function
SELECT release_stale_locks(dry_run := true);
```

This returns a list of locked records across all queue tables that have been locked for more than 30 minutes.

### Release Stale Locks

```sql
SELECT release_stale_locks();
```

### View Lock Health

```sql
SELECT * FROM queue_lock_health;
```

This view shows:
- Total locked records per table
- Number of stale locks (> 30 minutes old)
- Oldest lock timestamp
- Worker IDs holding locks

---

## Query Safety Patterns

### Safe Count

Do not run `SELECT count(*) FROM vehicles` -- it does a full table scan on 1.2M rows. Use estimated counts:

```sql
-- Fast approximate count (from pg_class)
SELECT reltuples::bigint AS estimate
FROM pg_class WHERE relname = 'vehicles';

-- Or use the db-stats edge function which caches counts
```

### Safe Existence Check

```sql
-- WRONG: scans entire table
SELECT count(*) FROM vehicles WHERE vin = 'ABC123';

-- RIGHT: stops after first match
SELECT EXISTS(SELECT 1 FROM vehicles WHERE vin = 'ABC123');
```

### Safe Pagination

```sql
-- WRONG: OFFSET causes sequential scan of skipped rows
SELECT * FROM vehicles ORDER BY created_at LIMIT 100 OFFSET 100000;

-- RIGHT: cursor-based pagination
SELECT * FROM vehicles
WHERE created_at < '2024-01-15T00:00:00Z'
ORDER BY created_at DESC
LIMIT 100;
```

---

## How to Build the Database Operations Infrastructure from Scratch

### Step 1: Set Statement Timeouts

```sql
ALTER ROLE postgres SET statement_timeout = '120s';
ALTER ROLE anon SET statement_timeout = '15s';
ALTER ROLE authenticated SET statement_timeout = '15s';
ALTER ROLE authenticator SET statement_timeout = '15s';
```

### Step 2: Create the Pipeline Registry

```sql
CREATE TABLE pipeline_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  owned_by TEXT NOT NULL,
  description TEXT,
  do_not_write_directly BOOLEAN DEFAULT false,
  write_via TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(table_name, column_name)
);

-- Seed with critical entries
INSERT INTO pipeline_registry (table_name, column_name, owned_by, do_not_write_directly, write_via, description) VALUES
  ('vehicles', 'nuke_estimate', 'compute-vehicle-valuation', true, 'compute-vehicle-valuation', 'AI-computed valuation'),
  ('vehicles', 'signal_score', 'analyze-market-signals', true, 'analyze-market-signals', 'Market signal composite'),
  ('vehicle_images', 'ai_processing_status', 'photo-pipeline-orchestrator', true, 'photo-pipeline-orchestrator', 'AI processing state');
```

### Step 3: Create Lock Management Functions

```sql
CREATE OR REPLACE FUNCTION release_stale_locks(dry_run BOOLEAN DEFAULT false)
RETURNS TABLE(table_name TEXT, record_id UUID, locked_by TEXT, locked_at TIMESTAMPTZ, age INTERVAL) AS $$
DECLARE
  queue_tables TEXT[] := ARRAY['import_queue', 'bat_extraction_queue', 'document_ocr_queue'];
  tbl TEXT;
  stale_count INT := 0;
BEGIN
  FOREACH tbl IN ARRAY queue_tables LOOP
    IF NOT dry_run THEN
      EXECUTE format(
        'UPDATE %I SET locked_by = NULL, locked_at = NULL, status = ''pending''
         WHERE locked_at < now() - interval ''30 minutes''
         AND status = ''processing''',
        tbl
      );
      GET DIAGNOSTICS stale_count = ROW_COUNT;
    END IF;

    RETURN QUERY EXECUTE format(
      'SELECT %L::text, id, locked_by, locked_at, now() - locked_at
       FROM %I
       WHERE locked_at < now() - interval ''30 minutes''
       AND locked_by IS NOT NULL',
      tbl, tbl
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

### Step 4: Create Queue Lock Health View

```sql
CREATE OR REPLACE VIEW queue_lock_health AS
SELECT
  'import_queue' AS table_name,
  count(*) FILTER (WHERE locked_by IS NOT NULL) AS total_locked,
  count(*) FILTER (WHERE locked_at < now() - interval '30 minutes') AS stale_locked,
  min(locked_at) FILTER (WHERE locked_by IS NOT NULL) AS oldest_lock,
  count(*) FILTER (WHERE status = 'pending') AS pending,
  count(*) FILTER (WHERE status = 'processing') AS processing,
  count(*) FILTER (WHERE status = 'complete') AS complete,
  count(*) FILTER (WHERE status = 'failed') AS failed
FROM import_queue;
```

### Step 5: Schedule Automated Maintenance

```sql
-- Hourly stale lock release
SELECT cron.schedule('release-stale-locks', '0 * * * *', $$SELECT release_stale_locks()$$);

-- Daily vacuum of high-churn tables
SELECT cron.schedule('daily-vacuum', '0 3 * * *', $$
  VACUUM ANALYZE import_queue;
  VACUUM ANALYZE vehicle_observations;
  VACUUM ANALYZE vehicle_images;
$$);
```

---

## Known Problems

1. **No connection pooling visibility.** Supabase uses PgBouncer for connection pooling, but there is no way to see the pool state from within edge functions. Connection exhaustion manifests as timeouts with no clear error message.

2. **PostgREST schema cache invalidation is manual.** After DDL changes, the `NOTIFY pgrst, 'reload schema'` must be issued manually or by the Supabase MCP. Forgetting this causes PGRST002 errors that look like the table does not exist.

3. **No automated dead tuple monitoring.** Autovacuum handles normal operations, but after bulk deletes it can fall behind. There is no alerting when dead tuple count exceeds a threshold.

4. **The 120s timeout is a compromise.** Some legitimate operations (complex joins across multiple tables for analytics) take longer than 120 seconds. These must be run via direct Postgres connection, bypassing the safety guardrails.

5. **Pipeline registry is advisory only.** There is no database-level enforcement preventing a rogue edge function from writing to a protected field. The registry relies on agent compliance.

### Price-fact timeout post-mortem — 2026-10-04

Cold or parallel valuation requests reached the ten-second timeout; the inner plan isolated repeated sale-rule work in current price facts. PostgreSQL can fold a SQL helper's CTEs and repeat an expensive source rule for each returned field. The staged repair in `20261004212806_vehicle_price_facts_materialized_basis.sql` materializes the existing `vehicle_sale_basis` result once per selected parent inside `vehicle_price_facts`. It retains the twenty-field contract, invoker RLS, owner, grants and source rule.

Keep the legacy auction date cast in a separate inline CTE. Materializing that cast would evaluate malformed dates even when the original result never used them. The actual PostgreSQL fixture `supabase/sql/test_vehicle_price_facts_materialized_basis.sql` compares every returned field against the original helper, checks anonymous/authenticated visibility and input edge cases, and preserves both unused-date success and required-date failure. Plan contrast evidence belongs with its execution role and exact inputs; deployment and visitor latency require separate runtime verification.

### Reconcile retained testimony through its reader — 2026-10-04

An absent scalar does not prove source data was lost. Test the supplied capture/region/field through retained source, original observation, parent/property/source relations, selected fold and permitted reader. `scripts/discovery/intake-reader-reconciliation.sql` accepts at most fifty explicit inventory requests in a read-only transaction and returns separate evidence stages, clocks, relation gaps, existing owners and reproducible acceptance keys. Its fixture reuses the actual fold and reader owners across multiple source, model and observation-kind lanes. These request counts are not a source universe or fleet completeness measure.

Require the same vehicle, field, observation and reported value before calling a claim exposed. A source reference alone is insufficient; a multi-field observation with no property ID may still be legitimately folded and exposed. Stored source hashes, typed foreign keys and offload locators establish different relations: none substitutes for independently verified source bytes or episode-qualified meaning. Preserve private, conflicting, superseded, oversized and clock-unknown testimony with the reason for withholding it rather than turning those cases into missing extraction.

Inspect the original reader's bound before calling it. `get_field_provenance` returns an unbounded source array; an outer row limit does not bound work performed inside that owner. This assay leaves that path unmeasured and uses the existing bounded `get_vehicle_specs` contract. Repair a demonstrated gap through its registered owner, then repeat the same acceptance key and reader under the permitted role; this diagnostic grants no intake, replay, source fetch or production write authority.

Use the SQL files as parameterized SELECTs through an existing operator connection in `BEGIN READ ONLY`, with `SET LOCAL statement_timeout='5s'`, and finish with `ROLLBACK`. Reconciliation binds `$1::jsonb = {asOf,requests:[...]}`; each request supplies a stable key, field and established observation/capture/event/property identifiers as applicable. Parsed inventory is a caller declaration, not an admitted observation. Supply a finite evidence cutoff; current reader output does not establish historical visibility.

`scripts/discovery/configuration-catalog-relations.sql` binds `$1::jsonb` as one to fifty observation/property requests and `$2::timestamptz` as an optional finite knowledge boundary. It walks existing property, model/profile and exact OEM/library references. Its descriptor readiness measures only FK, kind and JSON shape; owner semantics, enum membership and admission require separate proof. Factory options and catalog body aliases remain candidates. Every result leaves pricing configuration unqualified and provides evidence-linked repair proposals; verify the current owner contract before acting on a dated admission rule.

Keep manifests and operator receipts private. The scripts return relation/clock/coverage diagnostics rather than source prose or field values; they are not public endpoints or general privacy classifiers. Local acceptance runs the two corresponding `*-test.sql` files in fresh disposable PG17 databases (`dm_fold_reconcile_*` and `dm_refinement_config_*`), from the repository root with `psql -X -v ON_ERROR_STOP=1`. These fixtures create synthetic tables and must never run against production. The existing listing-state CI job exercises both files in separate databases.

### Historical source-account fold missing its canonical key 2026 10 05

Forward BaT comment intake resolves the exact platform and handle, but historical `refresh_bat_user_profile` did not fill a missing identity key. A retained account fold could contain comment counts while its canonical account remained disconnected. Migration `20261005023541_repair_bat_profile_source_account_link.sql` extends that existing replay owner with the forward owner's exact lookup, preserves non-NULL keys, rejects conflicting canonical keys atomically, and declares replay alongside the existing writer registration. Its one selected repair uses the sanctioned function; source testimony and person claims remain unchanged. A source-account relation does not verify the person claiming it.

The published-buyer PG17 fixture applies this actual migration and checks the selected repair, missing keys, conflicting established keys, exact platform/case, opaque metadata and retained award metrics. The existing profile reader also uses native BaT listing records and linked seller handles, matching the track-record consumer, so an absent sparse event fold no longer hides retained listings. Its headline names the captured record grain and leaves total consignment history unknown. Frontend tests retain native records without an event and propagate reader errors instead of manufacturing zero seller activity.

### Private profile column exposure post mortem 2026 10 04

The anonymous profile API returned populated contact fields and a private tool valuation even when tool inventory publication was disabled. Public row policies permitted the entire profile row, and the page mounted its settings drawer for visitors. Moving the drawer offscreen did not remove its private data from the DOM.

Migration `20261005014756_protect_private_profile_columns.sql` replaces table-wide SELECT with an explicit public-column grant for both anonymous and authenticated readers. Existing public row eligibility and identity joins remain in place. The existing `get_user_profile_fast` function checks the exact caller identity before returning an owner's private profile; service access remains explicit. New columns receive no public SELECT privilege. Owner updates return the public projection and refresh private fields through the owner function. Public labels and member lookup use names or usernames rather than account email.

Run `supabase/sql/test_profile_column_privacy.sql` only in an empty disposable PG17 database named `dm_refinement_profile_privacy*`. It reproduces the original exposure, applies the actual migration, and checks anonymous, stranger, owner, null identity, future-column, update and trusted-service behavior. Frontend regressions cover public projections, owner RPC errors, logout and visitor settings rendering. Local validation does not establish deployment: verify the same direct anonymous API request and profile DOM after the existing CI deploys.

### Photo source and analysis reader failure 2026 10 05

The existing `get_photo_library_stats` function used an empty search path with unqualified tables; a live call failed with `42P01`. Its client fallback counted capped row arrays as a whole library and hid the reader error. Migration `20261005021008_photo_library_source_analysis_coverage.sql` qualifies the existing tables and requires the subject owner or service role. Legacy counts keep their existing unassigned-inbox scope; `source_analysis` separately measures all owner image rows and independently grouped analysis records, work extractions and observation witnesses. Group children before joining to prevent multiplied counts. The newest one hundred rows expose recent failure and retained-output counts. Device completeness and whole-library classification accuracy remain unknown; selected verified sync categories do not establish either.

The existing reconciliation panel consumes this owner-only result independently of slower profile statistics and displays source populations, output gaps and clocks. RPC failure remains an error instead of becoming capped totals. The actual migration fixture `supabase/sql/test_photo_source_analysis_coverage.sql` requires an empty disposable PG17 database named `dm_refinement_photo_coverage*` and tests the original failure, owner/stranger/service access, overlapping child outputs, inbox compatibility, foreign-source exclusion and an empty population. It does not start processing, alter jobs or infer new testimony.

Live verification then exposed an additional stale reference: `vehicle_suggestions` is absent from the current atlas. The initial synthetic fixture incorrectly supplied it. Followup `20261005025602_remove_absent_photo_suggestions_reader.sql` removes that optional legacy lookup, returning a null suggestion count and `unavailable` state while preserving the coverage and owner-gate definition. The fixture now matches the absence and applies both migrations. A passing synthetic migration test cannot establish that every referenced production substrate exists; reconcile each reference against live schema and exercise the deployed reader before declaring the repair complete.

The corrected owner read then hit `57014` on the real library. Its plan joined every owner image back to metadata before the newest-100 limit and estimated approximately eighty million rows for the joined recent-output population. The old execution timed out; its compilation time was not measured. `20261005031512_bound_photo_recent_output_probe.sql` materializes the one hundred IDs first and measures each grouped output population through existence counts. A read-only live plan assay reduced estimated cost from approximately 2.94 million to 50,635, read metadata through exactly one hundred primary-key probes, and completed in 4.18 seconds under the existing timeout. This is assay evidence, not deployment proof. The PG17 fixture also tests more than one hundred captured rows; current source counts, overlap semantics, private gate and unknown-quality states remain unchanged.

The bounded metadata correction still timed out when invoked through the full deployed function. An isolated owner census measured 7.78 seconds and 14,735 physical blocks read through the ordinary index scan. `20261005034243_share_photo_owner_bitmap_read.sql` shares one captured population across legacy counters and coverage, using a private invoker helper that prefers bitmap reads only while fetching those scalar image fields. Its role grants deny direct calls from anon, authenticated and service roles; the existing owner-gated stats function invokes it as its owner. Output-store queries retain their normal index choices. A warm live bitmap assay completed in 166 ms with no physical reads; this is not a controlled cold-cache benchmark. PG17 fixtures cover caller-setting restoration, helper denial, JSON-null vehicle detection, count grains, output overlaps and the newest-100 limit. Runtime acceptance must repeat the deployed function without temporary planner overrides before closing the reader repair. No cache flush, index, processing activation, model, timeout increase or capacity change is part of this repair.

Profile consumers must distinguish stored descriptions from verified capability. Profession and expertise use their actual profile columns. Captured work sessions paginate past the API cap, disclose derived/finalized/confirmed/technician-linked populations, and label recorded duration without asserting personally performed labor; public requests omit cost fields. Captured cash flow excludes unknown directions or invalid amounts, retains undated valid payments in totals, states its row bound, and never labels net cash as verified income or profit. Synthetic frontend regressions cover these reader boundaries. Deployment and source reconciliation remain separate evidence stages.
