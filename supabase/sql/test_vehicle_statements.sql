-- Disposable synthetic contract; never production. Every name, account and sentence below is invented; the amount is an obviously fake number.
-- vehicle_statement_v1 (20261120100000): a person's words about a vehicle kept as that person's claim, private by default;
-- the page reader shows an anonymous visitor no words, no name and no amount; record_owner_statement is unchanged.
-- and reads by the speaker alone, whatever organisation a row names.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.role', true), '') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('fixture.jwt', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Live shapes (2026-11-17) of what the migration extends, reduced to the columns, checks, trigger and policy it meets.
CREATE TYPE public.observation_kind AS ENUM ('listing', 'comment', 'provenance', 'specification');
CREATE TABLE public.organizations(id uuid PRIMARY KEY, name text, is_public boolean DEFAULT true);
CREATE TABLE public.business_ownership(business_id uuid, owner_id uuid, status text);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE, base_trust_score numeric);
CREATE TABLE public.observation_extractors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.observation_sources(id), slug text NOT NULL UNIQUE, display_name text NOT NULL,
  extractor_type text NOT NULL, extractor_config jsonb DEFAULT '{}', produces_kinds public.observation_kind[] NOT NULL);
CREATE TABLE public.api_keys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, key_hash text UNIQUE, key_prefix text,
  scopes text[], is_active boolean DEFAULT true, expires_at timestamptz);
INSERT INTO public.observation_sources(slug, base_trust_score) VALUES ('owner-input', 0.70), ('agent-submission', 0.90), ('other-source', 0.5);
CREATE TABLE public.vehicle_observations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, observed_at timestamptz NOT NULL,
  ingested_at timestamptz DEFAULT now(), source_id uuid REFERENCES public.observation_sources(id), source_identifier text,
  observer_raw jsonb, kind public.observation_kind NOT NULL, content_text text, content_hash text,
  structured_data jsonb NOT NULL DEFAULT '{}', confidence_score numeric, is_processed boolean DEFAULT false,
  processing_metadata jsonb, is_superseded boolean DEFAULT false,
  superseded_by uuid REFERENCES public.vehicle_observations(id), superseded_at timestamptz, lineage_chain uuid[],
  submitted_by_user_id uuid, extraction_method text, property_id uuid, extractor_id uuid,
  subject_type text NOT NULL DEFAULT 'vehicle', subject_id uuid, subject_organization_id uuid REFERENCES public.organizations(id),
  observed_at_basis text, source_event_at timestamptz, source_event_date date, source_event_time_precision text,
  CONSTRAINT unique_observation UNIQUE (source_id, source_identifier, kind, content_hash),
  CONSTRAINT vehicle_observations_subject_type_chk CHECK (subject_type = ANY (ARRAY['vehicle', 'organization', 'user', 'asset', 'external_identity'])),
  CONSTRAINT vehicle_observations_organization_subject_check CHECK (subject_organization_id IS NULL
    OR ((subject_type = 'organization') IS TRUE AND (subject_id = subject_organization_id) IS TRUE)),
  CONSTRAINT vehicle_observations_clock_basis_check CHECK (observed_at_basis IS NULL
    OR observed_at_basis = ANY (ARRAY['event_time', 'source_capture_time', 'source_publication_time'])),
  CONSTRAINT vehicle_observations_event_precision_check CHECK (source_event_time_precision IS NULL
    OR source_event_time_precision = ANY (ARRAY['exact', 'day', 'unknown'])),
  CONSTRAINT vehicle_observations_event_clock_check CHECK (
    (source_event_time_precision IS NULL AND source_event_at IS NULL AND source_event_date IS NULL)
    OR (source_event_time_precision IS NOT NULL AND observed_at_basis IS NOT NULL AND (
         (source_event_time_precision = 'exact' AND source_event_at IS NOT NULL)
      OR (source_event_time_precision = 'day' AND source_event_date IS NOT NULL AND source_event_at IS NULL)
      OR (source_event_time_precision = 'unknown' AND source_event_at IS NULL AND source_event_date IS NULL)))));
CREATE INDEX idx_vehicle_observations_submitted_by ON public.vehicle_observations(submitted_by_user_id, observed_at DESC)
  WHERE submitted_by_user_id IS NOT NULL;
