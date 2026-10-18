-- EMPTY disposable PG17 dm_refinement_* database only; no production fixtures.
\set ON_ERROR_STOP on
\ir test_cached_image_source_ancestry.sql
\ir ../migrations/20261004175418_observation_private_fields_guard.sql

CREATE TEMP TABLE previous_provenance_contract AS
SELECT proowner,proacl,prosecdef,provolatile,proconfig,prolang
FROM pg_proc WHERE oid='public.get_field_provenance(uuid,text)'::regprocedure;
CREATE TEMP TABLE previous_provenance_results AS
SELECT field,public.get_field_provenance('11111111-1111-1111-1111-111111111111',field) result
FROM unnest(ARRAY['color','image_visible_rust_severity','not_recorded']) field;
\ir ../migrations/20261005013641_bounded_field_provenance_inputs.sql
-- The guarded migration accepts replay without changing the reader's access.
\ir ../migrations/20261005013641_bounded_field_provenance_inputs.sql
BEGIN;
CREATE TEMP TABLE bounded_provenance_checks(label text);
CREATE FUNCTION pg_temp.check(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN ASSERT ok IS TRUE,label; INSERT INTO bounded_provenance_checks VALUES(label); END $$;
CREATE FUNCTION pg_temp.read_field(field text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT public.get_field_provenance('11111111-1111-1111-1111-111111111111',field)
$$;
SELECT pg_temp.check((SELECT ROW(p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proconfig,p.prolang)
 IS NOT DISTINCT FROM ROW(b.proowner,b.proacl,b.prosecdef,b.provolatile,b.proconfig,b.prolang)
 FROM pg_proc p CROSS JOIN previous_provenance_contract b
 WHERE p.oid='public.get_field_provenance(uuid,text)'::regprocedure),
 'signature owner grants security stability language and configuration preserved');
SELECT pg_temp.check((SELECT bool_and(pg_temp.read_field(field)-'coverage'=result)
 FROM previous_provenance_results),'small existing reader results unchanged outside coverage');
SELECT pg_temp.check(pg_temp.read_field('color')->'coverage'->>'status'='complete_current_reader',
 'existing eligible fixture has complete current-reader coverage');
SELECT pg_temp.check(pg_temp.read_field('color')->'coverage'->>'scanRowsBounded'='false'
 AND pg_temp.read_field('color')->'coverage'->>'responseBytesBounded'='false',
 'aggregate cap does not claim bounded scans or response bytes');
-- Re-exercise source ancestry after replacement, not only in the imported
-- original-owner suite. A projected child never outlives its readable parent.
SELECT pg_temp.check(EXISTS(SELECT 1 FROM jsonb_array_elements(
 pg_temp.read_field('image_visible_rust_severity')->'observations') o
 WHERE o->>'source_observation_id'='55555555-5555-5555-5555-000000000001'),
 'existing cached child retains its original source after replacement');
UPDATE public.vehicle_observations SET is_superseded=true
WHERE id='55555555-5555-5555-5555-000000000001';
SELECT pg_temp.check(pg_temp.read_field('image_visible_rust_severity')->'observations'='[]'::jsonb,
 'superseded original withholds its child after replacement');
UPDATE public.vehicle_observations SET is_superseded=false,structured_data=structured_data||'{"receipt_id":"private-fixture"}'
WHERE id='55555555-5555-5555-5555-000000000001';
SELECT pg_temp.check(pg_temp.read_field('image_visible_rust_severity')->'observations'='[]'::jsonb
 AND pg_temp.read_field('image_visible_rust_severity')->'coverage'->>'status'='complete_current_reader',
 'restricted original withholds its child without exposing hidden coverage');
UPDATE public.vehicle_observations SET structured_data=structured_data-'receipt_id'
WHERE id='55555555-5555-5555-5555-000000000001';
UPDATE public.observation_witnesses w SET image_id='44444444-4444-4444-4444-000000000002'
FROM public.vehicle_observations o WHERE o.id=w.observation_id
 AND o.extraction_method='cached_byok_property_projection_v1'
 AND o.structured_data->>'source_observation_id'='55555555-5555-5555-5555-000000000001';
SELECT pg_temp.check(pg_temp.read_field('image_visible_rust_severity')->'observations'='[]'::jsonb
 AND pg_temp.read_field('image_visible_rust_severity')->'image_observations'='[]'::jsonb,
 'wrong typed cached witness cannot reopen JSON fallback after replacement');
UPDATE public.observation_witnesses w SET image_id='44444444-4444-4444-4444-000000000001'
FROM public.vehicle_observations o WHERE o.id=w.observation_id
 AND o.extraction_method='cached_byok_property_projection_v1'
 AND o.structured_data->>'source_observation_id'='55555555-5555-5555-5555-000000000001';

-- The cap is applied to permitted field claims, not unrelated vehicle history.
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,
 confidence_score,observed_at,ingested_at)
SELECT md5('bounded-claim-'||n)::uuid,'11111111-1111-1111-1111-111111111111',
 '33333333-3333-3333-3333-333333333333','specification',jsonb_build_object('cap_claim','claim '||n),
 .5,'2025-01-01','2025-01-02' FROM generate_series(1,1000) n;
SELECT pg_temp.check(jsonb_array_length(pg_temp.read_field('cap_claim')->'observations')=1000
 AND pg_temp.read_field('cap_claim')->'coverage'->>'status'='complete_current_reader',
 'exactly 1000 permitted observations remain complete');
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data)
VALUES(md5('bounded-claim-1001')::uuid,'11111111-1111-1111-1111-111111111111',
 '33333333-3333-3333-3333-333333333333','specification','{"cap_claim":"last claim"}');
