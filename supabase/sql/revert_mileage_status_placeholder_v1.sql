-- Revert run mileage_status_placeholder_v1_20261024 (status only; vehicles.mileage never changed).
update public.mileage_value_status set superseded_at = now()
where run_id = 'mileage_status_placeholder_v1_20261024' and superseded_at is null;
