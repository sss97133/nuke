-- Contract: 20261123180000_data_set_membership. A link is membership in a shared data set: the producer plans (backs up)
-- every membership the evidence supports, applies it in verified batches, never adds a membership without an origin row
-- (unparsable VIN, year that disagrees with the VIN, superseded observation), supersedes members whose basis went away
-- on a re-plan, and its revert removes exactly what a run did. The readers return a vehicle's sets and per-set sale
-- stats on one price basis, one row per listing, with replicas read as built and as presented.
-- Disposable PG17 only, synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

CREATE TYPE public.price_basis_t AS ENUM ('hammer','gross_incl_premium','net_to_owner','unknown');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, make text, model text, year int, vin text, is_replica boolean,
  replica_quote text, deleted_at timestamptz, merged_into_vehicle_id uuid, status text, is_public boolean DEFAULT true,
  user_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid, extraction_method text, structured_data jsonb,
  confidence_score numeric, is_superseded boolean DEFAULT false);
CREATE TABLE public.field_evidence(id uuid PRIMARY KEY, vehicle_id uuid, field_name text, proposed_value text, source_type text,
  source_confidence int, status text);
CREATE TABLE public.vehicle_decode_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_key text, make text, model text,
  code text, year_min int, year_max int, value jsonb, superseded_at timestamptz);
CREATE TABLE public.auction_events(id uuid PRIMARY KEY, vehicle_id uuid, source_url text, canonical_listing_url text,
  outcome text, auction_end_date timestamptz, currency_code text, hammer_price numeric, gross_price numeric,
  net_to_owner numeric, high_bid numeric, raw_data jsonb, duplicate_of uuid);
CREATE VIEW public.auction_events_canonical AS SELECT * FROM public.auction_events WHERE duplicate_of IS NULL;
CREATE TABLE public.vehicle_events(vehicle_id uuid, source_url text, sale_outcome text);
CREATE FUNCTION public.auction_event_typed_not_sold(p_vehicle_id uuid, p_url text) RETURNS boolean LANGUAGE sql STABLE AS $$
  select p_url is not null and exists (select 1 from public.vehicle_events ve
    where ve.vehicle_id = p_vehicle_id and rtrim(ve.source_url,'/') = rtrim(p_url,'/')
      and ve.sale_outcome is not null and ve.sale_outcome not in ('sold','unknown')) $$;
CREATE FUNCTION public.fx_usd_rate(p_currency text, p_on date)
RETURNS TABLE(rate numeric, rate_date date, source text, source_url text) LANGUAGE sql STABLE AS $$
  SELECT CASE p_currency WHEN 'USD' THEN 1.0 WHEN 'GBP' THEN 1.25 END, p_on, 'fixture', NULL::text
   WHERE p_currency IN ('USD','GBP') $$;
CREATE TABLE public.auction_comments(id uuid PRIMARY KEY, auction_event_id uuid, vehicle_id uuid, comment_type text,
  comment_text text, author_username text);

