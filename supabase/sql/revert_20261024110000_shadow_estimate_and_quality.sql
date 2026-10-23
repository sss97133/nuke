DROP VIEW IF EXISTS public.vehicle_quality_shadow;
DROP TABLE IF EXISTS public.shadow_quality_weights;
DROP FUNCTION IF EXISTS public.compute_shadow_estimates(text, uuid, uuid[]);
DROP TABLE IF EXISTS public.nuke_estimates_shadow;
DROP TABLE IF EXISTS public.shadow_valuation_models;
