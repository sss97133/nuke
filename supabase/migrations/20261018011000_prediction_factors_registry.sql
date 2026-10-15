-- prediction_factors: the registry of what a prediction model reads, and what each factor was last measured to be worth.
--
-- Model 33 (live BaT finish estimates) moves model 32's analog read by a residual learner over factor families: trim and
-- spec, the room (bids and comments up to the moment), cultural pull, other markets, the same car's history, and the
-- analog core's own read. Each factor has a definition, the source it reads, the rule that keeps it point-in-time, a
-- status (core, keep, drop_candidate, dropped) and measurements (numbers only: lift in median-miss points per horizon,
-- family drop-one lift, non-missing share, lots measured). The Mac job that retrains the model monthly re-measures every
-- factor and records it here through record_prediction_factor(); a factor's current entry is its newest row, and each
-- row names the one it supersedes, so a re-measurement never overwrites the last one.
-- Readable by anyone (the registry is public method, not private data); written only by record_prediction_factor(),
-- which service_role alone executes. No rows are seeded here.
-- Contract: supabase/sql/test_prediction_factors_registry.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.prediction_factors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_version integer NOT NULL CHECK (model_version > 0),
  factor_key text NOT NULL CHECK (factor_key ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  family text NOT NULL CHECK (family IN ('core', 'trim', 'room', 'cultural', 'markets', 'history', 'other')),
  definition text NOT NULL CHECK (length(btrim(definition)) > 0),
  source text NOT NULL CHECK (length(btrim(source)) > 0),
  as_of_rule text NOT NULL CHECK (length(btrim(as_of_rule)) > 0),
  status text NOT NULL CHECK (status IN ('core', 'keep', 'drop_candidate', 'dropped')),
  measures jsonb NOT NULL CHECK (jsonb_typeof(measures) = 'object'),
  measured_on text NOT NULL CHECK (length(btrim(measured_on)) > 0),
  measured_at timestamptz NOT NULL,
  supersedes bigint REFERENCES public.prediction_factors (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL   -- the declared writer: app.writer, else the X-Nuke-Writer header, else 'undeclared'
);
CREATE INDEX IF NOT EXISTS prediction_factors_current_idx
  ON public.prediction_factors (model_version, factor_key, measured_at DESC, id DESC);
COMMENT ON TABLE public.prediction_factors IS
  'What each prediction model factor reads and was last measured to be worth (lift per horizon, numbers only). Newest '
  'row per (model_version, factor_key) is current; supersedes names the row it replaced. Written only by '
  'record_prediction_factor().';

ALTER TABLE public.prediction_factors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prediction_factors_read ON public.prediction_factors;
CREATE POLICY prediction_factors_read ON public.prediction_factors FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.prediction_factors FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.prediction_factors TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_prediction_factor(
  p_model_version integer,
  p_factor_key text,
  p_family text,
  p_definition text,
  p_source text,
  p_as_of_rule text,
  p_status text,
  p_measures jsonb,
  p_measured_on text,
  p_measured_at timestamptz
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior bigint;
  new_id bigint;
BEGIN
  IF p_measures IS NULL OR jsonb_typeof(p_measures) <> 'object' THEN
    RAISE EXCEPTION 'measures must be a JSON object' USING ERRCODE = '22023';
  END IF;
  -- numbers only: every leaf is a number or null (objects nest them, e.g. {"lift_pts": {"24h": 0.66}})
  IF jsonb_path_exists(p_measures, 'strict $.** ? (@.type() == "string" || @.type() == "boolean" || @.type() == "array")') THEN
    RAISE EXCEPTION 'measures holds numbers only (by name, nested objects allowed)' USING ERRCODE = '22023';
  END IF;
  IF p_measured_at IS NULL OR p_measured_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'measured_at must be a past moment' USING ERRCODE = '22023';
  END IF;
  -- one writer at a time per factor, so each row supersedes the one before it
  PERFORM pg_advisory_xact_lock(hashtextextended('prediction_factors:' || p_model_version || ':' || coalesce(p_factor_key, ''), 0));
  SELECT f.id INTO prior FROM public.prediction_factors f
   WHERE f.model_version = p_model_version AND f.factor_key = p_factor_key
   ORDER BY f.measured_at DESC, f.id DESC LIMIT 1;
  INSERT INTO public.prediction_factors (model_version, factor_key, family, definition, source, as_of_rule, status, measures,
                                         measured_on, measured_at, supersedes, recorded_by)
  VALUES (p_model_version, p_factor_key, p_family, p_definition, p_source, p_as_of_rule, p_status, p_measures,
          p_measured_on, p_measured_at, prior,
          coalesce(nullif(current_setting('app.writer', true), ''),
                   nullif(current_setting('request.headers', true), '')::json->>'x-nuke-writer', 'undeclared'))
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;
COMMENT ON FUNCTION public.record_prediction_factor(integer, text, text, text, text, text, text, jsonb, text, timestamptz) IS
  'Record one measurement of a prediction model factor (append-only: the new row supersedes the factor''s newest row). '
  'Measures are numbers only. service_role only; the monthly retrain calls it per factor.';
REVOKE ALL ON FUNCTION public.record_prediction_factor(integer, text, text, text, text, text, text, jsonb, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_prediction_factor(integer, text, text, text, text, text, text, jsonb, text, timestamptz) TO service_role;

COMMIT;