SELECT pg_temp.check(pg_temp.read_field('cap_claim')->'coverage'->>'status'='refused_input_limit',
 '1001 permitted observations refuse instead of silently sampling');
SELECT pg_temp.check(pg_temp.read_field('cap_claim')->'observations'='[]'::jsonb
 AND pg_temp.read_field('cap_claim')->'image_observations'='[]'::jsonb
 AND pg_temp.read_field('cap_claim')->'evidence'='[]'::jsonb,
 'one overflow withholds every collection');
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data)
VALUES(md5('bounded-small')::uuid,'11111111-1111-1111-1111-111111111111',
 '33333333-3333-3333-3333-333333333333','specification','{"small_claim":"visible"}');
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data)
SELECT md5('bounded-private-'||n)::uuid,'11111111-1111-1111-1111-111111111111',
 '33333333-3333-3333-3333-333333333333','specification',
 jsonb_build_object('small_claim','HIDDEN_MARKER','email','HIDDEN_PERSON') FROM generate_series(1,1001) n;
SELECT pg_temp.check(pg_temp.read_field('small_claim')->'coverage'->>'status'='complete_current_reader'
 AND jsonb_array_length(pg_temp.read_field('small_claim')->'observations')=1,
 '1001 hidden matching and 1001 unrelated claims do not change public coverage');
SELECT pg_temp.check(pg_temp.read_field('small_claim')::text NOT LIKE '%HIDDEN_%',
 'refusal and coverage do not expose hidden values or counts');

-- A single observation can have many distinct permitted image witnesses.
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data)
VALUES(md5('bounded-image-claim')::uuid,'11111111-1111-1111-1111-111111111111',
 '33333333-3333-3333-3333-333333333333','specification','{"cap_image":"visible"}');
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,is_sensitive)
SELECT md5('bounded-image-'||n)::uuid,'11111111-1111-1111-1111-111111111111',
 'https://fixture.invalid/'||n||'.jpg',false FROM generate_series(1,1001) n;
INSERT INTO public.observation_witnesses(observation_id,image_id,witness_role)
SELECT md5('bounded-image-claim')::uuid,md5('bounded-image-'||n)::uuid,'derived' FROM generate_series(1,1000) n;
SELECT pg_temp.check(jsonb_array_length(pg_temp.read_field('cap_image')->'image_observations')=1000
 AND pg_temp.read_field('cap_image')->'coverage'->>'status'='complete_current_reader',
 'exactly 1000 permitted image witnesses remain complete');
