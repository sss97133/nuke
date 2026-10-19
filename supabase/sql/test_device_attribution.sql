-- Isolated PostgreSQL 17 contract for 20261017021000_device_evidence_files_photos_and_profiles.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_device_attribution
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_device_attribution -f supabase/sql/test_device_attribution.sql
-- Fixtures carry the live shapes read from prod on 2026-10-15: vehicles.user_id generated from uploaded_by, the VIN
-- unique indexes and enforce_vin_uniqueness, vehicle_contributors' role list and enforce_contributor_evidence, the
-- vision_gate_status enum, album_sync_map, organization_contributors / organization_vehicles, reattribution_audit,
-- canonical_makes with normalize_make, and attribute_testimony as live with its live ACL (postgres, service_role):
-- supabase/sql/helpers/device_evidence_live_20261015.sql. The RPCs run as the authenticated role with no table grant,
-- so every write goes through the definer path. Cases:
--   * user_associated_vehicle_ids: user_id, owner_id, contributor and active-organization vehicles; merged vehicles
--     followed to their survivor; deleted, past-link, inactive-membership and the held merge (eeb9fa61) left out; an end
--     user asking about someone else gets nothing;
--   * device_file_images: filing to an associated vehicle lands through attribute_testimony with its audit row; a
--     non-associated vehicle, another user's photo, a photo filed elsewhere (conflict, untouched), a held merge, low
--     confidence, superseded and gate-rejected photos, each method's own evidence, a duplicate file and malformed items
--     are refused; a merged target files onto its survivor; a second filing is 'already'; a spent time budget defers the
--     rest, and resending them files them;
--   * device_create_vehicle_profile: an invalid VIN is refused; a valid VIN mints a private vehicle with the caller as a
--     photographer contributor, never an owner, and files the photos; the same call again returns the same vehicle; an
--     existing VIN is not re-minted (filed when associated; another user's private vehicle is withheld); an album matching
--     two associated vehicles is ambiguous; Chevy = Chevrolet resolves an associated vehicle; album and serial thresholds;
--     a VIN held only by a deleted vehicle; six profiles in an hour are rate limited;
--   * anon cannot execute any of them; signatures, settings and grants.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicle_images') IS NOT NULL
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;

-- Supabase's auth helpers read the request's JWT claims.
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
GRANT REFERENCES ON auth.users TO dm_contract_deployer;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;

-- Prod's deploy role owns the tables and is not a superuser; the fixture is built, and the migration applied, as one.
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- Deterministic ids from labels.
CREATE FUNCTION pg_temp.u(label text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('user:' || label)::uuid $$;
CREATE FUNCTION pg_temp.v(label text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN label = 'held' THEN 'eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f'::uuid ELSE md5('vehicle:' || label)::uuid END $$;
CREATE FUNCTION pg_temp.i(label text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('image:' || label)::uuid $$;
CREATE FUNCTION pg_temp.item(img text, veh uuid, method text, conf numeric, ev jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('image_id', pg_temp.i(img), 'vehicle_id', veh, 'method', method, 'confidence', conf,
                            'evidence', ev) $$;
CREATE FUNCTION pg_temp.st(r jsonb, img text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT x ->> 'status' FROM jsonb_array_elements(r -> 'results') x WHERE x ->> 'image_id' = pg_temp.i(img)::text LIMIT 1 $$;

-- Live shapes -------------------------------------------------------------------------------------------------------
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  user_id uuid GENERATED ALWAYS AS (uploaded_by) STORED,
  owner_id uuid,
  year integer, make text, model text, vin text,
  is_public boolean DEFAULT true,
  status text DEFAULT 'active',
  is_draft boolean DEFAULT false,
  entry_type text DEFAULT 'owner_claim',
  verification_status text DEFAULT 'unverified',
  source text, profile_origin text, import_method text, content_source_type text,
  created_by_user_id uuid, created_via_role text,
  vin_source text, vin_confidence integer DEFAULT 50, vin_source_image_id uuid,
  year_source text, make_source text, model_source text,
  origin_metadata jsonb DEFAULT '{}'::jsonb,
  merged_into_vehicle_id uuid,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT vehicles_entry_type_check CHECK (entry_type = ANY (ARRAY['owner_claim', 'contributor_data', 'title_verified', 'disputed'])),
  CONSTRAINT vehicles_import_method_check CHECK (import_method = ANY (ARRAY['manual', 'automated', 'api', 'scraper', 'bulk_import'])),
  CONSTRAINT vehicles_content_source_type_check CHECK (content_source_type = ANY (ARRAY['organization', 'user', 'platform', 'third_party'])),
  CONSTRAINT vehicles_verification_status_check CHECK (verification_status = ANY (ARRAY['unverified', 'contributor_verified', 'title_verified', 'multi_verified', 'disputed'])),
  CONSTRAINT vehicles_status_check CHECK (status IS NULL OR status = ANY (ARRAY['active', 'pending', 'sold', 'discovered', 'merged', 'rejected', 'inactive', 'archived', 'deleted', 'pending_backfill', 'duplicate']))
);
CREATE UNIQUE INDEX vehicles_vin_unique_17char_v2 ON public.vehicles (vin)
  WHERE vin IS NOT NULL AND length(vin) = 17 AND status IS DISTINCT FROM 'merged';
CREATE UNIQUE INDEX vehicles_vin_unique_short_v2 ON public.vehicles (vin, make)
  WHERE vin IS NOT NULL AND length(vin) < 17 AND status IS DISTINCT FROM 'merged';
CREATE INDEX idx_vehicles_vin_norm_trim ON public.vehicles (upper(btrim(vin)));
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  user_id uuid,
  image_url text,
  file_hash text,
  is_primary boolean DEFAULT false,
  is_document boolean DEFAULT false,
  is_duplicate boolean DEFAULT false,
  is_superseded boolean DEFAULT false,
  vision_gate_status public.vision_gate_status DEFAULT 'pending',
  documented_by_user_id uuid,
  taken_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.vehicle_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role text NOT NULL,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text DEFAULT 'active',
  can_edit boolean DEFAULT true,
  can_delete boolean DEFAULT false,
  can_approve boolean DEFAULT false,
  can_sell boolean DEFAULT false,
  organization_id uuid,
  CONSTRAINT vehicle_contributors_role_check CHECK (role = ANY (ARRAY['owner', 'previous_owner', 'restorer', 'contributor',
    'mechanic', 'consigner', 'enthusiast', 'historian', 'curator', 'moderator', 'collector', 'appraiser', 'detailer',
    'inspector', 'photographer', 'sales_agent', 'transport_driver', 'buyer', 'seller', 'witness', 'public_contributor',
    'verified_contributor', 'specialist', 'expert'])),
  CONSTRAINT vehicle_contributors_vehicle_id_user_id_role_key UNIQUE (vehicle_id, user_id, role)
);
CREATE TABLE public.organization_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, user_id uuid, role text, status text DEFAULT 'active',
  CONSTRAINT organization_contributors_organization_id_user_id_key UNIQUE (organization_id, user_id)
);
CREATE TABLE public.organization_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, vehicle_id uuid NOT NULL, relationship_type text, status text DEFAULT 'active'
);
CREATE TABLE public.album_sync_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, apple_album_id text, apple_album_name text, vehicle_id uuid,
  CONSTRAINT album_sync_map_user_id_apple_album_id_key UNIQUE (user_id, apple_album_id)
);
CREATE TABLE public.reattribution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_type text NOT NULL,
  old_observation_id uuid NOT NULL,
  old_vehicle_id uuid,
  new_observation_id uuid NOT NULL,
  new_vehicle_id uuid,
  reason text NOT NULL,
  actor_user_id uuid,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.canonical_makes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text, display_name text, aliases text[] DEFAULT ARRAY[]::text[]
);
INSERT INTO public.canonical_makes (canonical_name, display_name, aliases) VALUES
  ('CHEVROLET', 'Chevrolet', ARRAY['chevrolet', 'chevy', 'chev', 'CHEVROLET', 'CHEVY', 'CHEV', 'Chev', 'Chevy']),
  ('FORD', 'Ford', ARRAY['ford', 'FORD', 'Ford']),
  ('HONDA', 'Honda', ARRAY['honda', 'HONDA', 'Honda']),
  ('PLYMOUTH', 'Plymouth', ARRAY['plymouth', 'PLYMOUTH', 'Plymouth']),
  ('DODGE', 'Dodge', ARRAY['dodge', 'DODGE', 'Dodge']);

