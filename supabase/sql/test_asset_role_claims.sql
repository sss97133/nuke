-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations through 20261113200000_asset_role_claims_split.sql (acceptance paths a, b, c).
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
\ir ../migrations/20261113200000_asset_role_claims_split.sql

-- (a) A museum visitor photographs someone else's work. Proposal -> confirm = one documentation claim. creator_id stays the visitor
--     as record origin; no maker, no holder, no holder_declaration. Dismiss leaves no current claim; pending proposals take no claims.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ DECLARE r jsonb; c jsonb; p jsonb; mine jsonb; aid uuid; bid uuid; BEGIN
  r := public.propose_held_assets('0b9f107a-0000-4000-8000-000000000001', $j$[
    {"proposal_key":"museum:visit:0001","kind":"painting","labels":["Painting"],"labeller":"apple_photos_on_device_v1",
     "photos":[{"uuid":"MUSE-1","taken_at":"2026-10-01T15:00:00Z","filename":"IMG_10.HEIC","place":"A museum"},
               {"uuid":"MUSE-2","taken_at":"2026-10-01T15:01:00Z","filename":"IMG_11.HEIC","place":"A museum"}]},
    {"proposal_key":"museum:visit:0002","kind":"sculpture","labels":["Sculpture"],"labeller":"apple_photos_on_device_v1",
     "photos":[{"uuid":"MUSE-3","taken_at":"2026-10-01T15:05:00Z","filename":"IMG_12.HEIC"}]}]$j$::jsonb);
  IF (r->>'proposals_new')::int <> 2 THEN RAISE EXCEPTION 'a: proposals not written: %', r; END IF;
  SELECT id INTO aid FROM public.assets WHERE attributes->>'identity_key' = 'proposal:0b9f107a-0000-4000-8000-000000000001:museum:visit:0001';
  SELECT id INTO bid FROM public.assets WHERE attributes->>'identity_key' = 'proposal:0b9f107a-0000-4000-8000-000000000001:museum:visit:0002';

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000001"}', true);
  BEGIN
    PERFORM public.record_asset_role_claim(aid, 'creator');
    RAISE EXCEPTION 'a: a pending proposal must refuse claims';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  c := public.confirm_held_asset(aid, 'A painting seen at a museum', NULL, NULL, NULL, NULL, 'Photographed on a visit.', 'private');
  IF (c->>'duplicate')::boolean OR c->>'holding' <> 'not_claimed' OR c->>'authorship' <> 'not_claimed' THEN RAISE EXCEPTION 'a: confirm receipt wrong: %', c; END IF;
  IF (SELECT creator_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'a: creator_id must stay record origin'; END IF;
  IF (SELECT owner_id FROM public.assets WHERE id = aid) IS NOT NULL THEN RAISE EXCEPTION 'a: documenting must not set a holder'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind IN ('creation_claim', 'holding_claim', 'holder_declaration')) <> 0 THEN
    RAISE EXCEPTION 'a: documenting must write no maker, holder or holder declaration'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'documentation_claim' AND superseded_by IS NULL
        AND structured_data->>'party_user_id' = '0b9f107a-0000-4000-8000-000000000001' AND structured_data->>'claim_state' = 'evidenced'
        AND jsonb_array_length(structured_data->'evidence') = 2) <> 1 THEN RAISE EXCEPTION 'a: one evidenced documentation claim citing both photos'; END IF;
  c := public.confirm_held_asset(aid, 'A painting seen at a museum', NULL, NULL, NULL, NULL, NULL, 'private');
  IF NOT (c->>'duplicate')::boolean OR (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'documentation_claim') <> 1 THEN
    RAISE EXCEPTION 'a: confirming twice is a no-op'; END IF;
  mine := public.held_assets_read(50);
  IF (mine->>'total')::int <> 0 OR (mine->>'documented_total')::int <> 1 OR mine->'documented'->0->'my_roles' <> '["documenter"]'::jsonb THEN
    RAISE EXCEPTION 'a: the visitor documents, does not hold: %', mine; END IF;
  p := public.asset_profile_read(aid);
  IF p IS NULL OR (p->'viewer'->>'is_holder')::boolean OR NOT (p->'viewer'->>'is_record_origin')::boolean OR jsonb_array_length(p->'creation') <> 0
     OR p->'role_claims'->0->>'role' <> 'documenter' OR p->'role_claims'->0 ? 'party_user_id' THEN RAISE EXCEPTION 'a: profile wrong: %', p; END IF;
  -- Another signed-in user cannot read the private record.
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000005"}', true);
  IF public.asset_profile_read(aid) IS NOT NULL THEN RAISE EXCEPTION 'a: a private record is not readable by another user'; END IF;
  -- Dismiss the second proposal: archived, no current claim of any kind, testimony kept.
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000001"}', true);
  c := public.dismiss_held_asset(bid, 'not a work, a plinth');
  IF (SELECT status FROM public.assets WHERE id = bid) <> 'archived' THEN RAISE EXCEPTION 'a: dismiss archives'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = bid AND superseded_by IS NULL
        AND kind IN ('documentation_claim', 'creation_claim', 'holding_claim', 'performance_claim', 'rights_claim')
        AND coalesce(structured_data->>'claim_state', 'source_statement') NOT IN ('withdrawn', 'ended')) <> 0 THEN RAISE EXCEPTION 'a: dismiss leaves no current claim'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = bid AND kind = 'photo_sighting') <> 1 THEN RAISE EXCEPTION 'a: dismiss keeps testimony'; END IF;
  BEGIN
    PERFORM public.record_asset_role_claim(bid, 'holder');
    RAISE EXCEPTION 'a: an archived proposal must refuse claims';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- (b) One person does vehicle work and art work. Their art contributions resolve to work actors only through an approved
