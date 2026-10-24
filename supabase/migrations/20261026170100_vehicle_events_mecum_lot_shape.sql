-- Reject Mecum lot numbers that are not catalog-shaped (e.g. F257, S123.1). Mecum page ids (483533, FL12-121107) are not lot numbers.
-- NOT VALID: enforced for new and updated rows without a long scan; validate separately (all current rows comply).
alter table public.vehicle_events add constraint vehicle_events_mecum_lot_shape
  check (source_platform is distinct from 'mecum' or lot_number is null
         or lot_number ~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$') not valid;
comment on constraint vehicle_events_mecum_lot_shape on public.vehicle_events is
  'Mecum lot_number must be a catalog lot (letters + digits, optional .N); page ids from /lots/<id>/ URLs are rejected.';
