-- Sale rule, part 5 — the valuation feed rebuilt so it refreshes inside 120 s, then swapped in.
-- Session cb179857 / sold-rule, 2026-09-27.
--
-- WHY: vehicle_valuation_feed still holds the 2026-04-10 snapshot (428,072 rows, 301,341 flagged sold by the
-- price rule) and, since the prices swap (20260927173000), depends by OID on clean_vehicle_prices_superseded_20260927.
-- nuke.ag's homepage reads it through supabase/functions/feed-query. Two attempts to populate the identical
-- definition timed out (CI runs 36328918526 at 120 s, 36329429813 at 600 s).
--
-- MEASURED (prod, read-only EXPLAIN ANALYZE, 2026-09-27 15:5x–16:3xZ; plans in scratchpad m0/m1/m2/full_new/v1/v2):
--  * Old definition on a 1/64 slice of vehicles by id, cold: 10.3 s, 285 MB read (x64 ≈ 660 s — the timeout).
--    The two LATERALs are random 8 kB reads on the two biggest tables: vehicle_observations (7.5 GB heap, VM 83.9%
--    all-visible, ≈90 MB per slice ≈ 5.8 GB full) and vehicle_images (35 GB heap, ≈25 MB per slice ≈ 1.6 GB full).
--    This box reads ≈190 MB/s sequentially (count(*) over vehicles: 2.03 GB in 10.6 s) and ≈28 MB/s randomly.
--  * Same query with both LATERALs replaced, full scale, plain session: 119.5 s — nuke_estimates probed by index
--    582,556 times (1.1 GB random) and the vehicles hash spilled to 32 batches at work_mem 7 MB.
--  * With hash-join settings (below) and ne.signal_weights dropped: 67.6 s warm; 44 s of it was
--    "left"(v.description, 300) — vehicles' TOAST is 4 GB and the slice read 1.3 GB of it at random.
--  * With description_snippet no longer computed (this file): 23.7 s warm, 2.3 GB read + 0.9 GB hit; 325,018 rows.
--    Cold bound: 3.2 GB at 190 MB/s ≈ 17 s of I/O plus the same CPU ≈ 45 s. The REFRESH then writes ≈270 MB of heap
--    (+WAL) and builds 11 indexes on 325K rows (maintenance_work_mem 256 MB): estimated 15–25 s more. Expected
--    refresh 45–70 s; the statement runs under this file's 120 s timeout and, if it fails, nothing is swapped.
--
-- WHAT A VISITOR SEES DIFFERENTLY (feed-query outputs thumbnail_url:=primary_image_url, feed_rank_score,
-- display_price/price_source/is_sold, description:=description_snippet and the plain vehicle columns; it never
-- selects observation_count, source_count, photo_count, signal_weights):
--  * primary_image_url (the card photo): was the is_primary image (thumbnail > medium > full, all measured NULL but
--    1 of 10,842 primaries, so in practice its image_url), falling back to vehicles.primary_image_url when no
--    is_primary row. Now vehicles.primary_image_url (recompute_vehicle_primary_image: hero-scored, confirmed,
--    owner-tiered — what HomePage.tsx:224-241 and BrowseVehicles.tsx:563 already show). Slice 04-08 (4,638 feed
--    rows): identical 4,178 (90.1%), a different photo of the same vehicle 447 (9.6%), photo lost 13 (0.3%).
--  * feed_rank_score (the default order): the term LEAST(source_count*10, 50) is gone — no maintained per-vehicle
--    source count exists (vehicle_live_metrics has observation_count and comment_count only) and the aggregate over
--    10.1M observations cannot run in the budget. Global top of the feed (rows scored without the term, the true
--    term then computed for the top 2,000; bound holds: 2,000th score 170 < 200th score 350 − 50): top-50 keeps
--    49/50, top-200 199/200, top-1,000 999/1,000. Inside a random 1/64 slice, where scores are spread: Spearman
--    0.986, top-50 keeps 24/50, mean shift 152 of 4,638 positions. Restoring the term exactly = add source_count /
--    media_count to vehicle_live_metrics in drain_vehicle_metric_queue and backfill through the queue (follow-up).
--  * description (feed-query passes description_snippet through): now NULL. No feed component renders
--    FeedVehicle.description (RecentlyViewed.tsx:218 takes it from its own vehicles query). Computing it cost 44 s.
--  * display_price / price_source / is_sold: from the swapped clean_vehicle_prices (vehicle_sale_basis) instead of
--    the April view — 199,355 of 499,515 rows sold vs 368,645 of 430,705. This is the point of the swap.
--  * Row count: 325,018 vs 428,072 in April. Same WHERE; 412,633 of 757,227 nuke_estimates are is_stale today
--    (268,364 vehicles drop out of the feed on that clause). Data drift, not this definition — flagged, not fixed here.
-- COLUMNS NOBODY RENDERS (kept so feed-query's select list keeps working; values are stated, not approximated):
--  * thumbnail_url, medium_url: NULL (measured NULL for all but 1 of 10,842 primaries anyway).
--  * full_image_url: vehicles.primary_image_url (was the is_primary image_url).
--  * observation_count: vehicles.observation_count (queue-maintained; 10.8% of vehicles in slice 04-08 differ from a
--    live count(*), |Δ| sum 2,053 over 9,619 rows). Never selected by any reader.
--  * source_count, photo_count: NULL — no maintained column; NULL rather than a wrong number.
--  * signal_weights: REMOVED (jsonb, ~half the row width). feed-query never selected it; api-v1-signal and
--    NukeEstimatePanel read nuke_estimates directly. The only column-shape change.
-- Everything else: same expression, current data.
--
-- vehicle_valuation_feed_with_finds: does not exist in prod (to_regclass NULL, 2026-09-27 15:5xZ); feed-query's
-- find_score sort names it and fails today regardless. The dependent guard below is generic.
--
-- HOW (feedback_never_drop_prod_matview_to_edit_it: the DROP here is of the EMPTY scaffold 20260927160000 created
-- at 15:17Z — relispopulated=false, 96 kB, never read; the guard refuses if it has been populated since):
--   1. drop the unpopulated __next; 2. recreate it lean, WITH NO DATA, same 11 indexes, same grants;
--   3. REFRESH under the measured planner settings (session SETs, RESET after) and ANALYZE; 4. one transaction:
--   guards, rename the live feed aside (kept as vehicle_valuation_feed_superseded_20260927), __next into place,
--   indexes to canonical names (idx_vvf_vehicle_id UNIQUE is what CONCURRENTLY needs); lock_timeout 10 s so the
--   ACCESS EXCLUSIVE renames fail rather than queue readers. The superseded feed still hangs off
--   clean_vehicle_prices_superseded_20260927: drop the pair by hand after verification.
-- SCHEMA_LAW: no new table, no new column; one column removed from a read model; old object quarantined.
-- CI applies this with psql -v ON_ERROR_STOP=1 -f (statement by statement, no outer transaction), so the session
-- SETs reach the REFRESH and the swap's BEGIN/COMMIT is its own transaction.
--
-- PRE-APPLY (read-only):
--   SELECT relname, relispopulated FROM pg_class WHERE relname LIKE 'vehicle_valuation_feed%';   -- live true, __next false
--   SELECT count(*) FROM pg_stat_activity WHERE state='active' AND pid<>pg_backend_pid() AND query ILIKE '%vehicle_valuation_feed%';  -- 0
--   SELECT DISTINCT dep.relname FROM pg_depend d JOIN pg_rewrite rw ON rw.oid=d.objid JOIN pg_class dep ON dep.oid=rw.ev_class
--    WHERE d.refobjid='public.vehicle_valuation_feed'::regclass AND dep.oid<>d.refobjid;                       -- none

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
            WHEN GREATEST(v.created_at, v.updated_at) > (now() - '1 day'::interval) THEN 1.0
            WHEN GREATEST(v.created_at, v.updated_at) > (now() - '3 days'::interval) THEN 0.95
            WHEN GREATEST(v.created_at, v.updated_at) > (now() - '7 days'::interval) THEN 0.85
            WHEN GREATEST(v.created_at, v.updated_at) > (now() - '30 days'::interval) THEN 0.50
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

ALTER MATERIALIZED VIEW public.vehicle_valuation_feed RENAME TO vehicle_valuation_feed_superseded_20260927;
ALTER INDEX public.idx_vvf_vehicle_id    RENAME TO idx_vvf_superseded_20260927_vehicle_id;
ALTER INDEX public.idx_vvf_created       RENAME TO idx_vvf_superseded_20260927_created;
ALTER INDEX public.idx_vvf_display_price RENAME TO idx_vvf_superseded_20260927_display_price;
ALTER INDEX public.idx_vvf_feed_rank     RENAME TO idx_vvf_superseded_20260927_feed_rank;
ALTER INDEX public.idx_vvf_feed_rank_vid RENAME TO idx_vvf_superseded_20260927_feed_rank_vid;
ALTER INDEX public.idx_vvf_has_photos    RENAME TO idx_vvf_superseded_20260927_has_photos;
ALTER INDEX public.idx_vvf_make          RENAME TO idx_vvf_superseded_20260927_make;
ALTER INDEX public.idx_vvf_source        RENAME TO idx_vvf_superseded_20260927_source;
ALTER INDEX public.idx_vvf_updated       RENAME TO idx_vvf_superseded_20260927_updated;
ALTER INDEX public.idx_vvf_vehicle_type  RENAME TO idx_vvf_superseded_20260927_vehicle_type;
ALTER INDEX public.idx_vvf_year          RENAME TO idx_vvf_superseded_20260927_year;

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
  'Feed read model, rebuilt 2026-09-27 to refresh inside 120 s: no LATERALs (primary_image_url = vehicles.primary_image_url; observation_count = vehicles.observation_count; source_count, photo_count, thumbnail_url, medium_url, description_snippet are NULL; signal_weights removed; feed_rank_score has no source-count term). is_sold/display_price come from clean_vehicle_prices (vehicle_sale_basis). Refresh with the settings in migration 20260927190000: REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_valuation_feed';
COMMENT ON MATERIALIZED VIEW public.vehicle_valuation_feed_superseded_20260927 IS
  'SUPERSEDED 2026-09-27: the 2026-04-10 snapshot of the old definition, built on clean_vehicle_prices_superseded_20260927 (it depends on it by OID). Kept for verification; drop both by hand once the swap is confirmed. Nothing should read this.';

COMMIT;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

-- POST-APPLY (read-only):
--   SELECT relname, relispopulated FROM pg_class WHERE relname LIKE 'vehicle_valuation_feed%' ORDER BY 1;  -- feed (true), _superseded_20260927 (true)
--   SELECT count(*) FROM pg_indexes WHERE tablename = 'vehicle_valuation_feed';                              -- 11
--   SELECT count(*), count(*) FILTER (WHERE is_sold), max(updated_at) FROM vehicle_valuation_feed;            -- ≈325K, ≈ the new prices view's sold share, today
--   SELECT DISTINCT ref.relname FROM pg_depend d JOIN pg_rewrite rw ON rw.oid=d.objid JOIN pg_class ref ON ref.oid=d.refobjid
--    WHERE rw.ev_class='public.vehicle_valuation_feed'::regclass AND ref.relkind='m';                         -- clean_vehicle_prices
--   -- the surface: feed-query top of feed, then nuke.ag home
--   curl -sS -X POST "$SUPA/functions/v1/feed-query" -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
--     -H "Content-Type: application/json" -d '{"sort":"feed_rank","limit":5}' | jq '.items[] | {id, thumbnail_url, display_price, is_sold, feed_rank_score}'
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.vehicle_valuation_feed;   -- with the section-3 SETs; must fit 120 s
--   SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';   -- 0
