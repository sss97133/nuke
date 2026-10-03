-- Validate analysis_events.image_id -> vehicle_images.id against existing rows.
-- Exact check on the full table (2026-10-03): 12,967 distinct image_id, 0 not in vehicle_images.
-- 1.47M rows are probed against the 52M-row vehicle_images primary key (nested-loop anti join,
-- planner cost ~1.4M), which takes minutes on a cold cache; it does not block reads or writes.
-- The 180s attempt in 20261003185000 timed out and rolled back. Timeouts sit inside an explicit
-- transaction because the deploy runs psql without one.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '900s';

alter table public.analysis_events validate constraint analysis_events_image_id_fkey;
commit;
