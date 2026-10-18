-- WHY: 2026-10-10 indexed 30-listing discovery: engine_size 30/30,
-- transmission 29/30, drivetrain 3/30 survive only as envelope fields.
-- Admit four ALREADY ratified keys via ingest-observation; no new fact log,
-- new vocabulary, replay reset, worker schedule, provider call or testimony rewrite.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='1s';
DO $contracts$
BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64') <> 'SWMULpmuOum3+TVBNd+ZsReIk9lCqTFx/Vsa1IoqSOQ='
 OR encode(sha256(convert_to(pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure),'UTF8')),'base64') <> 'KVMZ7kWcjEQ2IXm9DBmwTZsrR/t6AaykSlkaN/qTqSM='
 OR encode(sha256(convert_to(pg_get_viewdef('public.vehicle_canonical'::regclass,true),'UTF8')),'base64') <> 'j7RT5593QCzYbptrkVZQOC4eSzyG63pIm9BEn6KW0eg=' THEN
 RAISE EXCEPTION 'Retained admission/reader owner drift; review current contract'; END IF;
 IF (SELECT count(*) FROM public.observation_properties WHERE namespace='core' AND deprecated_at IS NULL
 AND 'specification'=ANY(applies_to_kinds) AND
 ((id='c0f743ae-dc94-4dfd-98ef-514b76f74a9b' AND property_key='engine_configuration') OR
 (id='66b2f1f6-b714-4ac0-85b6-60ba89529c1a' AND property_key='engine_displacement_l') OR
 (id='235aed17-9bd3-4886-90be-9b1a8e2d1844' AND property_key='transmission_type') OR
 (id='32b51f19-e5cf-4f67-81d9-96c2d30885a1' AND property_key='drivetrain_layout')))<>4 THEN
 RAISE EXCEPTION 'Existing ratified powertrain keys unavailable'; END IF;
END $contracts$;