\ir helpers/device_evidence_live_20261015.sql
CREATE TRIGGER trg_enforce_vin_uniqueness BEFORE INSERT OR UPDATE OF vin ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vin_uniqueness();
CREATE TRIGGER trg_enforce_contributor_evidence BEFORE INSERT OR UPDATE ON public.vehicle_contributors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contributor_evidence();
-- attribute_testimony's live ACL: postgres and service_role only.
REVOKE ALL ON FUNCTION public.attribute_testimony(text, uuid, uuid, text, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attribute_testimony(text, uuid, uuid, text, uuid, numeric, text) TO service_role;

-- The migration -----------------------------------------------------------------------------------------------------
\ir ../migrations/20261017021000_device_evidence_files_photos_and_profiles.sql
ALTER TABLE public.vehicle_images
  ADD COLUMN source text,
  ADD COLUMN doc_flag boolean DEFAULT false,
  ADD COLUMN is_sensitive boolean DEFAULT false,
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD COLUMN exif_data jsonb;

-- A 17-character VIN with its check digit computed into position 9.
CREATE FUNCTION pg_temp.vin(t text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['0','1','2','3','4','5','6','7','8','9','X'] LOOP
    IF public.validate_vin_check_digit(overlay(t PLACING c FROM 9 FOR 1)) THEN RETURN overlay(t PLACING c FROM 9 FOR 1); END IF;
  END LOOP;
  RAISE EXCEPTION 'no check digit for %', t;
END $$;
SELECT pg_temp.ok('the recovered check digit accepts known VINs and refuses a wrong digit',
  public.validate_vin_check_digit('1M8GDM9AXKP042788') AND public.validate_vin_check_digit('1HGCM82633A004352')
  AND NOT public.validate_vin_check_digit('1HGCM82634A004352'));

-- Fixture -----------------------------------------------------------------------------------------------------------
INSERT INTO public.profiles (id) VALUES (pg_temp.u('owner')), (pg_temp.u('stranger')), (pg_temp.u('busy'));
INSERT INTO auth.users (id) VALUES (pg_temp.u('owner')), (pg_temp.u('stranger')), (pg_temp.u('busy'));
INSERT INTO public.vehicles (id, uploaded_by, owner_id, year, make, model, vin, is_public, status, merged_into_vehicle_id, deleted_at) VALUES
  (pg_temp.v('accord'),   pg_temp.u('owner'),    NULL,               2003, 'Honda',     'Accord',       '1HGCM82633A004352', true, 'active', NULL, NULL),
  (pg_temp.v('camaro'),   pg_temp.u('stranger'), pg_temp.u('owner'), 1967, 'Chevrolet', 'Camaro',       '124377N100001',     true, 'active', NULL, NULL),
  (pg_temp.v('shop'),     pg_temp.u('stranger'), NULL,               1979, 'Ford',      'F-150',        NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('orgcar'),   pg_temp.u('stranger'), NULL,               1985, 'Ford',      'Bronco',       NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('pastorg'),  pg_temp.u('stranger'), NULL,               1986, 'Ford',      'Ranger',       NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('oldorg'),   pg_temp.u('stranger'), NULL,               1987, 'Ford',      'Mustang',      NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('mergedup'), NULL,                  pg_temp.u('owner'), 2003, 'Honda',     'Accord',       NULL,                true, 'merged', pg_temp.v('accord'), now()),
  (pg_temp.v('heldinto'), pg_temp.u('stranger'), NULL,               1966, 'Ford',      'Mustang',      NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('held'),     NULL,                  pg_temp.u('owner'), 1966, 'Ford',      'Mustang',      NULL,                true, 'merged', pg_temp.v('heldinto'), now()),
  (pg_temp.v('strangers'),pg_temp.u('stranger'), NULL,               1990, 'Ford',      'Taurus',       NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('deleted'),  pg_temp.u('owner'),    NULL,               1991, 'Ford',      'Escort',       pg_temp.vin('1FAPP14J?MW100001'), true, 'deleted', NULL, now()),
  (pg_temp.v('privvin'),  pg_temp.u('stranger'), NULL,               1992, 'Ford',      'Explorer',     pg_temp.vin('1FMDU34X?NU100001'), false, 'active', NULL, NULL),
  (pg_temp.v('pubvin'),   pg_temp.u('stranger'), NULL,               1993, 'Ford',      'Explorer',     pg_temp.vin('1FMDU34X?PU100002'), true, 'active', NULL, NULL),
  (pg_temp.v('c10a'),     pg_temp.u('owner'),    NULL,               1972, 'Chevrolet', 'C10',          NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('c10b'),     pg_temp.u('stranger'), pg_temp.u('owner'), 1972, 'Chevrolet', 'C10 Cheyenne', NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('k5'),       pg_temp.u('owner'),    NULL,               1984, 'CHEVROLET', 'K5 Blazer',    NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('f250'),     pg_temp.u('owner'),    NULL,               1969, 'Ford',      'F-250',        NULL,                true, 'active', NULL, NULL),
  (pg_temp.v('dodge'),    pg_temp.u('stranger'), NULL,               1970, 'Dodge',     'Challenger',   'XS29N0B200001',     true, 'active', NULL, NULL);
-- The owner is a mechanic on 'shop' (with a photo of it, as enforce_contributor_evidence requires), an active member of
-- org1 (active link to 'orgcar', a past link to 'pastorg') and an inactive member of org2 (active link to 'oldorg').
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url) VALUES
  (pg_temp.i('shop-evidence'), pg_temp.v('shop'), pg_temp.u('owner'), 'https://x/shop.jpg');
INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role) VALUES (pg_temp.v('shop'), pg_temp.u('owner'), 'mechanic');
INSERT INTO public.organization_contributors (organization_id, user_id, role, status) VALUES
  (md5('org1')::uuid, pg_temp.u('owner'), 'owner', 'active'), (md5('org2')::uuid, pg_temp.u('owner'), 'employee', 'inactive');
INSERT INTO public.organization_vehicles (organization_id, vehicle_id, relationship_type, status) VALUES
  (md5('org1')::uuid, pg_temp.v('orgcar'), 'owner', 'active'), (md5('org1')::uuid, pg_temp.v('pastorg'), 'service_provider', 'past'),
  (md5('org2')::uuid, pg_temp.v('oldorg'), 'owner', 'active');
