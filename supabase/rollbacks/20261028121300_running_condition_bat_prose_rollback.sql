update public.vehicle_running_condition set retired_at = now() where retired_at is null and run_id = 'running_condition_v3_batprose_20261025';
