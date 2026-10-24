-- perf_idx_v1_20261024 retry. 20261026210000 failed at 10s: the pooler ignores the workflow's PGOPTIONS, so the postgres
-- role's 10s statement_timeout applied. A session-level SET (psql -f autocommits each statement, so the CONCURRENTLY
-- builds still run outside a transaction) caps each build at 55s, the run's agreed ceiling. The failed attempt's
-- invalid, empty index was dropped by hand first so IF NOT EXISTS does not no-op on it.
set statement_timeout = '55s';
create index concurrently if not exists idx_vehicle_events_platform_listing_id
  on public.vehicle_events (source_platform, source_listing_id)
  where source_listing_id is not null;

create index concurrently if not exists idx_vehicle_events_attach_basis_cited
  on public.vehicle_events (((metadata -> 'attach_basis') ->> 'cited_event_id'))
  where (metadata ? 'attach_basis');
