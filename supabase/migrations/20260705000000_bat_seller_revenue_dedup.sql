-- ============================================================
-- BaT Seller Revenue — VLVA reconciliation (2026-07-05)
--
-- Origin: staged draft at /Volumes/NukePortable/vlva-analysis/20260704_bat_seller_revenue.sql
-- (a crashed session's get_seller_stats() design). This migration KEEPS that
-- function's intent (queryable seller hammer-revenue stats) but FIXES two
-- correctness bugs discovered during the 2026-07-05 reconciliation pass:
--
-- 1. The staged version joined bat_listings -> external_identities via
--    bl.seller_external_identity_id. That FK is populated on only 4 of
--    157,088 bat_listings rows (0.0025%) platform-wide, and ZERO of the 77
--    VivaLasVegasAutos rows. Joining on it returns nothing for almost every
--    seller. The actual seller linkage that has data is the free-text
--    bl.seller_username column, matched case-insensitively (see root-cause
--    note below on why case varies). This version matches on
--    lower(seller_username) = lower(handle) OR the FK (so it keeps working,
--    and gets BETTER, if the FK is ever backfilled).
--
-- 2. bat_listings.bat_listing_url has a UNIQUE index, but re-scrapes of the
--    same BaT auction were sometimes stored with a trailing slash and
--    sometimes without (extract-bat-core historically shipped both
--    normalizeUrl() [adds trailing slash] and canonicalUrl() [strips it] in
--    the same file). Since the two strings differ, the unique constraint
--    never caught it and a second row landed instead of updating the first.
--    This is a PLATFORM-WIDE pattern -- 23,304 excess duplicate rows found
--    across bat_listings (14.8% of the table), 938 excess rows in
--    external_identities(platform,handle) from the same class of bug applied
--    to seller handles. It is NOT unique to VivaLasVegasAutos. This function
--    dedupes by normalizing the URL (strip trailing slash + comment
--    fragment) and collapsing same-listing duplicate rows, taking
--    GREATEST(sale_price, final_bid) across the group (this also self-heals
--    a known truncated-price artifact -- e.g. the 2022 Raptor listing had one
--    row with the correct final_bid=62000 and a duplicate re-scrape row that
--    stored sale_price=68) and treating the group as self-purchase if ANY row
--    in it shows buyer_username = seller_username.
--
-- Root cause is written up in full in the session report; the short version:
-- bat_listings is a FROZEN legacy table (no writes since 2026-03-14; the live
-- extractor, extract-bat-core v3.0.0, now writes vehicle_events/auction_events
-- instead -- see the comment at that file's "consolidated from bat_listings"
-- line). The duplicate-row bug lived in the now-retired write path, so it will
-- not keep growing inside bat_listings itself. But the SAME untrimmed-handle
-- bug is still live today in extract-bat-core's external_identities upsert
-- (`handle: essentials.seller_username` with no case fold, onConflict
-- "platform,handle") -- that one is still creating duplicate seller identities
-- for every platform, ongoing. See the two duplicate VivaLasVegasAutos rows
-- (created six days apart, 2025-12-15 and 2025-12-21) for a concrete instance.
-- ============================================================

-- 1) Windowed seller-commerce RPC ---------------------------------
CREATE OR REPLACE FUNCTION public.get_seller_stats(
  p_handle text,
  p_since  date DEFAULT NULL,   -- inclusive; NULL = all-time
  p_until  date DEFAULT NULL    -- inclusive; NULL = through-present
)
RETURNS TABLE (
  bat_username             text,
  matched_identity_ids     uuid[],
  sales_count              int,
  total_hammer_usd         numeric,
  avg_hammer_usd           numeric,
  self_purchases_excluded  int,
  self_purchase_usd        numeric,
  duplicate_rows_collapsed int,
  first_sale               date,
  last_sale                date,
  as_of                    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ident AS (
    SELECT id, handle
    FROM public.external_identities
    WHERE platform = 'bat' AND lower(handle) = lower(p_handle)
  ),
  raw AS (
    -- Match on case-insensitive seller_username (where the data actually
    -- lives today) OR the FK (kept for forward-compatibility once/if
    -- seller_external_identity_id gets backfilled).
    SELECT
      bl.id,
      regexp_replace(regexp_replace(bl.bat_listing_url, '/#comment-[0-9]+', ''), '/$', '') AS norm_url,
      bl.listing_status,
      GREATEST(COALESCE(bl.sale_price, 0), COALESCE(bl.final_bid, 0)) AS hammer_candidate,
      bl.seller_username,
      bl.buyer_username,
      COALESCE(bl.sale_date, bl.auction_end_date) AS eff_date
    FROM public.bat_listings bl
    WHERE bl.bat_listing_url IS NOT NULL
      AND (
        lower(bl.seller_username) = lower(p_handle)
        OR bl.seller_external_identity_id IN (SELECT id FROM ident)
      )
  ),
  grouped AS (
    -- Collapse trailing-slash / comment-fragment re-scrape duplicates of the
    -- same listing into one row per normalized URL.
    SELECT
      norm_url,
      bool_or(listing_status = 'sold')                                   AS any_sold,
      MAX(hammer_candidate)                                              AS hammer,
      MAX(eff_date)                                                      AS eff_date,
      COALESCE(bool_or(lower(seller_username) = lower(buyer_username)), false) AS is_self_purchase,
      count(*)                                                           AS row_count
    FROM raw
    GROUP BY norm_url
  ),
  windowed AS (
    SELECT * FROM grouped
    WHERE any_sold AND hammer > 0
      AND (p_since IS NULL OR eff_date >= p_since)
      AND (p_until IS NULL OR eff_date <= p_until)
  )
  SELECT
    p_handle,
    (SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) FROM ident),
    COUNT(*)             FILTER (WHERE NOT is_self_purchase)::int,
    COALESCE(SUM(hammer) FILTER (WHERE NOT is_self_purchase), 0)::numeric,
    COALESCE(AVG(hammer) FILTER (WHERE NOT is_self_purchase), NULL)::numeric,
    COUNT(*)             FILTER (WHERE is_self_purchase)::int,
    COALESCE(SUM(hammer) FILTER (WHERE is_self_purchase), 0)::numeric,
    COALESCE(SUM(row_count - 1), 0)::int,
    MIN(eff_date)         FILTER (WHERE NOT is_self_purchase),
    MAX(eff_date)         FILTER (WHERE NOT is_self_purchase),
    now()
  FROM windowed;
