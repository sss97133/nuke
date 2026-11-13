-- Shared fixture for the asset role claim contracts (disposable PG17 only, synthetic people). Loads the asset migrations up to
-- 20261109020000 (the pre-split flow). Each contract then loads 20261113200000 itself, before or after writing old-flow rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regclass('public.assets') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Live shapes (subset of columns), as of 2026-11-08.
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, display_name text,
  base_trust_score numeric);
CREATE TABLE public.assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_type text NOT NULL, title text, description text,
  creator_id uuid, owner_id uuid, organization_id uuid, status text DEFAULT 'active', visibility text DEFAULT 'private', vehicle_id uuid,
  attributes jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CONSTRAINT assets_asset_type_check CHECK (asset_type = ANY (ARRAY['image','vehicle','garment','publication','issue','article','shoot',
    'equipment','tool','part','material','goods'])));
CREATE TABLE public.asset_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  source_id uuid, kind text NOT NULL, observed_at timestamptz NOT NULL, content_text text, structured_data jsonb DEFAULT '{}'::jsonb, content_hash text NOT NULL,
  confidence numeric DEFAULT 0.5, source_url text, source_identifier text, extraction_method text, agent_model text, superseded_by uuid,
  supersedes uuid, created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX asset_observations_photo_sighting_uidx ON public.asset_observations (asset_id, source_identifier, extraction_method)
  WHERE kind = 'photo_sighting';
CREATE TABLE public.source_census(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid REFERENCES public.observation_sources(id),
  universe_total integer, universe_active integer, census_method text NOT NULL, census_confidence numeric, census_url text, census_notes text,
  census_at timestamptz NOT NULL DEFAULT now(), by_year jsonb DEFAULT '{}', by_make jsonb DEFAULT '{}', by_category jsonb DEFAULT '{}',
  raw_response jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL, handle text NOT NULL, profile_url text,
  display_name text, claimed_by_user_id uuid, claimed_at timestamptz, claim_confidence integer DEFAULT 0, first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(), metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), user_id uuid,
  CONSTRAINT external_identities_platform_handle_key UNIQUE (platform, handle));
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_observations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles(id uuid PRIMARY KEY, username text, full_name text, is_public boolean DEFAULT true);
INSERT INTO public.profiles (id, username, full_name) VALUES ('0b9f107a-0000-4000-8000-000000000001', 'holder', 'A Museum Visitor');
INSERT INTO public.observation_sources (id, slug, display_name, base_trust_score)
VALUES ('ad7104a3-48aa-486e-afff-f9f8af614883', 'bonhams', 'Bonhams', 0.90), ('ad7104a3-48aa-486e-afff-f9f8af614800', 'owner-input', 'Owner input', 0.95);
-- Identity-link owners (subset of live columns and the live CHECK on targets). viewer_identity_bridge is the live body
-- (20261019093000_job_readers_authenticated.sql), copied verbatim.
CREATE TABLE public.actors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text);
CREATE TABLE public.account_link_claims(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, platform text NOT NULL, handle text NOT NULL,
  external_identity_id uuid REFERENCES public.external_identities(id), status text NOT NULL DEFAULT 'pending', verification_method text,
  reviewed_by_user_id uuid, reviewed_at timestamptz, actor_id uuid REFERENCES public.actors(id), rung_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT account_link_claims_one_target CHECK (
    (actor_id IS NULL AND platform <> 'nuke_actor') OR
    (actor_id IS NOT NULL AND external_identity_id IS NULL AND platform = 'nuke_actor' AND handle = actor_id::text)),
  CONSTRAINT account_link_claims_actor_rung CHECK (
    actor_id IS NULL OR (
      verification_method IN ('unknown','self_claim','work_evidence','co_sign','authenticated_sign')
      AND status IN ('pending','approved','rejected','expired')
      AND (status <> 'approved' OR verification_method IN ('work_evidence','co_sign','authenticated_sign'))
      AND (verification_method IN ('unknown','self_claim') OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)))));
CREATE FUNCTION public.viewer_identity_bridge(p_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'state', CASE WHEN bool_or(c.status = 'approved' AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign')) THEN 'evidenced'
      WHEN bool_or(c.status = 'pending') THEN 'claimed' ELSE 'none' END,
    'evidenced_actor_ids', COALESCE(to_jsonb(array_agg(DISTINCT c.actor_id) FILTER (WHERE c.status = 'approved'
      AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign'))), '[]'::jsonb))
  FROM public.account_link_claims c
  WHERE c.user_id = p_user AND c.actor_id IS NOT NULL
$$;

-- Synthetic people. ...01 museum visitor; ...02 does vehicle and art work; ...03 artist; ...04 fabricator; ...05 later holder;
-- ...06 a different user whose display name equals a catalogue name.
INSERT INTO public.profiles (id, username, full_name) VALUES
  ('0b9f107a-0000-4000-8000-000000000002', 'tech', 'Two Trades'), ('0b9f107a-0000-4000-8000-000000000003', 'artist', 'An Artist'),
  ('0b9f107a-0000-4000-8000-000000000004', 'fab', 'A Fabricator'), ('0b9f107a-0000-4000-8000-000000000005', 'later', 'A Later Holder'),
  ('0b9f107a-0000-4000-8000-000000000006', 'namesake', 'Jane Doe');

\ir ../migrations/20261108170000_asset_lots.sql
\ir ../migrations/20261108200000_asset_lot_walk.sql
\ir ../migrations/20261108230000_asset_creation_claims.sql
\ir ../migrations/20261108233000_asset_creation_fold_layouts.sql
\ir ../migrations/20261108234500_asset_creators_current_lot.sql
\ir ../migrations/20261108235500_asset_creators_materialized.sql
\ir ../migrations/20261109000000_asset_profile_read.sql
\ir ../migrations/20261109013000_held_assets.sql
\ir ../migrations/20261109020000_held_asset_proposals.sql
