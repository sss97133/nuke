-- Disposable PG17 only. Proves the DRAFT garage core DDL (supabase/drafts/garage-model/migrations/20261112100000_garage_core.sql,
-- NOT in supabase/migrations): it loads on an empty database, the rank ladder orders, the constraints refuse bad rows,
-- one live membership per person per garage, a stay can be re-entered only after it closed, a human assertion cannot be
-- overwritten by a lower rank, no client can write a table directly, a non-member reads nothing, and the stubs fail loud.
-- Fixture: only the live tables the draft references (organizations, organization_locations, user_sites,
-- external_identities, vehicles, auth.users), reduced to their id; the roles and auth.uid() as Supabase defines them.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.garages') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
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
CREATE TABLE public.organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_name text);
CREATE TABLE public.organization_locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.user_sites(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.vehicles(id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
CREATE FUNCTION public.t_sqlstate(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION public.t_as(p_role text, p_sub uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_role, 'sub', p_sub)::text, false); END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text), public.t_sqlstate(text), public.t_as(text,uuid)
  TO anon, authenticated, service_role;

-- a1 owner, a2 technician (active), a3 outsider, a4 pending applicant, a5 manager (active), a6 photographer (active)
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'),('00000000-0000-0000-0000-0000000000a4'),('00000000-0000-0000-0000-0000000000a5'),
  ('00000000-0000-0000-0000-0000000000a6');
INSERT INTO public.vehicles(id) VALUES ('00000000-0000-0000-0000-0000000000b1'),('00000000-0000-0000-0000-0000000000b2');
INSERT INTO public.organizations(id, business_name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'fixture dealer');

-- The draft loads on the empty database.
\ir ../drafts/garage-model/migrations/20261112100000_garage_core.sql

-- Rank ladder, exactly as CONTRACT.md fixes it, and unknown roles rank 0.
SELECT t_assert(
  (SELECT array_agg(garage_role_rank(r) ORDER BY ord)
     FROM unnest(ARRAY['owner','manager','technician','staff','photographer','customer','viewer']) WITH ORDINALITY AS u(r, ord))
  = ARRAY[100, 80, 50, 40, 30, 20, 10], 'rank ladder is 100/80/50/40/30/20/10');
SELECT t_assert(garage_role_rank('nonsense') = 0 AND garage_role_rank(NULL) = 0, 'unknown or null role ranks 0');
SELECT t_assert(garage_role_rank('owner') > garage_role_rank('manager') AND garage_role_rank('manager') > garage_role_rank('technician')
  AND garage_role_rank('technician') > garage_role_rank('staff') AND garage_role_rank('staff') > garage_role_rank('photographer')
  AND garage_role_rank('photographer') > garage_role_rank('customer') AND garage_role_rank('customer') > garage_role_rank('viewer')
  AND garage_role_rank('viewer') > 0, 'ranks are strictly ordered and all above 0');

-- A signed-in user starts a garage and is its active owner; the operator org is linked.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT create_garage('Fixture shop', '00000000-0000-0000-0000-0000000000c1') AS g \gset
SELECT t_assert((SELECT count(*) FROM garage_my_garages() WHERE garage_id = :'g' AND role = 'owner' AND rank = 100 AND member_status = 'active') = 1,
  'creator is the active owner with rank 100');
SELECT t_assert(garage_member_rank(:'g') = 100, 'garage_member_rank is 100 for the owner');
SELECT t_assert((SELECT count(*) FROM garage_organizations WHERE garage_id = :'g' AND kind = 'operator') = 1, 'operator org linked');
SELECT t_assert(t_sqlstate($q$SELECT create_garage('   ')$q$) IS NOT NULL, 'a blank garage name is refused');
SELECT t_as('anon', NULL);
RESET ROLE;
SET ROLE anon;
SELECT t_assert(t_sqlstate($q$SELECT create_garage('anon garage')$q$) = '42501', 'anon cannot execute create_garage');
RESET ROLE;

-- Fixture members, written the way a SECURITY DEFINER writer (JOIN lane) would: as the table owner.
INSERT INTO garage_members(garage_id, user_id, role, status, approved_by, approved_at, started_at) VALUES
  (:'g', '00000000-0000-0000-0000-0000000000a2', 'technician', 'active', '00000000-0000-0000-0000-0000000000a1', now(), now()),
  (:'g', '00000000-0000-0000-0000-0000000000a5', 'manager', 'active', '00000000-0000-0000-0000-0000000000a1', now(), now()),
  (:'g', '00000000-0000-0000-0000-0000000000a6', 'photographer', 'active', '00000000-0000-0000-0000-0000000000a1', now(), now());
INSERT INTO garage_members(garage_id, user_id, role, status) VALUES (:'g', '00000000-0000-0000-0000-0000000000a4', 'technician', 'pending');

-- Constraints.
SELECT t_assert(t_refused(format($q$INSERT INTO garage_members(garage_id, user_id, role) VALUES (%L, %L, 'boss')$q$, :'g', '00000000-0000-0000-0000-0000000000a3')),
  'an invalid role is refused');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_members(garage_id, user_id, role, status) VALUES (%L, %L, 'viewer', 'maybe')$q$, :'g', '00000000-0000-0000-0000-0000000000a3')),
  'an invalid status is refused');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_members(garage_id, role) VALUES (%L, 'viewer')$q$, :'g')),
  'a member needs a user or an external identity');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_members(garage_id, user_id, role, status) VALUES (%L, %L, 'viewer', 'active')$q$, :'g', '00000000-0000-0000-0000-0000000000a3')),
  'an active member needs an approval and a start');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_members(garage_id, user_id, role, status, approved_at, started_at) VALUES (%L, %L, 'viewer', 'active', now(), now())$q$, :'g', '00000000-0000-0000-0000-0000000000a2')),
  'a second active membership for the same user in the same garage is refused');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_members(garage_id, user_id, role, status) VALUES (%L, %L, 'viewer', 'pending')$q$, :'g', '00000000-0000-0000-0000-0000000000a2')),
  'a pending row beside an active one is refused too (one live membership)');
