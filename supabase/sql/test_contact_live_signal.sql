-- Disposable PG17 only. Proves 20261020195500_contact_live_signal.sql: each new contact request, status change and
-- thread message sends one private broadcast per party to contact_inbox:<party id> carrying only {request_id, kind};
-- a stranger (including an admin) and anon receive nothing on a party's topic; no client can send on these topics; a
-- Realtime fault never fails a writer.
-- Fixture and prior state: the contact broker contract (its chain runs first). The realtime schema is stubbed from the
-- live definitions (realtime.send and realtime.topic bodies as deployed; messages columns as deployed, unpartitioned).
\set ON_ERROR_STOP on
\ir test_contact_broker.sql

CREATE SCHEMA realtime;
CREATE TABLE realtime.messages (
  topic text NOT NULL, extension text NOT NULL, payload jsonb, event text, private boolean DEFAULT false,
  updated_at timestamp without time zone NOT NULL DEFAULT now(), inserted_at timestamp without time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid());
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA realtime TO anon, authenticated;
GRANT SELECT, INSERT ON realtime.messages TO anon, authenticated;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('realtime.topic', true), '')::text $$;
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE generated_id uuid; final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();
    IF payload ? 'id' THEN final_payload := payload; ELSE final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id)); END IF;
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension) VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END $$;
GRANT EXECUTE ON FUNCTION realtime.topic() TO anon, authenticated;

-- A topic-blind read policy must stop the migration (policies are OR-ed).
CREATE POLICY blanket ON realtime.messages FOR SELECT TO authenticated USING (true);
\echo 'Expected: the migration below refuses (ERROR lines) while the blanket policy exists'
\set ON_ERROR_STOP off
\ir ../migrations/20261020195500_contact_live_signal.sql
\set ON_ERROR_STOP on
SELECT t_assert(to_regprocedure('public.contact_live_signal()') IS NULL, 'migration refuses while a topic-blind read policy exists');
DROP POLICY blanket ON realtime.messages;

\ir ../migrations/20261020195500_contact_live_signal.sql

CREATE FUNCTION public.t_inbox(p uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'contact_inbox:' || p::text $$;
GRANT EXECUTE ON FUNCTION public.t_inbox(uuid) TO anon, authenticated;
TRUNCATE realtime.messages;

SELECT t_assert(NOT has_function_privilege('anon', 'public.contact_live_signal()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.contact_live_signal()', 'EXECUTE')
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.contact_live_signal()'::regprocedure), 'trigger function is definer-only, not callable by clients');
SELECT t_assert((SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages') = 1
  AND (SELECT cmd = 'SELECT' AND roles = '{authenticated}' FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'),
  'one policy on realtime.messages: SELECT for authenticated (no INSERT policy)');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE tablename IN ('contact_requests', 'contact_messages')), 'contact tables stay out of every publication');

-- 1. A new request signals the requester and the recipient; nobody else.
INSERT INTO public.contact_requests(id, requester_user_id, recipient_user_id, context_kind, context_id, message)
  VALUES ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002',
    'profile', gen_random_uuid(), 'LIVE-REQUEST-TEXT please call');
SELECT t_assert((SELECT array_agg(topic ORDER BY topic) FROM realtime.messages)
    = ARRAY[t_inbox('00000000-0000-0000-0000-000000000002'), t_inbox('00000000-0000-0000-0000-000000000006')]
  AND (SELECT bool_and(private AND extension = 'broadcast' AND event = 'contact' AND payload->>'kind' = 'request'
    AND payload->>'request_id' = 'c1000000-0000-0000-0000-000000000001') FROM realtime.messages),
  'new request: one private broadcast to each party''s own topic');
TRUNCATE realtime.messages;

-- 2. Acceptance (through the writer) signals both; an update that leaves status alone signals nobody.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000002');
SELECT respond_contact_request('c1000000-0000-0000-0000-000000000001', true);
RESET ROLE;
SELECT t_assert((SELECT count(*) = 2 AND bool_and(payload->>'kind' = 'status') FROM realtime.messages), 'status change signals both parties');
TRUNCATE realtime.messages;
UPDATE public.contact_requests SET message = message WHERE id = 'c1000000-0000-0000-0000-000000000001';
SELECT t_assert((SELECT count(*) FROM realtime.messages) = 0, 'an update that does not change status sends nothing');

-- 3. A message signals both parties and carries no body, request text, names or context.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000006');
SELECT post_contact_message('c1000000-0000-0000-0000-000000000001', 'LIVE-SECRET-BODY meet at 10');
RESET ROLE;
SELECT t_assert((SELECT array_agg(topic ORDER BY topic) FROM realtime.messages)
    = ARRAY[t_inbox('00000000-0000-0000-0000-000000000002'), t_inbox('00000000-0000-0000-0000-000000000006')]
  AND (SELECT bool_and(payload->>'kind' = 'message') FROM realtime.messages), 'message signals exactly the two parties');
SELECT t_assert((SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(payload) k) = ARRAY['id', 'kind', 'request_id']
    AND payload::text !~ '(LIVE-SECRET-BODY|LIVE-REQUEST-TEXT|handle|label|name|context|body|message_id)') FROM realtime.messages),
  'payload is {id, request_id, kind} only: no body, request text, names or context');

