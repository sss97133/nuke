-- Expression index on vehicle_observations structured_data->>'image_id'.
--
-- FIRST EXECUTION OF THE CRYSTALLIZATION ORGAN (scripts/schema-pressure-census.mjs,
-- Skylar's directive 2026-07-02: "the schema expands without human interaction — the agent
-- knows how and where to expand the structural side").
--
-- Census evidence (2026-07-02 run, vehicle_observations.structured_data, 30-day window,
-- 32,125 rows): image_id at 100% fill / 100% string — the top crystallization candidate.
-- Converged with an independently-measured pain: the get_user_day_receipt image_deep_byok
-- lateral seq-scanned ~7.5M rows PER PHOTO (2026-06-15 handoff, the #1 "sluggish" cause).
--
-- APPLIED OUT-OF-BAND 2026-07-02 via direct psql (CREATE INDEX CONCURRENTLY cannot run in
-- a migration transaction; statement_timeout=0 for the one non-batchable build; zero
-- write-blocking by construction). This file is the repo record.
-- Re-measured after: 0.21ms per lookup (Bitmap Index Scan, 3 heap blocks) vs 7.5M-row scan.
--
-- The guard below makes the migration replay-safe on shadow/local DBs (non-concurrent
-- there, which is fine — they're not under live write load).
create index if not exists idx_vobs_structured_image_id
  on vehicle_observations ((structured_data->>'image_id'))
  where structured_data ? 'image_id';
