-- Disposable PostgreSQL contract for protected subject storage. Synthetic only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.image_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'requires an empty disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
END $$;
SET statement_timeout = '10s';
SET lock_timeout = '2s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
CREATE TABLE vehicles(id uuid PRIMARY KEY);
CREATE TABLE vehicle_images(
 id uuid PRIMARY KEY,user_id uuid,image_url text,file_hash text,storage_path text,vehicle_id uuid REFERENCES vehicles(id),
 is_superseded boolean DEFAULT false,is_duplicate boolean DEFAULT false,vision_gate_status text DEFAULT 'approved',
 is_document boolean DEFAULT false,is_sensitive boolean DEFAULT false,
 taken_at timestamptz,created_at timestamptz NOT NULL
);
CREATE TABLE emergent_vehicle_clusters(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cluster_label text,candidate_year integer,candidate_make text,candidate_model text,
 earliest_image timestamptz,latest_image timestamptz,image_count integer NOT NULL DEFAULT 0,
 resolved_to_vehicle_id uuid REFERENCES vehicles(id),resolved_at timestamptz,resolved_by text,resolution_evidence jsonb,
 visual_centroid jsonb,confidence numeric,cluster_label_history jsonb NOT NULL DEFAULT '[]',is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE image_observations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),image_id uuid NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
 vehicle_id uuid REFERENCES vehicles(id),cluster_id uuid REFERENCES emergent_vehicle_clusters(id),role text NOT NULL,
 confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1),confidence_basis jsonb NOT NULL DEFAULT '{}',
 bbox jsonb,visual_signature jsonb DEFAULT '{}',layer_version jsonb NOT NULL DEFAULT '{}',observed_by text NOT NULL,
 agent_version text,observed_at timestamptz NOT NULL DEFAULT now(),superseded_by uuid REFERENCES image_observations(id),
 is_active boolean NOT NULL DEFAULT true,
 is_high_confidence_subject boolean GENERATED ALWAYS AS (role='subject' AND confidence>0.85 AND is_active) STORED,
 CHECK(vehicle_id IS NOT NULL OR cluster_id IS NOT NULL OR observed_by IS NOT NULL),
 CHECK(role IN ('subject','background','incidental','plate','odometer','vin','document','part'))
);
ALTER TABLE image_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergent_vehicle_clusters ENABLE ROW LEVEL SECURITY;
-- Exact old signature and execution boundary: CREATE OR REPLACE must preserve it.
CREATE FUNCTION ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb DEFAULT '{}',boolean DEFAULT NULL,jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT NULL::uuid $$;
REVOKE ALL ON FUNCTION ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb) TO service_role;
\ir ../migrations/20261018165532_bind_visual_subject_observations.sql

CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF;
 RAISE NOTICE 'PASS %',label;
