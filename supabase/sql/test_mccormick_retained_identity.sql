-- Only synthetic JSON-backed testimony in a disposable PG17 database.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database required';END IF;END $$;
CREATE TYPE public.observation_kind AS ENUM('listing','specification');
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text,species text,supported_observations public.observation_kind[]);
INSERT INTO public.observation_sources VALUES('006f01c3-e5fb-44f5-ab40-e55b0654de1c','mccormicks','block_house',ARRAY['listing']::public.observation_kind[]);
CREATE VIEW public.vehicle_observations AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.observations',true),''),'[]')::jsonb)
 AS r(id uuid,vehicle_id uuid,source_id uuid,source_url text,kind text,is_superseded boolean,property_id uuid,subject_type text,subject_id uuid,
 extraction_method text,structured_data jsonb,extraction_metadata jsonb,raw_source_ref text,source_identifier text,observed_at timestamptz,
 ingested_at timestamptz,confidence_score numeric,agent_cost_cents numeric,agent_model text,content_hash text,source_observation_id uuid);
CREATE VIEW public.vehicles AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.vehicles',true),''),'[]')::jsonb)
 AS r(id uuid,is_public boolean,deleted_at timestamptz,listing_kind text,listing_url text,discovery_url text,year integer,make text,model text);
CREATE VIEW public.listing_page_snapshots AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.snapshots',true),''),'[]')::jsonb)
 AS r(id uuid,success boolean,http_status integer,platform text,listing_url text,html_sha256 text,fetched_at timestamptz,created_at timestamptz,metadata jsonb);
