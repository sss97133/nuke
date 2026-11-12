-- Disposable PG17 only. Proves the DRAFT garage presence derivation (supabase/drafts/garage-model/migrations/
-- 20261112100100_garage_presence_signals.sql, ...100110_garage_stays_fold.sql, ...100120_garage_now_timeline.sql; NOT in
-- supabase/migrations): the signal layer normalises site photos (from ANY member, GPS inside a site valid on the photo's date),
-- supporting records, relationship links, exits and merges into one shape; the fold splits stays at gaps and exits, picks a
-- relationship per stay, is idempotent, safe as-of a date and confined to garage_* tables; garage_now / garage_timeline /
-- garage_stay_evidence_read compute state at read time as of a date and refuse non-members.
-- Fixture: the live tables the signals read, reduced to the columns they read (checked against the 2026-11-12 catalog snapshot),
-- plus the core test's stubs. All fixture dates are absolute and in the past; garage_now is read as-of explicit dates.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.garages') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
  IF now() < TIMESTAMPTZ '2026-03-01 00:00:00+00' THEN RAISE EXCEPTION 'fixture dates are absolute and must lie in the past'; END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;

-- Stubs of the live tables the core references.
CREATE TABLE public.organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_name text);
CREATE TABLE public.organization_locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.user_sites(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
-- Stubs of the live tables the signals read: only the columns they read.
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, merged_into_vehicle_id uuid, deleted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, documented_by_user_id uuid,
  latitude numeric(10,8), longitude numeric(11,8), taken_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  source text, is_superseded boolean, is_duplicate boolean, is_document boolean, is_sensitive boolean,
  vision_gate_status text, photographer_attribution text);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, session_date date,
  start_time timestamptz, session_type text, owner_confirmed_at timestamptz);
CREATE TABLE public.organization_vehicles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, vehicle_id uuid,
  relationship_type text, status text, start_date date, end_date date, sale_date date, created_at timestamptz NOT NULL DEFAULT now(),
  user_rejected boolean);
CREATE TABLE public.vehicle_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, event_type text, event_status text,
  sold_at timestamptz, ended_at timestamptz, started_at timestamptz);
CREATE TABLE public.receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, created_by uuid,
  occurred_at timestamptz, receipt_date date, transaction_date date, purchase_date date, is_superseded boolean, duplicate_of uuid);
CREATE TABLE public.vehicle_user_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, role text,
  is_active boolean, revoked_at timestamptz, granted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vehicle_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, role text,
  status text, start_date date, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vehicle_contributor_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, created_by uuid);
