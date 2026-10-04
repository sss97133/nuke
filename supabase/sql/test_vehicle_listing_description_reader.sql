-- Synthetic actual PG17 contract only; reuse the installed listing reader fixture.
\set ON_ERROR_STOP on
\set description_reader_contract true
\ir test_listing_observation_consensus.sql
-- Live canonical intake's optional extractor reference is UUID, not a producer label.
-- Keep that real PG boundary in the fixture; the SDK test traverses the actual handler.
ALTER TABLE public.vehicle_observations ADD COLUMN extractor_id uuid;
DO $$ BEGIN
  ASSERT (SELECT atttypid = 'uuid'::regtype AND NOT attnotnull FROM pg_attribute
    WHERE attrelid = 'public.vehicle_observations'::regclass AND attname = 'extractor_id');
  ASSERT (jsonb_populate_record(NULL::public.vehicle_observations,
    '{"extraction_method":"html_description_capture"}')).extractor_id IS NULL;
  BEGIN
    PERFORM jsonb_populate_record(NULL::public.vehicle_observations,
      '{"extractor_id":"extract-bat-core"}');
    RAISE EXCEPTION 'Producer slug unexpectedly admitted as extractor UUID';
  EXCEPTION WHEN invalid_text_representation THEN NULL;
  END;
END $$;
ALTER TYPE public.observation_kind ADD VALUE 'sale_result';
ALTER TYPE public.observation_kind ADD VALUE 'condition';
ALTER TYPE public.observation_kind ADD VALUE 'bid';
ALTER TYPE public.observation_kind ADD VALUE 'splice';
CREATE OR REPLACE FUNCTION public.observation_is_public(p_kind public.observation_kind, p_data jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT p_kind IN ('listing', 'sale_result', 'comment', 'bid', 'specification', 'condition', 'media', 'splice')
     AND COALESCE(p_data::text, '') !~ ('"(invoice_number|line_items|subtotal|tax|total_amount|receipt_id|file_url'
                                         '|receipt_type|vendor_address|client_billing|billing|billed_usd|paid_usd|cost_usd'
                                         '|price_usd|amount_usd|payment_method|payment|payments|amount_paid|balance_due'
                                         '|order_number|order_contents|order|client|correct_owner|prior_owner_id'
                                         '|correct_owner_discovered_person_id|customer_name|client_name|email|phone)"\s*:')
     AND NOT (p_kind IN ('condition', 'media') AND COALESCE(p_data::text, '') ~* '(invoice|receipt|\$\s?[0-9])');
$$;


SET TIME ZONE 'UTC';
BEGIN;
INSERT INTO public.vehicles(id,is_public,description,description_source,owner_id,color) VALUES
('11111111-1111-1111-1111-111111111111',true,'Manual description remains exactly as written.','user_input',NULL,'Blue'),
('22222222-2222-2222-2222-222222222222',true,NULL,NULL,NULL,NULL),
('33333333-3333-3333-3333-333333333333',false,'Private manual text','user_input','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',NULL);
INSERT INTO public.observation_sources VALUES('99999999-9999-9999-9999-999999999999','fixture-listing',.6);
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,content_text,
 observed_at,ingested_at,source_url,extraction_method,confidence_score) VALUES
('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',
 '99999999-9999-9999-9999-999999999999','listing',jsonb_build_object('description',repeat('summary ',60)),
 repeat('Preserved seller prose. ',100)||'The trunk floor needs replacement. Literal <script>text</script>.',
 '2020-01-01','2022-01-01','https://source.invalid/listing','fixture_parser',.6),
('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222',
 '99999999-9999-9999-9999-999999999999','listing',jsonb_build_object('source_captured_at','2021-01-02T00:00:00Z',
 'source_event_time_status','unknown','observation_time_basis','source_capture'),repeat('Cached capture body. ',100),
 '2021-01-02','2023-01-01','https://source.invalid/captured','html_description_capture',.6);