END $$;
CREATE FUNCTION pg_temp.u(label text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(label)::uuid $$;
INSERT INTO vehicles VALUES(pg_temp.u('contaminated prior attachment'));
INSERT INTO vehicle_images(id,user_id,image_url,file_hash,storage_path,vehicle_id,taken_at,created_at)
SELECT pg_temp.u(k),pg_temp.u('photographer'),'https://private.example/'||k,md5(k)||md5(k),
 'users/'||pg_temp.u('photographer')||'/capture-relay/'||md5(k)||md5(k)||'/fixture.HEIC',
 CASE WHEN k='mustang' THEN pg_temp.u('contaminated prior attachment') END,
 '2026-10-15T16:39:02.000001Z','2026-10-16T13:24:47.657549Z'
FROM unnest(ARRAY['mustang','mustang detail','porsche','porsche detail','corvette','near identical']) k;
CREATE FUNCTION pg_temp.envelope() RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_build_object('user_id',pg_temp.u('photographer'),'method','visual_subjects_v1','run_key','synthetic-batch',
 'model','fixture-model','provider','fixture-provider','read_at','2026-10-18T00:00:00Z',
 'inputs',(SELECT jsonb_agg(jsonb_build_object('image_id',id,'source_sha256',file_hash,'input_sha256',file_hash,
   'source_qualified',true,'representation','source','taken_at',taken_at,'created_at',created_at) ORDER BY id) FROM vehicle_images),
 'frames',(SELECT jsonb_agg(jsonb_build_object('image_id',id,'medium','photograph','primary_subject','vehicle',
   'view',CASE WHEN id IN (pg_temp.u('mustang'),pg_temp.u('porsche')) THEN 'exterior' ELSE 'detail' END,
   'bbox',jsonb_build_array(0.1,0.1,0.8,0.8))) FROM vehicle_images),
 'subjects',jsonb_build_array(
   jsonb_build_object('anchor_image_id',pg_temp.u('mustang'),
     'member_image_ids',jsonb_build_array(pg_temp.u('mustang'),pg_temp.u('mustang detail')),
     'correspondences',jsonb_build_array(jsonb_build_object('left_image_id',pg_temp.u('mustang'),'right_image_id',pg_temp.u('mustang detail'),
       'features',jsonb_build_array(
         jsonb_build_object('kind','body_geometry','left_witness','notch at wheel opening','right_witness','same notch'),
         jsonb_build_object('kind','fixed_wear','left_witness','fixed scrape below notch','right_witness','same scrape')))),
     'contradictions','[]'::jsonb,'asserted_identity','{}'::jsonb,'physical_identity','unresolved'),
   jsonb_build_object('anchor_image_id',pg_temp.u('porsche'),'member_image_ids',jsonb_build_array(pg_temp.u('porsche'),pg_temp.u('porsche detail')),
     'correspondences',jsonb_build_array(jsonb_build_object('left_image_id',pg_temp.u('porsche'),'right_image_id',pg_temp.u('porsche detail'),
       'features',jsonb_build_array(
         jsonb_build_object('kind','body_geometry','left_witness','unique fender fold','right_witness','same fender fold'),
         jsonb_build_object('kind','fixed_wear','left_witness','scar at the fold','right_witness','same scar')))),
     'contradictions','[]'::jsonb,'asserted_identity','{}'::jsonb,'physical_identity','unresolved')),
 'candidate_scope',jsonb_build_object('associated_terminal_ids',jsonb_build_array(pg_temp.u('contaminated prior attachment')),
   'count',1,'exhausted',false,'truncated',true,'unavailable_refs',jsonb_build_array('missing historical reference'),
   'judgments','[]'::jsonb))
$$;
CREATE FUNCTION pg_temp.wrapper(e jsonb,anchor text DEFAULT 'mustang',state text DEFAULT 'active') RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_build_object('visual_subjects_v1',jsonb_build_object('anchor_image_id',pg_temp.u(anchor),'envelope',e,
 'state',state)||CASE WHEN state='withdrawn' THEN jsonb_build_object('withdrawal_reason','later source withdrawal') ELSE '{}'::jsonb END)
$$;
CREATE FUNCTION pg_temp.call(e jsonb,img text DEFAULT 'mustang',anchor text DEFAULT 'mustang',state text DEFAULT 'active') RETURNS uuid LANGUAGE sql AS $$
SELECT public.ingest_image_observation(pg_temp.u(img),NULL,'subject',0.9,'visual_subjects_v1','fixture-v1',
 pg_temp.wrapper(e,anchor,state),NULL,'{"grouping":"visual_subjects_v1"}')
$$;
CREATE FUNCTION pg_temp.refuses(label text,e jsonb,img text DEFAULT 'mustang',anchor text DEFAULT 'mustang') RETURNS void LANGUAGE plpgsql AS $$
DECLARE refused boolean:=false; BEGIN
 BEGIN PERFORM pg_temp.call(e,img,anchor); EXCEPTION WHEN OTHERS THEN refused:=true; END;
 PERFORM pg_temp.ok(label,refused);
END $$;
CREATE FUNCTION pg_temp.normalized(e jsonb,img text DEFAULT 'mustang') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n int; p text; h text; d jsonb; BEGIN
 SELECT ord-1 INTO n FROM jsonb_array_elements(e->'inputs') WITH ORDINALITY i(value,ord) WHERE value->>'image_id'=pg_temp.u(img)::text;
 SELECT 'vehicle-photos/'||storage_path,file_hash INTO p,h FROM vehicle_images WHERE id=pg_temp.u(img);
 d:=jsonb_build_object('contract','supabase_content_addressed_render_v1','trusted_origin','https://qkgaybvrernstplzjaam.supabase.co',
   'source_object_path',p,'render_path','/storage/v1/render/image/public/'||p,
   'parameters',jsonb_build_object('width',1600,'height',1600,'resize','contain','quality',85),'request_accept','image/jpeg',
   'source_sha256',h,'input_sha256',repeat('c',64),'source_mime_type','image/heic','source_byte_length',67890,
   'source_captured_at','2026-10-17T23:59:59Z');
 RETURN jsonb_set(e,ARRAY['inputs',n::text],(e #> ARRAY['inputs',n::text])||jsonb_build_object(
   'representation','derivative','source_bytes_qualified',false,'derivation_qualified',true,'mime_type','image/jpeg','byte_length',12345,
   'source_url','https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/'||p,
   'input_url','https://qkgaybvrernstplzjaam.supabase.co/storage/v1/render/image/public/'||p||'?width=1600&height=1600&resize=contain&quality=85',
   'input_sha256',repeat('c',64),'derivation',d));
END $$;
CREATE FUNCTION pg_temp.reading_envelope() RETURNS jsonb LANGUAGE sql AS $$
SELECT pg_temp.envelope() || jsonb_build_object('subjects','[]'::jsonb,'frames','[]'::jsonb,
 'inputs',(SELECT jsonb_agg(i) FROM jsonb_array_elements(pg_temp.envelope()->'inputs') i
           WHERE i->>'image_id' IN (pg_temp.u('corvette')::text,pg_temp.u('near identical')::text)),
 'unresolved',jsonb_build_array(
   jsonb_build_object('image_id',pg_temp.u('corvette'),'reason','needs_corresponding_view'),
   jsonb_build_object('image_id',pg_temp.u('near identical'),'reason','primary_subject_unqualified')))
$$;
CREATE FUNCTION pg_temp.reading(e jsonb,img text DEFAULT 'corvette',state text DEFAULT 'active') RETURNS uuid LANGUAGE sql AS $$
SELECT public.ingest_image_observation(pg_temp.u(img),NULL,'part',0.5,'visual_subject_reading_v1','visual_subject_reading_v1',
 jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',e,'state',state) ||
 CASE WHEN state='withdrawn' THEN jsonb_build_object('withdrawal_reason','supporting source withdrawn') ELSE '{}'::jsonb END),NULL,'{"reader":"v1"}')