UPDATE garage_members SET status = 'left', ended_at = now() WHERE garage_id = :'g' AND user_id = '00000000-0000-0000-0000-0000000000a6';
INSERT INTO garage_members(garage_id, user_id, role, status) VALUES (:'g', '00000000-0000-0000-0000-0000000000a6', 'photographer', 'pending');
SELECT t_assert((SELECT count(*) FROM garage_members WHERE garage_id = :'g' AND user_id = '00000000-0000-0000-0000-0000000000a6') = 2,
  'after leaving, the same person can apply again; the old row stays as history');
UPDATE garage_members SET status = 'revoked', ended_at = now() WHERE garage_id = :'g' AND user_id = '00000000-0000-0000-0000-0000000000a6' AND status = 'pending';
INSERT INTO garage_members(garage_id, user_id, role, status, approved_at, started_at)
  VALUES (:'g', '00000000-0000-0000-0000-0000000000a6', 'photographer', 'active', now(), now());

SELECT t_assert(t_refused(format($q$INSERT INTO garage_join_links(garage_id, token_hash, role, expires_at, created_by) VALUES (%L, repeat('a', 64), 'owner', now() + interval '1 day', %L)$q$, :'g', '00000000-0000-0000-0000-0000000000a1')),
  'a join link can never carry the owner role');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_join_links(garage_id, token_hash, role, expires_at, created_by) VALUES (%L, 'not-a-sha256', 'technician', now() + interval '1 day', %L)$q$, :'g', '00000000-0000-0000-0000-0000000000a1')),
  'a join link stores a sha256 hex hash, not a raw token');
INSERT INTO garage_join_links(garage_id, token_hash, role, expires_at, created_by)
  VALUES (:'g', repeat('a', 64), 'technician', now() + interval '1 day', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_join_links(garage_id, token_hash, role, expires_at, created_by) VALUES (%L, repeat('a', 64), 'staff', now() + interval '1 day', %L)$q$, :'g', '00000000-0000-0000-0000-0000000000a1')),
  'token hashes are unique');
SELECT t_assert(t_refused($q$UPDATE garage_join_links SET uses_count = 5$q$), 'uses cannot exceed max_uses');