--     account_link_claims actor link (viewer_identity_bridge). A catalogue identity is not a technician actor, even when that
--     person has claimed it. A same-name user resolves to nothing.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
INSERT INTO public.actors (id, display_name) VALUES ('ac700000-0000-4000-8000-000000000001', 'Two Trades shop actor'),
  ('ac700000-0000-4000-8000-000000000002', 'Unproven actor');
INSERT INTO public.account_link_claims (user_id, platform, handle, actor_id, status, verification_method, reviewed_by_user_id, reviewed_at)
VALUES ('0b9f107a-0000-4000-8000-000000000002', 'nuke_actor', 'ac700000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
        'approved', 'work_evidence', '0b9f107a-0000-4000-8000-000000000003', now()),
       ('0b9f107a-0000-4000-8000-000000000006', 'nuke_actor', 'ac700000-0000-4000-8000-000000000002', 'ac700000-0000-4000-8000-000000000002',
        'pending', 'self_claim', NULL, NULL);
INSERT INTO public.external_identities (id, platform, handle, display_name, claimed_by_user_id, claimed_at)
VALUES ('e7000000-0000-4000-8000-000000000001', 'art_catalogue', 'jane doe|1970', 'Jane Doe', '0b9f107a-0000-4000-8000-000000000002', now());
INSERT INTO public.assets (id, asset_type, title, creator_id, owner_id, status, visibility, attributes)
VALUES ('a5500000-0000-4000-8000-000000000001', 'artwork', 'Jane Doe (born 1970) Untitled', NULL, NULL, 'active', 'public',
        '{"identity_key":"test:house:1","identity_basis":"house_lot","source":"bonhams"}');
INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, source_identifier, extraction_method)
VALUES ('a5500000-0000-4000-8000-000000000001', 'ad7104a3-48aa-486e-afff-f9f8af614883', 'creation_claim', '2025-05-01T12:00:00Z', 'Untitled',
        '{"role":"creator","attribution":"direct","layout":"lines","party_identity_id":"e7000000-0000-4000-8000-000000000001","name_as_printed":"Jane Doe"}',
        'test-house-claim-1', 'test-lot-1', 'house_catalogue_lines_v1');
