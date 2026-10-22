-- Mecum inferred venue (run id mecum-venue-20261022). Writes ONLY new metadata keys auction_name_inferred, auction_name_inferred_run.
-- Rule: dominant named Mecum venue on the same sale day with >=90% share (validated 99.85% accuracy on 8,151 hidden labels).
-- Backup: public.mecum_venue_backfill_backup_20261022 (id, prior metadata keys). Revert: supabase/sql/revert/mecum_inferred_venue_revert.sql
create table if not exists public.mecum_venue_backfill_backup_20261022 (id uuid primary key, had_key boolean, prior jsonb, run_id text, at timestamptz default now());
alter table public.mecum_venue_backfill_backup_20261022 enable row level security;
-- (executed in date batches; see README)
