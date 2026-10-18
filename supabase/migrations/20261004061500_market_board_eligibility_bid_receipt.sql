-- Keep the existing board and bounded current-lot reader; no new analytics pipeline or cadence.
-- Three parent gates prevent private/deleted/nonvehicle contributions even for privileged callers.
-- Forward source-bid receipts bind a positive live bid to the page read, exact listing and typed value.
-- Legacy source clocks remain valid; a clock without a bound amount cannot prove a bid observation.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.market_pulse_live()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT v.id,
           v.year,
           COALESCE(cm.canonical_name, v.make) AS make,
           v.model,
           COALESCE(v.high_bid, v.sale_price) AS current_bid,
           v.auction_end_date::timestamptz AS ends_at,
           v.updated_at,
           v.created_at AS listed_at,
           v.primary_image_url AS image_url,
           COALESCE((v.origin_metadata->>'no_reserve')::boolean, false) AS no_reserve,
           v.listing_url,
           v.title,
           hp.predicted_low AS band_p10,
           hp.predicted_hammer AS band_p50,
           hp.predicted_high AS band_p90,
           hp.price_tier AS band_tier,
           hp.comp_count AS band_comps
    FROM public.vehicles v
    LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
    LEFT JOIN LATERAL (
      SELECT h.predicted_low, h.predicted_hammer, h.predicted_high, h.price_tier, h.comp_count
      FROM public.hammer_predictions h
      WHERE h.vehicle_id = v.id AND h.model_version = 31
      ORDER BY h.predicted_at DESC LIMIT 1
    ) hp ON true
    WHERE v.is_public AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.sale_status = 'auction_live'
      AND v.platform_source = 'bringatrailer'
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
  )
  SELECT jsonb_build_object(
    'synced_at', (SELECT max(updated_at) FROM live),
    'source', 'Bring a Trailer live auctions page, read every 15 minutes by sync-live-auctions',
    -- Median share of the final price that sold BaT cars had bid at each hours-left mark, by price tier of the
    -- band middle (a <$25k, b <$50k, c <$100k, d $100k+); 36,700 sales ending 2025-09-26..2026-09-26.
    'curve', '{"a":[[168,0.198],[120,0.35],[96,0.3903],[72,0.4324],[48,0.4762],[36,0.5098],[24,0.5364],[18,0.5769],[12,0.6071],[6,0.6235],[3,0.6621],[1,0.7077]],"b":[[168,0.204],[120,0.4194],[96,0.4615],[72,0.5],[48,0.543],[36,0.5714],[24,0.5942],[18,0.625],[12,0.6496],[6,0.6612],[3,0.6933],[1,0.7315]],"c":[[168,0.2658],[120,0.5006],[96,0.5436],[72,0.5764],[48,0.6075],[36,0.6357],[24,0.6544],[18,0.6808],[12,0.7018],[6,0.7115],[3,0.7355],[1,0.7692]],"d":[[168,0.4505],[120,0.6076],[96,0.6392],[72,0.6632],[48,0.6902],[36,0.7078],[24,0.7192],[18,0.7383],[12,0.7525],[6,0.7567],[3,0.7738],[1,0.8041]]}'::jsonb,
    'baseline', (
      WITH idx AS (SELECT id FROM public.market_indexes WHERE index_code = 'BAT-LIVE-BIDS'),
      hr AS (SELECT to_char(date_trunc('hour', now()) AT TIME ZONE 'UTC', 'HH24') AS now_hh,
                    date_trunc('hour', now() - interval '7 days') AS wk_t),
      wk AS (
        SELECT v.components_snapshot->'hourly'->to_char(hr.wk_t AT TIME ZONE 'UTC', 'HH24') AS snap,
               COALESCE(v.calculation_metadata->'sources'->>to_char(hr.wk_t AT TIME ZONE 'UTC', 'HH24'),
                        v.calculation_metadata->>'source') AS source
        FROM public.market_index_values v, idx, hr
        WHERE v.index_id = idx.id AND v.value_date = (hr.wk_t AT TIME ZONE 'UTC')::date
      ),
      same_hour AS (
        SELECT v.value_date, (v.components_snapshot->'hourly'->hr.now_hh->>'bids')::numeric AS bids
        FROM public.market_index_values v, idx, hr
        WHERE v.index_id = idx.id
          AND v.value_date >= (now() AT TIME ZONE 'UTC')::date - 84
          AND v.value_date < (now() AT TIME ZONE 'UTC')::date
          AND extract(dow FROM v.value_date) = extract(dow FROM (now() AT TIME ZONE 'UTC')::date)
      )
      SELECT jsonb_build_object(
        'week_ago', (SELECT jsonb_build_object('at', snap->>'at', 'bids', (snap->>'bids')::numeric, 'n', (snap->>'n')::int,
                                               'by_make', snap->'by_make', 'source', source)
                     FROM wk WHERE snap IS NOT NULL),
        'same_hour', (SELECT jsonb_build_object('hour_utc', (SELECT now_hh FROM hr), 'weekday_utc', to_char(now() AT TIME ZONE 'UTC', 'FMDay'),
                                                'low', min(bids), 'high', max(bids), 'weeks', count(*), 'first_day', min(value_date),
                                                'readings', jsonb_agg(jsonb_build_array(value_date, bids) ORDER BY value_date))
                      FROM same_hour WHERE bids IS NOT NULL)
      )
    ),
    'auctions', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
               id, year, make, model, current_bid, ends_at, updated_at, listed_at,
               image_url, no_reserve, listing_url, title,
               band_p10, band_p50, band_p90, band_tier, band_comps)
             ORDER BY ends_at)
      FROM live), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.market_lot_activity(p_vehicle_ids uuid[], p_limit_per_lot integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
WITH settings AS MATERIALIZED (
  SELECT statement_timestamp() AS as_of, LEAST(40, GREATEST(1, COALESCE(p_limit_per_lot, 40))) AS row_cap
), requested AS MATERIALIZED (
  -- Bound even duplicate-heavy inputs before grouping; callers pass at most eight current lots.
  SELECT id, min(ordinality) AS ordinal
  FROM unnest(p_vehicle_ids[1:8]) WITH ORDINALITY r(id, ordinality)
  WHERE id IS NOT NULL GROUP BY id
), selected AS MATERIALIZED (
  SELECT id FROM requested ORDER BY ordinal LIMIT 8
), eligible AS MATERIALIZED (
  SELECT v.id, rtrim(v.listing_url, '/') AS lot_url,
    CASE WHEN COALESCE(v.high_bid, v.sale_price) >= 0 THEN COALESCE(v.high_bid, v.sale_price) END AS current_bid_at_capture
  FROM selected r JOIN public.vehicles v ON v.id = r.id CROSS JOIN settings s
  WHERE v.is_public AND v.deleted_at IS NULL
    AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    AND v.sale_status = 'auction_live' AND v.platform_source = 'bringatrailer'
    AND v.auction_end_date IS NOT NULL AND v.auction_end_date::timestamptz > s.as_of
    AND v.listing_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
), lots AS MATERIALIZED (
  SELECT v.id, v.lot_url, e.id AS source_auction_event_id, e.scraped_at AS source_read_at,
    COALESCE(e.raw_data #>> '{source_read,basis}', 'unknown') AS source_read_basis,
    v.current_bid_at_capture, e.source_bid_amount,
    CASE WHEN e.source_bid_amount IS NOT NULL THEN e.updated_at END AS source_bid_ingested_at,
    CASE WHEN e.source_bid_amount IS NULL OR v.current_bid_at_capture IS NULL THEN 'unknown'
      WHEN e.source_bid_amount = v.current_bid_at_capture THEN 'matched' ELSE 'mismatched' END AS source_bid_match,
    a.activity, a.has_more
  FROM eligible v CROSS JOIN settings s
  LEFT JOIN LATERAL (
    SELECT e.id, e.scraped_at, e.raw_data, e.updated_at,
      CASE WHEN min(e.bound_bid) OVER same_read = max(e.bound_bid) OVER same_read
        THEN e.bound_bid END AS source_bid_amount
    FROM (
      SELECT e.id, e.scraped_at, e.raw_data, e.updated_at,
        CASE WHEN e.outcome = 'live' AND e.auction_end_date > s.as_of
          AND e.high_bid > 0 AND e.high_bid < 'Infinity'::numeric
          AND e.raw_data #>> '{source_read,bid_amount_version}' = '1'
          AND e.raw_data #> '{source_read,bid_amount}' = to_jsonb(e.high_bid)
          AND e.raw_data->>'listing_url' IN (v.lot_url, v.lot_url || '/')
          THEN e.high_bid END AS bound_bid
      FROM public.auction_events e
      WHERE e.vehicle_id = v.id AND e.source = 'bat'
        AND e.source_url IN (v.lot_url, v.lot_url || '/')
        AND e.raw_data->>'extractor' = 'extract-bat-core'
        AND e.raw_data #>> '{source_read,clock_version}' = '1'
        AND e.raw_data #>> '{source_read,basis}' IN ('direct_fetch', 'cached_snapshot')
        AND e.scraped_at <= s.as_of AND e.created_at <= s.as_of AND e.updated_at <= s.as_of
        AND to_char(e.scraped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          = e.raw_data #>> '{source_read,at}'
    ) e
    WINDOW same_read AS (PARTITION BY e.scraped_at)
    -- Conflicting bound prices at the same read stay unknown, regardless of URL alias or row ID.
    ORDER BY e.scraped_at DESC, e.bound_bid NULLS LAST, e.id LIMIT 1
  ) e ON true
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'vehicle_id', v.id, 'posted_at', c.posted_at, 'comment_type', c.comment_type,
        'bid_amount', c.bid_amount, 'sequence_number', c.sequence_number, 'source_url', c.source_url
      ) ORDER BY c.posted_at DESC, c.id) FILTER (WHERE c.position <= s.row_cap), '[]'::jsonb) AS activity,
      count(*) > s.row_cap AS has_more
    FROM (
      SELECT d.*, row_number() OVER (ORDER BY d.posted_at DESC, d.id) AS position
      FROM (
        SELECT DISTINCT ON (COALESCE(c.bat_comment_id::text, c.id::text))
          c.id, c.posted_at, c.comment_type, c.bid_amount, c.sequence_number, c.source_url
        FROM public.auction_comments c
        WHERE c.vehicle_id = v.id AND c.source_url IN (v.lot_url, v.lot_url || '/')
          AND c.posted_at <= s.as_of AND c.created_at <= s.as_of
        ORDER BY COALESCE(c.bat_comment_id::text, c.id::text), c.posted_at, c.id
      ) d
      ORDER BY d.posted_at DESC, d.id LIMIT (s.row_cap + 1)
    ) c
  ) a
)
SELECT jsonb_build_object(
  'as_of', s.as_of, 'max_lots', 8, 'per_lot_limit', s.row_cap,
  'input_truncated', COALESCE(cardinality(p_vehicle_ids), 0) > 8,
  'eligible_lots', (SELECT count(*) FROM lots),
  'scope', 'captured public current BaT listings; posted bids/comments, not completed transactions',
  'lots', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'vehicle_id', id, 'source_url', lot_url || '/',
    'source_auction_event_id', source_auction_event_id,
    'source_read_at', source_read_at, 'source_read_basis', source_read_basis,
    'source_bid_amount', source_bid_amount, 'source_bid_ingested_at', source_bid_ingested_at,
    'current_bid_at_capture', current_bid_at_capture, 'source_bid_match', source_bid_match,
    'source_bid_currency', NULL, 'current_bid_currency_at_capture', NULL,
    'source_bid_match_basis', CASE WHEN source_bid_match = 'unknown' THEN 'unknown'
      ELSE 'numeric_amount_only_currency_unverified' END,
    'activity_rows', jsonb_array_length(activity), 'has_more', has_more, 'activity', activity
  ) ORDER BY id) FROM lots), '[]'::jsonb)
) FROM settings s;
$function$;

