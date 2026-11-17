-- Disposable synthetic contract; never production. Every name, account, organisation and sentence below is invented.
-- The owner-statement writer (20261117150000): one private, unsigned, uninterpreted row per message on the fact log,
-- the speaker taken from authentication only, organisation links on their own rows, corrections by supersession,
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

-- 1. Nobody is a speaker without authentication; no argument names one. ------------------------------------------
SET ROLE anon;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'anon', false);
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent')$q$, '42501');
SELECT refuses($q$SELECT public.get_my_owner_statements()$q$, '42501');
RESET ROLE;
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false);
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent')$q$, '42501');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(0))$q$, '42501');
-- The stored hash is not a credential: reading api_keys makes nobody a speaker.
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => h(tok(1)))$q$, '42501');
SELECT refuses($q$SELECT public.get_my_owner_statements(p_credential => h(tok(1)))$q$, '42501');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(2))$q$, '42501');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(4))$q$, '42501');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(5))$q$, '42501');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(6))$q$, '42501');
-- A long-lived API key does not qualify, whatever its scopes; nor do admin, write or other scopes on a login.
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(8))$q$, '42501');
SELECT refuses($q$SELECT public.get_my_owner_statements(p_credential => tok(8))$q$, '42501');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(9))$q$, '42501');
SELECT refuses($q$SELECT public.get_my_owner_statements(p_credential => tok(9))$q$, '42501');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(10))$q$, '42501');
SELECT refuses($q$SELECT public.get_my_owner_statements(p_credential => tok(10))$q$, '42501');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(11))$q$, '42501');
SELECT refuses($q$SELECT public.get_my_owner_statements(p_credential => tok(11))$q$, '42501');
SELECT refuses($q$SELECT public.get_my_owner_statements()$q$, '42501');
-- A write scope does not read.
SELECT refuses($q$SELECT public.get_my_owner_statements(p_credential => tok(3))$q$, '42501');
-- The internal link writer is not callable by any API role.
SELECT refuses($q$SELECT public.owner_statement_write_link('10000000-0000-4000-8000-000000000001', 'x', NULL, gen_random_uuid(), gen_random_uuid(), 'n', 'a', NULL, NULL, false)$q$, '42501');
RESET ROLE;
-- A valid token is a credential only on the connector's path: any other role presenting it is nobody.
SET ROLE authenticated;
SELECT set_config('fixture.role', 'authenticated', false);
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(1))$q$, '42501');
SELECT refuses($q$SELECT public.get_my_owner_statements(p_credential => tok(1))$q$, '42501');
-- An anonymous sign-in is not a speaker.
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000009', false), set_config('fixture.jwt', '{"is_anonymous":true}', false);
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent')$q$, '42501');
SELECT refuses($q$SELECT public.get_my_owner_statements()$q$, '42501');
SELECT set_config('fixture.uid', '', false), set_config('fixture.jwt', '', false);
RESET ROLE;
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_observations), 'refused calls left no row');

-- 2. A signed-in speaker: the message is stored whole, unsigned, uninterpreted, with both clocks. ----------------
SET ROLE authenticated;
SELECT set_config('fixture.uid', :'speaker', false), set_config('fixture.role', 'authenticated', false);
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_credential => tok(7))$q$, '42501');
INSERT INTO fx SELECT 's1', public.record_owner_statement(
  '30000000-0000-4000-8000-000000000001',
  E'  Synthetic Org A supplies Synthetic Org B.\n\tThird Synthetic Name helps. é\U0001F697  ',
  'stated in conversation on this date', 'fixture-agent', p_said_on => DATE '2026-11-16',
  p_organization_links => jsonb_build_array(
    jsonb_build_object('name_as_written', 'Synthetic Org A', 'organization_id', :'org_a'),
    jsonb_build_object('name_as_written', 'Synthetic Org B', 'organization_id', :'org_b'),
    jsonb_build_object('name_as_written', 'Third Synthetic Name')),
  p_conversation_ref => 'fixture-conversation-1')::text;
RESET ROLE;
SELECT assert((SELECT (v::jsonb->>'replay') = 'false' AND jsonb_array_length(v::jsonb->'link_ids') = 3
  AND v::jsonb->>'sign_status' = 'unsigned' FROM fx WHERE k = 's1'), 'writer returns the statement and three links, labelled unsigned');
