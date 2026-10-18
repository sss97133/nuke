-- Standalone PG17 fixture; run only in an EMPTY disposable local database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'This fixture requires an empty disposable local database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true),'')::uuid $$;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, is_public boolean, user_id uuid, owner_id uuid, uploaded_by uuid,
  color text, color_source text, color_confidence numeric, color_source_image_id text
);
CREATE TABLE public.vehicle_field_provenance (
  vehicle_id uuid, field_name text, primary_source text, total_confidence numeric
);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, vehicle_id uuid, image_url text, is_sensitive boolean,
  is_superseded boolean, is_duplicate boolean, vision_gate_status text,
  image_vehicle_match_status text
);
CREATE TABLE public.observation_sources (id uuid, slug text, base_trust_score numeric);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, vehicle_id uuid, source_id uuid, structured_data jsonb,
  is_superseded boolean, content_text text, confidence_score numeric, observed_at timestamptz,
  ingested_at timestamptz, kind text, source_url text, extraction_method text,
  agent_model text, extraction_metadata jsonb, submitted_by_user_id uuid
);
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.observation_witnesses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL REFERENCES public.vehicle_observations(id) ON DELETE CASCADE,
 image_id uuid NOT NULL, witness_role text NOT NULL CHECK(witness_role IN ('primary','context','supersession','derived')),
 capture_method text NOT NULL CHECK(capture_method IN ('live_streaming','photo_with_exif','photo_no_exif','composite','unknown')),
 image_timestamp timestamptz, attestation_notes text,
 added_by_user_id uuid REFERENCES auth.users(id), added_by_agent_key text, added_at timestamptz NOT NULL DEFAULT now(),
 CHECK(added_by_user_id IS NOT NULL OR added_by_agent_key IS NOT NULL),
 UNIQUE(observation_id,image_id,witness_role)
);
ALTER TABLE public.observation_witnesses ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.pipeline_registry (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text, column_name text, owned_by text,
 description text, do_not_write_directly boolean, write_via text, UNIQUE(table_name,column_name)
);
CREATE TABLE public.vehicle_field_sources (
  vehicle_id uuid, field_name text, field_value text, source_type text,
  confidence_score integer, is_verified boolean, ai_reasoning text,
  source_image_id uuid, created_at timestamptz
);
CREATE TABLE public.field_evidence (
  vehicle_id uuid, field_name text, proposed_value text, source_type text,
  source_confidence integer, status text, extraction_context text,
  raw_extraction_data jsonb, created_at timestamptz
);

INSERT INTO public.vehicles VALUES
 ('11111111-1111-1111-1111-111111111111', true, NULL, NULL, NULL, 'Silver Pearl', 'listing', .7, 'bad-uuid'),
 ('22222222-2222-2222-2222-222222222222', false, NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'Black', NULL, NULL, NULL);
INSERT INTO public.observation_sources VALUES ('33333333-3333-3333-3333-333333333333', 'agent-submission', .5);
INSERT INTO public.vehicle_images
SELECT ('44444444-4444-4444-4444-'||lpad(n::text,12,'0'))::uuid,
       CASE WHEN n=3 THEN '22222222-2222-2222-2222-222222222222'::uuid ELSE '11111111-1111-1111-1111-111111111111'::uuid END,
       'https://images.example/'||n||'.jpg', n=4, n=6, n=5,
       CASE n WHEN 1 THEN 'approved' WHEN 9 THEN 'pending' WHEN 10 THEN 'review_needed'
         WHEN 11 THEN 'rejected_personal' ELSE NULL END,
       CASE n WHEN 7 THEN 'mismatch' WHEN 8 THEN 'unrelated' ELSE NULL END
