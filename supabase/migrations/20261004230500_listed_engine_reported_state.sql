-- Restore the existing BaT engine_size testimony to current reported state.
-- This phrase is distinct from engine_type/architecture and displacement.
-- Only this key gains sale_result/specification eligibility; no replay/intake,
-- canonical vehicle write, sale-time qualification or access expansion.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- Exact check-time source/catalog contract. Normal schema CI is serialized;
-- no catalog lock is taken and unrelated external DDL between this check and
-- replacement is outside that serialization contract. No held reader is used.
CREATE TEMP TABLE listed_engine_previous_functions ON COMMIT DROP AS
SELECT oid,proowner,proacl,proconfig,prosecdef,provolatile,proparallel,proisstrict,
  prorettype,proretset,prolang,pronargs,pronargdefaults,proargtypes,proargnames
FROM pg_catalog.pg_proc WHERE oid IN
  ('public.detect_field_conflicts(uuid)'::regprocedure,'public.get_vehicle_specs(uuid)'::regprocedure);
DO $guard$
DECLARE contract record; p record;
BEGIN
  FOR contract IN SELECT * FROM (VALUES
    ('public.detect_field_conflicts(uuid)','fz03oLHaWLAobp5fXC8fLV2sCwfDT/NXA+LgGRFYfdQ=','op8QuKOqPH4v/8g2R4rIw9fFLSdcBbk0fJze+H3XLsw=','plpgsql','integer','v',false,ARRAY[current_user,'service_role']::text[]),
    ('public.get_vehicle_specs(uuid)','ndJT6FDh0AcodvrgFVEGjXOM1GIfd2b2PidVcnsChi0=','O0Y8wU9CZxcw5dBQEsU7FXgfMTgU6FLjlOFt+64apkU=','sql','jsonb','s',true,ARRAY[current_user,'anon','authenticated','service_role']::text[])
  ) expected(signature,old_sha,new_sha,language,return_type,volatility,definer,exec_roles)
  LOOP
    SELECT f.*,l.lanname INTO p FROM pg_catalog.pg_proc f
    JOIN pg_catalog.pg_language l ON l.oid=f.prolang
    WHERE f.oid=contract.signature::regprocedure;
    IF NOT FOUND OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'base64')
      NOT IN (contract.old_sha,contract.new_sha)
      OR p.proowner <> current_user::regrole
      OR p.lanname IS DISTINCT FROM contract.language
      OR p.prorettype <> contract.return_type::regtype
      OR p.provolatile::text IS DISTINCT FROM contract.volatility
      OR p.prosecdef IS DISTINCT FROM contract.definer
      OR p.proparallel <> 'u' OR p.proisstrict OR p.proretset
      OR p.pronargs <> 1 OR p.pronargdefaults <> 0 OR p.proargtypes[0] <> 'uuid'::regtype
      OR p.proargnames IS DISTINCT FROM ARRAY['p_vehicle_id']::text[]
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR p.proacl IS NULL
      OR (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl)) <> cardinality(contract.exec_roles)
      OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
        LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
        WHERE r.rolname IS NULL OR r.rolname <> ALL(contract.exec_roles)
          OR a.privilege_type <> 'EXECUTE' OR a.is_grantable OR a.grantor <> p.proowner)
    THEN RAISE EXCEPTION 'Listed-engine source/catalog contract changed for %; refusing replacement',contract.signature
      USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.detect_field_conflicts(p_vehicle_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_as_of timestamptz := statement_timestamp();
  -- Mechanical grammar is a disclosure guard, never an architecture decoder.
  v_engine_grammar text := $engine$^((replacement|rebuilt|refurbished|modified|supercharged|turbocharged|turbo|fuel[ -]injected|carbureted|numbers[ -]matching|matching[ -]numbers|dohc|sohc|ohv|ohc|flathead|big[ -]block|small[ -]block|hi[ -]po|high[ -]performance|a[ -]code)[ -]+)*([0-9]{1,4}([.][0-9]{1,3})?[ -]?(ci|cc|l|liters?|litres?|cubic[ -](inch|inches))([ -]+(hi[ -]po|high[ -]performance|coyote))?([ -]+(v[ -]?(2|4|6|8|10|12|16)|inline[ -]?(3|4|5|6|three|four|five|six)|flat[ -]?(2|4|6|two|four|six)|straight[ -]?(4|6|8|four|six|eight)|single[ -]cylinder|twin[ -]cylinder|v[ -]twin))?|(v[ -]?(2|4|6|8|10|12|16)|inline[ -]?(3|4|5|6|three|four|five|six)|flat[ -]?(2|4|6|two|four|six)|straight[ -]?(4|6|8|four|six|eight)|single[ -]cylinder|twin[ -]cylinder|v[ -]twin))([ -]+engine)?$$engine$;
  v_record record;
  v_conflicts integer := 0;
  v_seen_fields text[] := '{}';
  v_changing_fields text[] := ARRAY['mileage','reported_mileage','color','exterior_color',
    'interior_color','engine','engine_type','engine_size','fuel_type','transmission','drivetrain',
    'title_status','title_text','condition_rating','condition_class','body_style',
    'asking_price','currency','location_token','listing_status'];
  v_fields text[] := ARRAY['year','make','model','vin','mileage','reported_mileage',
    'color','exterior_color','interior_color','engine','engine_type','engine_size','fuel_type',
    'transmission','drivetrain','title_status','title_text','condition_rating',
    'condition_class','body_style','asking_price','currency','location_token','listing_status'];
BEGIN
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'detect_field_conflicts requires one vehicle' USING ERRCODE = '22023';
  END IF;
  -- Serialize a direct replay with this vehicle's scheduled replay. The metric
  -- drain already holds this parent lock; repeat acquisition is harmless.
  PERFORM 1 FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_record IN
    WITH reports AS MATERIALIZED (
      SELECT o.id, o.source_id, o.confidence_score, o.observed_at, o.ingested_at,
             s.slug, kv.key AS field_name, kv.value #>> '{}' AS field_value
      FROM public.vehicle_observations o
      LEFT JOIN public.observation_sources s ON s.id = o.source_id
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(o.structured_data) = 'object'
        THEN o.structured_data ELSE '{}'::jsonb END) kv
      WHERE o.vehicle_id = p_vehicle_id
        AND (o.kind = 'listing' OR (kv.key = 'engine_size'
          AND o.kind IN ('sale_result','specification')))
        AND o.subject_type = 'vehicle' AND o.is_superseded IS NOT TRUE
        AND public.observation_is_public(o.kind, o.structured_data)
        AND o.structured_data ?| v_fields AND kv.key = ANY(v_fields)
        AND jsonb_typeof(kv.value) IN ('string','number','boolean')
        AND nullif(btrim(kv.value #>> '{}'), '') IS NOT NULL
        AND (kv.key <> 'engine_size' OR (jsonb_typeof(kv.value) = 'string'
          AND length(btrim(kv.value #>> '{}')) BETWEEN 1 AND 120
          AND btrim(kv.value #>> '{}') ~* v_engine_grammar
          AND s.id IS NOT NULL AND o.source_url ~ '^https?://[^[:space:]]+$'))
        AND o.observed_at <= v_as_of AND o.ingested_at <= v_as_of
    ), ranked AS (
      SELECT r.*, row_number() OVER (PARTITION BY field_name
        ORDER BY CASE WHEN field_name = ANY(v_changing_fields) THEN observed_at END DESC NULLS LAST,
                 confidence_score DESC NULLS LAST, observed_at DESC,
                 ingested_at DESC, id) AS position
      FROM reports r
    )
    SELECT best.field_name, best.id, best.field_value, best.confidence_score,
      count(*) FILTER (WHERE r.field_value = best.field_value)::integer AS supporting,
      count(*) FILTER (WHERE r.field_value <> best.field_value)::integer AS conflicting,
      count(*) FILTER (WHERE r.field_value <> best.field_value
        AND r.observed_at = best.observed_at)::integer AS latest_conflicting,
      jsonb_agg(jsonb_build_object('value',r.field_value,
        'confidence',r.confidence_score,'source',r.slug,
        'observed_at',r.observed_at,'ingested_at',r.ingested_at)
        ORDER BY r.position) AS all_values
    FROM ranked best JOIN ranked r USING (field_name)
    WHERE best.position = 1
    GROUP BY best.field_name, best.id, best.field_value, best.confidence_score,best.observed_at
  LOOP
    v_seen_fields := array_append(v_seen_fields,v_record.field_name);
    INSERT INTO public.vehicle_field_consensus
      (vehicle_id,field_name,consensus_value,consensus_confidence,resolution_method,
       supporting_count,conflicting_count,all_values,source_observation_id,as_of_at)
    VALUES (p_vehicle_id,v_record.field_name,v_record.field_value,v_record.confidence_score,
      CASE WHEN v_record.field_name = ANY(v_changing_fields) AND v_record.latest_conflicting = 0 THEN 'most_recent'
           WHEN v_record.conflicting = 0 THEN 'unanimous' ELSE 'unresolved' END,
      v_record.supporting,v_record.conflicting,v_record.all_values,v_record.id,v_as_of)
    ON CONFLICT (vehicle_id,field_name) DO UPDATE SET
      consensus_value = EXCLUDED.consensus_value,
      consensus_confidence = EXCLUDED.consensus_confidence,
      resolution_method = EXCLUDED.resolution_method,
      supporting_count = EXCLUDED.supporting_count,
      conflicting_count = EXCLUDED.conflicting_count,
      all_values = EXCLUDED.all_values,
      source_observation_id = EXCLUDED.source_observation_id,
      as_of_at = EXCLUDED.as_of_at, updated_at = v_as_of
    WHERE vehicle_field_consensus.resolution_method <> 'manual';
    IF (v_record.field_name = ANY(v_changing_fields) AND v_record.latest_conflicting > 0)
       OR (NOT (v_record.field_name = ANY(v_changing_fields)) AND v_record.conflicting > 0)
    THEN v_conflicts := v_conflicts + 1; END IF;
  END LOOP;

  -- Retire derived state whose last eligible testimony was superseded/relinked.
  -- Original testimony and manual decisions remain untouched.
  DELETE FROM public.vehicle_field_consensus c
  WHERE c.vehicle_id = p_vehicle_id AND c.resolution_method <> 'manual'
    AND c.field_name = ANY(v_fields) AND NOT (c.field_name = ANY(v_seen_fields));
  RETURN v_conflicts;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_vehicle_specs(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH engine_grammar(pattern) AS (VALUES ($engine$^((replacement|rebuilt|refurbished|modified|supercharged|turbocharged|turbo|fuel[ -]injected|carbureted|numbers[ -]matching|matching[ -]numbers|dohc|sohc|ohv|ohc|flathead|big[ -]block|small[ -]block|hi[ -]po|high[ -]performance|a[ -]code)[ -]+)*([0-9]{1,4}([.][0-9]{1,3})?[ -]?(ci|cc|l|liters?|litres?|cubic[ -](inch|inches))([ -]+(hi[ -]po|high[ -]performance|coyote))?([ -]+(v[ -]?(2|4|6|8|10|12|16)|inline[ -]?(3|4|5|6|three|four|five|six)|flat[ -]?(2|4|6|two|four|six)|straight[ -]?(4|6|8|four|six|eight)|single[ -]cylinder|twin[ -]cylinder|v[ -]twin))?|(v[ -]?(2|4|6|8|10|12|16)|inline[ -]?(3|4|5|6|three|four|five|six)|flat[ -]?(2|4|6|two|four|six)|straight[ -]?(4|6|8|four|six|eight)|single[ -]cylinder|twin[ -]cylinder|v[ -]twin))([ -]+engine)?$$engine$)),
  gate AS MATERIALIZED (
    SELECT v.* FROM public.vehicles v WHERE v.id = p_vehicle_id
      AND v.deleted_at IS NULL AND coalesce(v.listing_kind,'') <> 'non_vehicle_item'
      AND (v.is_public = true OR auth.uid() IN (v.user_id,v.owner_id,v.uploaded_by))
  ), fields(ord,label,fld) AS (VALUES
    (1,'VIN','vin'),(2,'Mileage','mileage'),(3,'Transmission','transmission'),
    (4,'Drivetrain','drivetrain'),(5,'Body','body_style'),(6,'Color','color'),
    (7,'Interior','interior_color'),(8,'Engine','engine_type'),(9,'Fuel','fuel_type'),
    (10,'Listed engine claim','engine_size')
  ), reports AS MATERIALIZED (
    SELECT c.*,o.source_id,o.observed_at,o.ingested_at,o.extraction_method,o.source_url,s.slug
    FROM public.vehicle_field_consensus c
    JOIN public.vehicle_observations o ON o.id = c.source_observation_id
    LEFT JOIN public.observation_sources s ON s.id = o.source_id
    CROSS JOIN engine_grammar eg
    WHERE c.vehicle_id = p_vehicle_id AND EXISTS (SELECT 1 FROM gate)
      AND o.vehicle_id = c.vehicle_id AND o.is_superseded IS NOT TRUE
      AND (o.kind = 'listing' OR (c.field_name = 'engine_size'
        AND o.kind IN ('sale_result','specification')))
      AND o.subject_type = 'vehicle'
      AND (c.field_name <> 'engine_size' OR (jsonb_typeof(o.structured_data->'engine_size') = 'string'
        AND length(btrim(c.consensus_value)) BETWEEN 1 AND 120
        AND btrim(c.consensus_value) ~* eg.pattern
        AND s.id IS NOT NULL AND o.source_url ~ '^https?://[^[:space:]]+$'))
      AND o.structured_data->>c.field_name IS NOT DISTINCT FROM c.consensus_value
      AND o.confidence_score IS NOT DISTINCT FROM c.consensus_confidence
      AND public.observation_is_public(o.kind,o.structured_data)
      AND o.observed_at <= c.as_of_at AND o.ingested_at <= c.as_of_at
  )
  , description_captures AS MATERIALIZED (
    -- Five most recent recorded listing prose observations, scoped through the existing
    -- vehicle/time index. This is source history, never a current-value verdict.
    SELECT o.* FROM public.vehicle_observations o
    WHERE o.vehicle_id = p_vehicle_id AND o.kind = 'listing' AND o.subject_type = 'vehicle'
      AND coalesce(o.structured_data->>'subject_type','vehicle') = 'vehicle'
      AND o.is_superseded IS NOT TRUE
      AND EXISTS (SELECT 1 FROM gate g WHERE g.is_public = true)
      AND public.observation_is_public(o.kind,o.structured_data)
      AND greatest(coalesce(length(o.content_text),0),
        CASE WHEN jsonb_typeof(o.structured_data->'description')='string'
          THEN length(o.structured_data->>'description') ELSE 0 END,
        CASE WHEN jsonb_typeof(o.structured_data->'raw_description')='string'
          THEN length(o.structured_data->>'raw_description') ELSE 0 END) >= 100
      AND o.observed_at <= statement_timestamp() AND o.ingested_at <= statement_timestamp()
    ORDER BY o.observed_at DESC,o.ingested_at DESC,o.id DESC LIMIT 5
  ), description_history AS MATERIALIZED (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'source_observation_id',o.id,'source_url',o.source_url,'text',
        CASE WHEN length(p.text) BETWEEN 100 AND 32000 AND o.source_url ~ '^https?://' THEN p.text END,
      'status',CASE WHEN o.source_url IS NULL OR o.source_url !~ '^https?://' THEN 'source_unknown'
        WHEN length(p.text) > 32000 THEN 'oversized'
        WHEN length(p.text) >= 100 THEN 'preserved' ELSE 'prose_unavailable' END,
      'source_text_field',p.field,'preserved_characters',coalesce(length(p.text),0),
      'reader_truncated',false,'source_completeness','unknown',
      'recorded_observed_at',o.observed_at,'ingested_at',o.ingested_at,
      'source_event_at',NULL,'source_event_time_status','unknown',
      'observation_time_basis',CASE WHEN o.structured_data->>'observation_time_basis'='source_capture'
        THEN 'source_capture' ELSE 'recorded_observation' END,
      'source_captured_at',CASE WHEN o.structured_data->>'observation_time_basis'='source_capture'
        AND o.structured_data->>'source_captured_at' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$'
        AND pg_catalog.pg_input_is_valid(o.structured_data->>'source_captured_at','timestamptz')
        THEN CASE WHEN (o.structured_data->>'source_captured_at')::timestamptz=o.observed_at
          THEN o.observed_at END END,
      'extraction_method',o.extraction_method,'confidence',o.confidence_score
    ) ORDER BY o.observed_at DESC,o.ingested_at DESC,o.id DESC),'[]'::jsonb) AS entries
    FROM description_captures o
    LEFT JOIN LATERAL (
      SELECT t.field,t.text FROM (VALUES
        (1,'structured_data.raw_description',CASE WHEN jsonb_typeof(o.structured_data->'raw_description')='string'
          THEN o.structured_data->>'raw_description' END),
        (2,'content_text',o.content_text),
        (3,'structured_data.description',CASE WHEN jsonb_typeof(o.structured_data->'description')='string'
          THEN o.structured_data->>'description' END)
      ) t(ord,field,text) WHERE nullif(btrim(t.text),'') IS NOT NULL
      ORDER BY length(t.text) DESC,t.ord LIMIT 1
    ) p ON true
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM gate) THEN NULL ELSE coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'field',f.fld,'label',f.label,'value',cv.value,
      'inline_source',to_jsonb(g)->>(f.fld||'_source'),
      'reported_value',CASE WHEN cv.value IS NULL
        AND r.resolution_method <> 'unresolved' THEN r.consensus_value END,
      'reported_conflict',r.source_observation_id IS NOT NULL AND coalesce(r.resolution_method = 'unresolved' OR (
        cv.value IS NOT NULL AND
        lower(btrim(to_jsonb(g)->>f.fld)) IS DISTINCT FROM lower(btrim(r.consensus_value))),false),
      'reported_count',coalesce(r.supporting_count+r.conflicting_count,0),
      'reported_source',r.slug,'source_observation_id',r.source_observation_id,
      'reported_observed_at',r.observed_at,'reported_ingested_at',r.ingested_at,
      'reported_confidence',r.consensus_confidence,'reported_method',r.extraction_method,
      'as_of_at',r.as_of_at,
      'rooted',cv.value IS NOT NULL AND coalesce((
        lower(btrim(to_jsonb(g)->>f.fld)) = lower(btrim(r.consensus_value))
        OR EXISTS (SELECT 1 FROM public.vehicle_images i
          WHERE i.vehicle_id = p_vehicle_id
            AND i.id = CASE WHEN to_jsonb(g)->>(f.fld||'_source_image_id')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (to_jsonb(g)->>(f.fld||'_source_image_id'))::uuid END
            AND i.is_sensitive IS NOT TRUE AND i.is_superseded IS NOT TRUE
            AND i.is_duplicate IS NOT TRUE
            AND (i.vision_gate_status IS NULL OR i.vision_gate_status::text = 'approved')
            AND coalesce(i.image_vehicle_match_status,'') NOT IN ('mismatch','unrelated'))
        OR EXISTS (SELECT 1 FROM public.vehicle_field_sources fs
          WHERE fs.vehicle_id = p_vehicle_id AND fs.field_name = f.fld
            AND lower(btrim(fs.field_value)) = lower(btrim(to_jsonb(g)->>f.fld))
            AND coalesce(fs.source_type,'') NOT IN ('computed',''))
        OR EXISTS (SELECT 1 FROM public.field_evidence fe
          WHERE fe.vehicle_id = p_vehicle_id AND fe.field_name = f.fld
            AND lower(btrim(fe.proposed_value)) = lower(btrim(to_jsonb(g)->>f.fld))
            AND fe.status IN ('pending','accepted'))
      ),false),'evidence_count',coalesce(r.supporting_count+r.conflicting_count,0))
      || CASE WHEN f.fld = 'engine_size' THEN jsonb_build_object(
        'field_meaning','listed_engine_phrase_not_parsed_architecture_or_displacement',
        'sale_episode_binding','unestablished','reported_time_basis','stored_observation_clock',
        'listed_engine_context',CASE WHEN r.source_observation_id IS NOT NULL
          THEN 'latest_eligible_claim_by_stored_observation_clock'
          ELSE 'canonical_vehicle_field_without_selected_testimony' END)
        ELSE '{}'::jsonb END ORDER BY f.ord)
    FROM fields f CROSS JOIN gate g CROSS JOIN engine_grammar eg
    CROSS JOIN LATERAL (SELECT CASE WHEN f.fld <> 'engine_size'
      OR (length(btrim(to_jsonb(g)->>f.fld)) BETWEEN 1 AND 120
        AND btrim(to_jsonb(g)->>f.fld) ~* eg.pattern)
      THEN nullif(btrim(to_jsonb(g)->>f.fld),'') END AS value) cv
    LEFT JOIN reports r ON r.field_name = f.fld
    WHERE cv.value IS NOT NULL OR r.source_observation_id IS NOT NULL
  ),'[]'::jsonb) || coalesce((
    SELECT jsonb_build_array(jsonb_build_object(
      'field','description','label','Description','value',nullif(btrim(g.description),''),
      'inline_source',g.description_source,'rooted',false,
      'source_descriptions',h.entries,'source_descriptions_limit',5,
      'source_descriptions_scope','latest_recorded_public_listing_prose_observations',
      'as_of_at',statement_timestamp()))
    FROM gate g CROSS JOIN description_history h
    WHERE nullif(btrim(g.description),'') IS NOT NULL OR jsonb_array_length(h.entries)>0
  ),'[]'::jsonb) END
