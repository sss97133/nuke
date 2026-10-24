drop function if exists public.backfill_event_identity_check(text, int);
drop index if exists public.vehicle_events_identity_mismatch_idx;
alter table public.vehicle_events
  drop column if exists identity_check, drop column if exists identity_check_lot_id,
  drop column if exists identity_check_vehicle_vin, drop column if exists identity_check_source,
  drop column if exists identity_check_run_id, drop column if exists identity_check_at;
drop function if exists public.event_identity_status(text, text);
drop function if exists public.vin_chassis_norm(text);
