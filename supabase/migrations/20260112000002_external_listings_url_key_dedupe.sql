-- ============================================================================
-- external_listings: canonical URL key + dedupe + uniqueness guardrail
-- ============================================================================
-- Why:
-- - We currently have many duplicate rows for the same auction listing URL (especially BaT).
-- - Existing uniqueness (vehicle_id, platform, listing_id) does NOT prevent duplicates when listing_id is NULL
--   (Postgres UNIQUE indexes allow multiple NULLs).
-- - Duplicates cause price flicker, noisy analytics, and broken foreign-key references.
--
-- Strategy:
-- 1) Add a stable `listing_url_key` (normalized URL) column.
-- 2) Backfill it for existing rows.
-- 3) Dedupe rows by (platform, listing_url_key), preserving/merging the best telemetry.
-- 4) Re-point FK references (watchlist_matches, listing_attribution, etc.) to the canonical row.
-- 5) Add a UNIQUE index so duplicates cannot reappear.

-- 0) URL normalization helper (DB-side must match edge functions)
CREATE OR REPLACE FUNCTION public.normalize_listing_url_key(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_url IS NULL THEN NULL
      ELSE NULLIF(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(trim(p_url)), '[?#].*$', ''),
              '^https?://', ''
            ),
            '^www\.', ''
          ),
          '/+$', ''
        ),
        ''
      )
    END
$$;

-- 1) Add column (safe)
DO $$
BEGIN
  IF to_regclass('public.external_listings') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    ALTER TABLE public.external_listings
      ADD COLUMN IF NOT EXISTS listing_url_key text;
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;
END
$$;

-- 2) Backfill (best-effort)
DO $$
BEGIN
  IF to_regclass('public.external_listings') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.external_listings
  SET listing_url_key = public.normalize_listing_url_key(listing_url)
  WHERE listing_url IS NOT NULL
    AND (listing_url_key IS NULL OR listing_url_key = '');
END
$$;

-- 3) Keep it updated going forward (trigger)
DO $$
BEGIN
  IF to_regclass('public.external_listings') IS NULL THEN
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.set_external_listings_url_key()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
  BEGIN
    NEW.listing_url_key := public.normalize_listing_url_key(NEW.listing_url);
    RETURN NEW;
  END;
  $fn$;

  DROP TRIGGER IF EXISTS trg_external_listings_url_key ON public.external_listings;
  CREATE TRIGGER trg_external_listings_url_key
    BEFORE INSERT OR UPDATE OF listing_url
    ON public.external_listings
    FOR EACH ROW
    EXECUTE FUNCTION public.set_external_listings_url_key();
END
$$;

-- 4) Dedupe by (platform, listing_url_key) and preserve FK references
DO $$
DECLARE
  dup_count integer;