-- 4. An organization recipient: the requester and the organization's active owners and members, resolved now.
TRUNCATE realtime.messages;
INSERT INTO public.contact_requests(id, requester_user_id, recipient_organization_id, context_kind, context_id, message)
  VALUES ('c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '0a000000-0000-0000-0000-000000000001',
    'profile', gen_random_uuid(), 'org question');
SELECT t_assert((SELECT array_agg(topic ORDER BY topic) FROM realtime.messages) = (SELECT array_agg(t_inbox(u) ORDER BY t_inbox(u)) FROM unnest(array_append(
    public.contact_recipient_users(NULL, NULL, '0a000000-0000-0000-0000-000000000001'), '00000000-0000-0000-0000-000000000002'::uuid)) u)
  AND (SELECT count(*) FROM realtime.messages) >= 2
  AND NOT EXISTS (SELECT 1 FROM realtime.messages WHERE topic = t_inbox('00000000-0000-0000-0000-000000000005')),
  'organization recipient: requester plus the org''s owners and members, not the admin');

-- 5. Receive authorization, as Realtime checks it (role + claims + realtime.topic, then a read of realtime.messages).
TRUNCATE realtime.messages;
SELECT realtime.send('{"request_id":"c1000000-0000-0000-0000-000000000001","kind":"message"}', 'contact', t_inbox('00000000-0000-0000-0000-000000000002'), true);
SELECT realtime.send('{"request_id":"c1000000-0000-0000-0000-000000000001","kind":"message"}', 'contact', t_inbox('00000000-0000-0000-0000-000000000006'), true);
SELECT realtime.send('{"x":1}', 'other', 'some_public_room', false);
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000002');
SELECT set_config('realtime.topic', t_inbox('00000000-0000-0000-0000-000000000002'), false);
SELECT t_assert((SELECT count(*) FROM realtime.messages) = 1 AND (SELECT topic FROM realtime.messages) = t_inbox('00000000-0000-0000-0000-000000000002'),
  'a party receives on their own topic, and only that topic''s rows');
SELECT set_config('realtime.topic', t_inbox('00000000-0000-0000-0000-000000000006'), false);
SELECT t_assert((SELECT count(*) FROM realtime.messages) = 0, 'a party cannot join the other party''s topic');
SELECT t_as('00000000-0000-0000-0000-000000000005');
SELECT t_assert((SELECT count(*) FROM realtime.messages) = 0, 'an admin stranger cannot join a party''s topic');
SELECT set_config('realtime.topic', t_inbox('00000000-0000-0000-0000-000000000005'), false);
SELECT t_assert((SELECT count(*) FROM realtime.messages) = 0, 'a stranger''s own topic shows nothing of others (row topic must match)');
SELECT set_config('realtime.topic', 'some_public_room', false);
SELECT t_assert((SELECT count(*) FROM realtime.messages) = 0, 'the policy admits nothing beyond contact_inbox topics');
SELECT set_config('realtime.topic', t_inbox('00000000-0000-0000-0000-000000000002'), false);
SELECT t_assert(t_refused($q$INSERT INTO realtime.messages(topic, extension, payload, event, private)
  VALUES (t_inbox('00000000-0000-0000-0000-000000000002'), 'broadcast', '{"kind":"message"}', 'contact', true)$q$), 'a stranger cannot send on a party''s topic');
SELECT t_as('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_refused($q$INSERT INTO realtime.messages(topic, extension, payload, event, private)
  VALUES (t_inbox('00000000-0000-0000-0000-000000000002'), 'broadcast', '{"kind":"message"}', 'contact', true)$q$), 'not even a party can send on contact topics');
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('realtime.topic', t_inbox('00000000-0000-0000-0000-000000000002'), false);
SELECT t_assert((SELECT count(*) FROM realtime.messages) = 0, 'anon receives nothing');
RESET ROLE;
SELECT set_config('realtime.topic', '', false);

-- 6. A Realtime fault never fails a writer.
CREATE FUNCTION realtime.t_down() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'realtime down'; END $$;
CREATE TRIGGER t_down BEFORE INSERT ON realtime.messages FOR EACH ROW EXECUTE FUNCTION realtime.t_down();
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000002');
SELECT t_assert((SELECT post_contact_message('c1000000-0000-0000-0000-000000000001', 'still delivered') ? 'message_id'), 'writer succeeds when Realtime is unavailable');
RESET ROLE;
DROP TRIGGER t_down ON realtime.messages;
SELECT t_assert((SELECT count(*) FROM public.contact_messages WHERE request_id = 'c1000000-0000-0000-0000-000000000001') = 2, 'the message was recorded');
