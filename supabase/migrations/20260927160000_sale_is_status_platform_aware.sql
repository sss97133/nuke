-- ============================================================================================
-- HELD — NOT APPLIED. Supersedes the two held files 20260927020000 (clean_vehicle_prices is_sold
-- from status) and 20260927020200 (canonical_outcome from status) with ONE platform-aware rule.
--
-- THE RULE (finance's rule): a trade is never a quote. A row is a SALE when a status says money
-- moved (sale_status='sold' OR auction_outcome='sold'). For rows written BEFORE the cutover
-- (2026-09-27) by extractors that never set a status, a sale may ALSO be proven by that platform's
-- own sale marker, which the writer left on the row — and by nothing else. After the cutover only
-- the status counts; every extractor must write it (change list in the report of 2026-09-27).
--
-- WHAT WAS MEASURED (prod, read-only, 2026-09-27 02:30–04:10Z, session cb179857; every number has
-- its query in scratchpad/rule.sql + the report). Effective platform = canonical_platform, or the
-- listing/discovery URL domain when the platform is NULL/'unknown' (bulk imports ran with triggers
-- disabled), and 'conceptcarz' whenever listing_url starts with conceptcarz:// (those rows carry
-- the auction HOUSE in canonical_platform — 5,789 of them are labelled barrett-jackson, 2,198 mecum,
-- 1,479 rm-sothebys, 833 bonhams — but the data is conceptcarz's unofficial results table).
--
--   platform        rows     sold today  status  proposed  leaving  legacy marker that proves a sale
--   bat             188,662  178,226     120,311 120,311   57,920   none: status only (BaT fix is a separate pass)
--   facebook-mkt    119,218   13,334           0       0   13,334   classifieds: an ASK is never a sale
--   mecum            82,868   73,177         252  12,934   60,243   notes 'Result: sold' (scrape-mecum-lots wrote the
--                                                                   lot's saleResults slug); 4,612 rows say
--                                                                   'Result: bid-goes-on' and hold the HIGH BID in
--                                                                   sale_price; ~55,600 carry no marker at all
--   classic-driver   50,523    2,488           0       0    2,488   classifieds
--   barrett-jackson  46,673   32,612      22,919  32,609        3   sale_price>0: BJ publishes a price only after a
--                                                                   sale (217 no_sale rows: 3 priced; page shows
--                                                                   'Status: Sold')
--   classiccars-com  34,050   30,968           0       0   30,968   classifieds (live page: 'Price: $12,995', For Sale)
--   cars-and-bids    32,060   29,851         694  18,283   11,568   import_metadata.auction_status='sold' (the core
--                                                                   extractor's own page verdict); 6,155 rows are
--                                                                   'reserve_not_met' and 4,000+ 'active' with the
--                                                                   bid copied into sale_price
--   conceptcarz      14,327   13,829       1,815  10,046    3,783   notes "status": "sold" (the site's Sold column);
--                                                                   'unknown' = blank Sold column → not proven
--   craigslist       12,771    7,733          26      26    7,707   classifieds
--   <none>            9,471    1,309         152     152    1,157   oldcaronline / rennlist / thesamba / dealers: asks
--   gooding           8,052    7,137       5,438   7,137        0   sale_price>0: page-data salePrice is null for
--                                                                   unsold lots (verified 2 unsold, 3 sold, live)
--   pcarmarket        6,496    5,348       2,653   2,653    2,696   status only: extractor copies high_bid into
--                                                                   sale_price for live/unsold/marketplace lots
--   bonhams           4,693    2,958       2,917   2,917       41   status only (extractor writes it)
--   jamesedition      2,694    1,056          10      10    1,046   dealer asks
--   beverly-hills-cc  1,989      159          20      20      139   dealer asks
--   broad-arrow       1,305      401          42      42      359   status only: the 359 hold the HIGH ESTIMATE
--   rm-sothebys (non-conceptcarz)                                   status only: 82 'ended' rows hold the LOW
--                                                                   ESTIMATE of unsold lots (extract-rmsothebys:240
--                                                                   'Not Sold'.includes('sold') bug)
--   'entering' (sold under the new rule but not today) is 0 on every platform.
--
-- ONE definition of "sold", used by BOTH the trigger and the matview: vehicle_sale_basis(). It
-- returns the basis text (the DNA of the flag) or NULL. Two places with their own copy of the CASE
-- is the disease this file cures, so the predicate is minted once (SCHEMA_LAW search-before-mint:
-- no existing predicate — backfill_sold_status_from_external_listings / auto_mark_vehicle_sold_*
-- write organization_vehicles from external_listings, they do not decide what a sale is).
--
-- WHAT THIS FILE DOES NOT DO: no row of vehicles is written (rows re-resolve as extractors touch
-- them); no cron is changed — NOTE cron 147 (refresh clean_vehicle_prices) and 447 (refresh
-- vehicle_valuation_feed) are both active=false and both matviews are frozen at 2026-04-10/14
-- (measured: max(updated_at) inside each). Re-enabling them is a separate decision.
--
-- HOW (never DROP a prod matview — feedback_never_drop_prod_matview_to_edit_it):
--   1. vehicle_sale_basis() + trg_resolve_canonical_columns() (CREATE OR REPLACE, instant);
--   2. build clean_vehicle_prices__next (measured: the SELECT alone runs 15 s; ≤ 120 s with indexes);
--   3. build vehicle_valuation_feed__next WITH NO DATA (it is a MATERIALIZED view that depends on
--      clean_vehicle_prices by OID — the earlier held file's DO block would have RAISEd on it),
--      then REFRESH it as its own statement. Its build time is unmeasured (pg_stat_statements has
--      no row; cron 447 runs it with a 600 s budget). If the refresh exceeds this file's 120 s it
--      fails HERE, before any swap, and nothing is changed: re-run that one statement with the
--      budget cron 447 already uses. The old feed keeps serving the whole time.
--   4. ONE transaction: rename both live objects aside (kept, not dropped), rename __next into
--      place, rename indexes to canonical names (the UNIQUE ones are what CONCURRENTLY needs);
--   5. superseded objects stay as *_superseded_20260927 until a human drops them (SCHEMA_LAW §4).
--
-- SCHEMA_LAW: §1 organ exists (these two views + trigger); §2 derived read models; §3 one new
-- column (clean_vehicle_prices.is_sold_basis, appended LAST so every existing reader is unchanged)
-- and one new function; §4 nothing overwritten, old objects quarantined; §5 the invariant
-- "sold ⇒ status (or a cited legacy marker)" lives at the data layer; §6 no writers touched;
-- §7 CI-applied (psql). db-safety: statement_timeout 120 s, no unbounded writes, DDL only after
-- the pre-apply check below.
--
-- PRE-APPLY (run each, stop on any mismatch):
--   -- a. nobody is running DDL/long work on vehicles
--   SELECT count(*) FROM pg_stat_activity WHERE state='active' AND pid<>pg_backend_pid() AND query ILIKE '%vehicles%';   -- must be ≤ 2
--   -- b. the trigger body is still the one this file was transcribed from (live 2026-09-27 03:50Z)
--   SELECT md5(pg_get_functiondef('public.trg_resolve_canonical_columns'::regproc));                  -- da0a86ff9be62d621a88c20ce56c5a27  -- gitleaks:allow (md5 checksum of a function body, not a secret)
--   -- c. both live matviews present, __next names free, superseded names free
--   SELECT relname, relkind FROM pg_class WHERE relname IN ('clean_vehicle_prices','vehicle_valuation_feed','clean_vehicle_prices__next','vehicle_valuation_feed__next','clean_vehicle_prices_superseded_20260927','vehicle_valuation_feed_superseded_20260927');
--   -- d. the only dependent of clean_vehicle_prices is vehicle_valuation_feed (relkind m) and nothing depends on that
--   SELECT DISTINCT dep.relname, dep.relkind FROM pg_depend d JOIN pg_rewrite rw ON rw.oid=d.objid JOIN pg_class dep ON dep.oid=rw.ev_class WHERE d.refobjid='public.clean_vehicle_prices'::regclass AND dep.oid<>d.refobjid;
--   -- e. the population the new rule will flag (compare with the table above; per-platform SQL in the report)
--   SET statement_timeout='120s';
--   SELECT count(*) FILTER (WHERE sale_status='sold' OR auction_outcome='sold') status_sold,
--          count(*) FILTER (WHERE sale_status='sold' OR sale_price>0 OR bat_sold_price>0 OR sold_price>0) price_sold
--   FROM vehicles WHERE deleted_at IS NULL;
-- ============================================================================================

SET statement_timeout = '120s';

-- --------------------------------------------------------------------------------------------
-- 1. THE predicate. NULL = not a sale. Text = why it is one (this is the DNA of is_sold).
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_sale_basis(
  p_sale_status        text,
  p_auction_outcome    text,
  p_canonical_platform text,
  p_listing_url        text,
  p_discovery_url      text,
  p_sale_price         numeric,
  p_notes              text,
  p_import_metadata    jsonb,
  p_created_at         timestamptz
) RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $fn$
  WITH x AS (
    SELECT
      CASE
        WHEN p_listing_url LIKE 'conceptcarz://%' OR p_listing_url LIKE 'https://conceptcarz://%' THEN 'conceptcarz'
        ELSE COALESCE(
          NULLIF(p_canonical_platform, 'unknown'),
          CASE
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'carsandbids\.com'     THEN 'cars-and-bids'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'mecum\.com'           THEN 'mecum'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'barrett-jackson\.com' THEN 'barrett-jackson'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'goodingco\.com'       THEN 'gooding'
            ELSE NULL
          END)
      END AS plat
  )
  SELECT CASE
    -- the rule: a status says money moved
    WHEN p_sale_status = 'sold' OR p_auction_outcome = 'sold' THEN 'status'
    -- after the cutover nothing but a status counts
    WHEN p_created_at >= '2026-09-27 00:00:00+00'::timestamptz THEN NULL
    -- legacy rows: the platform's own sale marker, left on the row by the writer
    WHEN plat = 'mecum'           AND p_sale_price > 0 AND p_notes ~ 'Result: sold'                       THEN 'mecum_sale_result'
    WHEN plat = 'cars-and-bids'   AND p_sale_price > 0 AND p_import_metadata->>'auction_status' = 'sold'  THEN 'cab_auction_status'
    WHEN plat = 'gooding'         AND p_sale_price > 0                                                    THEN 'gooding_sale_price'
    WHEN plat = 'barrett-jackson' AND p_sale_price > 0
         AND p_auction_outcome IS DISTINCT FROM 'no_sale' AND p_sale_status IS DISTINCT FROM 'not_sold'   THEN 'bj_result_price'
    WHEN plat = 'conceptcarz'     AND p_sale_price > 0 AND p_notes ~ '"status": "sold"'                   THEN 'conceptcarz_sold'
    -- everything else (BaT, pcarmarket, bonhams, rm-sothebys, broad-arrow, hagerty, every classified,
    -- every aggregator, unknown): not a sale until a status proves it
    ELSE NULL
  END
  FROM x;
$fn$;

COMMENT ON FUNCTION public.vehicle_sale_basis(text,text,text,text,text,numeric,text,jsonb,timestamptz) IS
  'The one definition of a consummated sale (2026-09-27). NULL = not a sale. ''status'' = sale_status/auction_outcome say sold. The other values are legacy (pre-cutover) platform markers: mecum notes Result: sold; cars-and-bids import_metadata.auction_status=sold; gooding page-data salePrice; barrett-jackson result price (BJ publishes a price only after a sale); conceptcarz Sold column. A price alone is a bid, an ask or an estimate. Used by trg_resolve_canonical_columns and clean_vehicle_prices.';

-- --------------------------------------------------------------------------------------------
-- 2. trg_resolve_canonical_columns: branch 2 asks the predicate. Branches 1 and 3 are the live
--    body verbatim (pg_get_functiondef 2026-09-27; md5 da0a86ff9be62d621a88c20ce56c5a27 is the  -- gitleaks:allow (md5 checksum, not a secret)
--    pre-change body — see PRE-APPLY b).
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_resolve_canonical_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  raw_source TEXT;
  best_price NUMERIC;
  price_type TEXT;
  sale_basis TEXT;
BEGIN
  -- 1. canonical_platform: resolve from first non-null source column
  raw_source := COALESCE(NEW.source, NEW.listing_source, NEW.discovery_source, NEW.auction_source);
  IF raw_source IS NOT NULL THEN
    NEW.canonical_platform := resolve_platform_slug(raw_source);
  ELSE
    NEW.canonical_platform := 'unknown';
  END IF;

  -- 2. canonical_outcome: a consummated sale is a STATUS, or (pre-2026-09-27 rows only) the
  --    platform's own sale marker. A price alone is a bid, an ask or an estimate
  --    (2026-09-27: 30,612 unsold BaT lots, 4,612 Mecum bid-goes-on lots, 6,155 Cars & Bids
  --    reserve-not-met lots and 82 RM Sotheby's low estimates were all sitting in sale_price).
  sale_basis := vehicle_sale_basis(NEW.sale_status, NEW.auction_outcome, NEW.canonical_platform,
                                   NEW.listing_url, NEW.discovery_url, NEW.sale_price::numeric,
                                   NEW.notes, NEW.import_metadata, NEW.created_at);
  IF sale_basis IS NOT NULL THEN
    NEW.canonical_outcome := 'sold';
  ELSIF NEW.sale_status IN ('not_sold', 'unsold', 'bid_to') OR NEW.reserve_status = 'reserve_not_met'
        OR NEW.auction_outcome IN ('reserve_not_met', 'no_sale') THEN
    NEW.canonical_outcome := 'reserve_not_met';
  ELSIF NEW.sale_status IN ('auction_live', 'upcoming') THEN
    NEW.canonical_outcome := 'active';
  ELSIF NEW.sale_status = 'for_sale' OR (COALESCE(NEW.asking_price, 0) > 0 AND COALESCE(NEW.sale_status, 'available') NOT IN ('ended')) THEN
    NEW.canonical_outcome := 'for_sale';
  ELSIF NEW.sale_status = 'ended' THEN
    NEW.canonical_outcome := 'ended';
  ELSIF NEW.sale_status = 'available' AND (COALESCE(NEW.high_bid, 0) > 0 OR COALESCE(NEW.winning_bid, 0) > 0) THEN
    -- Has bids but no sale price → auction ended without clear outcome
    NEW.canonical_outcome := 'ended';
  ELSE
    NEW.canonical_outcome := 'unknown';
  END IF;

  -- 3. canonical_sold_price: context-aware price resolution
  CASE NEW.canonical_outcome
    WHEN 'sold' THEN
      -- Transaction price priority: sale_price > winning_bid > bat_sold_price > sold_price > high_bid > price
      best_price := COALESCE(
        NULLIF(NEW.sale_price, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.sold_price, 0)::NUMERIC,
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.price, 0)::NUMERIC
      );
    WHEN 'for_sale' THEN
      -- Asking price priority
      best_price := COALESCE(
        NULLIF(NEW.asking_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
    WHEN 'reserve_not_met' THEN
      -- Highest bid reached
      best_price := COALESCE(
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
    ELSE
      -- Best available
      best_price := COALESCE(
        NULLIF(NEW.sale_price, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.sold_price, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.asking_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
  END CASE;

  NEW.canonical_sold_price := best_price;

  RETURN NEW;
END;
$function$;

-- --------------------------------------------------------------------------------------------
-- 3. clean_vehicle_prices__next: best_price / price_source / WHERE are byte-identical to the live
--    viewdef (pg_get_viewdef 2026-09-27 00:20Z, as reproduced in held 20260927020000). Only
--    is_sold changes, and is_sold_basis is appended as the LAST column.
-- --------------------------------------------------------------------------------------------
CREATE MATERIALIZED VIEW public.clean_vehicle_prices__next AS
 SELECT v.id AS vehicle_id,
    v.year,
    COALESCE(cm.display_name, v.make) AS make,
    v.model,
    v.canonical_make_id,
    COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric, NULLIF(v.high_bid, 0)::numeric, NULLIF(v.bat_sold_price, 0::numeric), NULLIF(v.asking_price, 0::numeric), NULLIF(v.current_value, 0::numeric)) AS best_price,
        CASE
            WHEN v.sale_price IS NOT NULL AND v.sale_price <> 0 THEN 'sale_price'::text
            WHEN v.winning_bid IS NOT NULL AND v.winning_bid <> 0 THEN 'winning_bid'::text
            WHEN v.high_bid IS NOT NULL AND v.high_bid <> 0 THEN 'high_bid'::text
            WHEN v.bat_sold_price IS NOT NULL AND v.bat_sold_price <> 0::numeric THEN 'bat_sold_price'::text
            WHEN v.asking_price IS NOT NULL AND v.asking_price <> 0::numeric THEN 'asking_price'::text
            WHEN v.current_value IS NOT NULL AND v.current_value <> 0::numeric THEN 'current_value'::text
            ELSE NULL::text
        END AS price_source,
    -- a consummated sale is a status, or a cited legacy marker (vehicle_sale_basis, 2026-09-27)
    (vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url, v.discovery_url,
                        v.sale_price::numeric, v.notes, v.import_metadata, v.created_at) IS NOT NULL) AS is_sold,
    v.created_at,
    v.updated_at,
    vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url, v.discovery_url,
                       v.sale_price::numeric, v.notes, v.import_metadata, v.created_at) AS is_sold_basis
   FROM vehicles v
     LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
  WHERE v.deleted_at IS NULL AND v.price_is_outlier IS NOT TRUE AND COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric, NULLIF(v.high_bid, 0)::numeric, NULLIF(v.bat_sold_price, 0::numeric), NULLIF(v.asking_price, 0::numeric), NULLIF(v.current_value, 0::numeric)) IS NOT NULL AND COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric, NULLIF(v.high_bid, 0)::numeric, NULLIF(v.bat_sold_price, 0::numeric), NULLIF(v.asking_price, 0::numeric), NULLIF(v.current_value, 0::numeric)) >= 100::numeric AND COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric, NULLIF(v.high_bid, 0)::numeric, NULLIF(v.bat_sold_price, 0::numeric), NULLIF(v.asking_price, 0::numeric), NULLIF(v.current_value, 0::numeric)) <= 25000000::numeric;

-- the five live indexes (pg_indexes 2026-09-27 03:55Z), temporary names
CREATE UNIQUE INDEX clean_vehicle_prices__next_vehicle_id_idx ON public.clean_vehicle_prices__next USING btree (vehicle_id);
CREATE INDEX clean_vehicle_prices__next_updated_at_idx ON public.clean_vehicle_prices__next USING btree (updated_at DESC);
CREATE INDEX idx_clean_vehicle_prices__next_make ON public.clean_vehicle_prices__next USING btree (make);
CREATE INDEX idx_clean_vehicle_prices__next_year ON public.clean_vehicle_prices__next USING btree (year);
CREATE INDEX idx_clean_vehicle_prices__next_lower_make_year_price ON public.clean_vehicle_prices__next USING btree (lower(make), year) WHERE (best_price > (0)::numeric);

-- live relacl is arwdDxt for all three roles (pg_class 2026-09-27); reproduced as-is
GRANT ALL ON public.clean_vehicle_prices__next TO anon, authenticated, service_role;

-- --------------------------------------------------------------------------------------------
-- 4. vehicle_valuation_feed__next: the live viewdef (pg_get_viewdef 2026-09-27 03:55Z, saved as
--    scratchpad/vvf_viewdef.sql) with ONLY the cvp join re-pointed at clean_vehicle_prices__next.
--    Built empty, refreshed as its own statement (see HOW 3).
-- --------------------------------------------------------------------------------------------
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
    COALESCE(pi.thumbnail_url, pi.medium_url, pi.image_url, v.primary_image_url) AS primary_image_url,
    pi.thumbnail_url,
    pi.medium_url,
    pi.image_url AS full_image_url,
    "left"(v.description, 300) AS description_snippet,
    COALESCE(os.observation_count, 0::bigint) AS observation_count,
    COALESCE(os.source_count, 0::bigint) AS source_count,
    COALESCE(os.photo_count, 0::bigint) AS photo_count,
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
    ne.signal_weights,
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
        END::numeric + LEAST(COALESCE(os.source_count, 0::bigint) * 10, 50::bigint)::numeric AS feed_rank_score
   FROM vehicles v
     LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
     LEFT JOIN clean_vehicle_prices__next cvp ON cvp.vehicle_id = v.id
     LEFT JOIN nuke_estimates ne ON ne.vehicle_id = v.id
     LEFT JOIN record_prices rp ON COALESCE(cm.canonical_name, v.make) = rp.make AND v.model = rp.model AND v.year >= rp.year_start AND v.year <= rp.year_end
     LEFT JOIN LATERAL ( SELECT vi.thumbnail_url,
            vi.medium_url,
            vi.image_url
           FROM vehicle_images vi
          WHERE vi.vehicle_id = v.id AND vi.is_primary = true
         LIMIT 1) pi ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS observation_count,
            count(DISTINCT vo.source_id) AS source_count,
            count(*) FILTER (WHERE vo.kind = 'media'::observation_kind) AS photo_count
           FROM vehicle_observations vo
          WHERE vo.vehicle_id = v.id) os ON true
  WHERE v.deleted_at IS NULL AND (v.status <> ALL (ARRAY['deleted'::text, 'merged'::text, 'duplicate'::text])) AND (ne.is_stale IS NOT TRUE OR ne.id IS NULL) AND v.year IS NOT NULL AND v.make IS NOT NULL AND NOT (upper(COALESCE(cm.canonical_name, v.make)) IN ( SELECT upper(non_auto_makes_excluded.make) AS upper
           FROM non_auto_makes_excluded))
WITH NO DATA;

-- the eleven live indexes (pg_indexes 2026-09-27 03:55Z), temporary names
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

GRANT ALL ON public.vehicle_valuation_feed__next TO anon, authenticated, service_role;

-- Populate the new feed BEFORE the swap. Its own statement on purpose: if it cannot finish in
-- 120 s the migration stops here with nothing swapped and the old feed still serving. Re-run just
-- this statement with the budget cron 447 already uses for the same work (600 s) — an operator
-- decision, not this file's.
REFRESH MATERIALIZED VIEW public.vehicle_valuation_feed__next;

-- --------------------------------------------------------------------------------------------
-- 5. atomic swap, old objects kept
-- --------------------------------------------------------------------------------------------
BEGIN;

-- refuse to swap an empty feed
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_valuation_feed__next;
  IF n < 100000 THEN
    RAISE EXCEPTION 'vehicle_valuation_feed__next holds % rows (live feed had 428,072 on 2026-09-27); refresh it before swapping', n;
  END IF;
END $$;

ALTER MATERIALIZED VIEW public.clean_vehicle_prices RENAME TO clean_vehicle_prices_superseded_20260927;
ALTER INDEX public.clean_vehicle_prices_vehicle_id_idx            RENAME TO clean_vehicle_prices_superseded_20260927_vehicle_id_idx;
ALTER INDEX public.clean_vehicle_prices_updated_at_idx            RENAME TO clean_vehicle_prices_superseded_20260927_updated_at_idx;
ALTER INDEX public.idx_clean_vehicle_prices_make                  RENAME TO idx_clean_vehicle_prices_superseded_20260927_make;
ALTER INDEX public.idx_clean_vehicle_prices_year                  RENAME TO idx_clean_vehicle_prices_superseded_20260927_year;
ALTER INDEX public.idx_clean_vehicle_prices_lower_make_year_price RENAME TO idx_clean_vehicle_prices_superseded_20260927_lower_make_year_price;

ALTER MATERIALIZED VIEW public.clean_vehicle_prices__next RENAME TO clean_vehicle_prices;
ALTER INDEX public.clean_vehicle_prices__next_vehicle_id_idx            RENAME TO clean_vehicle_prices_vehicle_id_idx;
ALTER INDEX public.clean_vehicle_prices__next_updated_at_idx            RENAME TO clean_vehicle_prices_updated_at_idx;
ALTER INDEX public.idx_clean_vehicle_prices__next_make                  RENAME TO idx_clean_vehicle_prices_make;
ALTER INDEX public.idx_clean_vehicle_prices__next_year                  RENAME TO idx_clean_vehicle_prices_year;
ALTER INDEX public.idx_clean_vehicle_prices__next_lower_make_year_price RENAME TO idx_clean_vehicle_prices_lower_make_year_price;

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

-- nothing else may still hang off the superseded objects (the superseded feed hanging off the
-- superseded prices view is expected; anything else means a new dependent appeared since
-- 2026-09-27 and must be re-pointed by hand — RAISE, do not guess)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT dep.relname, dep.relkind
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class dep ON dep.oid = rw.ev_class
    WHERE d.refobjid IN ('public.clean_vehicle_prices_superseded_20260927'::regclass,
                         'public.vehicle_valuation_feed_superseded_20260927'::regclass)
      AND dep.oid NOT IN ('public.clean_vehicle_prices_superseded_20260927'::regclass,
                          'public.vehicle_valuation_feed_superseded_20260927'::regclass)
  LOOP
    RAISE EXCEPTION 'sale-rule swap: %.% (relkind %) still depends on a superseded matview; re-point it by hand and re-run', 'public', r.relname, r.relkind;
  END LOOP;
END $$;

COMMENT ON MATERIALIZED VIEW public.clean_vehicle_prices IS
  'Resolved best_price per vehicle, excluding outliers and unreasonable values. is_sold = vehicle_sale_basis(...) IS NOT NULL since 2026-09-27 (a status, or a cited pre-cutover platform marker; is_sold_basis says which). A price alone is a bid, an ask or an estimate. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY clean_vehicle_prices';
COMMENT ON MATERIALIZED VIEW public.clean_vehicle_prices_superseded_20260927 IS
  'SUPERSEDED 2026-09-27 by the platform-aware sale rule (held migration 20260927030000). Kept for verification; drop by hand once the swap is confirmed. Nothing should read this.';
COMMENT ON MATERIALIZED VIEW public.vehicle_valuation_feed IS
  'Feed read model. Rebuilt 2026-09-27 to follow the clean_vehicle_prices swap (same definition; is_sold now comes from vehicle_sale_basis). Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_valuation_feed';
COMMENT ON MATERIALIZED VIEW public.vehicle_valuation_feed_superseded_20260927 IS
  'SUPERSEDED 2026-09-27 (depended by OID on the superseded clean_vehicle_prices). Kept for verification; drop by hand after the swap is confirmed. Nothing should read this.';

COMMIT;

-- ============================================================================================
-- POST-APPLY (read-only; each must hold):
--   -- 1. both canonical names resolve to the NEW objects and the superseded pair exists
--   SELECT relname, relkind FROM pg_class WHERE relname LIKE 'clean_vehicle_prices%' OR relname LIKE 'vehicle_valuation_feed%' ORDER BY 1;
--   -- 2. canonical index names are in place (5 + 11), incl. the UNIQUE ones CONCURRENTLY needs
--   SELECT tablename, count(*) FROM pg_indexes WHERE tablename IN ('clean_vehicle_prices','vehicle_valuation_feed') GROUP BY 1;   -- 5, 11
--   -- 3. the sold population by basis — compare with the header table
--   SELECT is_sold_basis, count(*) FROM clean_vehicle_prices GROUP BY 1 ORDER BY 2 DESC;
--        -- expected order of magnitude (2026-09-27 measurement over vehicles): status ≈ 157K,
--        -- cab_auction_status ≈ 17.6K, mecum_sale_result ≈ 12.7K, bj_result_price ≈ 9.7K,
--        -- conceptcarz_sold ≈ 8.2K, gooding_sale_price ≈ 1.7K, NULL = the rest
--   -- 4. no unsold-marked row is flagged sold
--   SELECT count(*) FROM clean_vehicle_prices c JOIN vehicles v ON v.id=c.vehicle_id
--    WHERE c.is_sold AND (v.notes ~ 'Result: bid-goes-on' OR v.import_metadata->>'auction_status'='reserve_not_met' OR v.auction_outcome IN ('reserve_not_met','no_sale'))
--      AND v.sale_status IS DISTINCT FROM 'sold' AND v.auction_outcome IS DISTINCT FROM 'sold';   -- 0
--   -- 5. the feed still reads is_sold from the new prices view
--   SELECT DISTINCT dep.relname FROM pg_depend d JOIN pg_rewrite rw ON rw.oid=d.objid JOIN pg_class dep ON dep.oid=rw.ev_class
--    WHERE d.refobjid='public.clean_vehicle_prices'::regclass AND dep.oid<>d.refobjid;               -- vehicle_valuation_feed
--   -- 6. the trigger resolves a marker-less price as NOT sold (pure read: call the predicate)
--   SELECT vehicle_sale_basis('available', NULL, 'mecum', 'https://mecum.com/lots/1/x', NULL, 43000, NULL, NULL, '2026-01-26'),      -- NULL
--          vehicle_sale_basis('available', NULL, 'mecum', 'https://mecum.com/lots/1/x', NULL, 25300, 'x | Result: sold | y', NULL, '2026-01-26'),  -- mecum_sale_result
--          vehicle_sale_basis('available', NULL, 'mecum', 'https://mecum.com/lots/1/x', NULL, 25300, 'x | Result: sold | y', NULL, '2026-10-01'),  -- NULL (post-cutover)
--          vehicle_sale_basis('sold', NULL, 'facebook-marketplace', NULL, NULL, 3000, NULL, NULL, '2026-10-01');                       -- status
--   -- 7. CONCURRENTLY still works on both (needs the unique indexes)
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.clean_vehicle_prices;
--   -- 8. no lock cascade
--   SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';                                 -- 0
--
-- AFTER THE SWAP IS CONFIRMED (separate, human decisions — not in this file):
--   - cron 147 / 447 are inactive (active=false) and both views were frozen since April; decide.
--   - compute-vehicle-valuation must filter comps on is_sold (it only weights them ×1.2 today,
--     supabase/functions/compute-vehicle-valuation/index.ts:453).
--   - the extractor change list (report 2026-09-27) so post-cutover rows carry sale_status.
-- ============================================================================================

-- Make PostgREST see the swapped objects immediately (Supabase's DDL watcher normally does this too).
NOTIFY pgrst, 'reload schema';
