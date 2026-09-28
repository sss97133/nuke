-- get_model_price_history: a model family's sales over time, fast enough for the vehicle page's price chart.
--
-- The vehicle page's PriceHistoryChart found comparables by filtering vehicle_events (1 GB) through an embedded
-- vehicles!inner join on year / make ILIKE / model ILIKE, ordered by created_at: for most models PostgREST scanned
-- until 200 matches — 15.2 s on nuke.ag/vehicle/1342dcc3 (2026-09-27) and a 57014 statement timeout for
-- visitors on the K5 page (ISSUES, 16:31Z). It also plotted a sale at the row's created_at when it had no sale
-- date — the import date, not the auction.
--
-- This function already answered "a model's sales, dated" and had no callers. Rebuilt:
--   * year bounds (optional), so a big family reads only its years: Porsche 911 1979–85 772 ms / 3,230 blocks,
--     Ford Mustang 1964–68 2,425 ms, Chevrolet Corvette 1966–72 2,648 ms; all years were 21.7 s / 13.1 s;
--   * the index-backed model match of 79ed0dae3 (lower(model) = m OR lower(normalized_model) = m — the rows
--     lower(coalesce(normalized_model, model)) = m OR lower(model) = m matched);
--   * only sales: vehicle_sale_basis() (the sale rule), sale_date required (the auction's date, never import),
--     not deleted;
--   * each point carries vehicle_id, year, model and platform next to date and price (old keys kept).
-- Signature grows by two defaulted arguments, so the old 3-argument function is replaced (DROP + CREATE in one
-- transaction) rather than overloaded — PostgREST cannot choose between overloads with defaults.
SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

DROP FUNCTION IF EXISTS public.get_model_price_history(text, text, integer);

CREATE FUNCTION public.get_model_price_history(
  p_make text,
  p_model text,
  p_limit integer DEFAULT 30,
  p_year_min integer DEFAULT NULL,
  p_year_max integer DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', v.sale_date,
        'price', v.sale_price,
        'vehicle_id', v.id,
        'year', v.year,
        'model', v.model,
        'platform', v.platform
      ) ORDER BY v.sale_date ASC
    ),
    '[]'::jsonb
  ) INTO result
  FROM (
    SELECT id, year, model, sale_date, sale_price, coalesce(nullif(canonical_platform, 'unknown'), platform_source) AS platform
    FROM vehicles
    WHERE lower(make) = lower(p_make)
      AND (lower(model) = lower(p_model) OR lower(normalized_model) = lower(p_model))
      AND (p_year_min IS NULL OR year >= p_year_min)
      AND (p_year_max IS NULL OR year <= p_year_max)
      AND sale_price > 0
      AND sale_date IS NOT NULL
      AND deleted_at IS NULL
      AND vehicle_sale_basis(sale_status, auction_outcome, canonical_platform, listing_url, discovery_url,
                             sale_price::numeric, notes, import_metadata, created_at) IS NOT NULL
    ORDER BY sale_date DESC
    LIMIT least(greatest(coalesce(p_limit, 30), 1), 500)
  ) v;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_model_price_history(text, text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_model_price_history(text, text, integer, integer, integer) TO anon, authenticated, service_role;

COMMIT;

RESET lock_timeout;
RESET statement_timeout;
