-- ebay-motors-discover-t2 read "tier 1, For Sale By = Not Specified" as well. Measured 2026-10-15: eBay does not honour that
-- facet value in the URL (4,100+ results, the unfiltered newest-first stream, mostly dealers), so the job would have spent
-- credits on dealer pages. Re-point it at tier 2 private sellers only. The job stays INACTIVE.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $job$
BEGIN
  PERFORM cron.alter_job(job_id := jobid, command := $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-ebay-motors',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := '{"action": "discover", "tiers": [2], "facets": ["private"], "pages": 1, "deep_max": 15, "daily_item_cap": 60}'::jsonb,
        timeout_milliseconds := 150000
      );
    $c$, active := false)
  FROM cron.job WHERE jobname = 'ebay-motors-discover-t2';
END $job$;
DO $check$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'ebay-motors-discover-t2' AND NOT active AND command LIKE '%"tiers": [2]%') <> 1 THEN
    RAISE EXCEPTION 'ebay-motors-discover-t2 must be inactive and tier-2 private only';
  END IF;
END $check$;
COMMIT;
