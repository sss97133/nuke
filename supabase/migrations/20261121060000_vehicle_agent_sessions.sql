-- vehicle_agent_sessions_v1: a per-vehicle log of the garage agent's sessions, kept only when the account turns it on
-- for that car.
--
-- Why. The garage card opens one agent per car and several can be open at once. The owner asked for "a dedicated
-- per-vehicle log book" of those sessions that "the user needs to allow". The agent's turns are a conversation, not a
-- claim: record_vehicle_statement (20261120100000) takes only owner, representative, seller_agent, shop or
-- previous_owner speaking an assertion, estimate or recollection, so a question or a model's reply cannot be stored
-- there honestly, and its reader shows role, kind and date of every row to anyone on a public car.
--
-- What this extends (no new table):
--   1. user_consents (privacy consent records; 0 rows on 2026-11-20) gains a nullable vehicle_id, so a consent can
--      scope to one car. Scope 'vehicle_agent_log' requires it. At most one live row per account, scope and car; turning
--      it off stamps revoked_at and keeps the row. The existing own-row policies already confine reads and writes to
--      auth.uid() = user_id.
--   2. vehicle_agent_messages (the per-vehicle agent's message log under vehicle_agents; row security on, no policy,
--      so only the service role and definer functions touch it) gains session_user_id (whose session the row belongs to;
--      an agent reply has no sender) and conversation_ref (one id per opened agent box).
--   3. set_vehicle_agent_log_consent(vehicle, keep): the toggle. Speaker from authentication only.
--   4. record_vehicle_agent_turn(...): the only writer of a garage session turn. Service role only (the vehicle-agent
--      edge function, after it has verified the caller's JWT and their tie to the car). It checks the live consent row
--      itself and stores nothing without it.
--   5. vehicle_agent_log(vehicle): the account's own kept sessions for one car, newest first, and whether keeping is on.
--      Never returns another account's turns.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Per-vehicle consent ------------------------------------------------------------------------------------------
-- No foreign key to vehicles: adding one takes SHARE ROW EXCLUSIVE on vehicles, and the first deploy of this change
-- (as 20261121043000, 2026-11-21 04:55Z, twice) hit the 5 s lock timeout behind 30-second vehicle writes and rolled
-- back. The two functions below check that the vehicle is current before they write or keep anything.
ALTER TABLE public.user_consents
  ADD COLUMN IF NOT EXISTS vehicle_id uuid;
ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_vehicle_agent_log_needs_vehicle;
ALTER TABLE public.user_consents ADD CONSTRAINT user_consents_vehicle_agent_log_needs_vehicle
  CHECK (consent_scope <> 'vehicle_agent_log' OR vehicle_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS user_consents_one_live_vehicle_scope
  ON public.user_consents (user_id, consent_scope, vehicle_id) WHERE revoked_at IS NULL AND vehicle_id IS NOT NULL;
COMMENT ON COLUMN public.user_consents.vehicle_id IS
  'The vehicle a consent is scoped to (NULL for account-wide scopes). Required for scope vehicle_agent_log.';

-- 2. Session columns on the per-vehicle agent message log ---------------------------------------------------------
ALTER TABLE public.vehicle_agent_messages
  ADD COLUMN IF NOT EXISTS session_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS conversation_ref uuid;
CREATE INDEX IF NOT EXISTS vehicle_agent_messages_session_idx
  ON public.vehicle_agent_messages (vehicle_agent_id, session_user_id, created_at) WHERE session_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicle_agent_messages_conversation_idx
  ON public.vehicle_agent_messages (conversation_ref) WHERE conversation_ref IS NOT NULL;
COMMENT ON COLUMN public.vehicle_agent_messages.session_user_id IS
  'The account whose agent session this row belongs to (both the inbound message and the agent''s reply). Written by record_vehicle_agent_turn.';
COMMENT ON COLUMN public.vehicle_agent_messages.conversation_ref IS
  'One id per opened agent box: the turns of one session share it. Written by record_vehicle_agent_turn.';

-- 3. The toggle -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_vehicle_agent_log_consent(p_vehicle_id uuid, p_keep boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $fn$
DECLARE
  uid uuid := auth.uid();
  live public.user_consents%ROWTYPE;
BEGIN
  IF uid IS NULL OR coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' THEN
    RAISE EXCEPTION 'sign in to choose what this car''s agent keeps' USING ERRCODE = '42501';
  END IF;
  IF p_vehicle_id IS NULL OR p_keep IS NULL THEN
    RAISE EXCEPTION 'a vehicle and a choice are required' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'an identified, current vehicle is required' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vehicle-agent-log:' || uid::text || ':' || p_vehicle_id::text, 0));
  SELECT * INTO live FROM public.user_consents c
   WHERE c.user_id = uid AND c.consent_scope = 'vehicle_agent_log' AND c.vehicle_id = p_vehicle_id AND c.revoked_at IS NULL;
  IF p_keep THEN
    IF NOT FOUND THEN
      INSERT INTO public.user_consents (user_id, consent_scope, vehicle_id, granted, consent_text, consent_version, evidence_method)
      VALUES (uid, 'vehicle_agent_log', p_vehicle_id, true,
              'Keep this car''s agent sessions in its log book.', 'vehicle_agent_log_v1', 'garage agent toggle')
      RETURNING * INTO live;
    END IF;
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'keep', true, 'since', live.granted_at);
  END IF;
  IF FOUND THEN
    UPDATE public.user_consents SET revoked_at = now() WHERE id = live.id;
  END IF;
  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'keep', false, 'since', NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.set_vehicle_agent_log_consent(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vehicle_agent_log_consent(uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.set_vehicle_agent_log_consent(uuid, boolean) IS
  'The garage agent''s "keep this car''s sessions" toggle. Caller from authentication only. On: one live user_consents row (scope vehicle_agent_log, this vehicle). Off: revoked_at stamped; the row stays.';

-- 4. The writer -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_vehicle_agent_turn(
  p_user_id uuid, p_vehicle_id uuid, p_conversation_ref uuid, p_turn_id uuid,
  p_message text, p_reply text, p_model text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $fn$
DECLARE
  v_agent uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'only the vehicle-agent function stores a session turn' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_vehicle_id IS NULL OR p_conversation_ref IS NULL OR p_turn_id IS NULL THEN
    RAISE EXCEPTION 'account, vehicle, conversation and turn are required' USING ERRCODE = '23514';
  END IF;
  IF nullif(btrim(p_message), '') IS NULL OR length(p_message) > 20000
     OR nullif(btrim(p_reply), '') IS NULL OR length(p_reply) > 100000 OR length(coalesce(p_model, '')) > 200 THEN
    RAISE EXCEPTION 'a turn is a message (at most 20000 characters) and a reply (at most 100000)' USING ERRCODE = '23514';
  END IF;
  -- Consent is read here, not trusted from the caller: no live row for this account and car, nothing is stored.
  IF NOT EXISTS (SELECT 1 FROM public.user_consents c
                  WHERE c.user_id = p_user_id AND c.consent_scope = 'vehicle_agent_log' AND c.vehicle_id = p_vehicle_id
                    AND c.granted IS TRUE AND c.revoked_at IS NULL) THEN
    RETURN jsonb_build_object('stored', false, 'reason', 'not kept');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('stored', false, 'reason', 'vehicle not current');
  END IF;
  INSERT INTO public.vehicle_agents (vehicle_id) VALUES (p_vehicle_id) ON CONFLICT (vehicle_id) DO NOTHING;
  SELECT a.id INTO v_agent FROM public.vehicle_agents a WHERE a.vehicle_id = p_vehicle_id;
  -- Earlier turns of this conversation must be this account's on this car.
  IF EXISTS (SELECT 1 FROM public.vehicle_agent_messages m
              WHERE m.conversation_ref = p_conversation_ref
                AND (m.vehicle_agent_id <> v_agent OR m.session_user_id IS DISTINCT FROM p_user_id)) THEN
    RAISE EXCEPTION 'conversation belongs to another session' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_agent_messages m WHERE m.id = p_turn_id) THEN
    RETURN jsonb_build_object('stored', true, 'replay', true, 'turn_id', p_turn_id);
  END IF;
  INSERT INTO public.vehicle_agent_messages
    (id, vehicle_agent_id, direction, message_type, content, from_user_id, channel, ai_generated, session_user_id, conversation_ref, created_at)
  VALUES
    (p_turn_id, v_agent, 'inbound', 'message', p_message, p_user_id, 'garage_agent', false, p_user_id, p_conversation_ref, clock_timestamp());
  INSERT INTO public.vehicle_agent_messages
    (vehicle_agent_id, direction, message_type, content, channel, ai_generated, ai_model, session_user_id, conversation_ref, created_at)
  VALUES
    (v_agent, 'outbound', 'response', p_reply, 'garage_agent', true, p_model, p_user_id, p_conversation_ref, clock_timestamp());
  UPDATE public.vehicle_agents SET last_active_at = now() WHERE id = v_agent;
  RETURN jsonb_build_object('stored', true, 'replay', false, 'turn_id', p_turn_id);
END $fn$;
REVOKE ALL ON FUNCTION public.record_vehicle_agent_turn(uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vehicle_agent_turn(uuid, uuid, uuid, uuid, text, text, text) TO service_role;
COMMENT ON FUNCTION public.record_vehicle_agent_turn(uuid, uuid, uuid, uuid, text, text, text) IS
  'Sole writer of a garage agent session turn (the account''s message and the agent''s reply) into vehicle_agent_messages. Service role only; stores nothing unless the account''s live vehicle_agent_log consent for this vehicle exists. p_turn_id makes a retry a replay.';

-- 5. The reader -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_agent_log(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  WITH me AS (
    SELECT auth.uid() AS uid
  ), consent AS (
    SELECT c.granted_at FROM public.user_consents c, me
     WHERE c.user_id = me.uid AND c.consent_scope = 'vehicle_agent_log' AND c.vehicle_id = p_vehicle_id
       AND c.granted IS TRUE AND c.revoked_at IS NULL
  ), turn_rows AS (
    SELECT m.conversation_ref, m.direction, m.content, m.ai_model, m.created_at
      FROM me
      JOIN public.vehicle_agents a ON a.vehicle_id = p_vehicle_id
      JOIN public.vehicle_agent_messages m ON m.vehicle_agent_id = a.id AND m.session_user_id = me.uid
     WHERE me.uid IS NOT NULL AND m.conversation_ref IS NOT NULL
     ORDER BY m.created_at DESC
     LIMIT 400
  ), sessions AS (
    SELECT r.conversation_ref, min(r.created_at) AS started_at,
           jsonb_agg(jsonb_build_object('role', CASE r.direction WHEN 'inbound' THEN 'user' ELSE 'assistant' END,
                                        'words', r.content, 'model', r.ai_model, 'at', r.created_at)
                     ORDER BY r.created_at) AS turns
      FROM turn_rows r GROUP BY r.conversation_ref
  )
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'keep', EXISTS (SELECT 1 FROM consent),
    'since', (SELECT granted_at FROM consent),
    'rule', 'Your own sessions with this car''s agent, kept only while you keep them on. Nobody else reads them.',
    'sessions', coalesce((SELECT jsonb_agg(jsonb_build_object('conversation_ref', s.conversation_ref,
                                                              'started_at', s.started_at, 'turns', s.turns)
                                           ORDER BY s.started_at DESC) FROM sessions s), '[]'::jsonb))
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_agent_log(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vehicle_agent_log(uuid) TO authenticated;
COMMENT ON FUNCTION public.vehicle_agent_log(uuid) IS
  'The caller''s own kept garage agent sessions for one vehicle (newest 400 rows, grouped by conversation_ref) and whether keeping is on. Reads only rows whose session_user_id is auth.uid().';

COMMIT;
