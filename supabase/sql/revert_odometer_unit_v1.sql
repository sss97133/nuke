-- caller controls the transaction (wrap in BEGIN ... ROLLBACK for tests); no COMMIT here
-- Revert for 20261026010000_vehicles_odometer_unit_and_normalized_miles + fix run odo_unit_fix_cc_v1_20261024.

update public.vehicles v set mileage = f.old_mileage,
  odometer_reading = null, odometer_unit = null, odometer_source_url = null,
  mileage_normalized_miles = null, mileage_normalized_method = null,
  mileage_normalized_confidence = null, mileage_normalized_source = null
from public.vehicle_mileage_unit_fixes f
where f.vehicle_id = v.id and f.run_id = 'odo_unit_fix_cc_v1_20261024' and f.reverted_at is null;
update public.vehicle_mileage_unit_fixes set reverted_at = now()
where run_id = 'odo_unit_fix_cc_v1_20261024' and reverted_at is null;
-- Optional schema revert (only after the data revert above):
-- drop table public.vehicle_mileage_unit_fixes;
-- alter table public.vehicles drop column odometer_reading, drop column odometer_unit, drop column odometer_source_url,
--   drop column mileage_normalized_miles, drop column mileage_normalized_method,
--   drop column mileage_normalized_confidence, drop column mileage_normalized_source;

