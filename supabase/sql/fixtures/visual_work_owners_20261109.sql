-- Exact existing owner functions; synthetic local fixture only.
CREATE OR REPLACE FUNCTION public.receipt_work_frame_eligible(x vehicle_images)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$;
  SELECT x.taken_at IS NOT NULL
     AND x.vision_gate_status IS NOT DISTINCT FROM 'approved'
     AND x.is_sensitive IS NOT TRUE AND x.is_duplicate IS NOT TRUE AND x.is_superseded IS NOT TRUE
     AND x.is_document IS NOT TRUE
     AND coalesce(x.redaction_level::text, 'none') = 'none'
     AND coalesce(x.ai_scan_metadata #>> '{byok_deep_analysis,scene_type}', '') NOT IN ('product_screenshot', 'cross_reference', 'receipt_document', 'hand_drawn_diagram')
$function$;

CREATE OR REPLACE FUNCTION public.project_observation_image_witness()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '5s'
AS $projection$
DECLARE
  image_reference text;
  image_key uuid;
  image_vehicle uuid;
BEGIN
  -- Exact legacy share-verdict path is not authenticated testimony promotion.
  IF NEW.kind::text = 'comment'
     AND NEW.structured_data->>'kind_detail' = 'professional_review'
     AND EXISTS (SELECT 1 FROM public.observation_sources s
                 WHERE s.id = NEW.source_id AND s.slug = 'shop') THEN
    RETURN NEW;
  END IF;
  image_reference := NEW.structured_data->>'image_id';
  IF image_reference IS NULL OR lower(btrim(image_reference)) = 'unknown' THEN
    RETURN NEW;
  END IF;
  IF image_reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'observation_image_reference_invalid';
  END IF;
  image_key := image_reference::uuid;
  -- FOR SHARE prevents a concurrent non-key vehicle reassignment while this
  -- same-vehicle relation is checked and appended. One image row, fixed cost.
  SELECT i.vehicle_id INTO image_vehicle FROM public.vehicle_images i
    WHERE i.id = image_key FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'observation_image_reference_missing';
  END IF;
  IF NEW.vehicle_id IS NULL OR image_vehicle IS NULL OR NEW.vehicle_id <> image_vehicle THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'observation_image_vehicle_mismatch';
  END IF;
  INSERT INTO public.observation_witnesses (
    observation_id, image_id, witness_role, capture_method, image_timestamp,
    attestation_notes, added_by_user_id, added_by_agent_key
  ) VALUES (
    NEW.id, image_key, 'derived', 'unknown', NULL,
    'Derived from structured_data.image_id by the observation log insert projection; no assertion of visual correctness, independent source, capture method or capture time.',
    NEW.submitted_by_user_id,
    CASE WHEN NEW.submitted_by_user_id IS NULL THEN 'db:project_observation_image_witness:v1' END
  ) ON CONFLICT (observation_id, image_id, witness_role) DO NOTHING;
  RETURN NEW;
END
$projection$;
CREATE TRIGGER image_witness AFTER INSERT ON vehicle_observations FOR EACH ROW WHEN (NEW.structured_data ? 'image_id') EXECUTE FUNCTION project_observation_image_witness();
CREATE OR REPLACE FUNCTION public.public_text(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$;
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN NULL
    WHEN p ~* '(\$\s?[0-9]|invoice|billed|\mpaid\M|payment|\mcard\M|client|customer|@|\m\d{3}[-.\s]\d{3}[-.\s]\d{4}\M)' THEN NULL
    ELSE left(btrim(p), 300)
  END;
$function$;
;

-- Exact deployed build-log owners captured for the guarded reader extension.
CREATE OR REPLACE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid)
 RETURNS TABLE(observation_id uuid, done_on date, item text, category text, supplier text, labor_minutes numeric, build_stage text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT o.id,
         COALESCE(CASE WHEN o.structured_data->>'transaction_date' ~ '^\d{4}-\d{2}-\d{2}'
                       THEN left(o.structured_data->>'transaction_date', 10)::date END,
                  o.observed_at::date),
         public.public_text(COALESCE(o.structured_data->>'item', o.structured_data->>'task',
                                     o.structured_data->>'title', o.structured_data->>'work_performed')),
         public.public_text(o.structured_data->>'category'),
         public.public_text(o.structured_data->>'supplier'),
         CASE WHEN o.structured_data->>'labor_minutes' ~ '^\d+(\.\d+)?$'
              THEN (o.structured_data->>'labor_minutes')::numeric END,
         public.public_text(COALESCE(o.structured_data->>'build_stage', o.structured_data->>'phase'))
  FROM public.vehicle_observations o
  JOIN public.vehicles v ON v.id = o.vehicle_id
  WHERE o.vehicle_id = p_vehicle_id
    AND o.kind = 'work_record'
    AND o.is_superseded IS NOT TRUE
    AND jsonb_typeof(o.structured_data) = 'object'
    AND NOT (o.structured_data ?| ARRAY['receipt_id', 'invoice_number', 'file_url'])
    AND COALESCE(o.structured_data->>'subject', '') <> 'client_invoice'
    AND COALESCE(o.structured_data->>'item', o.structured_data->>'task', o.structured_data->>'title',
                 o.structured_data->>'work_performed', o.structured_data->>'category') IS NOT NULL
    AND v.deleted_at IS NULL
    AND (v.is_public = true
         OR v.user_id = (SELECT auth.uid())
         OR v.owner_id = (SELECT auth.uid())
         OR v.uploaded_by = (SELECT auth.uid()))
  ORDER BY 2 DESC NULLS LAST, 1;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid, p_include_reported boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
  'work_records',(SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) FROM public.vehicle_build_log_public(p_vehicle_id) w),
  'reported_work',CASE WHEN p_include_reported IS TRUE THEN (
   SELECT coalesce(jsonb_agg(jsonb_build_object(
    'observation_id',c.id,'kind',c.kind,'report_status',c.structured_data->>'report_status',
    'occurrence_status',c.structured_data->>'occurrence_status','performer_id',c.structured_data->'performer_id','performer_status',c.structured_data->>'performer_status',
    'independent_source',c.structured_data->'independent_source','intent_status',c.structured_data->>'intent_status',
    'observed_at_basis',c.structured_data->>'observed_at_basis',
    'reported_date',c.structured_data->>'reported_date','reported_date_label',c.structured_data->>'reported_date_label','date_precision',c.structured_data->>'date_precision',
    'performed_clause',c.structured_data->>'performed_clause','source_value',c.structured_data->>'source_value',
    'source_observation_id',c.source_observation_id,'source_id',c.source_id,'source_url',c.source_url,
    'source_captured_at',c.structured_data->>'source_captured_at','source_recorded_at',c.parent_ingested_at,
    'source_capture_sha256',c.structured_data->>'source_capture_sha256','source_capture_basis',c.structured_data->>'source_capture_basis',
    'source_witness_version',c.structured_data->>'source_witness_version','observed_at',c.observed_at,'ingested_at',c.ingested_at,
    'confidence_score',c.confidence_score) ORDER BY c.structured_data->>'reported_date' DESC,c.id),'[]'::jsonb)
   FROM (SELECT DISTINCT ON (c.source_id,c.source_url,c.structured_data->>'source_value') c.*,p.ingested_at AS parent_ingested_at
    FROM public.vehicle_observations c JOIN public.vehicle_observations p ON p.id=c.source_observation_id
    WHERE c.vehicle_id=p_vehicle_id AND c.kind='activity' AND c.extraction_method='retained_listing_reported_work_v1'
     AND c.is_superseded IS FALSE AND public.retained_reported_work_matches(p,c)
     AND public.public_text(c.structured_data->>'source_value')=c.structured_data->>'source_value'
     AND public.public_text(c.structured_data->>'performed_clause')=c.structured_data->>'performed_clause'
    -- Repeated captures of one listing sentence are one report: the earliest admitted.
    ORDER BY c.source_id,c.source_url,c.structured_data->>'source_value',c.ingested_at,c.id) c
  ) ELSE '[]'::jsonb END);
$function$;
