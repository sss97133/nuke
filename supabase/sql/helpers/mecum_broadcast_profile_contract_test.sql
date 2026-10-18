-- LOCAL SYNTHETIC PG17 ONLY. Base harness enforces throwaway DB name and creates live-shape fixtures.
\ir mecum_broadcast_evidence_contract_test.sql
CREATE TABLE public.organizations(id uuid PRIMARY KEY,business_name text,slug text,is_public boolean);
INSERT INTO organizations VALUES('00000000-0000-0000-0000-000000000050','Synthetic Mecum','synthetic-mecum',true),
  ('00000000-0000-0000-0000-000000000051','Private test org','private-test',false);
ALTER TABLE publications ADD COLUMN organization_id uuid REFERENCES organizations(id);
UPDATE publications SET organization_id='00000000-0000-0000-0000-000000000050';
ALTER TABLE vehicle_observations ADD COLUMN is_superseded boolean DEFAULT false,ADD COLUMN property_id uuid;
-- Synthetic privacy predicate tests that the production predicate is consulted by both fold/reader.
CREATE FUNCTION public.observation_is_public(text,jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT coalesce(($2->>'private')::boolean,false)
$$;
CREATE SCHEMA cron;
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
-- Seed a legacy organization subject before NOT VALID/typed writer repair.
INSERT INTO vehicle_observations(id,subject_type,subject_id,kind,structured_data)
VALUES('00000000-0000-0000-0000-000000000070','organization','00000000-0000-0000-0000-000000000050','media',
  '{"kind_detail":"broadcast_profile_derived","property":"sample_coverage","value":1}');
\ir ../../migrations/20261002131000_broadcast_entity_profile_fold.sql

UPDATE vehicle_observations SET is_superseded=true WHERE id='00000000-0000-0000-0000-000000000070';
UPDATE vehicle_observations SET is_superseded=false WHERE id='00000000-0000-0000-0000-000000000070';
CREATE TEMP TABLE source_before_binding AS SELECT structured_data,content_hash,observed_at,ingested_at FROM vehicle_observations
  WHERE id='00000000-0000-0000-0000-000000000070';
SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000070',NULL,'exact organization UUID',NULL,
  '{"organization_subject_id":"00000000-0000-0000-0000-000000000050"}');
CREATE TEMP TABLE context_first_binding AS SELECT context_bound_at FROM vehicle_observations
  WHERE id='00000000-0000-0000-0000-000000000070';
SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000070',NULL,'same typed context retry',NULL,
  '{"organization_subject_id":"00000000-0000-0000-0000-000000000050"}');
DO $$ BEGIN
  IF (SELECT context_bound_at FROM context_first_binding) IS NULL OR
    (SELECT context_bound_at FROM vehicle_observations WHERE id='00000000-0000-0000-0000-000000000070') IS DISTINCT FROM
    (SELECT context_bound_at FROM context_first_binding) THEN RAISE EXCEPTION 'binding replay changed knowledge clock'; END IF;
  IF (SELECT ROW(structured_data,content_hash,observed_at,ingested_at) FROM source_before_binding) IS DISTINCT FROM
    (SELECT ROW(structured_data,content_hash,observed_at,ingested_at) FROM vehicle_observations WHERE id='00000000-0000-0000-0000-000000000070')
    THEN RAISE EXCEPTION 'typed binding mutated source identity or source/system clocks'; END IF;
END $$;
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(subject_type,subject_id)
  VALUES('organization','00000000-0000-0000-0000-000000000050')$a$,'23514');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(subject_type,subject_id,subject_organization_id)
  VALUES('organization','00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000099')$a$,'23503');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(subject_id,subject_organization_id)
  VALUES('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000050')$a$,'23514');

-- Legacy source offset is only in immutable JSON: sanctioned context binding must make
-- it replayable, reject a foreign carrier video and keep all source fields unchanged.
INSERT INTO publications(id,platform,platform_id,organization_id)
VALUES('00000000-0000-0000-0000-000000000011','youtube','foreign-video','00000000-0000-0000-0000-000000000050');
INSERT INTO vehicle_observations(id,kind,source_identifier,content_hash,structured_data)
VALUES('00000000-0000-0000-0000-000000000085','media','youtube:c9fxArnD3IY:screen:legacy-local-fixture:v1','synthetic-source-identity',
  '{"property":"background_board_amount","value":110000,"unit":"USD","media":{"video_id":"c9fxArnD3IY","start_seconds":2546},"event_context":{"source_listing_id":"1159827","auction_source_key":"mecum:FL26"}}');
CREATE TEMP TABLE legacy_context_before AS SELECT to_jsonb(o)-'citation_publication_id'-'auction_event_id'-'context_bound_at' AS payload
  FROM vehicle_observations o WHERE id='00000000-0000-0000-0000-000000000085';
