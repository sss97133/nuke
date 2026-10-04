-- Actual migration, synthetic production-shaped schema. Never execute in prod.
\set ON_ERROR_STOP on
SET timezone='UTC';
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE TYPE public.observation_kind AS ENUM('sale_result','comment','listing');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,is_public boolean,deleted_at timestamptz,listing_kind text);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text UNIQUE,supported_observations public.observation_kind[]);
CREATE TABLE public.vehicle_events(id uuid PRIMARY KEY,vehicle_id uuid NOT NULL REFERENCES public.vehicles,
  source_platform text NOT NULL,source_url text,source_listing_id text,event_type text NOT NULL DEFAULT 'auction',
  event_status text NOT NULL DEFAULT 'active',final_price numeric,sold_at timestamptz,ended_at timestamptz,
  created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),extracted_at timestamptz DEFAULT now());
CREATE TABLE public.listing_page_snapshots(id uuid PRIMARY KEY,platform text,listing_url text,success boolean,http_status int,
  html_sha256 text,html text,html_storage_path text,fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),metadata jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.auction_events(id uuid PRIMARY KEY,vehicle_id uuid);
CREATE TABLE public.auction_comments(id uuid PRIMARY KEY,vehicle_id uuid,posted_at timestamptz,bid_amount numeric,
  comment_type text,comment_text text,auction_event_id uuid);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,
  source_id uuid REFERENCES public.observation_sources,source_identifier text,source_url text,
  source_snapshot_id uuid REFERENCES public.listing_page_snapshots ON DELETE RESTRICT,
  source_comment_id uuid REFERENCES public.auction_comments,kind public.observation_kind NOT NULL,
  observed_at timestamptz NOT NULL,ingested_at timestamptz DEFAULT now(),content_text text,content_hash text,
  structured_data jsonb NOT NULL DEFAULT '{}',extraction_metadata jsonb,extraction_method text,extractor_id uuid,
  raw_source_ref text,confidence_score numeric(3,2),subject_type text NOT NULL DEFAULT 'vehicle',subject_id uuid,
  is_superseded boolean DEFAULT false,superseded_by uuid,
  CONSTRAINT unique_observation UNIQUE(source_id,source_identifier,kind,content_hash));
CREATE TABLE public.pipeline_registry(table_name text,column_name text,owned_by text,description text,
  do_not_write_directly boolean,write_via text,UNIQUE(table_name,column_name));
-- Preserve an existing service-only function ACL and both existing trigger names.
CREATE FUNCTION public.validate_comment_observation_source() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.validate_comment_observation_source() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_comment_observation_source() TO service_role;
CREATE TRIGGER trg_validate_comment_observation_source_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
  WHEN(NEW.source_comment_id IS NOT NULL) EXECUTE FUNCTION public.validate_comment_observation_source();
CREATE TRIGGER trg_validate_comment_observation_source_update BEFORE UPDATE OF source_comment_id,vehicle_id,kind,content_text,
  observed_at,confidence_score,structured_data ON public.vehicle_observations FOR EACH ROW
  WHEN(OLD.source_comment_id IS NOT NULL OR NEW.source_comment_id IS NOT NULL) EXECUTE FUNCTION public.validate_comment_observation_source();
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_write ON public.vehicle_observations FOR ALL TO service_role USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.vehicle_observations TO service_role,authenticated,anon;
INSERT INTO public.vehicle_observations(kind,observed_at,ingested_at,extraction_method,structured_data)
  VALUES('listing','2020-01-01Z',NULL,NULL,'{"legacy":true}'),
  ('sale_result','2020-01-01Z',NULL,'protected_archived_sale_observation_v1','{"source_sale_receipt":{"method":"protected_archived_sale_observation_v1","parser":"batParser:1.0.0_sale_grammar_with_ambiguity_refusal"}}');
\ir ../../supabase/migrations/20261004162325_observation_sale_episode_source_integrity.sql

CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;
CREATE FUNCTION pg_temp.refuses(label text,statement text,expected text DEFAULT '23514') RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE; END;
  PERFORM pg_temp.ok(label,actual=expected);
