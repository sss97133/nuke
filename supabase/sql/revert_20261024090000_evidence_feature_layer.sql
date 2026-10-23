DROP VIEW IF EXISTS public.evidence_features_current;
DROP FUNCTION IF EXISTS public.compute_evidence_features(uuid[], timestamptz[], uuid);
DROP TABLE IF EXISTS public.evidence_features;
DROP FUNCTION IF EXISTS public.evidence_items(uuid, timestamptz);
DROP TABLE IF EXISTS public.evidence_source_feature_map;