INSERT INTO garage_sites(garage_id, lat, lon, radius_m, valid_from, source, confirmed_by, confirmed_at)
  VALUES (:'g', 36.100, -115.100, 150, '2017-01-01', 'test', '00000000-0000-0000-0000-0000000000a1', now());
SELECT t_assert(t_refused(format($q$INSERT INTO garage_sites(garage_id, lat, lon, source) VALUES (%L, 95, 0, 'test')$q$, :'g')), 'latitude out of range refused');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_sites(garage_id, lat, lon, radius_m, source) VALUES (%L, 1, 1, 0, 'test')$q$, :'g')), 'zero radius refused');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_sites(garage_id, lat, lon, valid_from, valid_to, source) VALUES (%L, 1, 1, '2020-01-01', '2019-01-01', 'test')$q$, :'g')),
  'a site cannot end before it starts');

-- Stays: a returning car is a second stay, never a second open one.
INSERT INTO garage_vehicle_stays(id, garage_id, vehicle_id, relationship, arrived_at, last_seen_at, departed_at, departure_basis, confidence, evidence_count, derivation_version)
  VALUES ('00000000-0000-0000-0000-0000000000d1', :'g', '00000000-0000-0000-0000-0000000000b1', 'customer_work', '2024-01-10', '2024-03-01', '2024-03-05', 'sale_event', 0.80, 3, 'test');
INSERT INTO garage_vehicle_stays(id, garage_id, vehicle_id, relationship, arrived_at, last_seen_at, confidence, evidence_count, derivation_version)
  VALUES ('00000000-0000-0000-0000-0000000000d2', :'g', '00000000-0000-0000-0000-0000000000b1', 'owned', '2026-05-01', '2026-10-01', 0.90, 12, 'test');
SELECT t_assert((SELECT count(*) FROM garage_vehicle_stays WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b1') = 2,
  'a car that left and returned has two stays');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_vehicle_stays(garage_id, vehicle_id, arrived_at, last_seen_at, confidence, derivation_version) VALUES (%L, '00000000-0000-0000-0000-0000000000b1', '2026-06-01', '2026-06-02', 0.5, 'test')$q$, :'g')),
  'two open stays for one car in one garage are refused');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_vehicle_stays(garage_id, vehicle_id, relationship, arrived_at, last_seen_at, confidence, derivation_version) VALUES (%L, '00000000-0000-0000-0000-0000000000b2', 'borrowed', '2026-06-01', '2026-06-02', 0.5, 'test')$q$, :'g')),
  'an invalid relationship is refused');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_vehicle_stays(garage_id, vehicle_id, arrived_at, last_seen_at, confidence, derivation_version) VALUES (%L, '00000000-0000-0000-0000-0000000000b2', '2026-06-01', '2026-06-02', 1.5, 'test')$q$, :'g')),
  'confidence above 1 is refused');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_vehicle_stays(garage_id, vehicle_id, arrived_at, last_seen_at, departed_at, confidence, derivation_version) VALUES (%L, '00000000-0000-0000-0000-0000000000b2', '2026-06-01', '2026-06-02', '2026-06-03', 0.5, 'test')$q$, :'g')),
  'a departure needs its basis');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_vehicle_stays(garage_id, vehicle_id, arrived_at, last_seen_at, confidence, derivation_version) VALUES (%L, '00000000-0000-0000-0000-0000000000b2', '2026-06-02', '2026-06-01', 0.5, 'test')$q$, :'g')),
  'last seen cannot precede arrival');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_vehicle_stays(garage_id, vehicle_id, arrived_at, last_seen_at, confidence, derivation_version) VALUES (%L, '00000000-0000-0000-0000-0000000000b2', '2026-06-01', '2026-06-02', 0.5, '')$q$, :'g')),
  'a stay names its derivation version');

-- Evidence: originator and affiliation are separate; one citation per source row.
INSERT INTO garage_stay_evidence(stay_id, signal, source_table, source_id, observed_at, originator_user_id)
  VALUES ('00000000-0000-0000-0000-0000000000d2', 'site_photo', 'vehicle_images', 'img-1', '2026-10-01', '00000000-0000-0000-0000-0000000000a2');