INSERT INTO public.album_sync_map (user_id, apple_album_id, apple_album_name, vehicle_id) VALUES
  (pg_temp.u('owner'), 'ALBUM-ORGCAR', '85 Bronco', pg_temp.v('orgcar'));

-- The owner's unfiled photos, one per case, plus album sets with and without pixels.
INSERT INTO public.vehicle_images (id, user_id, image_url, taken_at)
SELECT pg_temp.i(l), pg_temp.u('owner'), 'https://x/' || l || '.jpg', '2024-05-01T10:00:00Z'::timestamptz + (n || ' hours')::interval
FROM unnest(ARRAY['f01','f02','f04','f05','f06','f09','f10','f11','f12','f13','f14','f15','f16','f17','f18',
                  'k01','k02','k03','k04','k05','k06','k07','k08','e01','e02','e03','e04']) WITH ORDINALITY t(l, n);
INSERT INTO public.vehicle_images (id, user_id, image_url, taken_at)
SELECT pg_temp.i(a || lpad(n::text, 2, '0')), pg_temp.u('owner'), 'https://x/' || a || n || '.jpg', '2024-06-01T10:00:00Z'
FROM unnest(ARRAY['a', 'b', 'c', 'd', 'g']) a, generate_series(1, 12) n;
-- The 'd' album has 11 uploaded photos and one whose pixels never uploaded.
UPDATE public.vehicle_images SET image_url = '' WHERE id = pg_temp.i('d12');
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, is_superseded, vision_gate_status, file_hash) VALUES
  (pg_temp.i('f03'), pg_temp.v('strangers'), pg_temp.u('owner'), 'https://x/f03.jpg', false, 'pending', NULL),  -- filed elsewhere
  (pg_temp.i('f07'), NULL, pg_temp.u('owner'), 'https://x/f07.jpg', true, 'pending', NULL),                     -- superseded
  (pg_temp.i('f08'), NULL, pg_temp.u('owner'), 'https://x/f08.jpg', false, 'rejected_personal', NULL),          -- gate-rejected
  (pg_temp.i('f19'), NULL, pg_temp.u('owner'), 'https://x/f19.jpg', false, 'pending', 'hash-dup'),              -- same file as below
  (pg_temp.i('accord-dup'), pg_temp.v('accord'), pg_temp.u('stranger'), 'https://x/dup.jpg', false, 'pending', 'hash-dup'),
  (pg_temp.i('j01'), NULL, pg_temp.u('stranger'), 'https://x/j01.jpg', false, 'pending', NULL),                 -- another user's
  (pg_temp.i('z01'), NULL, pg_temp.u('busy'), 'https://x/z01.jpg', false, 'pending', NULL),
  (pg_temp.i('n01'), NULL, pg_temp.u('noprofile'), 'https://x/n01.jpg', false, 'pending', NULL);  -- an account with no profile
INSERT INTO public.vehicle_images (id, user_id, image_url)
SELECT pg_temp.i('r' || n), pg_temp.u('busy'), 'https://x/r' || n || '.jpg' FROM generate_series(1, 6) n;

RESET ROLE;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 1. Grants and settings ---------------------------------------------------------------------------------------------
SELECT pg_temp.ok('anon cannot execute any of the new functions',
  NOT has_function_privilege('anon', 'public.device_file_images(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.device_create_vehicle_profile(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.user_associated_vehicle_ids(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.device_file_images_as(uuid, jsonb, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.vehicle_merge_terminal(uuid)', 'EXECUTE'));
SELECT pg_temp.ok('authenticated executes the two RPCs and the association reader, not the worker or the merge helper',
  has_function_privilege('authenticated', 'public.device_file_images(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.device_create_vehicle_profile(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.user_associated_vehicle_ids(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.device_file_images_as(uuid, jsonb, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.vehicle_merge_terminal(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.device_file_images_as(uuid, jsonb, boolean)', 'EXECUTE'));
SELECT pg_temp.ok('the RPCs are SECURITY DEFINER with search_path public and lock_timeout 2s',
  (SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=public', 'lock_timeout=2s'])
   FROM pg_proc p WHERE p.oid IN ('public.device_file_images(jsonb)'::regprocedure,
                                  'public.device_create_vehicle_profile(jsonb)'::regprocedure))
  AND (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.user_associated_vehicle_ids(uuid)'::regprocedure)
  AND NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.device_file_images_as(uuid, jsonb, boolean)'::regprocedure));

-- anon is refused at the door.
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.device_file_images('[]'); EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('test.anon1', 'refused', false); END;
  BEGIN PERFORM public.device_create_vehicle_profile('{}'); EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('test.anon2', 'refused', false); END;
  BEGIN PERFORM public.user_associated_vehicle_ids(gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('test.anon3', 'refused', false); END;
END $$;
RESET ROLE;
SELECT pg_temp.ok('anon executing each RPC is refused with insufficient_privilege',
  current_setting('test.anon1', true) = 'refused' AND current_setting('test.anon2', true) = 'refused'
  AND current_setting('test.anon3', true) = 'refused');

-- An authenticated request without a user is refused.
SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, false);
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.device_file_images('[]'); EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('test.nosub1', 'refused', false); END;
  BEGIN PERFORM public.device_create_vehicle_profile('{"basis":"vin"}'); EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('test.nosub2', 'refused', false); END;
END $$;
RESET ROLE;
SELECT pg_temp.ok('a request with no user id is refused',
  current_setting('test.nosub1', true) = 'refused' AND current_setting('test.nosub2', true) = 'refused');


SELECT pg_temp.u('owner') AS owner, pg_temp.u('stranger') AS stranger \gset

-- 2. Associated vehicles ---------------------------------------------------------------------------------------------
SELECT pg_temp.ok('vehicle_merge_terminal follows a merge, stops at the held merge and drops deleted or missing vehicles',
  public.vehicle_merge_terminal(pg_temp.v('mergedup')) = pg_temp.v('accord')
  AND public.vehicle_merge_terminal(pg_temp.v('accord')) = pg_temp.v('accord')
  AND public.vehicle_merge_terminal(pg_temp.v('held')) IS NULL
  AND public.vehicle_merge_terminal(pg_temp.v('deleted')) IS NULL
  AND public.vehicle_merge_terminal(gen_random_uuid()) IS NULL
  AND public.vehicle_merge_terminal(NULL) IS NULL);

SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'owner')::text, false);
SET ROLE authenticated;
SELECT coalesce(jsonb_agg(x ORDER BY x), '[]') AS assoc FROM public.user_associated_vehicle_ids(:'owner') x \gset
SELECT count(*) AS assoc_other FROM public.user_associated_vehicle_ids(:'stranger') x \gset
RESET ROLE;
SELECT pg_temp.ok('the owner is associated with user_id, owner_id, contributor and active-organization vehicles, merges followed',
  :'assoc'::jsonb = (SELECT jsonb_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.v('accord'), pg_temp.v('camaro'),
    pg_temp.v('shop'), pg_temp.v('orgcar'), pg_temp.v('c10a'), pg_temp.v('c10b'), pg_temp.v('k5'), pg_temp.v('f250')]) x));