SELECT pg_temp.rejects($a$SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000085',NULL,'foreign video attempt',NULL,
  '{"publication_id":"00000000-0000-0000-0000-000000000011","auction_event_id":"00000000-0000-0000-0000-000000000020"}')$a$,'23514');
SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000085',NULL,'legacy source context',NULL,
  '{"publication_id":"00000000-0000-0000-0000-000000000010","auction_event_id":"00000000-0000-0000-0000-000000000020"}');
DO $$ DECLARE c jsonb; BEGIN
  SELECT broadcast_media_contribution(o) INTO c FROM vehicle_observations o WHERE id='00000000-0000-0000-0000-000000000085';
  IF (c->>'n')::integer<>1 OR (c->>'t')::numeric<>2546 THEN RAISE EXCEPTION 'legacy nominal source offset not projected'; END IF;
  IF (SELECT media_start_ms FROM vehicle_observations WHERE id='00000000-0000-0000-0000-000000000085') IS NOT NULL
    THEN RAISE EXCEPTION 'legacy source offset was rewritten'; END IF;
  IF (SELECT payload FROM legacy_context_before) IS DISTINCT FROM
    (SELECT to_jsonb(o)-'citation_publication_id'-'auction_event_id'-'context_bound_at' FROM vehicle_observations o
      WHERE id='00000000-0000-0000-0000-000000000085') THEN RAISE EXCEPTION 'legacy context binding mutated source'; END IF;
END $$;
INSERT INTO vehicle_observations(id,kind,citation_publication_id,auction_event_id,structured_data)
VALUES('00000000-0000-0000-0000-000000000086','media','00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000020',
  '{"property":"background_board_amount","value":110000,"unit":"USD","media":{"video_id":"c9fxArnD3IY","start_seconds":"unknown"},"event_context":{"source_listing_id":"1159827","auction_source_key":"mecum:FL26"}}');

-- Three sparse overlay samples, one malformed metadata sample retained but unprojectable.
INSERT INTO vehicle_observations(id,vehicle_id,kind,citation_publication_id,auction_event_id,media_start_ms,media_relation,media_span_semantics,structured_data)
SELECT ('00000000-0000-0000-0000-00000000008'||i)::uuid,'00000000-0000-0000-0000-000000000001','media',
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',t,'screen_display','point_sample',
  jsonb_build_object('property','current_bid_displayed','value',p,'unit','USD','media',jsonb_build_object('video_id','c9fxArnD3IY'),
    'event_context',jsonb_build_object('source_listing_id','1159827','auction_source_key','mecum:FL26'))
FROM (VALUES(0,2546000,80000),(1,2556000,120000),(2,2566000,140000)) samples(i,t,p);
INSERT INTO vehicle_observations(id,kind,citation_publication_id,auction_event_id,media_start_ms,media_relation,media_span_semantics,structured_data)
VALUES('00000000-0000-0000-0000-000000000083','media','00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000020',2576000,'screen_display','point_sample',
  '{"property":"current_bid_displayed","value":140000,"unit":"USD","media":{"video_id":"c9fxArnD3IY","decoded_callback_media_time_seconds":"unknown"},"event_context":{"source_listing_id":"1159827","auction_source_key":"mecum:FL26"}}');
-- Private numeric display testimony stays in the source log but does not enter a public profile.
INSERT INTO vehicle_observations(id,kind,citation_publication_id,auction_event_id,media_start_ms,media_relation,media_span_semantics,structured_data)
VALUES('00000000-0000-0000-0000-000000000084','media','00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000020',2586000,'screen_display','point_sample',
  '{"private":true,"property":"current_bid_displayed","value":999999,"unit":"USD","media":{"video_id":"c9fxArnD3IY"},"event_context":{"source_listing_id":"1159827","auction_source_key":"mecum:FL26"}}');
DO $$ DECLARE state jsonb; proxy numeric; BEGIN
  SELECT broadcast_evidence_state INTO state FROM auction_events WHERE id='00000000-0000-0000-0000-000000000020';
  IF (state->>'display_samples')::integer<>6 OR (state->>'eligible_display_samples')::integer<>4 THEN RAISE EXCEPTION 'legacy/malformed/private samples poisoned fold'; END IF;
  proxy:=broadcast_event_display_proxy(state);
  IF proxy<>3000 THEN RAISE EXCEPTION 'display regression proxy wrong: %',proxy; END IF;
  IF (SELECT (broadcast_evidence_state->>'covered_presentations')::integer FROM organizations WHERE id='00000000-0000-0000-0000-000000000050')<>1 THEN RAISE EXCEPTION 'publisher presentation counted twice'; END IF;