SELECT assert((SELECT count(*) = 1 FROM public.vehicle_observations o WHERE o.id = (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's1')
  AND o.content_text = E'  Synthetic Org A supplies Synthetic Org B.\n\tThird Synthetic Name helps. é\U0001F697  '
  AND o.vehicle_id IS NULL AND o.property_id IS NULL AND o.subject_type = 'user' AND o.subject_id = :'speaker'
  AND o.submitted_by_user_id = :'speaker' AND o.subject_organization_id IS NULL
  AND o.extraction_method = 'owner_statement_v1' AND o.kind = 'provenance'
  AND o.source_event_date = DATE '2026-11-16' AND o.source_event_at IS NULL AND o.source_event_time_precision = 'day'
  AND o.observed_at_basis = 'source_capture_time' AND o.observed_at > now() - interval '1 minute'  -- no invented midnight
  AND o.ingested_at > now() - interval '1 minute'
  AND o.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'owner-input')
  AND o.extractor_id = (SELECT id FROM public.observation_extractors WHERE slug = 'owner-statement-v1')
  AND o.structured_data->'withdrawal' = 'false'::jsonb
  AND o.confidence_score = 0.70
  AND o.structured_data->>'sign_status' = 'unsigned' AND o.structured_data->'interpreted' = 'false'::jsonb
  AND o.structured_data->'is_public' = 'false'::jsonb
  AND o.structured_data->>'said_at_basis' = 'stated in conversation on this date'
  AND o.structured_data->>'recording_agent' = 'fixture-agent' AND o.structured_data->>'speaker_user_id' = :'speaker'
  AND o.structured_data#>>'{intake,via}' = 'account_session'
  AND o.structured_data->>'conversation_ref' = 'fixture-conversation-1'),
  'statement row: whole text, speaker, recording agent apart, unsigned, said-at day with basis, recorded-at by the database');
SELECT assert((SELECT count(*) = 2 FROM public.vehicle_observations WHERE extraction_method = 'owner_statement_org_link_v1'
  AND subject_type = 'organization' AND subject_id = subject_organization_id AND structured_data->>'resolution' = 'resolved'
  AND submitted_by_user_id = :'speaker' AND vehicle_id IS NULL
  AND source_id = (SELECT id FROM public.observation_sources WHERE slug = 'agent-submission') AND confidence_score = 0.6  -- the agent source's trust (0.90 here), capped
  AND structured_data->'agent_inferred' = 'true'::jsonb AND structured_data->>'resolved_by' = 'recording_agent'
  AND extractor_id = (SELECT id FROM public.observation_extractors WHERE slug = 'owner-statement-org-link-v1')),
  'two names resolved to organisations with the typed key, filed as the agent''s inference, not the speaker''s words');
SELECT assert((SELECT count(*) = 1 FROM public.vehicle_observations WHERE extraction_method = 'owner_statement_org_link_v1'
  AND subject_type = 'user' AND subject_id = :'speaker' AND subject_organization_id IS NULL
  AND structured_data->>'resolution' = 'unresolved' AND content_text = 'Third Synthetic Name'),
  'a name that resolves to no organisation is kept as written');

-- 3. Replay and bad input. --------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT assert((SELECT (public.record_owner_statement(
  '30000000-0000-4000-8000-000000000001',
  E'  Synthetic Org A supplies Synthetic Org B.\n\tThird Synthetic Name helps. é\U0001F697  ',
  'stated in conversation on this date', 'fixture-agent-after-reconnect', p_said_on => DATE '2026-11-16',
  p_organization_links => jsonb_build_array(
    jsonb_build_object('name_as_written', 'Synthetic Org A', 'organization_id', :'org_a'),
    jsonb_build_object('name_as_written', 'Synthetic Org B', 'organization_id', :'org_b'),
    jsonb_build_object('name_as_written', 'Third Synthetic Name')),
  p_conversation_ref => 'fixture-conversation-1-retry')) @> jsonb_build_object('replay', true,
    'statement_id', (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 's1'))), 'a retried request returns the stored row');
