-- Validate the two analysis_events keys declared in 20261003180000 against existing rows.
-- (20261003184000 holds the same statements but the deploy read that commit as a rename and
-- skipped it; this file is the one that runs. Both are idempotent.)
-- Exact check on the full table (2026-10-03): 129 distinct vehicle_id and 12,967 distinct image_id, 0 orphans.
-- The deploy runs psql without a transaction, so the timeouts sit inside an explicit one.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

alter table public.analysis_events validate constraint analysis_events_vehicle_id_fkey;
alter table public.analysis_events validate constraint analysis_events_image_id_fkey;
commit;
