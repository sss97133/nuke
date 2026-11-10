-- Current-source view of visual work in the existing observation/build-log owner.
-- Intake remains ingest-observation (internal-inference, defer_analysis, agent_inferred).
-- No rows, canonical properties, installations, payments or owner decisions are written.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';

CREATE OR REPLACE FUNCTION public.visual_work_build_log(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 o record; ref jsonb; image_row record; receipt_row record; baseline record;
 images jsonb; receipts jsonb; effort jsonb; gaps jsonb; result jsonb:='[]';
 qualified boolean; tied boolean; seen integer:=0; missing_receipts integer;
 uuid_pattern constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
 SELECT auth.role()='service_role' OR (auth.uid() IS NOT NULL AND
   (v.user_id=auth.uid() OR v.owner_id=auth.uid() OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid())))
 INTO tied FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.deleted_at IS NULL AND
   (v.is_public IS TRUE OR auth.role()='service_role' OR v.user_id=auth.uid() OR v.owner_id=auth.uid()
    OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid()));
 IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
 tied:=coalesce(tied,false);
 FOR o IN SELECT v.* FROM public.vehicle_observations v JOIN public.observation_sources s ON s.id=v.source_id
   WHERE v.vehicle_id=p_vehicle_id AND v.kind='work_record' AND v.is_superseded IS FALSE
    AND s.slug='internal-inference' AND v.extraction_method='visual_work_v1'
    AND v.confidence_score BETWEEN 0 AND .6 AND v.structured_data->>'contract'='visual_work_v1'
   ORDER BY v.observed_at DESC,v.id LIMIT 101 LOOP
  seen:=seen+1; IF seen>100 THEN EXIT; END IF;
  -- A typed review only. All required physical sources must still be current; losing
  -- one withholds the conclusion instead of recycling a surviving after photograph.
  IF jsonb_typeof(o.structured_data->'visual_sources') IS DISTINCT FROM 'array'
    OR jsonb_typeof(o.structured_data->'receipt_links') IS DISTINCT FROM 'array'
    OR jsonb_typeof(o.structured_data->'gaps') IS DISTINCT FROM 'array' THEN CONTINUE; END IF;
  IF jsonb_array_length(o.structured_data->'visual_sources') NOT BETWEEN 1 AND 12
    OR jsonb_array_length(o.structured_data->'receipt_links')>20 OR jsonb_array_length(o.structured_data->'gaps')>8
    OR public.public_text(o.structured_data->>'title') IS NULL
    OR public.public_text(o.structured_data->>'summary') IS NULL
    OR coalesce(o.structured_data->>'image_id','') !~ uuid_pattern THEN CONTINUE; END IF;
  images:='[]'; qualified:=true;
  FOR ref IN SELECT value FROM jsonb_array_elements(o.structured_data->'visual_sources') LOOP
   IF coalesce(ref->>'image_id','') !~ uuid_pattern OR coalesce(ref->>'role','') NOT IN ('before','during','after')
     OR public.public_text(ref->>'caption') IS NULL OR coalesce(ref->>'source_url','') !~ '^https?://' THEN
    qualified:=false; EXIT;
   END IF;
   SELECT i.id,i.image_url,i.taken_at,
    CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=i.exif_data->>'capture_time_zone')
      THEN i.exif_data->>'capture_time_zone' END AS capture_time_zone,
    public.public_text(i.exif_data->>'capture_time_basis') AS capture_time_basis
   INTO image_row FROM public.vehicle_images i
    WHERE i.id=(ref->>'image_id')::uuid AND i.vehicle_id=p_vehicle_id
     AND i.image_url=ref->>'source_url' AND public.receipt_work_frame_eligible(i) AND isfinite(i.taken_at)
     AND coalesce(i.image_vehicle_match_status,'') NOT IN ('mismatch','unrelated');
   IF NOT FOUND OR EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'image_id'=image_row.id::text) THEN
    qualified:=false; EXIT;
   END IF;
   images:=images||jsonb_build_array(jsonb_build_object('image_id',image_row.id,'image_url',image_row.image_url,
    'taken_at',image_row.taken_at,'capture_time_zone',image_row.capture_time_zone,'capture_time_basis',image_row.capture_time_basis,
    'role',ref->>'role','caption',public.public_text(ref->>'caption')));
  END LOOP;
  IF NOT qualified OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(images) x
    JOIN public.observation_witnesses w ON w.observation_id=o.id AND w.image_id::text=x->>'image_id'
    WHERE (x->>'image_id')::uuid=(o.structured_data->>'image_id')::uuid AND x->>'image_url'=o.source_url AND w.witness_role='derived') THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(images) b CROSS JOIN jsonb_array_elements(images) a
    WHERE b->>'role'='before' AND a->>'role'='after' AND (b->>'taken_at')::timestamptz>(a->>'taken_at')::timestamptz) THEN CONTINUE; END IF;
  receipts:='[]'; missing_receipts:=0;
  FOR ref IN SELECT value FROM jsonb_array_elements(o.structured_data->'receipt_links') LOOP
   IF coalesce(ref->>'receipt_id','') !~ uuid_pattern OR coalesce(ref->>'item_id','') !~ uuid_pattern
    OR coalesce(ref->>'link_id','') !~ uuid_pattern OR coalesce(ref->>'source_id','') !~ uuid_pattern
    OR coalesce(ref->>'relation','') NOT IN ('candidate_material','documented_operation') THEN
     missing_receipts:=missing_receipts+1; CONTINUE;
   END IF;
   -- Exact line/link/document, not a SKU or time-window join. Original source URL
   -- stays internal; original page access uses the existing viewer and its policy.
   SELECT i.id AS item_id,r.id AS receipt_id,r.source_document_table,r.source_document_id,r.vendor_name,l.page_date,
    i.description,i.part_number,i.quantity,i.hours,i.total_price,r.currency INTO receipt_row
   FROM public.receipt_items i JOIN public.receipts r ON r.id=i.receipt_id
    JOIN public.receipt_vehicle_links l ON l.id=(ref->>'link_id')::uuid AND l.receipt_id=r.id
   WHERE i.id=(ref->>'item_id')::uuid AND r.id=(ref->>'receipt_id')::uuid
    AND i.description IS NOT DISTINCT FROM ref->>'description' AND i.part_number IS NOT DISTINCT FROM ref->>'part_number'
    AND l.vehicle_id=p_vehicle_id AND l.status='linked' AND l.retired_at IS NULL
    AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
    AND r.source_document_table=ref->>'source_table' AND r.source_document_id=(ref->>'source_id')::uuid
    AND ((r.source_document_table='vehicle_documents' AND EXISTS(SELECT 1 FROM public.vehicle_documents d
       WHERE d.id=r.source_document_id AND d.vehicle_id=p_vehicle_id AND d.file_url=ref->>'source_url'))
     OR (r.source_document_table='vehicle_images' AND EXISTS(SELECT 1 FROM public.vehicle_images i2
       WHERE i2.id=r.source_document_id AND i2.vehicle_id=p_vehicle_id AND i2.image_url=ref->>'source_url'
        AND i2.is_superseded IS NOT TRUE AND i2.is_sensitive IS NOT TRUE AND i2.vision_gate_status='approved')));
   IF NOT FOUND THEN missing_receipts:=missing_receipts+1; CONTINUE; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(receipts) x WHERE x->>'item_id'=receipt_row.item_id::text) THEN CONTINUE; END IF;
   receipts:=receipts||jsonb_build_array(jsonb_build_object('item_id',receipt_row.item_id,'receipt_id',receipt_row.receipt_id,
    'relation',ref->>'relation','source_table',receipt_row.source_document_table,'source_id',receipt_row.source_document_id,
    'source_url_sha256',encode(sha256(convert_to(ref->>'source_url','UTF8')),'hex'),
    'vendor',public.public_text(receipt_row.vendor_name),'page_date',receipt_row.page_date,
    'description',public.public_text(receipt_row.description),'part_number',public.public_text(receipt_row.part_number),
    'quantity',receipt_row.quantity,'hours',CASE WHEN ref->>'relation'='documented_operation' THEN receipt_row.hours END,
    'amount',CASE WHEN tied THEN receipt_row.total_price END,'currency',receipt_row.currency,'amounts_visible',tied));
  END LOOP;
  effort:=NULL;
  IF coalesce(o.structured_data#>>'{effort_reference,reference_id}','') ~ uuid_pattern
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'role'='before')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(images) x WHERE x->>'role'='after') THEN
   SELECT m.* INTO baseline FROM public.stage_transition_labor_map m
    WHERE m.id=(o.structured_data#>>'{effort_reference,reference_id}')::uuid
     AND m.from_stage=o.structured_data#>>'{effort_reference,from_stage}'
     AND m.to_stage=o.structured_data#>>'{effort_reference,to_stage}'
     AND m.zone_pattern=o.structured_data#>>'{effort_reference,zone_pattern}'
     AND m.estimated_hours_min>=0 AND m.estimated_hours_max>=m.estimated_hours_min
     AND m.estimated_hours_typical BETWEEN m.estimated_hours_min AND m.estimated_hours_max
     AND m.estimated_hours_max<'Infinity'::real;
   IF FOUND THEN effort:=jsonb_build_object('reference_id',baseline.id,'description',public.public_text(baseline.description),
    'hours_min',baseline.estimated_hours_min,'hours_max',baseline.estimated_hours_max,
    'hours_typical',baseline.estimated_hours_typical,'basis','seed_uncalibrated'); END IF;
  END IF;
  SELECT coalesce(jsonb_agg(public.public_text(value#>>'{}')) FILTER(WHERE public.public_text(value#>>'{}') IS NOT NULL),'[]') INTO gaps
   FROM jsonb_array_elements(o.structured_data->'gaps');
  result:=result||jsonb_build_array(jsonb_build_object('observation_id',o.id,'title',public.public_text(o.structured_data->>'title'),
   'summary',public.public_text(o.structured_data->>'summary'),'images',images,'receipts',receipts,
   'receipt_links_unavailable',missing_receipts,'gaps',gaps,'effort_reference',effort,
   'market_value',jsonb_build_object('status','not_established_by_cited_sources'),
   'paid_labor',jsonb_build_object('status','unreconciled')));
 END LOOP;
 IF result='[]'::jsonb AND seen<=100 THEN RETURN '{}'::jsonb; END IF;
 RETURN jsonb_build_object('visual_work',result,'visual_work_coverage',CASE WHEN seen>100 THEN 'limit_reached' ELSE 'current_reader' END);
END $fn$;
REVOKE ALL ON FUNCTION public.visual_work_build_log(uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.visual_work_build_log(uuid) IS
'Private helper of vehicle_build_log_public: same-vehicle current image sources and derived witness; exact active receipt line/link/document; tied-only amounts. Visual conclusions are inferred, stage references uncalibrated. No installation, payment, performer or measured-time promotion.';
CREATE OR REPLACE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid)
 RETURNS TABLE(observation_id uuid, done_on date, item text, category text, supplier text, labor_minutes numeric, build_stage text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$;
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
    AND COALESCE(o.structured_data->>'contract','') <> 'visual_work_v1'
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
AS $function$;
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
  ) ELSE '[]'::jsonb END) || public.visual_work_build_log(p_vehicle_id);
$function$;

COMMIT;