SELECT refuses($q$SELECT public.record_owner_statement('30000000-0000-4000-8000-000000000001', 'different synthetic text', 'synthetic basis', 'fixture-agent')$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), '   ', 'synthetic basis', 'fixture-agent')$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', '', 'fixture-agent')$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', ' ')$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_said_on => current_date + 3)$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_said_at => now() + interval '1 hour')$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_withdraw => true)$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_said_on => current_date, p_said_at => now())$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_organization_links => '[{"name_as_written":"x","speaker":"y"}]')$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic', 'synthetic basis', 'fixture-agent', p_organization_links => '[{"name_as_written":"x","organization_id":"20000000-0000-4000-8000-0000000000ff"}]')$q$, '23514');
SELECT refuses($q$SELECT public.record_owner_statement(gen_random_uuid(), repeat('x', 100001), 'synthetic basis', 'fixture-agent')$q$, '23514');
RESET ROLE;
SELECT assert((SELECT count(*) = 4 FROM public.vehicle_observations), 'replay and refused input added nothing');

-- 4. The other said-at forms. -----------------------------------------------------------------------------------
SET ROLE authenticated;
INSERT INTO fx SELECT 's2', public.record_owner_statement('30000000-0000-4000-8000-000000000002', 'Synthetic second message.',
  'timestamp of the message in the conversation', 'fixture-agent', p_said_at => TIMESTAMPTZ '2026-11-10 15:04:05+00')::text;
SET TimeZone = 'America/Los_Angeles';
SELECT assert((SELECT (public.record_owner_statement('30000000-0000-4000-8000-000000000002', 'Synthetic second message.',
  'timestamp of the message in the conversation', 'fixture-agent', p_said_at => TIMESTAMPTZ '2026-11-10 15:04:05+00')->>'replay') = 'true'),
  'a retry from a session in another time zone is the same request');
RESET TimeZone;
INSERT INTO fx SELECT 's3', public.record_owner_statement('30000000-0000-4000-8000-000000000003', 'Synthetic third message.',
  'not stated; recorded when transcribed', 'fixture-agent')::text;
RESET ROLE;
SELECT assert((SELECT source_event_at = TIMESTAMPTZ '2026-11-10 15:04:05+00' AND source_event_date IS NULL
  AND source_event_time_precision = 'exact' AND observed_at = source_event_at AND observed_at_basis = 'event_time'
  FROM public.vehicle_observations WHERE id = (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's2')), 'an instant is stored exactly');
SELECT assert((SELECT source_event_at IS NULL AND source_event_date IS NULL AND source_event_time_precision = 'unknown'
  AND observed_at_basis = 'source_capture_time' AND observed_at > now() - interval '1 minute'
  FROM public.vehicle_observations WHERE id = (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's3')), 'an unstated said-at is labelled unknown, not invented');

-- 5. Only the speaker reads, whatever organisation a row names. ---------------------------------------------------
SET ROLE authenticated;
SELECT assert((SELECT count(*) = 6 FROM public.vehicle_observations), 'the speaker reads own statements and links through row security');
SELECT set_config('fixture.uid', :'manager', false);
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_observations), 'a manager of a named organisation reads nothing');
SELECT assert((SELECT (public.get_my_owner_statements()->>'total_count')::int = 0), 'the manager''s own reader is empty');
SELECT assert((SELECT (public.get_my_owner_statements(p_organization_id => '20000000-0000-4000-8000-00000000000b')->>'total_count')::int = 0), 'and empty for the organisation they manage');
SELECT refuses(format($q$SELECT public.record_owner_statement_link(gen_random_uuid(), %L, 'Synthetic Org B', 'fixture-agent')$q$, (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 's1')), '23514');
SELECT refuses(format($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic takeover', 'synthetic basis', 'fixture-agent', p_supersedes => %L)$q$, (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 's1')), '23514');
SELECT set_config('fixture.uid', :'stranger', false);
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_observations), 'a stranger reads nothing');
RESET ROLE;
SET ROLE anon;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'anon', false);
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_observations), 'an anonymous caller reads nothing');
RESET ROLE;
-- The override is this change's policy: without it the live policy shows the link to the manager.
DROP POLICY owner_statement_private_read ON public.vehicle_observations;
SET ROLE authenticated;
SELECT set_config('fixture.uid', :'manager', false), set_config('fixture.role', 'authenticated', false);
SELECT assert((SELECT count(*) = 1 FROM public.vehicle_observations), 'reproduce: without the restrictive policy the manager reads the link');
RESET ROLE;
\ir ../migrations/20261117150000_owner_statement_writer.sql
SET ROLE authenticated;
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_observations), 'with it, nothing');