-- Decode rules (1973 Pontiac Firebird), as cited in production.
INSERT INTO vehicle_decode_rules (rule_key, make, model, code, year_min, year_max, value) VALUES
  ('vin_body_code','Pontiac','Firebird','87',1973,1973,'{"body":"hardtop coupe"}'),
  ('vin_series_char','Pontiac','Firebird','S',1973,1973,'{"series":"Firebird (base)"}'),
  ('vin_series_char','Pontiac','Firebird','V',1973,1973,'{"series":"Trans Am"}'),
  ('vin_engine_char','Pontiac','Firebird','D',1973,1973,'{"cylinders":6,"displacement_ci":250}'),
  ('vin_engine_char','Pontiac','Firebird','X',1973,1973,'{"application":"Super Duty","displacement_ci":455}'),
  ('vin_engine_char','Pontiac','Firebird','Y',1973,1973,'{"displacement_ci":455}'),
  ('vin_plant_char','Pontiac','Firebird','N',1973,1973,'{"plant":"Norwood, Ohio"}'),
  ('block_casting','Pontiac',NULL,'9799140',1970,1970,'{"family":"Pontiac V8","displacement_ci":455}'),
  ('engine_stamp_code','Pontiac','B-body','YH',1970,1970,'{"displacement_ci":455}'),
  ('engine_stamp_code','Pontiac','F-body','YH',1970,1970,'{"displacement_ci":400}'),
  ('transmission_case_casting',NULL,NULL,'3851325',1964,1965,'{"family":"Muncie 4-speed"}'),
  ('transmission_tailhousing_casting',NULL,NULL,'3857584',1966,1974,'{"family":"Muncie 4-speed"}'),
  ('body_tag_paint_code','Pontiac','Firebird','75',1973,1973,'{"pontiac_code":"R"}'),
  ('body_tag_style_number','Pontiac','Firebird','2FS87',1973,1973,'{"body":"hardtop coupe"}');

\set fb '''f0000000-0000-4000-8000-000000000001'''
\set ta1 '''f0000000-0000-4000-8000-000000000002'''
\set ta2 '''f0000000-0000-4000-8000-000000000003'''
\set ta2dup '''f0000000-0000-4000-8000-000000000004'''
\set nov '''f0000000-0000-4000-8000-000000000005'''
\set badyr '''f0000000-0000-4000-8000-000000000006'''
\set gone '''f0000000-0000-4000-8000-000000000007'''
\set priv '''f0000000-0000-4000-8000-000000000008'''
INSERT INTO vehicles (id, make, model, year, vin, is_replica, replica_quote, deleted_at, is_public) VALUES
  (:fb,  'Pontiac','Firebird',1973,'2S87D3N143591', true, 'Built as a Trans Am SD-455 clone by the builder.', NULL, true),
  (:ta1, 'Pontiac','Firebird Trans Am',1973,'2V87X3N100001', NULL, NULL, NULL, true),
  (:ta2, 'Pontiac','Trans Am',1973,'2v87x3n100002 ', NULL, NULL, NULL, true),
  (:ta2dup, 'Pontiac','Trans Am',1973,'2V87X3N100003', NULL, NULL, NULL, true),
  (:nov, 'Pontiac','Firebird',1973,NULL, NULL, NULL, NULL, true),
  (:badyr,'Pontiac','Firebird',1977,'2S87D3N100009', NULL, NULL, NULL, true),
  (:gone,'Pontiac','Firebird',1973,'2S87D3N100010', NULL, NULL, now(), true),
  (:priv,'Pontiac','Firebird',1973,'2S87D3N100011', NULL, NULL, NULL, false);