SELECT pg_temp.ok('the deleted vehicle, past and inactive organization links, the held merge and its target are not associated',
  NOT (:'assoc'::jsonb ?| ARRAY[pg_temp.v('deleted')::text, pg_temp.v('pastorg')::text, pg_temp.v('oldorg')::text,
    pg_temp.v('held')::text, pg_temp.v('heldinto')::text, pg_temp.v('mergedup')::text]));
SELECT pg_temp.ok('an end user asking about another user gets no rows', :assoc_other = 0);
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
SELECT pg_temp.ok('service_role reads any user''s set',
  (SELECT count(*) FROM public.user_associated_vehicle_ids(:'stranger')) > 0);

-- 3. device_file_images ----------------------------------------------------------------------------------------------
SELECT jsonb_build_array(
  pg_temp.item('f01', pg_temp.v('accord'), 'vin_ocr', 0.97, '{"edit_distance": "1"}'),
  pg_temp.item('f02', pg_temp.v('strangers'), 'vin_ocr', 0.99, '{"edit_distance": "0"}'),
  pg_temp.item('j01', pg_temp.v('accord'), 'vin_ocr', 0.99),
  pg_temp.item('f03', pg_temp.v('accord'), 'vin_ocr', 0.99),
  pg_temp.item('f04', pg_temp.v('mergedup'), 'vin_ocr', 0.99),
  pg_temp.item('f05', pg_temp.v('held'), 'vin_ocr', 0.99),
  pg_temp.item('f06', pg_temp.v('accord'), 'vin_ocr', 0.8),
  pg_temp.item('f07', pg_temp.v('accord'), 'vin_ocr', 0.99),
  pg_temp.item('f08', pg_temp.v('accord'), 'vin_ocr', 0.99),
  pg_temp.item('f09', pg_temp.v('orgcar'), 'album_map', 0.9, '{"album": "85 Bronco"}'),
  pg_temp.item('f10', pg_temp.v('accord'), 'album_map', 0.9, '{"album": "Accord"}'),
  pg_temp.item('f11', pg_temp.v('camaro'), 'serial_ocr', 0.92, '{"edit_distance": 1}'),
  pg_temp.item('f12', pg_temp.v('camaro'), 'vin_ocr', 0.95),
  pg_temp.item('f13', pg_temp.v('accord'), 'vin_ocr', 0.95, '{"edit_distance": "3"}'),
  pg_temp.item('f14', pg_temp.v('accord'), 'new_profile', 0.95),
  pg_temp.item('f15', pg_temp.v('pastorg'), 'album_map', 0.9),
  pg_temp.item('f19', pg_temp.v('accord'), 'vin_ocr', 0.99),
  pg_temp.item('f16', pg_temp.v('orgcar'), 'album_map', 0.9, '{"album_native_id": "ALBUM-OTHER"}'),
  pg_temp.item('f18', pg_temp.v('k5'), 'album_map', 0.9, '{"album_native_id": "ALBUM-ORGCAR"}'),
  jsonb_build_object('image_id', 'not-a-uuid', 'vehicle_id', pg_temp.v('accord'), 'method', 'vin_ocr', 'confidence', 0.99),
  pg_temp.item('f17', pg_temp.v('accord'), 'gps', 0.99),
  pg_temp.item('f01', pg_temp.v('accord'), 'vin_ocr', 0.99)
)::text AS b1 \gset

SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'owner')::text, false);
SET ROLE authenticated;
SELECT public.device_file_images(:'b1') AS r \gset b1_
SELECT public.device_file_images(jsonb_build_array(
  jsonb_build_object('image_id', md5('image:f01')::uuid, 'vehicle_id', md5('vehicle:accord')::uuid, 'method', 'vin_ocr', 'confidence', 0.99),
  jsonb_build_object('image_id', md5('image:f04')::uuid, 'vehicle_id', md5('vehicle:mergedup')::uuid, 'method', 'vin_ocr', 'confidence', 0.99),
  jsonb_build_object('image_id', md5('image:f09')::uuid, 'vehicle_id', md5('vehicle:orgcar')::uuid, 'method', 'album_map', 'confidence', 0.9)
)) AS r \gset b2_
DO $$ BEGIN
  BEGIN
    PERFORM public.device_file_images((SELECT jsonb_agg(jsonb_build_object('image_id', gen_random_uuid())) FROM generate_series(1, 501)));
  EXCEPTION WHEN invalid_parameter_value THEN PERFORM set_config('test.cap', 'refused', false);
  END;
END $$;
RESET ROLE;

SELECT pg_temp.ok('a VIN read files the photo onto the associated vehicle', pg_temp.st(:'b1_r', 'f01') = 'filed'
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('f01')) = pg_temp.v('accord'));
SELECT pg_temp.ok('the filing went through attribute_testimony: one audit row with the caller, confidence and device signal',
  (SELECT count(*) FROM public.reattribution_audit a
   WHERE a.new_observation_id = pg_temp.i('f01') AND a.observation_type = 'image' AND a.old_vehicle_id IS NULL
     AND a.new_vehicle_id = pg_temp.v('accord') AND a.actor_user_id = pg_temp.u('owner')
     AND a.reason LIKE 'first_attribution: device vin_ocr by the photo''s owner%'
     AND a.reason LIKE '%confidence=0.97; signal=device_vin_ocr') = 1);
SELECT pg_temp.ok('a vehicle the owner is not associated with is refused, the photo untouched',
  pg_temp.st(:'b1_r', 'f02') = 'not_associated' AND pg_temp.st(:'b1_r', 'f15') = 'not_associated'
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('f02')) IS NULL);
SELECT pg_temp.ok('another user''s photo is refused', pg_temp.st(:'b1_r', 'j01') = 'not_owner'
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('j01')) IS NULL);
SELECT pg_temp.ok('a photo filed on another vehicle is a conflict and stays where it is',
  pg_temp.st(:'b1_r', 'f03') = 'conflict'
  AND (SELECT x ->> 'current_vehicle_id' FROM jsonb_array_elements(:'b1_r'::jsonb -> 'results') x
       WHERE x ->> 'image_id' = pg_temp.i('f03')::text) = pg_temp.v('strangers')::text
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('f03')) = pg_temp.v('strangers'));
SELECT pg_temp.ok('a merged vehicle files onto its survivor and says so',
  pg_temp.st(:'b1_r', 'f04') = 'filed'
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('f04')) = pg_temp.v('accord')
  AND (SELECT x ->> 'vehicle_id' FROM jsonb_array_elements(:'b1_r'::jsonb -> 'results') x
       WHERE x ->> 'image_id' = pg_temp.i('f04')::text) = pg_temp.v('accord')::text);
SELECT pg_temp.ok('the held merge is not followed', pg_temp.st(:'b1_r', 'f05') = 'vehicle_unavailable'
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('f05')) IS NULL);
SELECT pg_temp.ok('confidence below the method''s bound, superseded and gate-rejected photos are refused',
  pg_temp.st(:'b1_r', 'f06') = 'low_confidence' AND pg_temp.st(:'b1_r', 'f07') = 'superseded'
  AND pg_temp.st(:'b1_r', 'f08') = 'gate_rejected'
  AND (SELECT count(*) FROM public.vehicle_images WHERE id IN (pg_temp.i('f06'), pg_temp.i('f07'), pg_temp.i('f08'))
       AND vehicle_id IS NOT NULL) = 0);