-- 6. The reader: count, organisation and date filters. ----------------------------------------------------------
SELECT set_config('fixture.uid', :'speaker', false);
SELECT assert((SELECT r->>'reader' = 'get_my_owner_statements' AND (r->>'total_count')::int = 3 AND (r->>'returned')::int = 3
  AND r->>'speaker_user_id' = :'speaker' AND r#>>'{statements,0,sign_status}' = 'unsigned'
  FROM public.get_my_owner_statements() r), 'reader returns the three statements with a count');
SELECT assert((SELECT (r->>'total_count')::int = 1
  AND r#>>'{statements,0,statement}' = E'  Synthetic Org A supplies Synthetic Org B.\n\tThird Synthetic Name helps. é\U0001F697  '
  AND r#>>'{statements,0,said_on}' = '2026-11-16' AND r#>>'{statements,0,said_at_basis}' = 'stated in conversation on this date'
  AND jsonb_array_length(r#>'{statements,0,organization_links}') = 3
  AND r#>>'{statements,0,organization_links,0,organization_name}' = 'Synthetic Org A'
  FROM public.get_my_owner_statements(p_organization_id => '20000000-0000-4000-8000-00000000000b') r), 'organisation filter returns the statement whole, with its links');
SELECT assert((SELECT (r->>'total_count')::int = 1 FROM public.get_my_owner_statements(p_said_from => DATE '2026-11-10', p_said_to => DATE '2026-11-10') r), 'date filter on the said day');
SELECT assert((SELECT (r->>'total_count')::int = 3 AND (r->>'returned')::int = 1 FROM public.get_my_owner_statements(p_limit => 1, p_offset => 1) r), 'paging keeps the full count');
RESET ROLE;
-- The connector path: service role presenting its caller's raw token.
SET ROLE service_role;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'service_role', false);
SELECT assert((SELECT (r->>'total_count')::int = 3 AND r->>'speaker_user_id' = :'speaker' FROM public.get_my_owner_statements(p_credential => tok(2)) r), 'a read-scoped credential reads its user''s statements');
SELECT assert((SELECT (r->>'total_count')::int = 0 FROM public.get_my_owner_statements(p_credential => tok(7)) r), 'another user''s credential reads none of them');
INSERT INTO fx SELECT 's4', public.record_owner_statement('30000000-0000-4000-8000-000000000004', 'Synthetic fourth message, by connector.',
  'stated in conversation on this date', 'fixture-connector-agent', p_said_on => DATE '2026-11-17', p_credential => tok(1))::text;
RESET ROLE;
SELECT assert((SELECT submitted_by_user_id = :'speaker' AND structured_data#>>'{intake,via}' = 'connector_credential'
  AND structured_data#>>'{intake,credential_key_id}' = (SELECT id::text FROM public.api_keys WHERE key_hash = h(tok(1)))
  FROM public.vehicle_observations WHERE id = (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's4')),
  'the connector path takes the speaker from the credential and records which key');

-- 6b. A private organisation's name is not handed back on the connector path.
UPDATE public.organizations SET is_public = false WHERE id = '20000000-0000-4000-8000-00000000000a';
SET ROLE service_role;
SELECT assert((SELECT r#>'{statements,0,organization_links,0}' @> jsonb_build_object('organization_id', '20000000-0000-4000-8000-00000000000a', 'organization_name', NULL)
  AND r#>>'{statements,0,organization_links,0,name_as_written}' = 'Synthetic Org A'
  FROM public.get_my_owner_statements(p_organization_id => '20000000-0000-4000-8000-00000000000a', p_credential => tok(2)) r), 'a private organisation is named only as the speaker wrote it');