INSERT INTO vehicle_images VALUES ('a0000000-0000-4000-8000-000000000001', :fb), ('a0000000-0000-4000-8000-000000000002', :fb);
INSERT INTO field_evidence VALUES ('e0000000-0000-4000-8000-000000000001', :fb, 'vin', '2S87D3N143591', 'gm_vin_chart', 90, 'pending');
INSERT INTO vehicle_observations (id, vehicle_id, extraction_method, structured_data, confidence_score, is_superseded) VALUES
  ('b0000000-0000-4000-8000-000000000001', :fb, 'engine_block_decode_v1',
   '{"claim_role":"engine_block_casting","engine_block_casting":"9799140","image_id":"a0000000-0000-4000-8000-000000000001"}', 0.60, false),
  ('b0000000-0000-4000-8000-000000000002', :fb, 'engine_block_decode_v1',
   '{"claim_role":"engine_code_stamp","engine_code_stamp":"YH","image_id":"a0000000-0000-4000-8000-000000000002"}', 0.60, false),
  ('b0000000-0000-4000-8000-000000000003', :fb, 'trans_id_stamp_decode_v1',
   '{"claim_role":"transmission_case_model","transmission_case_casting":"3851325","image_id":"not-a-uuid"}', 0.60, false),
  ('b0000000-0000-4000-8000-000000000004', :fb, 'trans_id_stamp_decode_v1',
   '{"claim_role":"transmission_tailhousing","transmission_tailhousing":"3857584"}', 0.60, false),
  ('b0000000-0000-4000-8000-000000000005', :fb, 'cowl_tag_decode_v1',
   '{"claim_role":"cowl_tag_paint","paint_code":"75","tag_model_year":"73"}', 0.60, false),
  ('b0000000-0000-4000-8000-000000000006', :fb, 'cowl_tag_decode_v1',
   '{"claim_role":"cowl_tag_style","body_tag_style":"2FS87","tag_model_year":"73"}', 0.60, false),
  ('b0000000-0000-4000-8000-000000000007', :fb, 'cowl_tag_decode_v1',
   '{"claim_role":"cowl_tag_body_number","assembly_plant_code":"N","tag_model_year":"73"}', 0.60, false),
  ('b0000000-0000-4000-8000-000000000008', :fb, 'engine_block_decode_v1',
   '{"claim_role":"engine_block_casting","engine_block_casting":"9999999"}', 0.60, true),
  ('b0000000-0000-4000-8000-000000000009', :ta1, 'engine_block_decode_v1',
   '{"claim_role":"engine_block_casting","engine_block_casting":"9799140"}', 0.70, false);
-- Sales: ta1 sold twice on one listing (two profiles' rows share the canonical URL), ta2 sold, ta2dup sold in GBP;
-- one typed not sold, one duplicate, one bid-to with a high bid; the subject's own listing must not count.
INSERT INTO auction_events (id, vehicle_id, source_url, canonical_listing_url, outcome, auction_end_date, currency_code, hammer_price, gross_price, high_bid, raw_data, duplicate_of) VALUES
  ('c0000000-0000-4000-8000-000000000001', :ta1, 'https://x/l1/', 'https://x/l1', 'sold', '2024-05-01', 'USD', 100000, 105000, NULL, '{}', NULL),
  ('c0000000-0000-4000-8000-000000000002', :ta2, 'https://x/l1', 'https://x/l1', 'sold', '2024-05-01', 'USD', 100000, 105000, NULL, '{}', NULL),
  ('c0000000-0000-4000-8000-000000000003', :ta2, 'https://x/l2', 'https://x/l2', 'sold', '2025-03-01', 'USD', 80000, 84000, NULL, '{}', NULL),
  ('c0000000-0000-4000-8000-000000000004', :ta2dup, 'https://x/l3', 'https://x/l3', 'sold', '2018-03-01', 'GBP', 40000, 42000, NULL, '{}', NULL),
  ('c0000000-0000-4000-8000-000000000005', :ta2, 'https://x/l4', 'https://x/l4', 'sold', '2026-01-01', 'USD', 999999, NULL, NULL, '{}', NULL),
  ('c0000000-0000-4000-8000-000000000006', :ta1, 'https://x/l5', 'https://x/l5', 'sold', '2026-02-01', 'USD', 1, NULL, NULL, '{}', 'c0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000007', :ta1, 'https://x/l6', 'https://x/l6', 'bid_to', '2026-03-01', 'USD', NULL, NULL, 70000, '{}', NULL),
  ('c0000000-0000-4000-8000-000000000008', :fb, 'https://x/own', 'https://x/own', 'sold', '2026-04-01', 'USD', 500000, NULL, NULL, '{}', NULL);
INSERT INTO vehicle_events VALUES (:ta2, 'https://x/l4/', 'bid_to');
INSERT INTO auction_comments (id, auction_event_id, vehicle_id, comment_type, comment_text, author_username) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', :ta2, 'observation', 'Is the SD-455 block correct? PHS docs?', 'someone'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', :ta2, 'bid', 'super duty bid', 'someone'),
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000007', :ta1, 'question', 'Nice clone, Muncie 4-speed?', 'other'),
  ('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000007', :ta1, 'question', 'Beautiful color.', 'other');

