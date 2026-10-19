-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_discovery_providers -f supabase/sql/test_discovery_providers_read.sql
-- Proves 20261020093000_discovery_providers_read.sql: only public profiles with a handle and a provider signal are listed,
-- by handle alone; anon may execute it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() !~ '^dm_refinement_' THEN RAISE EXCEPTION 'refusing to run outside a disposable dm_refinement_ database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text, full_name text, email text, is_public boolean DEFAULT true, updated_at timestamptz DEFAULT now());
CREATE TABLE public.account_link_claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, actor_id uuid, status text, verification_method text);
CREATE TABLE public.provider_service_area (user_id uuid PRIMARY KEY, city text, state text);
CREATE TABLE public.provider_availability (user_id uuid PRIMARY KEY, timezone text);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text);
CREATE TABLE public.business_ownership (business_id uuid, owner_id uuid, status text);

INSERT INTO public.profiles (id, username, full_name, email, is_public, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'evidenced', 'Ada One', 'a@example.com', true, '2026-10-01'),
  ('00000000-0000-0000-0000-000000000002', 'area', 'Bo Two', 'b@example.com', true, '2026-10-02'),
  ('00000000-0000-0000-0000-000000000003', 'member', 'Cy Three', 'c@example.com', true, '2026-10-03'),
  ('00000000-0000-0000-0000-000000000004', 'private', 'Di Four', 'd@example.com', false, '2026-10-04'),
  ('00000000-0000-0000-0000-000000000005', NULL, 'Ed Five', 'e@example.com', true, '2026-10-05'),
  ('00000000-0000-0000-0000-000000000006', 'selfclaim', 'Fi Six', 'f@example.com', true, '2026-10-06'),
  ('00000000-0000-0000-0000-000000000007', 'nobody', 'Gu Seven', 'g@example.com', true, '2026-10-07'),
  ('00000000-0000-0000-0000-000000000008', 'pending', 'Ha Eight', 'h@example.com', true, '2026-10-08');
INSERT INTO public.account_link_claims (user_id, actor_id, status, verification_method) VALUES
  ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'approved', 'work_evidence'),
  ('00000000-0000-0000-0000-000000000006', gen_random_uuid(), 'approved', 'self_claim'),
  ('00000000-0000-0000-0000-000000000004', gen_random_uuid(), 'approved', 'work_evidence');
INSERT INTO public.provider_service_area (user_id, city, state) VALUES ('00000000-0000-0000-0000-000000000002', 'Boulder City', 'NV'),
  ('00000000-0000-0000-0000-000000000005', 'Reno', 'NV');
INSERT INTO public.organization_contributors (organization_id, user_id, status) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000003', 'active'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000008', 'pending');

\i supabase/migrations/20261020093000_discovery_providers_read.sql

DO $$
DECLARE r jsonb; handles text[]; body text;
BEGIN
  SET LOCAL ROLE anon;
  r := public.discovery_providers_read();
  RESET ROLE;
  handles := ARRAY(SELECT x->>'handle' FROM jsonb_array_elements(r->'providers') x);
  IF handles IS DISTINCT FROM ARRAY['member', 'area', 'evidenced'] THEN RAISE EXCEPTION 'listed handles: %', handles; END IF;
  body := r::text;
  IF body ~ '(Ada|Bo Two|Cy Three|example\.com|00000000-0000)' THEN RAISE EXCEPTION 'personal data or ids leaked: %', body; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'providers') x WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k) <> ARRAY['handle', 'updated_at']) THEN
    RAISE EXCEPTION 'provider rows carry more than handle and clock';
  END IF;
  IF jsonb_array_length(public.discovery_providers_read(1)->'providers') <> 1 THEN RAISE EXCEPTION 'limit not applied'; END IF;
  IF NOT has_function_privilege('anon', 'public.discovery_providers_read(integer)', 'EXECUTE') THEN RAISE EXCEPTION 'anon cannot execute'; END IF;
  IF has_function_privilege('public', 'public.discovery_providers_read(integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.discovery_providers_read(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grant shape';
  END IF;
END $$;

SELECT 'test_discovery_providers_read: PASS' AS result;
