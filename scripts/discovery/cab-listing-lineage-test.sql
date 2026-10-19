-- Only included by the existing disposable PG17 source-integrity harness.
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_sale_episode_integrity_%' THEN
  RAISE EXCEPTION 'Requires the isolated synthetic source-integrity database';
 END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;
CREATE FUNCTION pg_temp.refuses(label text,statement text,expected text DEFAULT '23514') RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE; END;
 PERFORM pg_temp.ok(label,actual=expected);
END $$;
ALTER TABLE public.vehicle_observations ADD COLUMN source_observation_id uuid REFERENCES public.vehicle_observations;
ALTER TABLE public.vehicle_observations ADD COLUMN property_id uuid;
ALTER TABLE public.vehicle_observations ADD COLUMN auction_event_id uuid REFERENCES public.auction_events;
ALTER TABLE public.auction_events ADD COLUMN source text, ADD COLUMN source_url text, ADD COLUMN source_listing_id text;
ALTER TABLE public.listing_page_snapshots ADD COLUMN markdown text;
ALTER TYPE public.observation_kind ADD VALUE 'activity';
ALTER TYPE public.observation_kind ADD VALUE 'specification';
ALTER TYPE public.observation_kind ADD VALUE 'bid';
ALTER TYPE public.observation_kind ADD VALUE 'condition';
ALTER TYPE public.observation_kind ADD VALUE 'provenance';
ALTER TYPE public.observation_kind ADD VALUE 'media';
ALTER TYPE public.observation_kind ADD VALUE 'splice';
\ir cab-retained-guard.fixture.sql
CREATE TRIGGER trg_retained_listing_property_source_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
WHEN (NEW.source_observation_id IS NOT NULL) EXECUTE FUNCTION public.validate_retained_listing_property_source();
CREATE TRIGGER trg_retained_listing_property_source_update BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW
WHEN (OLD.source_observation_id IS NOT NULL OR NEW.source_observation_id IS NOT NULL)
EXECUTE FUNCTION public.validate_retained_listing_property_source();
\ir ../../supabase/migrations/20261018230628_cab_listing_capture_custody.sql
GRANT SELECT ON public.vehicles,public.observation_sources,public.vehicle_events,public.auction_events,public.listing_page_snapshots TO service_role;
-- FOR SHARE requires UPDATE privilege; mirror the existing service role, not public access.
GRANT UPDATE ON public.vehicles,public.observation_sources,public.vehicle_events,public.auction_events,public.listing_page_snapshots TO service_role;
INSERT INTO public.observation_sources VALUES(md5('source-cab')::uuid,'cars-and-bids',ARRAY['listing']::public.observation_kind[]);
INSERT INTO public.vehicle_events(id,vehicle_id,source_platform,source_url,source_listing_id)
VALUES(md5('cab-episode')::uuid,md5('vehicle-1')::uuid,'cars_and_bids','https://carsandbids.com/auctions/AbC123/synthetic-lot','AbC123');
INSERT INTO public.auction_events VALUES(md5('cab-auction')::uuid,md5('vehicle-1')::uuid,'cars_and_bids',
 'https://carsandbids.com/auctions/AbC123/synthetic-lot','AbC123');
INSERT INTO public.listing_page_snapshots(id,platform,listing_url,success,http_status,html,html_sha256,fetched_at,created_at,metadata)
VALUES(md5('cab-snapshot')::uuid,'carsandbids','https://carsandbids.com/auctions/AbC123/synthetic-lot',true,200,
 E'<!-- cab-v2-api-json:AbC123 class="bid-bar ended" -->\n<script id="cab-v2-json" type="application/json">{"detail":{"id":"AbC123","listing":{"sub_title":"Synthetic retained narrative","sections":{"highlights":"Publisher claim, not physical truth","known_flaws":"A source-reported flaw"}}}}</script>',
 NULL,'2026-01-01T00:00:00.123456Z','2026-01-01T00:00:01.123456Z','{"auction_id":"AbC123"}');
UPDATE public.listing_page_snapshots SET html_sha256=encode(sha256(convert_to(html,'UTF8')),'hex') WHERE id=md5('cab-snapshot')::uuid;
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,source_identifier,source_url,kind,observed_at,ingested_at,content_text,structured_data,extraction_method,confidence_score)
VALUES(md5('cab-original')::uuid,md5('vehicle-1')::uuid,md5('source-cab')::uuid,'AbC123','https://carsandbids.com/auctions/AbC123/synthetic-lot',
 'listing','2026-01-01T00:00:00.123456Z','2026-01-01T00:00:02.123456Z',
 E'Synthetic retained narrative\n\n**Highlights:**\nPublisher claim, not physical truth\n\n**Known Flaws:**\nA source-reported flaw',
 '{"cab_auction_id":"AbC123","engine_type":"UNVERIFIED_INTERPRETATION"}','cab_v2_api',0.8);