\ir ../migrations/20261123180000_data_set_membership.sql

-- Grants: tables closed to anon, readers open, producer closed.
SELECT t_assert(NOT has_table_privilege('anon', 'public.data_set_members', 'SELECT')
            AND NOT has_table_privilege('anon', 'public.data_sets', 'SELECT'), 'tables closed to anon');
SELECT t_assert(has_function_privilege('anon', 'public.vehicle_data_sets(uuid)', 'EXECUTE')
            AND has_function_privilege('anon', 'public.data_set_comps(uuid, uuid, price_basis_t)', 'EXECUTE'), 'readers open to anon');
SELECT t_assert(NOT has_function_privilege('anon', 'public.data_set_membership_apply_v1(uuid, integer, integer, boolean)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.data_set_membership_plan_v1(uuid, text, uuid)', 'EXECUTE'), 'producer closed to anon');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'data_set_members'
                             AND column_name ~ 'author|text'), 'no comment author or text column');

-- Run 1: the Firebird alone.
\set r1 '''11111111-1111-4111-8111-111111111111'''
SELECT data_set_membership_plan_v1(:r1, 'vehicle', :fb) AS plan1 \gset
SELECT t_assert((:'plan1'::jsonb->>'planned_add')::int > 0, 'plan records adds');
SELECT t_assert((SELECT count(*) FROM data_set_members) = 0 AND (SELECT count(*) FROM data_sets) = 0, 'plan changes nothing');
SELECT t_assert((data_set_membership_apply_v1(:r1, 5, 1, true)->>'dry')::boolean, 'apply is dry by default flag');
SELECT t_assert((SELECT count(*) FROM data_set_members) = 0, 'dry apply changes nothing');
SELECT data_set_membership_apply_v1(:r1, 5, 200, false) AS ap1 \gset
SELECT t_assert((:'ap1'::jsonb->>'still_planned')::int = 0 AND (:'ap1'::jsonb->>'batches')::int > 1, 'applied in several batches');
SELECT t_assert((SELECT count(*) FROM data_set_members WHERE run_id = :r1) = (SELECT count(*) FROM data_set_member_plan WHERE run_id = :r1 AND state = 'applied'), 'members = applied plan rows');

CREATE TEMP VIEW fb_sets AS
  SELECT s.set_kind, s.set_key, s.label, m.basis_type, m.member_type, m.confidence
    FROM data_set_members m JOIN data_sets s ON s.id = m.set_id
   WHERE m.vehicle_id = 'f0000000-0000-4000-8000-000000000001' AND m.state = 'active';
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'vin_cohort' AND set_key = 'pontiac:1973:s87:d' AND basis_type = 'field_evidence' AND confidence = 0.9), 'vin cohort from the VIN chart evidence');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'vin_series' AND set_key = 'pontiac:1973:s87' AND label LIKE '%Firebird (base)%'), 'vin series labelled by its rule');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'vin_engine' AND set_key = 'pontiac:1973:d'), 'vin engine D');
SELECT t_assert((SELECT count(*) FROM fb_sets WHERE set_kind = 'plant_year' AND set_key = 'pontiac:1973:n' AND member_type = 'vehicle') = 2, 'plant from VIN and cowl tag, one set');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'engine_block_casting' AND set_key = '9799140' AND basis_type = 'observation' AND label LIKE '%455%'), 'block casting');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'engine_block_casting' AND member_type = 'image'), 'block casting photo is a member');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'engine_code' AND set_key = 'pontiac:yh' AND label IS NULL), 'engine code with disagreeing rules has no label');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'trans_case_casting' AND set_key = '3851325')
            AND NOT EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'trans_case_casting' AND member_type = 'image'), 'case casting; bad image id ignored');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'trans_tail_casting' AND set_key = '3857584'), 'tail casting');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'paint_code' AND set_key = 'pontiac:1973:75'), 'paint 75');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'cowl_style' AND set_key = '1973:2fs87'), 'cowl style');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'replica_cohort' AND set_key = 'as_built:pontiac:1973:s87:d')
            AND EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'replica_cohort' AND set_key = 'as_presented:pontiac:1973:v87:x' AND confidence = 0.5), 'replica as built and as presented');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM data_sets WHERE set_key = '9999999'), 'superseded observation gives no membership');

