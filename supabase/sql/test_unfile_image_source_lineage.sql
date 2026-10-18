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

\ir helpers/reattribute_observation_live_20261015.sql
\ir ../migrations/20261016164500_reattribute_image_onto_existing_copy.sql
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
\ir helpers/photo_unfile_triggers_live_20261018.sql
\ir helpers/photo_projection_owners_live_20261018.sql
\ir ../migrations/20261018180827_unfile_image_with_source_lineage.sql
\ir ../migrations/20261018180827_unfile_image_with_source_lineage.sql
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
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO public.vehicle_images
  (id,vehicle_id,user_id,image_url,storage_path,file_hash,taken_at,created_at,exif_data,image_identity_id,
   is_sensitive,sensitive_type,redacted_by,redacted_at,redaction_reason,is_document,is_primary,is_approved,
   vision_gate_status,ai_processing_status,ai_scan_metadata)
VALUES ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-0000000000a1',
 '00000000-0000-0000-0000-0000000000d1','https://example.invalid/synthetic/photo.heic','synthetic/photo.heic',repeat('a',64),
 '2026-10-15T08:00:00.000001Z','2026-10-16T08:00:00.000002Z','{"uuid":"synthetic-asset","camera_make":"Example","camera_model":"Synthetic"}',
 '00000000-0000-0000-0000-0000000000e1',true,'personal','00000000-0000-0000-0000-0000000000d1',
 '2026-10-17T08:00:00.000003Z','synthetic privacy withdrawal',true,true,true,'approved','completed',
 '{"previous_model":{"vehicle_id":"wrong","read_at":"2026-10-17T00:00:00Z"}}');

DO $$ DECLARE r jsonb; fresh public.vehicle_images%ROWTYPE; old public.vehicle_images%ROWTYPE; BEGIN
  r := public.reattribute_observation('image','00000000-0000-0000-0000-000000000011',NULL,
    pg_temp.unfile_reason('00000000-0000-0000-0000-000000000011','synthetic correction: destination unresolved'),'00000000-0000-0000-0000-0000000000d1');
  SELECT * INTO fresh FROM public.vehicle_images WHERE id=(r->>'new_observation_id')::uuid;
  SELECT * INTO old FROM public.vehicle_images WHERE id='00000000-0000-0000-0000-000000000011';
  PERFORM pg_temp.ok('unfile uses a new NULL-attribution leaf and retains old testimony',
    r->>'success'='true' AND fresh.id<>old.id AND fresh.vehicle_id IS NULL AND
    old.vehicle_id='00000000-0000-0000-0000-0000000000a1' AND old.is_superseded AND old.superseded_by=fresh.id);
  PERFORM pg_temp.ok('exact SHA, owner, URL/path, camera and source clocks preserved',
    fresh.file_hash=old.file_hash AND fresh.user_id=old.user_id AND fresh.image_url=old.image_url AND
    fresh.storage_path=old.storage_path AND fresh.created_at=old.created_at AND fresh.taken_at=old.taken_at AND
    fresh.exif_data=old.exif_data AND fresh.image_identity_id=old.image_identity_id);
  PERFORM pg_temp.ok('privacy/document withdrawal and its provenance preserved',
    fresh.is_sensitive AND fresh.is_document AND fresh.sensitive_type=old.sensitive_type AND
    fresh.redacted_by=old.redacted_by AND fresh.redacted_at=old.redacted_at AND fresh.redaction_reason=old.redaction_reason);
  PERFORM pg_temp.ok('pending source does not inherit visual/content approval or old cover',
    fresh.vision_gate_status='pending' AND fresh.is_approved=false AND fresh.is_primary=false);
  PERFORM pg_temp.ok('duplicate trigger remains active and honestly points to ancestor',
    fresh.is_duplicate AND fresh.duplicate_of=old.id);
  PERFORM pg_temp.ok('no paid analysis scheduled and no new model success manufactured',
    fresh.ai_processing_status='skipped' AND (SELECT count(*) FROM public.pipeline_calls)=0 AND
    fresh.ai_scan_metadata->'reattribution'->>'analysis_requested'='false' AND
    NOT (fresh.ai_scan_metadata ? 'previous_model') AND old.ai_scan_metadata ? 'previous_model');
  PERFORM pg_temp.ok('audit exactly binds old/new source and nullable destination at supersession clock',
    EXISTS(SELECT 1 FROM public.reattribution_audit a WHERE a.id=(r->>'audit_id')::uuid AND
      a.old_observation_id=old.id AND a.new_observation_id=fresh.id AND a.new_vehicle_id IS NULL AND
      a.old_vehicle_id=old.vehicle_id AND a.created_at=old.superseded_at AND
      fresh.ai_scan_metadata->'reattribution'->>'audit_id'=a.id::text AND
      fresh.ai_scan_metadata->'reattribution'->>'reviewed_at'=a.reason::jsonb->>'reviewed_at' AND
      a.reason::jsonb->>'review_observer'='synthetic_assistant' AND a.actor_user_id=fresh.user_id));
  PERFORM pg_temp.ok('current-row old-vehicle projection no longer returns that photograph',
    NOT EXISTS(SELECT 1 FROM public.vehicle_images WHERE vehicle_id=old.vehicle_id AND COALESCE(is_superseded,false)=false));
  r := public.reattribute_observation('image',old.id,NULL,pg_temp.unfile_reason(old.id,'again'),'00000000-0000-0000-0000-0000000000d1');
  PERFORM pg_temp.ok('old receipt cannot replay another clone',r->>'error'='already_superseded');
  r := public.reattribute_observation('image',fresh.id,NULL,pg_temp.unfile_reason(fresh.id,'again'),'00000000-0000-0000-0000-0000000000d1');
  PERFORM pg_temp.ok('already-unfiled leaf is a no-op',r->>'error'='target_same_as_current' AND
    (SELECT count(*) FROM public.reattribution_audit)=1);
