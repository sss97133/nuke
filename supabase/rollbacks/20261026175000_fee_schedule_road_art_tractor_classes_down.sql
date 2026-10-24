-- Down for 20261026170000_fee_schedule_road_art_tractor_classes. Rows are kept (never hard-delete) but closed so they never match;
-- the old class list is re-added NOT VALID so the kept rows do not block it.
SET lock_timeout = '5s';
update public.platform_fee_schedule set valid_from = coalesce(valid_from, '1900-01-01'), valid_to = coalesce(valid_from, '1900-01-01'),
  notes = notes || ' | closed by rollback 20261026170000'
 where platform = 'mecum' and lot_class in ('road_art','tractor') and cited_on = '2026-10-24';
alter table public.platform_fee_schedule drop constraint if exists platform_fee_schedule_lot_class_check;
alter table public.platform_fee_schedule add constraint platform_fee_schedule_lot_class_check
  check (lot_class = any (array['any','car','motorcycle','non_car','charity'])) not valid;
