-- live_finish_estimates: where each live BaT lot should finish, from the prediction ledger's model 32.
--
-- The owner's ask (2026-10-15): gauge where a live lot will finish from what equivalent lots did before, with an
-- estimate and how confident it is. Backtested offline (~/nuke-logs/auction-finish-20261015/REPORT.md): on 25,673 car
-- lots closed 2026-04..09, never used for tuning, the analog estimator misses by a median 16.7% a day before the close
-- and 11.7% at ten minutes, and its 80% ranges held 79-80% (77.5% for grade A on 1,732 lots closed 09-28..10-14). The
-- board's band (model 31) misses by 27% at every hour. Model 32 rows are written by a Mac job (scripts/market/
-- live-finish), like model 31: production does no heavy work.
--
-- One row per public live BaT lot (the board's own eligibility), from its latest model 32 prediction:
--   estimate, low, high (80% range), grade (A, B, C), coverage (the measured in-range share for its grade and horizon),
--   sentence (the plain-language confidence built from that measurement), estimated_at, the bid it was made at, and
--   comps_through (the last close date of the sales it rests on).
-- Every estimate is withheld when the writer has not run for two hours (writer_at), so a stopped job shows nothing
-- rather than old numbers. Analogs (the past lots an estimate rests on: page, title, close date, bid at the same hour,
-- final) come only for up to five named lots (the drawer).
-- SECURITY DEFINER: anon reads nine columns of hammer_predictions and none of notes or confidence_score; this returns
-- only the fields above, only for public live lots, and only model 32. search_path is pinned.
-- Contract: supabase/sql/test_live_finish_estimates.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.live_finish_estimates(p_vehicle_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH beat AS (
    SELECT max(h.predicted_at) AS at FROM public.hammer_predictions h WHERE h.model_version = 32
  ), live AS (
    SELECT v.id
    FROM public.vehicles v
    WHERE v.is_public AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.sale_status = 'auction_live'
      AND v.platform_source = 'bringatrailer'
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
      AND (p_vehicle_ids IS NULL OR v.id = ANY (p_vehicle_ids))
  ), est AS (
    SELECT l.id, h.predicted_hammer, h.predicted_low, h.predicted_high, h.confidence_score, h.current_bid, h.predicted_at,
           CASE WHEN h.notes IS JSON OBJECT THEN h.notes::jsonb END AS n
    FROM live l
    CROSS JOIN LATERAL (
      SELECT h.predicted_hammer, h.predicted_low, h.predicted_high, h.confidence_score, h.current_bid, h.predicted_at, h.notes
      FROM public.hammer_predictions h
      WHERE h.vehicle_id = l.id AND h.model_version = 32
      ORDER BY h.predicted_at DESC
      LIMIT 1
    ) h
  ), fresh AS (
    SELECT coalesce((SELECT at FROM beat) > now() - interval '2 hours', false) AS ok
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'writer_at', (SELECT at FROM beat),
    'fresh', (SELECT ok FROM fresh),
    'columns', jsonb_build_array('vehicle_id', 'estimate', 'low', 'high', 'grade', 'coverage', 'sentence',
                                 'estimated_at', 'bid_at_estimate', 'comps_through'),
    'rows', CASE WHEN (SELECT ok FROM fresh) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_array(e.id, e.predicted_hammer, e.predicted_low, e.predicted_high, e.n->>'grade',
                                         e.confidence_score, e.n->>'sentence', e.predicted_at, e.current_bid,
                                         e.n->>'comps_through') ORDER BY e.id)
      FROM est e), '[]'::jsonb) ELSE '[]'::jsonb END,
    'analogs', CASE WHEN (SELECT ok FROM fresh) AND p_vehicle_ids IS NOT NULL AND cardinality(p_vehicle_ids) <= 5 THEN coalesce((
      SELECT jsonb_object_agg(e.id, coalesce(e.n->'analogs', '[]'::jsonb)) FROM est e), '{}'::jsonb) END
  );
$$;

COMMENT ON FUNCTION public.live_finish_estimates(uuid[]) IS
  'Where each public live BaT lot should finish: its latest hammer_predictions model 32 row (estimate, 80% range, '
  'grade, measured coverage, confidence sentence, when, at what bid, comps date). Withholds every estimate when the '
  'writer has not run for two hours. Analogs only for up to five named lots. Definer: model 32 fields only.';

REVOKE ALL ON FUNCTION public.live_finish_estimates(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_finish_estimates(uuid[]) TO anon, authenticated, service_role;

COMMIT;
