-- Depth promotion: make the "many targets per image" queryable.
--
-- The BYOK deep-analysis drain (scripts/deep-image-analysis-byok.mjs) already lands a
-- rich, multi-target verdict per frame: ~3.7 component detections + OCR text regions per
-- image, each with a label/confidence/bbox. But it stores them only as nested arrays
-- inside vehicle_observations.structured_data (one observation row per image) AND inside
-- vehicle_images.ai_scan_metadata.byok_deep_analysis. So the depth is captured but NOT
-- queryable as targets: you cannot ask "every frame showing a 289 V8" or "every OCR
-- serial read" without scanning JSONB.
--
-- The relational tables originally meant to hold this (component_identifications and its
-- required parent image_analysis_records) are dead (docs/dead_tables_candidates.txt) —
-- they belong to an abandoned "reference system" pipeline and require an analysis-record
-- FK that nothing populates. Rather than revive dead tables or duplicate the 7.5M-row
-- observation firehose with a backfill, we EXPOSE the depth that already landed: two
-- views that explode the nested target arrays into one row per target, plus a per-vehicle
-- inventory helper. Zero data migration, fully reversible (DROP VIEW), and it stays in
-- sync automatically as the drain writes more observations.
--
-- security_invoker = true: the views respect the querying role's RLS on
-- vehicle_observations (no privilege escalation through the view).

-- One row per detected COMPONENT target (the part-level depth).
CREATE OR REPLACE VIEW public.image_component_targets
WITH (security_invoker = true) AS
SELECT
  vo.id                                          AS observation_id,
  (vo.structured_data->>'image_id')::uuid        AS image_id,
  vo.vehicle_id,
  vo.observed_at,
  c->>'label'                                    AS label,
  NULLIF(c->>'part_number_guess', '')            AS part_number_guess,
  NULLIF(c->>'confidence', '')::numeric          AS confidence,
  c->'bbox'                                       AS bbox,
  vo.structured_data->>'scene_type'              AS scene_type,
  vo.structured_data->>'build_phase_guess'       AS build_phase_guess,
  vo.agent_model
FROM public.vehicle_observations vo
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(vo.structured_data->'components_seen', '[]'::jsonb)
) AS c
WHERE vo.structured_data->>'analysis_kind' = 'image_deep_byok'
  AND vo.is_superseded = false;

COMMENT ON VIEW public.image_component_targets IS
  'Exploded component detections from BYOK deep-analysis (one row per component target). '
  'Source: vehicle_observations.structured_data.components_seen. Read-only / always fresh.';

-- One row per OCR TEXT target (badges, data plates, serials — the strongest identity signal).
CREATE OR REPLACE VIEW public.image_text_targets
WITH (security_invoker = true) AS
SELECT
  vo.id                                          AS observation_id,
  (vo.structured_data->>'image_id')::uuid        AS image_id,
  vo.vehicle_id,
  vo.observed_at,
  t->>'text'                                     AS text,
  NULLIF(t->>'confidence', '')::numeric          AS confidence,
  t->'bbox'                                       AS bbox,
  vo.structured_data->>'scene_type'              AS scene_type
FROM public.vehicle_observations vo
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(vo.structured_data->'text_regions', '[]'::jsonb)
) AS t
WHERE vo.structured_data->>'analysis_kind' = 'image_deep_byok'
  AND vo.is_superseded = false;

COMMENT ON VIEW public.image_text_targets IS
  'Exploded OCR text regions from BYOK deep-analysis (one row per text target). '
  'Source: vehicle_observations.structured_data.text_regions. Read-only / always fresh.';

-- Per-vehicle component inventory: what parts have been seen, how often, how confidently.
CREATE OR REPLACE FUNCTION public.get_vehicle_component_inventory(p_vehicle_id uuid)
RETURNS TABLE(label text, sightings bigint, avg_confidence numeric, example_image uuid)
LANGUAGE sql STABLE AS $$
  SELECT label,
         count(*)                       AS sightings,
         round(avg(confidence), 2)      AS avg_confidence,
         (array_agg(image_id ORDER BY confidence DESC NULLS LAST))[1] AS example_image
  FROM public.image_component_targets
  WHERE vehicle_id = p_vehicle_id
  GROUP BY label
  ORDER BY count(*) DESC, label;
$$;

COMMENT ON FUNCTION public.get_vehicle_component_inventory(uuid) IS
  'Aggregated component sightings for a vehicle, derived from image_component_targets.';
