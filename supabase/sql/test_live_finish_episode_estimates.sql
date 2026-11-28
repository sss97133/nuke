-- Empty disposable PG17 dm_refinement_* database only. Synthetic rows; never run on production.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.hammer_predictions') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.ok(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF value IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, listing_kind text);
CREATE TABLE public.auction_events_canonical (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id), source text,
  source_url text, outcome text, auction_end_date timestamptz);
CREATE TABLE public.hammer_predictions (vehicle_id uuid REFERENCES public.vehicles(id), model_version int, predicted_hammer numeric,
  predicted_low numeric, predicted_high numeric, confidence_score numeric, current_bid numeric,
  predicted_at timestamptz, notes text);
CREATE TABLE public.test_board (payload jsonb);
CREATE FUNCTION public.market_pulse_live() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT payload FROM public.test_board $$;

INSERT INTO public.vehicles VALUES
 ('00000000-0000-4000-8000-000000000101', true, null, 'vehicle'),
 ('00000000-0000-4000-8000-000000000102', false, null, 'vehicle');
INSERT INTO public.auction_events_canonical VALUES
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','bat',
  'https://bringatrailer.com/listing/fixture-relisted-car','live',now()+interval '7 hours'),
 ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','bat',
  'https://bringatrailer.com/listing/fixture-private-car','live',now()+interval '7 hours');
INSERT INTO public.test_board SELECT jsonb_build_object(
 'auctions', jsonb_build_array(
  jsonb_build_array('00000000-0000-4000-8000-000000000101',1965,'Ford','Mustang',30000,now()+interval '7 hours',null,null,null,false,'https://bringatrailer.com/listing/fixture-relisted-car','Fixture'),
  jsonb_build_array('00000000-0000-4000-8000-000000000102',1965,'Ford','Mustang',30000,now()+interval '7 hours',null,null,null,false,'https://bringatrailer.com/listing/fixture-private-car','Private fixture')),
 'identity_links',jsonb_build_object(
  'https://bringatrailer.com/listing/fixture-relisted-car',jsonb_build_object('applied',true,'basis','retained_native_current_episode',
    'canonical_vehicle_id','00000000-0000-4000-8000-000000000101','auction_event_id','00000000-0000-4000-8000-000000000201'),
  'https://bringatrailer.com/listing/fixture-private-car',jsonb_build_object('applied',true,'basis','retained_native_current_episode',
    'canonical_vehicle_id','00000000-0000-4000-8000-000000000102','auction_event_id','00000000-0000-4000-8000-000000000202')));
INSERT INTO public.hammer_predictions VALUES
 ('00000000-0000-4000-8000-000000000101',32,40000,35000,50000,0.8,30000,now()-interval '10 minutes',
  '{"source_event_id":"00000000-0000-4000-8000-000000000201","source_listing_url":"https://bringatrailer.com/listing/fixture-relisted-car","source_identity_basis":"retained_native_current_episode","grade":"A","private_note":"do not expose","analogs":[{"title":"Comparable","final":39000,"private":"do not expose"},{"title":{"secret":"do not expose"},"url":{"secret":"do not expose"},"closed":{"secret":"do not expose"},"bid":{"secret":"do not expose"},"final":{"secret":"do not expose"},"outcome":{"secret":"do not expose"}}]}'),
 -- Newer prediction for a different presentation of the same car must never win.
 ('00000000-0000-4000-8000-000000000101',32,90000,80000,100000,0.8,30000,now()-interval '1 minute',
  '{"source_event_id":"00000000-0000-4000-8000-000000000299","source_listing_url":"https://bringatrailer.com/listing/fixture-other","source_identity_basis":"retained_native_current_episode"}'),
 ('00000000-0000-4000-8000-000000000102',32,41000,35000,51000,0.8,30000,now()-interval '2 minutes',
  '{"source_event_id":"00000000-0000-4000-8000-000000000202","source_listing_url":"https://bringatrailer.com/listing/fixture-private-car","source_identity_basis":"retained_native_current_episode"}');

\ir ../migrations/20261128111352_live_finish_episode_estimates.sql

