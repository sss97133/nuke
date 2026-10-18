-- BaT settlement, the one scheduled path — every ended lot's result reaches its vehicles row.
-- Session cb179857 / bat-to-db, 2026-09-27.
--
-- WHY: nothing settles ended BaT auctions today. Of 143 lots that ended in the 24 h before 17:00Z,
-- 3 read sold in prod (lead's count); bat-closed-lots-sync is deployed (v1, 02:09Z) but no cron or
-- workflow calls it; sync-bat-auction-status (469) is paused. Dry run of the sync at 17:03Z: 6 feed
-- pages = 300 closed lots, 300 unknown to bat_listings (already_known 0) — the catalog has not moved
-- since the outage.
--
-- THE PATH (two legs, both existing functions, both through the same write rules):
--   1. bat-closed-lots-sync (daily, this migration, created PAUSED): pages BaT's own listings-filter
--      feed newest-first, upserts each closed lot into bat_listings (sold/date/final bid are BaT's; the
--      trigger sync_bat_listing_to_vehicle gap-fills a matching vehicles row with sale_price AND
--      sale_status='sold' in the same statement, so lock 1 accepts it; an unsold lot carries no
--      sale_price) and queues the lot URL in import_queue (unique listing_url → idempotent).
--   2. process-import-queue (job 420 process-import-queue-batch, every 5 min, batch 25 — currently
--      paused, re-enable with this): routes bringatrailer URLs to extract-bat-core v4, which writes the
--      rows and links — price from the lot page's sale record, buyer only on a sale, VIN check digit,
--      a sale field that already holds a different value superseded through
--      correct_vehicle_sale_provenance_batch, image links with ai_processing_status='skipped', a fetch
--      receipt instead of the page.
--   One day of ended lots is ~150–250; 8 feed pages (400 lots) per day is enough headroom, and the
--   drain has 7,200 slots/day. Neither leg touches a testimony table.
--
-- THE PROBE: v_bat_settlement_probe — per auction-end day, what the sync queued, what the drain
-- finished, and whether the vehicles row reads a result (sold with a price, or not_sold with the high
-- bid). Watch it for a few days after enabling; "unsettled" must be 0 once the queue is drained.
--
-- SCHEMA_LAW: §1 both functions and both queues exist; §4 nothing overwritten (a view, a paused job);
-- §7 CI-applied; the job is created inactive and enabled by hand after the watch.

DO $do$
DECLARE
  v_id bigint;
  v_cmd text := $cmd$SELECT net.http_post(
    url := get_service_url() || '/functions/v1/bat-closed-lots-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
    body := '{"max_pages": 8, "caught_up_pages": 2}'::jsonb,
    timeout_milliseconds := 150000
  );$cmd$;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'bat-closed-lots-sync-daily';
  IF v_id IS NULL THEN
    v_id := cron.schedule('bat-closed-lots-sync-daily', '50 6 * * *', v_cmd);
    PERFORM cron.alter_job(job_id := v_id, active := false);   -- off until the lead's watch; enable with job 420
  ELSE
    PERFORM cron.alter_job(job_id := v_id, schedule := '50 6 * * *', command := v_cmd);
  END IF;
END
$do$;

CREATE OR REPLACE VIEW public.v_bat_settlement_probe AS
WITH q AS (
  SELECT q.listing_url,
         (q.raw_data ->> 'auction_end_date')::date AS ended_on,
         q.raw_data ->> 'listing_status'           AS catalog_status,
         q.status                                  AS queue_status,
         q.vehicle_id
  FROM import_queue q
  WHERE q.raw_data ->> 'source' LIKE 'bat-closed-lots-sync:%'
), j AS (
  SELECT q.*, v.sale_status, v.auction_outcome, v.sale_price, v.high_bid
  FROM q LEFT JOIN vehicles v ON v.id = q.vehicle_id AND v.deleted_at IS NULL
)
SELECT ended_on,
       count(*)                                                                            AS lots_queued,
       count(*) FILTER (WHERE catalog_status = 'sold')                                     AS catalog_sold,
       count(*) FILTER (WHERE queue_status = 'complete')                                   AS drained,
       count(*) FILTER (WHERE queue_status = 'pending')                                    AS pending,
       count(*) FILTER (WHERE queue_status = 'failed')                                     AS failed,
       count(*) FILTER (WHERE vehicle_id IS NOT NULL)                                      AS with_vehicle_row,
       count(*) FILTER (WHERE catalog_status = 'sold'
                          AND (sale_status = 'sold' OR auction_outcome = 'sold') AND sale_price > 0) AS settled_sold,
       count(*) FILTER (WHERE catalog_status <> 'sold'
                          AND sale_status IN ('not_sold','unsold','bid_to') AND sale_price IS NULL) AS settled_unsold,
       count(*) FILTER (WHERE queue_status = 'complete' AND NOT (
                          (catalog_status = 'sold' AND (sale_status = 'sold' OR auction_outcome = 'sold') AND sale_price > 0)
                          OR (catalog_status <> 'sold' AND sale_status IN ('not_sold','unsold','bid_to') AND sale_price IS NULL))) AS unsettled_after_drain
FROM j
GROUP BY ended_on
ORDER BY ended_on DESC;

COMMENT ON VIEW public.v_bat_settlement_probe IS
  'BaT settlement probe (2026-09-27): per auction-end day, lots queued by bat-closed-lots-sync, drained by process-import-queue → extract-bat-core, and whether their vehicles row reads the result (sold + price, or not_sold + high bid). unsettled_after_drain must be 0 once the queue is empty. Operator read model; SELECT for service_role.';
GRANT SELECT ON public.v_bat_settlement_probe TO service_role;

-- Live verification (after apply, before enabling):
--   select jobid, jobname, schedule, active from cron.job where jobname in ('bat-closed-lots-sync-daily','process-import-queue-batch');
--   -- both active=false. Enable: select cron.alter_job(<id>, active := true) for both, then next day:
--   select * from v_bat_settlement_probe limit 7;