DO $$ DECLARE c jsonb; r jsonb; hc jsonb; tc jsonb; nc jsonb; BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000002"}', true);
  tc := public.record_asset_role_claim('a5500000-0000-4000-8000-000000000001', 'performer', '[]'::jsonb, 'Installed the work.');
  IF tc->>'claim_state' <> 'self_reported' THEN RAISE EXCEPTION 'b: a performance claim is self-reported: %', tc; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000006"}', true);
  nc := public.record_asset_role_claim('a5500000-0000-4000-8000-000000000001', 'creator', '[]'::jsonb, 'I am Jane Doe.');
  IF nc->>'claim_state' <> 'self_reported' THEN RAISE EXCEPTION 'b: a name match is not evidence: %', nc; END IF;
  -- Citing their own claim as evidence is refused.
  BEGIN
    PERFORM public.record_asset_role_claim('a5500000-0000-4000-8000-000000000001', 'rights_holder', jsonb_build_array(nc->>'claim_id'), NULL);
    RAISE EXCEPTION 'b: own claim as evidence must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000002"}', true);
  BEGIN
    PERFORM public.asset_claim_actors('a5500000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'b: asset_claim_actors is service-only';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.asset_claim_actors('a5500000-0000-4000-8000-000000000001');
  SELECT x INTO hc FROM jsonb_array_elements(r->'claims') x WHERE x->>'party_kind' = 'catalogue';
  IF hc IS NULL OR hc->'actor_ids' <> '[]'::jsonb OR hc->>'actor_basis' <> 'catalogue_identity_not_actor' THEN
    RAISE EXCEPTION 'b: a catalogue identity is not an actor, even when claimed: %', hc; END IF;
  SELECT x INTO tc FROM jsonb_array_elements(r->'claims') x WHERE x->>'claim_id' = tc->>'claim_id';
  IF tc->'actor_ids' <> '["ac700000-0000-4000-8000-000000000001"]'::jsonb OR tc->>'bridge_state' <> 'evidenced' THEN
    RAISE EXCEPTION 'b: the person resolves through the approved actor link only: %', tc; END IF;
  SELECT x INTO nc FROM jsonb_array_elements(r->'claims') x WHERE x->>'claim_id' = nc->>'claim_id';
  IF nc->'actor_ids' <> '[]'::jsonb OR nc->>'bridge_state' <> 'claimed' THEN RAISE EXCEPTION 'b: a pending self-claimed actor link resolves nothing: %', nc; END IF;
  IF jsonb_array_length(r->'claims') <> 3 THEN RAISE EXCEPTION 'b: three current claims expected: %', r; END IF;
  -- The live CHECK forbids one row pairing an actor and a catalogue identity.
  BEGIN
    INSERT INTO public.account_link_claims (user_id, platform, handle, actor_id, external_identity_id, status, verification_method)
    VALUES ('0b9f107a-0000-4000-8000-000000000002', 'nuke_actor', 'ac700000-0000-4000-8000-000000000001', 'ac700000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000001', 'pending', 'self_claim');
    RAISE EXCEPTION 'b: actor + catalogue identity in one row must fail';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- House statements are untouched and user claims stay out of the market-by-party table.
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = 'a5500000-0000-4000-8000-000000000001' AND kind = 'creation_claim'
        AND structured_data ? 'party_identity_id' AND superseded_by IS NULL) <> 1 THEN RAISE EXCEPTION 'b: the house claim stays current'; END IF;
END $$;