SELECT pg_temp.ok('album_map files onto a vehicle one of the owner''s albums maps to, and only that vehicle',
  pg_temp.st(:'b1_r', 'f09') = 'filed' AND pg_temp.st(:'b1_r', 'f10') = 'insufficient_evidence'
  AND pg_temp.st(:'b1_r', 'f16') = 'insufficient_evidence' AND pg_temp.st(:'b1_r', 'f18') = 'insufficient_evidence'
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('f09')) = pg_temp.v('orgcar'));
SELECT pg_temp.ok('serial_ocr needs a chassis serial on the vehicle, vin_ocr a 17-character VIN, both an edit distance up to 2',
  pg_temp.st(:'b1_r', 'f11') = 'filed' AND pg_temp.st(:'b1_r', 'f12') = 'insufficient_evidence'
  AND pg_temp.st(:'b1_r', 'f13') = 'insufficient_evidence'
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('f11')) = pg_temp.v('camaro'));
SELECT pg_temp.ok('new_profile files only onto a profile the owner''s device evidence created',
  pg_temp.st(:'b1_r', 'f14') = 'insufficient_evidence');
SELECT pg_temp.ok('the same file already on the vehicle is refused', pg_temp.st(:'b1_r', 'f19') = 'duplicate_on_target'
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('f19')) IS NULL);
SELECT pg_temp.ok('malformed, unknown-method and repeated items are refused',
  (SELECT x ->> 'status' FROM jsonb_array_elements(:'b1_r'::jsonb -> 'results') x WHERE x ->> 'image_id' = 'not-a-uuid') = 'invalid_item'
  AND pg_temp.st(:'b1_r', 'f17') = 'invalid_method'
  AND (SELECT array_agg(x ->> 'status' ORDER BY o) FROM jsonb_array_elements(:'b1_r'::jsonb -> 'results') WITH ORDINALITY e(x, o)
       WHERE x ->> 'image_id' = pg_temp.i('f01')::text) = ARRAY['filed', 'duplicate_item']);
SELECT pg_temp.ok('counts, filed ids and audit rows agree: four filed',
  (:'b1_r'::jsonb -> 'counts' ->> 'filed')::int = 4 AND jsonb_array_length(:'b1_r'::jsonb -> 'filed') = 4
  AND (:'b1_r'::jsonb ->> 'requested')::int = 22 AND jsonb_array_length(:'b1_r'::jsonb -> 'results') = 22
  AND (SELECT count(*) FROM public.reattribution_audit WHERE actor_user_id = pg_temp.u('owner')) = 4);
SELECT pg_temp.ok('a photo already on the vehicle (or on a vehicle merged into it) is ''already''',
  (:'b2_r'::jsonb -> 'counts' ->> 'already')::int = 3
  AND (SELECT count(*) FROM public.reattribution_audit WHERE actor_user_id = pg_temp.u('owner')) = 4);
SELECT pg_temp.ok('more than 500 items a call is refused', current_setting('test.cap', true) = 'refused');

-- 4. device_create_vehicle_profile -----------------------------------------------------------------------------------
SELECT
  jsonb_build_object('basis', 'vin', 'vin', '1HGCM82634A004352', 'image_ids', jsonb_build_array(pg_temp.i('k01')),
    'evidence', '{"edit_distance": "0"}'::jsonb)::text AS req_badvin,
  jsonb_build_object('basis', 'vin', 'vin', '1HGCM8263A004352', 'image_ids', jsonb_build_array(pg_temp.i('k01')),
    'evidence', '{"edit_distance": "0"}'::jsonb)::text AS req_shortvin,
  jsonb_build_object('basis', 'vin', 'vin', '1m8gdm9axkp042788', 'year', NULL, 'make', NULL, 'model', NULL,
    'image_ids', jsonb_build_array(pg_temp.i('k01'), pg_temp.i('k02')),
    'evidence', '{"edit_distance": "0", "read": "on_device_ocr"}'::jsonb)::text AS req_new,
  jsonb_build_object('basis', 'vin', 'vin', '1HGCM82633A004352', 'image_ids', jsonb_build_array(pg_temp.i('k03')),
    'evidence', '{"edit_distance": "0"}'::jsonb)::text AS req_known,
  jsonb_build_object('basis', 'vin', 'vin', pg_temp.vin('1FMDU34X?NU100001'), 'image_ids', jsonb_build_array(pg_temp.i('k04')),
    'evidence', '{"edit_distance": "0"}'::jsonb)::text AS req_priv,
  jsonb_build_object('basis', 'vin', 'vin', pg_temp.vin('1FMDU34X?PU100002'), 'image_ids', jsonb_build_array(pg_temp.i('k05')),
    'evidence', '{"edit_distance": "0"}'::jsonb)::text AS req_pub,
  jsonb_build_object('basis', 'vin', 'vin', pg_temp.vin('1GCEK14K?HZ100001'), 'image_ids', jsonb_build_array(pg_temp.i('k06')),
    'evidence', '{"edit_distance": "1"}'::jsonb)::text AS req_noexact,
  jsonb_build_object('basis', 'vin', 'vin', pg_temp.vin('1GCEK14K?HZ100001'), 'image_ids', jsonb_build_array(pg_temp.i('k06')),
    'evidence', jsonb_build_object('reads', jsonb_build_array(jsonb_build_object('image_id', pg_temp.i('k06'),
      'edit_distance', 0, 'text', pg_temp.vin('1GCEK14K?HZ100001')))))::text AS req_reads,
  jsonb_build_object('basis', 'vin', 'vin', pg_temp.vin('1FAPP14J?MW100001'), 'image_ids', jsonb_build_array(pg_temp.i('k07')),
    'evidence', '{"edit_distance": "0"}'::jsonb)::text AS req_deleted,
  jsonb_build_object('basis', 'album', 'album_name', '1972 Chevy C10', 'album_native_id', 'ALBUM-C10', 'year', 1972,
    'make', 'Chevy', 'model', 'C10', 'image_ids', (SELECT jsonb_agg(pg_temp.i('a' || lpad(n::text, 2, '0'))) FROM generate_series(1, 12) n),
    'evidence', '{"album": "1972 Chevy C10"}'::jsonb)::text AS req_ambiguous,
  jsonb_build_object('basis', 'album', 'album_name', '1984 chevy k5 blazer', 'album_native_id', 'ALBUM-K5', 'year', 1984,
    'make', 'Chevy', 'model', 'k5 blazer', 'image_ids', (SELECT jsonb_agg(pg_temp.i('b' || lpad(n::text, 2, '0'))) FROM generate_series(1, 12) n),
    'evidence', '{"album": "1984 chevy k5 blazer"}'::jsonb)::text AS req_k5,
  jsonb_build_object('basis', 'album', 'album_name', '1969 Ford Bronco', 'album_native_id', 'ALBUM-BRONCO', 'year', 1969,
    'make', 'Ford', 'model', 'Bronco', 'image_ids', (SELECT jsonb_agg(pg_temp.i('c' || lpad(n::text, 2, '0'))) FROM generate_series(1, 12) n),
    'evidence', '{"album": "1969 Ford Bronco"}'::jsonb)::text AS req_bronco,
  jsonb_build_object('basis', 'album', 'album_name', '1970 Ford Torino', 'album_native_id', 'ALBUM-TORINO', 'year', 1970,
    'make', 'Ford', 'model', 'Torino', 'image_ids', (SELECT jsonb_agg(pg_temp.i('d' || lpad(n::text, 2, '0'))) FROM generate_series(1, 12) n),
    'evidence', '{}'::jsonb)::text AS req_eleven,
  jsonb_build_object('basis', 'album', 'album_name', '1971 Ford', 'album_native_id', 'ALBUM-1971', 'year', 1971,
    'make', 'Ford', 'model', 'Maverick', 'image_ids', (SELECT jsonb_agg(pg_temp.i('g' || lpad(n::text, 2, '0'))) FROM generate_series(1, 12) n),
    'evidence', '{}'::jsonb)::text AS req_nomodel,
  jsonb_build_object('basis', 'album', 'album_name', 'Ford Maverick', 'album_native_id', 'ALBUM-MAV', 'year', 1971,
    'make', 'Ford', 'model', 'Maverick', 'image_ids', (SELECT jsonb_agg(pg_temp.i('g' || lpad(n::text, 2, '0'))) FROM generate_series(1, 12) n),
    'evidence', '{}'::jsonb)::text AS req_noyear,
  jsonb_build_object('basis', 'serial_album', 'serial', 'CE149S100001', 'album_name', '1969 Chevrolet Camaro RS',
    'album_native_id', 'ALBUM-RS', 'year', 1969, 'make', 'Chevrolet', 'model', 'Camaro',
    'image_ids', jsonb_build_array(pg_temp.i('e01'), pg_temp.i('e02')), 'evidence', '{}'::jsonb)::text AS req_serial,
  jsonb_build_object('basis', 'serial_album', 'serial', 'ABCDEFGH', 'album_name', '1969 Chevrolet Camaro RS', 'year', 1969,
    'make', 'Chevrolet', 'image_ids', jsonb_build_array(pg_temp.i('e03'), pg_temp.i('e04')))::text AS req_badserial,
  jsonb_build_object('basis', 'serial_album', 'serial', 'XS29N0B200001', 'album_name', '1970 Plymouth Barracuda', 'year', 1970,
    'make', 'Plymouth', 'image_ids', jsonb_build_array(pg_temp.i('e03'), pg_temp.i('e04')))::text AS req_othermake,
  jsonb_build_object('basis', 'serial_album', 'serial', 'CE149S100002', 'album_name', '1969 Chevrolet Camaro', 'year', 1969,
    'make', 'Chevrolet', 'image_ids', jsonb_build_array(pg_temp.i('e03')))::text AS req_onephoto,
  jsonb_build_object('basis', 'title', 'image_ids', jsonb_build_array(pg_temp.i('e03')))::text AS req_badbasis
