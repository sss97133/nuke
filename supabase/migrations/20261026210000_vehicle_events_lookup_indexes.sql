-- perf_idx_v1_20261024: two indexes for the hottest vehicle_events scans in pg_stat_statements.
-- Plain statements (no BEGIN): supabase-deploy.yml applies this with `psql -f`, so each CREATE INDEX CONCURRENTLY
-- runs outside a transaction (PGOPTIONS statement_timeout=120s). IF NOT EXISTS makes a re-run a no-op.
--
-- 1. (source_platform, source_listing_id): ~600k PostgREST calls (select vehicle_id/metadata/id, and the bid UPDATE)
--    filter on exactly this pair. The only covering index today is idx_vehicle_events_dedup (vehicle_id, source_platform,
--    source_listing_id), led by vehicle_id, so each lookup walks the whole index: 98 ms / 9,253 buffers for one miss;
--    UPDATE mean 546 ms, max 55 s. Not a duplicate: no index leads with source_platform, source_listing_id.
-- 2. attach_basis partial: houselot/rm_fix runs filter `metadata ? 'attach_basis'` (~2.8k of ~860k rows); today a
--    parallel seq scan of 3.5 GB (28 s measured). Partial, so it is a few hundred kB.
-- Revert: supabase/rollbacks/20261026210000_vehicle_events_lookup_indexes_down.sql
create index concurrently if not exists idx_vehicle_events_platform_listing_id
  on public.vehicle_events (source_platform, source_listing_id)
  where source_listing_id is not null;

create index concurrently if not exists idx_vehicle_events_attach_basis_cited
  on public.vehicle_events (((metadata -> 'attach_basis') ->> 'cited_event_id'))
  where (metadata ? 'attach_basis');
