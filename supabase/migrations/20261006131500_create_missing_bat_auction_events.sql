-- Lane M (missing lots), 2026-10-06: create the auction_events row for BaT lots that were never written, from the
-- evidence rows the database already holds. No page is fetched; nothing is inferred beyond the rules below.
--
-- Population (prod, read-only exports 2026-10-06 ~10:40Z; lane L's lot-overlap.sql definition, lower-cased slug):
--   254,825 distinct BaT lots across auction_events, vehicle_events and bat_listings; 19,126 have no auction_events row
--   on any vehicle. Of those 19,126:
--     15,729 have exactly one vehicle_events row (one vehicle each); 15,663 of them also a bat_listings row.
--        Written 2026-01/02 (extract-auction-comments era: external_listings, moved into vehicle_events on 03-07).
--        The January extractor ran "without auction_event_id" when no lot row existed, so these lots were never
--        written, not deleted.
--     36 have only a bat_listings row that names a vehicle.
--     3,361 have only a bat-closed-lots-sync feed row with no vehicle. Of those, 2,231 have comment rows that all carry
--        one vehicle_id (147,427 comments, 0 lots with dissent; lane L's exact pass 08:26Z); 1,130 have no comments
--        and need a page read.
--   Where vehicle_events and bat_listings both describe a lot they agree (status 15,563/15,563, high bid 15,520/15,520,
--   sale price 923/927): bat_listings was copied from the same read.
--
-- One lot = one lower-cased BaT listing slug, lower(substring(url FROM 'bringatrailer\.com/listing/([^/?#]+)')). Every
-- check looks the slug up across all rows of a table (idx_auction_events_bat_lot_slug, idx_vehicle_events_bat_lot_slug,
-- idx_bat_listings_lot_slug, idx_auction_comments_unkeyed_lot_slug), so case, junk trailing paths (/contact, /N/A),
-- query strings and scheme variants of one lot are all seen (export 2026-10-06: vehicle_events 766 junk-path and 170
-- upper-case BaT URLs; bat_listings 979 and 174; auction_events 815 and 183).
--
-- What the function copies, and what it refuses:
--   vehicle_id; source 'bat'; source_url = 'https://bringatrailer.com/listing/' || slug, the lot's canonical URL (what
--   extract-bat-core's canonicalUrl gives for a clean lot URL, so a later page read upserts onto this row instead of
--   making a twin); the evidence row's own URL is kept in raw_data.evidence.evidence_url.
--   outcome 'sold' when the evidence status is sold with a sale price; 'bid_to' when it ended with a high bid and no
--   sale price (extract-bat-core's rule for a lot with a bid and no sale; the evidence never says reserve-not-met).
--   high_bid, winning_bid (sold only), winning_bidder (sold only), seller_name: copied only when every evidence row
--   that carries the field agrees on one value; else NULL.
--   auction_end_date: vehicle_events.ended_at, else sold_at for a sold lot, else bat_listings.auction_end_date at
--   00:00 UTC (extract-bat-core's own fallback when only the date is known); the feed pass uses the feed's exact
--   timestamp_end. Else NULL: 15,531 of the vehicle_events lots have none.
--   lot_number, source_listing_id, total_bids, comments_count, page_views, watchers, unique_bidders: NULL. The evidence
--   values are counts of parsed comments or ids of uncertain kind, not the page fields these columns mean; they are
--   kept verbatim in raw_data.evidence.
--   scraped_at: NULL. No page was read by this writer; raw_data.evidence keeps the evidence rows' own clocks.
--   created_at, updated_at: now() (ingest clock of the lot row).
--   raw_data: extractor create_missing_bat_auction_events, derivation 'derived-from-retained-evidence 2026-10-06',
--   the evidence row ids and their values.
-- Skipped and counted, never written (every scanned row lands in exactly one count: created or a reason):
--   lot_exists        any vehicle already has a lot row for this slug
--   no_slug           the URL has no listing slug; no_vehicle: the evidence row names no vehicle
--   vehicle_missing   the vehicle row no longer exists (522 lots; auction_events.vehicle_id is a checked FK for new rows)
--   vehicle_retired   merged, deleted or duplicate vehicle
--   lot_on_several_vehicles  evidence rows for the slug name more than one vehicle (never guessed)
--   read_while_live   the evidence was read while the lot ran (23 lots): it holds no result
--   no_result         no sale price for a sold status, no high bid for an ended status, or an unknown status
--   implausible_price a sale or high bid under $500 (124 lots: a 2023 718 GT4 RS "sold for $190", a RUF "for $1";
--                     prices read without their k or M multiplier). Snapshots exist for a page re-read.
--   conflicting_evidence  the evidence rows of the lot disagree (status, price, dates, handles, an ended status with a
--                     sale price, an end date after today (UTC dates), or comment URLs that are not the lot URL)
--   vehicle_events_holds_lot, bat_listings_names_vehicle  a later pass leaves the lot to the pass that owns its evidence
--   no_comment_vehicle, comment_vehicles_dissent  (feed pass) no comment rows; or they carry no vehicle or two
--   same_lot_other_row  a second eligible evidence row for the same lot in the same call (ranked among eligible rows
--                     only, after every other reason)
--
-- Third pass (lead's ruling 2026-10-06), p_source 'bat_listings_comment_vehicle': a lot recorded only by a feed row with no
-- vehicle is created with the vehicle_id its comment rows carry, when every comment row on that lot carries the same one
-- (at least one comment, no comment without a vehicle, no second vehicle) and their URL is the lot URL. The lander set
-- those vehicle_ids from the same URL match, so the vehicle is a retained key. raw_data.evidence.vehicle_basis =
-- 'vehicle_from_comment_rows' with the comment row count. Needs idx_auction_comments_unkeyed_lot_slug.
--
-- Side effect: an inserted 'sold' row fires trg_auto_create_transfer_on_auction_close (pg_net call to transfer-automator,
-- seed_from_auction), as any new sold lot does; expected ~2,604 calls over the whole run. It is throttled by batch: the
-- runner creates about 25 lots per call, 3 s apart. p_fire_transfers false (default true) skips it for the lots of that
-- call: the function sets app.seed_transfers 'off' for its own transaction and the trigger function (replaced below,
-- guarded by its live fingerprint) returns before the call. No suppression by default.
--
-- Shape: walks vehicle_events or bat_listings by physical block range like key_auction_comment_lots (20261006110000).
-- Each pass leaves to the pass that owns it every lot that earlier evidence holds, so the passes can run in any order.
-- Works in whole heap blocks: a call stops after the block in which it reaches p_batch lots (so at most one block's rows
-- over p_batch), and every evidence row is passed and counted exactly once.
-- Settings: app.writer and app.seed_transfers are set with set_config(..., true), so they last only for the calling
-- transaction (one function call in autocommit); app.seed_transfers is reset before the function returns.
-- Requires the slug indexes (refuses to run without them). Caller sets statement_timeout (1..60 s). Idempotent: a lot
-- it created is lot_exists on the next pass.
-- No lot row is changed by this migration. Rows change only when the function is called.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- The transfer trigger function gains an opt-out read from app.seed_transfers; the rest of the body is the live one.
-- Drift guard: PRE is md5(pg_get_functiondef) of the live definition, read from prod 2026-10-06 ~12:45Z and reproduced on
-- a local PostgreSQL 17.9 from the same text. A mismatch refuses the whole migration (fail closed). POST is asserted
-- after the replacement; a re-run on the POST body skips the replacement.
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.auto_create_transfer_on_auction_close()'::regprocedure));
  IF f = '797a4e97cd2c7ae54082c3afe6277ae8' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE NOTICE 'auto_create_transfer_on_auction_close already reads app.seed_transfers';
  ELSIF f <> '29cd0119a2a2fae0e77d0962c68a0dd0' THEN -- gitleaks:allow (live fingerprint read from prod 2026-10-06, not a secret)
    RAISE EXCEPTION 'auto_create_transfer_on_auction_close drifted since 2026-10-06 (md5 %); review before replacement', f;
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.auto_create_transfer_on_auction_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- A transaction that set app.seed_transfers to 'off' (create_missing_bat_auction_events, p_fire_transfers false)
  -- seeds no transfer. Unset or any other value: the call below, as before.
  IF current_setting('app.seed_transfers', true) = 'off' THEN
    RETURN NEW;
  END IF;
  IF NEW.outcome IS DISTINCT FROM 'sold' THEN
    RETURN NEW;
  END IF;
  IF OLD.outcome = 'sold' THEN
    RETURN NEW;
  END IF;

  v_key := COALESCE(
    (SELECT value FROM public._app_secrets WHERE key = 'service_role_key' LIMIT 1),
    current_setting('app.settings.service_role_key', true),
    current_setting('app.service_role_key', true)
  );

  v_url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-automator';

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_key, '')
      ),
      body := jsonb_build_object(
        'action', 'seed_from_auction',
        'auction_event_id', NEW.id::text
      ),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[auto_create_transfer] pg_net call failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DO $post$ BEGIN
  IF md5(pg_get_functiondef('public.auto_create_transfer_on_auction_close()'::regprocedure)) <> '797a4e97cd2c7ae54082c3afe6277ae8' THEN -- gitleaks:allow (fingerprint, not a secret)
    RAISE EXCEPTION 'auto_create_transfer_on_auction_close replacement did not produce the expected body; rolling back';
  END IF;
END $post$;

CREATE OR REPLACE FUNCTION public.create_missing_bat_auction_events(
  p_batch integer DEFAULT 25,
  p_from_block bigint DEFAULT 0,
  p_source text DEFAULT 'vehicle_events',
  p_scan_blocks integer DEFAULT 200,
  p_fire_transfers boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_block constant bigint := 4294967295;  -- largest block number a tid can hold
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_catalog.pg_settings WHERE name = 'statement_timeout');
  v_rel regclass;
  v_table_blocks bigint;
  v_end bigint;
  v_lo tid;
  v_hi tid;
  v_res record;
  v_sql text;
  v_idx text;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 500 THEN
    RAISE EXCEPTION 'create_missing_bat_auction_events: p_batch must be 1..500, got %', p_batch;
  END IF;
  IF p_from_block IS NULL OR p_from_block < 0 THEN
    RAISE EXCEPTION 'create_missing_bat_auction_events: p_from_block must be >= 0, got %', p_from_block;
  END IF;
  IF p_scan_blocks IS NULL OR p_scan_blocks < 1 OR p_scan_blocks > 5000 THEN
    RAISE EXCEPTION 'create_missing_bat_auction_events: p_scan_blocks must be 1..5000, got %', p_scan_blocks;
  END IF;
  IF p_fire_transfers IS NULL THEN
    RAISE EXCEPTION 'create_missing_bat_auction_events: p_fire_transfers must be true or false';
  END IF;
  IF p_source = 'vehicle_events' THEN
    v_rel := 'public.vehicle_events'::regclass;
  ELSIF p_source IN ('bat_listings', 'bat_listings_comment_vehicle') THEN
    v_rel := 'public.bat_listings'::regclass;
  ELSE
    RAISE EXCEPTION 'create_missing_bat_auction_events: p_source must be vehicle_events, bat_listings or bat_listings_comment_vehicle, got %', p_source;
  END IF;
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'create_missing_bat_auction_events: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  -- Every slug lookup has its index; without one the check would scan a heap per row.
  FOREACH v_idx IN ARRAY CASE WHEN p_source = 'bat_listings_comment_vehicle'
      THEN ARRAY['idx_auction_events_bat_lot_slug', 'idx_vehicle_events_bat_lot_slug', 'idx_bat_listings_lot_slug',
                 'idx_auction_comments_unkeyed_lot_slug']
      ELSE ARRAY['idx_auction_events_bat_lot_slug', 'idx_vehicle_events_bat_lot_slug', 'idx_bat_listings_lot_slug'] END
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_idx AND i.indisvalid AND i.indisready
    ) THEN
      RAISE EXCEPTION 'create_missing_bat_auction_events: valid index % is required (migrations 20261006130000/133000, 130500, 133500)', v_idx;
    END IF;
  END LOOP;

  v_table_blocks := pg_catalog.pg_relation_size(v_rel) / current_setting('block_size')::bigint;
  IF p_from_block >= v_table_blocks OR p_from_block >= c_max_block THEN
    RETURN jsonb_build_object(
      'source', p_source, 'created', 0, 'created_sold', 0, 'created_bid_to', 0, 'insert_conflicts', 0,
      'skipped', '{}'::jsonb, 'evidence_rows_scanned', 0, 'fire_transfers', p_fire_transfers,
      'from_block', p_from_block, 'next_block', p_from_block, 'blocks_scanned', 0,
      'table_blocks', v_table_blocks, 'remaining_blocks', 0, 'done', true);
  END IF;

  -- Both settings last only for this transaction (set_config is_local = true).
  PERFORM set_config('app.writer', 'create-missing-bat-lots', true);
  PERFORM set_config('app.seed_transfers', CASE WHEN p_fire_transfers THEN 'on' ELSE 'off' END, true);

  v_end := least(p_from_block + p_scan_blocks, c_max_block);
  v_lo := format('(%s,0)', p_from_block)::tid;
  v_hi := format('(%s,0)', v_end)::tid;

  -- Evidence rows of the block range ($1..$2). The slug expression is written out (not a parameter) so the planner
  -- matches the slug indexes. Ranking for same_lot_other_row happens only among rows no other reason skipped.
  IF p_source = 'vehicle_events' THEN
    v_sql := $q$
    WITH scan AS MATERIALIZED (
      SELECT e.id, e.ctid AS row_tid, ((e.ctid::text)::point)[0]::bigint AS blk, e.vehicle_id, e.source_url AS evidence_url,
             lower(substring(e.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) AS slug
      FROM public.vehicle_events e
      WHERE e.ctid >= $1 AND e.ctid < $2
        AND e.source_platform = 'bat'
        AND e.source_url LIKE '%bringatrailer.com/listing/%'
    ), lots AS MATERIALIZED (
      SELECT s.*, 'https://bringatrailer.com/listing/' || s.slug AS url,
             EXISTS (SELECT 1 FROM public.auction_events a
                     WHERE lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = s.slug) AS has_lot
      FROM scan s
      WHERE s.slug IS NOT NULL AND s.vehicle_id IS NOT NULL
    ), cand AS MATERIALIZED (
      SELECT l.id, l.row_tid, l.blk, l.vehicle_id, l.url, l.slug, l.evidence_url,
             e.event_status AS status, e.final_price AS sale, e.current_price AS high,
             e.ended_at, e.sold_at,
             nullif(btrim(e.seller_identifier), '') AS seller_a, nullif(btrim(e.metadata->>'seller_username'), '') AS seller_b,
             nullif(btrim(e.buyer_identifier), '') AS buyer_a, nullif(btrim(e.metadata->>'buyer_username'), '') AS buyer_b,
             coalesce(e.metadata->>'source', e.extraction_method, e.extraction_source) AS writer,
             e.metadata->>'sold_at_method' AS sold_at_method, e.metadata->>'last_extracted_at' AS last_extracted_at,
             e.source_listing_id, e.bid_count, e.comment_count, e.view_count, e.watcher_count,
             e.created_at AS row_created_at, e.updated_at AS row_updated_at,
             vh.id IS NOT NULL AS vehicle_exists,
             (vh.merged_into_vehicle_id IS NOT NULL OR vh.deleted_at IS NOT NULL
              OR coalesce(vh.status, '') IN ('merged', 'deleted', 'duplicate')) AS vehicle_retired,
             o.n_other_vehicles, o.n_versions,
             b.bl_ids, b.bl_n_status, b.bl_status, b.bl_n_sale, b.bl_sale, b.bl_n_final, b.bl_final,
             b.bl_n_seller, b.bl_seller, b.bl_n_buyer, b.bl_buyer, b.bl_n_end, b.bl_end
      FROM lots l
      JOIN public.vehicle_events e ON e.id = l.id
      LEFT JOIN public.vehicles vh ON vh.id = l.vehicle_id
      CROSS JOIN LATERAL (
        SELECT count(DISTINCT x.vehicle_id) FILTER (WHERE x.vehicle_id <> l.vehicle_id) AS n_other_vehicles,
               count(DISTINCT (x.event_status, x.final_price, x.current_price, x.ended_at, x.sold_at))
                 FILTER (WHERE x.vehicle_id = l.vehicle_id) AS n_versions
        FROM public.vehicle_events x
        WHERE lower(substring(x.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = l.slug
          AND x.source_platform = 'bat'
      ) o
      CROSS JOIN LATERAL (
        SELECT array_agg(x.id ORDER BY x.id) AS bl_ids,
               count(DISTINCT x.listing_status) AS bl_n_status, min(x.listing_status) AS bl_status,
               count(DISTINCT x.sale_price) AS bl_n_sale, min(x.sale_price) AS bl_sale,
               count(DISTINCT x.final_bid) AS bl_n_final, min(x.final_bid) AS bl_final,
               count(DISTINCT nullif(btrim(x.seller_username), '')) AS bl_n_seller, min(nullif(btrim(x.seller_username), '')) AS bl_seller,
               count(DISTINCT nullif(btrim(x.buyer_username), '')) AS bl_n_buyer, min(nullif(btrim(x.buyer_username), '')) AS bl_buyer,
               count(DISTINCT x.auction_end_date) AS bl_n_end, min(x.auction_end_date) AS bl_end
        FROM public.bat_listings x
        WHERE lower(substring(x.bat_listing_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = l.slug
          AND x.vehicle_id = l.vehicle_id
      ) b
      WHERE NOT l.has_lot
    ), shaped AS MATERIALIZED (
      SELECT c.*,
             CASE WHEN c.ended_at IS NOT NULL THEN c.ended_at
                  WHEN c.status = 'sold' AND c.sold_at IS NOT NULL THEN c.sold_at
                  WHEN c.bl_n_end = 1 THEN c.bl_end::timestamp AT TIME ZONE 'UTC' END AS end_at,
             CASE WHEN c.ended_at IS NOT NULL THEN 'vehicle_events.ended_at'
                  WHEN c.status = 'sold' AND c.sold_at IS NOT NULL THEN 'vehicle_events.sold_at'
                  WHEN c.bl_n_end = 1 THEN 'bat_listings.auction_end_date at 00:00 UTC' END AS end_from,
             CASE WHEN c.bl_n_seller > 1 THEN NULL
                  ELSE (SELECT CASE WHEN count(DISTINCT v) = 1 THEN min(v) END
                        FROM unnest(ARRAY[c.seller_a, c.seller_b, c.bl_seller]) v) END AS seller,
             CASE WHEN c.bl_n_buyer > 1 THEN NULL
                  ELSE (SELECT CASE WHEN count(DISTINCT v) = 1 THEN min(v) END
                        FROM unnest(ARRAY[c.buyer_a, c.buyer_b, c.bl_buyer]) v) END AS buyer
      FROM cand c
    ), cls AS MATERIALIZED (
      SELECT s.*,
             CASE
               WHEN NOT s.vehicle_exists THEN 'vehicle_missing'
               WHEN s.vehicle_retired THEN 'vehicle_retired'
               WHEN s.n_other_vehicles > 0 THEN 'lot_on_several_vehicles'
               WHEN s.n_versions > 1 THEN 'conflicting_evidence'
               WHEN s.status IN ('active', 'live', 'bid-goes-on', 'pending', 'listed') THEN 'read_while_live'
               WHEN s.status = 'sold' AND s.sale IS NULL THEN 'no_result'
               WHEN s.status = 'sold' AND s.sale < 500 THEN 'implausible_price'
               WHEN s.status = 'ended' AND s.sale IS NOT NULL THEN 'conflicting_evidence'
               WHEN s.status = 'ended' AND s.high IS NULL THEN 'no_result'
               WHEN s.status = 'ended' AND s.high < 500 THEN 'implausible_price'
               WHEN s.status IS DISTINCT FROM 'sold' AND s.status IS DISTINCT FROM 'ended' THEN 'no_result'
               WHEN s.bl_n_status > 1 OR s.bl_n_sale > 1 OR s.bl_n_final > 1 THEN 'conflicting_evidence'
               WHEN s.bl_status IS NOT NULL AND s.bl_status <> s.status THEN 'conflicting_evidence'
               WHEN s.status = 'sold' AND s.bl_sale IS NOT NULL AND s.bl_sale <> s.sale THEN 'conflicting_evidence'
               WHEN s.status = 'ended' AND s.bl_sale IS NOT NULL THEN 'conflicting_evidence'
               WHEN s.status = 'ended' AND s.bl_final IS NOT NULL AND s.bl_final <> s.high THEN 'conflicting_evidence'
               WHEN (s.end_at AT TIME ZONE 'UTC')::date > (now() AT TIME ZONE 'UTC')::date THEN 'conflicting_evidence'
             END AS base_reason
      FROM shaped s
    ), ranked AS MATERIALIZED (
      SELECT c.*, coalesce(c.base_reason,
               CASE WHEN row_number() OVER (PARTITION BY (c.base_reason IS NULL), c.vehicle_id, c.slug ORDER BY c.row_tid) > 1
                    THEN 'same_lot_other_row' END) AS skip_reason
      FROM cls c
    ), numbered AS MATERIALIZED (
      SELECT r.*, CASE WHEN r.skip_reason IS NULL
                       THEN row_number() OVER (PARTITION BY (r.skip_reason IS NULL) ORDER BY r.row_tid) END AS create_rn
      FROM ranked r
    ), cut AS MATERIALIZED (
      -- Whole blocks only: stop after the block that holds the p_batch-th creatable row, so no row is revisited.
      SELECT CASE WHEN count(*) FILTER (WHERE create_rn IS NOT NULL) > $3
                  THEN min(blk) FILTER (WHERE create_rn = $3) + 1 ELSE $4 END AS next_block
      FROM numbered
    ), ins AS (
      INSERT INTO public.auction_events (
        vehicle_id, source, source_url, source_listing_id, lot_number, auction_end_date, outcome,
        high_bid, winning_bid, winning_bidder, seller_name, total_bids, unique_bidders, comments_count,
        page_views, watchers, scraped_at, raw_data)
      SELECT r.vehicle_id, 'bat', r.url, NULL, NULL, r.end_at,
             CASE WHEN r.status = 'sold' THEN 'sold' ELSE 'bid_to' END,
             CASE WHEN r.status = 'sold' THEN r.sale ELSE r.high END,
             CASE WHEN r.status = 'sold' THEN r.sale END,
             CASE WHEN r.status = 'sold' THEN r.buyer END,
             r.seller, NULL, NULL, NULL, NULL, NULL, NULL,
             jsonb_build_object(
               'extractor', 'create_missing_bat_auction_events',
               'derivation', 'derived-from-retained-evidence 2026-10-06',
               'listing_url', r.url,
               'evidence', jsonb_strip_nulls(jsonb_build_object(
                 'vehicle_event_id', r.id,
                 'evidence_url', r.evidence_url,
                 'bat_listing_ids', to_jsonb(r.bl_ids),
                 'writer', r.writer,
                 'event_status', r.status,
                 'final_price', r.sale,
                 'current_price', r.high,
                 'ended_at', r.ended_at,
                 'sold_at', r.sold_at,
                 'sold_at_method', r.sold_at_method,
                 'bat_listings_auction_end_date', r.bl_end,
                 'end_date_from', r.end_from,
                 'seller_identifier', r.seller_a,
                 'metadata_seller_username', r.seller_b,
                 'bat_listings_seller_username', r.bl_seller,
                 'buyer_identifier', r.buyer_a,
                 'metadata_buyer_username', r.buyer_b,
                 'bat_listings_buyer_username', r.bl_buyer,
                 'bid_count', r.bid_count,
                 'comment_count', r.comment_count,
                 'view_count', r.view_count,
                 'watcher_count', r.watcher_count,
                 'source_listing_id', r.source_listing_id,
                 'row_created_at', r.row_created_at,
                 'row_updated_at', r.row_updated_at,
                 'last_extracted_at', r.last_extracted_at)))
      FROM numbered r, cut
      WHERE r.create_rn IS NOT NULL AND r.blk < cut.next_block
      ORDER BY r.row_tid
      ON CONFLICT (vehicle_id, source_url) DO NOTHING
      RETURNING outcome
    )
    SELECT (SELECT count(*) FROM ins) AS created,
           (SELECT count(*) FROM ins WHERE outcome = 'sold') AS created_sold,
           (SELECT count(*) FROM ins WHERE outcome = 'bid_to') AS created_bid_to,
           (SELECT count(*) FROM numbered r, cut WHERE r.create_rn IS NOT NULL AND r.blk < cut.next_block) AS attempted,
           (SELECT coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) FROM (
              SELECT r.skip_reason AS reason, count(*) AS n FROM numbered r, cut
              WHERE r.skip_reason IS NOT NULL AND r.blk < cut.next_block GROUP BY 1
              UNION ALL
              SELECT 'lot_exists', count(*) FROM lots l, cut WHERE l.has_lot AND l.blk < cut.next_block HAVING count(*) > 0
              UNION ALL
              SELECT 'no_slug', count(*) FROM scan s, cut WHERE s.slug IS NULL AND s.blk < cut.next_block HAVING count(*) > 0
              UNION ALL
              SELECT 'no_vehicle', count(*) FROM scan s, cut
              WHERE s.slug IS NOT NULL AND s.vehicle_id IS NULL AND s.blk < cut.next_block HAVING count(*) > 0
            ) z) AS skipped,
           (SELECT count(*) FROM scan s, cut WHERE s.blk < cut.next_block) AS scanned,
           (SELECT next_block FROM cut) AS next_block
    $q$;
  ELSIF p_source = 'bat_listings' THEN
    v_sql := $q$
    WITH scan AS MATERIALIZED (
      SELECT b.id, b.ctid AS row_tid, ((b.ctid::text)::point)[0]::bigint AS blk, b.vehicle_id, b.bat_listing_url AS evidence_url,
             lower(substring(b.bat_listing_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) AS slug
      FROM public.bat_listings b
      WHERE b.ctid >= $1 AND b.ctid < $2
        AND b.bat_listing_url LIKE '%bringatrailer.com/listing/%'
    ), lots AS MATERIALIZED (
      SELECT s.*, 'https://bringatrailer.com/listing/' || s.slug AS url,
             EXISTS (SELECT 1 FROM public.auction_events a
                     WHERE lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = s.slug) AS has_lot
      FROM scan s
      WHERE s.slug IS NOT NULL
    ), cand AS MATERIALIZED (
      SELECT l.id, l.row_tid, l.blk, l.vehicle_id, l.url, l.slug, l.evidence_url,
             x.listing_status AS status, x.sale_price AS sale, x.final_bid AS high, x.auction_end_date AS end_date,
             nullif(btrim(x.seller_username), '') AS seller_a, nullif(btrim(x.buyer_username), '') AS buyer_a,
             coalesce(x.raw_data->>'source', x.raw_data->>'sync') AS writer,
             x.bat_lot_number, x.bid_count, x.comment_count, x.view_count,
             x.created_at AS row_created_at, x.updated_at AS row_updated_at, x.scraped_at AS row_scraped_at,
             vh.id IS NOT NULL AS vehicle_exists,
             (vh.merged_into_vehicle_id IS NOT NULL OR vh.deleted_at IS NOT NULL
              OR coalesce(vh.status, '') IN ('merged', 'deleted', 'duplicate')) AS vehicle_retired,
             EXISTS (SELECT 1 FROM public.vehicle_events o
                     WHERE lower(substring(o.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = l.slug
                       AND o.source_platform = 'bat') AS ve_holds_lot,
             g.n_other_vehicles, g.bl_ids, g.bl_n_status, g.bl_n_sale, g.bl_n_final, g.bl_n_seller, g.bl_n_buyer,
             g.bl_n_end
      FROM lots l
      JOIN public.bat_listings x ON x.id = l.id
      LEFT JOIN public.vehicles vh ON vh.id = l.vehicle_id
      CROSS JOIN LATERAL (
        SELECT count(DISTINCT y.vehicle_id) FILTER (WHERE y.vehicle_id <> l.vehicle_id) AS n_other_vehicles,
               array_agg(y.id ORDER BY y.id) FILTER (WHERE y.vehicle_id = l.vehicle_id) AS bl_ids,
               count(DISTINCT y.listing_status) FILTER (WHERE y.vehicle_id = l.vehicle_id) AS bl_n_status,
               count(DISTINCT y.sale_price) FILTER (WHERE y.vehicle_id = l.vehicle_id) AS bl_n_sale,
               count(DISTINCT y.final_bid) FILTER (WHERE y.vehicle_id = l.vehicle_id) AS bl_n_final,
               count(DISTINCT nullif(btrim(y.seller_username), '')) FILTER (WHERE y.vehicle_id = l.vehicle_id) AS bl_n_seller,
               count(DISTINCT nullif(btrim(y.buyer_username), '')) FILTER (WHERE y.vehicle_id = l.vehicle_id) AS bl_n_buyer,
               count(DISTINCT y.auction_end_date) FILTER (WHERE y.vehicle_id = l.vehicle_id) AS bl_n_end
        FROM public.bat_listings y
        WHERE lower(substring(y.bat_listing_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = l.slug
      ) g
      WHERE NOT l.has_lot
    ), cls AS MATERIALIZED (
      SELECT c.*,
             CASE WHEN c.end_date IS NOT NULL THEN c.end_date::timestamp AT TIME ZONE 'UTC' END AS end_at,
             CASE
               WHEN c.vehicle_id IS NULL THEN 'no_vehicle'
               WHEN c.ve_holds_lot THEN 'vehicle_events_holds_lot'
               WHEN NOT c.vehicle_exists THEN 'vehicle_missing'
               WHEN c.vehicle_retired THEN 'vehicle_retired'
               WHEN c.n_other_vehicles > 0 THEN 'lot_on_several_vehicles'
               WHEN c.bl_n_status > 1 OR c.bl_n_sale > 1 OR c.bl_n_final > 1 OR c.bl_n_seller > 1 OR c.bl_n_buyer > 1
                    OR c.bl_n_end > 1 THEN 'conflicting_evidence'
               WHEN c.status IN ('active', 'live', 'bid-goes-on', 'pending', 'listed') THEN 'read_while_live'
               WHEN c.status = 'sold' AND c.sale IS NULL THEN 'no_result'
               WHEN c.status = 'sold' AND c.sale < 500 THEN 'implausible_price'
               WHEN c.status = 'ended' AND c.sale IS NOT NULL THEN 'conflicting_evidence'
               WHEN c.status = 'ended' AND c.high IS NULL THEN 'no_result'
               WHEN c.status = 'ended' AND c.high < 500 THEN 'implausible_price'
               WHEN c.status IS DISTINCT FROM 'sold' AND c.status IS DISTINCT FROM 'ended' THEN 'no_result'
               WHEN c.end_date > (now() AT TIME ZONE 'UTC')::date THEN 'conflicting_evidence'
             END AS base_reason
      FROM cand c
    ), ranked AS MATERIALIZED (
      SELECT c.*, coalesce(c.base_reason,
               CASE WHEN row_number() OVER (PARTITION BY (c.base_reason IS NULL), c.vehicle_id, c.slug ORDER BY c.row_tid) > 1
                    THEN 'same_lot_other_row' END) AS skip_reason
      FROM cls c
    ), numbered AS MATERIALIZED (
      SELECT r.*, CASE WHEN r.skip_reason IS NULL
                       THEN row_number() OVER (PARTITION BY (r.skip_reason IS NULL) ORDER BY r.row_tid) END AS create_rn
      FROM ranked r
    ), cut AS MATERIALIZED (
      -- Whole blocks only: stop after the block that holds the p_batch-th creatable row, so no row is revisited.
      SELECT CASE WHEN count(*) FILTER (WHERE create_rn IS NOT NULL) > $3
                  THEN min(blk) FILTER (WHERE create_rn = $3) + 1 ELSE $4 END AS next_block
      FROM numbered
    ), ins AS (
      INSERT INTO public.auction_events (
        vehicle_id, source, source_url, source_listing_id, lot_number, auction_end_date, outcome,
        high_bid, winning_bid, winning_bidder, seller_name, total_bids, unique_bidders, comments_count,
        page_views, watchers, scraped_at, raw_data)
      SELECT r.vehicle_id, 'bat', r.url, NULL, NULL, r.end_at,
             CASE WHEN r.status = 'sold' THEN 'sold' ELSE 'bid_to' END,
             CASE WHEN r.status = 'sold' THEN r.sale ELSE r.high END,
             CASE WHEN r.status = 'sold' THEN r.sale END,
             CASE WHEN r.status = 'sold' THEN r.buyer_a END,
             r.seller_a, NULL, NULL, NULL, NULL, NULL, NULL,
             jsonb_build_object(
               'extractor', 'create_missing_bat_auction_events',
               'derivation', 'derived-from-retained-evidence 2026-10-06',
               'listing_url', r.url,
               'evidence', jsonb_strip_nulls(jsonb_build_object(
                 'bat_listing_ids', to_jsonb(r.bl_ids),
                 'evidence_url', r.evidence_url,
                 'writer', r.writer,
                 'listing_status', r.status,
                 'sale_price', r.sale,
                 'final_bid', r.high,
                 'auction_end_date', r.end_date,
                 'end_date_from', CASE WHEN r.end_date IS NOT NULL THEN 'bat_listings.auction_end_date at 00:00 UTC' END,
                 'seller_username', r.seller_a,
                 'buyer_username', r.buyer_a,
                 'bat_lot_number', r.bat_lot_number,
                 'bid_count', r.bid_count,
                 'comment_count', r.comment_count,
                 'view_count', r.view_count,
                 'row_created_at', r.row_created_at,
                 'row_updated_at', r.row_updated_at,
                 'row_scraped_at', r.row_scraped_at)))
      FROM numbered r, cut
      WHERE r.create_rn IS NOT NULL AND r.blk < cut.next_block
      ORDER BY r.row_tid
      ON CONFLICT (vehicle_id, source_url) DO NOTHING
      RETURNING outcome
    )
    SELECT (SELECT count(*) FROM ins) AS created,
           (SELECT count(*) FROM ins WHERE outcome = 'sold') AS created_sold,
           (SELECT count(*) FROM ins WHERE outcome = 'bid_to') AS created_bid_to,
           (SELECT count(*) FROM numbered r, cut WHERE r.create_rn IS NOT NULL AND r.blk < cut.next_block) AS attempted,
           (SELECT coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) FROM (
              SELECT r.skip_reason AS reason, count(*) AS n FROM numbered r, cut
              WHERE r.skip_reason IS NOT NULL AND r.blk < cut.next_block GROUP BY 1
              UNION ALL
              SELECT 'lot_exists', count(*) FROM lots l, cut WHERE l.has_lot AND l.blk < cut.next_block HAVING count(*) > 0
              UNION ALL
              SELECT 'no_slug', count(*) FROM scan s, cut WHERE s.slug IS NULL AND s.blk < cut.next_block HAVING count(*) > 0
            ) z) AS skipped,
           (SELECT count(*) FROM scan s, cut WHERE s.blk < cut.next_block) AS scanned,
           (SELECT next_block FROM cut) AS next_block
    $q$;
  ELSE
    -- Feed rows (no vehicle): the vehicle comes from the lot's comment rows, only when they are unanimous (lead's
    -- ruling 2026-10-06). Every bat_listings row of the range is classified; rows naming a vehicle belong to the
    -- bat_listings pass.
    v_sql := $q$
    WITH scan AS MATERIALIZED (
      SELECT b.id, b.ctid AS row_tid, ((b.ctid::text)::point)[0]::bigint AS blk, b.vehicle_id AS bl_vehicle,
             b.bat_listing_url AS evidence_url,
             lower(substring(b.bat_listing_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) AS slug
      FROM public.bat_listings b
      WHERE b.ctid >= $1 AND b.ctid < $2
        AND b.bat_listing_url LIKE '%bringatrailer.com/listing/%'
    ), lots AS MATERIALIZED (
      SELECT s.*, 'https://bringatrailer.com/listing/' || s.slug AS url,
             EXISTS (SELECT 1 FROM public.auction_events a
                     WHERE lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = s.slug) AS has_lot
      FROM scan s
      WHERE s.slug IS NOT NULL
    ), cand AS MATERIALIZED (
      SELECT l.id, l.row_tid, l.blk, l.bl_vehicle, l.url, l.slug, l.evidence_url,
             x.listing_status AS status, x.sale_price AS sale, x.final_bid AS high, x.auction_end_date AS end_date,
             CASE WHEN x.raw_data->>'timestamp_end' ~ '^[0-9]{9,11}$'
                  THEN to_timestamp((x.raw_data->>'timestamp_end')::bigint) END AS feed_end_at,
             coalesce(x.raw_data->>'sync', x.raw_data->>'source') AS writer,
             x.raw_data->>'id' AS feed_listing_id, x.raw_data->>'sold_text' AS feed_sold_text,
             x.raw_data->>'comments' AS feed_comments, x.raw_data->>'views' AS feed_views, x.raw_data->>'watchers' AS feed_watchers,
             x.created_at AS row_created_at, x.updated_at AS row_updated_at, x.scraped_at AS row_scraped_at,
             EXISTS (SELECT 1 FROM public.vehicle_events o
                     WHERE lower(substring(o.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = l.slug
                       AND o.source_platform = 'bat') AS ve_holds_lot,
             g.n_vehicle_rows, g.bl_ids, g.bl_n_status, g.bl_n_sale, g.bl_n_final, g.bl_n_end, g.bl_n_ts,
             cv.n_comments, cv.n_comment_vehicles, cv.n_comments_no_vehicle, cv.comment_vehicle,
             cv.n_url_spellings, cv.url_spelling,
             vh.id IS NOT NULL AS vehicle_exists,
             (vh.merged_into_vehicle_id IS NOT NULL OR vh.deleted_at IS NOT NULL
              OR coalesce(vh.status, '') IN ('merged', 'deleted', 'duplicate')) AS vehicle_retired
      FROM lots l
      JOIN public.bat_listings x ON x.id = l.id
      CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE y.vehicle_id IS NOT NULL) AS n_vehicle_rows,
               array_agg(y.id ORDER BY y.id) AS bl_ids,
               count(DISTINCT y.listing_status) AS bl_n_status, count(DISTINCT y.sale_price) AS bl_n_sale,
               count(DISTINCT y.final_bid) AS bl_n_final, count(DISTINCT y.auction_end_date) AS bl_n_end,
               count(DISTINCT y.raw_data->>'timestamp_end') AS bl_n_ts
        FROM public.bat_listings y
        WHERE lower(substring(y.bat_listing_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = l.slug
      ) g
      CROSS JOIN LATERAL (
        SELECT count(*) AS n_comments,
               count(DISTINCT c.vehicle_id) AS n_comment_vehicles,
               count(*) FILTER (WHERE c.vehicle_id IS NULL) AS n_comments_no_vehicle,
               (array_agg(DISTINCT c.vehicle_id) FILTER (WHERE c.vehicle_id IS NOT NULL))[1] AS comment_vehicle,
               count(DISTINCT rtrim(c.source_url, '/')) AS n_url_spellings,
               min(rtrim(c.source_url, '/')) AS url_spelling
        FROM public.auction_comments c
        WHERE lower(substring(c.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = l.slug
          AND c.auction_event_id IS NULL
      ) cv
      LEFT JOIN public.vehicles vh ON vh.id = cv.comment_vehicle
      WHERE NOT l.has_lot
    ), cls AS MATERIALIZED (
      SELECT c.*,
             coalesce(c.feed_end_at, CASE WHEN c.end_date IS NOT NULL THEN c.end_date::timestamp AT TIME ZONE 'UTC' END) AS end_at,
             CASE WHEN c.feed_end_at IS NOT NULL THEN 'bat_listings.raw_data.timestamp_end'
                  WHEN c.end_date IS NOT NULL THEN 'bat_listings.auction_end_date at 00:00 UTC' END AS end_from,
             CASE
               WHEN c.bl_vehicle IS NOT NULL OR c.n_vehicle_rows > 0 THEN 'bat_listings_names_vehicle'
               WHEN c.ve_holds_lot THEN 'vehicle_events_holds_lot'
               WHEN c.n_comments = 0 THEN 'no_comment_vehicle'
               WHEN c.n_comments_no_vehicle > 0 OR c.n_comment_vehicles <> 1 THEN 'comment_vehicles_dissent'
               WHEN c.n_url_spellings <> 1 OR c.url_spelling IS DISTINCT FROM c.url THEN 'conflicting_evidence'
               WHEN NOT c.vehicle_exists THEN 'vehicle_missing'
               WHEN c.vehicle_retired THEN 'vehicle_retired'
               WHEN c.bl_n_status > 1 OR c.bl_n_sale > 1 OR c.bl_n_final > 1 OR c.bl_n_end > 1 OR c.bl_n_ts > 1
                    THEN 'conflicting_evidence'
               WHEN c.status IN ('active', 'live', 'bid-goes-on', 'pending', 'listed') THEN 'read_while_live'
               WHEN c.status = 'sold' AND c.sale IS NULL THEN 'no_result'
               WHEN c.status = 'sold' AND c.sale < 500 THEN 'implausible_price'
               WHEN c.status = 'ended' AND c.sale IS NOT NULL THEN 'conflicting_evidence'
               WHEN c.status = 'ended' AND c.high IS NULL THEN 'no_result'
               WHEN c.status = 'ended' AND c.high < 500 THEN 'implausible_price'
               WHEN c.status IS DISTINCT FROM 'sold' AND c.status IS DISTINCT FROM 'ended' THEN 'no_result'
               WHEN (coalesce(c.feed_end_at, c.end_date::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::date
                    > (now() AT TIME ZONE 'UTC')::date THEN 'conflicting_evidence'
             END AS base_reason
      FROM cand c
    ), ranked AS MATERIALIZED (
      SELECT c.*, coalesce(c.base_reason,
               CASE WHEN row_number() OVER (PARTITION BY (c.base_reason IS NULL), c.slug ORDER BY c.row_tid) > 1
                    THEN 'same_lot_other_row' END) AS skip_reason
      FROM cls c
    ), numbered AS MATERIALIZED (
      SELECT r.*, CASE WHEN r.skip_reason IS NULL
                       THEN row_number() OVER (PARTITION BY (r.skip_reason IS NULL) ORDER BY r.row_tid) END AS create_rn
      FROM ranked r
    ), cut AS MATERIALIZED (
      -- Whole blocks only: stop after the block that holds the p_batch-th creatable row, so no row is revisited.
      SELECT CASE WHEN count(*) FILTER (WHERE create_rn IS NOT NULL) > $3
                  THEN min(blk) FILTER (WHERE create_rn = $3) + 1 ELSE $4 END AS next_block
      FROM numbered
    ), ins AS (
      INSERT INTO public.auction_events (
        vehicle_id, source, source_url, source_listing_id, lot_number, auction_end_date, outcome,
        high_bid, winning_bid, winning_bidder, seller_name, total_bids, unique_bidders, comments_count,
        page_views, watchers, scraped_at, raw_data)
      SELECT r.comment_vehicle, 'bat', r.url, NULL, NULL, r.end_at,
             CASE WHEN r.status = 'sold' THEN 'sold' ELSE 'bid_to' END,
             CASE WHEN r.status = 'sold' THEN r.sale ELSE r.high END,
             CASE WHEN r.status = 'sold' THEN r.sale END,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
             jsonb_build_object(
               'extractor', 'create_missing_bat_auction_events',
               'derivation', 'derived-from-retained-evidence 2026-10-06',
               'listing_url', r.url,
               'evidence', jsonb_strip_nulls(jsonb_build_object(
                 'vehicle_basis', 'vehicle_from_comment_rows',
                 'comment_rows', r.n_comments,
                 'bat_listing_ids', to_jsonb(r.bl_ids),
                 'evidence_url', r.evidence_url,
                 'writer', r.writer,
                 'listing_status', r.status,
                 'sale_price', r.sale,
                 'final_bid', r.high,
                 'auction_end_date', r.end_date,
                 'timestamp_end', r.feed_end_at,
                 'end_date_from', r.end_from,
                 'feed_listing_id', r.feed_listing_id,
                 'feed_sold_text', r.feed_sold_text,
                 'feed_comments', r.feed_comments,
                 'feed_views', r.feed_views,
                 'feed_watchers', r.feed_watchers,
                 'row_created_at', r.row_created_at,
                 'row_updated_at', r.row_updated_at,
                 'row_scraped_at', r.row_scraped_at)))
      FROM numbered r, cut
      WHERE r.create_rn IS NOT NULL AND r.blk < cut.next_block
      ORDER BY r.row_tid
      ON CONFLICT (vehicle_id, source_url) DO NOTHING
      RETURNING outcome
    )
    SELECT (SELECT count(*) FROM ins) AS created,
           (SELECT count(*) FROM ins WHERE outcome = 'sold') AS created_sold,
           (SELECT count(*) FROM ins WHERE outcome = 'bid_to') AS created_bid_to,
           (SELECT count(*) FROM numbered r, cut WHERE r.create_rn IS NOT NULL AND r.blk < cut.next_block) AS attempted,
           (SELECT coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) FROM (
              SELECT r.skip_reason AS reason, count(*) AS n FROM numbered r, cut
              WHERE r.skip_reason IS NOT NULL AND r.blk < cut.next_block GROUP BY 1
              UNION ALL
              SELECT 'lot_exists', count(*) FROM lots l, cut WHERE l.has_lot AND l.blk < cut.next_block HAVING count(*) > 0
              UNION ALL
              SELECT 'no_slug', count(*) FROM scan s, cut WHERE s.slug IS NULL AND s.blk < cut.next_block HAVING count(*) > 0
            ) z) AS skipped,
           (SELECT count(*) FROM scan s, cut WHERE s.blk < cut.next_block) AS scanned,
           (SELECT next_block FROM cut) AS next_block
    $q$;
  END IF;

  EXECUTE v_sql INTO v_res USING v_lo, v_hi, p_batch, v_end;
  PERFORM set_config('app.seed_transfers', '', true);

  RETURN jsonb_build_object(
    'source', p_source,
    'created', v_res.created,
    'created_sold', v_res.created_sold,
    'created_bid_to', v_res.created_bid_to,
    'insert_conflicts', v_res.attempted - v_res.created,
    'skipped', v_res.skipped,
    'evidence_rows_scanned', v_res.scanned,
    'fire_transfers', p_fire_transfers,
    'from_block', p_from_block,
    'next_block', v_res.next_block,
    'blocks_scanned', greatest(0, least(v_res.next_block, v_table_blocks) - p_from_block),
    'table_blocks', v_table_blocks,
    'remaining_blocks', greatest(0, v_table_blocks - v_res.next_block),
    'done', v_res.next_block >= v_table_blocks OR v_res.next_block >= c_max_block
  );
END
$fn$;

COMMENT ON FUNCTION public.create_missing_bat_auction_events(integer, bigint, text, integer, boolean) IS
'Sanctioned writer of auction_events rows for BaT lots that no vehicle has a lot row for, from retained evidence only: a vehicle_events row (p_source vehicle_events) or a bat_listings row naming a vehicle (p_source bat_listings) for the same vehicle and lot; or, for a lot only a feed row records, the vehicle_id that every comment row on the lot carries (p_source bat_listings_comment_vehicle; any dissent or no comment: skipped). A lot is its lower-cased BaT listing slug; every check finds all rows of the lot through the slug indexes. No page is read. Walks p_source by physical block range from p_from_block (p_scan_blocks per call) and inserts about p_batch rows (whole blocks: at most one more block of rows) with ON CONFLICT (vehicle_id, source_url) DO NOTHING; never updates a lot. Writes source_url as the canonical lot URL (https://bringatrailer.com/listing/<slug>); outcome sold (sold status with a sale price) or bid_to (ended with a high bid, no sale price); high_bid, winning_bid, winning_bidder and seller_name only where every evidence row agrees; auction_end_date from ended_at, sold_at (sold), the feed timestamp_end, or the bat_listings date at 00:00 UTC. Leaves lot_number, counts and scraped_at NULL (evidence values kept in raw_data.evidence). raw_data names the extractor, derivation ''derived-from-retained-evidence 2026-10-06'' and the evidence row ids. Skips and counts: lot_exists, no_slug, no_vehicle, vehicle_missing, vehicle_retired, lot_on_several_vehicles, read_while_live, no_result, implausible_price (under $500), conflicting_evidence, vehicle_events_holds_lot, bat_listings_names_vehicle, no_comment_vehicle, comment_vehicles_dissent, same_lot_other_row (ranked among eligible rows only). A sold insert fires trg_auto_create_transfer_on_auction_close as any new sold lot does, throttled by batch (the runner: about 25 lots per call, 3 s apart); p_fire_transfers false skips it for that call. Caller sets statement_timeout (1..60 s) and passes next_block back in; the cursor stops after the block in which p_batch is reached, so every evidence row is counted once. Declares app.writer create-missing-bat-lots and app.seed_transfers with set_config(..., true): both last only for the calling transaction, and app.seed_transfers is reset before return. Requires idx_auction_events_bat_lot_slug, idx_vehicle_events_bat_lot_slug, idx_bat_listings_lot_slug, and idx_auction_comments_unkeyed_lot_slug for the comment pass.';

REVOKE ALL ON FUNCTION public.create_missing_bat_auction_events(integer, bigint, text, integer, boolean) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.create_missing_bat_auction_events(integer, bigint, text, integer, boolean) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.create_missing_bat_auction_events(integer, bigint, text, integer, boolean) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.create_missing_bat_auction_events(integer, bigint, text, integer, boolean) TO service_role;
  END IF;
END $grants$;

-- Table-level owner row (column_name NULL, like 20 existing table-level rows). The unique key does not match NULLs,
-- so update-then-insert instead of ON CONFLICT.
UPDATE public.pipeline_registry SET
  owned_by = 'extract-bat-core',
  description = 'The canonical lot: one row per vehicle x lot URL (unique vehicle_id, source_url), holding the lot result and counts. auction_comments.auction_event_id keys to it. Lot rows are written by the readers of the lot page or its live frames; create_missing_bat_auction_events adds BaT lots never written, from retained vehicle_events / bat_listings rows or the unanimous vehicle of a feed lot''s comment rows (raw_data.extractor names it).',
  do_not_write_directly = true,
  write_via = 'extract-bat-core upserts on (vehicle_id, source_url) at every BaT read; ingest_bat_live_events inserts a live row for a monitored lot with none and keeps it current; extract-cars-and-bids-comments inserts a Cars and Bids lot with none; create_missing_bat_auction_events(p_batch, p_from_block, p_source, p_scan_blocks, p_fire_transfers) creates BaT lots that no vehicle has, from retained evidence, never updating a lot.',
  updated_at = now()
WHERE table_name = 'auction_events' AND column_name IS NULL;
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'auction_events', NULL, 'extract-bat-core',
  'The canonical lot: one row per vehicle x lot URL (unique vehicle_id, source_url), holding the lot result and counts. auction_comments.auction_event_id keys to it. Lot rows are written by the readers of the lot page or its live frames; create_missing_bat_auction_events adds BaT lots never written, from retained vehicle_events / bat_listings rows or the unanimous vehicle of a feed lot''s comment rows (raw_data.extractor names it).',
  true,
  'extract-bat-core upserts on (vehicle_id, source_url) at every BaT read; ingest_bat_live_events inserts a live row for a monitored lot with none and keeps it current; extract-cars-and-bids-comments inserts a Cars and Bids lot with none; create_missing_bat_auction_events(p_batch, p_from_block, p_source, p_scan_blocks, p_fire_transfers) creates BaT lots that no vehicle has, from retained evidence, never updating a lot.'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'auction_events' AND column_name IS NULL);

COMMIT;