-- (c) Artist, fabricator and later holder: distinct claims. The artist's declaration holds but does not author; authorship is a
--     separate act. The later holder's holding (and their own declaration) writes no authorship claim. creator_id stays record origin.
DO $$ DECLARE d jsonb; aid uuid; cr jsonb; fb jsonb; lh jsonb; h jsonb; mine jsonb; p jsonb; d2 jsonb; BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000003"}', true);
  d := public.declare_held_asset('artwork', 'Edition of a fabricated sculpture', 'powder-coated steel', '2025', NULL, '1/3', NULL, 'public');
  aid := (d->>'asset_id')::uuid;
  IF d->>'authorship' <> 'not_claimed' OR (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'creation_claim') <> 0 THEN
    RAISE EXCEPTION 'c: declaring a held work writes no authorship: %', d; END IF;
  IF (SELECT structured_data->>'claim_state' FROM public.asset_observations WHERE id = (d->>'holding_claim_id')::uuid) <> 'accepted'
     OR (SELECT owner_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000003' THEN RAISE EXCEPTION 'c: the declarer holds'; END IF;
  -- Holding is not evidence of making: the artist's own holding claim cannot be cited for authorship.
  BEGIN
    PERFORM public.record_asset_role_claim(aid, 'creator', jsonb_build_array(d->>'holding_claim_id'), NULL);
    RAISE EXCEPTION 'c: own holding claim cited for authorship must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  cr := public.record_asset_role_claim(aid, 'creator', '[]'::jsonb, 'I conceived and designed it.');
  IF cr->>'kind' <> 'creation_claim' OR cr->>'claim_state' <> 'self_reported' THEN RAISE EXCEPTION 'c: artist creator claim: %', cr; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000004"}', true);
  fb := public.record_asset_role_claim(aid, 'fabricator', '[]'::jsonb, 'Cut and welded the edition.');
  IF fb->>'kind' <> 'creation_claim' OR fb->>'role' <> 'fabricator' THEN RAISE EXCEPTION 'c: fabricator claim: %', fb; END IF;
  BEGIN
    PERFORM public.accept_asset_holding_claim((d->>'holding_claim_id')::uuid);
    RAISE EXCEPTION 'c: only the current holder hands over';
  EXCEPTION WHEN invalid_parameter_value OR insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000005"}', true);
  lh := public.record_asset_role_claim(aid, 'holder', '[]'::jsonb, 'Bought it from the artist.');
  IF lh->>'claim_state' <> 'self_reported' OR (SELECT owner_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000003' THEN
    RAISE EXCEPTION 'c: a later holder is self-reported until handover: %', lh; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000004"}', true);
  BEGIN
    PERFORM public.accept_asset_holding_claim((lh->>'claim_id')::uuid);
    RAISE EXCEPTION 'c: the fabricator is not the holder and cannot hand over';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000003"}', true);
  h := public.accept_asset_holding_claim((lh->>'claim_id')::uuid, 'sold 2026');
  IF (SELECT owner_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000005'
     OR (SELECT creator_id::text FROM public.assets WHERE id = aid) <> '0b9f107a-0000-4000-8000-000000000003' THEN
    RAISE EXCEPTION 'c: holding moves, record origin stays'; END IF;
  -- Distinct current claims: artist creator, fabricator, later holder accepted, artist holding ended.
  IF (SELECT string_agg(structured_data->>'role' || ':' || right(structured_data->>'party_user_id', 1) || ':' || (structured_data->>'claim_state'), ',' ORDER BY structured_data->>'role', structured_data->>'party_user_id')
        FROM public.asset_observations WHERE asset_id = aid AND superseded_by IS NULL AND extraction_method = 'asset_role_claim_v1')
     <> 'creator:3:self_reported,fabricator:4:self_reported,holder:3:ended,holder:5:accepted' THEN
    RAISE EXCEPTION 'c: current claims wrong: %', (SELECT jsonb_agg(structured_data) FROM public.asset_observations WHERE asset_id = aid AND superseded_by IS NULL AND extraction_method = 'asset_role_claim_v1'); END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'creation_claim' AND structured_data->>'party_user_id' = '0b9f107a-0000-4000-8000-000000000005') <> 0 THEN
    RAISE EXCEPTION 'c: the later holder has no authorship claim'; END IF;
  -- The artist is still record origin but no longer a holder: the reader never treats creator_id as holding.
  mine := public.held_assets_read(50);
  IF (mine->>'total')::int <> 0 THEN RAISE EXCEPTION 'c: the artist no longer holds: %', mine; END IF;
  p := public.asset_profile_read(aid);
  IF (p->'viewer'->>'is_holder')::boolean OR NOT (p->'viewer'->>'is_record_origin')::boolean THEN RAISE EXCEPTION 'c: artist viewer wrong: %', p->'viewer'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p->'creation') x WHERE x->>'claim_state' = 'self_reported') <> 2 THEN RAISE EXCEPTION 'c: creation shows two self-reported claims: %', p->'creation'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"0b9f107a-0000-4000-8000-000000000005"}', true);
  mine := public.held_assets_read(50);
  IF (mine->>'total')::int <> 1 OR mine->'assets'->0->'my_roles' <> '["holder"]'::jsonb THEN RAISE EXCEPTION 'c: the later holder holds: %', mine; END IF;
  IF NOT ((public.asset_profile_read(aid))->'viewer'->>'is_holder')::boolean THEN RAISE EXCEPTION 'c: later holder is_holder'; END IF;
  -- The later holder's own declaration of a work also writes no authorship.
  d2 := public.declare_held_asset('artwork', 'A print bought at a fair', NULL, NULL, NULL, NULL, NULL, 'private');
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = (d2->>'asset_id')::uuid AND kind = 'creation_claim') <> 0 THEN RAISE EXCEPTION 'c: declaration is not authorship'; END IF;
  -- Withdrawing holding clears owner_id; the claim history stays.
  PERFORM public.withdraw_asset_role_claim((h->>'claim_id')::uuid, 'consigned away');
  IF (SELECT owner_id FROM public.assets WHERE id = aid) IS NOT NULL OR ((public.asset_profile_read(aid)) IS NOT NULL AND ((public.asset_profile_read(aid))->'viewer'->>'is_holder')::boolean) THEN
    RAISE EXCEPTION 'c: withdrawal ends holding'; END IF;
  IF (SELECT count(*) FROM public.asset_observations WHERE asset_id = aid AND kind = 'holding_claim') <> 5 THEN RAISE EXCEPTION 'c: holding history kept (declared, self-reported, accepted, ended, withdrawn)'; END IF;
END $$;

-- Anon cannot call the sign-tier writers.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  BEGIN
    PERFORM public.record_asset_role_claim('a5500000-0000-4000-8000-000000000001', 'holder');
    RAISE EXCEPTION 'anon claim must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'test_asset_role_claims: all acceptance paths passed' AS result;
