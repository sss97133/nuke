-- Revert 20261028020000_vehicle_image_listing_links_exact.
-- Data-only revert of a run: delete from public.vehicle_image_listing_links where run_id = '<run_id>';
--                            delete from public.vehicle_image_nonvehicle_flags where run_id = '<run_id>';
drop function if exists public.flag_bj_banner_images(uuid[], text);
drop function if exists public.link_vehicle_images_to_listings_exact(uuid[], text);
drop table if exists public.vehicle_image_nonvehicle_flags;
delete from public.vehicle_image_listing_links where method in ('mecum_lot_id','bj_item_id');
alter table public.vehicle_image_listing_links drop column if exists basis_key;
alter table public.vehicle_image_listing_links alter column days_before_end set not null;
alter table public.vehicle_image_listing_links alter column listing_end_date set not null;
alter table public.vehicle_image_listing_links alter column upload_month set not null;
alter table public.vehicle_image_listing_links drop constraint if exists vehicle_image_listing_links_method_check;
alter table public.vehicle_image_listing_links add constraint vehicle_image_listing_links_method_check
  check (method = 'bat_upload_month_window') not valid;
