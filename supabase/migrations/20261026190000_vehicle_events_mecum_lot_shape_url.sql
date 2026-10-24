-- Scope vehicle_events_mecum_lot_shape to rows that are really Mecum lots (source_url on mecum.com).
-- 156 legacy rows carry source_platform='mecum' but a barrett-jackson.com source_url and a cited B-J lot (e.g. 1058, 347.1);
-- the first version rejected any update to them. Page ids still cannot be written as the lot of a mecum.com row.
alter table public.vehicle_events drop constraint if exists vehicle_events_mecum_lot_shape;
alter table public.vehicle_events add constraint vehicle_events_mecum_lot_shape
  check (source_platform is distinct from 'mecum' or lot_number is null or coalesce(source_url,'') !~* 'mecum\.com'
         or lot_number ~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$') not valid;
comment on constraint vehicle_events_mecum_lot_shape on public.vehicle_events is
  'Mecum lot_number on a mecum.com row must be a catalog lot (letters + digits, optional .N); page ids from /lots/<id>/ URLs are rejected.';
