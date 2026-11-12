-- Disposable PG17 only. Proves the DRAFT join-link functions (supabase/drafts/garage-model/migrations/20261112100200_garage_join_links.sql,
-- NOT in supabase/migrations) on top of the draft core DDL (20261112100000_garage_core.sql, loaded with \ir): mint, preview,
-- redeem, approve, decline, revoke; expiry; max uses; rank escalation refused; owner role unmintable; idempotent redeem;
-- the raw token is never stored; anon preview shows nothing private; anon cannot call anything else.
-- Fixture: only the live tables the core draft references, reduced to their id; roles and auth.uid() as Supabase defines them.
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

-- a1 owner, a2 existing technician, a3 outsider, a4/a7/a8/a9 applicants, a5 manager, a6 photographer.
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'),('00000000-0000-0000-0000-0000000000a4'),('00000000-0000-0000-0000-0000000000a5'),
  ('00000000-0000-0000-0000-0000000000a6'),('00000000-0000-0000-0000-0000000000a7'),('00000000-0000-0000-0000-0000000000a8'),
  ('00000000-0000-0000-0000-0000000000a9');
INSERT INTO public.organizations(id, business_name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'fixture dealer');

\ir ../drafts/garage-model/migrations/20261112100000_garage_core.sql
\ir ../drafts/garage-model/migrations/20261112100200_garage_join_links.sql

SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT create_garage('Fixture shop', '00000000-0000-0000-0000-0000000000c1') AS g \gset
SELECT create_garage('Other shop') AS g2 \gset
RESET ROLE;
INSERT INTO garage_members(garage_id, user_id, role, status, approved_by, approved_at, started_at) VALUES
  (:'g', '00000000-0000-0000-0000-0000000000a2', 'technician', 'active', '00000000-0000-0000-0000-0000000000a1', now(), now()),
  (:'g', '00000000-0000-0000-0000-0000000000a5', 'manager', 'active', '00000000-0000-0000-0000-0000000000a1', now(), now()),
  (:'g', '00000000-0000-0000-0000-0000000000a6', 'photographer', 'active', '00000000-0000-0000-0000-0000000000a1', now(), now());

-- ===== Mint =====
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT link_id AS l1, token AS tok1 FROM create_garage_join_link(:'g', 'technician') \gset
SELECT t_assert(length(:'tok1') = 43 AND :'tok1' ~ '^[A-Za-z0-9_-]{43}$', 'the token is 43 url-safe characters (32 bytes, base64url, no padding)');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM garage_join_links WHERE token_hash = encode(sha256(convert_to(:'tok1', 'UTF8')), 'hex') AND id = :'l1') = 1,
  'only the sha256 of the token is stored');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM garage_join_links l WHERE l.token_hash = :'tok1' OR l::text LIKE '%' || :'tok1' || '%'),
  'the raw token appears nowhere in the stored row');
SELECT t_assert((SELECT max_uses = 1 AND uses_count = 0 AND requires_approval AND role = 'technician'
                        AND expires_at > now() + interval '6 days 23 hours' AND expires_at < now() + interval '7 days 1 hour'
                   FROM garage_join_links WHERE id = :'l1'), 'defaults: 1 use, approval required, expires in 7 days');

-- Rank rules.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a2');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'viewer')$q$, :'g')) = '42501', 'a technician cannot mint a link');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a3');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'viewer')$q$, :'g')) = '42501', 'an outsider cannot mint a link');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'owner')$q$, :'g')) = '22023', 'the owner role cannot be minted, even by the owner');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'boss')$q$, :'g')) = '22023', 'an unknown role is refused');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'technician')$q$, :'g2')) IS NULL, 'the owner mints for their own second garage');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a5');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'technician')$q$, :'g2')) = '42501', 'a manager of one garage cannot mint for another');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'technician', 0)$q$, :'g')) = '22023', 'max_uses below 1 is refused');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'technician', 101)$q$, :'g')) = '22023', 'max_uses above 100 is refused');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'technician', 1, now() - interval '1 day')$q$, :'g')) = '22023', 'an expiry in the past is refused');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'technician', 1, now() + interval '90 days')$q$, :'g')) = '22023', 'an expiry beyond 30 days is refused');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a5');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'technician')$q$, :'g')) IS NULL, 'a manager mints a technician link');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'manager')$q$, :'g')) IS NULL, 'a manager may mint up to their own rank');
RESET ROLE;
-- "Above own rank" is only reachable by a minter below the top of the ladder: give a manager-rank row a lower-than-manager
-- check by proving the guard directly: a technician (50) is refused by the rank gate before the role gate (see above), and
-- the role gate itself is rank-based: a viewer link is not above a manager, a manager link is above nobody but the owner.
SELECT t_assert(garage_role_rank('manager') <= garage_member_rank(:'g', '00000000-0000-0000-0000-0000000000a5'),
  'the manager rank (80) covers a manager link; the owner rank (100) is the only one that covers more, and owner is not mintable');
