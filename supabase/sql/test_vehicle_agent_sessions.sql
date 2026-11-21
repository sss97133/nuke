-- Disposable synthetic contract; never production. Every id and sentence below is invented.
-- vehicle_agent_sessions_v1 (20261121043000): a garage agent turn is kept only with the account's consent for that car;
-- only the service role writes it; each account reads only its own sessions; anon reaches none of it.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.role', true), '') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('fixture.jwt', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- Live shapes (2026-11-20) of what the migration extends, reduced to the columns, constraints, trigger and policies it meets.
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, deleted_at timestamptz);
CREATE FUNCTION public.user_profile_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TABLE public.user_consents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_scope text NOT NULL, granted boolean NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  consent_text text, consent_version text, evidence_url text, evidence_method text, ip_address inet, user_agent text, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER trg_user_consents_updated_at BEFORE UPDATE ON public.user_consents FOR EACH ROW EXECUTE FUNCTION public.user_profile_touch_updated_at();
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_consents_owner_select ON public.user_consents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_consents_owner_modify ON public.user_consents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT ALL ON public.user_consents TO anon, authenticated, service_role;
CREATE TABLE public.vehicle_agents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL UNIQUE REFERENCES public.vehicles(id) ON DELETE CASCADE,
  agent_name text, memory jsonb DEFAULT '{}', last_active_at timestamptz, owner_user_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_agent_messages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_agent_id uuid NOT NULL REFERENCES public.vehicle_agents(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')), message_type text NOT NULL, content text, media_urls text[],
  from_user_id uuid REFERENCES auth.users(id), from_tech_link_id uuid, channel text, ai_generated boolean DEFAULT false,
  ai_model text, tokens_used integer, created_at timestamptz DEFAULT now());
ALTER TABLE public.vehicle_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_agent_messages ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.vehicle_agents, public.vehicle_agent_messages TO anon, authenticated, service_role;
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.vehicles VALUES ('30000000-0000-4000-8000-000000000001', NULL), ('30000000-0000-4000-8000-000000000002', NULL);

\ir ../migrations/20261121043000_vehicle_agent_sessions.sql
-- Idempotent: a second apply changes nothing.
\ir ../migrations/20261121043000_vehicle_agent_sessions.sql

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

-- 1. Off by default: the service writer stores nothing without consent. ----------------------------------------------
SET ROLE service_role;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'service_role', false);
SELECT assert((public.record_vehicle_agent_turn('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', gen_random_uuid(), 'synthetic question', 'synthetic reply', 'fixture-model')
  ->> 'stored')::boolean = false, 'no consent, nothing stored');
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_agent_messages), 'no rows without consent');
RESET ROLE;

-- 2. Only the service role writes a turn; anon reaches neither the toggle nor the reader. -----------------------------
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false), set_config('fixture.role', 'authenticated', false);
SELECT refuses($q$SELECT public.record_vehicle_agent_turn('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  gen_random_uuid(), gen_random_uuid(), 'q', 'r', 'm')$q$, '42501');
RESET ROLE;
SET ROLE anon;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'anon', false);
SELECT refuses($q$SELECT public.vehicle_agent_log('30000000-0000-4000-8000-000000000001')$q$, '42501');
SELECT refuses($q$SELECT public.set_vehicle_agent_log_consent('30000000-0000-4000-8000-000000000001', true)$q$, '42501');
RESET ROLE;

-- 3. The toggle: speaker from authentication; one live row; an anonymous sign-in is nobody. ---------------------------
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false), set_config('fixture.role', 'authenticated', false),
       set_config('fixture.jwt', '{"is_anonymous": true}', false);