$function$;

COMMENT ON FUNCTION public.detect_field_conflicts(uuid) IS
'Existing current reported-state fold and metric-drain owner. Listing field rules remain; engine_size additionally accepts public active vehicle sale_result/specification scalar phrases with original source and known observation/ingestion clocks. Mechanical grammar only limits disclosure; no architecture/displacement inference, engine acceptance or sale-episode configuration binding. Legacy observed_at may be writer time, not installed-engine or engine-at-sale time. Changing-field chronology, same-clock conflicts, replay, manual decisions and original testimony remain unchanged.';
COMMENT ON FUNCTION public.get_vehicle_specs(uuid) IS
'Existing vehicle-gated specs/report/description reader. Listed engine is the original bounded mechanical engine_size phrase, separately from engine_type; rechecks original active eligible testimony, source URL, source identity, privacy and fold clocks. Unrecognized text is withheld, never truncated. Latest eligible listed claim only: legacy observed_at may be writer time, not installed-engine or sale time; sale-episode binding is unestablished. No canonical writes, access grants or historical configuration qualification.';
-- CREATE OR REPLACE must retain every original callable/access property.
DO $guard$
BEGIN
  IF EXISTS (SELECT * FROM pg_temp.listed_engine_previous_functions
    EXCEPT SELECT oid,proowner,proacl,proconfig,prosecdef,provolatile,proparallel,proisstrict,
      prorettype,proretset,prolang,pronargs,pronargdefaults,proargtypes,proargnames
    FROM pg_catalog.pg_proc WHERE oid IN
      ('public.detect_field_conflicts(uuid)'::regprocedure,'public.get_vehicle_specs(uuid)'::regprocedure))
  THEN RAISE EXCEPTION 'Listed-engine replacement changed an original function contract' USING ERRCODE='55000';
  END IF;
END;
$guard$;
COMMIT;