SET ROLE anon;
SELECT t_as('anon', NULL);
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'technician')$q$, :'g')) = '42501', 'anon cannot mint');
SELECT t_assert(t_sqlstate($q$SELECT * FROM redeem_garage_join_link('x')$q$) = '42501', 'anon cannot redeem');
SELECT t_assert(t_sqlstate($q$SELECT * FROM decide_garage_membership(gen_random_uuid(), true)$q$) = '42501', 'anon cannot decide');
SELECT t_assert(t_sqlstate($q$SELECT * FROM revoke_garage_join_link(gen_random_uuid())$q$) = '42501', 'anon cannot revoke');
RESET ROLE;

-- ===== Preview (anon) =====
SET ROLE anon;
SELECT t_as('anon', NULL);
SELECT t_assert((SELECT garage_name = 'Fixture shop' AND role = 'technician' AND valid AND reason = 'ok' FROM preview_garage_join_link(:'tok1')),
  'anon preview: garage name, role offered and validity');
SELECT t_assert((SELECT valid = false AND reason = 'not_found' AND garage_name IS NULL AND role IS NULL FROM preview_garage_join_link(repeat('A', 43))),
  'anon preview of an unknown token: not_found and no name');
SELECT t_assert((SELECT valid = false AND reason = 'not_found' AND garage_name IS NULL FROM preview_garage_join_link('short')),
  'anon preview of a malformed token: the same answer as an unknown one');
SELECT t_assert((SELECT valid = false AND reason = 'not_found' FROM preview_garage_join_link(NULL)), 'anon preview of null: not_found');
SELECT t_assert(t_refused('SELECT count(*) FROM garage_join_links'), 'anon cannot read the link table');
SELECT t_assert(t_refused('SELECT count(*) FROM garage_members'), 'anon cannot read members');
SELECT t_assert(t_refused('SELECT count(*) FROM garages'), 'anon cannot read garages');
RESET ROLE;
-- The preview row has exactly four columns, so nothing private can ride along.
SELECT t_assert((SELECT array_agg(k ORDER BY k) FROM (SELECT jsonb_object_keys(to_jsonb(p)) AS k FROM preview_garage_join_link(:'tok1') p) s)
  = ARRAY['garage_name','reason','role','valid'], 'preview returns exactly garage_name, role, valid, reason');

-- ===== Redeem =====
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a4');
SELECT member_id AS m4, status AS s4 FROM redeem_garage_join_link(:'tok1') \gset
SELECT t_assert(:'s4' = 'pending', 'redeeming a link that needs approval creates a pending member');
SELECT t_assert((SELECT role = 'technician' AND joined_via_link_id = :'l1' AND invited_by = '00000000-0000-0000-0000-0000000000a1'
                        AND approved_at IS NULL AND started_at IS NULL FROM garage_members WHERE id = :'m4'),
  'the pending row carries the link role, the link, the inviter, and no approval yet');
