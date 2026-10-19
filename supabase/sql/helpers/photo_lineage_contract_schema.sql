-- LOCAL ONLY nullable-attribution proposal. Synthetic witnesses in an empty disposable PG17 database.
-- Does not exercise production, storage bytes, paid models or end-user authorization.
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in the disposable contract database.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET lock_timeout='3s';

-- Every column the function reads or writes, nothing else.
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, image_url text, image_type text,
  image_category text, category text, position int, caption text, is_primary boolean, created_at timestamptz DEFAULT now(),
  updated_at timestamptz, file_name text, source text, exif_data jsonb, file_hash text, file_size bigint, taken_at timestamptz,
  latitude numeric, longitude numeric, location_name text, apple_ml_labels jsonb, photographer_attribution text,
  documented_by_device text, documented_by_user_id uuid, storage_path text, thumbnail_url text, medium_url text,
  large_url text, merged_from_vehicle_id uuid, is_superseded boolean DEFAULT false, superseded_by uuid,
  superseded_at timestamptz, vision_gate_status text,
  is_sensitive boolean NOT NULL DEFAULT false, sensitive_type text, redacted_by uuid, redacted_at timestamptz,
  redaction_reason text, is_document boolean DEFAULT false, is_duplicate boolean DEFAULT false, duplicate_of uuid,
  is_external boolean DEFAULT false, image_identity_id uuid, is_approved boolean, ai_processing_status text DEFAULT 'pending',
  ai_scan_metadata jsonb DEFAULT '{}');
CREATE TABLE public.vehicle_observations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text, source_id uuid, source_identifier text,
  source_url text, content_text text, content_hash text, structured_data jsonb, confidence numeric, observed_at timestamptz,
  ingested_at timestamptz, observer_id uuid, observer_raw jsonb, submitted_by_user_id uuid, agent_tier text, agent_model text,
  extraction_method text, rank int, merged_from_vehicle_id uuid, is_superseded boolean DEFAULT false, superseded_by uuid,
  superseded_at timestamptz);
CREATE TABLE public.reattribution_audit(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_type text, old_observation_id uuid, old_vehicle_id uuid,
  new_observation_id uuid, new_vehicle_id uuid, reason text, actor_user_id uuid, created_at timestamptz DEFAULT now());
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;

\ir reattribute_observation_live_20261015.sql
\ir ../../migrations/20261016164500_reattribute_image_onto_existing_copy.sql
REVOKE ALL ON FUNCTION public.reattribute_observation(text,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reattribute_observation(text,uuid,uuid,text,uuid) TO service_role;
-- No live pg_net: this exact trigger's HTTP call is intercepted entirely inside the disposable database.
CREATE TABLE public.pipeline_calls(body jsonb);
CREATE SCHEMA net;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://example.invalid'::text $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'synthetic'::text $$;
CREATE FUNCTION public.vehicle_image_holds_wrong_bytes(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO public.pipeline_calls VALUES (body); RETURN 1;
END $$;
\ir photo_unfile_triggers_live_20261018.sql
\ir photo_projection_owners_live_20261018.sql
\ir ../../migrations/20261018180827_unfile_image_with_source_lineage.sql
\ir ../../migrations/20261018180827_unfile_image_with_source_lineage.sql
SELECT pg_temp.ok('service-only execute retained without new grants',
  has_function_privilege('service_role','public.reattribute_observation(text,uuid,uuid,text,uuid)','EXECUTE') AND
  NOT has_function_privilege('anon','public.reattribute_observation(text,uuid,uuid,text,uuid)','EXECUTE') AND
  NOT has_function_privilege('authenticated','public.reattribute_observation(text,uuid,uuid,text,uuid)','EXECUTE'));
SELECT pg_temp.ok('function remains invoker',
  NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure));
CREATE FUNCTION pg_temp.unfile_reason(source_id uuid,reason_text text DEFAULT 'negative source review') RETURNS text LANGUAGE sql AS $$
SELECT jsonb_build_object('contract','photo_unfile_review_v1','scope','negative_vehicle_attribution',
 'destination_identity_asserted',false,'reason',reason_text,'review_ref','https://example.invalid/review#synthetic',
 'review_method','synthetic_visual_interpretation','review_observer','synthetic_assistant','reviewed_at',clock_timestamp(),
 'expected',jsonb_build_object('user_id',user_id,'old_vehicle_id',vehicle_id,'source_sha256',file_hash,
 'image_url',image_url,'storage_path',storage_path,'created_at',created_at,'taken_at',taken_at))::text
FROM public.vehicle_images WHERE id=source_id
$$;