CREATE TEMP TABLE originals_before AS SELECT id,vehicle_id,content_text,structured_data,observed_at,ingested_at FROM public.vehicle_observations;
SET LOCAL ROLE anon;
DO $$ DECLARE s jsonb;d jsonb; BEGIN
 SELECT x INTO s FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description';
 ASSERT s->>'value'='Manual description remains exactly as written.' AND s->>'inline_source'='user_input';
 ASSERT s->'rooted'='false'::jsonb, 'Prose testimony never accepts a canonical summary';
 d := s->'source_descriptions'->0;
 ASSERT length(d->>'text')>480 AND position('trunk floor needs replacement' in d->>'text')>480,
 'Full preserved tail beyond summary reaches actual reader';
 ASSERT d->>'source_text_field'='content_text', 'Longer same-capture content beats short structured summary';
 ASSERT d->>'source_observation_id'='44444444-4444-4444-4444-444444444444';
 ASSERT d->>'source_url'='https://source.invalid/listing' AND d->>'source_completeness'='unknown';
 ASSERT d->>'source_event_time_status'='unknown' AND d->'source_event_at'='null'::jsonb;
 ASSERT d->'reader_truncated'='false'::jsonb AND d->'source_captured_at'='null'::jsonb;
 ASSERT (d->>'recorded_observed_at')::timestamptz='2020-01-01'::timestamptz;
 ASSERT (d->>'ingested_at')::timestamptz='2022-01-01'::timestamptz;
 SELECT x->'source_descriptions'->0 INTO d FROM jsonb_array_elements(public.get_vehicle_specs('22222222-2222-2222-2222-222222222222')) x WHERE x->>'field'='description';
 ASSERT (d->>'source_captured_at')::timestamptz='2021-01-02'::timestamptz AND d->'source_event_at'='null'::jsonb;
 ASSERT d->>'observation_time_basis'='source_capture';
 ASSERT public.get_vehicle_specs('33333333-3333-3333-3333-333333333333') IS NULL;
END $$;
RESET ROLE;
-- Failed clocks remain unknown; malformed timestamps cannot break the reader.
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"source_captured_at":"not-a-date"}'::jsonb
 WHERE id='55555555-5555-5555-5555-555555555555';
DO $$ BEGIN
 ASSERT (SELECT x->'source_descriptions'->0->'source_captured_at'='null'::jsonb FROM jsonb_array_elements(public.get_vehicle_specs('22222222-2222-2222-2222-222222222222')) x WHERE x->>'field'='description');
