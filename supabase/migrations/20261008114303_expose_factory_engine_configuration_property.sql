-- Existing protected factory receipts carry EngineConfiguration strings. Reuse
-- the registered string/class property without inference, new testimony or work.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $repair$
DECLARE f text;h text;body text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.observation_properties WHERE namespace='core'
  AND property_key='engine_configuration' AND deprecated_at IS NULL
  AND data_type='string' AND unit IS NULL AND verification_scope='class'
  AND cardinality='single' AND applies_to_kinds=ARRAY['specification']::public.observation_kind[]) THEN
  RAISE EXCEPTION 'Factory configuration property contract changed';
 END IF;
 f:=pg_get_functiondef('public.read_vehicle_taxonomy_fold(uuid)'::regprocedure);
 h:=encode(sha256(convert_to(f,'UTF8')),'base64');
 IF h='QTdsYRVEw2OLZRu/9mFg7fmLAAyuFTT8N6Ij5+4rwxw=' THEN
  IF cardinality(string_to_array(f,'AS $function$'))<>2 THEN RAISE EXCEPTION 'Factory reader body anchor changed';END IF;
  body:=rtrim(split_part(split_part(f,'AS $function$',2),'$function$',1),E';\n ');
  EXECUTE split_part(f,'AS $function$',1)||'AS $function$'||E'\n WITH existing(fold) AS MATERIALIZED ('||body||$projection$
 ), source AS MATERIALIZED (
  SELECT fold,fold#>'{factory_reference,receipt}' receipt,
   fold#>>'{factory_reference,receipt,fields,EngineConfiguration}' raw_configuration FROM existing
 ), property AS MATERIALIZED (
  SELECT id FROM public.observation_properties WHERE namespace='core'
   AND property_key='engine_configuration' AND deprecated_at IS NULL
   AND data_type='string' AND unit IS NULL AND verification_scope='class'
   AND cardinality='single' AND applies_to_kinds=ARRAY['specification']::public.observation_kind[]
 )
 SELECT CASE WHEN NOT fold ? 'factory_reference' THEN fold ELSE
  jsonb_set(fold,'{factory_reference,property_projections}',
   coalesce(fold#>'{factory_reference,property_projections}','{}'::jsonb) ||
   CASE WHEN fold#>'{factory_reference,stale}'='false'::jsonb
    AND receipt->>'role'='factory_reference' AND receipt->>'method'='protected_retained_vin_reference_v1'
    AND receipt->'physical_configuration_verified'='false'::jsonb
    AND jsonb_typeof(receipt#>'{fields,EngineConfiguration}')='string'
    AND length(raw_configuration)<=500 AND btrim(raw_configuration)<>''
    AND raw_configuration !~* '^(N/?A|Not Applicable|Not Available|Not Reported|Unknown|0( - Not Applicable)?)$'
    AND EXISTS(SELECT 1 FROM property)
   THEN jsonb_build_object('engine_configuration',jsonb_build_object(
    'property_id',(SELECT id FROM property),'property_key','engine_configuration',
    'value',raw_configuration,'data_type','string','unit',NULL,'verification_scope','class',
    'claim_role','factory_reference','physical_configuration_verified',false,
    'source_field','EngineConfiguration','source_value',raw_configuration,
    'source_observation_id',fold#>'{factory_reference,observation_id}',
    'supporting_taxonomy_revision_id',fold#>'{factory_reference,supporting_taxonomy_revision_id}',
    'source_sha256',receipt->'source_sha256','source_recorded_at',receipt->'source_recorded_at',
    'recorded_clock_basis',receipt->'recorded_clock_basis','ingested_at',fold#>'{factory_reference,ingested_at}'))
   ELSE '{}'::jsonb END) END FROM source;
$function$
$projection$;
 ELSIF h IS DISTINCT FROM 'DekNDK3cCmxbtlUiuczuXXk7KIX/Rvpsi99/jihtJI0=' THEN RAISE EXCEPTION 'Factory reader owner changed';
 END IF;
END $repair$;
COMMENT ON FUNCTION public.read_vehicle_taxonomy_fold(uuid) IS 'Existing cached taxonomy/current protected VIN factory-reference reader. property_projections exposes registered numeric liters engine_displacement_l and exact EngineConfiguration string engine_configuration, each class/factory-only with original observation, taxonomy revision, source SHA256, decode-recording and ingestion clocks. Missing/stale/withdrawn/unsupported fields or registry drift suppress that property independently. No inferred I6/V8, cylinder-count property, physical verification, new testimony/work/provider calls or reader-access changes.';
NOTIFY pgrst,'reload schema';
COMMIT;
