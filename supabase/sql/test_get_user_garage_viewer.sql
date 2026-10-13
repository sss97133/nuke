-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_get_user_garage -f this-file.sql
-- Proves that get_user_garage answers the owner and the service role with every relationship, estimates and
-- purchase prices, answers any other signed-in caller with the public projection only (owner or co_owner
-- permission or an approved title; public; not deleted; no money; admitted frames only), and refuses anon.
-- Starts from the live definition, then applies the migration. The seeds below are a disposable test
-- database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;

-- The tables the reader touches, with the columns it uses.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, trim text, primary_image_url text,
  purchase_price numeric, image_count integer, is_public boolean DEFAULT true, deleted_at timestamptz);
CREATE TABLE public.vehicle_ownerships (vehicle_id uuid, owner_profile_id uuid, is_current boolean);
CREATE TABLE public.ownership_verifications (vehicle_id uuid, user_id uuid, status text);
CREATE TABLE public.discovered_vehicles (vehicle_id uuid, user_id uuid, is_active boolean, relationship_type text);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid, user_id uuid, role text, revoked_at timestamptz);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, image_url text,
  created_at timestamptz DEFAULT now(), is_document boolean, vision_gate_status text);
CREATE TABLE public.nuke_estimates (vehicle_id uuid, comp_method text, estimated_value numeric, calculated_at timestamptz);
-- The gate as the contract needs it: an admitted frame is not a document and not rejected. This stub admits
-- pending and review_needed frames that production's predicate mostly excludes: the contract proves the reader
-- calls the gate for a stranger, not what the gate admits (that is the gate's own contract).
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(($1).is_document, false) = false AND coalesce(($1).vision_gate_status, 'approved') NOT LIKE 'rejected%' $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role, anon;

\ir helpers/get_user_garage_live_20261013.sql
REVOKE EXECUTE ON FUNCTION public.get_user_garage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_garage(uuid) TO authenticated, service_role;
\ir ../migrations/20261013230000_get_user_garage_authorize_viewer.sql

-- Seeds (a disposable database, never production). Owner A holds:
--  v1 public, current legal title (vehicle_ownerships only): the owner's branch sees it, the public projection does not
--  v2 public, owner permission + approved title, purchase price and an estimate: both see it, money to the owner only
--  v3 private, owner permission: owner only
--  v4 deleted, approved title: owner only
--  v5 public, contributor only (and a revoked permission): owner only
--  v6 public, co_owner permission, no primary image, one rejected frame then one admitted frame
INSERT INTO public.vehicles (id, year, make, model, trim, primary_image_url, purchase_price, image_count, is_public, deleted_at) VALUES
 ('10000000-0000-0000-0000-000000000001', 1973, 'GMC', 'Jimmy', NULL, 'https://x/v1.jpg', 12000, 3, true, NULL),
 ('10000000-0000-0000-0000-000000000002', 1977, 'Chevrolet', 'K5 Blazer', 'Cheyenne', 'https://x/v2.jpg', 38000, 1642, true, NULL),
 ('10000000-0000-0000-0000-000000000003', 1984, 'Chevrolet', 'K10', NULL, 'https://x/v3.jpg', 9000, 461, false, NULL),
 ('10000000-0000-0000-0000-000000000004', 1966, 'Ford', 'Mustang', NULL, 'https://x/v4.jpg', 15000, 10, true, '2026-01-01T00:00:00Z'),
 ('10000000-0000-0000-0000-000000000005', 1988, 'Chevrolet', 'Suburban', NULL, 'https://x/v5.jpg', 7000, 57, true, NULL),
 ('10000000-0000-0000-0000-000000000006', 1971, 'GMC', 'Suburban', NULL, NULL, 5000, 2, true, NULL);
INSERT INTO public.vehicle_ownerships VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', true);
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role, revoked_at) VALUES
 ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'owner', NULL),
 ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'owner', NULL),
 ('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001', 'co_owner', NULL),
 ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'owner', '2026-02-01T00:00:00Z');
INSERT INTO public.ownership_verifications VALUES
 ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'approved'),
 ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'approved');
