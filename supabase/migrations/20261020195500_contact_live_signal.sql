-- Live contact threads without widening who can read them (2026-10-20). The web /messages page and a thread view
-- refetched only on reload or focus, so replies sat unseen.
--
-- Signal, not data: contact_requests and contact_messages stay private (no anon/authenticated grants, not in the
-- supabase_realtime publication); every read still goes through my_contact_requests / contact_thread_read. On each new
-- request, status change and message, a trigger sends one private Realtime broadcast per party to that party's own
-- topic, contact_inbox:<user id>, carrying only {request_id, kind} (kind: request | status | message). No body, request
-- message, counterpart, context or name is sent. The client treats it as "refetch through the reader".
--
-- Parties: the requester and contact_recipient_users() of the recipient (the user, an evidenced identity-bridge account,
-- or the recipient organization's active owners and members), resolved when the event happens.
--
-- Receive authorization (Supabase Realtime Authorization): one SELECT policy on realtime.messages admits a signed-in
-- user to the contact_inbox topic named by their own id and nothing else; the row's topic must match too, so even a
-- session that sets realtime.topic itself sees only its own rows. There is no INSERT policy, so no client can
-- send on these topics. realtime.send swallows its own errors (raises a warning), so a Realtime fault never fails a
-- writer.
-- Contract: supabase/sql/test_contact_live_signal.sql (PG17, realtime schema stubbed from the live definitions).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF to_regclass('public.contact_requests') IS NULL OR to_regclass('public.contact_messages') IS NULL
    OR to_regprocedure('public.contact_recipient_users(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'contact broker not installed';
  END IF;
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL OR to_regprocedure('realtime.topic()') IS NULL
    OR to_regclass('realtime.messages') IS NULL THEN
    RAISE EXCEPTION 'Supabase Realtime (realtime.send, realtime.topic, realtime.messages) not installed';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'realtime.messages'::regclass) THEN
    RAISE EXCEPTION 'realtime.messages must have row level security on';
  END IF;
  -- Policies are OR-ed: a topic-blind permissive read policy would admit anyone to every contact_inbox topic.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE' AND COALESCE(qual, '') !~ 'topic\(\)') THEN
    RAISE EXCEPTION 'realtime.messages has a read policy that does not check the topic';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename IN ('contact_requests', 'contact_messages')) THEN
    RAISE EXCEPTION 'contact tables must not be in a publication';
  END IF;
END $guard$;

CREATE FUNCTION public.contact_live_signal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r public.contact_requests%ROWTYPE;
  k text;
  u uuid;
BEGIN
  IF TG_TABLE_NAME = 'contact_messages' THEN
    SELECT * INTO r FROM public.contact_requests WHERE id = NEW.request_id;
    k := 'message';
  ELSIF TG_OP = 'INSERT' THEN
    r := NEW;
    k := 'request';
  ELSE
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
    r := NEW;
    k := 'status';
  END IF;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  FOR u IN
    SELECT DISTINCT p FROM unnest(array_append(
      public.contact_recipient_users(r.recipient_user_id, r.recipient_actor_id, r.recipient_organization_id),
      r.requester_user_id)) p WHERE p IS NOT NULL
  LOOP
    PERFORM realtime.send(jsonb_build_object('request_id', r.id, 'kind', k), 'contact', 'contact_inbox:' || u::text, true);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.contact_live_signal() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.contact_live_signal() IS
  'Trigger: a private Realtime broadcast {request_id, kind} to contact_inbox:<uid> for each party of a contact request. Never carries message text or names; clients refetch through my_contact_requests / contact_thread_read.';

CREATE TRIGGER contact_requests_live_signal AFTER INSERT OR UPDATE OF status ON public.contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.contact_live_signal();
CREATE TRIGGER contact_messages_live_signal AFTER INSERT ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.contact_live_signal();

DROP POLICY IF EXISTS "contact inbox signal: own topic only" ON realtime.messages;
CREATE POLICY "contact inbox signal: own topic only" ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.messages.extension = 'broadcast'
    AND (SELECT realtime.topic()) = 'contact_inbox:' || (SELECT auth.uid())::text
    AND realtime.messages.topic = (SELECT realtime.topic()));

COMMIT;