RESET ROLE;
INSERT INTO public.business_ownership VALUES ('20000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'active');
SET ROLE service_role;
SELECT assert((SELECT r#>>'{statements,0,organization_links,0,organization_name}' = 'Synthetic Org A'
  FROM public.get_my_owner_statements(p_organization_id => '20000000-0000-4000-8000-00000000000a', p_credential => tok(2)) r), 'unless it is the speaker''s own');
RESET ROLE;
UPDATE public.organizations SET is_public = true WHERE id = '20000000-0000-4000-8000-00000000000a';

-- 7. Corrections supersede; nothing is rewritten. -----------------------------------------------------------------
CREATE TABLE public.before_image AS SELECT id, to_jsonb(o) - ARRAY['is_superseded', 'superseded_by', 'superseded_at', 'lineage_chain'] AS body
  FROM public.vehicle_observations o;
SET ROLE authenticated;
SELECT set_config('fixture.uid', :'speaker', false), set_config('fixture.role', 'authenticated', false);
INSERT INTO fx SELECT 's1b', public.record_owner_statement('30000000-0000-4000-8000-000000000005', 'Synthetic Org A no longer supplies Synthetic Org B.',
  'stated in conversation on this date', 'fixture-agent', p_said_on => DATE '2026-11-17',
  p_organization_links => jsonb_build_array(jsonb_build_object('name_as_written', 'Synthetic Org B', 'organization_id', :'org_a')),
  p_supersedes => (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's1'))::text;
SELECT refuses(format($q$SELECT public.record_owner_statement(gen_random_uuid(), 'synthetic again', 'synthetic basis', 'fixture-agent', p_supersedes => %L)$q$, (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 's1')), '23514');
-- The agent linked the wrong organisation: correct the link alone.
INSERT INTO fx SELECT 'l1', public.record_owner_statement_link('40000000-0000-4000-8000-000000000001',
  (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's1b'), 'Synthetic Org B', 'fixture-agent-2', :'org_b',
  (SELECT (v::jsonb#>>'{link_ids,0}')::uuid FROM fx WHERE k = 's1b'))::text;
SELECT assert((SELECT public.record_owner_statement_link('40000000-0000-4000-8000-000000000001',
  (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's1b'), 'Synthetic Org B', 'fixture-agent-2', :'org_b',
  (SELECT (v::jsonb#>>'{link_ids,0}')::uuid FROM fx WHERE k = 's1b'))::text = (SELECT v FROM fx WHERE k = 'l1')), 'a retried link correction returns the stored link');
SELECT refuses(format($q$SELECT public.record_owner_statement_link(gen_random_uuid(), %L, 'Synthetic Org B', 'fixture-agent')$q$, (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 's1b')), '23514');
SELECT refuses(format($q$SELECT public.record_owner_statement_link(gen_random_uuid(), %L, 'Late Name', 'fixture-agent')$q$, (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 's1')), '23514');
INSERT INTO fx SELECT 'l2', public.record_owner_statement_link('40000000-0000-4000-8000-000000000002',
  (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's1b'), 'Another Synthetic Name', 'fixture-agent')::text;
INSERT INTO fx SELECT 'l3', public.record_owner_statement_link('40000000-0000-4000-8000-000000000003',
  (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's1b'), 'Another Synthetic Name', 'fixture-agent',
  p_supersedes => (SELECT v::uuid FROM fx WHERE k = 'l2'), p_withdraw => true)::text;
SELECT assert((SELECT (r->>'total_count')::int = 4 FROM public.get_my_owner_statements() r), 'the superseded statement leaves the default read');
SELECT assert((SELECT (r->>'total_count')::int = 5 FROM public.get_my_owner_statements(p_include_superseded => true) r), 'and stays readable on request');
SELECT assert((SELECT (r->>'total_count')::int = 1 AND r#>>'{statements,0,id}' = (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 's1b')
  AND jsonb_array_length(r#>'{statements,0,organization_links}') = 1
  AND r#>>'{statements,0,organization_links,0,recording_agent}' = 'fixture-agent-2'
  FROM public.get_my_owner_statements(p_organization_id => '20000000-0000-4000-8000-00000000000b') r), 'the corrected link is current; the withdrawn one is not listed');
SELECT assert((SELECT (r->>'total_count')::int = 0 FROM public.get_my_owner_statements(p_organization_id => '20000000-0000-4000-8000-00000000000a') r), 'the superseded link no longer selects the statement');
RESET ROLE;
SELECT assert((SELECT o.is_superseded AND o.superseded_at IS NOT NULL
    AND o.superseded_by = (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's1b')
  FROM public.vehicle_observations o WHERE o.id = (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's1')), 'the old statement points at its successor');
SELECT assert(NOT EXISTS (SELECT 1 FROM public.before_image b JOIN public.vehicle_observations o USING (id)
  WHERE b.body IS DISTINCT FROM to_jsonb(o) - ARRAY['is_superseded', 'superseded_by', 'superseded_at', 'lineage_chain']), 'no stored row was rewritten');
SELECT assert((SELECT count(*) FROM public.before_image) = (SELECT count(*) FROM public.vehicle_observations o JOIN public.before_image b USING (id)), 'no stored row was deleted');

-- 7b. A statement is withdrawn by a successor; nothing is deleted. ------------------------------------------------
SET ROLE authenticated;
INSERT INTO fx SELECT 'w3', public.record_owner_statement('30000000-0000-4000-8000-000000000006', 'Synthetic: I did not say the third message.',
  'stated in conversation on this date', 'fixture-agent', p_said_on => DATE '2026-11-17',
  p_supersedes => (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's3'), p_withdraw => true)::text;
SELECT assert((SELECT (r->>'total_count')::int = 3 FROM public.get_my_owner_statements() r), 'a withdrawn statement and its withdrawal leave the default read');
SELECT assert((SELECT (r->>'total_count')::int = 6 FROM public.get_my_owner_statements(p_include_superseded => true) r), 'both stay readable on request');
RESET ROLE;
SELECT assert((SELECT content_text = 'Synthetic third message.' AND is_superseded FROM public.vehicle_observations
  WHERE id = (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 's3')), 'the withdrawn words are kept');

-- 8. Rows are immutable and only the writers admit them, whatever the role. --------------------------------------
SELECT refuses($q$UPDATE public.vehicle_observations SET content_text = 'rewritten' WHERE extraction_method = 'owner_statement_v1'$q$, '23514');
SELECT refuses($q$UPDATE public.vehicle_observations SET vehicle_id = gen_random_uuid() WHERE extraction_method = 'owner_statement_v1'$q$, '23514');
SELECT refuses($q$UPDATE public.vehicle_observations SET submitted_by_user_id = '10000000-0000-4000-8000-000000000003' WHERE extraction_method = 'owner_statement_org_link_v1'$q$, '23514');
SELECT refuses($q$UPDATE public.vehicle_observations SET is_superseded = false, superseded_by = NULL WHERE extraction_method = 'owner_statement_v1' AND is_superseded$q$, '23514');
SELECT refuses($q$UPDATE public.vehicle_observations SET extraction_method = 'owner_statement_v1' WHERE extraction_method IS DISTINCT FROM 'owner_statement_v1'$q$, '23514');
SELECT refuses($q$INSERT INTO public.vehicle_observations(observed_at, source_id, source_identifier, kind, content_text, content_hash, structured_data,
    submitted_by_user_id, extraction_method, subject_type, subject_id)
  SELECT now(), s.id, 'hand', 'provenance', 'hand-made', md5('owner-statement:10000000-0000-4000-8000-000000000001:hand'),
    '{"claim_contract":"owner_statement_v1","speaker_user_id":"10000000-0000-4000-8000-000000000001","sign_status":"unsigned","is_public":false}',  -- everything right but the writer
    '10000000-0000-4000-8000-000000000001', 'owner_statement_v1', 'user', '10000000-0000-4000-8000-000000000001'
  FROM public.observation_sources s WHERE s.slug = 'owner-input'$q$, '23514');
SELECT refuses($q$INSERT INTO public.vehicle_observations(observed_at, source_id, source_identifier, kind, content_text, structured_data)
  SELECT now(), s.id, 'generic', 'provenance', 'generic intake naming the contract', '{"claim_contract":"owner_statement_org_link_v1"}'
  FROM public.observation_sources s WHERE s.slug = 'other-source'$q$, '23514');
-- An ordinary row is untouched by the triggers, and cannot be relabelled into a statement.
INSERT INTO public.vehicle_observations(observed_at, source_id, source_identifier, kind, content_text, content_hash)
  SELECT now(), s.id, 'ordinary', 'listing', 'ordinary synthetic row', 'h' FROM public.observation_sources s WHERE s.slug = 'other-source';
UPDATE public.vehicle_observations SET content_text = 'ordinary synthetic row, edited by its own rules' WHERE source_identifier = 'ordinary';
SELECT refuses($q$UPDATE public.vehicle_observations SET extraction_method = 'owner_statement_v1' WHERE source_identifier = 'ordinary'$q$, '23514');
-- Never deleted, and never taken out of the current read without a successor.
SELECT refuses($q$DELETE FROM public.vehicle_observations WHERE extraction_method = 'owner_statement_v1'$q$, '23514');
SELECT refuses($q$DELETE FROM public.vehicle_observations WHERE extraction_method = 'owner_statement_org_link_v1'$q$, '23514');
SELECT refuses($q$UPDATE public.vehicle_observations SET is_superseded = true WHERE extraction_method = 'owner_statement_v1' AND is_superseded IS NOT TRUE$q$, '23514');
SELECT refuses(format($q$UPDATE public.vehicle_observations SET is_superseded = true, superseded_by = %L, superseded_at = now() WHERE id = %L$q$,
  (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 's4'), (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 's2')), '23514');
-- The service role cannot forge a row even when it sets the writers' marker itself.
SET ROLE service_role;
SELECT refuses($q$WITH marker AS (SELECT set_config('nuke.owner_statement_writer', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true))
  INSERT INTO public.vehicle_observations(id, observed_at, source_id, source_identifier, kind, content_text, content_hash, structured_data,
    submitted_by_user_id, extraction_method, subject_type, subject_id)
  SELECT 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', now(), s.id, 'forged', 'provenance', 'forged words',
    md5('owner-statement:10000000-0000-4000-8000-000000000001:forged'),
    '{"claim_contract":"owner_statement_v1","speaker_user_id":"10000000-0000-4000-8000-000000000001","sign_status":"unsigned","is_public":false}',
    '10000000-0000-4000-8000-000000000001', 'owner_statement_v1', 'user', '10000000-0000-4000-8000-000000000001'
  FROM public.observation_sources s, marker WHERE s.slug = 'owner-input'$q$, '23514');
RESET ROLE;
-- A runaway caller is stopped: the link writer refuses past its hourly cap.
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000003', false), set_config('fixture.role', 'authenticated', false);
INSERT INTO fx SELECT 'cap', public.record_owner_statement(gen_random_uuid(), 'Synthetic cap fixture.', 'synthetic basis', 'fixture-agent')::text;
SELECT count(public.record_owner_statement_link(gen_random_uuid(), (SELECT (v::jsonb->>'statement_id')::uuid FROM fx WHERE k = 'cap'), 'Synthetic name ' || g, 'fixture-agent'))
  FROM generate_series(1, 600) g;
SELECT refuses(format($q$SELECT public.record_owner_statement_link(gen_random_uuid(), %L, 'One too many', 'fixture-agent')$q$, (SELECT v::jsonb->>'statement_id' FROM fx WHERE k = 'cap')), '54000');
RESET ROLE;

-- 9. The public contribution counter leaves private rows out (the function is replaced whole; exercised here).
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, uploaded_by uuid, owner_id uuid, created_by_user_id uuid);
CREATE TABLE public.vehicle_timeline_events(vehicle_id uuid, user_id uuid, event_date timestamptz);
CREATE TABLE public.business_timeline_events(created_by uuid, created_at timestamptz);
CREATE TABLE public.vehicle_images(user_id uuid, taken_at timestamptz);
CREATE TABLE public.profile_stats(user_id uuid PRIMARY KEY, vehicles_count int, total_vehicles int, total_images int,
  total_timeline_events int, total_contributions int, last_activity timestamptz, updated_at timestamptz);
INSERT INTO public.vehicle_observations(observed_at, source_id, source_identifier, kind, content_text, content_hash, submitted_by_user_id)
  SELECT now(), s.id, 'public-contribution', 'listing', 'ordinary submitted row', 'h2', '10000000-0000-4000-8000-000000000001'
  FROM public.observation_sources s WHERE s.slug = 'other-source';
SELECT assert((SELECT total_contributions = 1 FROM public.recompute_profile_stats('10000000-0000-4000-8000-000000000001')),
  'private statements and links do not move the public contribution count');

\echo 'owner statement writer -> private reader contract PASS'