SELECT t_assert(garage_member_rank(:'g') = 0, 'a pending member has rank 0, so no garage-gated read opens');
SELECT t_assert((SELECT count(*) FROM garages WHERE id = :'g') = 0, 'a pending member cannot read the garage row');
SELECT t_assert((SELECT count(*) FROM garage_members WHERE user_id = auth.uid()) = 1, 'a pending member can read their own row (so the app can say waiting)');
SELECT t_assert((SELECT member_id = :'m4' AND status = 'pending' FROM redeem_garage_join_link(:'tok1')), 'redeeming again returns the same pending row');
RESET ROLE;
SELECT t_assert((SELECT uses_count = 1 FROM garage_join_links WHERE id = :'l1'), 'a repeated redeem does not use the link twice');
SELECT t_assert((SELECT count(*) = 1 FROM garage_members WHERE garage_id = :'g' AND user_id = '00000000-0000-0000-0000-0000000000a4'), 'still one membership row');
-- Max uses reached: another person is refused; the same person still gets their row.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a7');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM redeem_garage_join_link(%L)$q$, :'tok1')) = 'P0001', 'a used-up link (max_uses 1) refuses the next person');
SELECT t_assert((SELECT valid = false AND reason = 'exhausted' FROM preview_garage_join_link(:'tok1')), 'preview of a used-up link says exhausted');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a4');
SELECT t_assert((SELECT member_id = :'m4' FROM redeem_garage_join_link(:'tok1')), 'the person who used it still gets their own row back');
SELECT t_assert(t_sqlstate($q$SELECT * FROM redeem_garage_join_link('nope')$q$) = 'P0001', 'a malformed token is refused');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM redeem_garage_join_link(%L)$q$, repeat('B', 43))) = 'P0001', 'an unknown token is refused');
SELECT t_as('authenticated', NULL);
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM redeem_garage_join_link(%L)$q$, :'tok1')) = '28000', 'no session: refused');
SELECT set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub','00000000-0000-0000-0000-0000000000a8','is_anonymous',true)::text, false);
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM redeem_garage_join_link(%L)$q$, :'tok1')) = '28000', 'an anonymous Supabase session cannot redeem');
RESET ROLE;

-- ===== Decide =====
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a2');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM decide_garage_membership(%L, true)$q$, :'m4')) = '42501', 'a technician cannot approve');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a4');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM decide_garage_membership(%L, true)$q$, :'m4')) = '42501', 'an applicant cannot approve themselves');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a5');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM decide_garage_membership(%L, true, 'owner')$q$, :'m4')) = '22023', 'approval cannot hand out the owner role');
SELECT t_assert((SELECT status = 'active' AND role = 'staff' FROM decide_garage_membership(:'m4', true, 'staff')),
  'a manager approves with a lower role than offered');
RESET ROLE;
SELECT t_assert((SELECT approved_by = '00000000-0000-0000-0000-0000000000a5' AND approved_at IS NOT NULL AND started_at IS NOT NULL FROM garage_members WHERE id = :'m4'),
  'approval records who, when, and the start');
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a4');
SELECT t_assert(garage_member_rank(:'g') = 40, 'after approval the member has the approved rank (staff 40)');
SELECT t_assert((SELECT count(*) FROM garages WHERE id = :'g') = 1, 'an active member reads the garage row');
SELECT t_assert((SELECT status = 'active' FROM redeem_garage_join_link(:'tok1')), 'redeem after approval returns active (the app lands on the garage)');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a5');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM decide_garage_membership(%L, true)$q$, :'m4')) = 'P0001', 'a decided row cannot be decided again');
RESET ROLE;
-- Joining grants no vehicle-level access by itself: the join writers never touch vehicle tables or the org roster.
SELECT t_assert(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname IN ('create_garage_join_link','redeem_garage_join_link','decide_garage_membership','revoke_garage_join_link')
                              AND pg_get_functiondef(p.oid) ~* 'vehicle|organization_contributors'), 'join writers never reference vehicles or organization_contributors');

-- A manager link waits for a person even when approval was waived; a manager approves up to manager.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT link_id AS l2, token AS tok2 FROM create_garage_join_link(:'g', 'manager', 5, now() + interval '2 days', false) \gset
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a7');
SELECT status AS s7, member_id AS m7 FROM redeem_garage_join_link(:'tok2') \gset
SELECT t_assert(:'s7' = 'pending', 'a manager link waits for approval even when approval was waived (the waiver covers technician and below)');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a5');
SELECT t_assert((SELECT status = 'active' AND role = 'manager' FROM decide_garage_membership(:'m7', true)), 'a manager approves up to manager');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a7');
SELECT t_assert(garage_member_rank(:'g') = 80, 'the approved manager has rank 80');
RESET ROLE;

-- No-approval link at technician level lands active.
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT link_id AS l3, token AS tok3 FROM create_garage_join_link(:'g', 'technician', 2, now() + interval '2 days', false) \gset
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a8');
SELECT t_assert((SELECT status = 'active' FROM redeem_garage_join_link(:'tok3')), 'requires_approval=false and role technician: active on redeem');
SELECT t_assert(garage_member_rank(:'g') = 50, 'and the rank is technician 50');
RESET ROLE;
SELECT t_assert((SELECT approved_by = '00000000-0000-0000-0000-0000000000a1' AND started_at IS NOT NULL FROM garage_members WHERE garage_id = :'g' AND user_id = '00000000-0000-0000-0000-0000000000a8'),
  'the waiver is attributed to the minter');