INSERT INTO public.vehicle_contributors VALUES ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001');
INSERT INTO public.nuke_estimates VALUES ('10000000-0000-0000-0000-000000000002', 'class_stratified', 112200, '2026-10-01T00:00:00Z');
INSERT INTO public.vehicle_images (vehicle_id, image_url, created_at, is_document, vision_gate_status) VALUES
 ('10000000-0000-0000-0000-000000000006', 'https://x/v6-personal.jpg', '2026-01-01T00:00:00Z', false, 'rejected_personal'),
 ('10000000-0000-0000-0000-000000000006', 'https://x/v6-truck.jpg', '2026-01-02T00:00:00Z', false, 'approved');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO authenticated, service_role, anon;

-- 1. A signed-in stranger: the public projection only, no money, an admitted frame only.
--    Note the interim asymmetry this asserts: v6 is held only by a co_owner permission, so a stranger sees it
--    as owner while the owner's own branch (the live reader, unchanged here) omits it. Production has the same
--    shape today (one vehicle reads owner to strangers and contributor to its owner). The ownership-source
--    unification follow-up must flip this assertion on purpose, never by accident.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-000000000009';
SET test.auth_role = 'authenticated';
DO $$
DECLARE n int; ids text; money int; img text;
BEGIN
  SELECT count(*), string_agg(right(vehicle_id::text, 1), '' ORDER BY vehicle_id), count(purchase_price) + count(current_value)
    INTO n, ids, money FROM public.get_user_garage('20000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(n = 2 AND ids = '26', format('stranger: v2 and v6 only; got %s rows (%s)', n, ids));
  PERFORM public.t_assert(money = 0, format('stranger: no estimate, no purchase price; got %s money cells', money));
  SELECT image_url INTO img FROM public.get_user_garage('20000000-0000-0000-0000-000000000001') WHERE vehicle_id = '10000000-0000-0000-0000-000000000006';
  PERFORM public.t_assert(img = 'https://x/v6-truck.jpg', format('stranger: the admitted frame, never the rejected one; got %s', img));
  PERFORM public.t_assert((SELECT bool_and(relationship = 'owner') FROM public.get_user_garage('20000000-0000-0000-0000-000000000001')), 'stranger: every public row reads owner');
END $$;
-- 2. The owner: every relationship the live reader read (legal title, approved title, previously owned,
--    contributor), with money, the private and the deleted vehicle included, the thumbnail as before.
--    A vehicle held only by a permission (v3, v6) is NOT in the owner's branch, exactly as before this
--    migration: unifying the two ownership sources is a later migration (review 2026-10-13).
SET test.auth_uid = '20000000-0000-0000-0000-000000000001';
DO $$
DECLARE n int; ids text; pp numeric; est numeric; rel text;
BEGIN
  SELECT count(*), string_agg(right(vehicle_id::text, 1), '' ORDER BY vehicle_id) INTO n, ids FROM public.get_user_garage('20000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(n = 4 AND ids = '1245', format('owner: title, verified, deleted and contributor rows as before; got %s (%s)', n, ids));
  SELECT purchase_price, current_value INTO pp, est FROM public.get_user_garage('20000000-0000-0000-0000-000000000001') WHERE vehicle_id = '10000000-0000-0000-0000-000000000002';
  PERFORM public.t_assert(pp = 38000 AND est = 112200, format('owner: purchase price and estimate; got %s / %s', pp, est));
  SELECT relationship INTO rel FROM public.get_user_garage('20000000-0000-0000-0000-000000000001') WHERE vehicle_id = '10000000-0000-0000-0000-000000000005';
  PERFORM public.t_assert(rel = 'contributor', format('owner: contributor bucket kept; got %s', rel));
END $$;
-- 3. The service role (no user id): the owner's view, as the books and attribution scripts need it.
RESET ROLE;
SET ROLE service_role;
SET test.auth_uid = '';
SET test.auth_role = 'service_role';
SELECT public.t_assert((SELECT count(*) FROM public.get_user_garage('20000000-0000-0000-0000-000000000001')) = 4, 'service role: the owner''s four');
SELECT public.t_assert((SELECT purchase_price FROM public.get_user_garage('20000000-0000-0000-0000-000000000001') WHERE vehicle_id = '10000000-0000-0000-0000-000000000002') = 38000, 'service role: purchase price');
-- 4. Anon: refused at the grant, as since 2026-07-09.
RESET ROLE;
SET ROLE anon;
SET test.auth_uid = '';
SET test.auth_role = 'anon';
DO $$ BEGIN
  PERFORM count(*) FROM public.get_user_garage('20000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FAIL: anon was answered';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SELECT 'get_user_garage viewer contract: PASS' AS result;