\gset

SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'owner')::text, false);
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(:'req_badvin') AS r \gset badvin_
SELECT public.device_create_vehicle_profile(:'req_shortvin') AS r \gset shortvin_
SELECT public.device_create_vehicle_profile(:'req_new') AS r \gset new_
SELECT public.device_create_vehicle_profile(:'req_new') AS r \gset again_
SELECT public.device_create_vehicle_profile(:'req_known') AS r \gset known_
SELECT public.device_create_vehicle_profile(:'req_priv') AS r \gset priv_
SELECT public.device_create_vehicle_profile(:'req_pub') AS r \gset pub_
SELECT public.device_create_vehicle_profile(:'req_noexact') AS r \gset noexact_
SELECT public.device_create_vehicle_profile(:'req_reads') AS r \gset reads_
SELECT public.device_create_vehicle_profile(:'req_deleted') AS r \gset deleted_
SELECT public.device_create_vehicle_profile(:'req_ambiguous') AS r \gset ambiguous_
SELECT public.device_create_vehicle_profile(:'req_k5') AS r \gset k5_
SELECT public.device_create_vehicle_profile(:'req_bronco') AS r \gset bronco_
SELECT public.device_create_vehicle_profile(:'req_bronco') AS r \gset bronco2_
SELECT public.device_create_vehicle_profile(:'req_eleven') AS r \gset eleven_
SELECT public.device_create_vehicle_profile(:'req_nomodel') AS r \gset nomodel_
SELECT public.device_create_vehicle_profile(:'req_noyear') AS r \gset noyear_
SELECT public.device_create_vehicle_profile(:'req_serial') AS r \gset serial_
SELECT public.device_create_vehicle_profile(:'req_badserial') AS r \gset badserial_
SELECT public.device_create_vehicle_profile(:'req_othermake') AS r \gset othermake_
SELECT public.device_create_vehicle_profile(:'req_onephoto') AS r \gset onephoto_
SELECT public.device_create_vehicle_profile(:'req_badbasis') AS r \gset badbasis_
SELECT coalesce(jsonb_agg(x ORDER BY x), '[]') AS assoc2 FROM public.user_associated_vehicle_ids(:'owner') x \gset
RESET ROLE;

SELECT pg_temp.ok('an invalid VIN is refused and mints nothing',
  :'badvin_r'::jsonb ->> 'status' = 'invalid_vin' AND :'shortvin_r'::jsonb ->> 'status' = 'invalid_vin'
  AND (SELECT count(*) FROM public.vehicles WHERE vin IN ('1HGCM82634A004352', '1HGCM8263A004352')) = 0);
SELECT pg_temp.ok('a valid VIN no vehicle holds mints one profile and files both photos',
  :'new_r'::jsonb ->> 'status' = 'created' AND (:'new_r'::jsonb ->> 'replay')::boolean IS FALSE
  AND (:'new_r'::jsonb -> 'filing' -> 'counts' ->> 'filed')::int = 2
  AND (SELECT count(*) FROM public.vehicles WHERE vin = '1M8GDM9AXKP042788') = 1
  AND (SELECT count(*) FROM public.vehicle_images WHERE id IN (pg_temp.i('k01'), pg_temp.i('k02'))
       AND vehicle_id = (:'new_r'::jsonb ->> 'vehicle_id')::uuid) = 2);
SELECT pg_temp.ok('the minted vehicle is private, the caller''s upload, unowned, marked device_evidence with its evidence',
  (SELECT is_public IS FALSE AND uploaded_by = pg_temp.u('owner') AND user_id = pg_temp.u('owner') AND owner_id IS NULL
          AND profile_origin = 'device_evidence' AND source = 'device_evidence' AND entry_type = 'contributor_data'
          AND verification_status = 'unverified' AND status = 'active' AND year IS NULL AND make IS NULL
          AND vin_source = 'device_vin_ocr' AND vin_confidence = 95
          AND vin_source_image_id IN (pg_temp.i('k01'), pg_temp.i('k02'))
          AND origin_metadata -> 'device_evidence' ->> 'key' = 'vin:1M8GDM9AXKP042788'
          AND origin_metadata -> 'device_evidence' ->> 'basis' = 'vin'
          AND (origin_metadata -> 'device_evidence' ->> 'ownership_asserted')::boolean IS FALSE
          AND origin_metadata -> 'device_evidence' -> 'evidence' ->> 'read' = 'on_device_ocr'
          AND origin_metadata -> 'device_evidence' ->> 'requested_by' = pg_temp.u('owner')::text
   FROM public.vehicles WHERE id = (:'new_r'::jsonb ->> 'vehicle_id')::uuid));
