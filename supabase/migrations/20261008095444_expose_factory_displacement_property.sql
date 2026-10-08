-- Protected factory receipts already retain DisplacementL, but the existing
-- registered numeric/liters property has no typed representation in this reader.
-- Project once from the current receipt; never mint duplicate testimony or claim
-- the installed engine is known. Preserve the existing reader's owner and ACL.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $repair$
DECLARE f text; h text; body text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.observation_properties
  WHERE property_key='engine_displacement_l' AND namespace='core' AND deprecated_at IS NULL
  AND data_type='numeric' AND unit='liters' AND verification_scope='class'
  AND cardinality='single' AND applies_to_kinds=ARRAY['specification']::public.observation_kind[]) THEN
  RAISE EXCEPTION 'Factory displacement property contract changed';
 END IF;
 f:=pg_get_functiondef('public.read_vehicle_taxonomy_fold(uuid)'::regprocedure);
 h:=encode(sha256(convert_to(f,'UTF8')),'base64');
 IF h='unTVwnImSjOAmWJqTt2Qf4AJzxfF3Moo99PeyOR0lWQ=' THEN
  IF cardinality(string_to_array(f,'AS $function$'))<>2 THEN RAISE EXCEPTION 'Taxonomy reader body anchor changed';END IF;
  body:=rtrim(split_part(split_part(f,'AS $function$',2),'$function$',1),E';\n ');
  EXECUTE split_part(f,'AS $function$',1)||'AS $function$'||E'\n WITH existing AS MATERIALIZED ('||body||$projection$ AS fold),
 source AS MATERIALIZED (
  SELECT fold,fold#>'{factory_reference,receipt}' AS receipt,
   fold#>>'{factory_reference,receipt,fields,DisplacementL}' AS raw_liters FROM existing
 ), typed AS MATERIALIZED (
  SELECT *,CASE WHEN receipt#>'{fields,DisplacementL}' IS NOT NULL
    AND jsonb_typeof(receipt#>'{fields,DisplacementL}')='string'
    AND length(raw_liters)<=64 AND raw_liters ~ '^[0-9]+(\.[0-9]+)?$'
    THEN raw_liters::numeric END AS liters FROM source
 ), property AS MATERIALIZED (
  SELECT id FROM public.observation_properties
  WHERE property_key='engine_displacement_l' AND namespace='core' AND deprecated_at IS NULL
   AND data_type='numeric' AND unit='liters' AND verification_scope='class'
   AND cardinality='single' AND applies_to_kinds=ARRAY['specification']::public.observation_kind[]
 )
 SELECT CASE WHEN NOT fold ? 'factory_reference' THEN fold ELSE
  jsonb_set(fold,'{factory_reference,property_projections}',
   CASE WHEN fold#>'{factory_reference,stale}'='false'::jsonb AND liters>0
    AND receipt->>'role'='factory_reference'
    AND receipt->>'method'='protected_retained_vin_reference_v1'
    AND receipt->'physical_configuration_verified'='false'::jsonb
    AND EXISTS(SELECT 1 FROM property)
   THEN jsonb_build_object('engine_displacement_l',jsonb_build_object(
    'property_id',(SELECT id FROM property),'property_key','engine_displacement_l',
    'value',liters,'data_type','numeric','unit','liters','verification_scope','class',
    'claim_role','factory_reference','physical_configuration_verified',false,
    'source_field','DisplacementL','source_value',raw_liters,
    'source_observation_id',fold#>'{factory_reference,observation_id}',
    'supporting_taxonomy_revision_id',fold#>'{factory_reference,supporting_taxonomy_revision_id}',
    'source_sha256',receipt->'source_sha256','source_recorded_at',receipt->'source_recorded_at',
    'recorded_clock_basis',receipt->'recorded_clock_basis',
    'ingested_at',fold#>'{factory_reference,ingested_at}'))
   ELSE '{}'::jsonb END) END FROM typed;
$function$
$projection$;
 ELSIF h IS DISTINCT FROM 'QTdsYRVEw2OLZRu/9mFg7fmLAAyuFTT8N6Ij5+4rwxw=' THEN
  RAISE EXCEPTION 'Taxonomy reader owner changed';
 END IF;
END $repair$;
COMMENT ON FUNCTION public.read_vehicle_taxonomy_fold(uuid) IS 'Cached taxonomy and protected current VIN factory-reference reader. Adds property_projections.engine_displacement_l as a numeric liters/class projection of exact supported DisplacementL, with original source observation, taxonomy revision, SHA256, decode-recording clock and ingestion clock. Empty property_projections means unsupported, stale or changed registry. Manufacturer reference is not verified installed/physical configuration. Does not ingest, advance queues, mint testimony, convert other units or alter reader access.';
NOTIFY pgrst,'reload schema';
COMMIT;
