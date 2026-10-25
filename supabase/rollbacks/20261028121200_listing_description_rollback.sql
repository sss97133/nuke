-- Rollback: retire rows by run id (no deletes). Functions/table are additive; leaving them is harmless.
update public.vehicle_running_condition set retired_at = now() where retired_at is null and run_id = 'running_condition_v2_fulltext_20261025';
update public.vehicle_listing_description set retired_at = now() where retired_at is null and run_id = 'listing_description_bat_v1_20261025';
