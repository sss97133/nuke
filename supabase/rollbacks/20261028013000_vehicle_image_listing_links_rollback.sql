-- Revert 20261028013000_vehicle_image_listing_links. Data-only revert of one backfill run:
--   delete from public.vehicle_image_listing_links where run_id = '<run_id>';
-- Full revert (the table is new; nothing else depends on it):
drop function if exists public.link_vehicle_images_to_listings(uuid[], text);
drop table if exists public.vehicle_image_listing_links;