END $$;
-- An actual relink/supersession/restriction changes reader eligibility immediately without replay.
UPDATE public.vehicle_observations SET vehicle_id='33333333-3333-3333-3333-333333333333'
 WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ BEGIN
 ASSERT (SELECT x->'source_descriptions'='[]'::jsonb FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description');
 PERFORM set_config('test.auth_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
 ASSERT (SELECT x->>'value'='Private manual text' AND x->'source_descriptions'='[]'::jsonb FROM jsonb_array_elements(public.get_vehicle_specs('33333333-3333-3333-3333-333333333333')) x WHERE x->>'field'='description');
 PERFORM set_config('test.auth_uid','',true);
END $$;
UPDATE public.vehicle_observations SET vehicle_id='11111111-1111-1111-1111-111111111111',is_superseded=true
 WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ BEGIN
 ASSERT (SELECT x->'source_descriptions'='[]'::jsonb FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description');
END $$;
UPDATE public.vehicle_observations SET is_superseded=false,structured_data='{"nested":{"email":"private"}}'
 WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ BEGIN
 ASSERT (SELECT x->'source_descriptions'='[]'::jsonb FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description');
END $$;
UPDATE public.vehicle_observations SET structured_data='{"subject_type":"user"}' WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ BEGIN
 ASSERT (SELECT x->'source_descriptions'='[]'::jsonb FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description');
END $$;
UPDATE public.vehicle_observations SET structured_data='{}',kind='specification' WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ BEGIN
 ASSERT (SELECT x->'source_descriptions'='[]'::jsonb FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description');
END $$;
-- A newer higher-confidence marker does not become full prose; oversize is refused without clipping.
UPDATE public.vehicle_observations SET kind='listing',content_text=repeat('x',32001) WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ DECLARE d jsonb; BEGIN
 SELECT x->'source_descriptions'->0 INTO d FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description';
 ASSERT d->>'status'='oversized' AND d->'text'='null'::jsonb AND (d->>'preserved_characters')::int=32001;
END $$;
UPDATE public.vehicle_observations SET content_text='Listing imported' WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ BEGIN
 ASSERT (SELECT x->'source_descriptions'='[]'::jsonb FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description');
END $$;
-- Five newer short/spec-only receipts cannot hide the older full prose observation.
UPDATE public.vehicle_observations SET content_text=repeat('Full older source text. ',100),observed_at='2020-01-01'
 WHERE id='44444444-4444-4444-4444-444444444444';
INSERT INTO public.vehicle_observations(id,vehicle_id,kind,content_text,structured_data,source_url,observed_at,ingested_at)
 SELECT md5('fixture-marker-'||i)::uuid,'11111111-1111-1111-1111-111111111111','listing','Listing imported',
 jsonb_build_object('mileage',100+i),'https://source.invalid/marker/'||i,'2021-01-01'::timestamptz+i*interval '1 day','2024-01-01'
 FROM generate_series(1,5) i;
DO $$ BEGIN
 ASSERT (SELECT x->'source_descriptions'->0->>'source_observation_id'='44444444-4444-4444-4444-444444444444'
 FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description');
END $$;
-- Bounded source history is chronological, not confidence-ranked. A late arrival of older prose
-- does not displace the five newest recorded captures or rewrite their original dates.
INSERT INTO public.vehicle_observations(id,vehicle_id,kind,content_text,structured_data,source_url,observed_at,ingested_at,confidence_score)
 SELECT md5('fixture-description-'||i)::uuid,'11111111-1111-1111-1111-111111111111','listing',repeat('Source prose '||i||'. ',80),'{}',
 'https://source.invalid/'||i, '2022-01-01'::timestamptz+i*interval '1 day','2024-01-01',.4+i/100.0 FROM generate_series(1,7) i;
INSERT INTO public.vehicle_observations(id,vehicle_id,kind,content_text,structured_data,source_url,observed_at,ingested_at,confidence_score)
 VALUES(md5('fixture-late-old')::uuid,'11111111-1111-1111-1111-111111111111','listing',repeat('Late older high confidence. ',100),'{}',
 'https://source.invalid/late-old','2019-01-01','2025-01-01',.99);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s jsonb; BEGIN
 SELECT x INTO s FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x->>'field'='description';
 ASSERT jsonb_array_length(s->'source_descriptions')=5 AND s->'source_descriptions'->0->>'source_url'='https://source.invalid/7';
 ASSERT s->>'source_descriptions_limit'='5' AND s->>'source_descriptions_scope'='latest_recorded_public_listing_prose_observations';
 ASSERT position('late-old' in s::text)=0;
END $$;
RESET ROLE;
-- Future arrivals are not delivered; deleted/nonvehicle parents close the existing reader.
UPDATE public.vehicle_observations SET ingested_at=now()+interval '1 day' WHERE source_url='https://source.invalid/7';
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) x WHERE x::text LIKE '%source.invalid/7%');
END $$;
UPDATE public.vehicles SET deleted_at=now() WHERE id='11111111-1111-1111-1111-111111111111';
DO $$ BEGIN ASSERT public.get_vehicle_specs('11111111-1111-1111-1111-111111111111') IS NULL; END $$;
UPDATE public.vehicles SET deleted_at=NULL,listing_kind='non_vehicle_item' WHERE id='11111111-1111-1111-1111-111111111111';
DO $$ BEGIN ASSERT public.get_vehicle_specs('11111111-1111-1111-1111-111111111111') IS NULL; END $$;
UPDATE public.vehicles SET listing_kind=NULL WHERE id='11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE service_role;
SELECT public.get_vehicle_specs('11111111-1111-1111-1111-111111111111');
RESET ROLE;
ROLLBACK;
SELECT 'PASS: actual description reader, full preserved tail, unchanged manual value, clocks/unknowns, all roles, public/restricted/deleted/nonvehicle/relinked/superseded ancestry, cutoff, safe-size refusal and five-capture limit' result;