END $$;
INSERT INTO public.vehicles VALUES(md5('vehicle-1')::uuid,true,NULL,'vehicle'),(md5('vehicle-2')::uuid,true,NULL,'vehicle');
INSERT INTO public.observation_sources VALUES(md5('source-bat')::uuid,'bat',ARRAY['sale_result','comment']::public.observation_kind[]),
  (md5('source-other')::uuid,'other',ARRAY['sale_result']::public.observation_kind[]);
INSERT INTO public.vehicle_events(id,vehicle_id,source_platform,source_url,source_listing_id,event_status,final_price,sold_at,
  created_at,updated_at,extracted_at) SELECT md5('episode-'||n)::uuid,md5('vehicle-1')::uuid,'bat',
  'https://bringatrailer.com/listing/synthetic-'||n||'/','bringatrailer.com/listing/synthetic-'||n,'sold',n*1000,
  CASE WHEN n=1 THEN '2025-06-15Z'::timestamptz ELSE '2020-06-15Z'::timestamptz END,
  '2026-01-01T00:00:00.123456Z','2026-01-02T00:00:00.123456Z','2026-01-03T00:00:00.123456Z' FROM generate_series(1,2)n;
INSERT INTO public.listing_page_snapshots(id,platform,listing_url,success,http_status,html,html_sha256,
  fetched_at,created_at,metadata) SELECT md5('capture-'||n)::uuid,'bat','https://bringatrailer.com/listing/synthetic-'||n||'/',true,200,
  'SYNTHETIC protected source Sold for USD $'||n*1000||' on 6/15/'||CASE WHEN n=1 THEN '25' ELSE '20' END,
  NULL,'2026-01-04T00:00:00.123456Z','2026-01-05T00:00:00.123456Z',
  jsonb_build_object('vehicle_id',md5('vehicle-1')::uuid,'vehicle_matched',true,'parsed_at','2026-01-06T00:00:00.123456Z') FROM generate_series(1,2)n;
UPDATE public.listing_page_snapshots SET html_sha256=encode(sha256(convert_to(html,'UTF8')),'hex');
CREATE FUNCTION public.synthetic_episode_input(n int DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id',md5('claim-'||n)::uuid,'vehicle_id',e.vehicle_id,'source_id',md5('source-bat')::uuid,
    'source_vehicle_event_id',e.id,'source_snapshot_id',s.id,'kind','sale_result','observed_at',e.sold_at,
    'source_url',s.listing_url,'source_identifier','archived-sale:'||s.id||':batParser:1.0.0:strict_sale_tuple_v1',
    'content_text','SYNTHETIC source-derived sale receipt','content_hash',md5('claim-hash-'||n)||md5('claim-hash-'||n),
    'raw_source_ref','listing_page_snapshots:'||s.id,'extraction_method','protected_archived_sale_observation_v1',
    'structured_data',jsonb_build_object('source_sale_receipt',jsonb_build_object(
      'method','protected_archived_sale_observation_v1','verification_basis','producer_attested_archived_hash_parser',
      'snapshot_id',s.id,'vehicle_id',e.vehicle_id,'source_url',s.listing_url,'source_sha256',s.html_sha256,
      'body_source','inline','byte_length',octet_length(convert_to(s.html,'UTF8')),
      'parser','batParser:1.0.0:strict_sale_tuple_v1','amount',e.final_price,'currency','USD',
      'outcome','sold','event_day',to_char(e.sold_at AT TIME ZONE 'UTC','YYYY-MM-DD'),'event_grain','date',
      'price_basis','published_bid_excluding_fees','price_basis_rule','bat_published_result_fee_separate_v1',
      'price_basis_source','https://bringatrailer.com/policies/','captured_at',s.fetched_at,'source_ingested_at',s.created_at,
      'original_parsed_at',s.metadata->>'parsed_at','source_known_at','2026-01-06T00:00:00.123456Z')),
    'extraction_metadata',jsonb_build_object('source_episode_context',to_jsonb(e),
      'source_snapshot_context',(to_jsonb(s)-'html')||jsonb_build_object('inline_body_present',true)))
  FROM public.vehicle_events e JOIN public.listing_page_snapshots s ON s.id=md5('capture-'||n)::uuid WHERE e.id=md5('episode-'||n)::uuid
