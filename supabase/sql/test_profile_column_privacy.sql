-- Synthetic fixtures only. Never run this against a populated database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_profile_privacy%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 profile-privacy database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  avatar_url text,
  bio text,
  location text,
  website text,
  created_at timestamptz,
  updated_at timestamptz,
  user_type text,
  phone_verified boolean,
  id_verification_status text,
  verification_level text,
  verified_at timestamptz,
  website_url text,
  github_url text,
  linkedin_url text,
  is_public boolean,
  is_verified boolean,
  username text,
  username_lower text,
  payment_verified boolean,
  role text,
  moderator_level text,
  tool_inventory_public boolean,
  profession text,
  expertise_areas text,
  business_name text,
  member_since timestamptz,
  total_listings text,
  total_bids text,
  total_comments text,
  total_auction_wins text,
  total_success_stories text,
  email text, phone text, phone_number text, address text, city text, state text, zip text,
  phone_verification_code text, phone_verification_expires_at timestamptz,
  verification_notes text, primary_id_document_id uuid, verification_document_ids uuid[],
  id_document_type text, id_document_url text, can_view_sensitive boolean,
  total_tool_value numeric, tool_count integer, business_license text, dealer_license text,
  telegram_id text, onboarded_via text, search_vector tsvector
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_profile ON public.profiles FOR SELECT USING (is_public IS TRUE);
CREATE POLICY own_profile ON public.profiles FOR SELECT USING (id=auth.uid());
CREATE POLICY own_update ON public.profiles FOR UPDATE USING (id=auth.uid()) WITH CHECK (id=auth.uid());
GRANT SELECT ON public.profiles TO anon,authenticated;
GRANT INSERT,UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
INSERT INTO public.profiles(id,username,full_name,is_public,email,phone,address,total_tool_value,tool_inventory_public)
VALUES ('10000000-0000-0000-0000-000000000001','public-fixture','Public Fixture',true,
        'synthetic@fixture.invalid','synthetic-phone','synthetic-address',123,false),
       ('10000000-0000-0000-0000-000000000002','private-fixture','Private Fixture',false,
        'private@fixture.invalid',NULL,NULL,NULL,false);
CREATE TABLE public.timeline_events(user_id uuid,vehicle_id uuid);
CREATE TABLE public.vehicle_images(id uuid,user_id uuid,image_url text,vehicle_id uuid,created_at timestamptz,taken_at timestamptz);
CREATE TABLE public.business_timeline_events(created_by uuid);
CREATE TABLE public.organization_contributors(user_id uuid,organization_id uuid,status text,role text);
CREATE TABLE public.businesses(id uuid,business_name text,logo_url text);
CREATE FUNCTION public.get_user_profile_fast(p_user_id uuid) RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT json_build_object('profile',row_to_json(p.*)) FROM public.profiles p WHERE p.id=p_user_id
$$;

-- Positive reproduction: the original public row policy exposes private fields.
SET ROLE anon;
DO $$ BEGIN
  IF (SELECT email FROM public.profiles WHERE username='public-fixture') <> 'synthetic@fixture.invalid' THEN
    RAISE EXCEPTION 'Fixture did not reproduce the original exposure';
  END IF;
END $$;
RESET ROLE;
\ir ../migrations/20261005014756_protect_private_profile_columns.sql

SET ROLE anon;
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.profiles WHERE username='public-fixture') <> 1
     OR (SELECT full_name FROM public.profiles WHERE username='public-fixture') <> 'Public Fixture'
     OR (SELECT COUNT(*) FROM public.profiles WHERE username='private-fixture') <> 0 THEN
    RAISE EXCEPTION 'Public fields or private-row eligibility changed';
  END IF;
  BEGIN
    PERFORM email FROM public.profiles;
    RAISE EXCEPTION 'Anonymous caller could read private column';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM p.* FROM public.profiles p;
    RAISE EXCEPTION 'Anonymous wildcard still exposes private columns';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_user_profile_fast('10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Anonymous caller could invoke private profile reader';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',false);
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.profiles) <> 2 THEN RAISE EXCEPTION 'Owner safe-row read broke'; END IF;
  BEGIN
    PERFORM address FROM public.profiles WHERE username='public-fixture';
    RAISE EXCEPTION 'Signed-in stranger could read private column';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_user_profile_fast('10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Signed-in stranger could read private profile RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF public.get_user_profile_fast('10000000-0000-0000-0000-000000000002')#>>'{profile,email}' <> 'private@fixture.invalid' THEN
    RAISE EXCEPTION 'Owner RPC lost its private fields';
  END IF;
END $$;
-- Private updates still work, without returning their fields through table SELECT.
UPDATE public.profiles SET email='updated@fixture.invalid'
WHERE id='10000000-0000-0000-0000-000000000002' RETURNING username;
DO $$ BEGIN
  IF public.get_user_profile_fast('10000000-0000-0000-0000-000000000002')#>>'{profile,email}' <> 'updated@fixture.invalid' THEN
    RAISE EXCEPTION 'Owner profile update failed';
  END IF;
END $$;
RESET ROLE;

-- Null/missing identity never gains private RPC access.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.get_user_profile_fast('10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Missing caller identity bypassed ownership';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

ALTER TABLE public.profiles ADD COLUMN future_private_field text;
DO $$ BEGIN
  IF has_column_privilege('anon','public.profiles','future_private_field','SELECT')
     OR has_column_privilege('authenticated','public.profiles','total_tool_value','SELECT')
     OR has_column_privilege('anon','public.profiles','id_document_url','SELECT') THEN
    RAISE EXCEPTION 'Private or future columns inherited public read access';
  END IF;
  IF has_function_privilege('anon','public.get_user_profile_fast(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_user_profile_fast(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Private RPC execution grants changed incorrectly';
  END IF;
END $$;
SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
DO $$ BEGIN
  IF public.get_user_profile_fast('10000000-0000-0000-0000-000000000001')#>>'{profile,email}' <> 'synthetic@fixture.invalid' THEN
    RAISE EXCEPTION 'Trusted service reader broke';
  END IF;
END $$;
RESET ROLE;
SELECT 'PASS: public projection, owner privacy, stranger/null denial, updates, future columns and service access' AS result;
