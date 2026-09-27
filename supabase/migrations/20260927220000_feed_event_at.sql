-- Feed dates: the feed sorts and ranks by the auction's date, not by when a row reached Nuke.
--
-- Skylar (via the lead, 2026-09-27): "the old UI is now showing recently discovered listings but … the auction
-- dates are not logging as date of the auction rather like the date the data entered the system".
-- MEASURED: the BaT lot loader creates ~2K-4K historical lots an hour with vehicles.created_at = now (runs
-- ~1.5-2 days more). vehicle_valuation_feed's newest/oldest sort and its feed_rank_score recency term
-- (GREATEST(created_at, updated_at)) therefore present a 2019 sale as brand new. Of 337 'bat' lots created in
-- 12 h (auctions ending Sep 3-26), 254 carry sale_date; the other 76 have only auction_end_date.
--
-- Rebuilds the feed from the lean definition of 20260927190000 (same guards, same planner settings, same
-- 11 indexes) with:
--   * auction_end_at = public.safe_to_timestamptz(auction_end_date) (existing helper; NULL on a bad string,
--     so one malformed row cannot abort the refresh), parsed once per row in a table-free LATERAL;
--   * event_at = COALESCE(sale_date, auction_end_at, created_at): the market event date;
--   * the recency multiplier in feed_rank_score uses event_at instead of GREATEST(created_at, updated_at);
--   * idx_vvf_event_at (event_at DESC, vehicle_id) for feed-query's newest/oldest keyset.
-- The live feed is kept as vehicle_valuation_feed_superseded_20260927b. Then cron 447 (refresh-feed-mv,
-- inactive since ~2026-04-10) gets the measured settings and runs every 6 h at :35: the lead asked for 6 h
-- while the lot loader competes for disk; move it to hourly when the loader is done.
-- feed-query switches its sorts to event_at in the following commit (this one only adds columns).

SET statement_timeout = '120s';
SET lock_timeout = '10s';

-- 1. the empty scaffold goes; a populated one is somebody's data and stops the file
DO $$
DECLARE populated boolean;
BEGIN
  IF to_regclass('public.vehicle_valuation_feed__next') IS NOT NULL THEN
    SELECT relispopulated INTO populated FROM pg_class WHERE oid = 'public.vehicle_valuation_feed__next'::regclass;
    IF populated THEN
      RAISE EXCEPTION 'vehicle_valuation_feed__next is populated (it was empty on 2026-09-27 16:00Z); refusing to drop it';
    END IF;
    EXECUTE 'DROP MATERIALIZED VIEW public.vehicle_valuation_feed__next';
  END IF;
END $$;