$$;
CREATE FUNCTION pg_temp.refuses_reading(label text,e jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE refused boolean:=false; BEGIN
 BEGIN PERFORM pg_temp.reading(e); EXCEPTION WHEN OTHERS THEN refused:=true; END;
 PERFORM pg_temp.ok(label,refused);
END $$;

DO $$ DECLARE e jsonb:=pg_temp.envelope(); first_id uuid; again uuid; cluster_id uuid; initial jsonb; revised uuid; BEGIN
 first_id:=pg_temp.call(e);
 SELECT o.cluster_id INTO cluster_id FROM image_observations o WHERE id=first_id;
 PERFORM pg_temp.ok('sanctioned writer creates supported unresolved cluster without year VIN or vehicle',
   EXISTS(SELECT 1 FROM emergent_vehicle_clusters c WHERE c.id=cluster_id AND candidate_year IS NULL AND candidate_make IS NULL
    AND candidate_model IS NULL AND resolved_to_vehicle_id IS NULL AND c.resolution_evidence #>> '{visual_subjects_v1,identity_status}'='unresolved')
   AND EXISTS(SELECT 1 FROM image_observations WHERE id=first_id AND vehicle_id IS NULL AND is_active)
   AND (SELECT count(*) FROM vehicles)=1);
 PERFORM pg_temp.ok('existing wrong attachment is context and is untouched',
   (SELECT vehicle_id FROM vehicle_images WHERE id=pg_temp.u('mustang'))=pg_temp.u('contaminated prior attachment'));
 PERFORM pg_temp.ok('deterministic account anchor cluster key',cluster_id=md5('visual_subjects_v1:'||pg_temp.u('photographer')||':'||pg_temp.u('mustang'))::uuid);
 initial:=(SELECT resolution_evidence FROM emergent_vehicle_clusters WHERE id=cluster_id);
 again:=pg_temp.call(e);
 PERFORM pg_temp.ok('exact replay returns same admitted row',again=first_id AND (SELECT count(*) FROM image_observations)=1);
 again:=pg_temp.call(e,'mustang detail');
 PERFORM pg_temp.ok('another source member links same cluster',(SELECT o.cluster_id FROM image_observations o WHERE id=again)=cluster_id);
 again:=pg_temp.call(e,'porsche','porsche');
 PERFORM pg_temp.ok('mixed day distinct subject stays distinct',(SELECT o.cluster_id FROM image_observations o WHERE id=again)<>cluster_id);
 revised:=pg_temp.call(jsonb_set(e,'{model}','"revised-model"'));
 PERFORM pg_temp.ok('changed evidence supersedes rather than short-circuit replay',revised<>first_id
   AND EXISTS(SELECT 1 FROM image_observations WHERE id=first_id AND NOT is_active AND superseded_by=revised));
 PERFORM pg_temp.ok('initial cluster testimony is immutable',(SELECT resolution_evidence FROM emergent_vehicle_clusters WHERE id=cluster_id)=initial);
 -- Layer/method revision must not silently return an existing ID either.
 again:=public.ingest_image_observation(pg_temp.u('mustang'),NULL,'subject',0.9,'visual_subjects_v1','fixture-v1',
   pg_temp.wrapper(jsonb_set(e,'{model}','"revised-model"')),NULL,'{"grouping":"revised-layer"}');
 PERFORM pg_temp.ok('changed layer supersedes',again<>revised AND (SELECT superseded_by FROM image_observations WHERE id=revised)=again);
 again:=pg_temp.call(jsonb_set(e,'{run_key}','"next-capture-run"'));
 PERFORM pg_temp.ok('new capture run continues same subject cluster',(SELECT o.cluster_id FROM image_observations o WHERE id=again)=cluster_id
   AND (SELECT resolution_evidence FROM emergent_vehicle_clusters WHERE id=cluster_id)=initial);
END $$;

SELECT pg_temp.refuses('other car cannot inherit session membership',pg_temp.envelope(),'corvette');
SELECT pg_temp.refuses('nonmember part stays unresolved',pg_temp.envelope(),'near identical');
SELECT pg_temp.refuses('account cannot cite another account source',jsonb_set(pg_temp.envelope(),'{user_id}',to_jsonb(pg_temp.u('another account')::text)));
-- Change the selected member's actual input receipt, independent of JSON input order.
DO $$ DECLARE e jsonb:=pg_temp.envelope(); n int; BEGIN
 SELECT ord-1 INTO n FROM jsonb_array_elements(e->'inputs') WITH ORDINALITY i(value,ord) WHERE value->>'image_id'=pg_temp.u('mustang')::text;
 PERFORM pg_temp.refuses('thumbnail does not qualify source bytes',jsonb_set(e,ARRAY['inputs',n::text,'representation'],'"derivative"'));
 PERFORM pg_temp.refuses('unqualified bytes refuse',jsonb_set(e,ARRAY['inputs',n::text,'source_qualified'],'false'));
 PERFORM pg_temp.refuses('string true is not a qualified byte flag',jsonb_set(e,ARRAY['inputs',n::text,'source_qualified'],'"true"'));
 PERFORM pg_temp.refuses('wrong byte hash refuses',jsonb_set(e,ARRAY['inputs',n::text,'input_sha256'],to_jsonb(repeat('0',64))));
 PERFORM pg_temp.refuses('microsecond source clock mismatch refuses',jsonb_set(e,ARRAY['inputs',n::text,'created_at'],'"2026-10-16T13:24:47.657548Z"'));
 PERFORM pg_temp.refuses('infinite reading clock refuses',jsonb_set(e,'{read_at}','"infinity"'));
 PERFORM pg_temp.refuses('time and location alone are not a correspondence',jsonb_set(e,'{subjects,0,correspondences,0,features}',
   '[{"kind":"sequence","left_witness":"same time","right_witness":"same time"},{"kind":"background","left_witness":"same shop","right_witness":"same shop"}]'));
 PERFORM pg_temp.refuses('generic part cannot anchor a subject',jsonb_set(e,
   ARRAY['frames',(SELECT (ord-1)::text FROM jsonb_array_elements(e->'frames') WITH ORDINALITY f(value,ord) WHERE value->>'image_id'=pg_temp.u('mustang')::text),'view'],'"detail"'));
 PERFORM pg_temp.refuses('unconnected photos cannot become one subject',jsonb_set(e,'{subjects,0,correspondences}','[]'));
 PERFORM pg_temp.refuses('retained internal contradiction blocks subject',jsonb_set(e,'{contradictions}',jsonb_build_array(jsonb_build_object(
   'left_image_id',pg_temp.u('mustang'),'right_image_id',pg_temp.u('mustang detail'),'reason','incompatible body structures'))));
 PERFORM pg_temp.refuses('same source cannot be two primary cars',jsonb_set(e,'{subjects,1,member_image_ids}',jsonb_build_array(pg_temp.u('porsche'),pg_temp.u('mustang'))));
 PERFORM pg_temp.refuses('duplicate member ids refuse',jsonb_set(e,'{subjects,0,member_image_ids}',jsonb_build_array(pg_temp.u('mustang'),pg_temp.u('mustang'))));
 -- Even a producer revision cannot arbitrarily bridge two retained subjects.
 e:=jsonb_set(e,'{subjects,0,member_image_ids}',jsonb_build_array(pg_temp.u('mustang'),pg_temp.u('mustang detail'),pg_temp.u('porsche')));
 e:=jsonb_set(e,'{subjects}',jsonb_build_array(e #> '{subjects,0}'));
 PERFORM pg_temp.refuses('existing distinct clusters cannot be bridged without correction',e);
END $$;

DO $$ DECLARE e jsonb:=pg_temp.normalized(pg_temp.envelope()); n int; obs uuid; BEGIN
 SELECT ord-1 INTO n FROM jsonb_array_elements(e->'inputs') WITH ORDINALITY i(value,ord) WHERE value->>'image_id'=pg_temp.u('mustang')::text;
 obs:=pg_temp.call(e);
 PERFORM pg_temp.ok('content-addressed verified HEIC to JPEG normalization qualifies',
   EXISTS(SELECT 1 FROM image_observations WHERE id=obs AND is_active AND vehicle_id IS NULL));
 PERFORM pg_temp.refuses('arbitrary derivative cannot claim normalization',jsonb_set(e,ARRAY['inputs',n::text,'derivation_qualified'],'false'));
 PERFORM pg_temp.refuses('external origin cannot claim trusted normalization',jsonb_set(e,ARRAY['inputs',n::text,'derivation','trusted_origin'],'"https://example.test"'));
 PERFORM pg_temp.refuses('crop cannot replace contain normalization',jsonb_set(e,ARRAY['inputs',n::text,'derivation','parameters','resize'],'"cover"'));
 PERFORM pg_temp.refuses('different source object cannot qualify',jsonb_set(e,ARRAY['inputs',n::text,'derivation','source_object_path'],'"vehicle-photos/other.HEIC"'));
 PERFORM pg_temp.refuses('different rendered input bytes cannot qualify',jsonb_set(e,ARRAY['inputs',n::text,'derivation','input_sha256'],to_jsonb(repeat('d',64))));
 PERFORM pg_temp.refuses('unrecorded URL parameters cannot qualify',jsonb_set(e,ARRAY['inputs',n::text,'input_url'],'"https://qkgaybvrernstplzjaam.supabase.co/storage/v1/render/image/public/other?resize=cover"'));
END $$;

DO $$ DECLARE e jsonb:=pg_temp.envelope(); first_id uuid; withdrawn uuid; again uuid; BEGIN
 -- A stale replay is requalified before looking up an existing result.
 UPDATE vehicle_images SET vision_gate_status='rejected_personal' WHERE id=pg_temp.u('mustang detail');
 PERFORM pg_temp.refuses('withdrawn supporting member blocks the whole subject replay',e);
 withdrawn:=pg_temp.call(e,'mustang','mustang','withdrawn');
 PERFORM pg_temp.ok('explicit withdrawal remains inactive superseding testimony',
   EXISTS(SELECT 1 FROM image_observations WHERE id=withdrawn AND NOT is_active AND confidence_basis #>> '{visual_subjects_v1,withdrawal_reason}'='later source withdrawal')
   AND NOT EXISTS(SELECT 1 FROM image_observations WHERE image_id=pg_temp.u('mustang') AND observed_by='visual_subjects_v1' AND is_active));
 again:=pg_temp.call(e,'mustang','mustang','withdrawn');
 PERFORM pg_temp.ok('withdrawal replay is idempotent',again=withdrawn);
 UPDATE vehicle_images SET vision_gate_status='approved' WHERE id=pg_temp.u('mustang detail');
 PERFORM pg_temp.refuses('approved pixels alone cannot revive an explicitly withdrawn interpretation',e);
 PERFORM pg_temp.refuses('old paid receipt cannot restore a withdrawn anchor through another member',e,'mustang detail');
 e:=e||jsonb_build_object('read_at',clock_timestamp(),'run_key','post-withdrawal-reading','model','post-withdrawal-model');
 first_id:=pg_temp.call(e);
 PERFORM pg_temp.ok('later qualified interpretation supersedes withdrawal',first_id<>withdrawn
   AND (SELECT superseded_by FROM image_observations WHERE id=withdrawn)=first_id AND (SELECT is_active FROM image_observations WHERE id=first_id));
 PERFORM pg_temp.refuses('superseded withdrawal still prevents replaying its earlier paid interpretation',pg_temp.envelope());
 UPDATE vehicle_images SET is_superseded=true WHERE id=pg_temp.u('mustang detail');
 PERFORM pg_temp.refuses('superseded supporting source blocks replay',e);
 UPDATE vehicle_images SET is_superseded=false,is_duplicate=true WHERE id=pg_temp.u('mustang detail');
 PERFORM pg_temp.refuses('duplicate supporting source blocks replay',e);
 UPDATE vehicle_images SET is_duplicate=false WHERE id=pg_temp.u('mustang detail');
 UPDATE vehicle_images SET vision_gate_status='pending' WHERE id=pg_temp.u('mustang detail');
 PERFORM pg_temp.refuses('pending supporting source blocks replay',e);
 UPDATE vehicle_images SET vision_gate_status='review_needed' WHERE id=pg_temp.u('mustang detail');
 PERFORM pg_temp.refuses('review-needed supporting source blocks replay',e);
 UPDATE vehicle_images SET vision_gate_status='approved',is_document=true WHERE id=pg_temp.u('mustang detail');
 PERFORM pg_temp.refuses('document supporting source blocks replay',e);
 UPDATE vehicle_images SET is_document=false,is_sensitive=true WHERE id=pg_temp.u('mustang detail');
 PERFORM pg_temp.refuses('sensitive supporting source blocks replay',e);
 UPDATE vehicle_images SET is_sensitive=false WHERE id=pg_temp.u('mustang detail');
 UPDATE emergent_vehicle_clusters SET resolved_to_vehicle_id=pg_temp.u('contaminated prior attachment') WHERE id=(SELECT cluster_id FROM image_observations WHERE id=first_id);
 PERFORM pg_temp.refuses('resolved cluster cannot be overwritten',e);
END $$;

DO $$ DECLARE e jsonb:=pg_temp.reading_envelope(); alternate jsonb; first_id uuid; second_id uuid; revised uuid; withdrawn uuid; other_context uuid; before_clusters int; n int; bad boolean; BEGIN
 SELECT count(*) INTO before_clusters FROM emergent_vehicle_clusters;
 first_id:=pg_temp.reading(e);
 second_id:=pg_temp.reading(e,'near identical');
 PERFORM pg_temp.ok('complete all-unknown analysis is retained without a physical cluster',
   (SELECT count(*) FROM emergent_vehicle_clusters)=before_clusters
   AND EXISTS(SELECT 1 FROM image_observations WHERE id=first_id AND is_active AND vehicle_id IS NULL AND cluster_id IS NULL
     AND role='part' AND NOT is_high_confidence_subject AND confidence_basis #> '{visual_subject_reading_v1,envelope,subjects}'='[]'::jsonb)
   AND EXISTS(SELECT 1 FROM image_observations WHERE id=second_id AND is_active AND vehicle_id IS NULL AND cluster_id IS NULL));
 PERFORM pg_temp.ok('all-unknown exact replay does not duplicate paid interpretation',pg_temp.reading(e)=first_id);
 alternate:=e||jsonb_build_object('inputs',(SELECT jsonb_agg(i) FROM jsonb_array_elements(pg_temp.envelope()->'inputs') i
      WHERE i->>'image_id' IN(pg_temp.u('corvette')::text,pg_temp.u('porsche')::text)),
      'unresolved',jsonb_build_array(jsonb_build_object('image_id',pg_temp.u('corvette'),'reason','needs_corresponding_view'),
        jsonb_build_object('image_id',pg_temp.u('porsche'),'reason','primary_subject_unqualified')));
 other_context:=pg_temp.reading(alternate);
 PERFORM pg_temp.ok('different peer context preserves both paid interpretations',other_context<>first_id
   AND (SELECT is_active FROM image_observations WHERE id=first_id)
   AND (SELECT is_active FROM image_observations WHERE id=other_context));
 PERFORM pg_temp.ok('first exact context remains reusable after a different peer context',pg_temp.reading(e)=first_id);
 revised:=pg_temp.reading(jsonb_set(e,'{model}','"revised-model"'));
 PERFORM pg_temp.ok('unknown interpretation revision supersedes and preserves original',revised<>first_id
   AND (SELECT superseded_by FROM image_observations WHERE id=first_id)=revised AND NOT (SELECT is_active FROM image_observations WHERE id=first_id));
 PERFORM pg_temp.ok('same-context revision leaves different context active',(SELECT is_active FROM image_observations WHERE id=other_context));
 SELECT ord-1 INTO n FROM jsonb_array_elements(e->'inputs') WITH ORDINALITY i(value,ord) WHERE value->>'image_id'=pg_temp.u('corvette')::text;
 PERFORM pg_temp.refuses_reading('unknown analysis still requires qualified bytes',jsonb_set(e,ARRAY['inputs',n::text,'source_qualified'],'false'));
 PERFORM pg_temp.refuses_reading('unknown analysis still requires exact source clocks',jsonb_set(e,ARRAY['inputs',n::text,'created_at'],'"2026-10-16T13:24:47.657548Z"'));
 PERFORM pg_temp.refuses_reading('unknown analysis cannot cite another account',jsonb_set(e,'{user_id}',to_jsonb(pg_temp.u('another')::text)));
 PERFORM pg_temp.refuses_reading('unknown analysis cannot exceed three inputs',pg_temp.envelope()||jsonb_build_object('unresolved','[]'::jsonb));
 PERFORM pg_temp.refuses_reading('unknown analysis cannot consume one input',jsonb_set(e,'{inputs}',jsonb_build_array(e #> '{inputs,0}')));
 bad:=false;
 BEGIN PERFORM public.ingest_image_observation(pg_temp.u('corvette'),NULL,'part',0.5,'wrong-producer','visual_subject_reading_v1',
   jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',e)),NULL,'{}'); EXCEPTION WHEN OTHERS THEN bad:=true; END;
 PERFORM pg_temp.ok('unknown receipt requires its protected producer',bad);
 bad:=false;
 BEGIN PERFORM public.ingest_image_observation(pg_temp.u('corvette'),NULL,'part',0.5,'visual_subject_reading_v1','wrong-version',
   jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',e)),NULL,'{}'); EXCEPTION WHEN OTHERS THEN bad:=true; END;
 PERFORM pg_temp.ok('unknown receipt requires its protected version',bad);
 bad:=false;
 BEGIN PERFORM public.ingest_image_observation(pg_temp.u('corvette'),NULL,'subject',0.9,'visual_subject_reading_v1','visual_subject_reading_v1',
   jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',e)),NULL,'{}'); EXCEPTION WHEN OTHERS THEN bad:=true; END;
 PERFORM pg_temp.ok('unknown receipt cannot claim physical subject role',bad);
 bad:=false;
 BEGIN PERFORM public.ingest_image_observation(pg_temp.u('corvette'),NULL,'part',0.5,'visual_subject_reading_v1','visual_subject_reading_v1',
   jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',e,'input_key','forged')),NULL,'{}'); EXCEPTION WHEN OTHERS THEN bad:=true; END;
 PERFORM pg_temp.ok('caller cannot forge exact input context key',bad);
 -- A reading can coexist with the supported subject producer without replacing
 -- its attribution hypothesis or minting a second cluster.
 e:=pg_temp.envelope()||jsonb_build_object('inputs',(SELECT jsonb_agg(i) FROM jsonb_array_elements(pg_temp.envelope()->'inputs') i
       WHERE i->>'image_id' IN(pg_temp.u('porsche')::text,pg_temp.u('porsche detail')::text)),'unresolved','[]'::jsonb);
 revised:=pg_temp.reading(e,'porsche');
 PERFORM pg_temp.ok('reading-only family cannot supersede supported cluster family',
   EXISTS(SELECT 1 FROM image_observations WHERE image_id=pg_temp.u('porsche') AND observed_by='visual_subjects_v1' AND is_active AND cluster_id IS NOT NULL)
   AND EXISTS(SELECT 1 FROM image_observations WHERE id=revised AND observed_by='visual_subject_reading_v1' AND is_active AND cluster_id IS NULL)
   AND (SELECT count(*) FROM emergent_vehicle_clusters)=before_clusters);
 e:=pg_temp.reading_envelope();
 UPDATE vehicle_images SET vision_gate_status='review_needed' WHERE id=pg_temp.u('near identical');
 PERFORM pg_temp.refuses_reading('supporting source withdrawal blocks unknown replay',e);
 withdrawn:=pg_temp.reading(e,'corvette','withdrawn');
 PERFORM pg_temp.ok('unknown withdrawal records inactive supersession',NOT (SELECT is_active FROM image_observations WHERE id=withdrawn)
   AND (SELECT superseded_by FROM image_observations WHERE id=first_id) IS NOT NULL);
 PERFORM pg_temp.ok('unknown withdrawal replay is idempotent',pg_temp.reading(e,'corvette','withdrawn')=withdrawn);
 UPDATE vehicle_images SET vision_gate_status='approved' WHERE id=pg_temp.u('near identical');
END $$;

-- Existing nonvisual calls retain their entry point; the evidence-aware replay
-- also fixes their earlier failure to record changed receipts/layers.
DO $$ DECLARE a uuid;b uuid; BEGIN
 a:=public.ingest_image_observation(pg_temp.u('corvette'),NULL,'part',0.6,'legacy-reader','v1','{"read":"first"}',NULL,'{}');
 b:=public.ingest_image_observation(pg_temp.u('corvette'),NULL,'part',0.6,'legacy-reader','v1','{"read":"second"}',NULL,'{}');
 PERFORM pg_temp.ok('legacy callers retain signature and get evidence-sensitive supersession',a<>b AND (SELECT superseded_by FROM image_observations WHERE id=a)=b);
END $$;
SELECT pg_temp.ok('no end-user execute grants added',
 NOT has_function_privilege('anon','public.ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb)','EXECUTE')
 AND has_function_privilege('service_role','public.ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb)','EXECUTE'));
SELECT pg_temp.ok('cluster and image-observation privacy policies remain absent',
 NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('emergent_vehicle_clusters','image_observations'))
 AND (SELECT relrowsecurity FROM pg_class WHERE oid='emergent_vehicle_clusters'::regclass)
 AND (SELECT relrowsecurity FROM pg_class WHERE oid='image_observations'::regclass));
RESET ROLE;
