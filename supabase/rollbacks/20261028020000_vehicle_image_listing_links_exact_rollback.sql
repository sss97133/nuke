-- Revert 20261028020000_vehicle_image_listing_links_exact (Mecum / B-J exact links and B-J banner flags).
-- Rows are retired, never deleted (retired_* columns from 20261028030000).
-- Run in psql with: -v run_id=<backfill run id, e.g. img_listing_links_exact_20261024> -v revert_run_id=<id> -v reason='<why>'
-- No COMMIT below: check the reported counts, then COMMIT (or ROLLBACK) yourself.
-- Large runs: repeat the two updates until both report 0 rows (each touches at most 50,000 rows).
begin;
set local statement_timeout = '55s';
update public.vehicle_image_listing_links set retired_at = now(), retired_reason = :'reason', retired_run_id = :'revert_run_id'
 where image_id in (select image_id from public.vehicle_image_listing_links
                     where run_id = :'run_id' and method in ('mecum_lot_id','bj_item_id') and retired_at is null limit 50000);
update public.vehicle_image_nonvehicle_flags set retired_at = now(), retired_reason = :'reason', retired_run_id = :'revert_run_id'
 where image_id in (select image_id from public.vehicle_image_nonvehicle_flags
                     where run_id = :'run_id' and reason = 'bj_auction_site_banner' and retired_at is null limit 50000);
-- Function revert (holds no rows):
--   drop function if exists public.flag_bj_banner_images(uuid[], text);
--   drop function if exists public.link_vehicle_images_to_listings_exact(uuid[], text);
