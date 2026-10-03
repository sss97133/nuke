-- Validate the two analysis_events keys declared in 20261003180000 against existing rows.
-- Exact check on the full table (2026-10-03): 129 distinct vehicle_id and 12,967 distinct image_id, 0 orphans.
-- VALIDATE CONSTRAINT takes a lock that does not block reads or writes.
set local lock_timeout = '5s';
set local statement_timeout = '180s';

alter table public.analysis_events validate constraint analysis_events_vehicle_id_fkey;
alter table public.analysis_events validate constraint analysis_events_image_id_fkey;