-- ===== Decline =====
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT link_id AS l4, token AS tok4 FROM create_garage_join_link(:'g', 'viewer', 3) \gset
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a9');
SELECT member_id AS m9 FROM redeem_garage_join_link(:'tok4') \gset
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert((SELECT status = 'revoked' FROM decide_garage_membership(:'m9', false)), 'a manager declines a pending request');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a9');
SELECT t_assert(garage_member_rank(:'g') = 0, 'a declined applicant has no rank');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM redeem_garage_join_link(%L)$q$, :'tok4')) = 'P0001', 'a declined person cannot re-enter on the link');
RESET ROLE;
SELECT t_assert((SELECT count(*) = 1 AND bool_and(ended_at IS NOT NULL) FROM garage_members WHERE user_id = '00000000-0000-0000-0000-0000000000a9' AND garage_id = :'g'),
  'the declined row stays as history with an end time');
SELECT t_assert((SELECT uses_count = 1 FROM garage_join_links WHERE id = :'l4'), 'the blocked retry did not use the link again');

-- ===== Revoke =====
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a2');
SELECT t_assert(t_sqlstate(format($q$SELECT revoke_garage_join_link(%L)$q$, :'l4')) = '42501', 'a technician cannot revoke a link');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert(revoke_garage_join_link(:'l4') = true, 'a manager+ revokes a link');
SELECT t_assert(revoke_garage_join_link(:'l4') = false, 'revoking twice is harmless and says so');
SELECT t_assert(t_sqlstate(format($q$SELECT revoke_garage_join_link(%L)$q$, gen_random_uuid())) = '42501', 'an unknown link id answers like a refusal');
SELECT t_assert((SELECT valid = false AND reason = 'revoked' FROM preview_garage_join_link(:'tok4')), 'preview of a revoked link: invalid, revoked');
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a3');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM redeem_garage_join_link(%L)$q$, :'tok4')) = 'P0001', 'a revoked link cannot be redeemed');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM garage_members WHERE garage_id = :'g' AND user_id = '00000000-0000-0000-0000-0000000000a3') = 0, 'a refused redeem leaves no row');

-- ===== Expiry =====
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT link_id AS l5, token AS tok5 FROM create_garage_join_link(:'g', 'photographer', 3, now() + interval '1 hour') \gset
RESET ROLE;
UPDATE garage_join_links SET expires_at = now() - interval '1 minute' WHERE id = :'l5';
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a3');
SELECT t_assert((SELECT valid = false AND reason = 'expired' FROM preview_garage_join_link(:'tok5')), 'preview of an expired link: invalid, expired');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM redeem_garage_join_link(%L)$q$, :'tok5')) = 'P0001', 'an expired link cannot be redeemed');
RESET ROLE;

-- ===== Closed garage =====
UPDATE garages SET status = 'closed' WHERE id = :'g2';
SET ROLE authenticated;
SELECT t_as('authenticated', '00000000-0000-0000-0000-0000000000a1');
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'viewer')$q$, :'g2')) = '22023', 'no link for a closed garage');

-- ===== Live-link ceiling =====
DO $$
DECLARE v_g uuid := (SELECT id FROM garages WHERE name = 'Fixture shop'); i int;
BEGIN
  FOR i IN 1..40 LOOP
    BEGIN PERFORM create_garage_join_link(v_g, 'viewer');
    EXCEPTION WHEN SQLSTATE '54000' THEN RAISE NOTICE 'ceiling reached at link %', i; EXIT; END;
  END LOOP;
END $$;
SELECT t_assert(t_sqlstate(format($q$SELECT * FROM create_garage_join_link(%L, 'viewer')$q$, :'g')) = '54000', 'a garage cannot hold more than 25 live links');

-- ===== Roster read shows who joined by link (core function) =====
SELECT t_assert((SELECT count(*) FROM garage_members_read(:'g') WHERE joined_via_link IS NOT NULL) >= 3, 'the roster shows which members joined by a link');
RESET ROLE;

SELECT 'garage join contract: all assertions passed' AS result;