SELECT t_assert((SELECT recorded_at IS NOT NULL FROM garage_stay_evidence WHERE source_id = 'img-1'), 'evidence carries a knowledge clock (recorded_at)');
SELECT t_assert(t_refused($q$INSERT INTO garage_stay_evidence(stay_id, signal, source_table, source_id, observed_at) VALUES ('00000000-0000-0000-0000-0000000000d2', 'vibes', 'x', '1', now())$q$),
  'an unknown evidence signal is refused');
SELECT t_assert(t_refused($q$INSERT INTO garage_stay_evidence(stay_id, signal, source_table, source_id, observed_at) VALUES ('00000000-0000-0000-0000-0000000000d2', 'site_photo', 'vehicle_images', 'img-1', now())$q$),
  'the same source row cannot be cited twice for a stay');
SELECT t_assert(t_refused(format($q$INSERT INTO garage_stay_evidence(stay_id, signal, source_table, source_id, observed_at, originator_user_id, originator_external_identity_id)
  VALUES ('00000000-0000-0000-0000-0000000000d2', 'site_photo', 'vehicle_images', 'img-2', now(), %L, gen_random_uuid())$q$, '00000000-0000-0000-0000-0000000000a2')),
  'an evidence row names one originator, not two');

-- Assertions: rank-gated, superseded not overwritten, a lower rank cannot replace a higher one.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a2');
SELECT garage_record_assertion(:'g', '00000000-0000-0000-0000-0000000000b2', 'here') AS tech_here \gset
SELECT t_assert(:'tech_here' IS NOT NULL, 'a technician can state that a car is here');
SELECT t_assert(t_sqlstate(format($q$SELECT garage_record_assertion(%L, '00000000-0000-0000-0000-0000000000b2', 'left', '{"on":"2026-11-01"}')$q$, :'g')) = '42501',
  'a technician cannot state that a car left');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a3');
SELECT t_assert(t_sqlstate(format($q$SELECT garage_record_assertion(%L, '00000000-0000-0000-0000-0000000000b2', 'here')$q$, :'g')) = '42501',
  'an outsider cannot assert anything');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT garage_record_assertion(:'g', '00000000-0000-0000-0000-0000000000b2', 'not_here') AS owner_not_here \gset
SELECT garage_record_assertion(:'g', '00000000-0000-0000-0000-0000000000b2', 'here') AS owner_here \gset
RESET ROLE;
SELECT t_assert((SELECT superseded_by FROM garage_stay_assertions WHERE id = :'tech_here') = :'owner_here',
  'the owner''s statement supersedes the technician''s; the original row is kept');
SELECT t_assert((SELECT count(*) FROM garage_stay_assertions WHERE kind = 'here' AND superseded_by IS NULL) = 1, 'one current statement per vehicle and kind');
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a2');
SELECT t_assert(t_sqlstate(format($q$SELECT garage_record_assertion(%L, '00000000-0000-0000-0000-0000000000b2', 'here')$q$, :'g')) = '42501',
  'a technician cannot overwrite the owner''s statement');
RESET ROLE;
SELECT t_assert(t_refused($q$INSERT INTO garage_stay_assertions(garage_id, vehicle_id, asserted_by, kind) SELECT garage_id, vehicle_id, asserted_by, 'left' FROM garage_stay_assertions LIMIT 1$q$),
  'a left statement needs its date');
SELECT t_assert(t_refused($q$INSERT INTO garage_stay_assertions(garage_id, vehicle_id, asserted_by, kind) SELECT garage_id, vehicle_id, asserted_by, 'teleported' FROM garage_stay_assertions LIMIT 1$q$),
  'an invalid assertion kind is refused');

-- RLS. Rows exist in every table; now read them as each kind of caller.
SELECT t_assert((SELECT count(*) FROM garages) = 1 AND (SELECT count(*) FROM garage_members) >= 5 AND (SELECT count(*) FROM garage_vehicle_stays) = 2
  AND (SELECT count(*) FROM garage_stay_evidence) = 1 AND (SELECT count(*) FROM garage_stay_assertions) >= 3
  AND (SELECT count(*) FROM garage_sites) = 1 AND (SELECT count(*) FROM garage_join_links) = 1 AND (SELECT count(*) FROM garage_organizations) = 1,
  'fixture: every table has rows (as table owner)');
