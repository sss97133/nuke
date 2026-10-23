-- Shadow quality/confidence score from comp depth + hierarchy fallback level (no nuke_estimate input).
-- Evidence corroboration did not predict error; comp depth and fallback level do (train-fold calibration,
-- held-out md5 mod 5 = 0 tertiles: high 0.260, medium 0.303, low 0.401 MdAPE).
-- Revert: supabase/sql/revert_20261025141000_shadow_estimate_quality.sql
CREATE TABLE IF NOT EXISTS public.shadow_quality_calibration (
  calibration_version text NOT NULL,
  level        smallint NOT NULL,       -- 0 model, 1 model family, 2 make+decade
  n_comps_lo   int NOT NULL,
  n_comps_hi   int NOT NULL,
  train_n      int NOT NULL,
  expected_mdape numeric(6,4) NOT NULL, -- train-fold median |pred-p|/p
  cov80_train  numeric(6,4),
  heldout_n    int,
  heldout_mdape numeric(6,4),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (calibration_version, level, n_comps_lo)
);
INSERT INTO public.shadow_quality_calibration
 (calibration_version, level, n_comps_lo, n_comps_hi, train_n, expected_mdape, cov80_train, heldout_n, heldout_mdape) VALUES
 ('quality-v1',0,3,4,2811,0.2923,0.7560,747,0.2941),
 ('quality-v1',0,5,9,3981,0.2794,0.7825,935,0.2720),
 ('quality-v1',0,10,19,3961,0.2601,0.7970,959,0.2666),
 ('quality-v1',0,20,39,3481,0.2545,0.8159,830,0.2567),
 ('quality-v1',0,40,40,5093,0.2586,0.8139,1228,0.2575),
 ('quality-v1',1,3,4,1360,0.3568,0.7471,378,0.3486),
 ('quality-v1',1,5,9,2029,0.3538,0.7915,473,0.3359),
 ('quality-v1',1,10,19,2031,0.3484,0.7730,530,0.3682),
 ('quality-v1',1,20,39,1835,0.3465,0.7951,428,0.3523),
 ('quality-v1',1,40,40,3883,0.3710,0.7716,1027,0.3729),
 ('quality-v1',2,3,4,275,0.4213,0.8036,71,0.5700),
 ('quality-v1',2,5,9,436,0.4145,0.7821,121,0.4286),
 ('quality-v1',2,10,19,511,0.4417,0.7593,137,0.4917),
 ('quality-v1',2,20,39,610,0.4412,0.7492,136,0.4627),
 ('quality-v1',2,40,40,2025,0.5302,0.7116,522,0.4831)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.nuke_estimate_quality_shadow (
  id             bigserial PRIMARY KEY,
  run_id         uuid NOT NULL,
  vehicle_id     uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  model_version  text NOT NULL,           -- nuke_estimates_shadow.model_version scored
  calibration_version text NOT NULL,
  level          smallint NOT NULL,
  n_comps        int NOT NULL,
  expected_mdape numeric(6,4) NOT NULL,
  quality_score  smallint NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  confidence     text NOT NULL CHECK (confidence IN ('high','medium','low')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  computed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, model_version, calibration_version)
);
ALTER TABLE public.shadow_quality_calibration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuke_estimate_quality_shadow ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.nuke_estimate_quality_shadow IS
'Shadow-only quality score per shadow estimate: expected error looked up from shadow_quality_calibration by (fallback level, comp depth). quality_score = round(100*(1-expected_mdape)). confidence: high <0.27, medium <0.36, else low. Not an input to vehicles.nuke_estimate.';

CREATE OR REPLACE FUNCTION public.fill_estimate_quality_shadow(p_run_id uuid, p_calibration text DEFAULT 'quality-v1')
RETURNS integer LANGUAGE plpgsql SET statement_timeout = '120s' AS $fn$
DECLARE n int;
BEGIN
  INSERT INTO public.nuke_estimate_quality_shadow (run_id, vehicle_id, model_version, calibration_version, level, n_comps,
         expected_mdape, quality_score, confidence)
  SELECT p_run_id, e.vehicle_id, e.model_version, c.calibration_version, c.level, (e.citations->>'n_comps')::int,
         c.expected_mdape, greatest(0, least(100, round(100 * (1 - c.expected_mdape))))::smallint,
         CASE WHEN c.expected_mdape < 0.27 THEN 'high' WHEN c.expected_mdape < 0.36 THEN 'medium' ELSE 'low' END
  FROM public.nuke_estimates_shadow e
  JOIN public.shadow_quality_calibration c
    ON c.calibration_version = p_calibration AND c.status = 'active'
   AND c.level = coalesce((e.citations->>'level')::int, 0)
   AND (e.citations->>'n_comps')::int BETWEEN c.n_comps_lo AND c.n_comps_hi
  WHERE e.model_version IN ('shadow-v2-hammer-pit','shadow-v3-hier-fallback')
  ON CONFLICT (vehicle_id, model_version, calibration_version) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $fn$;