CREATE FUNCTION public.observation_is_public(text,jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
\ir fixtures/mccormick_keying_baseline.sql
DO $fixture$
DECLARE p jsonb;v jsonb;s jsonb;
BEGIN
 p:=jsonb_build_object('id','11111111-1111-4111-8111-111111111111','vehicle_id','22222222-2222-4222-8222-222222222222',
 'source_id','006f01c3-e5fb-44f5-ab40-e55b0654de1c','source_url','https://www.classic-carauction.com/auction-results?auctionnbr=58&auctionid=7309',
 'kind','listing','is_superseded',false,'subject_type','vehicle','extraction_method','mccormick_html_v1',
 'raw_source_ref','listing_page_snapshots:44444444-4444-4444-8444-444444444444','source_identifier','auctionid:7309:'||repeat('a',64),
 'observed_at','2026-11-09T00:00:00.123456Z','ingested_at','2026-11-09T00:01:00.123456Z','confidence_score',0.70,
 'structured_data',jsonb_build_object('year',1978,'make','Example Manufacturer','model','Prototype GT','vin','1FAFP45X0YF123456',
  'source_id','7309','parser','mccormick_html_v1','presentation','archive','auction_number','58',
  'source_claims_only',true,'source_event_at',NULL,'source_captured_at','2026-11-09T00:00:00.123456Z'),
 'extraction_metadata',jsonb_build_object('parser','mccormick_html_v1','snapshot_id','44444444-4444-4444-8444-444444444444','html_sha256',repeat('a',64)));
 v:=jsonb_build_object('id',p->>'vehicle_id','is_public',true,'listing_kind','vehicle');
 s:=jsonb_build_object('id','44444444-4444-4444-8444-444444444444','success',true,'http_status',200,'platform','mccormicks',
 'listing_url',p->>'source_url','html_sha256',repeat('a',64),'fetched_at',p->>'observed_at','created_at',p->>'observed_at');
 PERFORM set_config('test.observations',jsonb_build_array(p)::text,false);
 PERFORM set_config('test.vehicles',jsonb_build_array(v)::text,false);
 PERFORM set_config('test.snapshots',jsonb_build_array(s)::text,false);
 PERFORM set_config('test.base',p::text,false);
 PERFORM set_config('test.base_vehicle',v::text,false);
 PERFORM set_config('test.base_snapshot',s::text,false);
 IF (SELECT public.retained_native_listing_source(o) FROM public.vehicle_observations o) THEN RAISE EXCEPTION 'baseline unexpectedly accepts McCormick';END IF;
END $fixture$;
\ir ../migrations/20261111032100_mccormick_retained_identity_keys.sql
\ir ../migrations/20261111032100_mccormick_retained_identity_keys.sql
\ir ../migrations/20261111034900_mccormick_capture_query_order.sql
\ir ../migrations/20261111034900_mccormick_capture_query_order.sql
DO $contract$
DECLARE p public.vehicle_observations;o public.vehicle_observations;j jsonb;base jsonb:=current_setting('test.base')::jsonb;patch jsonb;k text;child jsonb;v jsonb;s jsonb;url text;native text;presentation text;
BEGIN
 SELECT * INTO p FROM public.vehicle_observations;
 IF public.retained_native_listing_source(p) IS DISTINCT FROM true THEN RAISE EXCEPTION 'captured public archive ineligible';END IF;
 IF (SELECT cardinality(supported_observations) FROM public.observation_sources WHERE slug='mccormicks')<>2 THEN RAISE EXCEPTION 'registration replay duplicated kind';END IF;
 FOREACH k IN ARRAY ARRAY['year','make','model','vin'] LOOP
  child:=jsonb_build_object('id','55555555-5555-4555-8555-555555555555','vehicle_id',p.vehicle_id,'source_id',p.source_id,
   'source_url',p.source_url,'kind','specification','is_superseded',false,'subject_type','vehicle',
   'source_observation_id',p.id,'extraction_method','retained_listing_property_projection_v1',
   'observed_at',p.ingested_at,'source_identifier','retained_listing_'||k||'_v1:'||p.id::text,
   'raw_source_ref','vehicle_observations:'||p.id::text,'confidence_score',0.6,'agent_cost_cents',0,'content_hash','synthetic',
   'structured_data',jsonb_build_object(k,p.structured_data->k,'source_value',p.structured_data->k,
    'normalization_version','retained_listing_identity_labels_v1','source_observation_id',p.id,'property_key',k,'source_field',k,
    'analysis_kind','retained_listing_property_projection','projection_version','retained_listing_'||k||'_v1','claim_role','listing_claim',
    'observed_at_basis','source_testimony_recorded_at','identity_role','extractor_vehicle_label','identity_resolution_status','unverified',
    'source_event_time_status','unknown','factory_configuration_status','unknown','current_configuration_status','unknown',
    'independent_source',false,'source_recorded_at',p.ingested_at,'source_observed_at',p.observed_at,'source_confidence_score',p.confidence_score,
    'source_extraction_method',p.extraction_method,'vin_identifier_namespace','standard_17_character_vin_label','vin_format_status','17_character_format','vin_checksum_status','not_evaluated'));
  SELECT * INTO o FROM jsonb_populate_record(NULL::public.vehicle_observations,child);
  IF public.retained_listing_identity_value_matches(p,o) IS DISTINCT FROM true THEN RAISE EXCEPTION 'identity child not connected: %',k;END IF;
  SELECT * INTO o FROM jsonb_populate_record(NULL::public.vehicle_observations,child||jsonb_build_object('structured_data',child->'structured_data'||jsonb_build_object(k,'wrong')));
  IF public.retained_listing_identity_value_matches(p,o) THEN RAISE EXCEPTION 'changed child admitted: %',k;END IF;
 END LOOP;
 FOR patch IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('is_superseded',true),jsonb_build_object('vehicle_id',NULL),
  jsonb_build_object('extraction_method','mccormick_catalog_v1'),
  jsonb_build_object('source_url',p.source_url||'&junk=1'),
  jsonb_build_object('source_identifier','wrong'),
  jsonb_build_object('structured_data',p.structured_data||jsonb_build_object('source_id','9999')),
  jsonb_build_object('structured_data',p.structured_data||jsonb_build_object('color','red')),
  jsonb_build_object('structured_data',p.structured_data||jsonb_build_object('source_event_at','2020-01-01')),
  jsonb_build_object('structured_data',p.structured_data||jsonb_build_object('source_captured_at','2026-11-09T00:00:00.123455Z')),
  jsonb_build_object('extraction_metadata',p.extraction_metadata||jsonb_build_object('html_sha256',repeat('b',64))),
  jsonb_build_object('extraction_metadata',p.extraction_metadata||jsonb_build_object('snapshot_id','not-a-uuid')))) LOOP
  PERFORM set_config('test.observations',jsonb_build_array(base||patch)::text,false);
  SELECT * INTO p FROM public.vehicle_observations;
  IF public.retained_native_listing_source(p) THEN RAISE EXCEPTION 'invalid source accepted %',patch;END IF;
 END LOOP;
 PERFORM set_config('test.observations',jsonb_build_array(base)::text,false);SELECT * INTO p FROM public.vehicle_observations;
 FOR patch IN SELECT value FROM jsonb_array_elements('[{"is_public":false},{"deleted_at":"2020-01-01"},{"listing_kind":"non_vehicle_item"}]'::jsonb) LOOP
  PERFORM set_config('test.vehicles',jsonb_build_array(current_setting('test.base_vehicle')::jsonb||patch)::text,false);
  IF public.retained_native_listing_source(p) THEN RAISE EXCEPTION 'excluded parent accepted %',patch;END IF;
 END LOOP;
 PERFORM set_config('test.vehicles',jsonb_build_array(current_setting('test.base_vehicle')::jsonb)::text,false);
 -- Actual retained archive fetches sort auctionid before auctionnbr.
 FOR url IN SELECT unnest(ARRAY[p.source_url,'https://www.classic-carauction.com/auction-results?auctionid=7309&auctionnbr=58']) LOOP
  PERFORM set_config('test.snapshots',jsonb_build_array(current_setting('test.base_snapshot')::jsonb||jsonb_build_object('listing_url',url))::text,false);
  IF public.retained_native_listing_source(p) IS DISTINCT FROM true THEN RAISE EXCEPTION 'equivalent archive parameter order refused';END IF;
 END LOOP;
 FOR patch IN SELECT value FROM jsonb_array_elements('[{"success":false},{"http_status":403},{"platform":"other"},{"listing_url":"https://example.com"},{"listing_url":"https://www.classic-carauction.com/auction-results?auctionid=7309&auctionnbr=58&extra=1"},{"listing_url":"https://www.classic-carauction.com/auction-results?auctionid=7310&auctionnbr=58"},{"listing_url":"https://www.classic-carauction.com/auction-results?auctionid=7309&auctionnbr=59"},{"html_sha256":"bad"},{"fetched_at":"2026-11-09T00:00:00.123455Z"},{"created_at":"2026-11-10T00:00:00Z"}]'::jsonb) LOOP
  PERFORM set_config('test.snapshots',jsonb_build_array(current_setting('test.base_snapshot')::jsonb||patch)::text,false);
  IF public.retained_native_listing_source(p) THEN RAISE EXCEPTION 'broken snapshot accepted %',patch;END IF;
 END LOOP;
 -- The same source proof must cover current public and showroom namespaces.
 FOR native,url,presentation IN SELECT * FROM (VALUES
  ('7309','https://www.classic-carauction.com/auction-cars?auctionid=7309','unknown'),
  ('showroom:7309','https://www.classic-carauction.com/Showroom-Inventory?sp=1&id=7309','showroom')) x(id,url,presentation) LOOP
  j:=base||jsonb_build_object('source_url',url,'source_identifier','auctionid:'||native||':'||repeat('a',64),
   'structured_data',base->'structured_data'||jsonb_build_object('source_id',native,'presentation',presentation));
  s:=current_setting('test.base_snapshot')::jsonb||jsonb_build_object('listing_url',url);
  PERFORM set_config('test.observations',jsonb_build_array(j)::text,false);PERFORM set_config('test.snapshots',jsonb_build_array(s)::text,false);
  SELECT * INTO p FROM public.vehicle_observations;
  IF public.retained_native_listing_source(p) IS DISTINCT FROM true THEN RAISE EXCEPTION 'native namespace refused %',native;END IF;
  IF presentation='showroom' THEN
   PERFORM set_config('test.snapshots',jsonb_build_array(s||jsonb_build_object('listing_url','https://www.classic-carauction.com/Showroom-Inventory?id=7309&sp=1'))::text,false);
   IF public.retained_native_listing_source(p) IS DISTINCT FROM true THEN RAISE EXCEPTION 'equivalent showroom parameter order refused';END IF;
   PERFORM set_config('test.snapshots',jsonb_build_array(s||jsonb_build_object('listing_url','https://www.classic-carauction.com/Showroom-Inventory?id=7310&sp=1'))::text,false);
   IF public.retained_native_listing_source(p) THEN RAISE EXCEPTION 'other showroom stock accepted';END IF;
  END IF;
 END LOOP;
 RAISE NOTICE 'PASS: native capture proof, identity child linkage, replay and privacy/mutation refusals';
END $contract$;
