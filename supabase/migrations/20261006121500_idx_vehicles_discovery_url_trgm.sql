-- Trigram index on vehicles.discovery_url, for the listing resolver's URL-pattern step.
--
-- What it serves: supabase/functions/_shared/resolveVehicleForListing.ts:60, step 3 of resolveExistingVehicleId:
--   .from('vehicles').select('id').ilike('discovery_url', '%<host>/<path>%').limit(1)
-- Every lot a listing extractor sees for the first time reaches this step, because steps 1 and 2 (exact keys) miss.
-- vehicles has no trigram index on discovery_url; the only index on it is the btree vehicles_discovery_url_unique.
-- So Postgres walks that whole index (1.01M rows) with heap fetches to find nothing.
-- Measured 2026-10-06: pg_stat_statements for the PostgREST form of this query showed 39 calls, mean 15.4 s, max 39.4 s.
-- One probe at ~09:55Z, under lane K's I/O, passed 60 s. service_role inherits authenticator's 60 s
-- statement_timeout, and the resolver catches the timeout and goes on to insert.
-- Callers: extract-gooding (next to re-enable, PR #681) and 6 other extractors on the same path: extract-rmsothebys (PR #682),
-- extract-bonhams, extract-broad-arrow, extract-bh-auction, extract-barn-finds-listing and import-classic-auction.
-- pg_trgm 1.6 is installed. gin_trgm_ops serves ILIKE '%…%' (the existing make/model/color trigram indexes use it).
--
-- Size, estimated from a 1% tablesample (repeatable 11):
--   ~415,300 non-null discovery_url, 67.7 chars on average, 62.5 trigrams each, about 26.0M entries.
--   This table's own trigram indexes take 7.0 B/entry (make, 54 MB), 8.2 B/entry (model, 110 MB) and 10.4 B/entry (color, 50 MB).
--   So expect roughly 180–270 MB, about 215 MB at the model rate.
--   The URL key space is small (7,613 distinct trigrams in the sample), so posting lists are long and compress like make/model.
-- Build: CONCURRENTLY scans the 2.4 GB heap twice. A 5% sample read 15,227 pages in 6.4 s under K's I/O (random sample reads);
-- trigram extraction is ~0.3 s per 21K URLs, about 6 s for all of them. Sequential reads after K ends should be much faster.
-- Timeout: the deploy role (postgres) has statement_timeout=10s in its rolconfig. The 120s of the 2026-10-04 precedent
-- (20261004213500) is also far too short for a GIN trigram build that scans a 2.4 GB heap twice. So this file sets a
-- bounded 30min, never 0. That is the one-shot index-build exception to db-safety.md's 120s cap that
-- 20260623013000 already records; it governs this file's session only. lock_timeout is 5s.
-- If the build still times out, Postgres leaves the index INVALID. The verify query below catches that.
-- A retry needs DROP INDEX CONCURRENTLY first, which is the owner's call.
--
-- CONCURRENTLY: no BEGIN in this file on purpose. The deploy applies each file with psql -f in autocommit
-- (precedents 20260227040000, 20261004213500). Merge after K's keying job has unloaded and after #680.
SET statement_timeout = '30min';
SET lock_timeout = '5s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_discovery_url_trgm
  ON public.vehicles USING gin (discovery_url gin_trgm_ops);

RESET lock_timeout;
RESET statement_timeout;

COMMENT ON INDEX public.idx_vehicles_discovery_url_trgm IS
'GIN trigram on vehicles.discovery_url. Serves resolveVehicleForListing.ts step 3 (discovery_url ILIKE ''%host/path%''), which every listing extractor runs for a lot it has not seen. Before it: mean 15.4 s per lookup (pg_stat_statements, 39 calls, 2026-10-06). Built CONCURRENTLY 2026-10-06.';

-- Verify after apply (read-only):
--   select indisvalid, indisready, pg_size_pretty(pg_relation_size(indexrelid))
--     from pg_index where indexrelid = 'public.idx_vehicles_discovery_url_trgm'::regclass;      -- t, t, ~180–270 MB
--   explain select id from vehicles where discovery_url ilike '%goodingco.com/lot/1914-stutz-model-4e-bearcat%' limit 1;
--     -- Bitmap Index Scan on idx_vehicles_discovery_url_trgm, not an Index Scan on vehicles_discovery_url_unique
--   select calls, round(mean_exec_time) ms from pg_stat_statements
--    where query like 'WITH pgrst_source AS ( SELECT "public"."vehicles"."id" FROM "public"."vehicles" WHERE "public"."vehicles"."discovery_url" ilike%';
--     -- new calls should average milliseconds, not 15 s. PostgREST may reuse a generic plan; if the mean stays high, check that first.
-- If indisvalid is false: the build hit the timeout. DROP INDEX CONCURRENTLY and a retry off-peak are the owner's call.
