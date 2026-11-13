-- vehicle_profile_evidence(uuid): additive read of landed evidence the profile read did not carry.
-- SECURITY INVOKER: row policies decide what each viewer sees (photo_extracted_fields and photo_text_lines are
-- owner-read only, so anon gets descriptions/identifiers/field_evidence/counts and owner additionally gets photo fields).
-- vehicle_profile_read gains one new top-level key, "evidence"; every existing key and section is unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Backup of the function being replaced (also saved as /workspace/backups/backup_20261103_vehicle_profile_read.sql).
CREATE TABLE IF NOT EXISTS public.backup_20261103_vehicle_profile_read_def AS
SELECT 'vehicle_profile_read(uuid)'::text AS fn,
       pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure) AS def,
       now() AS captured_at;
REVOKE ALL ON public.backup_20261103_vehicle_profile_read_def FROM anon, authenticated;
ALTER TABLE public.backup_20261103_vehicle_profile_read_def ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.vehicle_profile_evidence(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'UTC'
AS $fn$
WITH img AS (
  SELECT jsonb_build_object(
    'rows', count(*),
    'superseded', count(*) FILTER (WHERE vi.is_superseded),
    'duplicate', count(*) FILTER (WHERE vi.is_duplicate AND NOT coalesce(vi.is_superseded, false)),
    'gallery_eligible', count(*) FILTER (WHERE public.vehicle_image_gallery_eligible(vi))
  ) AS j
  FROM public.vehicle_images_public vi WHERE vi.vehicle_id = p_vehicle_id
), gate AS (
  SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) AS j
  FROM (SELECT coalesce(vision_gate_status::text, 'none') AS k, count(*) AS n
        FROM public.vehicle_images_public WHERE vehicle_id = p_vehicle_id AND NOT coalesce(is_superseded, false)
        GROUP BY 1) q
), pef AS (
  SELECT field_name, lower(btrim(value)) AS vnorm,
         count(DISTINCT image_id) AS n_images,
         max(confidence) AS best_confidence,
         (array_agg(value ORDER BY confidence DESC))[1] AS value,
         (array_agg(quote ORDER BY confidence DESC))[1] AS quote,
         (array_agg(image_id ORDER BY confidence DESC))[1] AS image_id
  FROM public.photo_extracted_fields
  WHERE vehicle_id = p_vehicle_id AND field_name NOT LIKE 'core.%'
  GROUP BY field_name, lower(btrim(value))
), pef_ranked AS (
  SELECT *, row_number() OVER (PARTITION BY field_name ORDER BY n_images DESC, best_confidence DESC) AS rk FROM pef
), ptl AS (
  SELECT lower(btrim(text)) AS tnorm, (array_agg(text ORDER BY confidence DESC))[1] AS text,
         count(DISTINCT image_id) AS n_images, max(confidence) AS best_confidence,
         (array_agg(image_id ORDER BY confidence DESC))[1] AS image_id
  FROM public.photo_text_lines WHERE vehicle_id = p_vehicle_id AND btrim(text) <> ''
  GROUP BY lower(btrim(text))
), ident AS (
  SELECT kind::text AS kind, value, source_kind::text AS source_kind, source_url, source_image_id, quote,
         extractor::text AS extractor, confidence, evidence_class::text AS evidence_class, observed_at
  FROM public.vehicle_identifiers WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL
  ORDER BY confidence DESC NULLS LAST, observed_at DESC LIMIT 25
), fe AS (
  SELECT field_name, proposed_value AS value, status::text AS status, source_type, source_confidence AS confidence,
         extracted_at, extraction_context,
         row_number() OVER (PARTITION BY field_name, proposed_value ORDER BY extracted_at DESC) AS rn
  FROM public.field_evidence
  WHERE vehicle_id = p_vehicle_id AND status::text IN ('accepted', 'pending', 'conflicted')
), obs AS (
  SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) AS j
  FROM (SELECT kind::text AS k, count(*) AS n FROM public.vehicle_observations WHERE vehicle_id = p_vehicle_id GROUP BY 1) q
), tl AS (
  SELECT jsonb_build_object(
    'events', count(*),
    'pending_analysis', count(*) FILTER (WHERE event_type = 'pending_analysis'),
    'pending_analysis_note', 'event_type pending_analysis is a placeholder written at photo upload; it is not a record of work or an event'
  ) AS j
  FROM public.timeline_events WHERE vehicle_id = p_vehicle_id
)
SELECT jsonb_build_object(
  'version', 1,
  'images', (SELECT j FROM img) || jsonb_build_object('by_gate', (SELECT j FROM gate)),
  'photo_evidence', jsonb_build_object(
    'images_with_fields', (SELECT count(DISTINCT image_id) FROM public.photo_extracted_fields WHERE vehicle_id = p_vehicle_id),
    'images_described', (SELECT count(DISTINCT image_id) FROM public.image_descriptions WHERE vehicle_id = p_vehicle_id),
    'fields', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'field', field_name, 'value', value, 'n_images', n_images, 'best_confidence', best_confidence,
        'quote', quote, 'image_id', image_id) ORDER BY field_name, rk)
      FROM pef_ranked WHERE rk <= 3), '[]'::jsonb),
    'text_lines', jsonb_build_object(
      'distinct', (SELECT count(*) FROM ptl),
      'top', coalesce((SELECT jsonb_agg(jsonb_build_object('text', text, 'n_images', n_images,
          'best_confidence', best_confidence, 'image_id', image_id))
        FROM (SELECT * FROM ptl ORDER BY n_images DESC, best_confidence DESC LIMIT 30) t), '[]'::jsonb))
  ),
  'identifiers', coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM ident i), '[]'::jsonb),
  'field_evidence', coalesce((SELECT jsonb_agg(jsonb_build_object('field', field_name, 'value', value,
        'status', status, 'source_type', source_type, 'confidence', confidence, 'extracted_at', extracted_at)
        ORDER BY field_name, extracted_at DESC)
      FROM (SELECT * FROM fe WHERE rn = 1 ORDER BY field_name, extracted_at DESC LIMIT 80) f), '[]'::jsonb),
  'observations_by_kind', (SELECT j FROM obs),
  'timeline', (SELECT j FROM tl)
);
$fn$;

GRANT EXECUTE ON FUNCTION public.vehicle_profile_evidence(uuid) TO anon, authenticated, service_role;
COMMIT;