END $$;

-- Context retry is an exact no-op for the fold/audit. Supersession subtracts only old input.
CREATE TEMP TABLE profile_before AS SELECT broadcast_evidence_state AS payload FROM organizations WHERE id='00000000-0000-0000-0000-000000000050';
UPDATE vehicle_observations SET auction_event_id=auction_event_id WHERE id='00000000-0000-0000-0000-000000000080';
DO $$ BEGIN
  IF (SELECT broadcast_evidence_state FROM organizations WHERE id='00000000-0000-0000-0000-000000000050')-'computed_at'
    IS DISTINCT FROM (SELECT payload FROM profile_before)-'computed_at' THEN RAISE EXCEPTION 'same-context retry changed profile'; END IF;
END $$;
UPDATE vehicle_observations SET is_superseded=true WHERE id='00000000-0000-0000-0000-000000000081';
SELECT drain_broadcast_profile_queue(20);
DO $$ DECLARE replay jsonb; BEGIN
  replay:=drain_broadcast_profile_queue(20);
  IF (replay->>'processed_events')::integer<>0 THEN RAISE EXCEPTION 'completed work replayed again'; END IF;
  IF (replay->>'max_inputs_per_event')::integer<>5000 THEN RAISE EXCEPTION 'replay input budget not exposed'; END IF;
END $$;
DO $$ BEGIN
  IF (SELECT (broadcast_evidence_state->>'eligible_display_samples')::integer FROM auction_events WHERE id='00000000-0000-0000-0000-000000000020')<>3 THEN RAISE EXCEPTION 'supersession lost/duplicated contribution'; END IF;
  IF read_broadcast_entity_profile('00000000-0000-0000-0000-000000000051',20) IS NOT NULL THEN RAISE EXCEPTION 'private org leaked'; END IF;
  IF jsonb_array_length(read_broadcast_entity_profile('00000000-0000-0000-0000-000000000050',20)->'derived_subject_claims')<>1 THEN RAISE EXCEPTION 'typed profile reader lacks subject claim'; END IF;
END $$;
SELECT pg_temp.rejects($a$SELECT drain_broadcast_profile_queue(51)$a$,'P0001');
SELECT pg_temp.rejects($a$SELECT drain_broadcast_profile_queue(NULL)$a$,'P0001');
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='public.read_broadcast_entity_profile(uuid,integer)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')
    THEN RAISE EXCEPTION 'profile reader publicly executable'; END IF;
  IF has_function_privilege('authenticated','public.drain_broadcast_profile_queue(integer)','EXECUTE') THEN RAISE EXCEPTION 'untrusted scheduled writer executable'; END IF;
END $$;
SELECT set_config('test.auth_role','authenticated',false);
SELECT pg_temp.rejects($a$SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000070',NULL,'untrusted context writer',NULL,'{}')$a$,'42501');
SELECT set_config('test.auth_role','',false);

-- Larger-than-budget events keep their complete foreground state and pending work flag.
-- This is a real 5,001-input boundary test, not a stubbed loop counter.
INSERT INTO auction_events(id,vehicle_id,source_listing_id,raw_data)
VALUES('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','1159829','{"auction_id":"FL26"}');
INSERT INTO vehicle_observations(kind,citation_publication_id,auction_event_id,structured_data)
SELECT 'media','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000022',
  '{"property":"fixture_capacity_claim","value":"synthetic","media":{"video_id":"c9fxArnD3IY"},"event_context":{"source_listing_id":"1159829","auction_source_key":"mecum:FL26"}}'::jsonb
FROM generate_series(1,5001);
CREATE TEMP TABLE oversized_before AS SELECT broadcast_evidence_state FROM auction_events
  WHERE id='00000000-0000-0000-0000-000000000022';
DO $$ DECLARE result jsonb; BEGIN
  result:=drain_broadcast_profile_queue(20);
  IF (result->>'deferred_oversized_events')::integer<>1 THEN RAISE EXCEPTION 'oversized event not reported'; END IF;
  IF (SELECT broadcast_evidence_dirty FROM auction_events WHERE id='00000000-0000-0000-0000-000000000022') IS DISTINCT FROM true
    THEN RAISE EXCEPTION 'oversized work flag cleared'; END IF;
  IF (SELECT broadcast_evidence_state FROM oversized_before) IS DISTINCT FROM
    (SELECT broadcast_evidence_state FROM auction_events WHERE id='00000000-0000-0000-0000-000000000022')
    THEN RAISE EXCEPTION 'oversized replay partially replaced fold'; END IF;
END $$;
\echo 'C15 local PG17 event/platform profile fold attacks passed'
