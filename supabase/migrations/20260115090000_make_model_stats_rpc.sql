-- Make/Model stats RPCs
-- Provides two read-only endpoints:
--  1) get_vehicle_counts_by_ecr_make_model: counts of vehicles for each ECR make+model, including 0s
--  2) get_ecr_models_by_make: list of ECR models per make
--
-- Intended consumer: scripts/report-make-model-stats.ts
--
-- SECURITY NOTES
-- - get_vehicle_counts_by_ecr_make_model uses SECURITY DEFINER to bypass RLS on vehicles, but is
--   executable only by service_role.
-- - get_ecr_models_by_make is public-safe since ecr_* tables are already public-readable.

CREATE OR REPLACE FUNCTION public.get_vehicle_counts_by_ecr_make_model(
  exclude_merged BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  ecr_make_slug TEXT,
  make TEXT,
  ecr_model_slug TEXT,
  model TEXT,
  vehicle_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH vehicle_counts AS (
  SELECT
    lower(v.make) AS make_lc,
    lower(v.model) AS model_lc,
    count(*)::int AS vehicle_count
  FROM public.vehicles v
  WHERE (
    exclude_merged IS DISTINCT FROM TRUE
    OR v.status IS DISTINCT FROM 'merged'
  )
  GROUP BY 1, 2
)
SELECT
  em.ecr_make_slug,
  em.make_name AS make,
  ecm.ecr_model_slug,
  ecm.model_name AS model,
  coalesce(vc.vehicle_count, 0)::int AS vehicle_count
FROM public.ecr_makes em
JOIN public.ecr_models ecm
  ON ecm.ecr_make_slug = em.ecr_make_slug
LEFT JOIN vehicle_counts vc
  ON vc.make_lc = lower(em.make_name)
 AND vc.model_lc = lower(ecm.model_name)
WHERE em.is_active IS DISTINCT FROM FALSE
  AND ecm.is_active IS DISTINCT FROM FALSE
ORDER BY em.make_name, ecm.model_name;
$$;

REVOKE ALL ON FUNCTION public.get_vehicle_counts_by_ecr_make_model(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_counts_by_ecr_make_model(BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.get_ecr_models_by_make()
RETURNS TABLE (
  ecr_make_slug TEXT,
  make TEXT,
  model_count INTEGER,
  models TEXT[]
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
SELECT
  em.ecr_make_slug,
  em.make_name AS make,
  count(ecm.ecr_model_slug)::int AS model_count,
  array_agg(ecm.model_name ORDER BY ecm.model_name) AS models
FROM public.ecr_makes em
JOIN public.ecr_models ecm
  ON ecm.ecr_make_slug = em.ecr_make_slug
WHERE em.is_active IS DISTINCT FROM FALSE
  AND ecm.is_active IS DISTINCT FROM FALSE
GROUP BY em.ecr_make_slug, em.make_name
ORDER BY em.make_name;
$$;

REVOKE ALL ON FUNCTION public.get_ecr_models_by_make() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ecr_models_by_make() TO anon, authenticated, service_role;

