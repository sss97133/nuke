-- vehicle_build_log_public(uuid,boolean) always appended visual_work_build_log. The work table
-- page reads only work_records and reported_work, yet received the whole visual work reply
-- (1.47 MB on the one vehicle with visual work). An optional p_include_visual (default true)
-- lets it skip that part; two-argument callers are unchanged. The two-argument signature is
-- replaced, not overloaded, so PostgREST resolves existing calls to this function.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
DO $guard$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.vehicle_build_log_public(uuid,boolean)'::regprocedure)
    IS DISTINCT FROM 'a928ab83ea7217d212441b610647181e' THEN
  RAISE EXCEPTION 'vehicle_build_log_public(uuid,boolean) drifted; inspect current owner';
 END IF;
END $guard$;
DROP FUNCTION public.vehicle_build_log_public(uuid,boolean);
CREATE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid, p_include_reported boolean, p_include_visual boolean DEFAULT true)
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
  ) ELSE '[]'::jsonb END)
  -- A caller that renders only the work table (TablePage) skips the visual work cards and cost ledger.
  || CASE WHEN p_include_visual IS FALSE THEN '{}'::jsonb ELSE public.visual_work_build_log(p_vehicle_id) END;
$function$;
REVOKE ALL ON FUNCTION public.vehicle_build_log_public(uuid,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_build_log_public(uuid,boolean,boolean) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.vehicle_build_log_public(uuid,boolean,boolean) IS
'Public build log: work_records, reported_work when p_include_reported, and the visual work cards and cost ledger unless p_include_visual is false.';
NOTIFY pgrst,'reload schema';
COMMIT;