CREATE FUNCTION public.check_observation_organization_subject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.subject_type = 'organization' AND NEW.subject_id IS NOT NULL AND NEW.subject_organization_id IS DISTINCT FROM NEW.subject_id THEN
    RAISE EXCEPTION 'new organization attribution requires typed organization FK' USING ERRCODE = '23514'; END IF;
  RETURN NEW; END $$;
CREATE TRIGGER check_observation_organization_subject_before_write BEFORE INSERT OR UPDATE OF subject_type, subject_id, subject_organization_id
  ON public.vehicle_observations FOR EACH ROW EXECUTE FUNCTION public.check_observation_organization_subject();
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
-- The live policy this change must override for its own rows (organisation branch reduced to business_ownership).
CREATE POLICY vo_subject_owner_read ON public.vehicle_observations FOR SELECT TO authenticated USING (
  vehicle_id IS NULL AND ((subject_type = 'user' AND subject_id = (SELECT auth.uid()))
    OR (subject_type = 'organization' AND EXISTS (SELECT 1 FROM public.business_ownership bo
          WHERE bo.business_id = vehicle_observations.subject_id AND bo.owner_id = (SELECT auth.uid()) AND bo.status = 'active'))));
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.vehicle_observations TO anon, authenticated, service_role;
GRANT SELECT ON public.organizations, public.observation_sources, public.business_ownership TO anon, authenticated, service_role;
GRANT SELECT ON public.api_keys TO service_role;

\ir ../migrations/20261117150000_owner_statement_writer.sql
-- Re-applying where it is already live must be a no-op.
\ir ../migrations/20261117150000_owner_statement_writer.sql

-- Live shapes (2026-11-20) of what the migration meets, reduced to the columns it reads.
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, uploaded_by uuid, owner_id uuid, created_by_user_id uuid,
  is_public boolean DEFAULT true, deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE public.vehicle_access_fixture(vehicle_id uuid, user_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT EXISTS (SELECT 1 FROM public.vehicle_access_fixture a WHERE a.vehicle_id = p_vehicle_id AND a.user_id = p_user_id) $$;
CREATE TABLE public.observation_properties(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_key text UNIQUE NOT NULL,
  label text, data_type text, unit text, ratified_at timestamptz, deprecated_at timestamptz);
CREATE TABLE public.vehicle_timeline_events(vehicle_id uuid, user_id uuid, event_date timestamptz);
CREATE TABLE public.business_timeline_events(created_by uuid, created_at timestamptz);
CREATE TABLE public.vehicle_images(user_id uuid, taken_at timestamptz);
CREATE TABLE public.profile_stats(user_id uuid PRIMARY KEY, vehicles_count int, total_vehicles int, total_images int,
  total_timeline_events int, total_contributions int, last_activity timestamptz, updated_at timestamptz);
GRANT SELECT ON public.vehicles, public.observation_properties TO anon, authenticated, service_role;
INSERT INTO public.vehicles(id, uploaded_by, owner_id, is_public) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', true),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', true);

\ir ../migrations/20261120100000_vehicle_bound_statements.sql
-- Re-applying where it is already live must be a no-op.
\ir ../migrations/20261120100000_vehicle_bound_statements.sql