$$;

GRANT EXECUTE ON FUNCTION public.get_seller_stats(text, date, date) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_seller_stats IS
  'Dealer-level BaT hammer revenue for a seller handle. Dedupes bat_listings '
  'by normalized listing URL (trailing-slash re-scrape duplicates), matches '
  'seller by case-insensitive seller_username (the FK is 99.997% unpopulated '
  'platform-wide), and excludes self-purchases. See migration '
  '20260705000000_bat_seller_revenue_dedup.sql for the full root-cause note.';

-- 2) Soft-merge the two known-duplicate VivaLasVegasAutos external_identities
--    rows (created six days apart from a casing mismatch -- see root-cause
--    note above). NOT a physical merge/delete: both rows are left in place
--    (bat_listings.seller_external_identity_id references neither of them --
--    verified zero rows -- so there is nothing to relink), and the
--    lowercase-created-first row is annotated as a duplicate of the
--    canonical proper-cased row. Reversible: the annotation lives in
--    `metadata`, nothing is destroyed.
UPDATE public.external_identities
SET metadata = metadata || jsonb_build_object(
  'duplicate_of', 'a6f5b702-7611-42b7-befd-f91175a5244e',
  'canonical_handle', 'VivaLasVegasAutos',
  'dedup_note', 'Same seller as a6f5b702-7611-42b7-befd-f91175a5244e, differing only by handle casing (vivalasvegasautos vs VivaLasVegasAutos). Soft-merged 2026-07-05 VLVA revenue reconciliation. get_seller_stats() matches both via lower(handle) so this annotation does not change query results -- it documents the duplication for anyone reading this row directly.',
  'dedup_date', '2026-07-05'
)
WHERE id = '7857b497-86f0-4d6a-9691-3b0270c10130'
  AND platform = 'bat'
  AND lower(handle) = 'vivalasvegasautos';
