-- SHADOW valuation + corroboration quality score. Nothing live reads these tables; vehicles.nuke_estimate,
-- nuke_estimates, data_quality_score and vehicle_grades are untouched.
-- Circularity removed in shadow only: no self_price_fallback / is_circular base, no nuke_estimate or
-- data_quality_score inputs to the quality score.

CREATE TABLE IF NOT EXISTS public.shadow_valuation_models (
  model_version text PRIMARY KEY,
  coefficients jsonb NOT NULL,          -- {"f_records": beta, ...}: log-price multiplier per unit feature
  interval_quantiles jsonb NOT NULL,    -- {"0": [q10,q90], "1": [...], "2": [...], "3": [...]}: log residuals by n_sources bucket
  train_n int NOT NULL, split_rule text NOT NULL, fit_run_id uuid NOT NULL, fitted_at timestamptz NOT NULL DEFAULT now(), notes text);
ALTER TABLE public.shadow_valuation_models ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.nuke_estimates_shadow (
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  model_version text NOT NULL REFERENCES public.shadow_valuation_models(model_version),
  as_of timestamptz NOT NULL,
  base_value numeric, base_comp_method text,
  evidence_multiplier numeric, shadow_value numeric, shadow_low numeric, shadow_high numeric,
  n_sources int, citations jsonb, run_id uuid NOT NULL, computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, model_version));
ALTER TABLE public.nuke_estimates_shadow ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.compute_shadow_estimates(p_model_version text, p_run_id uuid, p_vehicle_ids uuid[])
RETURNS integer LANGUAGE plpgsql SET statement_timeout = '120s' SET search_path = public AS $fn$
DECLARE n int; m record;
BEGIN
  IF array_length(p_vehicle_ids,1) > 500 THEN RAISE EXCEPTION 'max 500 per call'; END IF;
  SELECT * INTO m FROM shadow_valuation_models WHERE model_version = p_model_version;
  INSERT INTO nuke_estimates_shadow AS s (vehicle_id, model_version, as_of, base_value, base_comp_method, evidence_multiplier,
         shadow_value, shadow_low, shadow_high, n_sources, citations, run_id)
  SELECT f.vehicle_id, p_model_version, f.as_of, ne.estimated_value, ne.comp_method, x.mult,
         ne.estimated_value * x.mult,
         ne.estimated_value * x.mult * exp((m.interval_quantiles -> x.b ->> 0)::numeric),
         ne.estimated_value * x.mult * exp((m.interval_quantiles -> x.b ->> 1)::numeric),
         f.n_sources, f.citations, p_run_id
  FROM evidence_features_current f
  JOIN nuke_estimates ne ON ne.vehicle_id = f.vehicle_id
       AND ne.estimated_value > 0 AND NOT coalesce(ne.is_circular, false) AND ne.comp_method IS DISTINCT FROM 'self_price_fallback'
  CROSS JOIN LATERAL (SELECT
       exp(coalesce((m.coefficients->>'intercept')::numeric, 0)
         + coalesce((m.coefficients->>'f_condition')::numeric, 0) * coalesce(f.f_condition, 0)
         + coalesce((m.coefficients->>'f_originality')::numeric, 0) * coalesce(f.f_originality, 0)
         + coalesce((m.coefficients->>'f_documented_work')::numeric, 0) * coalesce(f.f_documented_work, 0)
         + coalesce((m.coefficients->>'f_records')::numeric, 0) * coalesce(f.f_records, 0)
         + coalesce((m.coefficients->>'f_ownership')::numeric, 0) * coalesce(f.f_ownership, 0)
         + coalesce((m.coefficients->>'f_identity')::numeric, 0) * coalesce(f.f_identity, 0)) AS mult,
       least(coalesce(f.n_sources, 0), 3)::text AS b) x
  WHERE f.vehicle_id = ANY(p_vehicle_ids)
  ON CONFLICT (vehicle_id, model_version) DO UPDATE SET as_of=excluded.as_of, base_value=excluded.base_value,
    base_comp_method=excluded.base_comp_method, evidence_multiplier=excluded.evidence_multiplier, shadow_value=excluded.shadow_value,
    shadow_low=excluded.shadow_low, shadow_high=excluded.shadow_high, n_sources=excluded.n_sources, citations=excluded.citations,
    run_id=excluded.run_id, computed_at=now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $fn$;

-- Corroboration quality: each dimension saturates with independent sources, 1 - 0.5^n (1 source = 0.5, 2 = 0.75, 3 = 0.875).
CREATE TABLE IF NOT EXISTS public.shadow_quality_weights (
  dimension text PRIMARY KEY, weight numeric NOT NULL, basis text NOT NULL);
ALTER TABLE public.shadow_quality_weights ENABLE ROW LEVEL SECURITY;
INSERT INTO public.shadow_quality_weights VALUES
 ('identity', 0.25, 'who/what the vehicle is: VIN stamping, title, field provenance sources'),
 ('records', 0.15, 'records present (odometer statements, inspections, listing-cited records)'),
 ('documented_work', 0.15, 'receipts / repair orders / listing-cited work'),
 ('ownership', 0.15, 'chain of title / ownership history'),
 ('condition', 0.10, 'condition evidence of either polarity (it is coverage, not goodness)'),
 ('originality', 0.10, 'originality evidence of either polarity'),
 ('photos', 0.10, 'active image observations, 1 - 0.5^(n/10)')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW public.vehicle_quality_shadow WITH (security_invoker = true) AS
  SELECT f.vehicle_id, f.as_of,
    round(100 * (
        (SELECT weight FROM public.shadow_quality_weights WHERE dimension='identity')        * (1 - 0.5 ^ coalesce(f.n_identity,0))
      + (SELECT weight FROM public.shadow_quality_weights WHERE dimension='records')         * (1 - 0.5 ^ coalesce(f.n_records,0))
      + (SELECT weight FROM public.shadow_quality_weights WHERE dimension='documented_work') * (1 - 0.5 ^ coalesce(f.n_documented_work,0))
      + (SELECT weight FROM public.shadow_quality_weights WHERE dimension='ownership')       * (1 - 0.5 ^ coalesce(f.n_ownership,0))
      + (SELECT weight FROM public.shadow_quality_weights WHERE dimension='condition')       * (1 - 0.5 ^ coalesce(f.n_condition,0))
      + (SELECT weight FROM public.shadow_quality_weights WHERE dimension='originality')     * (1 - 0.5 ^ coalesce(f.n_originality,0))
      + (SELECT weight FROM public.shadow_quality_weights WHERE dimension='photos')          * (1 - 0.5 ^ (coalesce(f.n_photos,0) / 10.0))
    ), 1) AS quality_score_shadow,
    f.n_sources, f.citations
  FROM public.evidence_features_current f;