CREATE FUNCTION public.assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', message; END IF; END $$;
CREATE FUNCTION public.refuses(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = expected THEN RETURN; END IF;
      RAISE EXCEPTION 'FAIL: % refused with % (%), expected %', statement, SQLSTATE, SQLERRM, expected;
    END;
    RAISE EXCEPTION 'FAIL: unexpectedly admitted %', statement;
  END $$;
GRANT EXECUTE ON FUNCTION public.assert(boolean, text), public.refuses(text, text) TO anon, authenticated, service_role;
CREATE TABLE public.fx(k text PRIMARY KEY, v text);
GRANT ALL ON public.fx TO anon, authenticated, service_role;

-- Synthetic people: a speaker, a manager of organisation B, a stranger. Synthetic organisations A and B.
\set speaker '10000000-0000-4000-8000-000000000001'
\set manager '10000000-0000-4000-8000-000000000002'
\set stranger '10000000-0000-4000-8000-000000000003'
\set org_a '20000000-0000-4000-8000-00000000000a'
\set org_b '20000000-0000-4000-8000-00000000000b'
INSERT INTO public.organizations(id, name) VALUES (:'org_a', 'Synthetic Org A'), (:'org_b', 'Synthetic Org B');
INSERT INTO public.business_ownership VALUES (:'org_b', :'manager', 'active');
-- Synthetic credentials. A token is 'nuke_oauth_' + 64 hex; the table stores only its hash, as the login flow does.
CREATE FUNCTION public.tok(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'nuke_oauth_' || repeat(to_hex(n), 64) $$;
CREATE FUNCTION public.h(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'sha256_' || encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
GRANT EXECUTE ON FUNCTION public.tok(int), public.h(text) TO anon, authenticated, service_role;
INSERT INTO public.api_keys(user_id, key_hash, key_prefix, scopes, is_active, expires_at) VALUES
  (:'speaker', h(tok(1)), 'oauth', ARRAY['read', 'write:observations'], true, now() + interval '1 hour'),  -- 1 login, read + write
  (:'speaker', h(tok(2)), 'oauth', ARRAY['read'], true, now() + interval '1 hour'),                        -- 2 login, read only
  (:'speaker', h(tok(3)), 'oauth', ARRAY['write:observations'], true, now() + interval '1 hour'),          -- 3 login, write only
  (:'speaker', h(tok(4)), 'oauth', ARRAY['read', 'write:observations'], false, now() + interval '1 hour'), -- 4 revoked
  (:'speaker', h(tok(5)), 'oauth', ARRAY['read', 'write:observations'], true, now() - interval '1 day'),   -- 5 expired
  (NULL,       h(tok(6)), 'oauth', ARRAY['read', 'write:observations'], true, now() + interval '1 hour'),  -- 6 bound to no user
  (:'stranger', h(tok(7)), 'oauth', ARRAY['read', 'write:observations'], true, now() + interval '1 hour'), -- 7 another user
  (:'speaker', h(tok(8)), 'lentkey1', ARRAY['read', 'write', 'write:observations', 'admin'], true, NULL),  -- 8 long-lived API key
  (:'speaker', h(tok(9)), 'oauth', ARRAY['accounting:read', 'mcp:tools', 'write', 'admin'], true, now() + interval '1 hour'), -- 9 other scopes
  (:'speaker', h(tok(10)), 'oauth', ARRAY['read', 'write:observations'], true, NULL),                      -- a login prefix that never expires
  (:'speaker', h(tok(11)), 'lentkey2', ARRAY['read', 'write:observations'], true, now() + interval '1 hour'); -- b expiring, not from the login


-- Vehicles: 1 (the speaker uploaded it, the manager owns it), 2 (the manager's; the speaker has no access). Fake amount: 9876543.
-- 1. Nobody is a speaker without authentication; a stranger without access is refused; roles are a closed list. -----
SET ROLE anon;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'anon', false);
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'synthetic', 'representative', 'assertion', 'basis', 'fixture-agent')$q$, '42501');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000003', false), set_config('fixture.role', 'authenticated', false);
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'synthetic', 'representative', 'assertion', 'basis', 'fixture-agent')$q$, '42501');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false);
-- the speaker has no access to vehicle 2
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000002', 'synthetic', 'representative', 'assertion', 'basis', 'fixture-agent')$q$, '42501');
-- the vehicle record does not name the speaker as owner
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'synthetic', 'owner', 'assertion', 'basis', 'fixture-agent')$q$, '42501');
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'synthetic', 'titled owner', 'assertion', 'basis', 'fixture-agent')$q$, '23514');
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'synthetic', 'representative', 'paid', 'basis', 'fixture-agent')$q$, '23514');
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', '  ', 'representative', 'assertion', 'basis', 'fixture-agent')$q$, '23514');
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'synthetic', 'representative', 'assertion', 'basis', 'fixture-agent', p_target_key => 'rear_axle_type')$q$, '23514');
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'synthetic', 'representative', 'assertion', 'basis', 'fixture-agent', p_said_on => current_date + 3)$q$, '23514');
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-0000000000ff', 'synthetic', 'representative', 'assertion', 'basis', 'fixture-agent')$q$, '23514');

-- 2. The representative's two statements, targets not yet registered: stored whole, pending. -----------------------
INSERT INTO fx SELECT 'A', public.record_vehicle_statement('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'synthetic: Quentin Fakeperson says rear axle is posi', 'representative', 'assertion', 'said in a synthetic work chat', 'fixture-agent',
  p_said_on => current_date, p_target_key => 'rear_axle_type', p_target_value => 'limited_slip')::text;
