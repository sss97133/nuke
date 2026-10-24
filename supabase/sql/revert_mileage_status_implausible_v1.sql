-- caller controls the transaction (wrap in BEGIN ... ROLLBACK for tests); no COMMIT here
-- Revert for run mileage_status_implausible_v1_20261024 .

update public.vehicles v set mileage = s.old_vehicle_mileage
from public.mileage_value_status s
where s.vehicle_id = v.id and s.field = 'vehicles.mileage' and s.status = 'suspect'
  and s.run_id = 'mileage_status_implausible_v1_20261024' and s.superseded_at is null and v.mileage is null;
update public.mileage_value_status set superseded_at = now()
where run_id = 'mileage_status_implausible_v1_20261024' and superseded_at is null;