SET ROLE anon;
SELECT pg_temp.ok('direct prediction table is not readable', NOT has_table_privilege('anon','public.hammer_predictions','SELECT'));
SELECT pg_temp.ok('exact public episode returns its own prediction and allowlisted comparable', (
  SELECT j->>'fresh' = 'true' AND jsonb_array_length(j->'rows') = 1
    AND (j->'rows'->0->>'estimate')::numeric = 40000
    AND j->'rows'->0->>'auction_event_id' = '00000000-0000-4000-8000-000000000201'
    AND j->'rows'->0->'analogs'->0->>'title' = 'Comparable'
    AND position('do not expose' IN j::text) = 0
  FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
SELECT pg_temp.ok('private vehicle is withheld even if board fixture is wrong', (
  SELECT j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000102","listing_url":"https://bringatrailer.com/listing/fixture-private-car"}]') j) q));
SELECT pg_temp.ok('wrong URL or malformed ID is withheld', (
  SELECT j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"bad","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"},{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-other"}]') j) q));
DO $$ BEGIN
  BEGIN PERFORM public.live_finish_episode_estimates('[]'::jsonb); RAISE EXCEPTION 'empty input accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.live_finish_episode_estimates((SELECT jsonb_agg('{}'::jsonb) FROM generate_series(1,41)));
    RAISE EXCEPTION 'oversized input accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.hammer_predictions SET predicted_at=now()+interval '1 day';
SET ROLE anon;
SELECT pg_temp.ok('future writer clock is not fresh', (
  SELECT j->>'fresh' = 'false' AND j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
UPDATE public.hammer_predictions SET predicted_at=now()-interval '5 minutes';
SET ROLE anon;
SELECT pg_temp.ok('fresh test context restored', (
  SELECT j->>'fresh' = 'true' AND jsonb_array_length(j->'rows') = 1 FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
UPDATE public.auction_events_canonical SET source_url='https://bringatrailer.com/listing/fixture-other'
 WHERE id='00000000-0000-4000-8000-000000000201';
SET ROLE anon;
SELECT pg_temp.ok('event from another listing is withheld', (
  SELECT j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
UPDATE public.auction_events_canonical SET source_url='https://bringatrailer.com/listing/fixture-relisted-car'
 WHERE id='00000000-0000-4000-8000-000000000201';
UPDATE public.hammer_predictions SET notes=jsonb_set(notes::jsonb,'{source_event_id}','"00000000-0000-4000-8000-000000000299"')::text
 WHERE notes::jsonb->>'source_event_id'='00000000-0000-4000-8000-000000000201';
SET ROLE anon;
SELECT pg_temp.ok('prediction without the matching event receipt is withheld', (
  SELECT j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
UPDATE public.hammer_predictions SET notes=jsonb_set(notes::jsonb,'{source_event_id}','"00000000-0000-4000-8000-000000000201"')::text
 WHERE notes::jsonb->>'source_listing_url'='https://bringatrailer.com/listing/fixture-relisted-car';

UPDATE public.test_board SET payload=jsonb_set(payload,
  ARRAY['identity_links','https://bringatrailer.com/listing/fixture-relisted-car','applied'],'false');
SET ROLE anon;
SELECT pg_temp.ok('refused identity link is withheld', (
  SELECT j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
UPDATE public.test_board SET payload=jsonb_set(payload,
  ARRAY['identity_links','https://bringatrailer.com/listing/fixture-relisted-car','applied'],'true');
UPDATE public.auction_events_canonical SET outcome='sold' WHERE id='00000000-0000-4000-8000-000000000201';
SET ROLE anon;
SELECT pg_temp.ok('terminal event is withheld', (
  SELECT j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
UPDATE public.auction_events_canonical SET outcome='live' WHERE id='00000000-0000-4000-8000-000000000201';
UPDATE public.test_board SET payload=jsonb_set(payload,'{auctions}',(payload->'auctions') || jsonb_build_array(
  jsonb_build_array('00000000-0000-4000-8000-000000000101',1965,'Ford','Mustang',30000,now()+interval '7 hours',null,null,null,false,'https://bringatrailer.com/listing/fixture-other','Other')));
SET ROLE anon;
SELECT pg_temp.ok('two board presentations for one vehicle are withheld', (
  SELECT j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
UPDATE public.test_board SET payload=jsonb_set(payload,'{auctions}',(payload->'auctions') - 2);
UPDATE public.test_board SET payload=(payload #- ARRAY['identity_links','https://bringatrailer.com/listing/fixture-relisted-car']) ||
 jsonb_build_object('native_state',jsonb_build_object('00000000-0000-4000-8000-000000000101',
  jsonb_build_object('basis','canonical_native_fold','auction_event_id','00000000-0000-4000-8000-000000000201',
                     'source_listing_claims',jsonb_build_object('source_url','https://bringatrailer.com/listing/fixture-relisted-car'))));
SET ROLE anon;
SELECT pg_temp.ok('native fold returns the same event even when the receipt used a retained link', (
  SELECT jsonb_array_length(j->'rows') = 1 AND (j->'rows'->0->>'estimate')::numeric = 40000
  FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
UPDATE public.test_board SET payload=jsonb_set(payload,
 ARRAY['native_state','00000000-0000-4000-8000-000000000101','source_listing_claims','source_url'],
 '"https://bringatrailer.com/listing/fixture-other"');
SET ROLE anon;
SELECT pg_temp.ok('native fold with another source is withheld', (
  SELECT j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
UPDATE public.hammer_predictions SET predicted_at=now()-interval '3 hours';
SET ROLE anon;
SELECT pg_temp.ok('stopped writer is withheld', (
  SELECT j->>'fresh' = 'false' AND j->'rows' = '[]'::jsonb FROM (SELECT public.live_finish_episode_estimates('[{"vehicle_id":"00000000-0000-4000-8000-000000000101","listing_url":"https://bringatrailer.com/listing/fixture-relisted-car"}]') j) q));
RESET ROLE;
