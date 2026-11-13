-- Revert 20261112130000: remove the VIN landing step, its tick, the reader view and the schedule. The contributor row,
-- text reads and capture_set_links it wrote stay (data; capture_sets_revert(run_id) undoes a run's filings).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'capture-documents-land-by-vin';
DROP VIEW IF EXISTS public.capture_document_pages_to_land;
DROP FUNCTION IF EXISTS public.capture_documents_land_by_vin_tick(integer);
DROP FUNCTION IF EXISTS public.capture_documents_land_by_vin(uuid, uuid, boolean, integer);