-- 2. the lean definition: the live viewdef (pg_get_viewdef 2026-09-27) with exactly the edits listed in the header
CREATE MATERIALIZED VIEW public.vehicle_valuation_feed__next AS
 SELECT v.id AS vehicle_id,
    v.year,
    COALESCE(cm.canonical_name, v.make) AS make,
    v.model,
    v.series,
    v."trim",
    v.transmission,
    v.drivetrain,
    v.body_style,
    v.canonical_body_style,
    v.mileage,
    v.vin,
    v.is_for_sale,
    v.sale_status,
    v.sale_date,
    v.created_at,
    v.updated_at,
    ae.auction_end_at,
    COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) AS event_at,
    v.discovery_url,
    COALESCE(v.platform_source, v.discovery_source) AS discovery_source,
    v.profile_origin,
    v.origin_organization_id,
    v.city,
    v.state,
    v.listing_location,
    v.canonical_vehicle_type,
    v.has_photos,
    v.primary_image_url,
    NULL::text AS thumbnail_url,
    NULL::text AS medium_url,
    v.primary_image_url AS full_image_url,
    NULL::text AS description_snippet,
    COALESCE(v.observation_count, 0)::bigint AS observation_count,
    NULL::bigint AS source_count,
    NULL::bigint AS photo_count,
    cvp.best_price AS display_price,
    cvp.price_source,
    cvp.is_sold,
    v.asking_price,
    v.sale_price,
    v.current_value,
    ne.estimated_value AS nuke_estimate,
    ne.value_low AS nuke_estimate_low,
    ne.value_high AS nuke_estimate_high,
    ne.confidence_score AS nuke_estimate_confidence,
    ne.price_tier,
    ne.deal_score,
    ne.deal_score_label,
    ne.heat_score,
    ne.heat_score_label,
    ne.model_version,
    ne.calculated_at AS valuation_calculated_at,
        CASE
            WHEN rp.record_vehicle_id = v.id THEN true
            ELSE false
        END AS is_record_price,
    rp.record_price AS segment_record_price,
    COALESCE(ne.deal_score, 50::numeric) *
        CASE
            WHEN COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '1 day'::interval) THEN 1.0
            WHEN COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '3 days'::interval) THEN 0.95
            WHEN COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '7 days'::interval) THEN 0.85
            WHEN COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '30 days'::interval) THEN 0.50
            ELSE 0.30
        END + COALESCE(ne.heat_score, 0::numeric) * 0.3 +
        CASE
            WHEN v.sale_status = 'auction_live'::text THEN 200
            WHEN v.is_for_sale = true THEN 80
            ELSE 0
        END::numeric +
        CASE
            WHEN COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['bringatrailer'::text, 'bat'::text]) THEN 100
            WHEN COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['cars-and-bids'::text, 'cars_and_bids'::text, 'collecting-cars'::text, 'collecting_cars'::text, 'mecum'::text, 'barrett-jackson'::text, 'barrett_jackson'::text, 'rmsothebys'::text, 'gooding'::text, 'bonhams'::text]) THEN 80
            WHEN COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['pcarmarket'::text, 'hagerty'::text, 'hemmings'::text]) THEN 60
            WHEN COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['facebook_marketplace'::text, 'facebook'::text]) THEN '-30'::integer
            ELSE 20
        END::numeric +
        CASE
            WHEN v.has_photos THEN 20
            ELSE 0
        END::numeric AS feed_rank_score
   FROM vehicles v
     CROSS JOIN LATERAL (SELECT CASE WHEN v.auction_end_date IS NULL THEN NULL::timestamp with time zone ELSE public.safe_to_timestamptz(v.auction_end_date) END AS auction_end_at) ae
     LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
     LEFT JOIN clean_vehicle_prices cvp ON cvp.vehicle_id = v.id
     LEFT JOIN nuke_estimates ne ON ne.vehicle_id = v.id
     LEFT JOIN record_prices rp ON COALESCE(cm.canonical_name, v.make) = rp.make AND v.model = rp.model AND v.year >= rp.year_start AND v.year <= rp.year_end
  WHERE v.deleted_at IS NULL AND (v.status <> ALL (ARRAY['deleted'::text, 'merged'::text, 'duplicate'::text])) AND (ne.is_stale IS NOT TRUE OR ne.id IS NULL) AND v.year IS NOT NULL AND v.make IS NOT NULL AND NOT (upper(COALESCE(cm.canonical_name, v.make)) IN ( SELECT upper(non_auto_makes_excluded.make) AS upper
           FROM non_auto_makes_excluded))
WITH NO DATA;

-- the eleven live indexes (pg_indexes 2026-09-27), temporary names
CREATE UNIQUE INDEX idx_vvf__next_vehicle_id   ON public.vehicle_valuation_feed__next USING btree (vehicle_id);
CREATE INDEX idx_vvf__next_created             ON public.vehicle_valuation_feed__next USING btree (created_at DESC);
CREATE INDEX idx_vvf__next_display_price       ON public.vehicle_valuation_feed__next USING btree (display_price);
CREATE INDEX idx_vvf__next_feed_rank           ON public.vehicle_valuation_feed__next USING btree (feed_rank_score DESC);
CREATE INDEX idx_vvf__next_feed_rank_vid       ON public.vehicle_valuation_feed__next USING btree (feed_rank_score DESC, vehicle_id);
CREATE INDEX idx_vvf__next_has_photos          ON public.vehicle_valuation_feed__next USING btree (has_photos);
CREATE INDEX idx_vvf__next_make                ON public.vehicle_valuation_feed__next USING btree (make);
CREATE INDEX idx_vvf__next_source              ON public.vehicle_valuation_feed__next USING btree (discovery_source);
CREATE INDEX idx_vvf__next_updated             ON public.vehicle_valuation_feed__next USING btree (updated_at DESC);
CREATE INDEX idx_vvf__next_vehicle_type        ON public.vehicle_valuation_feed__next USING btree (canonical_vehicle_type);
CREATE INDEX idx_vvf__next_year                ON public.vehicle_valuation_feed__next USING btree (year);
CREATE INDEX idx_vvf__next_event_at            ON public.vehicle_valuation_feed__next USING btree (event_at DESC, vehicle_id);

