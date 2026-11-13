-- live_finish_estimates reads the other board houses' live lots too, not Bring a Trailer's alone.
--
-- The model 32 writer (scripts/market/live-finish.mjs + live-finish.py) now also estimates a house's open lots
-- (market_pulse_live_houses) when that house's own backtest passed: model 32's BaT analog read replayed on the house's
-- closed lots at the calibration horizons with the bid as it stood then, shifted and widened per horizon by what that
-- replay measured, and shown only up to the longest horizon where the held-out lots met the bar (75-85% inside the range,
-- median miss <= 20%). scripts/market/live-finish-houses.py does the replay and writes the result to
-- live-finish-coverage.json "houses"; each row carries its house's measured in-range share and n.
-- Measured 2026-11-08: PCarMarket, model 32 replayed on 932 closed lots (2025-07-01..2026-09-25, their stored results
-- pages' full bid lists); held out 373 lots closed 2026-04-20..09-25: 76-78% inside the range with a median miss of
-- 14% at ten minutes, 18% at one hour and 20% at three hours, so PCarMarket lots are estimated in their last three hours.
-- Not shown: Collecting Cars (Nuke keeps no bid path for its closed lots) and eBay Motors (no final price for an ended
-- eBay auction); the writer writes no row for them, so this reader has nothing to serve.
--
-- The change here is the lot list: a public live lot of BaT, or of a house the live board reads (live_board_houses,
-- recognised as market_pulse_live_houses does: platform_source or the listing URL's host). Rows, columns, freshness, the
-- model 33 / 32 choice and the definer's field list are unchanged; Cars & Bids, Bonhams, Broad Arrow and Gooding lots
-- (no model 32 rows) read nothing.
-- Contract: supabase/sql/test_live_finish_estimates.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE cur text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO cur
    FROM pg_proc WHERE oid = 'public.live_finish_estimates(uuid[])'::regprocedure;
  IF cur IS DISTINCT FROM 'ty+Am5V/UvRzfrRuCOI2N7RbYTCfC26IJLvvc7RpwCY=' AND cur IS DISTINCT FROM 'NssaLOu0K1v9GMWg6BC2SdqYPObQOaIaVbWPZWD2aR4=' THEN
    RAISE EXCEPTION 'live_finish_estimates drifted from 20261018010000 (sha256 %)', cur;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.live_finish_estimates(p_vehicle_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH beat AS (
    SELECT (SELECT max(h.predicted_at) FROM public.hammer_predictions h WHERE h.model_version = 32) AS at32,
           (SELECT max(h.predicted_at) FROM public.hammer_predictions h
             WHERE h.model_version = 33 AND h.predicted_at > now() - interval '2 hours') AS at33
  ), fresh AS (
    SELECT b.at32, b.at33, b.at33 IS NOT NULL AS ok33, coalesce(b.at32 > now() - interval '2 hours', false) AS ok32 FROM beat b
  ), live AS (
    SELECT v.id
    FROM public.vehicles v
    WHERE v.is_public AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.sale_status = 'auction_live'
      AND (v.platform_source = 'bringatrailer'
           OR EXISTS (SELECT 1 FROM public.live_board_houses lh
                      WHERE lh.enabled AND (v.platform_source = lh.house OR v.listing_url ~* lh.host_pattern)))
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
      AND (p_vehicle_ids IS NULL OR v.id = ANY (p_vehicle_ids))
  ), est AS (
    SELECT l.id, h.model_version, h.predicted_hammer, h.predicted_low, h.predicted_high, h.confidence_score, h.current_bid,
           h.predicted_at, CASE WHEN h.notes IS JSON OBJECT THEN h.notes::jsonb END AS n
    FROM live l
    CROSS JOIN fresh f
    CROSS JOIN LATERAL (
      -- the lot's latest row of each fresh model; model 33 unless the model 32 row is more than an hour newer
      SELECT y.* FROM (
        SELECT x.*, max(x.predicted_at) FILTER (WHERE x.model_version = 32) OVER () AS at32_lot
        FROM (
          SELECT DISTINCT ON (h.model_version) h.model_version, h.predicted_hammer, h.predicted_low, h.predicted_high,
                 h.confidence_score, h.current_bid, h.predicted_at, h.notes
          FROM public.hammer_predictions h
          WHERE h.vehicle_id = l.id
            AND ((h.model_version = 33 AND f.ok33) OR (h.model_version = 32 AND f.ok32))
          ORDER BY h.model_version, h.predicted_at DESC
        ) x
      ) y
      ORDER BY (y.model_version = 33 AND (y.at32_lot IS NULL OR y.predicted_at >= y.at32_lot - interval '1 hour')) DESC,
               (y.model_version = 32) DESC
      LIMIT 1
    ) h
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'writer_at', (SELECT CASE WHEN ok33 THEN at33 ELSE at32 END FROM fresh),
    'fresh', (SELECT ok33 OR ok32 FROM fresh),
    'model', (SELECT CASE WHEN ok33 THEN 33 WHEN ok32 THEN 32 END FROM fresh),
    'writers', (SELECT jsonb_build_object('32', at32, '33', at33) FROM fresh),
    'columns', jsonb_build_array('vehicle_id', 'estimate', 'low', 'high', 'grade', 'coverage', 'sentence',
                                 'estimated_at', 'bid_at_estimate', 'comps_through', 'model', 'factors'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(e.id, e.predicted_hammer, e.predicted_low, e.predicted_high, e.n->>'grade',
                                         e.confidence_score, CASE WHEN e.model_version = 32 THEN e.n->>'sentence' END,
                                         e.predicted_at, e.current_bid, e.n->>'comps_through', e.model_version,
                                         CASE WHEN e.model_version = 33 AND jsonb_typeof(e.n->'factors') = 'object'
                                              THEN e.n->'factors' END) ORDER BY e.id)
      FROM est e), '[]'::jsonb),
    'analogs', CASE WHEN (SELECT ok33 OR ok32 FROM fresh) AND p_vehicle_ids IS NOT NULL AND cardinality(p_vehicle_ids) <= 5 THEN coalesce((
      SELECT jsonb_object_agg(e.id, coalesce(e.n->'analogs', '[]'::jsonb)) FROM est e), '{}'::jsonb) END
  );
$$;

COMMENT ON FUNCTION public.live_finish_estimates(uuid[]) IS
  'Where each public live lot of BaT or another board house (live_board_houses) should finish: its latest '
  'hammer_predictions model 33 row while that writer ran in the last two hours, else its latest model 32 row while that '
  'writer did (estimate, 80% range, grade, measured coverage, model 32''s sentence, when, at what bid, comps date, model, '
  'model 33''s factor steps). Another house''s lot has rows only once its own backtest passed (the model 32 writer''s '
  'live-finish-coverage.json houses). Withholds every estimate when neither writer ran for two hours. Analogs only for '
  'up to five named lots. Definer: these fields only.';

REVOKE ALL ON FUNCTION public.live_finish_estimates(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_finish_estimates(uuid[]) TO anon, authenticated, service_role;

COMMIT;