INSERT INTO public.observation_witnesses(observation_id,image_id,witness_role)
VALUES(md5('bounded-image-claim')::uuid,md5('bounded-image-1001')::uuid,'derived');
SELECT pg_temp.check(pg_temp.read_field('cap_image')->'coverage'->>'status'='refused_input_limit'
 AND pg_temp.read_field('cap_image')->'observations'='[]'::jsonb,
 '1001 image witnesses refuse the whole result');
SELECT pg_temp.check(pg_temp.read_field('small_claim')->'coverage'->>'status'='complete_current_reader',
 'unrelated image witness overflow does not refuse another field');

INSERT INTO public.field_evidence(vehicle_id,field_name,proposed_value,source_type,source_confidence,status)
SELECT '11111111-1111-1111-1111-111111111111','cap_evidence','claim '||n,'fixture',50,'accepted'
FROM generate_series(1,999) n;
INSERT INTO public.vehicle_field_sources(vehicle_id,field_name,field_value,source_type,confidence_score)
VALUES('11111111-1111-1111-1111-111111111111','cap_evidence','legacy claim','fixture',50);
SELECT pg_temp.check(jsonb_array_length(pg_temp.read_field('cap_evidence')->'evidence')=1000
 AND pg_temp.read_field('cap_evidence')->'coverage'->>'status'='complete_current_reader',
 'exactly 1000 combined legacy evidence rows remain complete');
INSERT INTO public.field_evidence(vehicle_id,field_name,proposed_value,source_type,source_confidence,status)
VALUES('11111111-1111-1111-1111-111111111111','cap_evidence','last claim','fixture',50,'accepted');
SELECT pg_temp.check(pg_temp.read_field('cap_evidence')->'coverage'->>'status'='refused_input_limit',
 'combined evidence branches share one 1000 row cap');

-- Existing typed image edges still dominate a divergent legacy JSON pointer.
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,is_sensitive)
VALUES(md5('bounded-hidden-image')::uuid,'11111111-1111-1111-1111-111111111111','https://fixture.invalid/hidden.jpg',true);
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data)
VALUES(md5('bounded-hidden-witness')::uuid,'11111111-1111-1111-1111-111111111111',
 '33333333-3333-3333-3333-333333333333','specification',
 jsonb_build_object('hidden_witness','HIDDEN_WITNESS','image_id',md5('bounded-hidden-image')::uuid));
UPDATE public.vehicle_observations SET structured_data=structured_data||
 jsonb_build_object('image_id',md5('bounded-image-1')::uuid) WHERE id=md5('bounded-hidden-witness')::uuid;
SELECT pg_temp.check(pg_temp.read_field('hidden_witness')->'observations'='[]'::jsonb
 AND pg_temp.read_field('hidden_witness')->'image_observations'='[]'::jsonb
 AND pg_temp.read_field('hidden_witness')->'coverage'->>'status'='complete_current_reader',
 'hidden typed witness cannot reopen a visible JSON fallback');

INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data)
VALUES(md5('bounded-large-value')::uuid,'11111111-1111-1111-1111-111111111111',
 '33333333-3333-3333-3333-333333333333','specification',jsonb_build_object('large_value',repeat('x',1048577)));
SELECT pg_temp.check(octet_length(pg_temp.read_field('large_value')->'observations'->0->>'value')=1048577
 AND pg_temp.read_field('large_value')->'coverage'->>'responseBytesBounded'='false',
 'one large value remains explicitly outside the byte-bound contract');
SELECT pg_temp.check(public.get_field_provenance(md5('bounded-missing')::uuid,'color') IS NULL,
 'missing parent remains unavailable');
SELECT pg_temp.check(public.get_field_provenance('99999999-9999-9999-9999-999999999999','color') IS NULL,
 'private parent remains unavailable without an owner session');
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_field_provenance('99999999-9999-9999-9999-999999999999','color') IS NULL;
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','small_claim')->'coverage'->>'status'='complete_current_reader';
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','cap_claim')->'coverage'->>'status'='refused_input_limit';
END $$;
RESET ROLE;
SELECT set_config('test.auth_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
SELECT pg_temp.check(public.get_field_provenance('99999999-9999-9999-9999-999999999999','color')->>'value'='private',
 'existing owner access remains available');
SELECT count(*) AS bounded_provenance_checks_passed FROM bounded_provenance_checks;
ROLLBACK;
