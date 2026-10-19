-- Disposable PG17 only. Proves 20261019060000_actors_contact_columns_service_only.sql closes actors contact columns
-- to anon and authenticated while names, profile columns, the owner-run actor_profiles view and service reads stay.
-- The fixture mirrors the live table, policies and grants read on 2026-10-19; it shows the leak first.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.actors') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.actors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_type text NOT NULL, name text NOT NULL,
  organization_name text, parent_actor_id uuid, location text, city text, state text, country text DEFAULT 'US',
  specialties text[], certifications text[], trust_score integer, website text, phone text, email text, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), bio text,
  profile_image_url text, licenses text[], training text[], years_experience integer, specialty_makes text[],
  specialty_eras text[], current_workload integer DEFAULT 0, max_concurrent_projects integer,
  typical_turnaround_days integer, total_documented_jobs integer DEFAULT 0, total_components_touched integer DEFAULT 0);
CREATE TABLE public.actor_capabilities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES public.actors(id),
  capability_type text, complexity_tier text, evidence_count integer, last_demonstrated timestamptz);
ALTER TABLE public.actors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view actors" ON public.actors FOR SELECT USING (true);
CREATE POLICY "Service role manages actors" ON public.actors TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, REFERENCES, TRIGGER ON public.actors TO anon, authenticated;
GRANT ALL ON public.actors, public.actor_capabilities TO service_role;
GRANT SELECT ON public.actor_capabilities TO anon, authenticated;
CREATE VIEW public.actor_profiles AS
  SELECT a.id AS actor_id, a.name, a.actor_type, a.city, a.state, a.specialties, a.specialty_makes, a.trust_score,
    a.total_documented_jobs, a.years_experience,
    (SELECT jsonb_agg(sub.cap) FROM (SELECT jsonb_build_object('capability_type', ac.capability_type) AS cap
      FROM public.actor_capabilities ac WHERE ac.actor_id = a.id LIMIT 3) sub) AS top_capabilities
  FROM public.actors a;
GRANT SELECT ON public.actor_profiles TO anon, authenticated, service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text) TO anon, authenticated, service_role;

INSERT INTO public.actors(id, actor_type, name, city, phone, email, website, location, notes, specialties) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'person', 'Fixture Welder', 'Boise', '+15550100', 'w@example.com',
  'https://example.com', '1 Fixture Way', 'call after 5', ARRAY['welding']);

-- Before: anon reads the phone through the public policy.
SET ROLE anon;
SELECT t_assert((SELECT phone FROM public.actors) = '+15550100', 'before: anon reads actors.phone');
RESET ROLE;

\ir ../migrations/20261019060000_actors_contact_columns_service_only.sql
\ir ../migrations/20261019060000_actors_contact_columns_service_only.sql

SET ROLE anon;
SELECT t_assert(t_refused('SELECT phone FROM public.actors'), 'anon: phone refused');
SELECT t_assert(t_refused('SELECT email FROM public.actors'), 'anon: email refused');
SELECT t_assert(t_refused('SELECT website FROM public.actors'), 'anon: website refused');
SELECT t_assert(t_refused('SELECT location FROM public.actors'), 'anon: location refused');
SELECT t_assert(t_refused('SELECT notes FROM public.actors'), 'anon: notes refused');
SELECT t_assert(t_refused('SELECT * FROM public.actors'), 'anon: select star refused');
SELECT t_assert(t_refused($q$SELECT 1 FROM public.actors WHERE phone LIKE '+1%'$q$), 'anon: filtering on phone refused');
SELECT t_assert((SELECT name || '|' || actor_type || '|' || city || '|' || specialties[1] FROM public.actors)
  = 'Fixture Welder|person|Boise|welding', 'anon: name, type, city and specialties still readable');
SELECT t_assert((SELECT name FROM public.actor_profiles) = 'Fixture Welder', 'anon: actor_profiles view still reads');
SELECT t_assert((SELECT to_jsonb(p)::text !~ '(5550100|example\.com|Fixture Way|call after)' FROM public.actor_profiles p),
  'anon: actor_profiles carries no contact');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert(t_refused('SELECT phone FROM public.actors'), 'authenticated: phone refused');
SELECT t_assert(t_refused('SELECT email FROM public.actors'), 'authenticated: email refused');
SELECT t_assert(t_refused('SELECT notes FROM public.actors'), 'authenticated: notes refused');
SELECT t_assert((SELECT count(*) FROM public.actors) = 1, 'authenticated: rows still visible');
RESET ROLE;
SET ROLE service_role;
SELECT t_assert((SELECT phone || email || notes FROM public.actors) = '+15550100w@example.comcall after 5',
  'service_role: contact columns still readable');
RESET ROLE;
SELECT t_assert(NOT has_table_privilege('anon', 'public.actors', 'REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.actors', 'TRIGGER'), 'anon/authenticated lose REFERENCES and TRIGGER');
SELECT t_assert((SELECT count(*) FROM pg_policy WHERE polrelid='public.actors'::regclass) = 2, 'row policies unchanged');
SELECT t_assert((SELECT count(*) FROM public.actors WHERE phone IS NOT NULL) = 1, 'no row changed');