CREATE FUNCTION public.synthetic_cab_qualification(p_result uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.qualify_cab_listing_capture(md5('cab-original')::uuid,md5('cab-snapshot')::uuid,md5('cab-auction')::uuid,p_result)
$$;
CREATE FUNCTION public.synthetic_insert_cab_receipt(payload jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o public.vehicle_observations%ROWTYPE;
BEGIN
 o:=jsonb_populate_record(NULL::public.vehicle_observations,payload||jsonb_build_object('id',gen_random_uuid(),'ingested_at',transaction_timestamp(),'is_superseded',false));
 INSERT INTO public.vehicle_observations SELECT o.*;
 RETURN o.id;
END $$;
SELECT pg_temp.ok('C&B qualifier grants no public or authenticated access',
 has_function_privilege('service_role','public.qualify_cab_listing_capture(uuid,uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.qualify_cab_listing_capture(uuid,uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.qualify_cab_listing_capture(uuid,uuid,uuid,uuid)','EXECUTE'));
SELECT pg_temp.ok('retained raw UTF8 bytes and exact narrative independently qualify',public.synthetic_cab_qualification()->>'ok'='true');
SELECT pg_temp.ok('receipt promotes no original specification and copies no source prose',
 public.synthetic_cab_qualification()->'input'->'structured_data'->'listing_capture_receipt'->>'scope'='attributed_listing_narrative_only'
 AND public.synthetic_cab_qualification()::text NOT LIKE '%UNVERIFIED_INTERPRETATION%'
 AND public.synthetic_cab_qualification()::text NOT LIKE '%Publisher claim%');
SET ROLE service_role;
SELECT public.synthetic_insert_cab_receipt(public.synthetic_cab_qualification()->'input');
RESET ROLE;
SELECT pg_temp.ok('current reader verifies the actual stored receipt',
 public.synthetic_cab_qualification((SELECT id FROM public.vehicle_observations WHERE extraction_method='protected_cab_listing_capture_v1'))->>'result_verified'='true');
SELECT pg_temp.ok('actual visibility predicate keeps internal provenance off the public listing surface',
 (SELECT kind='provenance' AND NOT public.observation_is_public(kind,structured_data)
 FROM public.vehicle_observations WHERE extraction_method='protected_cab_listing_capture_v1'));
SELECT pg_temp.ok('original testimony remains unchanged and active',
 (SELECT NOT is_superseded AND source_snapshot_id IS NULL AND source_vehicle_event_id IS NULL
 AND structured_data->>'engine_type'='UNVERIFIED_INTERPRETATION' FROM public.vehicle_observations WHERE id=md5('cab-original')::uuid));
-- A provenance link to the stable auction lot must not freeze the replaceable
-- native vehicle_events state row used by sanctioned episode correction.
DELETE FROM public.vehicle_events WHERE id=md5('cab-episode')::uuid;
SELECT pg_temp.ok('native state replacement remains possible without breaking auction-lot provenance',
 public.synthetic_cab_qualification((SELECT id FROM public.vehicle_observations WHERE extraction_method='protected_cab_listing_capture_v1'))->>'result_verified'='true');
SELECT pg_temp.ok('provenance uses the existing auction FK and leaves native source ancestry NULL',
 (SELECT auction_event_id=md5('cab-auction')::uuid AND source_vehicle_event_id IS NULL
 FROM public.vehicle_observations WHERE extraction_method='protected_cab_listing_capture_v1'));
SELECT pg_temp.refuses('duplicate receipt yields one replay tuple',
 'SET ROLE service_role; SELECT public.synthetic_insert_cab_receipt(public.synthetic_cab_qualification()->''input'')','23505'); RESET ROLE;
SELECT pg_temp.refuses('caller cannot change independently derived scope',
 'SET ROLE service_role; SELECT public.synthetic_insert_cab_receipt(jsonb_set(public.synthetic_cab_qualification()->''input'',''{structured_data,listing_capture_receipt,specification_truth}'',''"verified"''))'); RESET ROLE;
SELECT pg_temp.refuses('generic source link cannot mint a C&B sale',
 'SET ROLE service_role; SELECT public.synthetic_insert_cab_receipt((public.synthetic_cab_qualification()->''input'')||''{"kind":"sale_result"}''::jsonb)'); RESET ROLE;
SELECT pg_temp.refuses('C&B protected method cannot drop typed ancestry',
 'SET ROLE service_role; SELECT public.synthetic_insert_cab_receipt((public.synthetic_cab_qualification()->''input'')||''{"auction_event_id":null}''::jsonb)'); RESET ROLE;
SELECT pg_temp.refuses('receipt cannot be changed in place',
 'UPDATE public.vehicle_observations SET structured_data=''{}'' WHERE extraction_method=''protected_cab_listing_capture_v1''');
UPDATE public.vehicle_observations SET is_superseded=true WHERE extraction_method='protected_cab_listing_capture_v1';
SELECT pg_temp.ok('withdrawn receipt is not current evidence',public.synthetic_cab_qualification(
 (SELECT id FROM public.vehicle_observations WHERE extraction_method='protected_cab_listing_capture_v1'))->>'ok'='false');
UPDATE public.vehicle_observations SET is_superseded=false WHERE extraction_method='protected_cab_listing_capture_v1';
UPDATE public.vehicle_observations SET is_superseded=true WHERE id=md5('cab-original')::uuid;
SELECT pg_temp.ok('original withdrawal invalidates current custody',public.synthetic_cab_qualification()->>'reason'='original_listing_ineligible');
UPDATE public.vehicle_observations SET is_superseded=false WHERE id=md5('cab-original')::uuid;
UPDATE public.vehicles SET is_public=false WHERE id=md5('vehicle-1')::uuid;
SELECT pg_temp.ok('private parent withholds the receipt without source output',public.synthetic_cab_qualification()=jsonb_build_object('ok',false,'reason','parent_not_public_real_vehicle'));
UPDATE public.vehicles SET is_public=true WHERE id=md5('vehicle-1')::uuid;
UPDATE public.auction_events SET source_listing_id='abc123' WHERE id=md5('cab-auction')::uuid;
SELECT pg_temp.ok('base62 case mismatch is not normalized into a match',public.synthetic_cab_qualification()->>'reason'='source_listing_identity_mismatch');
UPDATE public.auction_events SET source_listing_id='AbC123' WHERE id=md5('cab-auction')::uuid;
UPDATE public.listing_page_snapshots SET html=html||'changed' WHERE id=md5('cab-snapshot')::uuid;
SELECT pg_temp.ok('changed retained bytes invalidate header badge',public.synthetic_cab_qualification()->>'reason'='inline_capture_unverified');
UPDATE public.listing_page_snapshots SET html=left(html,length(html)-7) WHERE id=md5('cab-snapshot')::uuid;
UPDATE public.vehicle_observations SET observed_at=observed_at+interval '1 microsecond' WHERE id=md5('cab-original')::uuid;
SELECT pg_temp.ok('microsecond clock mismatch is not rounded away',public.synthetic_cab_qualification()->>'reason'='source_clock_or_trust_unestablished');
UPDATE public.vehicle_observations SET observed_at=observed_at-interval '1 microsecond' WHERE id=md5('cab-original')::uuid;
UPDATE public.observation_sources SET supported_observations='{}' WHERE id=md5('source-cab')::uuid;
SELECT pg_temp.ok('withdrawn source capability invalidates the receipt',public.synthetic_cab_qualification()->>'reason'='source_not_supported');
UPDATE public.observation_sources SET supported_observations=ARRAY['listing']::public.observation_kind[] WHERE id=md5('source-cab')::uuid;
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"email":"synthetic@example.invalid"}' WHERE id=md5('cab-original')::uuid;
SELECT pg_temp.ok('owning observation privacy predicate withholds original',public.synthetic_cab_qualification()->>'reason'='original_listing_ineligible');
UPDATE public.vehicle_observations SET structured_data=structured_data-'email' WHERE id=md5('cab-original')::uuid;
SET ROLE anon;
SELECT pg_temp.refuses('anonymous selector cannot read protected source','SELECT public.qualify_cab_listing_capture(md5(''cab-original'')::uuid,md5(''cab-snapshot'')::uuid,md5(''cab-auction'')::uuid)','42501');
RESET ROLE;
-- Retain source inputs for actual-handler and two-session tests; remove only synthetic derived receipts.
DELETE FROM public.vehicle_observations WHERE extraction_method='protected_cab_listing_capture_v1';