FROM generate_series(1,11) n;
INSERT INTO public.vehicle_observations
SELECT ('55555555-5555-5555-5555-'||lpad(n::text,12,'0'))::uuid,
       '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
       jsonb_build_object('color','Silver Pearl','image_id','44444444-4444-4444-4444-'||lpad(n::text,12,'0'),
         'claim_role','corroboration','image_region',jsonb_build_object('label','bodywork'),
         'visual_relation','supports','is_inferred',true,
         'source_family','fixture-listing-event',
         'reference',jsonb_build_object('url','https://example.org/catalog.pdf','page_number',12)),
       false, 'Visible silver finish; factory paint name requires corroboration', .5,
       '2026-10-02T20:00:00Z', '2026-10-02T20:01:00Z', 'spec', 'https://images.example/'||n||'.jpg',
       'visual-review', 'fixture-model', '{"limitation":"Appearance does not establish original paint"}', NULL
FROM generate_series(1,11) n;
-- Missing/malformed JSON IDs never raise casts or masquerade as joined photos.
INSERT INTO public.vehicle_observations (id,vehicle_id,structured_data,observed_at,ingested_at,kind)
VALUES
 ('55555555-5555-5555-5555-000000000012','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl","image_id":"invalid"}',now(),now(),'spec'),
 ('55555555-5555-5555-5555-000000000013','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl","image_id":null}',now(),now(),'spec'),
 ('55555555-5555-5555-5555-000000000014','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl","image_id":{"x":1}}',now(),now(),'spec'),
 ('55555555-5555-5555-5555-000000000015','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl"}',now(),now(),'spec'),
 ('55555555-5555-5555-5555-000000000016','11111111-1111-1111-1111-111111111111','{"transmission":"manual","image_id":"44444444-4444-4444-4444-000000000001"}',now(),now(),'spec');
INSERT INTO public.vehicle_observations (id,vehicle_id,structured_data,is_superseded)
VALUES ('55555555-5555-5555-5555-000000000017','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl","image_id":"44444444-4444-4444-4444-000000000001"}',true);
INSERT INTO public.field_evidence VALUES
 ('11111111-1111-1111-1111-111111111111','color','Silver Pearl','photo',90,'accepted','Valid cited photo','{"photo_id":"44444444-4444-4444-4444-000000000001"}',now()),
 ('11111111-1111-1111-1111-111111111111','color','Wrong','photo',99,'rejected','Rejected testimony','{"photo_id":"invalid"}',now()),
 ('11111111-1111-1111-1111-111111111111','color','Old','photo',98,'superseded','Superseded testimony','{"photo_id":"44444444-4444-4444-4444-000000000001"}',now());
INSERT INTO public.vehicle_field_sources VALUES
 ('11111111-1111-1111-1111-111111111111','color','Silver','photo',50,false,'Sensitive pointer must be masked','44444444-4444-4444-4444-000000000004',now());

-- A pre-existing orphan is retained; NOT VALID must not scan/rewrite it.
INSERT INTO public.observation_witnesses (observation_id,image_id,witness_role,capture_method,added_by_agent_key)
VALUES ('55555555-5555-5555-5555-000000000015','99999999-9999-9999-9999-999999999999','primary','unknown','fixture-history');
\ir ../migrations/20261002213353_enforce_atomic_image_witnesses.sql