-- Run 1 again: nothing new to add.
\set r1b '''11111111-1111-4111-8111-11111111111b'''
SELECT t_assert((data_set_membership_plan_v1(:r1b, 'vehicle', :fb)->>'planned_add')::int = 0, 're-plan is idempotent');

-- Run 2: the whole scope.
\set r2 '''22222222-2222-4222-8222-222222222222'''
SELECT data_set_membership_plan_v1(:r2, 'pontiac_f_body', NULL) AS plan2 \gset
SELECT data_set_membership_apply_v1(:r2, 200, 50, false) AS ap2 \gset
SELECT t_assert(EXISTS (SELECT 1 FROM data_set_members m JOIN data_sets s ON s.id = m.set_id
                         WHERE s.set_key = 'pontiac:1973:v87:x' AND s.set_kind = 'vin_cohort' AND m.vehicle_id = 'f0000000-0000-4000-8000-000000000003'), 'lower-case padded VIN normalised');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM data_set_members WHERE vehicle_id IN ('f0000000-0000-4000-8000-000000000005','f0000000-0000-4000-8000-000000000006','f0000000-0000-4000-8000-000000000007')),
  'no VIN, VIN year disagreeing with the profile, deleted profile: no membership');
SELECT t_assert((SELECT count(*) FROM data_set_members m JOIN data_sets s ON s.id = m.set_id WHERE s.set_kind = 'comment_theme') = 4, 'four comment theme hits; bids skipped');
SELECT t_assert(EXISTS (SELECT 1 FROM data_sets WHERE set_kind = 'comment_theme' AND set_key = 'sd_authenticity'), 'sd theme');
SELECT t_assert((SELECT count(*) FROM data_set_members m JOIN data_sets s ON s.id = m.set_id WHERE s.set_key = '9799140') = 3, 'block set has two vehicles and a photo');

-- Readers.
SELECT vehicle_data_sets(:fb) AS vds \gset
SELECT t_assert(jsonb_array_length(:'vds'::jsonb->'sets') >= 11, 'vehicle_data_sets lists the sets');
SELECT t_assert((SELECT (e->>'vehicles_in_set')::int FROM jsonb_array_elements(:'vds'::jsonb->'sets') e WHERE e->>'set_key' = '9799140') = 2, 'set size');
SELECT t_assert(:'vds'::jsonb->'unknown_kinds' ? 'comment_theme', 'kinds with no evidence are reported unknown');
SELECT data_set_comps(NULL, :fb, 'hammer') AS comps \gset
-- genuine cohort for the as-presented replica set: listings l1 (one row for two profiles), l2, l3 (GBP), l4 typed not sold, l6 bid_to; duplicate dropped
CREATE TEMP TABLE g AS SELECT e FROM jsonb_array_elements(:'comps'::jsonb->'sets') e WHERE e->>'role' = 'genuine_cohort';
SELECT t_assert((SELECT count(*) FROM g) = 1 AND (SELECT e->>'set_key' FROM g) = 'pontiac:1973:v87:x', 'genuine cohort added for the as-presented set');
SELECT t_assert((SELECT (e->'sold'->>'n')::int FROM g) = 3, 'sold listings de-duplicated, typed-not-sold and duplicate left out');
SELECT t_assert((SELECT (e->'sold'->>'median')::numeric FROM g) = 80000 AND (SELECT (e->'sold'->>'min')::numeric FROM g) = 50000
            AND (SELECT (e->'sold'->>'max')::numeric FROM g) = 100000, 'median and range in USD (GBP converted)');
