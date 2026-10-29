-- Revert 20261028013000_vehicle_image_listing_links (BaT upload-month links).
-- Rows are retired, never deleted (retired_* columns from 20261028030000).
-- Run in psql with: -v run_id=<backfill run id, e.g. img_listing_links_20261024> -v revert_run_id=<id> -v reason='<why>'
-- No COMMIT below: check the reported count, then COMMIT (or ROLLBACK) yourself.
-- Large runs: repeat the update until it reports 0 rows (each touches at most 50,000 rows).
begin;
set local statement_timeout = '55s';
update public.vehicle_image_listing_links set retired_at = now(), retired_reason = :'reason', retired_run_id = :'revert_run_id'
 where image_id in (select image_id from public.vehicle_image_listing_links
                     where run_id = :'run_id' and method = 'bat_upload_month_window' and retired_at is null limit 50000);
-- Function revert (holds no rows): drop function if exists public.link_vehicle_images_to_listings(uuid[], text);