-- live relacl is arwdDxt for all three roles (pg_class 2026-09-27); reproduced as-is
GRANT ALL ON public.vehicle_valuation_feed__next TO anon, authenticated, service_role;

-- 3. populate under the plan that was measured (hash joins, one batch each; no index probes into nuke_estimates,
--    no parallel gather of wide rows). Session-level, reset right after. The cron/function that refreshes the
--    feed from now on must carry the same settings to get the same time (lead's call; not changed here).
SET work_mem = '256MB';
SET max_parallel_workers_per_gather = 0;
SET enable_indexscan = off;
SET enable_bitmapscan = off;
SET enable_nestloop = off;

REFRESH MATERIALIZED VIEW public.vehicle_valuation_feed__next;

RESET work_mem;
RESET max_parallel_workers_per_gather;
RESET enable_indexscan;
RESET enable_bitmapscan;
RESET enable_nestloop;

ANALYZE public.vehicle_valuation_feed__next;

-- 4. atomic swap, old object kept
BEGIN;

-- refuse an empty or short feed (325,018 rows when measured 2026-09-27 16:24Z)
DO $$
DECLARE n bigint; populated boolean;
BEGIN
  SELECT relispopulated INTO populated FROM pg_class WHERE oid = 'public.vehicle_valuation_feed__next'::regclass;
  IF NOT populated THEN
    RAISE EXCEPTION 'vehicle_valuation_feed__next is not populated; the REFRESH above did not complete';
  END IF;
  SELECT count(*) INTO n FROM public.vehicle_valuation_feed__next;
  IF n < 300000 THEN
    RAISE EXCEPTION 'vehicle_valuation_feed__next holds % rows (325,018 measured 2026-09-27); refusing to swap', n;
  END IF;
END $$;

-- refuse if anything depends on the live feed by OID (vehicle_valuation_feed_with_finds does not exist; if it or
-- anything else appears, re-point it by hand — RAISE, do not guess)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT dep.relname, dep.relkind
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class dep ON dep.oid = rw.ev_class
    WHERE d.refobjid = 'public.vehicle_valuation_feed'::regclass
      AND dep.oid <> d.refobjid
  LOOP
    RAISE EXCEPTION 'feed swap: public.% (relkind %) depends on vehicle_valuation_feed; re-point it by hand and re-run', r.relname, r.relkind;
  END LOOP;
END $$;

ALTER MATERIALIZED VIEW public.vehicle_valuation_feed RENAME TO vehicle_valuation_feed_superseded_20260927b;
ALTER INDEX public.idx_vvf_vehicle_id    RENAME TO idx_vvf_superseded_20260927b_vehicle_id;
ALTER INDEX public.idx_vvf_created       RENAME TO idx_vvf_superseded_20260927b_created;
ALTER INDEX public.idx_vvf_display_price RENAME TO idx_vvf_superseded_20260927b_display_price;
ALTER INDEX public.idx_vvf_feed_rank     RENAME TO idx_vvf_superseded_20260927b_feed_rank;
ALTER INDEX public.idx_vvf_feed_rank_vid RENAME TO idx_vvf_superseded_20260927b_feed_rank_vid;
ALTER INDEX public.idx_vvf_has_photos    RENAME TO idx_vvf_superseded_20260927b_has_photos;
ALTER INDEX public.idx_vvf_make          RENAME TO idx_vvf_superseded_20260927b_make;
ALTER INDEX public.idx_vvf_source        RENAME TO idx_vvf_superseded_20260927b_source;
ALTER INDEX public.idx_vvf_updated       RENAME TO idx_vvf_superseded_20260927b_updated;
ALTER INDEX public.idx_vvf_vehicle_type  RENAME TO idx_vvf_superseded_20260927b_vehicle_type;
ALTER INDEX public.idx_vvf_year          RENAME TO idx_vvf_superseded_20260927b_year;

ALTER MATERIALIZED VIEW public.vehicle_valuation_feed__next RENAME TO vehicle_valuation_feed;
ALTER INDEX public.idx_vvf__next_vehicle_id    RENAME TO idx_vvf_vehicle_id;
ALTER INDEX public.idx_vvf__next_created       RENAME TO idx_vvf_created;
ALTER INDEX public.idx_vvf__next_display_price RENAME TO idx_vvf_display_price;
ALTER INDEX public.idx_vvf__next_feed_rank     RENAME TO idx_vvf_feed_rank;
ALTER INDEX public.idx_vvf__next_feed_rank_vid RENAME TO idx_vvf_feed_rank_vid;
ALTER INDEX public.idx_vvf__next_has_photos    RENAME TO idx_vvf_has_photos;
ALTER INDEX public.idx_vvf__next_make          RENAME TO idx_vvf_make;
ALTER INDEX public.idx_vvf__next_source        RENAME TO idx_vvf_source;
ALTER INDEX public.idx_vvf__next_updated       RENAME TO idx_vvf_updated;
ALTER INDEX public.idx_vvf__next_vehicle_type  RENAME TO idx_vvf_vehicle_type;
ALTER INDEX public.idx_vvf__next_year          RENAME TO idx_vvf_year;
ALTER INDEX public.idx_vvf__next_event_at      RENAME TO idx_vvf_event_at;

-- the new feed must read the swapped-in prices view, nothing superseded
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ref.relname
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class ref ON ref.oid = d.refobjid
    WHERE rw.ev_class = 'public.vehicle_valuation_feed'::regclass
      AND ref.relkind = 'm' AND ref.relname LIKE '%superseded%'
  LOOP
    RAISE EXCEPTION 'feed swap: the new vehicle_valuation_feed reads %; it must read clean_vehicle_prices', r.relname;
  END LOOP;
END $$;

COMMENT ON MATERIALIZED VIEW public.vehicle_valuation_feed IS
  'Feed read model (lean, 20260927190000) plus auction_end_at (safe_to_timestamptz(auction_end_date)) and event_at = COALESCE(sale_date, auction_end_at, created_at): the market event date. The newest/oldest sorts and the feed_rank_score recency term use event_at, so a historical lot loaded today is dated by its auction, not by when it reached Nuke. Refreshed every 6 h by cron 447 (hourly once the BaT lot loader finishes) with the planner settings from 20260927190000.';
COMMENT ON MATERIALIZED VIEW public.vehicle_valuation_feed_superseded_20260927b IS
  'SUPERSEDED 2026-09-27 by 20260927220000 (the lean feed of 20260927190000 without event_at). Kept for verification; drop by hand once the swap is confirmed. Nothing should read this.';

COMMIT;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';


-- 5. Refresh every 6 h with the planner settings the lean definition needs (20260927190000, section 3).
SELECT cron.alter_job(
  job_id   := 447,
  schedule := '35 */6 * * *',
  command  := $cmd$SET statement_timeout = '300s'; SET work_mem = '256MB'; SET max_parallel_workers_per_gather = 0; SET enable_indexscan = off; SET enable_bitmapscan = off; SET enable_nestloop = off; REFRESH MATERIALIZED VIEW CONCURRENTLY public.vehicle_valuation_feed;$cmd$,
  active   := true
);

-- POST-APPLY (read-only):
--   SELECT count(*), count(auction_end_at), count(*) FILTER (WHERE event_at < created_at - interval '2 days') FROM vehicle_valuation_feed;
--   SELECT vehicle_id, event_at, created_at FROM vehicle_valuation_feed ORDER BY event_at DESC, vehicle_id LIMIT 5;
--   SELECT active, schedule FROM cron.job WHERE jobid = 447;     -- true, 35 */6 * * *