END $$;

-- Independent request failures do not mint partial copies/audits.
INSERT INTO public.vehicle_images(id,vehicle_id,user_id,image_url,storage_path,file_hash,created_at,taken_at,ai_processing_status)
VALUES ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-0000000000a1',
 '00000000-0000-0000-0000-0000000000d1','https://example.invalid/second.heic','second.heic',repeat('b',64),
 '2026-10-16T00:00:00Z','2026-10-15T00:00:00Z','completed');
DO $$ DECLARE failures int:=0; reviewed jsonb; BEGIN
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,pg_temp.unfile_reason('00000000-0000-0000-0000-000000000012','reason'),NULL);
  EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,pg_temp.unfile_reason('00000000-0000-0000-0000-000000000012',' '),
    '00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('observation','00000000-0000-0000-0000-000000000012',NULL,'reason',
    '00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',
    '00000000-0000-0000-0000-000000000099','reason','00000000-0000-0000-0000-0000000000d1');
  EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  reviewed:=pg_temp.unfile_reason('00000000-0000-0000-0000-000000000012')::jsonb;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,
    jsonb_set(reviewed,'{expected,old_vehicle_id}','"00000000-0000-0000-0000-0000000000b1"')::text,
    '00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,
    jsonb_set(reviewed,'{expected,source_sha256}',to_jsonb(repeat('c',64)))::text,
    '00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,
    jsonb_set(reviewed,'{expected,taken_at}','"2026-10-15T00:00:00.000001Z"')::text,
    '00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,reviewed::text,
    '00000000-0000-0000-0000-0000000000d2'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,
    (reviewed-'reviewed_at')::text,'00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,
    jsonb_set(reviewed,'{reviewed_at}','"bad-clock"')::text,'00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,
    jsonb_set(reviewed,'{reviewed_at}',to_jsonb(clock_timestamp()+interval '10 minutes'))::text,'00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,
    jsonb_set(reviewed,'{reviewed_at}','"infinity"')::text,'00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  -- ALLOW_RAW_TESTIMONY_WRITE: nonfinite clocks in this disposable synthetic fixture only.
  UPDATE public.vehicle_images SET created_at='infinity' WHERE id='00000000-0000-0000-0000-000000000012';
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,
    pg_temp.unfile_reason('00000000-0000-0000-0000-000000000012'),'00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  UPDATE public.vehicle_images SET created_at='2026-10-16T00:00:00Z',taken_at='-infinity' WHERE id='00000000-0000-0000-0000-000000000012';
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000012',NULL,
    pg_temp.unfile_reason('00000000-0000-0000-0000-000000000012'),'00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN failures:=failures+1; END;
  UPDATE public.vehicle_images SET taken_at='2026-10-15T00:00:00Z' WHERE id='00000000-0000-0000-0000-000000000012';
  PERFORM pg_temp.ok('stale tuple, foreign actor, invalid target/reason and nonfinite/missing/malformed/future review and source clocks refused',failures=14);
  PERFORM pg_temp.ok('refusals made no image or audit writes',
    (SELECT count(*) FROM public.vehicle_images)=3 AND (SELECT count(*) FROM public.reattribution_audit)=1);
END $$;

INSERT INTO public.vehicle_images(id,vehicle_id,image_url,ai_processing_status)
VALUES ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-0000000000a1','https://example.invalid/legacy.jpg','completed');
DO $$ DECLARE rejected boolean:=false; BEGIN
  BEGIN PERFORM public.reattribute_observation('image','00000000-0000-0000-0000-000000000013',NULL,pg_temp.unfile_reason('00000000-0000-0000-0000-000000000013','unfile legacy'),
    '00000000-0000-0000-0000-0000000000d1'); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  PERFORM pg_temp.ok('legacy URL-only unfile is outside this bounded source contract',rejected);
END $$;
-- Non-NULL legacy URL-only onto-existing-copy behavior stays intact.
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,ai_processing_status)
VALUES ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-0000000000b1','https://example.invalid/legacy.jpg','completed');
DO $$ DECLARE r jsonb; BEGIN
  r:=public.reattribute_observation('image','00000000-0000-0000-0000-000000000013',
    '00000000-0000-0000-0000-0000000000b1','existing legacy move');
  PERFORM pg_temp.ok('non-NULL legacy URL-only existing-copy rule unchanged',
    r->>'onto_existing_copy'='true' AND r->>'new_observation_id'='00000000-0000-0000-0000-000000000023');