SELECT pg_temp.ok('the caller is a photographer contributor from the earliest photo, never an owner',
  (:'new_r'::jsonb ->> 'contributor')::boolean
  AND (SELECT count(*) FROM public.vehicle_contributors WHERE vehicle_id = (:'new_r'::jsonb ->> 'vehicle_id')::uuid) = 1
  AND (SELECT role = 'photographer' AND user_id = pg_temp.u('owner') AND can_edit IS FALSE AND status = 'active'
          AND start_date = (SELECT min(taken_at)::date FROM public.vehicle_images WHERE id IN (pg_temp.i('k01'), pg_temp.i('k02')))
       FROM public.vehicle_contributors WHERE vehicle_id = (:'new_r'::jsonb ->> 'vehicle_id')::uuid));
SELECT pg_temp.ok('the profile''s photos were filed through attribute_testimony with the new_profile signal',
  (SELECT count(*) FROM public.reattribution_audit
   WHERE new_vehicle_id = (:'new_r'::jsonb ->> 'vehicle_id')::uuid AND actor_user_id = pg_temp.u('owner')
     AND reason LIKE '%confidence=0.95; signal=device_new_profile') = 2);
SELECT pg_temp.ok('the minted profile joins the caller''s associated vehicles',
  :'assoc2'::jsonb ? (:'new_r'::jsonb ->> 'vehicle_id'));
SELECT pg_temp.ok('the same request again returns the same vehicle and mints nothing',
  :'again_r'::jsonb ->> 'status' = 'created' AND (:'again_r'::jsonb ->> 'replay')::boolean
  AND :'again_r'::jsonb ->> 'vehicle_id' = :'new_r'::jsonb ->> 'vehicle_id'
  AND (:'again_r'::jsonb -> 'filing' -> 'counts' ->> 'already')::int = 2
  AND (SELECT count(*) FROM public.vehicles WHERE vin = '1M8GDM9AXKP042788') = 1
  AND (SELECT count(*) FROM public.vehicle_contributors WHERE vehicle_id = (:'new_r'::jsonb ->> 'vehicle_id')::uuid) = 1);
SELECT pg_temp.ok('an existing VIN on an associated vehicle is not re-minted; the photo files onto it',
  :'known_r'::jsonb ->> 'status' = 'exists_vin' AND :'known_r'::jsonb ->> 'vehicle_id' = pg_temp.v('accord')::text
  AND (SELECT count(*) FROM public.vehicles WHERE vin = '1HGCM82633A004352') = 1
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('k03')) = pg_temp.v('accord')
  AND (SELECT count(*) FROM public.reattribution_audit WHERE new_observation_id = pg_temp.i('k03')
       AND reason LIKE '%signal=device_vin_ocr') = 1);
SELECT pg_temp.ok('a VIN on another user''s vehicle files nothing; a private vehicle''s id is withheld, a public one''s returned',
  :'priv_r'::jsonb ->> 'status' = 'exists_not_associated' AND NOT (:'priv_r'::jsonb ? 'vehicle_id')
  AND :'pub_r'::jsonb ->> 'status' = 'exists_not_associated' AND :'pub_r'::jsonb ->> 'vehicle_id' = pg_temp.v('pubvin')::text
  AND (SELECT count(*) FROM public.vehicle_images WHERE id IN (pg_temp.i('k04'), pg_temp.i('k05')) AND vehicle_id IS NOT NULL) = 0
  AND (SELECT count(*) FROM public.vehicles WHERE vin = pg_temp.vin('1FMDU34X?NU100001')) = 1);
SELECT pg_temp.ok('a VIN read that is not exact cannot mint; an exact per-photo read can',
  :'noexact_r'::jsonb ->> 'status' = 'insufficient_evidence'
  AND :'reads_r'::jsonb ->> 'status' = 'created'
  AND (SELECT vin FROM public.vehicles WHERE id = (:'reads_r'::jsonb ->> 'vehicle_id')::uuid) = pg_temp.vin('1GCEK14K?HZ100001')
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('k06')) = (:'reads_r'::jsonb ->> 'vehicle_id')::uuid);
SELECT pg_temp.ok('a VIN held only by a deleted vehicle is not minted again',
  :'deleted_r'::jsonb ->> 'status' = 'exists_unavailable'
  AND (SELECT count(*) FROM public.vehicles WHERE vin = pg_temp.vin('1FAPP14J?MW100001')) = 1
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('k07')) IS NULL);
SELECT pg_temp.ok('an album matching two associated vehicles is ambiguous and changes nothing',
  :'ambiguous_r'::jsonb ->> 'status' = 'ambiguous'
  AND :'ambiguous_r'::jsonb -> 'candidates' = (SELECT jsonb_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.v('c10a'), pg_temp.v('c10b')]) x)
  AND (SELECT count(*) FROM public.vehicle_images WHERE id::text IN (SELECT jsonb_array_elements_text(:'req_ambiguous'::jsonb -> 'image_ids'))
       AND vehicle_id IS NOT NULL) = 0
  AND (SELECT count(*) FROM public.vehicles WHERE year = 1972) = 2);
SELECT pg_temp.ok('Chevy resolves to the associated CHEVROLET K5 Blazer: its photos file there, nothing minted',
  :'k5_r'::jsonb ->> 'status' = 'exists_associated' AND :'k5_r'::jsonb ->> 'vehicle_id' = pg_temp.v('k5')::text
  AND (:'k5_r'::jsonb -> 'filing' -> 'counts' ->> 'filed')::int = 12
  AND (SELECT count(*) FROM public.vehicles WHERE year = 1984) = 1
  AND (SELECT count(*) FROM public.reattribution_audit WHERE new_vehicle_id = pg_temp.v('k5')
       AND reason LIKE '%confidence=0.85; signal=device_album_map') = 12);
SELECT pg_temp.ok('an album of twelve uploaded photos naming year, make and model mints a private profile; a 1969 F-250 is not a Bronco',
  :'bronco_r'::jsonb ->> 'status' = 'created'
  AND (SELECT year = 1969 AND make = 'Ford' AND model = 'Bronco' AND vin IS NULL AND is_public IS FALSE AND owner_id IS NULL
              AND year_source = 'device_album_name' AND origin_metadata -> 'device_evidence' ->> 'key' = 'album:ALBUM-BRONCO'
       FROM public.vehicles WHERE id = (:'bronco_r'::jsonb ->> 'vehicle_id')::uuid)
  AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = (:'bronco_r'::jsonb ->> 'vehicle_id')::uuid) = 12
  AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = pg_temp.v('f250')) = 0
  AND (:'bronco_r'::jsonb ->> 'contributor')::boolean);
SELECT pg_temp.ok('the same album again returns the same profile',
  :'bronco2_r'::jsonb ->> 'status' = 'created' AND (:'bronco2_r'::jsonb ->> 'replay')::boolean
  AND :'bronco2_r'::jsonb ->> 'vehicle_id' = :'bronco_r'::jsonb ->> 'vehicle_id'
  AND (SELECT count(*) FROM public.vehicles WHERE year = 1969 AND model = 'Bronco') = 1);
