-- Revert 20261028030000_vehicle_image_links_retire_cb. Rows are retired, never deleted.
-- Run in psql with: -v run_id=<backfill run id> -v revert_run_id=<this revert's id> -v reason='<why>'
-- No COMMIT below: check the reported counts, then COMMIT (or ROLLBACK) yourself.
-- Large runs: repeat the two updates until both report 0 rows (each touches at most 50,000 rows).
begin;
set local statement_timeout = '55s';
update public.vehicle_image_listing_links set retired_at = now(), retired_reason = :'reason', retired_run_id = :'revert_run_id'
 where image_id in (select image_id from public.vehicle_image_listing_links
                     where run_id = :'run_id' and method = 'cb_single_listing' and retired_at is null limit 50000);
update public.vehicle_image_nonvehicle_flags set retired_at = now(), retired_reason = :'reason', retired_run_id = :'revert_run_id'
 where image_id in (select image_id from public.vehicle_image_nonvehicle_flags
                     where run_id = :'run_id' and reason = 'cb_related_listing_thumbnail' and retired_at is null limit 50000);
-- Function revert (holds no rows): drop function if exists public.link_cb_images_to_listings(uuid[], text);