SELECT refuses($q$SELECT public.set_vehicle_agent_log_consent('30000000-0000-4000-8000-000000000001', true)$q$, '42501');
SELECT set_config('fixture.jwt', '', false);
SELECT assert((public.set_vehicle_agent_log_consent('30000000-0000-4000-8000-000000000001', true) ->> 'keep')::boolean, 'kept on');
SELECT assert((public.set_vehicle_agent_log_consent('30000000-0000-4000-8000-000000000001', true) ->> 'keep')::boolean, 'on again is a no-op');
SELECT assert((SELECT count(*) = 1 FROM public.user_consents), 'one live row, own rows only');
SELECT assert((public.vehicle_agent_log('30000000-0000-4000-8000-000000000001') ->> 'keep')::boolean, 'reader says kept');
RESET ROLE;
SELECT refuses($q$INSERT INTO public.user_consents(user_id, consent_scope, granted) VALUES ('10000000-0000-4000-8000-000000000002', 'vehicle_agent_log', true)$q$, '23514');

-- 4. With consent the turn is stored; a retry replays; another car without consent stays empty. -----------------------
SET ROLE service_role;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'service_role', false);
SELECT assert((public.record_vehicle_agent_turn('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'synthetic question A', 'synthetic reply A', 'fixture-model')
  ->> 'replay')::boolean = false, 'stored');
SELECT assert((public.record_vehicle_agent_turn('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'synthetic question A', 'synthetic reply A', 'fixture-model')
  ->> 'replay')::boolean, 'a retry replays');
SELECT assert((public.record_vehicle_agent_turn('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
  gen_random_uuid(), gen_random_uuid(), 'q', 'r', 'm') ->> 'stored')::boolean = false, 'consent is per car');
SELECT assert((SELECT count(*) = 2 FROM public.vehicle_agent_messages), 'message and reply, once');
SELECT assert((SELECT ai_generated AND from_user_id IS NULL AND session_user_id = '10000000-0000-4000-8000-000000000001'
  FROM public.vehicle_agent_messages WHERE direction = 'outbound'), 'the reply is the agent''s, in the account''s session');
RESET ROLE;

-- 5. Another account with its own consent cannot write into this conversation, and reads only its own. -----------------
INSERT INTO public.user_consents(user_id, consent_scope, vehicle_id, granted)
  VALUES ('10000000-0000-4000-8000-000000000002', 'vehicle_agent_log', '30000000-0000-4000-8000-000000000001', true);
SET ROLE service_role;
SELECT set_config('fixture.role', 'service_role', false);
SELECT refuses($q$SELECT public.record_vehicle_agent_turn('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', gen_random_uuid(), 'q', 'r', 'm')$q$, '23514');
SELECT public.record_vehicle_agent_turn('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002', gen_random_uuid(), 'synthetic question B', 'synthetic reply B', 'fixture-model');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000002', false), set_config('fixture.role', 'authenticated', false);
SELECT assert((SELECT jsonb_array_length(v->'sessions') = 1 AND v->'sessions'->0->'turns'->0->>'words' = 'synthetic question B'
  FROM public.vehicle_agent_log('30000000-0000-4000-8000-000000000001') v), 'B reads only B');
SELECT assert((SELECT count(*) = 0 FROM public.vehicle_agent_messages), 'no direct read of the message table');
SELECT set_config('fixture.uid', '10000000-0000-4000-8000-000000000001', false);
SELECT assert((SELECT jsonb_array_length(v->'sessions') = 1 AND v->'sessions'->0->'turns'->1->>'words' = 'synthetic reply A'
  FROM public.vehicle_agent_log('30000000-0000-4000-8000-000000000001') v), 'A reads only A');

-- 6. Off: revoked_at stamped, the row stays, nothing more is stored. ---------------------------------------------------
SELECT assert((public.set_vehicle_agent_log_consent('30000000-0000-4000-8000-000000000001', false) ->> 'keep')::boolean = false, 'kept off');
RESET ROLE;
SELECT assert((SELECT revoked_at IS NOT NULL FROM public.user_consents WHERE user_id = '10000000-0000-4000-8000-000000000001'), 'revoked, kept');
SET ROLE service_role;
SELECT set_config('fixture.uid', '', false), set_config('fixture.role', 'service_role', false);
SELECT assert((public.record_vehicle_agent_turn('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', gen_random_uuid(), 'q', 'r', 'm') ->> 'stored')::boolean = false, 'off, nothing stored');
RESET ROLE;

\echo 'vehicle agent sessions consent -> writer -> reader contract PASS'
