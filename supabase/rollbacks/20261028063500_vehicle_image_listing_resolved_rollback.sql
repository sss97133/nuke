-- Revert 20261028063500_vehicle_image_listing_resolved. The function holds no rows.
-- Rows retired because the resolver implies them are un-retired by revert id (nothing is deleted).
-- Run in psql with: -v revert_run_id=<retire run id, e.g. img_links_implied_retire_20261024>
-- No COMMIT below: check the reported count, then COMMIT (or ROLLBACK) yourself. Repeat until 0 rows.
begin;
set local statement_timeout = '55s';
update public.vehicle_image_listing_links set retired_at = null, retired_reason = null, retired_run_id = null
 where image_id in (select image_id from public.vehicle_image_listing_links
                     where retired_run_id = :'revert_run_id' and retired_reason = 'single_listing_implied' limit 50000);
-- drop function if exists public.vehicle_image_listing_resolved(uuid[], boolean);