SELECT pg_temp.ok('eleven uploaded photos, a model or year missing from the album name, are not enough',
  :'eleven_r'::jsonb ->> 'status' = 'insufficient_evidence' AND (:'eleven_r'::jsonb ->> 'usable')::int = 11
  AND :'nomodel_r'::jsonb ->> 'status' = 'insufficient_evidence' AND :'nomodel_r'::jsonb ->> 'detail' LIKE '%model%'
  AND :'noyear_r'::jsonb ->> 'status' = 'insufficient_evidence' AND :'noyear_r'::jsonb ->> 'detail' LIKE '%year%'
  AND (SELECT count(*) FROM public.vehicles WHERE year IN (1970, 1971) AND make = 'Ford') = 0);
SELECT pg_temp.ok('a chassis serial with its album mints a profile holding the serial, year, make and model',
  :'serial_r'::jsonb ->> 'status' = 'created'
  AND (SELECT vin = 'CE149S100001' AND year = 1969 AND make = 'Chevrolet' AND model = 'Camaro' AND vin_source = 'device_serial_ocr'
       FROM public.vehicles WHERE id = (:'serial_r'::jsonb ->> 'vehicle_id')::uuid)
  AND (SELECT count(*) FROM public.vehicle_images WHERE id IN (pg_temp.i('e01'), pg_temp.i('e02'))
       AND vehicle_id = (:'serial_r'::jsonb ->> 'vehicle_id')::uuid) = 2);
SELECT pg_temp.ok('a serial without digits, a serial on another make''s vehicle, one photo and an unknown basis are refused',
  :'badserial_r'::jsonb ->> 'status' = 'invalid_serial'
  AND :'othermake_r'::jsonb ->> 'status' = 'ambiguous' AND :'othermake_r'::jsonb ->> 'detail' LIKE '%another make%'
  AND :'onephoto_r'::jsonb ->> 'status' = 'insufficient_evidence'
  AND :'badbasis_r'::jsonb ->> 'status' = 'invalid_input'
  AND (SELECT count(*) FROM public.vehicle_images WHERE id IN (pg_temp.i('e03'), pg_temp.i('e04')) AND vehicle_id IS NOT NULL) = 0);
SELECT pg_temp.ok('the owner minted four profiles in all, each private and unowned',
  (SELECT count(*) FROM public.vehicles WHERE profile_origin = 'device_evidence' AND uploaded_by = pg_temp.u('owner')
   AND is_public IS FALSE AND owner_id IS NULL) = 4
  AND (SELECT count(*) FROM public.vehicle_contributors WHERE user_id = pg_temp.u('owner') AND role = 'owner') = 0);

-- Rate limit: a sixth profile within the hour is refused.
SELECT set_config('test.rate_requests', (SELECT jsonb_agg(jsonb_build_object('basis', 'vin',
  'vin', pg_temp.vin('1FTRX18L?XKA0000' || n), 'image_ids', jsonb_build_array(pg_temp.i('r' || n)),
  'evidence', jsonb_build_object('edit_distance', '0')) ORDER BY n) FROM generate_series(1, 6) n)::text, false);
SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.u('busy'))::text, false);
SET ROLE authenticated;
DO $$ DECLARE q jsonb; s text := ''; BEGIN
  FOR q IN SELECT value FROM jsonb_array_elements(current_setting('test.rate_requests')::jsonb) LOOP
    s := s || coalesce(public.device_create_vehicle_profile(q) ->> 'status', 'null') || ' ';
  END LOOP;
  PERFORM set_config('test.rate_statuses', btrim(s), false);
END $$;
RESET ROLE;
SELECT pg_temp.ok('five profiles an hour, the sixth rate limited',
  current_setting('test.rate_statuses') = 'created created created created created rate_limited'
  AND (SELECT count(*) FROM public.vehicles WHERE uploaded_by = pg_temp.u('busy')) = 5
  AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.i('r6')) IS NULL);

-- An account with no profile row cannot own an upload (vehicles.uploaded_by references profiles).
SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.u('noprofile'))::text, false);
SELECT jsonb_build_object('basis', 'vin', 'vin', pg_temp.vin('1FTRX18L?XKA00099'), 'image_ids', jsonb_build_array(pg_temp.i('n01')),
  'evidence', '{"edit_distance": "0"}'::jsonb)::text AS req_noprofile \gset
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(:'req_noprofile') AS r \gset noprofile_
RESET ROLE;
SELECT pg_temp.ok('an account with no profile is refused before minting',
  :'noprofile_r'::jsonb ->> 'status' = 'invalid_input'
  AND (SELECT count(*) FROM public.vehicles WHERE vin = pg_temp.vin('1FTRX18L?XKA00099')) = 0);

-- 5. The time budget -------------------------------------------------------------------------------------------------
-- Each filing here takes 0.25 s; with a 2 s statement_timeout the call stops starting photos after 1 s.
SET ROLE dm_contract_deployer;
CREATE FUNCTION public.t_slow_filing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.25); RETURN NEW; END $$;
CREATE TRIGGER t_slow_filing AFTER UPDATE OF vehicle_id ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION public.t_slow_filing();
RESET ROLE;
SELECT (SELECT jsonb_agg(pg_temp.item('g' || lpad(n::text, 2, '0'), pg_temp.v('orgcar'), 'album_map', 0.9) ORDER BY n)
        FROM generate_series(1, 10) n)::text AS b_slow \gset
SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'owner')::text, false);
SET ROLE authenticated;
SET statement_timeout = '2s';
SELECT public.device_file_images(:'b_slow') AS r \gset slow_
SET statement_timeout = '60s';
RESET ROLE;
SELECT pg_temp.ok('a spent time budget defers the remaining photos, unfiled',
  coalesce((:'slow_r'::jsonb -> 'counts' ->> 'filed')::int, 0) >= 1
  AND coalesce((:'slow_r'::jsonb -> 'counts' ->> 'deferred')::int, 0) >= 1
  AND (:'slow_r'::jsonb -> 'counts' ->> 'filed')::int + (:'slow_r'::jsonb -> 'counts' ->> 'deferred')::int = 10
  AND (SELECT count(*) FROM jsonb_array_elements(:'slow_r'::jsonb -> 'results') x JOIN public.vehicle_images vi
       ON vi.id = (x ->> 'image_id')::uuid WHERE x ->> 'status' = 'deferred' AND vi.vehicle_id IS NOT NULL) = 0);
SET ROLE dm_contract_deployer;
DROP TRIGGER t_slow_filing ON public.vehicle_images;
DROP FUNCTION public.t_slow_filing();
RESET ROLE;
SELECT (SELECT jsonb_agg(jsonb_build_object('image_id', x ->> 'image_id', 'vehicle_id', pg_temp.v('orgcar'),
          'method', 'album_map', 'confidence', 0.9))
        FROM jsonb_array_elements(:'slow_r'::jsonb -> 'results') x WHERE x ->> 'status' = 'deferred')::text AS b_resend \gset
SET ROLE authenticated;
SELECT public.device_file_images(:'b_resend') AS r \gset resend_
RESET ROLE;
SELECT pg_temp.ok('resending the deferred photos files them',
  (:'resend_r'::jsonb -> 'counts' ->> 'filed')::int = (:'slow_r'::jsonb -> 'counts' ->> 'deferred')::int
  AND (SELECT count(*) FROM public.vehicle_images WHERE id IN (SELECT pg_temp.i('g' || lpad(n::text, 2, '0')) FROM generate_series(1, 10) n)
       AND vehicle_id = pg_temp.v('orgcar')) = 10);

SELECT 'device attribution contract: PASS' AS result;
