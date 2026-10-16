-- live_finish_estimates serves model 33 while its writer is fresh, else model 32 as before.
--
-- Model 33 is model 32's analog read moved by a residual learner over five factor families (trim and spec, the room,
-- cultural pull, other markets, the same car's history), every input point-in-time and held by prod as well as the
-- archive. Measured offline (2026-10-15, ~/nuke-logs/finish-model-33/eval33v2.txt): on 25,620-25,673 archive car lots
-- closed 2026-04..09, never used for fitting, the median miss is 16.6% three days out and 10.9% at ten minutes
-- (model 32: 19.9% and 12.7%), with 80% ranges holding 79.1-79.7%. Model 33 rows are written by a Mac job like model 32.
--
-- Per lot: its latest model 33 row while the model 33 writer has run within two hours, unless the lot's latest model 32
-- row is more than an hour newer (model 33 skipped it since); otherwise its latest model 32 row while that writer has
-- run within two hours; otherwise nothing, as before.
-- Existing keys and columns keep their names, order and meaning. Added: a 'model' column (32 or 33) and a 'factors'
-- column (model 33's numeric step from the analog read to the estimate: core.est32 and the dollars each family moved it,
-- trim, room, cultural, markets, history, other; null on model 32 rows), and top-level 'model' (the model served while
-- fresh) and 'writers' (each writer's last run). 'writer_at' is the served model's last run.
-- Model 33 carries no sentence: its card shows the numbers. The model 33 freshness read is bounded to the last two
-- hours of predicted_at (hammer_predictions has no model_version index).
-- SECURITY DEFINER as before: only the fields above leave, only for public live lots, only models 32 and 33.
-- Contract: supabase/sql/test_live_finish_estimates.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE cur text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO cur
    FROM pg_proc WHERE oid = 'public.live_finish_estimates(uuid[])'::regprocedure;
  IF cur IS DISTINCT FROM 'Txfp6IN0WN9sDAXG/cCgggUfLHXC2qeDjzB6lPtiLQs=' AND cur IS DISTINCT FROM 'ty+Am5V/UvRzfrRuCOI2N7RbYTCfC26IJLvvc7RpwCY=' THEN
    RAISE EXCEPTION 'live_finish_estimates drifted from 20261015100000 (sha256 %)', cur;
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
      AND v.platform_source = 'bringatrailer'
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
  'Where each public live BaT lot should finish: its latest hammer_predictions model 33 row while that writer ran in '
  'the last two hours, else its latest model 32 row while that writer did (estimate, 80% range, grade, measured '
  'coverage, model 32''s sentence, when, at what bid, comps date, model, model 33''s factor steps). Withholds every '
  'estimate when neither writer ran for two hours. Analogs only for up to five named lots. Definer: these fields only.';

REVOKE ALL ON FUNCTION public.live_finish_estimates(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_finish_estimates(uuid[]) TO anon, authenticated, service_role;

COMMIT;