CREATE TABLE public.contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, external_identity_id uuid);

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_sqlstate(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION public.t_as(p_role text, p_sub uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_role, 'sub', p_sub)::text, false); END $$;
-- vehicle id n -> a fixed uuid; user ids a1..a6 as in the core test.
CREATE FUNCTION public.t_v(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('b0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
-- A fingerprint of every public base table that is NOT a garage_* table: the fold must leave it unchanged.
CREATE FUNCTION public.t_fingerprint() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; acc text := ''; h text;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT LIKE 'garage\_%' AND c.relname NOT LIKE 't\_%' ORDER BY c.relname LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(t::text, '','' ORDER BY t::text), '''')) FROM public.%I t', r.relname) INTO h;
    acc := acc || r.relname || ':' || h || ';';
  END LOOP;
  RETURN md5(acc);
END $$;
-- state of one vehicle in garage_now's output
CREATE FUNCTION public.t_state(g uuid, v uuid, as_of timestamptz) RETURNS text LANGUAGE plpgsql STABLE AS
$$ BEGIN RETURN (SELECT n.state FROM public.garage_now(g, as_of) n WHERE n.vehicle_id = v); END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_sqlstate(text), public.t_as(text,uuid), public.t_v(integer),
  public.t_state(uuid, uuid, timestamptz) TO anon, authenticated, service_role;

-- a1 owner, a2 technician, a3 outsider, a5 manager
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'),('00000000-0000-0000-0000-0000000000a5');
INSERT INTO public.organizations(id, business_name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'fixture operator'), ('00000000-0000-0000-0000-0000000000c2', 'fixture dealer'),
  ('00000000-0000-0000-0000-0000000000c3', 'fixture tenant');
INSERT INTO public.external_identities(id) VALUES ('00000000-0000-0000-0000-0000000000e1');

\ir ../drafts/garage-model/migrations/20261112100000_garage_core.sql
\ir ../drafts/garage-model/migrations/20261112100100_garage_presence_signals.sql
\ir ../drafts/garage-model/migrations/20261112100110_garage_stays_fold.sql
\ir ../drafts/garage-model/migrations/20261112100120_garage_now_timeline.sql

-- The garage: the owner starts it; a technician and a manager are active members; the shop MOVED (two sites).
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT create_garage('Fixture shop', '00000000-0000-0000-0000-0000000000c1') AS g \gset
RESET ROLE;
INSERT INTO garage_members(garage_id, user_id, role, status, approved_by, approved_at, started_at) VALUES
  (:'g', '00000000-0000-0000-0000-0000000000a2', 'technician', 'active', '00000000-0000-0000-0000-0000000000a1', now(), now()),
  (:'g', '00000000-0000-0000-0000-0000000000a5', 'manager', 'active', '00000000-0000-0000-0000-0000000000a1', now(), now());
INSERT INTO garage_organizations(garage_id, organization_id, kind) VALUES
  (:'g', '00000000-0000-0000-0000-0000000000c2', 'hosted'), (:'g', '00000000-0000-0000-0000-0000000000c3', 'tenant');
-- Site A: first location, valid from 2019-06-01 to 2022-12-31. Site B: valid from 2023-01-01. Both confirmed; 150 m; about 20 km apart.
INSERT INTO garage_sites(garage_id, lat, lon, radius_m, valid_from, valid_to, source, confirmed_by, confirmed_at) VALUES
  (:'g', 35.9770, -114.8540, 150, DATE '2019-06-01', DATE '2022-12-31', 'fixture', '00000000-0000-0000-0000-0000000000a1', now()),
  (:'g', 36.1000, -115.0000, 150, DATE '2023-01-01', NULL,              'fixture', '00000000-0000-0000-0000-0000000000a1', now());

-- Helpers for fixture rows. A photo at a site; created_at is a day after taken_at unless stated (so it is not an upload-time fallback).
CREATE FUNCTION public.t_photo(p_vehicle uuid, p_user uuid, p_site text, p_taken timestamptz) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images(vehicle_id, user_id, latitude, longitude, taken_at, created_at)
  VALUES (p_vehicle, p_user, CASE p_site WHEN 'A' THEN 35.9770 WHEN 'B' THEN 36.1000 WHEN 'B_near' THEN 36.1005 WHEN 'off' THEN 36.2000 END,
          CASE p_site WHEN 'A' THEN -114.8540 WHEN 'B' THEN -115.0000 WHEN 'B_near' THEN -115.0000 WHEN 'off' THEN -115.2000 END,
          p_taken, p_taken + interval '1 day') $$;
CREATE FUNCTION public.t_link(p_vehicle uuid, p_org int, p_rel text, p_status text, p_start date) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.organization_vehicles(organization_id, vehicle_id, relationship_type, status, start_date, created_at)
  VALUES (('00000000-0000-0000-0000-0000000000c' || p_org)::uuid, p_vehicle, p_rel, p_status, p_start, p_start::timestamptz) $$;

-- Vehicles. 5 merges into 55 which is deleted; 56 merges into 57 which is alive.
INSERT INTO public.vehicles(id, merged_into_vehicle_id, deleted_at)
SELECT t_v(n), CASE n WHEN 5 THEN t_v(55) WHEN 56 THEN t_v(57) END, CASE n WHEN 55 THEN TIMESTAMPTZ '2024-08-01 12:00:00+00' END
FROM unnest(ARRAY[1,2,3,4,5,55,56,57,6,7,8,9,10,11,12,13,14,15,16,19,20,21,22,23]) AS n;

-- V01 here, owned (operator owner link). Also a sale from 2019, years BEFORE it arrived: not an exit.
SELECT t_photo(t_v(1), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2025-12-01 15:00+00');
SELECT t_photo(t_v(1), '00000000-0000-0000-0000-0000000000a1', 'B_near', TIMESTAMPTZ '2025-12-20 15:00+00');
SELECT t_link(t_v(1), 1, 'owner', 'active', DATE '2024-01-01');
INSERT INTO public.vehicle_events(vehicle_id, event_type, event_status, sold_at) VALUES (t_v(1), 'auction', 'sold', TIMESTAMPTZ '2019-05-01 00:00+00');
-- V02 probably_here at the later read: last photo 245 days before it.
SELECT t_photo(t_v(2), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2025-06-01 15:00+00');
-- V03 stale: last photo 2023-06-20.
SELECT t_photo(t_v(3), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2023-06-01 15:00+00');
SELECT t_photo(t_v(3), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2023-06-20 15:00+00');
-- V04 left via a sale, consignment (consigner link at the hosted org).
SELECT t_photo(t_v(4), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2024-03-01 15:00+00');
SELECT t_photo(t_v(4), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2024-03-10 15:00+00');
SELECT t_link(t_v(4), 2, 'consigner', 'active', DATE '2023-01-01');
INSERT INTO public.vehicle_events(vehicle_id, event_type, event_status, sold_at) VALUES (t_v(4), 'auction', 'sold', TIMESTAMPTZ '2024-04-15 00:00+00');
-- V05 gone via merge: 5 merged into 55, and 55 was deleted 2024-08-01. Photos on BOTH records land on the terminal one.
SELECT t_photo(t_v(5),  '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2024-02-01 15:00+00');
SELECT t_photo(t_v(55), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2024-02-10 15:00+00');
-- V56 merged into the live 57: history moves to 57, which is here.
SELECT t_photo(t_v(56), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2025-12-10 15:00+00');
-- V06 never seen here: an org link (work_location), a technician's session, and a photo WITHOUT GPS (ignored).
SELECT t_link(t_v(6), 1, 'work_location', 'active', DATE '2025-02-01');
INSERT INTO public.work_sessions(user_id, vehicle_id, session_date, start_time) VALUES
  ('00000000-0000-0000-0000-0000000000a2', t_v(6), DATE '2025-07-01', TIMESTAMPTZ '2025-07-01 16:00+00');
INSERT INTO public.vehicle_images(vehicle_id, user_id, latitude, longitude, taken_at, created_at)
  VALUES (t_v(6), '00000000-0000-0000-0000-0000000000a1', NULL, NULL, TIMESTAMPTZ '2025-06-01 15:00+00', TIMESTAMPTZ '2025-06-02 15:00+00');
-- V07 left and came back: two sightings at site A in January 2020, then site B in December 2025 (about 5.9 years later).
SELECT t_photo(t_v(7), '00000000-0000-0000-0000-0000000000a1', 'A', TIMESTAMPTZ '2020-01-01 15:00+00');
SELECT t_photo(t_v(7), '00000000-0000-0000-0000-0000000000a1', 'A', TIMESTAMPTZ '2020-01-11 15:00+00');
SELECT t_photo(t_v(7), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2025-12-15 15:00+00');
-- V08 a TECHNICIAN's photo: presence, with the technician as the originator.
SELECT t_photo(t_v(8), '00000000-0000-0000-0000-0000000000a2', 'B', TIMESTAMPTZ '2025-12-28 15:00+00');
-- V09 placeholder dates: a 1985-01-01 session by the owner, a photo "taken" 1978-01-01 at a site. Neither is evidence.
INSERT INTO public.work_sessions(user_id, vehicle_id, session_date) VALUES ('00000000-0000-0000-0000-0000000000a1', t_v(9), DATE '1985-01-01');
SELECT t_photo(t_v(9), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '1978-01-01 00:00+00');
-- V10 stale (one photo, 2024-01-05) with an operator owner link; the owner will ASSERT it here and storage below.
SELECT t_photo(t_v(10), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2024-01-05 15:00+00');
SELECT t_link(t_v(10), 1, 'owner', 'active', DATE '2024-01-01');
-- V11 here until a manager says it left.
SELECT t_photo(t_v(11), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2025-12-20 15:00+00');
-- V12 listed after the last sighting: a weak exit.
SELECT t_photo(t_v(12), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2025-08-01 15:00+00');
INSERT INTO public.vehicle_events(vehicle_id, event_type, event_status, started_at) VALUES (t_v(12), 'listing', 'active', TIMESTAMPTZ '2025-09-01 00:00+00');
-- V13 dealer inventory (owner link at the HOSTED org), photographed by the technician.
SELECT t_photo(t_v(13), '00000000-0000-0000-0000-0000000000a2', 'B', TIMESTAMPTZ '2025-12-22 15:00+00');
SELECT t_link(t_v(13), 2, 'owner', 'active', DATE '2025-01-01');
-- V14 contribution is not ownership: the technician is an 'owner' contributor; the relationship must stay unknown.
SELECT t_photo(t_v(14), '00000000-0000-0000-0000-0000000000a2', 'B', TIMESTAMPTZ '2025-12-23 15:00+00');
INSERT INTO public.vehicle_contributors(vehicle_id, user_id, role, status, start_date) VALUES
  (t_v(14), '00000000-0000-0000-0000-0000000000a2', 'owner', 'active', DATE '2025-01-01');
-- V15 a photo 20 km away: outside every site. V16 a superseded photo at the site. V19 / V20 a photo at a site that was NOT valid on its date.
SELECT t_photo(t_v(15), '00000000-0000-0000-0000-0000000000a1', 'off', TIMESTAMPTZ '2025-12-01 15:00+00');
SELECT t_photo(t_v(16), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2025-12-01 15:00+00');
UPDATE public.vehicle_images SET is_superseded = true WHERE vehicle_id = t_v(16);
SELECT t_photo(t_v(19), '00000000-0000-0000-0000-0000000000a1', 'A', TIMESTAMPTZ '2024-05-01 15:00+00');   -- site A closed 2022-12-31
SELECT t_photo(t_v(20), '00000000-0000-0000-0000-0000000000a1', 'B', TIMESTAMPTZ '2021-05-01 15:00+00');   -- site B opens 2023-01-01
-- V21 taken_at equals the upload time: possibly the fallback, so down-weighted (0.6), still evidence.
INSERT INTO public.vehicle_images(vehicle_id, user_id, latitude, longitude, taken_at, created_at)
  VALUES (t_v(21), '00000000-0000-0000-0000-0000000000a1', 36.1000, -115.0000, TIMESTAMPTZ '2025-12-18 15:00+00', TIMESTAMPTZ '2025-12-18 15:00:30+00');
-- V22 a receipt by the owner only; V23 a contributor-link upload without GPS on an invite the owner made.
INSERT INTO public.receipts(vehicle_id, user_id, receipt_date) VALUES (t_v(22), '00000000-0000-0000-0000-0000000000a1', DATE '2025-05-05');
INSERT INTO public.contributors(id, external_identity_id) VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1');
INSERT INTO public.vehicle_contributor_invites(vehicle_id, created_by) VALUES (t_v(23), '00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.vehicle_images(vehicle_id, latitude, longitude, taken_at, created_at, source, photographer_attribution)
  VALUES (t_v(23), NULL, NULL, TIMESTAMPTZ '2025-10-01 15:00+00', TIMESTAMPTZ '2025-10-01 20:00+00', 'contributor_link',
          'contributor:00000000-0000-0000-0000-0000000000f1');

-- ===== The signal layer ===========================================================================================
SET ROLE authenticated; SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_presence_signals(%L)$q$, :'g')) = '42501', 'signals are not callable by a signed-in user');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_fold_stays(%L)$q$, :'g')) = '42501', 'the fold is not callable by a signed-in user');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_stays_dry_run(%L)$q$, :'g')) = '42501', 'the dry run is not callable by a signed-in user');
RESET ROLE;
SET ROLE anon; SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_now(%L)$q$, :'g')) = '42501', 'anon cannot call garage_now'); RESET ROLE;
SET ROLE service_role;
CREATE TEMP TABLE sg AS SELECT * FROM garage_presence_signals(:'g', TIMESTAMPTZ '2026-02-01 00:00+00');
GRANT SELECT ON sg TO PUBLIC;
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id = t_v(8) AND signal = 'site_photo' AND signal_class = 'A'
                   AND originator_user_id = '00000000-0000-0000-0000-0000000000a2' AND weight = 1) = 1,
  'a technician''s photo inside the site is class A site evidence, originator = the technician, not the owner');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id = t_v(6) AND source_table = 'vehicle_images') = 0, 'a photo with no GPS is not site evidence');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id = t_v(15)) = 0, 'a photo outside every site is nothing');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id = t_v(16)) = 0, 'a superseded photo is not evidence');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id IN (t_v(19), t_v(20))) = 0,
  'a photo inside a site that was not valid on the photo''s date is not evidence (the shop moved)');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id = t_v(9)) = 0,
  'a 1985-01-01 session and a 1978-01-01 photo are placeholders: excluded, so the car has no signal and no tie');
SELECT t_assert((SELECT weight FROM sg WHERE vehicle_id = t_v(21) AND signal = 'site_photo') = 0.6
  AND (SELECT note FROM sg WHERE vehicle_id = t_v(21) AND signal = 'site_photo') LIKE '%taken_at_equals_upload_time%',
  'taken_at equal to the upload time is down-weighted to 0.6 and says so');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id = t_v(1) AND signal = 'sale_event') = 1, 'the 2019 sale is a signal (the fold, not the layer, decides it is no exit)');
SELECT t_assert((SELECT signal_class FROM sg WHERE vehicle_id = t_v(6) AND signal = 'work_session') = 'B'
  AND (SELECT signal_class FROM sg WHERE vehicle_id = t_v(6) AND signal = 'org_link') = 'B', 'a work session and an org link are supporting (class B), never class A');
SELECT t_assert((SELECT relationship_hint FROM sg WHERE vehicle_id = t_v(1) AND signal = 'org_link') = 'owned'
  AND (SELECT relationship_hint FROM sg WHERE vehicle_id = t_v(13) AND signal = 'org_link') = 'dealer_inventory'
  AND (SELECT relationship_hint FROM sg WHERE vehicle_id = t_v(4) AND signal = 'org_link') = 'consignment'
  AND (SELECT relationship_hint FROM sg WHERE vehicle_id = t_v(6) AND signal = 'org_link') = 'customer_work',
  'org link hints follow relationship_type and the org''s kind in the garage (operator owner = owned, hosted owner = dealer_inventory)');
SELECT t_assert((SELECT relationship_hint FROM sg WHERE vehicle_id = t_v(14) AND source_table = 'vehicle_contributors') IS NULL,
  'a contributor row, even one claiming owner, never hints owned');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id = t_v(55) AND signal = 'site_photo') = 2
  AND (SELECT count(*) FROM sg WHERE vehicle_id = t_v(5)) = 0, 'photos on a merged record are returned on the terminal record only');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id = t_v(55) AND signal = 'record_deleted_or_merged' AND signal_class = 'C') = 1
  AND (SELECT note FROM sg WHERE vehicle_id = t_v(55) AND signal = 'record_deleted_or_merged') LIKE '%reason:deleted%', 'a deleted terminal record is a gone signal with its reason');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id = t_v(57) AND signal = 'site_photo' AND note LIKE '%moved_from_merged_record%') = 1
  AND (SELECT count(*) FROM sg WHERE signal = 'record_deleted_or_merged' AND vehicle_id = t_v(57)) = 0, 'a merge into a live record moves history and is not an exit');
SELECT t_assert((SELECT originator_external_identity_id FROM sg WHERE vehicle_id = t_v(23) AND signal = 'contributor_link_upload')
                  = '00000000-0000-0000-0000-0000000000e1'
  AND (SELECT originator_user_id FROM sg WHERE vehicle_id = t_v(23) AND signal = 'contributor_link_upload') IS NULL,
  'a contributor-link upload keeps the contributor''s external identity as originator');
SELECT t_assert((SELECT signal_class FROM sg WHERE vehicle_id = t_v(22) AND signal = 'receipt') = 'B', 'a receipt is supporting');
SELECT t_assert((SELECT count(*) FROM sg WHERE vehicle_id NOT IN (SELECT vehicle_id FROM sg WHERE signal IN ('site_photo', 'org_link', 'work_session', 'receipt', 'contributor_link_upload'))) = 0,
  'every returned car has a tie to the garage');

-- ===== Dry run and fold ===========================================================================================
SELECT t_fingerprint() AS fp0 \gset
SELECT count(*) AS stays_before FROM garage_vehicle_stays \gset
SET ROLE service_role;
SELECT count(*) AS dry_now FROM garage_stays_dry_run(:'g') \gset
SELECT count(*) AS dry_t1 FROM garage_stays_dry_run(:'g', 'v1', TIMESTAMPTZ '2024-12-31 23:59:59+00') \gset
RESET ROLE;
SELECT t_assert(:stays_before = 0 AND (SELECT count(*) FROM garage_vehicle_stays) = 0 AND (SELECT count(*) FROM garage_stay_evidence) = 0,
  'the dry run writes nothing');
SELECT t_assert(:dry_now = 18, 'dry run as of now: 18 stays for 17 cars (the car that came back has two)');
SELECT t_assert(:dry_t1 = 6, 'dry run as of 2024-12-31 sees only what was known then: 5 seen cars plus V01, related by a 2024-01-01 link but not yet photographed');

SET ROLE service_role;
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_fold_stays(%L, 'v1', TIMESTAMPTZ '2024-12-31 23:59:59+00')$q$, :'g')) = '55000',
  'the writer refuses an as-of date in the past (it would replace the current fold) unless allowed');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_fold_stays(%L, 'nope')$q$, :'g')) = '22023', 'an unknown derivation version is refused');
SELECT * FROM garage_fold_stays(:'g') \gset f1_
RESET ROLE;
SELECT t_assert(:f1_stays_total = 18 AND :f1_stays_inserted = 18 AND :f1_stays_updated = 0 AND :f1_stays_deleted = 0,
  'first fold inserts 18 stays');
SELECT t_assert(t_fingerprint() = :'fp0', 'the fold changed no table outside garage_* (fingerprint of every other public table is identical)');
SELECT md5(string_agg(s::text, ',' ORDER BY s.id)) AS stays_h1 FROM garage_vehicle_stays s \gset
SELECT md5(string_agg(e::text, ',' ORDER BY e.id)) AS ev_h1 FROM garage_stay_evidence e \gset
SET ROLE service_role;
SELECT * FROM garage_fold_stays(:'g') \gset f2_
RESET ROLE;
SELECT t_assert(:f2_stays_inserted = 0 AND :f2_stays_updated = 0 AND :f2_stays_deleted = 0 AND :f2_stays_unchanged = 18,
  'second fold changes nothing (idempotent)');
SELECT t_assert((SELECT md5(string_agg(s::text, ',' ORDER BY s.id)) FROM garage_vehicle_stays s) = :'stays_h1'
  AND (SELECT md5(string_agg(e::text, ',' ORDER BY e.id)) FROM garage_stay_evidence e) = :'ev_h1',
  'every stay and citation row is byte-identical after the re-run (ids, derived_at and recorded_at included)');
SELECT t_assert((SELECT count(*) FROM garage_vehicle_stays WHERE garage_id = :'g' AND departed_at IS NULL)
  = (SELECT count(DISTINCT vehicle_id) FROM garage_vehicle_stays WHERE garage_id = :'g' AND departed_at IS NULL), 'at most one open stay per car');

-- Stays: the car that left and came back is two stays.
SELECT t_assert((SELECT count(*) FROM garage_vehicle_stays WHERE vehicle_id = t_v(7)) = 2, 'a car that left and came back is two stays');
SELECT t_assert((SELECT departure_basis FROM garage_vehicle_stays WHERE vehicle_id = t_v(7) ORDER BY arrived_at LIMIT 1) = 'unseen_gap'
  AND (SELECT departed_at FROM garage_vehicle_stays WHERE vehicle_id = t_v(7) ORDER BY arrived_at LIMIT 1) = TIMESTAMPTZ '2020-01-11 15:00+00'
  AND (SELECT departed_at FROM garage_vehicle_stays WHERE vehicle_id = t_v(7) ORDER BY arrived_at DESC LIMIT 1) IS NULL,
  'the earlier stay closes at its own last sighting with basis unseen_gap; the later one is open');
SELECT t_assert((SELECT departure_basis FROM garage_vehicle_stays WHERE vehicle_id = t_v(4)) = 'sale_event'
  AND (SELECT departed_at FROM garage_vehicle_stays WHERE vehicle_id = t_v(4)) = TIMESTAMPTZ '2024-04-15 00:00+00', 'a sale after the last sighting ends the stay at the sale');
SELECT t_assert((SELECT departure_basis FROM garage_vehicle_stays WHERE vehicle_id = t_v(12)) = 'listing', 'a listing after the last sighting ends the stay with basis listing (weak, and says so)');
SELECT t_assert((SELECT departed_at IS NULL FROM garage_vehicle_stays WHERE vehicle_id = t_v(1)), 'a sale dated years before the first sighting is not an exit');
SELECT t_assert((SELECT departure_basis FROM garage_vehicle_stays WHERE vehicle_id = t_v(55)) = 'record_deleted_or_merged'
  AND (SELECT count(*) FROM garage_vehicle_stays WHERE vehicle_id IN (t_v(5), t_v(56))) = 0, 'a deleted terminal record ends the stay as gone; merged-away ids hold no stays');
SELECT t_assert((SELECT arrived_at FROM garage_vehicle_stays WHERE vehicle_id = t_v(8)) = TIMESTAMPTZ '2025-12-28 15:00+00', 'arrived_at is the first location-proving sighting');
SELECT t_assert((SELECT relationship FROM garage_vehicle_stays WHERE vehicle_id = t_v(1)) = 'owned'
  AND (SELECT relationship FROM garage_vehicle_stays WHERE vehicle_id = t_v(4)) = 'consignment'
  AND (SELECT relationship FROM garage_vehicle_stays WHERE vehicle_id = t_v(6)) = 'customer_work'
  AND (SELECT relationship FROM garage_vehicle_stays WHERE vehicle_id = t_v(13)) = 'dealer_inventory'
  AND (SELECT organization_id FROM garage_vehicle_stays WHERE vehicle_id = t_v(13)) = '00000000-0000-0000-0000-0000000000c2',
  'owned, consignment, customer_work and dealer_inventory (with the hosting org) are each picked from the strongest link');
SELECT t_assert((SELECT relationship FROM garage_vehicle_stays WHERE vehicle_id = t_v(14)) = 'unknown', 'contribution never implies owned: relationship stays unknown');
SELECT t_assert((SELECT relationship FROM garage_vehicle_stays WHERE vehicle_id = t_v(2)) = 'unknown', 'no relationship evidence: unknown, not a guess');
SELECT t_assert((SELECT confidence FROM garage_vehicle_stays WHERE vehicle_id = t_v(1)) = 0.68
  AND (SELECT confidence FROM garage_vehicle_stays WHERE vehicle_id = t_v(8)) = 0.55
  AND (SELECT confidence FROM garage_vehicle_stays WHERE vehicle_id = t_v(6)) = 0.17,
  'confidence follows the stated v1 formula (two photos + known relationship 0.68; one photo 0.55; never seen, supporting only 0.17)');
SELECT t_assert((SELECT evidence_count FROM garage_vehicle_stays WHERE vehicle_id = t_v(1)) = (SELECT count(*) FROM garage_stay_evidence e JOIN garage_vehicle_stays s ON s.id = e.stay_id WHERE s.vehicle_id = t_v(1)),
  'evidence_count equals the citations written');
SELECT t_assert((SELECT count(*) FROM garage_stay_evidence e JOIN garage_vehicle_stays s ON s.id = e.stay_id WHERE s.vehicle_id = t_v(4) AND e.signal = 'sale_event') = 1
  AND (SELECT count(*) FROM garage_stay_evidence e JOIN garage_vehicle_stays s ON s.id = e.stay_id WHERE s.vehicle_id = t_v(4) AND e.signal_class = 'A') = 2,
  'a stay cites its sightings and the exit that ended it');
SELECT t_assert((SELECT last_seen_at = arrived_at FROM garage_vehicle_stays WHERE vehicle_id = t_v(6))
  AND (SELECT count(*) FROM garage_stay_evidence e JOIN garage_vehicle_stays s ON s.id = e.stay_id WHERE s.vehicle_id = t_v(6) AND e.signal_class = 'A') = 0,
  'a never-seen car holds a stay with no class A citation');

-- ===== garage_now as of two dates (+ one in between) ================================================================
SET ROLE authenticated; SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
-- As of 2026-02-01 (T2).
SELECT t_assert((SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00')) = 17, 'T2 (2026-02-01): 17 cars have a stay');
SELECT t_assert(t_state(:'g', t_v(1),  TIMESTAMPTZ '2026-02-01 00:00+00') = 'here', 'T2 V01 here (last sighting 43 d before)');
SELECT t_assert(t_state(:'g', t_v(2),  TIMESTAMPTZ '2026-02-01 00:00+00') = 'probably_here', 'T2 V02 probably_here (245 d)');
SELECT t_assert(t_state(:'g', t_v(3),  TIMESTAMPTZ '2026-02-01 00:00+00') = 'stale', 'T2 V03 stale (> 365 d, no exit: the UI asks)');
SELECT t_assert(t_state(:'g', t_v(4),  TIMESTAMPTZ '2026-02-01 00:00+00') = 'left', 'T2 V04 left (sold after the last sighting)');
SELECT t_assert(t_state(:'g', t_v(55), TIMESTAMPTZ '2026-02-01 00:00+00') = 'gone', 'T2 the merged-then-deleted car is gone');
SELECT t_assert(t_state(:'g', t_v(57), TIMESTAMPTZ '2026-02-01 00:00+00') = 'here'
  AND NOT EXISTS (SELECT 1 FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id IN (t_v(5), t_v(56))), 'T2 history of a merged record is on its live terminal record, and the merged ids do not appear');
SELECT t_assert(t_state(:'g', t_v(6),  TIMESTAMPTZ '2026-02-01 00:00+00') = 'never_seen_here', 'T2 V06 never_seen_here (link, session, no-GPS photo)');
SELECT t_assert(t_state(:'g', t_v(22), TIMESTAMPTZ '2026-02-01 00:00+00') = 'never_seen_here'
  AND t_state(:'g', t_v(23), TIMESTAMPTZ '2026-02-01 00:00+00') = 'never_seen_here', 'T2 a receipt-only car and a contributor-link-only car are related, never seen here');
SELECT t_assert(t_state(:'g', t_v(7),  TIMESTAMPTZ '2026-02-01 00:00+00') = 'here'
  AND (SELECT arrived_at FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(7)) = TIMESTAMPTZ '2025-12-15 15:00+00',
  'T2 the returning car is here, and its arrived_at is the NEW stay''s');
SELECT t_assert(t_state(:'g', t_v(8),  TIMESTAMPTZ '2026-02-01 00:00+00') = 'here'
  AND (SELECT proving_evidence ->> 'originator_user_id' FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(8)) = '00000000-0000-0000-0000-0000000000a2'
  AND (SELECT proving_evidence ->> 'signal' FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(8)) = 'site_photo',
  'T2 the technician''s car is here and the proving evidence is his photo with him as originator');
SELECT t_assert(t_state(:'g', t_v(12), TIMESTAMPTZ '2026-02-01 00:00+00') = 'left'
  AND (SELECT proving_evidence ->> 'signal' FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(12)) = 'listing', 'T2 listed after the last sighting: left, proved by the listing');
SELECT t_assert((SELECT last_seen_at FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(1)) = TIMESTAMPTZ '2025-12-20 15:00+00'
  AND (SELECT last_seen_at FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(6)) IS NULL,
  'every state returns its freshness; a never-seen car has none (unknown is unknown)');
SELECT t_assert((SELECT relationship FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(4)) = 'consignment'
  AND (SELECT relationship FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(6)) = 'customer_work'
  AND (SELECT relationship FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(1)) = 'owned', 'T2 consignment, customer_work and owned side by side');
SELECT t_assert((SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE state = 'here') = 8
  AND (SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE state = 'probably_here') = 1
  AND (SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE state = 'stale') = 2
  AND (SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE state = 'left') = 2
  AND (SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE state = 'gone') = 1
  AND (SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE state = 'never_seen_here') = 3,
  'T2 before any human word: 8 here, 1 probably_here, 2 stale, 2 left, 1 gone, 3 never seen = 17');

-- As of 2024-12-31 (T1): only what had begun by then. The stay of V07 that closed on a gap is still open here (the gap is not known yet).
SELECT t_assert((SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2024-12-31 23:59:59+00')) = 5, 'T1 (2024-12-31): 5 cars had a stay');
SELECT t_assert(t_state(:'g', t_v(3),  TIMESTAMPTZ '2024-12-31 23:59:59+00') = 'stale'
  AND t_state(:'g', t_v(4),  TIMESTAMPTZ '2024-12-31 23:59:59+00') = 'left'
  AND t_state(:'g', t_v(55), TIMESTAMPTZ '2024-12-31 23:59:59+00') = 'gone'
  AND t_state(:'g', t_v(7),  TIMESTAMPTZ '2024-12-31 23:59:59+00') = 'stale'
  AND t_state(:'g', t_v(10), TIMESTAMPTZ '2024-12-31 23:59:59+00') = 'probably_here', 'T1 states: V03 stale, V04 left, V55 gone, V07 stale, V10 probably_here (361 d)');
SELECT t_assert((SELECT departed_at IS NULL AND last_seen_at = TIMESTAMPTZ '2020-01-11 15:00+00' FROM garage_now(:'g', TIMESTAMPTZ '2024-12-31 23:59:59+00') WHERE vehicle_id = t_v(7)),
  'T1 V07: still the earlier, open stay; the unseen-gap close is not known before the next stay arrives');
SELECT t_assert((SELECT relationship FROM garage_now(:'g', TIMESTAMPTZ '2024-12-31 23:59:59+00') WHERE vehicle_id = t_v(10)) = 'owned', 'T1 V10 is owned (operator owner link)');
-- Replay: between the last sighting and the sale a car is here; after the deletion date a car is gone and before it, not.
SELECT t_assert(t_state(:'g', t_v(4), TIMESTAMPTZ '2024-04-01 00:00+00') = 'here' AND t_state(:'g', t_v(4), TIMESTAMPTZ '2024-04-16 00:00+00') = 'left',
  'replay: V04 is here on 2024-04-01 and left on 2024-04-16 (the sale was 2024-04-15)');
SELECT t_assert(t_state(:'g', t_v(55), TIMESTAMPTZ '2024-05-01 00:00+00') = 'here' AND t_state(:'g', t_v(55), TIMESTAMPTZ '2024-08-02 00:00+00') = 'gone',
  'replay: the record that is deleted on 2024-08-01 reads here before and gone after');
SELECT t_assert(t_state(:'g', t_v(7), TIMESTAMPTZ '2020-06-01 00:00+00') = 'probably_here' AND NOT EXISTS (SELECT 1 FROM garage_now(:'g', TIMESTAMPTZ '2019-01-01 00:00+00')),
  'replay: V07 was probably_here in June 2020 (142 d); in 2019 the garage had no known car');
SELECT t_assert((SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2024-04-01 00:00+00') WHERE state = 'here') = 3, 'replay 2024-04-01: V04, V55 and V10 are here');
RESET ROLE;

-- ===== Human words outrank derivation ====================================================================================
SET ROLE authenticated; SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a2');
SELECT t_assert(t_sqlstate(format($q$SELECT garage_record_assertion(%L, %L, 'left', '{"on": "2026-01-10T00:00:00Z"}')$q$, :'g', t_v(11))) = '42501',
  'a technician cannot say a car left (rank 80 needed)');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a5');
SELECT garage_record_assertion(:'g', t_v(11), 'left', '{"on": "2026-01-10T00:00:00Z"}') AS a_left \gset
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT garage_record_assertion(:'g', t_v(10), 'here', '{}') AS a_here \gset
SELECT garage_record_assertion(:'g', t_v(10), 'relationship', '{"relationship": "storage"}') AS a_rel \gset
RESET ROLE;
-- Fixture: the statements are dated inside the fixture's timeline (a writer stamps now()).
UPDATE garage_stay_assertions SET asserted_at = TIMESTAMPTZ '2026-01-12 00:00+00' WHERE id = :'a_left';
UPDATE garage_stay_assertions SET asserted_at = TIMESTAMPTZ '2026-01-10 00:00+00' WHERE id IN (:'a_here', :'a_rel');
-- Before any fold the read already honours a relationship statement (an assertion outranks derivation) and not one dated later.
SET ROLE authenticated; SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert((SELECT relationship FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(10)) = 'storage'
  AND (SELECT relationship FROM garage_now(:'g', TIMESTAMPTZ '2026-01-05 00:00+00') WHERE vehicle_id = t_v(10)) = 'owned',
  'a relationship assertion overrides the derived relationship from its date on, not before (no hindsight)');
RESET ROLE;
SET ROLE service_role;
SELECT * FROM garage_fold_stays(:'g') \gset f3_
RESET ROLE;
SELECT t_assert(:f3_stays_inserted = 1 AND :f3_stays_updated = 2 AND :f3_stays_deleted = 0 AND :f3_stays_total = 19,
  'refold after the words: the owner''s "here" starts a new stay for V10 (2 years unseen), V10''s old stay and V11 close; nothing else moves');
SELECT t_assert((SELECT count(*) FROM garage_stay_assertions WHERE superseded_by IS NULL) = 3, 'the fold never touched an assertion');
SELECT t_assert((SELECT relationship FROM garage_vehicle_stays WHERE vehicle_id = t_v(10) ORDER BY arrived_at DESC LIMIT 1) = 'storage'
  AND (SELECT relationship FROM garage_vehicle_stays WHERE vehicle_id = t_v(10) ORDER BY arrived_at LIMIT 1) = 'storage',
  'the assertion beats the derived "owned" in the fold too (assertion 3 > org link 2)');
SET ROLE authenticated; SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert(t_state(:'g', t_v(10), TIMESTAMPTZ '2026-02-01 00:00+00') = 'here'
  AND (SELECT proving_evidence ->> 'signal' FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(10)) = 'member_assertion'
  AND t_state(:'g', t_v(10), TIMESTAMPTZ '2026-01-05 00:00+00') = 'stale',
  'an owner''s "here" beats a stale derivation (and only from its own date)');
SELECT t_assert(t_state(:'g', t_v(11), TIMESTAMPTZ '2026-02-01 00:00+00') = 'left'
  AND (SELECT proving_evidence ->> 'signal' FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE vehicle_id = t_v(11)) = 'member_assertion'
  AND t_state(:'g', t_v(11), TIMESTAMPTZ '2026-01-05 00:00+00') = 'here',
  'a manager''s "left on 2026-01-10" beats the sighting, from its date on');
SELECT t_assert((SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE state = 'here') = 8
  AND (SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE state = 'stale') = 1
  AND (SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00') WHERE state = 'left') = 3, 'T2 after the words: 8 here, 1 stale, 3 left');
RESET ROLE;

-- ===== garage_timeline: buckets ===========================================================================================
SET ROLE authenticated; SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
CREATE TEMP TABLE tl AS SELECT * FROM garage_timeline(:'g', DATE '2024-01-01', DATE '2024-05-31', 'month');
GRANT SELECT ON tl TO PUBLIC;
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM tl) = 5, 'five monthly buckets, January to May 2024');
SELECT t_assert((SELECT array_agg(arrivals ORDER BY bucket) FROM tl) = ARRAY[1,1,1,0,0], 'arrivals: V10 in Jan, V55 in Feb, V04 in Mar');
SELECT t_assert((SELECT array_agg(departures ORDER BY bucket) FROM tl) = ARRAY[0,0,0,1,0], 'departures: V04 sold in April (V55 left in August, outside the range); V10''s unseen-gap closure on its last sighting date is not a departure');
SELECT t_assert((SELECT (basis ->> 'unseen_gap_closures')::int FROM tl WHERE bucket = DATE '2024-01-01') = 1, 'the unseen-gap closure is reported in the basis instead, dated by the last sighting');
SELECT t_assert((SELECT array_agg(here_count ORDER BY bucket) FROM tl) = ARRAY[2,3,4,3,3], 'here_count at each month end (here + probably_here)');
SELECT t_assert((SELECT array_agg(unknown_count ORDER BY bucket) FROM tl) = ARRAY[1,1,1,1,1], 'unknown_count: V07''s stay, last seen 2020, is stale all five months (the UI asks)');
SELECT t_assert((SELECT bool_and(basis ->> 'scope' = 'all_vehicles_in_garage' AND (basis -> 'derivation_versions') = '["v1"]'::jsonb AND (basis ->> 'site_known')::boolean) FROM tl)
  AND (SELECT (basis -> 'states' ->> 'left')::int FROM tl WHERE bucket = DATE '2024-04-01') = 1
  AND (SELECT (basis ->> 'as_of')::timestamptz FROM tl WHERE bucket = DATE '2024-02-01') = TIMESTAMPTZ '2024-02-29 23:59:59.999999+00',
  'every bucket carries its basis: scope, derivation version, the as-of instant, a state breakdown and whether a site was known');
SELECT t_assert((SELECT departures_by_basis FROM (SELECT basis -> 'departures_by_basis' AS departures_by_basis, bucket FROM tl) z WHERE bucket = DATE '2024-04-01') = '{"sale_event": 1}'::jsonb, 'departures carry their basis');
SET ROLE authenticated; SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert((SELECT (basis ->> 'site_known')::boolean FROM garage_timeline(:'g', DATE '2019-01-01', DATE '2019-01-31', 'month')) = false
  AND (SELECT (basis ->> 'site_known')::boolean FROM garage_timeline(:'g', DATE '2020-01-01', DATE '2020-01-31', 'month')) = true,
  'a month before any confirmed site says site_known = false: those counts are what the evidence says, not "the garage was empty"');
SELECT t_assert((SELECT here_count FROM garage_timeline(:'g', DATE '2020-01-01', DATE '2020-01-31', 'month')) = 1
  AND (SELECT arrivals FROM garage_timeline(:'g', DATE '2020-01-01', DATE '2020-01-31', 'month')) = 1, 'January 2020: V07 arrives and is here');
SELECT t_assert((SELECT count(*) FROM garage_timeline(:'g', DATE '2017-01-01', DATE '2026-02-01', 'year')) = 10, 'yearly buckets span 2017..2026');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_timeline(%L, DATE '2017-01-01', DATE '2026-01-01', 'fortnight')$q$, :'g')) = '22023', 'an unknown bucket is refused');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_timeline(%L, DATE '2017-01-01', DATE '2026-01-01', 'day')$q$, :'g')) = '54000', 'a timeline of more than 800 buckets is refused');
RESET ROLE;

-- ===== Evidence reader, visibility, membership ================================================================================
SELECT id AS stay8 FROM garage_vehicle_stays WHERE vehicle_id = t_v(8) \gset
SELECT id AS stay1 FROM garage_vehicle_stays WHERE vehicle_id = t_v(1) \gset
SET ROLE authenticated; SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert((SELECT count(*) FROM garage_stay_evidence_read(:'stay1')) = 3
  AND (SELECT bool_and(affiliation_garage_id = :'g') FROM garage_stay_evidence_read(:'stay1')), 'the owner reads every citation of a stay, each with the garage it belongs to (2 photos + the org link)');
SELECT t_assert((SELECT originator_user_id FROM garage_stay_evidence_read(:'stay8') WHERE signal = 'site_photo') = '00000000-0000-0000-0000-0000000000a2'
  AND (SELECT affiliation_garage_id FROM garage_stay_evidence_read(:'stay8') WHERE signal = 'site_photo') = :'g'
  AND (SELECT recorded_at FROM garage_stay_evidence_read(:'stay8') WHERE signal = 'site_photo') IS NOT NULL,
  'originator (the technician) and affiliation (the garage) are separate columns, with both clocks');
-- The technician: the visibility helper is the core's fail-closed stub, so he sees no car through the garage, but his own citation.
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a2');
SELECT t_assert((SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00')) = 0, 'a technician sees no car through garage_now while the visibility helper fails closed');
SELECT t_assert((SELECT count(*) FROM garage_stay_evidence_read(:'stay8')) = 1 AND (SELECT count(*) FROM garage_stay_evidence_read(:'stay1')) = 0,
  'an originator still reads his own citation, and nothing else of a car he cannot see');
SELECT t_assert((SELECT (basis ->> 'scope') FROM garage_timeline(:'g', DATE '2024-04-01', DATE '2024-04-30', 'month')) = 'visible_to_viewer'
  AND (SELECT here_count FROM garage_timeline(:'g', DATE '2024-04-01', DATE '2024-04-30', 'month')) = 0, 'timeline counts for a lower rank cover only the cars they may see, and say so');
-- The manager sees everything.
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a5');
SELECT t_assert((SELECT count(*) FROM garage_now(:'g', TIMESTAMPTZ '2026-02-01 00:00+00')) = 17, 'a manager sees every car');
-- An outsider reads nothing and is told so (never an empty garage).
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a3');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_now(%L)$q$, :'g')) = '42501', 'a non-member is refused by garage_now');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_timeline(%L, DATE '2024-01-01', DATE '2024-02-01')$q$, :'g')) = '42501', 'a non-member is refused by garage_timeline');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_stay_evidence_read(%L)$q$, :'stay1')) = '42501', 'a non-member is refused by garage_stay_evidence_read');
SELECT t_assert((SELECT count(*) FROM garage_vehicle_stays) = 0 AND (SELECT count(*) FROM garage_stay_evidence) = 0, 'and reads no stay or citation row directly either');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM garage_stay_evidence_read(gen_random_uuid())) = 0, 'an unknown stay id returns no rows');

-- Nothing in the fold ever wrote to the live tables, through all the folds.
SELECT t_assert(t_fingerprint() = :'fp0', 'at the end every non-garage table is still byte-identical to the fixture');
\echo 'PRESENCE CONTRACT PASSED'
