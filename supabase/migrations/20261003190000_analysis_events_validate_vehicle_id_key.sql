-- Validate analysis_events.vehicle_id -> vehicles.id against existing rows.
-- Exact check on the full table (2026-10-03): 129 distinct vehicle_id, 0 not in vehicles.
-- Takes minutes on a cold cache (1.47M rows probed); does not block reads or writes.
-- One key per migration so a slow validation cannot roll back the other. Timeouts sit inside an
-- explicit transaction because the deploy runs psql without one.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '900s';

alter table public.analysis_events validate constraint analysis_events_vehicle_id_fkey;
commit;