INSERT INTO fx SELECT 'B', public.record_vehicle_statement('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
  'synthetic guess by Quentin Fakeperson: it cost around 9876543', 'seller_agent', 'estimate', 'said in a synthetic work chat', 'fixture-agent',
  p_said_on => current_date, p_target_key => 'paint_cost_estimate', p_target_value => '9876543')::text;
SELECT assert((SELECT v::jsonb->>'target_status' = 'pending' AND (v::jsonb->>'replay')::boolean = false FROM fx WHERE k = 'A'), 'A stored, target pending');
SELECT assert((SELECT v::jsonb->>'target_status' = 'pending' FROM fx WHERE k = 'B'), 'B stored, target pending');
-- the same request key twice is one row; a reused key with other content is refused
SELECT assert((public.record_vehicle_statement('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'synthetic: Quentin Fakeperson says rear axle is posi', 'representative', 'assertion', 'said in a synthetic work chat', 'fixture-agent',
  p_said_on => current_date, p_target_key => 'rear_axle_type', p_target_value => 'limited_slip')->>'replay')::boolean, 'replay recognised');
SELECT refuses($q$SELECT public.record_vehicle_statement('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'different words', 'representative', 'assertion', 'basis', 'fixture-agent')$q$, '23514');
RESET ROLE;
SELECT assert((SELECT count(*) = 2 FROM public.vehicle_observations WHERE extraction_method = 'vehicle_statement_v1'), 'two rows, the replay made no third');
SELECT assert((SELECT count(*) = 2 FROM public.vehicle_statement_links), 'two links');
-- stored whole, on the fact log: vehicle-less row, speaker as subject, private, unsigned, a claim, no property, no payer or payee
SELECT assert((SELECT bool_and(vehicle_id IS NULL AND property_id IS NULL AND subject_type = 'user' AND kind = 'provenance'
    AND structured_data->>'sign_status' = 'unsigned' AND structured_data->'is_public' = 'false'::jsonb
    AND structured_data->>'class' = 'claim' AND NOT structured_data ? 'payer' AND NOT structured_data ? 'payee')
  FROM public.vehicle_observations WHERE extraction_method = 'vehicle_statement_v1'), 'row shape');
SELECT assert((SELECT content_text = 'synthetic guess by Quentin Fakeperson: it cost around 9876543' AND structured_data->>'statement_kind' = 'estimate'
    AND structured_data->>'speaker_role' = 'seller_agent' AND (structured_data->>'value_private')::boolean
  FROM public.vehicle_observations WHERE source_identifier = '40000000-0000-4000-8000-000000000002'), 'B exact words, estimate kind, private');
SELECT assert((SELECT source_event_date = current_date AND source_event_time_precision = 'day'
  FROM public.vehicle_observations WHERE source_identifier = '40000000-0000-4000-8000-000000000001'), 'A dated by the day said');

-- 3. What each reader gets. ------------------------------------------------------------------------------------------
SET ROLE anon;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'anon', false);
SELECT assert(public.vehicle_statements('30000000-0000-4000-8000-000000000001')::text !~ '9876543', 'anon: never the amount');
SELECT assert(public.vehicle_statements('30000000-0000-4000-8000-000000000001')::text !~* 'Fakeperson|posi|around', 'anon: never the words or a name');
SELECT assert(jsonb_array_length(public.vehicle_statements('30000000-0000-4000-8000-000000000001')->'statements') = 2, 'anon sees that two claims exist');
SELECT assert((SELECT bool_and(s->>'class' = 'claim' AND s->>'words' IS NULL AND s->>'statement_id' IS NULL AND s->>'value' IS NULL)
  FROM jsonb_array_elements(public.vehicle_statements('30000000-0000-4000-8000-000000000001')->'statements') s),
  'anon: claim, no words, no id, no value while the keys are pending');
SELECT assert((SELECT s->>'value_note' = 'amount private' FROM jsonb_array_elements(public.vehicle_statements('30000000-0000-4000-8000-000000000001')->'statements') s
  WHERE s->>'statement_kind' = 'estimate'), 'anon: the estimate reads "amount private"');
SELECT assert((SELECT s->>'speaker_role' = 'seller_agent' AND s->>'said_on' = current_date::text FROM jsonb_array_elements(public.vehicle_statements('30000000-0000-4000-8000-000000000001')->'statements') s
  WHERE s->>'statement_kind' = 'estimate'), 'anon: role and said-on date');
-- raw rows and links are closed to anon
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_observations WHERE extraction_method = 'vehicle_statement_v1'), 'anon reads no raw statement row');
SELECT refuses($q$SELECT * FROM public.vehicle_statement_links$q$, '42501');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000003', false), set_config('fixture.role', 'authenticated', false);
SELECT assert(public.vehicle_statements('30000000-0000-4000-8000-000000000001')::text !~ '9876543|Fakeperson', 'a stranger sees no words or amount');
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_observations WHERE extraction_method = 'vehicle_statement_v1'), 'a stranger reads no raw row');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000002', false);
-- the vehicle's owner is tied: sees the words
SELECT assert(public.vehicle_statements('30000000-0000-4000-8000-000000000001')::text ~ 'Fakeperson', 'a tied viewer sees the words');
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_observations WHERE extraction_method = 'vehicle_statement_v1'), 'raw rows are the speaker''s alone, even for the vehicle owner');
RESET ROLE;

