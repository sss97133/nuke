-- End-date provenance for auction_events (2026-10-24). auction_end_date had no citation, and BaT lots with a NULL
-- end date were being dated from sale_result observations written by scripts/backfill-sale-results*.sh, which
-- copied vehicles.sale_date as it stood on 2026-03-24 (1,006 stamped 2026-01-12; ~26k across stale stamp days).
-- Side table (no DDL lock on the hot auction_events table, no FK for the same reason, like mileage_value_status):
-- every auction_end_date a correction run writes gets one row here citing its source; revert = restore old value.
-- Rollback: supabase/rollbacks/20261026051000_auction_end_date_provenance_down.sql
create table if not exists public.auction_event_end_date_provenance (
  id bigserial primary key,
  auction_event_id uuid not null,
  old_end_date timestamptz,
  new_end_date timestamptz not null,
  precision text not null check (precision in ('exact', 'day')),
  source text not null,
  evidence_observation_id uuid,
  run_id text not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);
create index if not exists auction_event_end_date_provenance_event_idx
  on public.auction_event_end_date_provenance (auction_event_id) where superseded_at is null;
create index if not exists auction_event_end_date_provenance_run_idx on public.auction_event_end_date_provenance (run_id);
alter table public.auction_event_end_date_provenance enable row level security;
comment on table public.auction_event_end_date_provenance is
  'Citation for each auction_events.auction_end_date written by a correction run (source + evidence observation). Legacy dates have no row.';
