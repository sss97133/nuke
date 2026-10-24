-- Restore the first (platform-only) version of the check.
alter table public.vehicle_events drop constraint if exists vehicle_events_mecum_lot_shape;
alter table public.vehicle_events add constraint vehicle_events_mecum_lot_shape
  check (source_platform is distinct from 'mecum' or lot_number is null
         or lot_number ~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$') not valid;