-- 4. Once the keys are approved the statements read as keyed claims; the amount stays private. ----------------------
INSERT INTO public.observation_properties(property_key, label, data_type, unit, ratified_at) VALUES
  ('rear_axle_type', 'Rear axle type', 'enum', NULL, now()),
  ('paint_cost_estimate', 'Paint cost estimate', 'numeric', 'usd', now());
SET ROLE anon;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'anon', false);
SELECT assert((SELECT s->>'target_status' = 'registered' AND s->>'value' = 'limited_slip' AND s->>'target_label' = 'Rear axle type'
  FROM jsonb_array_elements(public.vehicle_statements('30000000-0000-4000-8000-000000000001')->'statements') s WHERE s->>'statement_kind' = 'assertion'),
  'A reads as a keyed claim after approval');
SELECT assert((SELECT s->>'target_status' = 'registered' AND s->>'value' IS NULL AND s->>'value_note' = 'amount private' AND s->>'target_label' = 'Paint cost estimate'
  FROM jsonb_array_elements(public.vehicle_statements('30000000-0000-4000-8000-000000000001')->'statements') s WHERE s->>'statement_kind' = 'estimate'),
  'B keyed but its amount stays private');
SELECT assert(public.vehicle_statements('30000000-0000-4000-8000-000000000001')::text !~ '9876543', 'anon: still never the amount');
RESET ROLE;
-- a registered numeric key types its value
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false), set_config('fixture.role', 'authenticated', false);
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'synthetic', 'representative', 'estimate', 'basis', 'fixture-agent', p_target_key => 'paint_cost_estimate', p_target_value => 'about five')$q$, '23514');

-- 5. Supersede and withdraw. ---------------------------------------------------------------------------------------
INSERT INTO fx SELECT 'A2', public.record_vehicle_statement('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001',
  'synthetic correction: the axle is open', 'representative', 'assertion', 'synthetic', 'fixture-agent', p_said_on => current_date,
  p_target_key => 'rear_axle_type', p_target_value => 'open', p_supersedes => (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 'A'))::text;
SELECT assert((SELECT count(*) = 1 FROM jsonb_array_elements(public.vehicle_statements('30000000-0000-4000-8000-000000000001')->'statements') s
  WHERE s->>'target_key' = 'rear_axle_type' AND s->>'value' = 'open'), 'the correction is current');
SELECT assert((SELECT count(*) = 2 FROM jsonb_array_elements(public.vehicle_statements('30000000-0000-4000-8000-000000000001')->'statements') s), 'still two current claims');
SELECT refuses(format($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'x', 'representative', 'assertion', 'b', 'fixture-agent', p_supersedes => %L)$q$,
  (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 'A')), '23514'); -- already superseded
INSERT INTO fx SELECT 'W', public.record_vehicle_statement('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001',
  'synthetic: I did not say that', 'seller_agent', 'estimate', 'synthetic', 'fixture-agent', p_said_on => current_date,
  p_supersedes => (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 'B'), p_withdraw => true)::text;