SELECT t_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.garages'::regclass) AND
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname LIKE 'garage\_%' AND relkind = 'r' AND relnamespace = 'public'::regnamespace),
  'RLS is enabled on every garage table');

-- Non-member a3 (and anon): nothing.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a3');
SELECT t_assert((SELECT count(*) FROM garages) = 0, 'non-member reads no garage');
SELECT t_assert((SELECT count(*) FROM garage_members) = 0, 'non-member reads no membership');
SELECT t_assert((SELECT count(*) FROM garage_sites) = 0, 'non-member reads no site');
SELECT t_assert((SELECT count(*) FROM garage_join_links) = 0, 'non-member reads no join link');
SELECT t_assert((SELECT count(*) FROM garage_organizations) = 0, 'non-member reads no hosted org');
SELECT t_assert((SELECT count(*) FROM garage_vehicle_stays) = 0, 'non-member reads no stay');
SELECT t_assert((SELECT count(*) FROM garage_stay_evidence) = 0, 'non-member reads no citation');
SELECT t_assert((SELECT count(*) FROM garage_stay_assertions) = 0, 'non-member reads no assertion');
SELECT t_assert((SELECT count(*) FROM garage_my_garages()) = 0, 'non-member has no garages');
SELECT t_assert((SELECT count(*) FROM garage_members_read(:'g')) = 0, 'non-member reads no roster');
SELECT t_assert(garage_member_rank(:'g') = 0, 'non-member rank is 0');
SELECT t_assert(can_see_vehicle_via_garage('00000000-0000-0000-0000-0000000000b1') = false, 'stub visibility helper fails closed');
RESET ROLE;
SET ROLE anon;
SELECT t_as('anon', NULL);
SELECT t_assert(t_refused($q$SELECT count(*) FROM garages$q$), 'anon has no table grant on garages');
SELECT t_assert(t_refused($q$SELECT * FROM garage_members_read('00000000-0000-0000-0000-000000000000')$q$), 'anon cannot execute the roster read');
RESET ROLE;

-- Pending applicant a4: sees only their own pending row, not the garage.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a4');
SELECT t_assert((SELECT count(*) FROM garages) = 0, 'a pending applicant does not read the garage row');
SELECT t_assert((SELECT count(*) FROM garage_members) = 1, 'a pending applicant reads only their own membership row');
SELECT t_assert((SELECT member_status FROM garage_my_garages()) = 'pending', 'the app can tell the applicant they are waiting');
SELECT t_assert(garage_member_rank(:'g') = 0, 'a pending applicant has rank 0');
SELECT t_assert((SELECT count(*) FROM garage_members_read(:'g')) = 0, 'a pending applicant reads no roster');
RESET ROLE;

-- Technician a2 (rank 50): the garage, its sites and hosted orgs; not links, stays, others' memberships, assertions of others.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a2');
SELECT t_assert((SELECT count(*) FROM garages) = 1, 'technician reads the garage');
SELECT t_assert((SELECT count(*) FROM garage_sites) = 1, 'technician reads the site');
SELECT t_assert((SELECT count(*) FROM garage_organizations) = 1, 'technician reads the hosted orgs');
SELECT t_assert((SELECT count(*) FROM garage_join_links) = 0, 'technician does not read join links');
SELECT t_assert((SELECT count(*) FROM garage_vehicle_stays) = 0, 'technician does not read raw stays (garage_now serves them, gated)');
SELECT t_assert((SELECT count(*) FROM garage_stay_evidence) = 1, 'technician reads the citations they originated');
SELECT t_assert((SELECT count(*) FROM garage_members) = 1, 'technician reads only their own membership row directly');
SELECT t_assert((SELECT count(*) FROM garage_members_read(:'g')) >= 3, 'technician reads the active roster through the function');
SELECT t_assert((SELECT bool_and(status = 'active') FROM garage_members_read(:'g')), 'a technician''s roster shows active members only');
RESET ROLE;