DO $$ DECLARE p jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','color');
 ASSERT p ?& ARRAY['field','vehicle_id','value','inline_source','inline_confidence','source_image_url','evidence','observations','image_observations'];
 ASSERT jsonb_array_length(p->'image_observations')=2, 'Only approved/null same-vehicle visible images are cited';
 ASSERT jsonb_array_length(p->'observations')=3, 'Legacy listing observation retained, blocked image citations withheld';
 ASSERT jsonb_array_length(p->'evidence')=2, 'Rejected/superseded field evidence withheld';
 ASSERT p->>'source_image_url'='https://images.example/1.jpg', 'Malformed inline UUID safely falls back to valid joined photo';
 ASSERT (p->'image_observations'->0->>'observed_at')::timestamptz='2026-10-02T20:00:00Z'::timestamptz;
 ASSERT (p->'image_observations'->0->>'ingested_at')::timestamptz='2026-10-02T20:01:00Z'::timestamptz;
 ASSERT p->'image_observations'->0->>'extraction_method'='visual-review';
 ASSERT p->'image_observations'->0->>'agent_model'='fixture-model';
 ASSERT p->'image_observations'->0->>'limitation'='Appearance does not establish original paint';
 ASSERT p->'image_observations'->0->'image_region'->>'label'='bodywork';
 ASSERT p->'image_observations'->0->'is_inferred'='true'::jsonb;
 ASSERT p->'image_observations'->0->'reference'->>'url'='https://example.org/catalog.pdf';
 ASSERT p->'image_observations'->0->'reference'->>'page_number'='12';
 ASSERT p->'image_observations'->0->>'source_family'='fixture-listing-event';
 ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'evidence') e
   WHERE e->>'source'='vehicle_field_sources' AND e->>'image_id' IS NOT NULL), 'Hidden image IDs never re-enter legacy evidence';
 ASSERT public.get_field_provenance('22222222-2222-2222-2222-222222222222','color') IS NULL, 'Private vehicle denied to anon';
 PERFORM set_config('test.auth_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
 ASSERT public.get_field_provenance('22222222-2222-2222-2222-222222222222','color')->>'value'='Black', 'Owner gate preserved';
 RAISE NOTICE 'PASS: image citations, visibility, malformed IDs, legacy compatibility, clocks and owner gate';
END $$;


-- New arrivals use the same database insert performed by sanctioned intake.
CREATE FUNCTION public.fixture_arrival(data jsonb, vehicle uuid DEFAULT '11111111-1111-1111-1111-111111111111',
 source uuid DEFAULT '33333333-3333-3333-3333-333333333333', actor uuid DEFAULT NULL, kind text DEFAULT 'spec')
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE observation uuid := gen_random_uuid(); BEGIN
 INSERT INTO public.vehicle_observations (id,vehicle_id,source_id,structured_data,submitted_by_user_id,kind,
 source_url,observed_at,ingested_at,extraction_method,agent_model,confidence_score)
 VALUES(observation,vehicle,source,data,actor,kind,'https://listing.example/vehicle','2026-10-02 20:00Z','2026-10-02 20:01Z','fixture-review',NULL,.5);
 RETURN observation;
END $$;

DO $$ DECLARE o uuid; w public.observation_witnesses; data jsonb; caught boolean;
 before_count bigint; p jsonb; BEGIN
 ASSERT (SELECT count(*) FROM pg_attribute WHERE attrelid='public.observation_witnesses'::regclass AND attnum>0 AND NOT attisdropped AND col_description(attrelid,attnum) IS NOT NULL)=10, 'All witness columns described';
 ASSERT (SELECT owned_by FROM public.pipeline_registry WHERE table_name='observation_witnesses' AND column_name='image_id')='project_observation_image_witness';
 ASSERT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='observation_witnesses_image_id_fkey' AND NOT convalidated), 'Image FK is NOT VALID';
 ASSERT EXISTS(SELECT 1 FROM public.observation_witnesses WHERE added_by_agent_key='fixture-history'), 'Old orphan preserved';
 BEGIN
  INSERT INTO public.observation_witnesses(observation_id,image_id,witness_role,capture_method,added_by_agent_key)
  VALUES('55555555-5555-5555-5555-000000000015','99999999-9999-9999-9999-999999999998','derived','unknown','fixture');
  RAISE EXCEPTION 'Expected new image FK rejection';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;

 o := public.fixture_arrival('{"color":"Silver","image_id":"44444444-4444-4444-4444-000000000001","claim_role":"observed_appearance","visual_relation":"direct_visual"}');
 SELECT * INTO STRICT w FROM public.observation_witnesses WHERE observation_id=o;
 ASSERT w.witness_role='derived' AND w.capture_method='unknown' AND w.image_timestamp IS NULL;
 ASSERT w.added_by_user_id IS NULL AND w.added_by_agent_key='db:project_observation_image_witness:v1';
 ASSERT w.added_at IS NOT NULL;
 ASSERT (SELECT source_url='https://listing.example/vehicle' AND agent_model IS NULL FROM public.vehicle_observations WHERE id=o);
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','color');
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'image_observations') e WHERE e->>'observation_id'=o::text AND e->>'witness_id'=w.id::text AND e->>'witness_role'='derived' AND e->>'source_url'='https://listing.example/vehicle');

 INSERT INTO auth.users VALUES('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
 o := public.fixture_arrival('{"color":"Silver","image_id":"44444444-4444-4444-4444-000000000002"}',actor=>'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
 SELECT * INTO STRICT w FROM public.observation_witnesses WHERE observation_id=o;
 ASSERT w.added_by_user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND w.added_by_agent_key IS NULL;

 SELECT count(*) INTO before_count FROM public.vehicle_observations;
 FOR data IN SELECT value FROM jsonb_array_elements('[{"image_id":"invalid"},{"image_id":""},{"image_id":"   "},{"image_id":123},{"image_id":{}},{"image_id":[]},{"image_id":true},{"image_id":"99999999-9999-9999-9999-999999999999"},{"image_id":"44444444-4444-4444-4444-000000000003"}]') LOOP
  caught := false;
  BEGIN PERFORM public.fixture_arrival(data); EXCEPTION WHEN check_violation OR foreign_key_violation THEN caught:=true; END;
  ASSERT caught, 'Malformed/orphan/cross-vehicle image reference must fail closed';
 END LOOP;
 ASSERT (SELECT count(*) FROM public.vehicle_observations)=before_count, 'Invalid image reference rolls back entire observation';
 BEGIN
  PERFORM public.fixture_arrival('{"image_id":"44444444-4444-4444-4444-000000000001"}',vehicle=>NULL);
  RAISE EXCEPTION 'Expected null observation vehicle rejection';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.vehicle_images SET vehicle_id=NULL WHERE id='44444444-4444-4444-4444-000000000011';
 BEGIN
  PERFORM public.fixture_arrival('{"image_id":"44444444-4444-4444-4444-000000000011"}');
  RAISE EXCEPTION 'Expected null image vehicle rejection';
 EXCEPTION WHEN check_violation THEN NULL; END;
 FOR data IN SELECT value FROM jsonb_array_elements('[{}, {"image_id":null}, {"image_id":"unknown"}]') LOOP
  o:=public.fixture_arrival(data);
  ASSERT NOT EXISTS(SELECT 1 FROM public.observation_witnesses WHERE observation_id=o), 'Unknown image stays unlinked';
 END LOOP;
 INSERT INTO public.observation_sources VALUES ('77777777-7777-7777-7777-777777777777','shop',.5);
 o:=public.fixture_arrival('{"color":"Silver","kind_detail":"professional_review","image_id":"44444444-4444-4444-4444-000000000001"}',source=>'77777777-7777-7777-7777-777777777777',kind=>'comment');
 ASSERT NOT EXISTS(SELECT 1 FROM public.observation_witnesses WHERE observation_id=o), 'Legacy anonymous share path cannot acquire derived witness';
 o:=public.fixture_arrival('{"color":"Silver","image_id":"44444444-4444-4444-4444-000000000001"}',source=>'77777777-7777-7777-7777-777777777777',kind=>'spec');
 ASSERT EXISTS(SELECT 1 FROM public.observation_witnesses WHERE observation_id=o), 'Ordinary shop-source observations remain eligible';
 -- Even malformed extra image JSON on this exact legacy path is outside projection.
 o:=public.fixture_arrival('{"kind_detail":"professional_review","image_id":{}}',source=>'77777777-7777-7777-7777-777777777777',kind=>'comment');
 ASSERT NOT EXISTS(SELECT 1 FROM public.observation_witnesses WHERE observation_id=o);
 RAISE NOTICE 'PASS: FK boundary, no historical rewrite, strict UUID/same-vehicle checks, actual attribution, null clocks, share exclusion, atomic failed arrival';
END $$;

-- Replay projection twice for one insert, simulating duplicate writer receipt work.
CREATE TRIGGER fixture_repeat_projection AFTER INSERT ON public.vehicle_observations
FOR EACH ROW WHEN (NEW.structured_data ? 'image_id') EXECUTE FUNCTION public.project_observation_image_witness();
DO $$ DECLARE o uuid; BEGIN
 o:=public.fixture_arrival('{"color":"Silver","image_id":"44444444-4444-4444-4444-000000000001"}');
 ASSERT (SELECT count(*) FROM public.observation_witnesses WHERE observation_id=o)=1, 'Projection replay is idempotent';
 INSERT INTO public.vehicle_observations SELECT * FROM public.vehicle_observations WHERE id=o ON CONFLICT(id) DO NOTHING;
 ASSERT (SELECT count(*) FROM public.observation_witnesses WHERE observation_id=o)=1;
END $$;
DROP TRIGGER fixture_repeat_projection ON public.vehicle_observations;

-- A failed witness append must fail the parent observation, never report success.
ALTER TABLE public.observation_witnesses ADD CONSTRAINT fixture_reject_projection CHECK(witness_role<>'derived') NOT VALID;
DO $$ DECLARE before_count bigint; BEGIN
 SELECT count(*) INTO before_count FROM public.vehicle_observations;
 BEGIN
  PERFORM public.fixture_arrival('{"image_id":"44444444-4444-4444-4444-000000000001"}');
  RAISE EXCEPTION 'Expected witness persistence rejection';
 EXCEPTION WHEN check_violation THEN NULL; END;
 ASSERT (SELECT count(*) FROM public.vehicle_observations)=before_count, 'Witness failure rolls back testimony';
END $$;
ALTER TABLE public.observation_witnesses DROP CONSTRAINT fixture_reject_projection;

DO $$ DECLARE o uuid; p jsonb; image uuid; BEGIN
 -- Typed edges dominate JSON fallback, retain all distinct same-vehicle edges.
 o:=public.fixture_arrival('{"color":"typed","image_id":"44444444-4444-4444-4444-000000000001"}');
 INSERT INTO public.observation_witnesses(observation_id,image_id,witness_role,capture_method,added_by_agent_key)
 VALUES(o,'44444444-4444-4444-4444-000000000002','derived','unknown','fixture');
 p:=public.get_field_provenance('11111111-1111-1111-1111-111111111111','color');
 ASSERT (SELECT count(*) FROM jsonb_array_elements(p->'image_observations') e WHERE e->>'observation_id'=o::text)=2;
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'image_observations') e WHERE e->>'observation_id'=o::text AND e->>'witness_id' IS NULL);
 UPDATE public.observation_witnesses SET image_id='44444444-4444-4444-4444-000000000004' WHERE observation_id=o AND image_id='44444444-4444-4444-4444-000000000001';
 UPDATE public.vehicle_images SET vehicle_id='22222222-2222-2222-2222-222222222222' WHERE id='44444444-4444-4444-4444-000000000002';
 p:=public.get_field_provenance('11111111-1111-1111-1111-111111111111','color');
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'image_observations') e WHERE e->>'observation_id'=o::text), 'Hidden typed edges and reassignment cannot reopen JSON fallback';
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'observations') e WHERE e->>'id'=o::text);
 -- Every denial applies equally to typed arrivals and compatibility JSON reads.
 FOREACH image IN ARRAY ARRAY['44444444-4444-4444-4444-000000000004'::uuid,'44444444-4444-4444-4444-000000000005','44444444-4444-4444-4444-000000000006','44444444-4444-4444-4444-000000000007','44444444-4444-4444-4444-000000000008','44444444-4444-4444-4444-000000000009','44444444-4444-4444-4444-000000000010'] LOOP
  o:=public.fixture_arrival(jsonb_build_object('color','hidden','image_id',image));
  p:=public.get_field_provenance('11111111-1111-1111-1111-111111111111','color');
  ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'image_observations') e WHERE e->>'observation_id'=o::text), 'Typed bridge never bypasses gallery privacy';
 END LOOP;
 RAISE NOTICE 'PASS: idempotent replay, durable-witness atomic rollback, typed precedence, all visible witnesses, reassignment and privacy denial';
END $$;
ROLLBACK;
