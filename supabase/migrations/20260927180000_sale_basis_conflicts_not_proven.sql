-- Sale rule, part 4 — contradicting testimony on one row is not a proven sale.
-- Session cb179857, 2026-09-27.
--
-- MEASURED after part 3 (post-apply check 4, 15:40Z; expected 0): 18 rows counted sold on a legacy platform marker
-- while the same row's auction_outcome says reserve_not_met — merged records, e.g. a Mecum "Result: sold" note on a
-- record whose BaT run ended reserve-not-met (9 mecum, 6 conceptcarz, 1 each C&B, Gooding, Barrett-Jackson).
-- The two status columns also contradict each other on 1,036 rows: 611 sale_status 'sold' with auction_outcome
-- reserve_not_met/no_sale, 425 auction_outcome 'sold' with sale_status not_sold/unsold/bid_to.
-- Which event the price belongs to cannot be told from the row.
--
-- RULE ADDED: any explicit no-sale on the row (auction_outcome reserve_not_met/no_sale, sale_status
-- not_sold/unsold/bid_to, or a Mecum "Result: bid-goes-on") makes the sale NOT PROVEN (NULL) until a source re-read
-- settles it through correct_vehicle_sale_provenance_batch. Everything else in the predicate is unchanged.
-- trg_resolve_canonical_columns calls this function, so new writes follow it at once; clean_vehicle_prices is
-- refreshed below so is_sold readers (market indexes, valuation) see it now. Expected effect, measured on the live view
-- 15:45Z: 854 of 200,129 sold flags withdrawn (811 status, 23 gooding, 9 mecum, 7 conceptcarz, 3 C&B, 1 B-J) = 0.4%.

SET statement_timeout = '120s';

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
    -- contradicting testimony: an explicit no-sale on the row means the sale is not proven (2026-09-27, part 4)
    WHEN p_auction_outcome IN ('reserve_not_met', 'no_sale')
      OR p_sale_status IN ('not_sold', 'unsold', 'bid_to')
      OR (plat = 'mecum' AND p_notes ~ 'Result: bid-goes-on')                                              THEN NULL
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
  'The one definition of a consummated sale (2026-09-27). NULL = not a sale. An explicit no-sale anywhere on the row (auction_outcome reserve_not_met/no_sale, sale_status not_sold/unsold/bid_to, Mecum Result: bid-goes-on) = not proven, whatever else the row says. ''status'' = sale_status/auction_outcome say sold. The other values are legacy (pre-cutover) platform markers: mecum notes Result: sold; cars-and-bids import_metadata.auction_status=sold; gooding page-data salePrice; barrett-jackson result price (BJ publishes a price only after a sale); conceptcarz Sold column. A price alone is a bid, an ask or an estimate. Used by trg_resolve_canonical_columns and clean_vehicle_prices.';

-- Refresh the prices view so is_sold follows the rule now. Plain REFRESH (built in 56 s in CI today; CONCURRENTLY
-- adds a full diff on top): it holds ACCESS EXCLUSIVE on clean_vehicle_prices for about a minute, which blocks only
-- its three readers (calculate-market-indexes, compute-vehicle-valuation, extract-bat-core; no frontend reads it).
-- lock_timeout 10 s: if a reader holds it, fail instead of queueing. If this statement fails, the function above is
-- already committed and the view is refreshed separately.
SET lock_timeout = '10s';
REFRESH MATERIALIZED VIEW public.clean_vehicle_prices;
ANALYZE public.clean_vehicle_prices;
RESET lock_timeout;

-- POST-APPLY (read-only):
--   check 4 of 20260927160000, restricted to marker-based rows — expect 0:
--   SELECT count(*) FROM clean_vehicle_prices c JOIN vehicles v ON v.id=c.vehicle_id
--    WHERE c.is_sold_basis IS NOT NULL AND c.is_sold_basis <> 'status'
--      AND (v.notes ~ 'Result: bid-goes-on' OR v.import_metadata->>'auction_status'='reserve_not_met' OR v.auction_outcome IN ('reserve_not_met','no_sale'));
--   and no status-based sale with a no-sale beside it — expect 0:
--   SELECT count(*) FROM clean_vehicle_prices c JOIN vehicles v ON v.id=c.vehicle_id
--    WHERE c.is_sold AND (v.auction_outcome IN ('reserve_not_met','no_sale') OR v.sale_status IN ('not_sold','unsold','bid_to'));
