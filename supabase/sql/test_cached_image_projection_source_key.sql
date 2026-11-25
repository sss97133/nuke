-- PG17 contract for 20261125191500_cached_image_projection_source_key.sql. EMPTY disposable dm_refinement_* database only.
-- The two owners it patches are loaded from their live definitions (fixtures/cached_image_projection_owners_20261125.sql),
-- so the migration's hash and anchor guards run against what production holds. All rows are made up.
--   1. a projection row whose typed key names its current source reading lands; a forged, stale or mismatched one is refused
--   2. setting the key on an existing row in place is still refused (the rule the backfill respects)
--   3. supersede_untyped_cached_image_properties re-lands untyped rows as keyed successors, holds rows of a stale reading,
--      is service role only, and a second call does nothing
--   4. the batch intake writes the key, and a re-sent claim whose row was re-landed is a duplicate of the successor
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database'; END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
CREATE TYPE public.observation_kind AS ENUM ('listing','sale_result','comment','specification','condition','activity');
CREATE TYPE public.confidence_level AS ENUM ('low','medium','high','verified');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, listing_kind text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, image_url text, source text, is_sensitive boolean,
 is_superseded boolean, is_duplicate boolean, is_document boolean, vision_gate_status text, image_vehicle_match_status text);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY, slug text, base_trust_score numeric,
 supported_observations public.observation_kind[]);
CREATE TABLE public.observation_properties(id uuid PRIMARY KEY, property_key text, namespace text, data_type text,
 discriminator_key text, applies_to_kinds public.observation_kind[], deprecated_at timestamptz);
CREATE TABLE public.vehicle_observations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, vehicle_match_confidence numeric, observed_at timestamptz,
 ingested_at timestamptz DEFAULT now(), source_id uuid, source_url text, source_identifier text, kind public.observation_kind,
 content_text text, content_hash text, structured_data jsonb DEFAULT '{}', confidence public.confidence_level,
 confidence_score numeric, confidence_factors jsonb DEFAULT '{}', is_superseded boolean DEFAULT false, superseded_by uuid,
 superseded_at timestamptz, lineage_chain uuid[], agent_tier text, agent_model text, agent_cost_cents numeric,
 extraction_method text, raw_source_ref text, property_id uuid, subject_type text DEFAULT 'vehicle', subject_id uuid,
 submitted_by_user_id uuid, source_snapshot_id uuid, source_comment_id uuid, source_vehicle_event_id uuid,
 auction_event_id uuid, source_observation_id uuid, component_subject_id uuid, analysis_deferred boolean DEFAULT false,
 CONSTRAINT unique_observation UNIQUE (source_id, source_identifier, kind, content_hash));
ALTER TABLE public.vehicle_observations ADD CONSTRAINT vehicle_observations_source_observation_id_fkey
 FOREIGN KEY (source_observation_id) REFERENCES public.vehicle_observations(id) NOT VALID;
CREATE TABLE public.observation_witnesses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_id uuid, image_id uuid,
 witness_role text, UNIQUE (observation_id, image_id, witness_role));