SELECT t_assert((SELECT e->'by_outcome' FROM g) @> '[{"outcome":"bid_to","median_high_bid_not_a_sale":70000}]', 'unsold outcome reports its high bid');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'comps'::jsonb->'sets') e WHERE (e->'sold'->>'max')::numeric >= 500000), 'the subject''s own sale never counts');
SELECT t_assert((SELECT (e->'sold'->>'n')::int FROM jsonb_array_elements(data_set_comps((SELECT id FROM data_sets WHERE set_key = 'sd_authenticity'), NULL, 'gross_incl_premium')->'sets') e) = 1, 'comment theme comps on the gross basis');
SELECT t_assert(vehicle_data_sets(:priv) ? 'sets', 'service role reads a non-public vehicle');
SET request.jwt.claims = '{"role":"anon"}';
SELECT t_assert(vehicle_data_sets(:priv)->>'error' = 'not_found_or_not_public', 'anon cannot read a non-public vehicle');
RESET request.jwt.claims;

-- Evidence changes: an observation is superseded, re-plan supersedes its members; revert restores them.
UPDATE vehicle_observations SET is_superseded = true WHERE id = 'b0000000-0000-4000-8000-000000000004';
\set r3 '''33333333-3333-4333-8333-333333333333'''
SELECT t_assert((data_set_membership_plan_v1(:r3, 'vehicle', :fb)->>'planned_supersede')::int = 1, 'superseded basis planned for supersede');
SELECT data_set_membership_apply_v1(:r3, 50, 5, false) AS ap3 \gset
SELECT t_assert(NOT EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'trans_tail_casting'), 'member superseded');
SELECT t_assert(EXISTS (SELECT 1 FROM data_set_members WHERE state = 'superseded' AND superseded_run_id = :r3), 'superseded row kept');
SELECT t_assert((data_set_membership_revert_v1(:r3)->>'supersedes_restored')::int = 1, 'revert restores the supersede');
SELECT t_assert(EXISTS (SELECT 1 FROM fb_sets WHERE set_kind = 'trans_tail_casting'), 'member active again');

-- Revert run 2 then run 1: everything they added is gone, sets they created with no members too.
SELECT data_set_membership_revert_v1(:r2) AS rv2 \gset
SELECT t_assert((SELECT count(*) FROM data_set_members WHERE run_id = :r2) = 0, 'run 2 members removed');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM data_sets WHERE set_kind = 'comment_theme'), 'run 2 sets removed');
SELECT t_assert((SELECT count(*) FROM data_set_members WHERE run_id = :r1) > 0, 'run 1 untouched by run 2 revert');
SELECT data_set_membership_revert_v1(:r1) AS rv1 \gset
SELECT t_assert((SELECT count(*) FROM data_set_members) = 0 AND (SELECT count(*) FROM data_sets) = 0, 'all reverted');
SELECT t_assert((SELECT status FROM data_set_runs WHERE run_id = :r1) = 'reverted', 'run marked reverted');
DO $$ BEGIN
  PERFORM data_set_membership_apply_v1('11111111-1111-4111-8111-111111111111', 5, 1, false);
  RAISE EXCEPTION 'reverted run applied';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'reverted run applied' THEN RAISE; END IF;
END $$;
SELECT t_assert(true, 'a reverted run cannot be applied again');

-- The file's own revert.
DROP VIEW fb_sets;
\ir revert_20261123180000_data_set_membership.sql
SELECT t_assert(to_regclass('public.data_set_members') IS NULL AND to_regprocedure('public.data_set_comps(uuid, uuid, price_basis_t)') IS NULL, 'file revert drops the layer');
