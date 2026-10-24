-- run odo_unit_fix_cc_v1_20261024 (applied 2026-10-24 ~00:35 PT). Revert: revert_odometer_unit_v1.sql
set statement_timeout='170s';
do $fix$ begin
drop table if exists _cc;
create temp table _cc as
select distinct on (ve.vehicle_id) ve.vehicle_id, (l.validation->>'orig_value')::numeric reading, l.mileage_unit unit,
  l.mileage_at_listing miles, l.source_url, l.source_snapshot_id
from vehicle_event_listing_mileage l join vehicle_events ve on ve.id=l.vehicle_event_id
where l.run_id::text like '%a5026' and l.validation ? 'orig_value'
order by ve.vehicle_id, l.created_at desc;

insert into vehicle_mileage_unit_fixes (run_id, vehicle_id, old_mileage, new_mileage, odometer_reading, odometer_unit, source_url, source_snapshot_id, reason)
select 'odo_unit_fix_cc_v1_20261024', v.id, v.mileage, c.miles, c.reading, c.unit, c.source_url, c.source_snapshot_id,
  'vehicles.mileage equals the km odometer on the lot page (legacy extract-collecting-cars Feb 2026 stored km as miles)'
from _cc c join vehicles v on v.id=c.vehicle_id
where c.unit='km' and v.mileage is not null and abs(v.mileage - c.reading) <= 1 and v.mileage <> c.miles
on conflict do nothing;

update vehicles v set mileage = f.new_mileage
from vehicle_mileage_unit_fixes f where f.vehicle_id=v.id and f.run_id='odo_unit_fix_cc_v1_20261024' and f.reverted_at is null;

update vehicles v set odometer_reading=c.reading, odometer_unit=c.unit, odometer_source_url=c.source_url,
  mileage_normalized_miles=c.miles,
  mileage_normalized_method=case when c.unit='km' then 'km_to_mi_x0.621371' else 'as_stated_mi' end,
  mileage_normalized_confidence='high', mileage_normalized_source='odo_unit_fix_cc_v1_20261024'
from _cc c where c.vehicle_id=v.id and v.odometer_reading is null;

drop table _cc;
end $fix$;
