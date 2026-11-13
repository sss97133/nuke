-- Revert 20261111110000_vision_pool_library_sources: unschedule the carrier backfill and drop the two writers.
-- trg_vehicle_images_clip_carrier() stays (it was live before and is recorded unchanged). Carrier observation rows and
-- text reads already written stay: they are evidence rows of their own writers (ingest_image_observation,
-- record_image_text_reads) and are superseded or revoked through those, never deleted. The contributor row stays for the
-- same reason (its reads cite it).
SET lock_timeout = '5s';
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'clip-carrier-backfill';
DROP FUNCTION IF EXISTS public.clip_carrier_backfill(integer);
DROP FUNCTION IF EXISTS public.image_text_read_batch(uuid, integer);