SELECT assert((SELECT count(*) = 1 FROM jsonb_array_elements(public.vehicle_statements('30000000-0000-4000-8000-000000000001')->'statements') s), 'the withdrawn estimate leaves the current read');
RESET ROLE;
SELECT assert((SELECT count(*) = 4 FROM public.vehicle_observations WHERE extraction_method = 'vehicle_statement_v1'), 'nothing was deleted: four rows, two superseded');
-- another speaker's statement, and another vehicle's, cannot be superseded
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000002', false);
SELECT refuses(format($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000002', 'x', 'representative', 'assertion', 'b', 'fixture-agent', p_supersedes => %L)$q$,
  (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 'A2')), '23514'); -- not that speaker's, and another vehicle
RESET ROLE;

-- 6. Only the writer admits these rows; they are immutable and never deleted. --------------------------------------
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false), set_config('fixture.uid', '', false);
SELECT refuses($q$INSERT INTO public.vehicle_observations(observed_at, source_id, source_identifier, kind, content_text, content_hash, extraction_method, structured_data)
  SELECT now(), id, 'raw', 'provenance', 'x', 'raw', 'vehicle_statement_v1', '{"claim_contract":"vehicle_statement_v1"}' FROM public.observation_sources WHERE slug = 'owner-input'$q$, '23514');
SELECT refuses($q$INSERT INTO public.vehicle_observations(vehicle_id, observed_at, source_id, source_identifier, kind, content_text, content_hash, extraction_method, structured_data)
  SELECT '30000000-0000-4000-8000-000000000001', now(), id, 'raw2', 'provenance', 'x', 'raw2', 'owner_statement_v1', '{"claim_contract":"owner_statement_v1"}' FROM public.observation_sources WHERE slug = 'owner-input'$q$, '23514');
SELECT refuses($q$UPDATE public.vehicle_observations SET content_text = 'rewritten' WHERE extraction_method = 'vehicle_statement_v1'$q$, '23514');
RESET ROLE;
SELECT refuses($q$DELETE FROM public.vehicle_observations WHERE extraction_method = 'vehicle_statement_v1'$q$, '23514');

-- 7. The connector path: a login credential names the speaker; record_owner_statement still behaves as before. -------
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false), set_config('fixture.uid', '', false);
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'x', 'representative', 'assertion', 'b', 'fixture-agent')$q$, '42501');
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'x', 'representative', 'assertion', 'b', 'fixture-agent', p_credential => tok(2))$q$, '42501');
SELECT refuses($q$SELECT public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'x', 'representative', 'assertion', 'b', 'fixture-agent', p_credential => tok(7))$q$, '42501'); -- the stranger's login
SELECT assert((public.record_vehicle_statement(gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'synthetic via connector', 'representative', 'recollection', 'synthetic', 'fixture-agent', p_credential => tok(1)) ->> 'replay')::boolean = false, 'connector login records');
SELECT assert((SELECT structured_data->'intake'->>'via' = 'connector_credential' FROM public.vehicle_observations WHERE content_text = 'synthetic via connector'), 'recorded via the connector credential');
SELECT assert((public.record_owner_statement(gen_random_uuid(), 'synthetic owner statement', 'synthetic', 'fixture-agent', p_credential => tok(1)) ->> 'sign_status') = 'unsigned', 'record_owner_statement unchanged');
SELECT refuses($q$INSERT INTO public.vehicle_observations(vehicle_id, observed_at, source_id, source_identifier, kind, content_text, content_hash, submitted_by_user_id, extraction_method, structured_data)
  SELECT '30000000-0000-4000-8000-000000000001', now(), id, 'raw3', 'provenance', 'x', 'raw3', '10000000-0000-4000-8000-000000000001', 'owner_statement_v1', '{"claim_contract":"owner_statement_v1"}' FROM public.observation_sources WHERE slug = 'owner-input'$q$, '23514'); -- an owner statement still cannot name a vehicle
RESET ROLE;

-- 8. Private rows are not public contributions. -----------------------------------------------------------------------
INSERT INTO public.vehicle_observations(observed_at, source_id, source_identifier, kind, content_text, content_hash, submitted_by_user_id)
  SELECT now(), s.id, 'public-contribution', 'listing', 'ordinary submitted row', 'h2', '10000000-0000-4000-8000-000000000001'
  FROM public.observation_sources s WHERE s.slug = 'other-source';
SELECT assert((SELECT total_contributions = 1 FROM public.recompute_profile_stats('10000000-0000-4000-8000-000000000001')),
  'vehicle statements do not move the public contribution count');

\echo 'vehicle statement writer -> page reader contract PASS'