-- Photographer a6 (rank 30): garage row yes, site no.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a6');
SELECT t_assert((SELECT count(*) FROM garages) = 1, 'photographer reads the garage');
SELECT t_assert((SELECT count(*) FROM garage_sites) = 0, 'photographer does not read the site coordinates');
RESET ROLE;

-- Manager a5 (80) and owner a1 (100): the whole place.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a5');
SELECT t_assert((SELECT count(*) FROM garage_vehicle_stays) = 2 AND (SELECT count(*) FROM garage_stay_evidence) = 1
  AND (SELECT count(*) FROM garage_join_links) = 1 AND (SELECT count(*) FROM garage_members) >= 5
  AND (SELECT count(*) FROM garage_stay_assertions) >= 3, 'a manager reads the whole place');
SELECT t_assert((SELECT count(*) FROM garage_members_read(:'g') WHERE status <> 'active') >= 1, 'a manager''s roster includes non-active rows');
RESET ROLE;

-- Nobody writes a table directly, whatever their rank.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert(t_sqlstate(format($q$INSERT INTO garage_members(garage_id, user_id, role, status, approved_at, started_at) VALUES (%L, %L, 'owner', 'active', now(), now())$q$, :'g', '00000000-0000-0000-0000-0000000000a3')) = '42501',
  'even the owner cannot insert a membership directly');
SELECT t_assert(t_sqlstate($q$UPDATE garage_vehicle_stays SET confidence = 1$q$) = '42501', 'no client can edit the derived stay fold');
SELECT t_assert(t_sqlstate($q$DELETE FROM garage_stay_assertions$q$) = '42501', 'no client can delete an assertion');
SELECT t_assert(t_sqlstate($q$UPDATE garages SET status = 'closed'$q$) = '42501', 'no client can edit a garage directly');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a3');
SELECT t_assert(t_sqlstate(format($q$INSERT INTO garage_members(garage_id, user_id, role, status, approved_at, started_at) VALUES (%L, %L, 'owner', 'active', now(), now())$q$, :'g', '00000000-0000-0000-0000-0000000000a3')) = '42501',
  'an outsider cannot make themselves a member');
RESET ROLE;

-- The stubs fail loud, so an unfilled body is never read as an empty garage (all four, as an owner).
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_now(%L)$q$, :'g')) = '0A000', 'garage_now is a stub');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_timeline(%L, '2017-01-01', '2026-11-01')$q$, :'g')) = '0A000', 'garage_timeline is a stub');
SELECT t_assert(t_sqlstate($q$SELECT * FROM garage_stay_evidence_read('00000000-0000-0000-0000-0000000000d2')$q$) = '0A000', 'garage_stay_evidence_read is a stub');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM garage_inbound_feed(%L, now() - interval '7 days')$q$, :'g')) = '0A000', 'garage_inbound_feed is a stub');
RESET ROLE;

-- Signatures the app and the other lanes build against (CONTRACT.md).
SELECT t_assert((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN
  ('garage_my_garages','garage_now','garage_timeline','garage_stay_evidence_read','garage_members_read','garage_inbound_feed',
   'garage_member_rank','can_see_vehicle_via_garage','garage_role_rank') AND p.prosecdef = (p.proname <> 'garage_role_rank')) = 9,
  'every contract function exists; all but garage_role_rank are SECURITY DEFINER');
SELECT t_assert((SELECT pg_get_function_identity_arguments('public.garage_now(uuid, timestamptz)'::regprocedure)) = 'p_garage uuid, p_as_of timestamp with time zone DEFAULT now()'
  OR pg_get_function_identity_arguments('public.garage_now(uuid, timestamptz)'::regprocedure) LIKE 'p_garage uuid, p_as_of timestamp with time zone%',
  'garage_now(p_garage, p_as_of) signature matches the contract');
SELECT t_assert(pg_get_function_identity_arguments('public.garage_timeline(uuid, date, date, text)'::regprocedure) LIKE 'p_garage uuid, p_from date, p_to date, p_bucket text%',
  'garage_timeline(p_garage, p_from, p_to, p_bucket) signature matches the contract');