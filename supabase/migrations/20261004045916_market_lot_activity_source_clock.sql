-- Back the existing minute-refresh lot activity capability with the current listing edge.
-- A vehicle persists across auctions: vehicle_id alone must not mix a previous lot into today's bids.
-- Legacy scraped_at defaults/write timestamps do not establish a source-read clock. Only the
-- versioned direct/cached receipt written by extract-bat-core:4.2.1 is exposed as one. No backfill.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.market_lot_activity(p_vehicle_ids uuid[], p_limit_per_lot integer DEFAULT 40)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
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
  SELECT v.id, rtrim(v.listing_url, '/') AS lot_url
  FROM selected r JOIN public.vehicles v ON v.id = r.id CROSS JOIN settings s
  WHERE v.is_public AND v.deleted_at IS NULL
    AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    AND v.sale_status = 'auction_live' AND v.platform_source = 'bringatrailer'
    AND v.auction_end_date IS NOT NULL AND v.auction_end_date::timestamptz > s.as_of
    AND v.listing_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
), lots AS MATERIALIZED (
  SELECT v.id, v.lot_url, e.id AS source_auction_event_id, e.scraped_at AS source_read_at,
    COALESCE(e.raw_data #>> '{source_read,basis}', 'unknown') AS source_read_basis,
    a.activity, a.has_more
  FROM eligible v CROSS JOIN settings s
  LEFT JOIN LATERAL (
    SELECT e.id, e.scraped_at, e.raw_data
    FROM public.auction_events e
    WHERE e.vehicle_id = v.id AND e.source = 'bat'
      AND e.source_url IN (v.lot_url, v.lot_url || '/')
      AND e.raw_data->>'extractor' = 'extract-bat-core'
      AND e.raw_data #>> '{source_read,clock_version}' = '1'
      AND e.raw_data #>> '{source_read,basis}' IN ('direct_fetch', 'cached_snapshot')
      AND e.scraped_at <= s.as_of
      AND e.created_at <= s.as_of
      AND to_char(e.scraped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        = e.raw_data #>> '{source_read,at}'
    ORDER BY e.scraped_at DESC, e.id LIMIT 1
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
    'activity_rows', jsonb_array_length(activity), 'has_more', has_more, 'activity', activity
  ) ORDER BY id) FROM lots), '[]'::jsonb)
) FROM settings s;
$function$;

REVOKE ALL ON FUNCTION public.market_lot_activity(uuid[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_lot_activity(uuid[], integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.market_lot_activity(uuid[], integer) IS
  'Existing market minute-refresh activity reader, current-lot scoped. Max 8 public, non-deleted vehicle listings, max 40 deduplicated posted interactions per lot, as_of/event+ingest cutoffs and has_more. Indexed vehicle/source URL edges accept only trailing-slash aliases; older auctions and URL-unknown comments are excluded. Source clock is unknown on legacy records, otherwise the versioned direct fetch/cached snapshot time preserved by extract-bat-core; never vehicle update/dispatch time. No sale, ownership, condition or market-population inference.';
COMMENT ON COLUMN public.auction_events.scraped_at IS
  'Legacy default is first row creation and is not reliable freshness. extract-bat-core:4.2.1 explicitly updates this to the fetched_at of the page used, preserving cached snapshot time; raw_data.source_read clock_version=1/basis/at establish provenance. Event times remain auction_comments.posted_at and auction end/sale dates; updated_at is a row-write clock.';

SELECT count(*) AS lock_waiters FROM pg_stat_activity WHERE wait_event_type = 'Lock';
COMMIT;
