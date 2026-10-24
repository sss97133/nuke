alter table public.vehicle_events drop constraint if exists vehicle_events_source_suspect_chk;
drop index if exists public.vehicle_events_source_suspect_idx;
drop index if exists public.vehicle_events_duplicate_of_idx;
alter table public.vehicle_events
  drop column if exists duplicate_of_event_id,
  drop column if exists source_suspect_at,
  drop column if exists source_suspect_run_id,
  drop column if exists source_suspect_reason,
  drop column if exists source_suspect;