CREATE FUNCTION public.retained_powertrain_value(p_key text,p_raw jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE t text; m text[]; v text; vals text[]:=ARRAY[]::text[]; n numeric; unit text;
BEGIN
 IF jsonb_typeof(p_raw) IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
 t:=btrim(p_raw#>>'{}');
 IF t='' OR length(t)>500 OR t ~* '\m(unknown|unspecified|not|no|without|or)\M' THEN RETURN NULL; END IF;
 IF p_key='drivetrain_layout' THEN
  RETURN CASE WHEN t ~* '^(FWD|RWD|AWD|4WD)$' THEN to_jsonb(upper(t)) END;
 ELSIF p_key='transmission_type' THEN
  FOR m IN SELECT regexp_matches(lower(t),'\m(manual|automatic|cvt|semi)\M','g') LOOP
   IF NOT m[1]=ANY(vals) THEN vals:=array_append(vals,m[1]); END IF;
  END LOOP;
 ELSIF p_key='engine_configuration' THEN
  FOR m IN SELECT regexp_matches(lower(t),'\m(v|i|inline|flat)[-\s]?(2|3|4|5|6|8|10|12|16|two|three|four|five|six|eight|ten|twelve|sixteen)\M','g') LOOP
   v:=(CASE m[1] WHEN 'flat' THEN 'flat-' WHEN 'v' THEN 'V' ELSE 'I' END)||
    (CASE m[2] WHEN 'two' THEN '2' WHEN 'three' THEN '3' WHEN 'four' THEN '4' WHEN 'five' THEN '5'
     WHEN 'six' THEN '6' WHEN 'eight' THEN '8' WHEN 'ten' THEN '10' WHEN 'twelve' THEN '12' WHEN 'sixteen' THEN '16' ELSE m[2] END);
   IF NOT v=ANY(vals) THEN vals:=array_append(vals,v); END IF;
  END LOOP;
 ELSIF p_key='engine_displacement_l' THEN
  FOR m IN SELECT regexp_matches(lower(t),'(?<![-+.,\d])\m(\d+(?:,\d{3})*(?:\.\d+)?)\s*-?\s*(liter|litre|l|cc|ci)\M','g') LOOP
   vals:=array_append(vals,m[1]); unit:=m[2];
  END LOOP;
  IF cardinality(vals)<>1 THEN RETURN NULL; END IF;
  n:=replace(vals[1],',','')::numeric * CASE unit WHEN 'cc' THEN .001 WHEN 'ci' THEN .016387064 ELSE 1 END;
  RETURN CASE WHEN n>0 AND n<=30 THEN to_jsonb(round(n,6)) END;
 ELSE RETURN NULL;
 END IF;
 RETURN CASE WHEN cardinality(vals)=1 THEN to_jsonb(vals[1]) END;
END $fn$;
COMMENT ON FUNCTION public.retained_powertrain_value(text,jsonb) IS
'One explicit retained engine_size/transmission/drivetrain claim to an existing core key. Ambiguous/negated text omitted; liters, cc/1000, ci*0.016387064 rounded six decimals. Deterministic lexical normalization only, not factory/current verification. ingest-observation is the admission owner.';
REVOKE ALL ON FUNCTION public.retained_powertrain_value(text,jsonb) FROM PUBLIC;
-- Pure normalizer is needed by the two existing reader gates; it exposes no rows.
GRANT EXECUTE ON FUNCTION public.retained_powertrain_value(text,jsonb) TO anon,authenticated,service_role;

DO $admission$
DECLARE d text:=pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure);
BEGIN
 d:=replace(d,$old$  ELSE
    RAISE EXCEPTION 'unsupported retained property'$old$,$new$  ELSIF v_property_key IN ('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout') THEN
    source_field:=CASE v_property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END;
    projection_mode:='retained_listing_'||v_property_key||'_v1';
  ELSE
    RAISE EXCEPTION 'unsupported retained property'$new$);
 d:=replace(d,$old$NEW.structured_data->v_property_key IS DISTINCT FROM p.structured_data->source_field$old$,
 $new$NEW.structured_data->v_property_key IS DISTINCT FROM
      (CASE WHEN v_property_key IN ('interior_color','exterior_color') THEN p.structured_data->source_field
       ELSE public.retained_powertrain_value(v_property_key,p.structured_data->source_field) END)
    OR (v_property_key IN ('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout') AND
      (public.retained_powertrain_value(v_property_key,p.structured_data->source_field) IS NULL
       OR NEW.structured_data->'source_value' IS DISTINCT FROM p.structured_data->source_field
       OR NEW.structured_data->>'normalization_version' IS DISTINCT FROM 'retained_powertrain_v1'
       OR NEW.structured_data->>'factory_configuration_status' IS DISTINCT FROM 'unknown'
       OR NEW.structured_data->>'current_configuration_status' IS DISTINCT FROM 'unknown'
       OR NEW.structured_data->'independent_source' IS DISTINCT FROM 'false'::jsonb))$new$);
 IF d NOT LIKE '%ELSIF v_property_key IN (%' OR d NOT LIKE '%public.retained_powertrain_value(%' THEN RAISE EXCEPTION 'Admission anchors changed'; END IF;
 EXECUTE d;
END $admission$;

DO $readers$
DECLARE d text; v text; old_key text:=$k$rk.property_key IN ('interior_color','exterior_color')$k$;
 new_key text:=$k$rk.property_key IN ('interior_color','exterior_color','engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout')$k$;
 old_value text:=$v$o.structured_data->rk.property_key=rp.structured_data->(CASE rk.property_key WHEN 'exterior_color' THEN 'color' ELSE 'interior_color' END)$v$;
 new_value text:=$v$o.structured_data->rk.property_key=CASE WHEN rk.property_key IN ('interior_color','exterior_color') THEN rp.structured_data->(CASE rk.property_key WHEN 'exterior_color' THEN 'color' ELSE 'interior_color' END)
 ELSE public.retained_powertrain_value(rk.property_key,rp.structured_data->(CASE rk.property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)) END
 AND (rk.property_key IN ('interior_color','exterior_color') OR
  (o.structured_data->'source_value'=rp.structured_data->(CASE rk.property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)
   AND o.structured_data->>'normalization_version'='retained_powertrain_v1'))$v$;
BEGIN
 d:=pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure);
 v:=pg_get_viewdef('public.vehicle_canonical'::regclass,true);
 IF cardinality(string_to_array(d,old_key))<>2 OR cardinality(string_to_array(d,old_value))<>2 THEN RAISE EXCEPTION 'Reader anchors changed'; END IF;
 d:=replace(replace(d,old_key,new_key),old_value,new_value);
 IF cardinality(string_to_array(d,$a$'id',o.id,'content',left(o.content_text,400),$a$))<>2 THEN RAISE EXCEPTION 'Provenance output anchor changed'; END IF;
 d:=replace(d,$a$'id',o.id,'content',left(o.content_text,400),$a$,
 $b$'id',o.id,'content',left(o.content_text,400),
            'source_field',o.structured_data->>'source_field',
            'source_value',o.structured_data->'source_value',
            'normalization_version',o.structured_data->>'normalization_version',
            'claim_role',o.structured_data->>'claim_role',
            'independent_source',o.structured_data->'independent_source',
            'factory_configuration_status',o.structured_data->>'factory_configuration_status',
            'current_configuration_status',o.structured_data->>'current_configuration_status',$b$);
 -- pg_get_viewdef canonicalizes IN to ANY; use its exact installed anchors.
 old_key:=$k$rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text])$k$;
 new_key:=$k$rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text, 'engine_configuration'::text, 'engine_displacement_l'::text, 'transmission_type'::text, 'drivetrain_layout'::text])$k$;
 old_value:=$v$(o.structured_data -> rk.property_key) = (rp.structured_data ->
                        CASE rk.property_key
                            WHEN 'exterior_color'::text THEN 'color'::text
                            ELSE 'interior_color'::text
                        END)$v$;
 IF cardinality(string_to_array(v,old_key))<>2 OR cardinality(string_to_array(v,old_value))<>2 THEN RAISE EXCEPTION 'View anchors changed'; END IF;
 v:=replace(replace(v,old_key,new_key),old_value,new_value);
 EXECUTE d; EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_canonical AS '||v;
END $readers$;
COMMENT ON COLUMN public.vehicle_observations.source_observation_id IS
'One retained listing to one core property projection via ingest-observation: colors plus engine configuration/displacement, transmission type, drivetrain layout. Immutable enforced source FK; original testimony retained. Recording clock is not event time. Normalized powertrain claims preserve source_value and normalization version, ambiguous text omitted; not independent or factory/current verification. Readers vehicle_canonical/get_field_provenance requalify source.';
COMMIT;