CREATE FUNCTION public.observation_is_public(k public.observation_kind, d jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
-- the witness projection, as trg_project_observation_image_witness does for any row naming an image
CREATE FUNCTION public.test_witness() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.structured_data ? 'image_id' THEN
  INSERT INTO public.observation_witnesses(observation_id,image_id,witness_role)
  VALUES (NEW.id,(NEW.structured_data->>'image_id')::uuid,'derived') ON CONFLICT DO NOTHING;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_project_observation_image_witness AFTER INSERT ON public.vehicle_observations
 FOR EACH ROW EXECUTE FUNCTION public.test_witness();

\ir fixtures/cached_image_projection_owners_20261125.sql
-- the live triggers that call the guard (WHEN clauses as in production, trimmed to the columns this fixture has)
CREATE TRIGGER trg_retained_listing_property_source_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
 WHEN (NEW.source_observation_id IS NOT NULL OR NEW.extraction_method = ANY (ARRAY['retained_listing_property_projection_v1','retained_listing_reported_work_v1']))
 EXECUTE FUNCTION public.validate_retained_listing_property_source();
CREATE TRIGGER trg_retained_listing_property_source_update BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW
 WHEN (OLD.source_observation_id IS NOT NULL OR NEW.source_observation_id IS NOT NULL)
 EXECUTE FUNCTION public.validate_retained_listing_property_source();

DO $$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64')
    IS DISTINCT FROM 'Oonr0vrXAn5C9lGFRZgKW95LAfKc9RygAeKxPuhKQl0='
 OR encode(sha256(convert_to(pg_get_functiondef('public.ingest_cached_image_property_batch(jsonb)'::regprocedure),'UTF8')),'base64')
    IS DISTINCT FROM 'ZzQm8ueqs/6tWfiZ/JojBwfqMPGvrqJs+kXWTdQkqf8='
 THEN RAISE EXCEPTION 'fixture is not the live definition'; END IF;
END $$;

-- BEFORE: a projection row carrying the key is refused by the guard's fall-through
INSERT INTO public.vehicles VALUES ('11111111-1111-4111-8111-111111111111', true, NULL, NULL);
INSERT INTO public.observation_sources VALUES ('22222222-2222-4222-8222-222222222222','photo_pipeline',0.5,ARRAY['condition']::public.observation_kind[]);
INSERT INTO public.observation_properties VALUES
 ('33333333-3333-4333-8333-000000000001','image_visible_rust_severity','core','enum','image_id',ARRAY['condition']::public.observation_kind[],NULL),
 ('33333333-3333-4333-8333-000000000002','image_visible_paint_stage','core','enum','image_id',ARRAY['condition']::public.observation_kind[],NULL),
 ('33333333-3333-4333-8333-000000000003','image_visible_assembly_state','core','enum','image_id',ARRAY['condition']::public.observation_kind[],NULL);
INSERT INTO public.vehicle_images VALUES
 ('44444444-4444-4444-8444-000000000001','11111111-1111-4111-8111-111111111111','https://bringatrailer.com/wp-content/uploads/made-up-1.jpg','bat',false,false,false,false,'approved',NULL),
 ('44444444-4444-4444-8444-000000000002','11111111-1111-4111-8111-111111111111','https://bringatrailer.com/wp-content/uploads/made-up-2.jpg','bat',false,false,false,false,'approved',NULL);
-- two deep readings (photo 1, photo 2) and a stale one on photo 2
INSERT INTO public.vehicle_observations(id,vehicle_id,observed_at,ingested_at,source_id,kind,structured_data,confidence,confidence_score,agent_model,extraction_method)
VALUES
 ('55555555-5555-4555-8555-000000000001','11111111-1111-4111-8111-111111111111','2026-11-10T10:00:00Z','2026-11-10T10:00:01Z','22222222-2222-4222-8222-222222222222','condition',
  '{"analysis_kind":"image_deep_byok","image_id":"44444444-4444-4444-8444-000000000001","state_observations":{"paint_state":"primer","rust_severity":"surface","completeness":"partial"}}','medium',0.8,'made-up-model','reviewed_image_analysis_v1'),
 ('55555555-5555-4555-8555-000000000002','11111111-1111-4111-8111-111111111111','2026-11-10T10:00:00Z','2026-11-10T10:00:02Z','22222222-2222-4222-8222-222222222222','condition',
  '{"analysis_kind":"image_deep_byok","image_id":"44444444-4444-4444-8444-000000000002","state_observations":{"paint_state":"aged","rust_severity":"none","completeness":"assembled"}}','medium',0.8,'made-up-model','reviewed_image_analysis_v1'),
 ('55555555-5555-4555-8555-000000000003','11111111-1111-4111-8111-111111111111','2026-11-10T09:00:00Z','2026-11-10T09:00:01Z','22222222-2222-4222-8222-222222222222','condition',
  '{"analysis_kind":"image_deep_byok","image_id":"44444444-4444-4444-8444-000000000002","state_observations":{"paint_state":"clear"}}','medium',0.8,'made-up-model','reviewed_image_analysis_v1');

-- a child as the single route writes it (structured_data as projectImageProperties builds it)
CREATE FUNCTION pg_temp.child(p_source uuid, p_key text, p_value text, p_hash text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(p_key,p_value,'image_id',o.structured_data->>'image_id','property_key',p_key,
  'analysis_kind','image_property_projection','projection_version','byok_image_properties_v1','source_observation_id',o.id,
  'source_result_hash',p_hash,'source_extraction_method',o.extraction_method,'source_model_confidence',o.confidence_score,
  'source_recorded_at',o.ingested_at,'source_observed_at',o.observed_at,'observed_at_basis','source_testimony_recorded_at',
  'capture_at',NULL,'analyzed_at',NULL,'claim_role','inferred','source_family','image:'||(o.structured_data->>'image_id'),
  'limitation','Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration.')
 FROM public.vehicle_observations o WHERE o.id=p_source $$;
CREATE FUNCTION pg_temp.land(p_source uuid, p_key text, p_value text, p_typed boolean, p_property uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE h text := encode(sha256(convert_to(p_source::text||p_key,'UTF8')),'hex'); new_id uuid; BEGIN
 INSERT INTO public.vehicle_observations(vehicle_id,observed_at,source_id,source_identifier,kind,content_hash,structured_data,
  confidence,confidence_score,agent_model,extraction_method,raw_source_ref,property_id,analysis_deferred,source_observation_id)
 SELECT o.vehicle_id,o.ingested_at,o.source_id,'byok_image_properties_v1:'||o.id||':'||h||':'||p_key,'condition',
  encode(sha256(convert_to('content:'||h||':'||p_value,'UTF8')),'hex'),pg_temp.child(p_source,p_key,p_value,h),
  'medium',0.6,o.agent_model,'cached_byok_property_projection_v1','vehicle_observations:'||o.id,
  coalesce(p_property,(SELECT id FROM public.observation_properties WHERE property_key=p_key)),true,
  CASE WHEN p_typed THEN p_source END
 FROM public.vehicle_observations o WHERE o.id=p_source RETURNING id INTO new_id;
 RETURN new_id; END $$;

DO $$ BEGIN
 BEGIN PERFORM pg_temp.land('55555555-5555-4555-8555-000000000001','image_visible_paint_stage','primer',true);
  RAISE EXCEPTION 'before the migration a keyed projection row must be refused';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'unsupported retained property' THEN RAISE; END IF; END;
END $$;
-- rows as production holds them: untyped. Photo 1 three values, photo 2 two values; one child of the stale reading.
SELECT pg_temp.land('55555555-5555-4555-8555-000000000001','image_visible_paint_stage','primer',false);
SELECT pg_temp.land('55555555-5555-4555-8555-000000000001','image_visible_rust_severity','surface',false);
SELECT pg_temp.land('55555555-5555-4555-8555-000000000001','image_visible_assembly_state','partial',false);
SELECT pg_temp.land('55555555-5555-4555-8555-000000000002','image_visible_rust_severity','none',false);
SELECT pg_temp.land('55555555-5555-4555-8555-000000000003','image_visible_paint_stage','clear',false);
UPDATE public.vehicle_observations SET is_superseded=true, superseded_by='55555555-5555-4555-8555-000000000002'
 WHERE id='55555555-5555-4555-8555-000000000003';

\ir ../migrations/20261125191500_cached_image_projection_source_key.sql

-- 1. the guard branch
DO $$ DECLARE r uuid; BEGIN
 r := pg_temp.land('55555555-5555-4555-8555-000000000002','image_visible_paint_stage','aged',true);
 IF (SELECT source_observation_id FROM public.vehicle_observations WHERE id=r) IS DISTINCT FROM '55555555-5555-4555-8555-000000000002'
 THEN RAISE EXCEPTION '1a: a keyed projection row naming its current reading must land with the key'; END IF;
 -- forged parent: the key names another reading than the row's jsonb
 BEGIN
  INSERT INTO public.vehicle_observations(vehicle_id,source_id,source_identifier,kind,content_hash,structured_data,extraction_method,raw_source_ref,property_id,source_observation_id)
  SELECT vehicle_id,source_id,source_identifier||':x','condition',content_hash,structured_data,extraction_method,raw_source_ref,property_id,'55555555-5555-4555-8555-000000000001'
   FROM public.vehicle_observations WHERE id=r;
  RAISE EXCEPTION '1b: a key that is not the row''s own source reading must be refused';
 EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE 'image property projection must name%' THEN RAISE; END IF; END;
 -- value the reading does not hold
 BEGIN
  INSERT INTO public.vehicle_observations(vehicle_id,source_id,source_identifier,kind,content_hash,structured_data,extraction_method,raw_source_ref,property_id,source_observation_id)
  SELECT vehicle_id,source_id,source_identifier||':y','condition',content_hash,jsonb_set(structured_data,'{image_visible_paint_stage}','"base"'),extraction_method,raw_source_ref,property_id,source_observation_id
   FROM public.vehicle_observations WHERE id=r;
  RAISE EXCEPTION '1c: a value the source reading does not hold must be refused';
 EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE 'image property projection must name%' THEN RAISE; END IF; END;
 -- stale parent
 BEGIN PERFORM pg_temp.land('55555555-5555-4555-8555-000000000003','image_visible_assembly_state','assembled',true);
  RAISE EXCEPTION '1d: a superseded source reading must be refused';
 EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE 'image property projection must name%' THEN RAISE; END IF; END;
 -- property id of another key
 BEGIN PERFORM pg_temp.land('55555555-5555-4555-8555-000000000002','image_visible_assembly_state','assembled',true,'33333333-3333-4333-8333-000000000001');
  RAISE EXCEPTION '1e: a registry row of another key must be refused';
 EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE 'image property projection must name%' THEN RAISE; END IF; END;
 -- the retained-listing paths behind it are unchanged: a non-projection row with an unknown key still falls through
 BEGIN
  INSERT INTO public.vehicle_observations(vehicle_id,source_id,kind,structured_data,extraction_method,source_observation_id)
  VALUES ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','specification','{"property_key":"made_up"}','made_up_v1','55555555-5555-4555-8555-000000000001');
  RAISE EXCEPTION '1f: other rows keep the old refusal';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'unsupported retained property' THEN RAISE; END IF; END;
END $$;

-- 2. no in-place key
DO $$ BEGIN
 BEGIN
  UPDATE public.vehicle_observations SET source_observation_id=(structured_data->>'source_observation_id')::uuid
   WHERE extraction_method='cached_byok_property_projection_v1' AND source_observation_id IS NULL AND NOT is_superseded;
  RAISE EXCEPTION '2: setting the key in place must stay refused';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'retained source links are assigned only on insert' THEN RAISE; END IF; END;
END $$;

-- 3. the re-landing
DO $$ DECLARE out jsonb; before_ids uuid[]; BEGIN
 BEGIN PERFORM public.supersede_untyped_cached_image_properties('11111111-1111-4111-8111-111111111111',10);
  RAISE EXCEPTION '3a: only the service role re-lands';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.supersede_untyped_cached_image_properties(uuid,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.supersede_untyped_cached_image_properties(uuid,integer)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.supersede_untyped_cached_image_properties(uuid,integer)','EXECUTE')
 THEN RAISE EXCEPTION '3b: grants'; END IF;
 SELECT array_agg(id ORDER BY id) INTO before_ids FROM public.vehicle_observations
  WHERE extraction_method='cached_byok_property_projection_v1' AND source_observation_id IS NULL AND NOT is_superseded;
 PERFORM set_config('test.role','service_role',true);
 out := public.supersede_untyped_cached_image_properties('11111111-1111-4111-8111-111111111111',2);
 IF out->>'succeeded' <> '2' OR out->>'remaining' <> '2' OR out->>'held_source_not_current' <> '1' THEN RAISE EXCEPTION '3c: %', out; END IF;
 out := public.supersede_untyped_cached_image_properties('11111111-1111-4111-8111-111111111111',10);
 IF out->>'succeeded' <> '2' OR out->>'remaining' <> '0' OR out->>'held_source_not_current' <> '1' THEN RAISE EXCEPTION '3d: %', out; END IF;
 out := public.supersede_untyped_cached_image_properties('11111111-1111-4111-8111-111111111111',10);
 IF out->>'succeeded' <> '0' THEN RAISE EXCEPTION '3e: a second call re-lands nothing: %', out; END IF;
 -- every old row of a current reading is superseded by a successor identical but for the key, clock and hash
 IF EXISTS (SELECT 1 FROM public.vehicle_observations o
   LEFT JOIN public.vehicle_observations s ON s.id=o.superseded_by
   WHERE o.id = ANY(before_ids) AND o.structured_data->>'source_observation_id' <> '55555555-5555-4555-8555-000000000003'
     AND (NOT o.is_superseded OR s.id IS NULL OR s.is_superseded OR s.source_observation_id::text IS DISTINCT FROM o.structured_data->>'source_observation_id'
       OR s.structured_data IS DISTINCT FROM o.structured_data OR s.source_identifier IS DISTINCT FROM o.source_identifier
       OR s.observed_at IS DISTINCT FROM o.observed_at OR s.property_id IS DISTINCT FROM o.property_id
       OR s.content_hash IS DISTINCT FROM encode(sha256(convert_to(o.content_hash||':typed_source_v1','UTF8')),'hex')
       OR NOT (o.lineage_chain @> ARRAY[s.id])
       OR NOT EXISTS (SELECT 1 FROM public.observation_witnesses w WHERE w.observation_id=s.id AND w.witness_role='derived')))
 THEN RAISE EXCEPTION '3f: successor shape'; END IF;
 -- the stale reading's child is left as it was
 IF NOT EXISTS (SELECT 1 FROM public.vehicle_observations WHERE structured_data->>'source_observation_id'='55555555-5555-4555-8555-000000000003'
   AND NOT is_superseded AND source_observation_id IS NULL) THEN RAISE EXCEPTION '3g: held row'; END IF;
 IF (SELECT count(*) FROM public.vehicle_observations WHERE extraction_method='cached_byok_property_projection_v1' AND NOT is_superseded
   AND source_observation_id IS NOT NULL) <> 5 THEN RAISE EXCEPTION '3h: five current keyed rows (four re-landed, one landed keyed)'; END IF;
END $$;

-- 4. the batch intake: a new claim lands keyed; a claim whose row was re-landed replays as a duplicate of the successor
CREATE FUNCTION pg_temp.claim(p_source uuid, p_key text, p_value text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o public.vehicle_observations%ROWTYPE; srj text; h text; sd jsonb; BEGIN
 SELECT * INTO o FROM public.vehicle_observations WHERE id=p_source;
 srj := jsonb_build_object('observation_id',o.id,'image_id',o.structured_data->>'image_id','vehicle_id',o.vehicle_id,'model',o.agent_model,
  'method',o.extraction_method,'recorded_at',to_jsonb(o.ingested_at)#>>'{}','state_observations',jsonb_build_object(
   'rust_severity',o.structured_data->'state_observations'->'rust_severity','paint_state',o.structured_data->'state_observations'->'paint_state',
   'completeness',o.structured_data->'state_observations'->'completeness'))::text;
 h := encode(sha256(convert_to(srj,'UTF8')),'hex');
 sd := pg_temp.child(p_source,p_key,p_value,h) || jsonb_build_object('source_recorded_at',to_jsonb(o.ingested_at)#>>'{}',
   'source_observed_at',to_jsonb(o.observed_at)#>>'{}');
 RETURN jsonb_build_object('source_slug','photo_pipeline','kind','condition','vehicle_id',o.vehicle_id,'property_key',p_key,
  'agent_inferred',true,'defer_analysis',true,'observed_at',o.ingested_at,
  'source_identifier','byok_image_properties_v1:'||o.id||':'||h||':'||p_key,'raw_source_ref','vehicle_observations:'||o.id,
  'agent_model',o.agent_model,'extraction_method','cached_byok_property_projection_v1','agent_cost_cents',0,
  'structured_data',sd,'content_hash',encode(sha256(convert_to('batch:'||p_source||p_key,'UTF8')),'hex'),'source_result_json',srj);
END $$;
-- a fourth reading, by another reader, on a third photo
INSERT INTO public.vehicle_images VALUES
 ('44444444-4444-4444-8444-000000000003','11111111-1111-4111-8111-111111111111','https://bringatrailer.com/wp-content/uploads/made-up-3.jpg','bat',false,false,false,false,'approved',NULL);
INSERT INTO public.vehicle_observations(id,vehicle_id,observed_at,ingested_at,source_id,kind,structured_data,confidence,confidence_score,agent_model,extraction_method)
VALUES ('55555555-5555-4555-8555-000000000004','11111111-1111-4111-8111-111111111111','2026-11-10T11:00:00Z','2026-11-10T11:00:01Z','22222222-2222-4222-8222-222222222222','condition',
  '{"analysis_kind":"image_deep_byok","image_id":"44444444-4444-4444-8444-000000000003","state_observations":{"paint_state":"bare_metal","rust_severity":"pitting","completeness":"stripped"}}','medium',0.8,'made-up-model','byok_claude_print_read_tool');
DO $$ DECLARE r jsonb; c jsonb; first_id uuid; succ uuid; BEGIN
 PERFORM set_config('test.role','service_role',true);
 c := pg_temp.claim('55555555-5555-4555-8555-000000000004','image_visible_assembly_state','stripped');
 r := public.ingest_cached_image_property_batch(jsonb_build_array(c));
 IF r->>'inserted' <> '1' THEN RAISE EXCEPTION '4a: %', r; END IF;
 first_id := (r->'results'->0->>'observation_id')::uuid;
 IF (SELECT source_observation_id FROM public.vehicle_observations WHERE id=first_id) IS DISTINCT FROM '55555555-5555-4555-8555-000000000004'
 THEN RAISE EXCEPTION '4b: the batch intake writes the key'; END IF;
 -- a row the batch landed before the key (the old insert shape, no column) is re-landed, then the same claim is re-sent
 c := pg_temp.claim('55555555-5555-4555-8555-000000000004','image_visible_paint_stage','bare_metal');
 INSERT INTO public.vehicle_observations(vehicle_id,observed_at,source_id,source_identifier,kind,content_hash,structured_data,confidence,confidence_score,
   agent_model,extraction_method,raw_source_ref,property_id,analysis_deferred)
 SELECT (c->>'vehicle_id')::uuid,(c->>'observed_at')::timestamptz,'22222222-2222-4222-8222-222222222222',c->>'source_identifier','condition',c->>'content_hash',
   c->'structured_data','medium',0.6,c->>'agent_model',c->>'extraction_method',c->>'raw_source_ref','33333333-3333-4333-8333-000000000002',true;
 r := public.supersede_untyped_cached_image_properties('11111111-1111-4111-8111-111111111111',10);
 IF r->>'succeeded' <> '1' THEN RAISE EXCEPTION '4c: %', r; END IF;
 SELECT id INTO succ FROM public.vehicle_observations WHERE source_identifier=c->>'source_identifier' AND NOT is_superseded;
 r := public.ingest_cached_image_property_batch(jsonb_build_array(c));
 IF r->>'inserted' <> '0' OR r->>'duplicates' <> '1' OR (r->'results'->0->>'observation_id')::uuid IS DISTINCT FROM succ
 THEN RAISE EXCEPTION '4d: a re-sent claim is a duplicate of its successor: %', r; END IF;
 -- a claim of the same parent and property under a third identity is still a conflict
 c := jsonb_set(c,'{content_hash}',to_jsonb(encode(sha256(convert_to('batch-third','UTF8')),'hex')));
 BEGIN PERFORM public.ingest_cached_image_property_batch(jsonb_build_array(c));
  RAISE EXCEPTION '4e: a third identity must conflict';
 EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE 'existing immutable parent property%' THEN RAISE; END IF; END;
END $$;

\echo 'PASS test_cached_image_projection_source_key'