REVOKE ALL ON FUNCTION public.market_pulse_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_pulse_live() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_lot_activity(uuid[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_lot_activity(uuid[], integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.market_pulse_live() IS
  'Existing compact 17-position open BaT board. SECURITY INVOKER/RLS plus explicit public, non-deleted vehicle gates before bands, counts and row-write clock. synced_at remains max vehicle updated_at, not source freshness, sale or minute-market movement. Bands and historical snapshots retain their existing separate methodology.';
COMMENT ON FUNCTION public.market_lot_activity(uuid[], integer) IS
  'Existing max8-lot/max40-interaction current public BaT reader, exact URL slash aliases and event/ingest as_of cutoffs. Optional source_bid_amount is a positive finite live numeric amount bound by extract-bat-core bid_amount_version1 to the same source page clock and listing; closed, legacy, malformed, conflicting or missing bid receipts stay unknown. current_bid_at_capture is the vehicle current bid sampled at RPC as_of; source_bid_match reports exact numeric agreement only, explicitly currency-unverified. Both currency fields stay NULL until independently captured; no USD default, forex or money aggregation is supported. This is not price freshness or a completed transaction. source_bid_ingested_at is the mutable auction event latest-write time, not bid posted_at; source_auction_event_id is an auction row, never a fabricated observation UUID. No whole-market cadence, completeness or historical valuation inference.';
SELECT count(*) AS lock_waiters FROM pg_stat_activity WHERE wait_event_type = 'Lock';
COMMIT;