BEGIN
  IF to_regclass('public.external_listings') IS NULL THEN
    RETURN;
  END IF;

  -- Count duplicates for logging/debugging
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT platform, listing_url_key
    FROM public.external_listings
    WHERE listing_url_key IS NOT NULL
    GROUP BY 1,2
    HAVING COUNT(*) > 1
  ) x;

  IF dup_count = 0 THEN
    -- Nothing to do
    RETURN;
  END IF;

  -- Build a stable dup->keep mapping (temp table so we can reuse it across statements)
  CREATE TEMP TABLE tmp_external_listings_dedupe_map (
    dup_id uuid PRIMARY KEY,
    keep_id uuid NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_external_listings_dedupe_map(dup_id, keep_id)
  WITH keyed AS (
    SELECT *
    FROM public.external_listings
    WHERE listing_url_key IS NOT NULL
  ),
  ranked AS (
    SELECT
      id,
      platform,
      listing_url_key,
      row_number() OVER (
        PARTITION BY platform, listing_url_key
        ORDER BY
          (final_price IS NOT NULL AND final_price > 0) DESC,
          (lower(coalesce(listing_status,'')) = 'sold') DESC,
          (sold_at IS NOT NULL) DESC,
          (current_bid IS NOT NULL AND current_bid > 0) DESC,
          (bid_count IS NOT NULL AND bid_count > 0) DESC,
          (listing_id IS NOT NULL AND listing_id <> '') DESC,
          coalesce(updated_at, created_at) DESC,
          id ASC
      ) AS rn,
      first_value(id) OVER (
        PARTITION BY platform, listing_url_key
        ORDER BY
          (final_price IS NOT NULL AND final_price > 0) DESC,
          (lower(coalesce(listing_status,'')) = 'sold') DESC,
          (sold_at IS NOT NULL) DESC,
          (current_bid IS NOT NULL AND current_bid > 0) DESC,
          (bid_count IS NOT NULL AND bid_count > 0) DESC,
          (listing_id IS NOT NULL AND listing_id <> '') DESC,
          coalesce(updated_at, created_at) DESC,
          id ASC
      ) AS keep_id
    FROM keyed
  )
  SELECT id AS dup_id, keep_id
  FROM ranked
  WHERE rn > 1;

  -- Merge aggregated telemetry into the keep row (so we don't lose max bid counts etc.)
  WITH keyed AS (
    SELECT *
    FROM public.external_listings
    WHERE listing_url_key IS NOT NULL
  ),
  agg AS (
    SELECT
      platform,
      listing_url_key,
      max(current_bid) as max_current_bid,
      max(final_price) as max_final_price,
      max(reserve_price) as max_reserve_price,
      max(buy_now_price) as max_buy_now_price,
      max(bid_count) as max_bid_count,
      max(view_count) as max_view_count,
      max(watcher_count) as max_watcher_count,
      min(start_date) as min_start_date,
      max(end_date) as max_end_date,
      max(sold_at) as max_sold_at,
      max(last_synced_at) as max_last_synced_at,
      max(updated_at) as max_updated_at,
      max(created_at) as max_created_at,
      max(
        CASE lower(coalesce(listing_status,''))
          WHEN 'sold' THEN 5
          WHEN 'active' THEN 4
          WHEN 'live' THEN 4
          WHEN 'pending' THEN 3
          WHEN 'ended' THEN 2
          WHEN 'cancelled' THEN 1
          ELSE 0
        END
      ) as status_rank
    FROM keyed
    GROUP BY 1,2
  ),
  keep AS (
    SELECT DISTINCT
      m.keep_id,
      e.platform,
      e.listing_url_key
    FROM tmp_external_listings_dedupe_map m
    JOIN public.external_listings e
      ON e.id = m.keep_id
  )
  UPDATE public.external_listings e
  SET
    current_bid = COALESCE(agg.max_current_bid, e.current_bid),
    final_price = COALESCE(agg.max_final_price, e.final_price),
    reserve_price = COALESCE(e.reserve_price, agg.max_reserve_price),
    buy_now_price = COALESCE(e.buy_now_price, agg.max_buy_now_price),
    bid_count = GREATEST(COALESCE(e.bid_count, 0), COALESCE(agg.max_bid_count, 0)),
    view_count = GREATEST(COALESCE(e.view_count, 0), COALESCE(agg.max_view_count, 0)),
    watcher_count = GREATEST(COALESCE(e.watcher_count, 0), COALESCE(agg.max_watcher_count, 0)),
    start_date = COALESCE(e.start_date, agg.min_start_date),
    end_date = COALESCE(e.end_date, agg.max_end_date),
    sold_at = COALESCE(e.sold_at, agg.max_sold_at),
    last_synced_at = CASE
      WHEN e.last_synced_at IS NULL AND agg.max_last_synced_at IS NULL THEN NULL
      ELSE GREATEST(
        COALESCE(e.last_synced_at, 'epoch'::timestamptz),
        COALESCE(agg.max_last_synced_at, 'epoch'::timestamptz)
      )
    END,
    listing_status = CASE agg.status_rank
      WHEN 5 THEN 'sold'
      WHEN 4 THEN 'active'
      WHEN 3 THEN 'pending'
      WHEN 2 THEN 'ended'
      WHEN 1 THEN 'cancelled'
      ELSE e.listing_status
    END,
    updated_at = CASE
      WHEN e.updated_at IS NULL AND agg.max_updated_at IS NULL THEN NULL
      ELSE GREATEST(
        COALESCE(e.updated_at, 'epoch'::timestamptz),
        COALESCE(agg.max_updated_at, 'epoch'::timestamptz)
      )
    END
  FROM keep
  JOIN agg
    ON agg.platform = keep.platform
   AND agg.listing_url_key = keep.listing_url_key
  WHERE e.id = keep.keep_id;

  -- Re-point FK references to the canonical listing row
  IF to_regclass('public.auto_buy_executions') IS NOT NULL THEN
    UPDATE public.auto_buy_executions t
    SET external_listing_id = m.keep_id
    FROM tmp_external_listings_dedupe_map m
    WHERE t.external_listing_id = m.dup_id;
  END IF;

  IF to_regclass('public.listing_attribution') IS NOT NULL THEN
    UPDATE public.listing_attribution t
    SET external_listing_id = m.keep_id
    FROM tmp_external_listings_dedupe_map m
    WHERE t.external_listing_id = m.dup_id;
  END IF;

  IF to_regclass('public.price_monitoring') IS NOT NULL THEN
    UPDATE public.price_monitoring t
    SET external_listing_id = m.keep_id
    FROM tmp_external_listings_dedupe_map m
    WHERE t.external_listing_id = m.dup_id;
  END IF;

  IF to_regclass('public.watchlist_matches') IS NOT NULL THEN
    UPDATE public.watchlist_matches t
    SET external_listing_id = m.keep_id
    FROM tmp_external_listings_dedupe_map m
    WHERE t.external_listing_id = m.dup_id;
  END IF;

  -- Delete duplicates
  DELETE FROM public.external_listings e
  USING tmp_external_listings_dedupe_map m
  WHERE e.id = m.dup_id;
END
$$;

-- 5) Uniqueness guardrail (one row per listing per platform)
DO $$
BEGIN
  IF to_regclass('public.external_listings') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_external_listings_platform_url_key'
  ) THEN
    CREATE UNIQUE INDEX uq_external_listings_platform_url_key
      ON public.external_listings(platform, listing_url_key)
      WHERE listing_url_key IS NOT NULL;
  END IF;
END
$$;

