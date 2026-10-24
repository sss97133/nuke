-- Revert run odo_unit_fix_ba_v1_20261024
begin;
update public.vehicles v set mileage=f.old_mileage, odometer_reading=null, odometer_unit=null, odometer_source_url=null,
  mileage_normalized_miles=null, mileage_normalized_method=null, mileage_normalized_confidence=null, mileage_normalized_source=null
from public.vehicle_mileage_unit_fixes f where f.vehicle_id=v.id and f.run_id='odo_unit_fix_ba_v1_20261024' and f.reverted_at is null;
update public.vehicle_mileage_unit_fixes set reverted_at=now() where run_id='odo_unit_fix_ba_v1_20261024' and reverted_at is null;
commit;
