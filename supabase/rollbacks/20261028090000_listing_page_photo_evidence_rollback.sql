-- Revert 20261028090000_listing_page_photo_evidence. Rows are retired, never deleted.
-- psql -v run_id=<link or evidence run id> -v revert_run_id=<id> -v reason='<why>'
-- No COMMIT below: check the reported counts, then COMMIT (or ROLLBACK) yourself. Repeat until 0 rows.
begin;
set local statement_timeout = '55s';
update public.vehicle_image_listing_links set retired_at = now(), retired_reason = :'reason', retired_run_id = :'revert_run_id'
 where image_id in (select image_id from public.vehicle_image_listing_links
                     where run_id = :'run_id' and retired_at is null limit 50000);
update public.listing_page_photo_evidence set retired_at = now(), retired_reason = :'reason', retired_run_id = :'revert_run_id'
 where run_id = :'run_id' and retired_at is null;