$$;
CREATE TABLE public.synthetic_inputs(n int PRIMARY KEY,payload jsonb NOT NULL);
INSERT INTO public.synthetic_inputs SELECT n,public.synthetic_episode_input(n) FROM generate_series(1,2)n;
GRANT SELECT ON public.synthetic_inputs TO service_role,authenticated,anon;
CREATE FUNCTION public.synthetic_insert_episode(input jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o public.vehicle_observations%ROWTYPE;
BEGIN
  o:=jsonb_populate_record(NULL::public.vehicle_observations,input);
  INSERT INTO public.vehicle_observations(id,vehicle_id,source_vehicle_event_id,source_snapshot_id,source_comment_id,
    source_id,source_identifier,source_url,kind,observed_at,content_text,content_hash,structured_data,extraction_metadata,
    extraction_method,extractor_id,raw_source_ref,subject_type,subject_id)
  VALUES(o.id,o.vehicle_id,o.source_vehicle_event_id,o.source_snapshot_id,o.source_comment_id,o.source_id,o.source_identifier,
    o.source_url,o.kind,o.observed_at,o.content_text,o.content_hash,o.structured_data,o.extraction_metadata,o.extraction_method,
    o.extractor_id,o.raw_source_ref,coalesce(o.subject_type,'vehicle'),o.subject_id);
  RETURN o.id;
END $$;
CREATE FUNCTION public.synthetic_insert_default(n int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.synthetic_insert_episode(payload) FROM public.synthetic_inputs WHERE synthetic_inputs.n=$1
$$;
SELECT pg_temp.ok('legacy and existing v1 rows remain nullable and untouched',(SELECT count(*) FROM public.vehicle_observations WHERE source_vehicle_event_id IS NULL AND ingested_at IS NULL)=2 AND EXISTS(SELECT FROM public.vehicle_observations WHERE structured_data->'source_sale_receipt'->>'parser'='batParser:1.0.0_sale_grammar_with_ambiguity_refusal' AND source_vehicle_event_id IS NULL));
SELECT pg_temp.ok('new FK is forward enforced and historical NOT VALID',(SELECT NOT convalidated AND pg_get_constraintdef(oid) LIKE '%ON DELETE RESTRICT NOT VALID%' FROM pg_constraint WHERE conname='vehicle_observations_source_vehicle_event_id_fkey'));
SELECT pg_temp.ok('new nullable ancestry has no default or observation-side index',
  (SELECT NOT attnotnull AND NOT EXISTS(SELECT FROM pg_attrdef WHERE adrelid=attrelid AND adnum=attnum)
   FROM pg_attribute WHERE attrelid='public.vehicle_observations'::regclass AND attname='source_vehicle_event_id')
  AND NOT EXISTS(SELECT FROM pg_indexes WHERE tablename='vehicle_observations' AND indexdef LIKE '%source_vehicle_event_id%'));
SELECT pg_temp.ok('existing canonical registry owns only the new relation',(SELECT owned_by='ingest-observation' AND write_via='ingest-observation' AND do_not_write_directly FROM public.pipeline_registry WHERE column_name='source_vehicle_event_id'));
SELECT pg_temp.ok('existing source guard ACL does not gain public user execution',
  has_function_privilege('service_role','public.validate_comment_observation_source()','EXECUTE') AND NOT has_function_privilege('authenticated','public.validate_comment_observation_source()','EXECUTE') AND NOT has_function_privilege('anon','public.validate_comment_observation_source()','EXECUTE'));

SET ROLE service_role;
INSERT INTO public.vehicle_observations(kind,observed_at,content_hash,structured_data) VALUES('listing','2020-01-01Z',repeat('0',64),'{}');
RESET ROLE;
SELECT pg_temp.ok('generic nullable forward write remains valid',EXISTS(SELECT FROM public.vehicle_observations WHERE content_hash=repeat('0',64) AND source_vehicle_event_id IS NULL));
SET ROLE service_role;
SELECT public.synthetic_insert_default(1);
SELECT public.synthetic_insert_default(2);
RESET ROLE;
SELECT pg_temp.ok('two dated source episodes retain one vehicle and separate ancestry',(SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id=md5('vehicle-1')::uuid AND source_vehicle_event_id IS NOT NULL)=2);
SELECT pg_temp.ok('DB recording time is separate from old sale and source clocks',EXISTS(SELECT FROM public.vehicle_observations WHERE id=md5('claim-2')::uuid AND observed_at='2020-06-15Z' AND ingested_at>observed_at AND ingested_at> (structured_data#>>'{source_sale_receipt,source_known_at}')::timestamptz));
SELECT pg_temp.refuses('exact same complete replay tuple is unique','SET ROLE service_role; SELECT public.synthetic_insert_episode((SELECT payload||jsonb_build_object(''id'',md5(''duplicate'')::uuid) FROM public.synthetic_inputs WHERE n=1))','23505');
RESET ROLE;
SELECT pg_temp.refuses('typed source link cannot be removed','UPDATE public.vehicle_observations SET source_vehicle_event_id=NULL WHERE id=md5(''claim-1'')::uuid');
SELECT pg_temp.refuses('typed source link cannot be reparented','UPDATE public.vehicle_observations SET vehicle_id=md5(''vehicle-2'')::uuid WHERE id=md5(''claim-1'')::uuid');
SELECT pg_temp.refuses('typed source snapshot cannot be changed','UPDATE public.vehicle_observations SET source_snapshot_id=md5(''capture-2'')::uuid WHERE id=md5(''claim-1'')::uuid');
SELECT pg_temp.refuses('typed raw source reference cannot be changed','UPDATE public.vehicle_observations SET raw_source_ref=''other'' WHERE id=md5(''claim-1'')::uuid');
SELECT pg_temp.refuses('typed original payload cannot be changed','UPDATE public.vehicle_observations SET structured_data=''{}'' WHERE id=md5(''claim-1'')::uuid');
SELECT pg_temp.refuses('typed recording clock cannot be rewritten','UPDATE public.vehicle_observations SET ingested_at=''2020-01-01Z'' WHERE id=md5(''claim-1'')::uuid');
SELECT pg_temp.refuses('typed confidence qualification cannot be changed','UPDATE public.vehicle_observations SET confidence_score=0.99 WHERE id=md5(''claim-1'')::uuid');
SELECT pg_temp.refuses('nullable legacy claim cannot be silently promoted','UPDATE public.vehicle_observations SET source_vehicle_event_id=md5(''episode-1'')::uuid WHERE structured_data->>''legacy''=''true''');
SELECT pg_temp.refuses('event deletion preserves cited ancestry','DELETE FROM public.vehicle_events WHERE id=md5(''episode-1'')::uuid','23503');
SELECT pg_temp.refuses('capture deletion preserves cited ancestry','DELETE FROM public.listing_page_snapshots WHERE id=md5(''capture-1'')::uuid','23503');
UPDATE public.vehicle_observations SET is_superseded=true WHERE id=md5('claim-1')::uuid;
SELECT pg_temp.ok('supersession preserves original typed tuple',EXISTS(SELECT FROM public.vehicle_observations WHERE id=md5('claim-1')::uuid AND is_superseded IS TRUE AND source_vehicle_event_id=md5('episode-1')::uuid));
DELETE FROM public.vehicle_observations WHERE source_vehicle_event_id IS NOT NULL;

SET ROLE service_role;
SELECT public.synthetic_insert_episode((SELECT (payload-'source_vehicle_event_id')||jsonb_build_object('id',md5('old-v1-null-ancestry')::uuid,'extraction_metadata',jsonb_build_object('producer_qualified_at','2026-01-07T00:00:00Z')) FROM public.synthetic_inputs WHERE n=1));
RESET ROLE;
SELECT pg_temp.ok('forward protected v1 remains NULL event ancestry without new contexts',EXISTS(SELECT FROM public.vehicle_observations WHERE id=md5('old-v1-null-ancestry')::uuid AND source_vehicle_event_id IS NULL AND source_snapshot_id=md5('capture-1')::uuid));
SELECT pg_temp.refuses('old NULL-ancestry complete replay tuple refuses a new typed row','SET ROLE service_role; SELECT public.synthetic_insert_default(1)','23505'); RESET ROLE;
SELECT pg_temp.refuses('old complete replay row cannot be silently promoted','UPDATE public.vehicle_observations SET source_vehicle_event_id=md5(''episode-1'')::uuid WHERE id=md5(''old-v1-null-ancestry'')::uuid');
SELECT pg_temp.ok('old replay row and its original NULL ancestry remain unchanged',EXISTS(SELECT FROM public.vehicle_observations WHERE id=md5('old-v1-null-ancestry')::uuid AND source_vehicle_event_id IS NULL AND extraction_metadata=jsonb_build_object('producer_qualified_at','2026-01-07T00:00:00Z')));
DELETE FROM public.vehicle_observations WHERE id=md5('old-v1-null-ancestry')::uuid;

CREATE FUNCTION pg_temp.refuses_input(label text,overrides jsonb,expected text DEFAULT '23514') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.refuses(label,format('SET ROLE service_role; SELECT public.synthetic_insert_episode(%L::jsonb)',
    (SELECT payload FROM public.synthetic_inputs WHERE n=1)||overrides),expected);
END $$;
SELECT pg_temp.refuses_input('wrong native event parent refused',jsonb_build_object('vehicle_id',md5('vehicle-2')::uuid)); RESET ROLE;
SELECT pg_temp.refuses_input('unknown native event reference refused',jsonb_build_object('source_vehicle_event_id',md5('missing')::uuid)); RESET ROLE;
SELECT pg_temp.refuses_input('wrong canonical source refused',jsonb_build_object('source_id',md5('source-other')::uuid)); RESET ROLE;
SELECT pg_temp.refuses_input('wrong source capture episode refused',jsonb_build_object('source_snapshot_id',md5('capture-2')::uuid)); RESET ROLE;
SELECT pg_temp.refuses_input('missing source capture FK refused','{"source_snapshot_id":null}'); RESET ROLE;
SELECT pg_temp.refuses_input('generic non-null ancestry has no method authority','{"extraction_method":"html_parse"}'); RESET ROLE;
SELECT pg_temp.refuses_input('preview method can never be admitted','{"extraction_method":"protected_archived_sale_episode_preview_v2"}'); RESET ROLE;
SELECT pg_temp.refuses_input('preview receipt badge can never be admitted',jsonb_build_object('structured_data',jsonb_build_object('source_sale_receipt',jsonb_build_object('method','protected_archived_sale_episode_preview_v2')))); RESET ROLE;
SELECT pg_temp.refuses_input('new admitted episode-v2 method is not installed','{"extraction_method":"protected_archived_sale_episode_observation_v2"}'); RESET ROLE;
SELECT pg_temp.refuses_input('missing pinned contexts refuse','{"extraction_metadata":{}}'); RESET ROLE;
SELECT pg_temp.refuses_input('unregistered extractor UUID is not a method identity',jsonb_build_object('extractor_id',md5('extractor')::uuid)); RESET ROLE;
SELECT pg_temp.refuses_input('source identifier is not globally arbitrary','{"source_identifier":"other"}'); RESET ROLE;
SELECT pg_temp.refuses_input('unsupported old parser label refuses new typed admission even with matching replay',jsonb_build_object(
  'structured_data',jsonb_set((SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1),'{source_sale_receipt,parser}','"batParser:1.0.0_sale_grammar_with_ambiguity_refusal"'),
  'source_identifier',replace((SELECT payload->>'source_identifier' FROM public.synthetic_inputs WHERE n=1),'batParser:1.0.0:strict_sale_tuple_v1','batParser:1.0.0_sale_grammar_with_ambiguity_refusal'))); RESET ROLE;
SELECT pg_temp.refuses_input('captured fee basis cannot become buyer total',jsonb_build_object('structured_data',jsonb_set((SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1),'{source_sale_receipt,price_basis}','"buyer_total"'))); RESET ROLE;
SELECT pg_temp.refuses_input('unknown captured currency is not guessed USD',jsonb_build_object('structured_data',jsonb_set((SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1),'{source_sale_receipt,currency}','null'))); RESET ROLE;
SELECT pg_temp.refuses_input('missing civil sale day cannot pass SQL NULL comparisons',jsonb_build_object('structured_data',(SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1)#-'{source_sale_receipt,event_day}')); RESET ROLE;
SELECT pg_temp.refuses_input('NULL civil sale day cannot pass SQL NULL comparisons',jsonb_build_object('structured_data',jsonb_set((SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1),'{source_sale_receipt,event_day}','null'))); RESET ROLE;
SELECT pg_temp.refuses_input('missing captured source URL cannot pass SQL NULL comparisons',jsonb_build_object('structured_data',(SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1)#-'{source_sale_receipt,source_url}')); RESET ROLE;
SELECT pg_temp.refuses_input('NULL captured source URL cannot pass SQL NULL comparisons',jsonb_build_object('structured_data',jsonb_set((SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1),'{source_sale_receipt,source_url}','null'))); RESET ROLE;
SELECT pg_temp.refuses_input('missing captured clock cannot pass SQL NULL comparisons',jsonb_build_object('structured_data',(SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1)#-'{source_sale_receipt,captured_at}')); RESET ROLE;
SELECT pg_temp.refuses_input('NULL captured clock cannot pass SQL NULL comparisons',jsonb_build_object('structured_data',jsonb_set((SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1),'{source_sale_receipt,source_ingested_at}','null'))); RESET ROLE;
SELECT pg_temp.refuses_input('date-only result cannot become exact close instant','{"observed_at":"2025-06-15T12:00:00Z"}'); RESET ROLE;
SELECT pg_temp.refuses_input('microsecond source clock discrepancy refuses',jsonb_build_object('structured_data',jsonb_set((SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1),'{source_sale_receipt,captured_at}','"2026-01-04T00:00:00.123457Z"'))); RESET ROLE;
SELECT pg_temp.refuses_input('unbounded or invalid captured bytes refuse',jsonb_build_object('structured_data',jsonb_set((SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1),'{source_sale_receipt,byte_length}','2097153'))); RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.refuses('user role cannot forge typed source authority','SELECT public.synthetic_insert_default(1)','42501');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT pg_temp.refuses('forged service badge cannot replace actual database service role','SELECT public.synthetic_insert_default(1)','42501');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.refuses('anon role cannot forge typed source authority','SELECT public.synthetic_insert_default(1)','42501');
RESET ROLE;

UPDATE public.vehicle_events SET final_price=1001 WHERE id=md5('episode-1')::uuid;
SELECT pg_temp.refuses_input('committed native mutation after producer proof is detected','{}'); RESET ROLE;
UPDATE public.vehicle_events SET final_price=1000 WHERE id=md5('episode-1')::uuid;
UPDATE public.observation_sources SET supported_observations=NULL WHERE slug='bat';
SELECT pg_temp.refuses_input('NULL canonical supported kinds cannot pass SQL NULL comparisons','{}'); RESET ROLE;
UPDATE public.observation_sources SET supported_observations=ARRAY['sale_result','comment']::public.observation_kind[] WHERE slug='bat';
UPDATE public.listing_page_snapshots SET metadata=jsonb_set(metadata,'{parsed_at}','"2026-01-06T00:00:00.123457Z"') WHERE id=md5('capture-1')::uuid;
SELECT pg_temp.refuses_input('committed protected header mutation is detected','{}'); RESET ROLE;
UPDATE public.listing_page_snapshots SET metadata=jsonb_set(metadata,'{parsed_at}','"2026-01-06T00:00:00.123456Z"') WHERE id=md5('capture-1')::uuid;
UPDATE public.listing_page_snapshots SET html=html||' MUTATION' WHERE id=md5('capture-1')::uuid;
SELECT pg_temp.refuses_input('inline bytes mutation without changed header SHA is detected','{}'); RESET ROLE;
UPDATE public.listing_page_snapshots SET html=replace(html,' MUTATION','') WHERE id=md5('capture-1')::uuid;
UPDATE public.vehicles SET is_public=false WHERE id=md5('vehicle-1')::uuid;
SELECT pg_temp.refuses_input('changed public parent is detected','{}'); RESET ROLE;
UPDATE public.vehicles SET is_public=true WHERE id=md5('vehicle-1')::uuid;
UPDATE public.listing_page_snapshots SET metadata=jsonb_set(metadata,'{vehicle_id}',to_jsonb(md5('vehicle-2')::uuid)) WHERE id=md5('capture-1')::uuid;
SELECT pg_temp.refuses_input('wrong protected capture parent refuses even with freshly pinned headers',jsonb_build_object('extraction_metadata',public.synthetic_episode_input(1)->'extraction_metadata')); RESET ROLE;
UPDATE public.listing_page_snapshots SET metadata=jsonb_set(metadata,'{vehicle_id}',to_jsonb(md5('vehicle-1')::uuid)) WHERE id=md5('capture-1')::uuid;
UPDATE public.vehicle_events SET source_platform='mecum' WHERE id=md5('episode-1')::uuid;
SELECT pg_temp.refuses_input('wrong native source platform refuses rather than inheriting BaT units',jsonb_build_object('extraction_metadata',public.synthetic_episode_input(1)->'extraction_metadata')); RESET ROLE;
UPDATE public.vehicle_events SET source_platform='bat' WHERE id=md5('episode-1')::uuid;
UPDATE public.vehicle_events SET source_listing_id='bringatrailer.com/listing/contradictory' WHERE id=md5('episode-1')::uuid;
SELECT pg_temp.refuses_input('contradictory native source URL identity is detected with fresh context',jsonb_build_object('extraction_metadata',public.synthetic_episode_input(1)->'extraction_metadata')); RESET ROLE;
UPDATE public.vehicle_events SET source_listing_id='bringatrailer.com/listing/synthetic-1' WHERE id=md5('episode-1')::uuid;
UPDATE public.vehicle_events SET event_status='unsold' WHERE id=md5('episode-1')::uuid;
SELECT pg_temp.refuses_input('native unsold versus captured sold is preserved as conflict',jsonb_build_object('extraction_metadata',public.synthetic_episode_input(1)->'extraction_metadata')); RESET ROLE;
UPDATE public.vehicle_events SET event_status='sold' WHERE id=md5('episode-1')::uuid;
UPDATE public.vehicle_events SET created_at=NULL,updated_at=NULL,extracted_at=NULL,sold_at=NULL,final_price=NULL,event_status='ended' WHERE id=md5('episode-1')::uuid;
UPDATE public.synthetic_inputs SET payload=jsonb_set(payload,'{extraction_metadata,source_episode_context}',to_jsonb(e)) FROM public.vehicle_events e WHERE synthetic_inputs.n=1 AND e.id=md5('episode-1')::uuid;
SELECT pg_temp.refuses_input('unknown native clocks do not allow NULL day plus NULL observed clock',jsonb_build_object('observed_at',NULL,'structured_data',jsonb_set((SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1),'{source_sale_receipt,event_day}','null'))); RESET ROLE;
SET ROLE service_role;
SELECT public.synthetic_insert_default(1);
RESET ROLE;
SELECT pg_temp.ok('unknown native amount/outcome/clocks stay compatible without inference',EXISTS(SELECT FROM public.vehicle_observations WHERE id=md5('claim-1')::uuid));
DELETE FROM public.vehicle_observations WHERE source_vehicle_event_id IS NOT NULL;
UPDATE public.vehicle_events SET created_at='2026-01-01T00:00:00.123456Z',updated_at='2026-01-02T00:00:00.123456Z',extracted_at='2026-01-03T00:00:00.123456Z',sold_at='2025-06-15Z',final_price=1000,event_status='sold' WHERE id=md5('episode-1')::uuid;
UPDATE public.synthetic_inputs SET payload=public.synthetic_episode_input(n);
INSERT INTO public.auction_events VALUES(md5('auction-1')::uuid,md5('vehicle-1')::uuid);
INSERT INTO public.auction_comments VALUES(md5('comment-1')::uuid,md5('vehicle-1')::uuid,'2025-01-01T12:00:00Z',NULL,'comment','SYNTHETIC exact comment quote',md5('auction-1')::uuid);
SET ROLE service_role;
INSERT INTO public.vehicle_observations(vehicle_id,source_comment_id,kind,observed_at,content_text,structured_data,confidence_score)
 VALUES(md5('vehicle-1')::uuid,md5('comment-1')::uuid,'comment','2025-01-01T12:00:00Z','exact comment quote','{"is_inferred":true}',0.6);
RESET ROLE;
SELECT pg_temp.ok('existing exact nonbid comment contract still accepts valid quote',EXISTS(SELECT FROM public.vehicle_observations WHERE source_comment_id=md5('comment-1')::uuid));
SELECT pg_temp.refuses('existing sourced comment quote cannot be fabricated','UPDATE public.vehicle_observations SET content_text=''fabricated'' WHERE source_comment_id=md5(''comment-1'')::uuid');
SELECT pg_temp.refuses('existing sourced comment cannot lose source link','UPDATE public.vehicle_observations SET source_comment_id=NULL WHERE source_comment_id=md5(''comment-1'')::uuid');
SELECT pg_temp.ok('no admitted episode-v2 method or new RPC created',NOT EXISTS(SELECT FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE '%admit%episode%'));
-- Inputs and schema remain ready for the runner's real two-session lock/replay tests.
