-- Revert 20261028073000_listing_photo_summary. Rows are retired, never deleted.
-- Run in psql with: -v run_id=<fill run id, e.g. listing_photo_summary_backfill_20261024> -v revert_run_id=<id> -v reason='<why>'
-- No COMMIT below: check the reported count, then COMMIT (or ROLLBACK) yourself. Repeat until 0 rows.
-- Stop refreshes first so retired rows are not touched by the queue: select cron.unschedule('drain-listing-photo-summary-queue');
begin;
set local statement_timeout = '55s';
update public.vehicle_listing_photo_summary set retired_at = now(), retired_reason = :'reason', retired_run_id = :'revert_run_id'
 where (vehicle_id, listing_key) in (select vehicle_id, listing_key from public.vehicle_listing_photo_summary
                                      where run_id = :'run_id' and retired_at is null limit 50000);
-- Triggers (hold no rows): for each of vehicle_image_listing_links, vehicle_image_nonvehicle_flags, auction_events, vehicle_images:
--   drop trigger if exists trg_listing_photo_summary_{insert,update,delete} on public.<table>;