END $$;
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic witnesses only, isolated disposable PG17 database.
-- The latest wrongly filed photo is the old cover; unfile it without guessing a destination.
INSERT INTO public.vehicles(id) VALUES ('00000000-0000-0000-0000-0000000000c1');
INSERT INTO public.vehicle_images
 (id,vehicle_id,user_id,image_url,storage_path,file_hash,created_at,taken_at,source,exif_data,is_primary,
  vision_gate_status,image_vehicle_match_status,ai_processing_status)
VALUES
 ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d1','https://example.invalid/right.heic','right.heic',repeat('c',64),
  '2026-10-15T00:00:00Z','2026-10-14T00:00:00Z','capture_relay_ios','{"uuid":"synthetic-right"}',false,'approved','confirmed','completed'),
 ('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d1','https://example.invalid/wrong.heic','wrong.heic',repeat('d',64),
  '2026-10-16T00:00:00Z','2026-10-15T00:00:00Z','capture_relay_ios','{"uuid":"synthetic-wrong"}',true,'approved','confirmed','completed');
-- Existing INSERT projection owners seeded the cached state above; no direct vehicle update.
DO $$ DECLARE r jsonb; unfiled uuid; BEGIN
  PERFORM pg_temp.ok('before correction gallery/card show two eligible photos and latest cover',
    (SELECT image_count=2 AND primary_image_url='https://example.invalid/wrong.heic' FROM public.vehicles
      WHERE id='00000000-0000-0000-0000-0000000000c1') AND
    (SELECT count(*) FROM public.vehicle_images i WHERE i.vehicle_id='00000000-0000-0000-0000-0000000000c1'
      AND public.vehicle_image_gallery_eligible(i) AND i.is_sensitive IS NOT TRUE)=2);
  r:=public.reattribute_observation('image','00000000-0000-0000-0000-000000000052',NULL,pg_temp.unfile_reason('00000000-0000-0000-0000-000000000052','unfile wrong source'),
    '00000000-0000-0000-0000-0000000000d1');
  unfiled:=(r->>'new_observation_id')::uuid;
  PERFORM pg_temp.ok('supersession repairs cached old-car count and cover through existing owners',
    (SELECT image_count=1 AND primary_image_url='https://example.invalid/right.heic' FROM public.vehicles
      WHERE id='00000000-0000-0000-0000-0000000000c1'));
  PERFORM pg_temp.ok('wrong photo leaves old gallery; pending clone enters no canonical gallery',
    (SELECT count(*) FROM public.vehicle_images i WHERE i.vehicle_id='00000000-0000-0000-0000-0000000000c1'
      AND public.vehicle_image_gallery_eligible(i) AND i.is_sensitive IS NOT TRUE)=1 AND
    NOT (SELECT public.vehicle_image_gallery_eligible(i) FROM public.vehicle_images i WHERE i.id=unfiled));
  r:=public.reattribute_observation('image','00000000-0000-0000-0000-000000000051',NULL,pg_temp.unfile_reason('00000000-0000-0000-0000-000000000051','unfile final source'),
    '00000000-0000-0000-0000-0000000000d1');
  PERFORM pg_temp.ok('last current photo removal clears cover/count while testimony remains',
    (SELECT image_count=0 AND primary_image_url IS NULL FROM public.vehicles
      WHERE id='00000000-0000-0000-0000-0000000000c1') AND
    NOT EXISTS(SELECT 1 FROM public.vehicle_images i WHERE i.vehicle_id='00000000-0000-0000-0000-0000000000c1'
      AND public.vehicle_image_gallery_eligible(i)) AND
    (SELECT count(*) FROM public.vehicle_images i WHERE i.vehicle_id='00000000-0000-0000-0000-0000000000c1')=2);
  PERFORM pg_temp.ok('projection recompute requested no pipeline analysis',(SELECT count(*) FROM public.pipeline_calls)=0);
END $$;

-- Positive control: this exact trigger WOULD enqueue an ordinary pending source.
INSERT INTO public.vehicle_images(id,image_url,ai_processing_status)
VALUES ('00000000-0000-0000-0000-000000000090','https://example.invalid/control.jpg','pending');
SELECT pg_temp.ok('pipeline trigger spy exercised, not disabled',(SELECT count(*) FROM public.pipeline_calls)=1);

CREATE OR REPLACE FUNCTION public.reattribute_observation(p_observation_type text, p_observation_id uuid,
 p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$;
\set ON_ERROR_STOP off
\ir ../migrations/20261018180827_unfile_image_with_source_lineage.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('drifted writer body is not replaced',
  (SELECT prosrc FROM pg_proc WHERE oid='public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure) LIKE '%SELECT ''{}''::jsonb%');
SELECT 'unfile image source-lineage proposal: all passed' AS result;
