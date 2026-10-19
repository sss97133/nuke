-- Contact broker (doctrine: "we facilitate contact between users"; contact fields are never exposed). In-app only:
-- nothing here sends e-mail, SMS or push. Searched first (2026-10-19): contact_inbox and agent_messages are e-mail
-- intake/agents, notifications/user_notifications are system notices; none holds user-to-user requests and threads.
--
--   contact_requests: requester, one recipient (user | actor through an evidenced identity bridge | organization via
--     active owners/members), context (work_order | requirement | vehicle | profile), a short message, status
--     pending/accepted/declined/withdrawn with clocks. With no explicit recipient, a work order or requirement context
--     routes to the work order's customer (or its shop when the requester is the customer), without telling the
--     requester who that is beyond a public handle.
--   contact_messages: the thread after acceptance; author, body, clock; immutable.
-- Both tables are private (RLS on, no anon/authenticated grants); every read and write goes through the functions
-- below. Bodies are personal communication: visible only to the two parties (and the recipient organization's
-- owners/members). Requests are limited to 10 per requester per rolling day, messages to 200 per thread per day.
-- provider_profile_read, work_order_statement_read and open_requirements_read now offer the contact action to signed-in
-- viewers who are not its subject (one expression changed in each live definition, guarded by its exact hash).
-- Contract: supabase/sql/test_contact_broker.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc WHERE oid = 'public.provider_profile_read(uuid,uuid)'::regprocedure)
        IS DISTINCT FROM '3l2+lh7Tj6TduZpsEst3x5v9UZUJsDiZYGUyUd9/2IQ='
    OR (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc WHERE oid = 'public.work_order_statement_read(uuid,uuid,text)'::regprocedure)
        IS DISTINCT FROM 'Aj5AZS9NyLaF5DGIQWvTyMHfx1CwaNnvalfWWA5NLlA='
    OR (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc WHERE oid = 'public.open_requirements_read(uuid,integer,text)'::regprocedure)
        IS DISTINCT FROM 'mNAHSMBH/RH6xHBKFHwcvy9isamJiL7YAt3QAoiAQIQ=' THEN
    RAISE EXCEPTION 'A reader differs from its reviewed definition; contact action not applied';
  END IF;
  IF to_regclass('public.contact_requests') IS NOT NULL OR to_regclass('public.contact_messages') IS NOT NULL THEN
    RAISE EXCEPTION 'contact tables already exist';
  END IF;
END $guard$;

CREATE TABLE public.contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
  recipient_organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  context_kind text NOT NULL CHECK (context_kind IN ('work_order','requirement','vehicle','profile')),
  context_id uuid NOT NULL,
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  responded_at timestamptz,
  responded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  withdrawn_at timestamptz,
  CHECK (num_nonnulls(recipient_user_id, recipient_actor_id, recipient_organization_id) = 1),
  CHECK ((status IN ('accepted','declined')) = (responded_at IS NOT NULL)),
  CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL))
);
CREATE INDEX contact_requests_requester ON public.contact_requests(requester_user_id, created_at DESC);
CREATE INDEX contact_requests_recipient_user ON public.contact_requests(recipient_user_id) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX contact_requests_recipient_actor ON public.contact_requests(recipient_actor_id) WHERE recipient_actor_id IS NOT NULL;
CREATE INDEX contact_requests_recipient_org ON public.contact_requests(recipient_organization_id) WHERE recipient_organization_id IS NOT NULL;
CREATE UNIQUE INDEX contact_requests_one_pending ON public.contact_requests(requester_user_id,
  COALESCE(recipient_user_id, recipient_actor_id, recipient_organization_id), context_kind, context_id) WHERE status = 'pending';

CREATE TABLE public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.contact_requests(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX contact_messages_request ON public.contact_messages(request_id, created_at, id);

CREATE FUNCTION public.contact_messages_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Contact messages are immutable'; END $$;
CREATE TRIGGER contact_messages_immutable BEFORE UPDATE ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.contact_messages_immutable();
REVOKE ALL ON FUNCTION public.contact_messages_immutable() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_requests, public.contact_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_requests, public.contact_messages TO service_role;
CREATE POLICY contact_requests_service_read ON public.contact_requests FOR SELECT TO service_role USING (true);
CREATE POLICY contact_messages_service_read ON public.contact_messages FOR SELECT TO service_role USING (true);
COMMENT ON TABLE public.contact_requests IS 'Brokered contact requests between users (in-app only; no outbound messaging). Private: read and written only through request_contact, respond_contact_request, withdraw_contact_request, my_contact_requests, contact_thread_read.';
COMMENT ON TABLE public.contact_messages IS 'Immutable in-app thread messages of an accepted contact request; visible only to its parties. Writer: post_contact_message.';

-- Users who may receive and answer a request for a recipient.
CREATE FUNCTION public.contact_recipient_users(p_user uuid, p_actor uuid, p_org uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(DISTINCT u) FILTER (WHERE u IS NOT NULL), '{}') FROM (
    SELECT p_user AS u
    UNION ALL SELECT c.user_id FROM public.account_link_claims c
      WHERE p_actor IS NOT NULL AND c.actor_id = p_actor AND c.status = 'approved'
        AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign')
    UNION ALL SELECT bo.owner_id FROM public.business_ownership bo WHERE p_org IS NOT NULL AND bo.business_id = p_org AND bo.status = 'active'
    UNION ALL SELECT oc.user_id FROM public.organization_contributors oc WHERE p_org IS NOT NULL AND oc.organization_id = p_org AND oc.status = 'active') x
$$;

CREATE FUNCTION public.contact_counterpart_label(p_user uuid, p_actor uuid, p_org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(public.platform_organization_label(p_org), public.platform_actor_label(p_actor), public.platform_person_label(p_user))
$$;

CREATE FUNCTION public.request_contact(p_context_kind text, p_context_id uuid, p_message text,
  p_recipient_user_id uuid DEFAULT NULL, p_recipient_actor_id uuid DEFAULT NULL, p_recipient_organization_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  uid uuid := auth.uid();
  r_user uuid := p_recipient_user_id;
  r_actor uuid := p_recipient_actor_id;
  r_org uuid := p_recipient_organization_id;
  w record;
  recent integer;
  new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  IF p_context_kind IS NULL OR p_context_kind NOT IN ('work_order','requirement','vehicle','profile') THEN
    RAISE EXCEPTION 'Unknown contact context' USING ERRCODE = '22023';
  END IF;
  IF num_nonnulls(r_user, r_actor, r_org) > 1 THEN RAISE EXCEPTION 'At most one recipient' USING ERRCODE = '22023'; END IF;
  IF length(btrim(COALESCE(p_message, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Message must be 1 to 500 characters' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO recent FROM public.contact_requests WHERE requester_user_id = uid AND created_at > clock_timestamp() - interval '1 day';
  IF recent >= 10 THEN RAISE EXCEPTION 'Contact request limit reached (10 per day)' USING ERRCODE = '54000'; END IF;

  IF p_context_kind IN ('work_order','requirement') THEN
    SELECT wo.id, wo.vehicle_id, wo.customer_id, wo.organization_id INTO w FROM public.work_orders wo
      WHERE wo.id = CASE WHEN p_context_kind = 'work_order' THEN p_context_id
        ELSE (SELECT rq.work_order_id FROM public.work_order_resource_requirements rq WHERE rq.id = p_context_id) END;
    IF NOT FOUND OR NOT (public.work_order_vehicle_open(w.vehicle_id)
        OR cardinality(COALESCE((SELECT s.slots FROM public.work_order_viewer_slots(uid, w.id) s), '{}'::text[])) > 0) THEN
      RAISE EXCEPTION 'Contact context unavailable';
    END IF;
    IF num_nonnulls(r_user, r_actor, r_org) = 0 THEN
      IF w.customer_id IS NOT NULL AND w.customer_id <> uid THEN r_user := w.customer_id; ELSE r_org := w.organization_id; END IF;
    END IF;
  ELSIF p_context_kind = 'vehicle' THEN
    SELECT v.id, v.owner_id, v.user_id INTO w FROM public.vehicles v WHERE v.id = p_context_id AND v.is_public IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contact context unavailable'; END IF;
    IF num_nonnulls(r_user, r_actor, r_org) = 0 THEN r_user := COALESCE(w.owner_id, w.user_id); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_context_id AND p.is_public IS TRUE)
       AND NOT EXISTS (SELECT 1 FROM public.actors a WHERE a.id = p_context_id) THEN
      RAISE EXCEPTION 'Contact context unavailable';
    END IF;
    IF num_nonnulls(r_user, r_actor, r_org) = 0 THEN r_user := p_context_id; END IF;
  END IF;

  IF r_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r_user) THEN r_user := NULL; END IF;
  IF num_nonnulls(r_user, r_actor, r_org) <> 1 OR cardinality(public.contact_recipient_users(r_user, r_actor, r_org)) = 0 THEN
    RAISE EXCEPTION 'No reachable recipient for this contact';
  END IF;
  IF uid = ANY (public.contact_recipient_users(r_user, r_actor, r_org)) THEN
    RAISE EXCEPTION 'You cannot contact yourself' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.contact_requests(requester_user_id, recipient_user_id, recipient_actor_id, recipient_organization_id,
    context_kind, context_id, message)
  VALUES (uid, r_user, r_actor, r_org, p_context_kind, p_context_id, btrim(p_message))
  ON CONFLICT DO NOTHING RETURNING id INTO new_id;
  IF new_id IS NULL THEN RAISE EXCEPTION 'A pending request to this recipient about this already exists'; END IF;
  RETURN jsonb_build_object('request_id', new_id, 'status', 'pending',
    'recipient', public.contact_counterpart_label(r_user, r_actor, r_org), 'delivery', 'in_app');
END $$;

CREATE FUNCTION public.respond_contact_request(p_id uuid, p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE uid uuid := auth.uid(); r public.contact_requests%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  IF p_accept IS NULL THEN RAISE EXCEPTION 'Accept or decline required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.contact_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT (uid = ANY (public.contact_recipient_users(r.recipient_user_id, r.recipient_actor_id, r.recipient_organization_id))) THEN
    RAISE EXCEPTION 'Contact request unavailable';
  END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Contact request is %', r.status; END IF;
  UPDATE public.contact_requests SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
    responded_at = clock_timestamp(), responded_by_user_id = uid WHERE id = p_id;
  RETURN jsonb_build_object('request_id', p_id, 'status', CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END);
END $$;

CREATE FUNCTION public.withdraw_contact_request(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE uid uuid := auth.uid(); r public.contact_requests%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.contact_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.requester_user_id <> uid THEN RAISE EXCEPTION 'Contact request unavailable'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Contact request is %', r.status; END IF;
  UPDATE public.contact_requests SET status = 'withdrawn', withdrawn_at = clock_timestamp() WHERE id = p_id;
  RETURN jsonb_build_object('request_id', p_id, 'status', 'withdrawn');
END $$;

CREATE FUNCTION public.post_contact_message(p_request_id uuid, p_body text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE uid uuid := auth.uid(); r public.contact_requests%ROWTYPE; recent integer; new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.contact_requests WHERE id = p_request_id;
  IF NOT FOUND OR NOT (uid = r.requester_user_id
      OR uid = ANY (public.contact_recipient_users(r.recipient_user_id, r.recipient_actor_id, r.recipient_organization_id))) THEN
    RAISE EXCEPTION 'Contact request unavailable';
  END IF;
  IF r.status <> 'accepted' THEN RAISE EXCEPTION 'Messages open after the request is accepted'; END IF;
  IF length(btrim(COALESCE(p_body, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Message must be 1 to 2000 characters' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO recent FROM public.contact_messages WHERE request_id = p_request_id AND created_at > clock_timestamp() - interval '1 day';
  IF recent >= 200 THEN RAISE EXCEPTION 'Thread message limit reached (200 per day)' USING ERRCODE = '54000'; END IF;
  INSERT INTO public.contact_messages(request_id, author_user_id, body) VALUES (p_request_id, uid, btrim(p_body)) RETURNING id INTO new_id;
  RETURN jsonb_build_object('message_id', new_id, 'request_id', p_request_id, 'delivery', 'in_app');
END $$;

CREATE FUNCTION public.contact_request_item(r public.contact_requests, p_viewer uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('request_id', r.id,
    'direction', CASE WHEN r.requester_user_id = p_viewer THEN 'outgoing' ELSE 'incoming' END,
    'counterpart', CASE WHEN r.requester_user_id = p_viewer
      THEN public.contact_counterpart_label(r.recipient_user_id, r.recipient_actor_id, r.recipient_organization_id)
      ELSE public.platform_person_label(r.requester_user_id) END,
    'recipient_kind', CASE WHEN r.recipient_organization_id IS NOT NULL THEN 'organization'
      WHEN r.recipient_actor_id IS NOT NULL THEN 'actor' ELSE 'user' END,
    'context', jsonb_build_object('kind', r.context_kind, 'id', r.context_id,
      'label', CASE WHEN r.context_kind = 'work_order' THEN public.work_order_open_header(r.context_id, false)->>'display_title'
        WHEN r.context_kind = 'requirement' THEN (SELECT rq.requirement_kind || ': ' || rq.description FROM public.work_order_resource_requirements rq WHERE rq.id = r.context_id)
        WHEN r.context_kind = 'vehicle' THEN (SELECT NULLIF(concat_ws(' ', v.year, v.make, v.model), '') FROM public.vehicles v WHERE v.id = r.context_id) END),
    'message', r.message, 'status', r.status, 'created_at', r.created_at, 'responded_at', r.responded_at, 'withdrawn_at', r.withdrawn_at,
    'thread', jsonb_build_object('messages', (SELECT count(*) FROM public.contact_messages m WHERE m.request_id = r.id),
      'last_message_at', (SELECT max(m.created_at) FROM public.contact_messages m WHERE m.request_id = r.id)),
    'actions', to_jsonb(array_remove(ARRAY[
      CASE WHEN r.status = 'pending' AND r.requester_user_id <> p_viewer THEN 'respond_contact_request' END,
      CASE WHEN r.status = 'pending' AND r.requester_user_id = p_viewer THEN 'withdraw_contact_request' END,
      CASE WHEN r.status = 'accepted' THEN 'post_contact_message' END], NULL)))
$$;

CREATE FUNCTION public.my_contact_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE uid uuid := auth.uid(); incoming jsonb; outgoing jsonb; sent_today integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(public.contact_request_item(r, uid) ORDER BY r.created_at DESC, r.id), '[]'::jsonb) INTO incoming
    FROM public.contact_requests r
    WHERE r.requester_user_id <> uid AND uid = ANY (public.contact_recipient_users(r.recipient_user_id, r.recipient_actor_id, r.recipient_organization_id));
  SELECT COALESCE(jsonb_agg(public.contact_request_item(r, uid) ORDER BY r.created_at DESC, r.id), '[]'::jsonb) INTO outgoing
    FROM public.contact_requests r WHERE r.requester_user_id = uid;
  SELECT count(*) INTO sent_today FROM public.contact_requests WHERE requester_user_id = uid AND created_at > clock_timestamp() - interval '1 day';
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', public.viewer_identity_bridge(uid), false),
    'as_of', statement_timestamp(), 'incoming', incoming, 'outgoing', outgoing,
    'limits', jsonb_build_object('requests_per_day', 10, 'requests_sent_last_day', sent_today, 'messages_per_thread_per_day', 200),
    'delivery', 'in_app only; no e-mail, SMS or push', 'contact_fields', 'never exposed');
END $$;

CREATE FUNCTION public.contact_thread_read(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE uid uuid := auth.uid(); r public.contact_requests%ROWTYPE; msgs jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.contact_requests WHERE id = p_request_id;
  IF NOT FOUND OR NOT (uid = r.requester_user_id
      OR uid = ANY (public.contact_recipient_users(r.recipient_user_id, r.recipient_actor_id, r.recipient_organization_id))) THEN
    RAISE EXCEPTION 'Contact request unavailable';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('message_id', m.id,
      'author', CASE WHEN m.author_user_id = uid THEN jsonb_build_object('kind', 'you') ELSE public.platform_person_label(m.author_user_id) END,
      'body', m.body, 'created_at', m.created_at) ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO msgs FROM public.contact_messages m WHERE m.request_id = r.id;
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', public.viewer_identity_bridge(uid), false),
    'as_of', statement_timestamp(), 'request', public.contact_request_item(r, uid), 'messages', msgs,
    'can_post', r.status = 'accepted', 'visibility', 'the two parties only (and the recipient organization''s owners and members)');
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['contact_recipient_users(uuid,uuid,uuid)','contact_counterpart_label(uuid,uuid,uuid)',
      'contact_request_item(public.contact_requests,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['request_contact(text,uuid,text,uuid,uuid,uuid)','respond_contact_request(uuid,boolean)',
      'withdraw_contact_request(uuid)','post_contact_message(uuid,text)','my_contact_requests()','contact_thread_read(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Offer the contact action in the open readers: one expression per live definition, replaced in place.
DO $apply$
DECLARE
  def text;
  old_ppr constant text := $o$'contact', jsonb_build_object('action', 'contact_via_nuke', 'available', false,
      'basis', 'contact between users is brokered by Nuke; contact fields are never exposed'),$o$;
  new_ppr constant text := $n$'contact', jsonb_build_object('action', 'contact_via_nuke',
      'available', uid IS NOT NULL AND NOT self AND cardinality(public.contact_recipient_users(p_user_id, p_actor_id, NULL)) > 0
        AND NOT (uid = ANY (public.contact_recipient_users(p_user_id, p_actor_id, NULL))),
      'request', jsonb_build_object('writer', 'request_contact', 'context_kind', 'profile', 'context_id', COALESCE(p_user_id, p_actor_id),
        'recipient_user_id', p_user_id, 'recipient_actor_id', p_actor_id),
      'basis', 'contact between users is brokered by Nuke; contact fields are never exposed'),$n$;
  new_stmt constant text := $n$'contact', jsonb_build_object('action', 'contact_via_nuke',
      'available', uid IS NOT NULL AND NOT COALESCE(any_party, false),
      'request', jsonb_build_object('writer', 'request_contact', 'context_kind', 'work_order', 'context_id', wos->0->>'id'),
      'basis', 'contact between users is brokered by Nuke; contact fields are never exposed'),$n$;
  old_req constant text := $o$'contact', jsonb_build_object('action', 'contact_via_nuke', 'available', false));$o$;
  new_req constant text := $n$'contact', jsonb_build_object('action', 'contact_via_nuke', 'available', uid IS NOT NULL,
      'request', jsonb_build_object('writer', 'request_contact', 'context_kind', 'requirement', 'context_id', 'requirement_id of the row'),
      'basis', 'contact between users is brokered by Nuke; contact fields are never exposed'));$n$;
BEGIN
  def := pg_get_functiondef('public.provider_profile_read(uuid,uuid)'::regprocedure);
  IF (length(def) - length(replace(def, old_ppr, ''))) / length(old_ppr) <> 1 THEN RAISE EXCEPTION 'provider_profile_read contact expression not found once'; END IF;
  EXECUTE replace(def, old_ppr, new_ppr);
  def := pg_get_functiondef('public.work_order_statement_read(uuid,uuid,text)'::regprocedure);
  IF (length(def) - length(replace(def, old_ppr, ''))) / length(old_ppr) <> 1 THEN RAISE EXCEPTION 'work_order_statement_read contact expression not found once'; END IF;
  EXECUTE replace(def, old_ppr, new_stmt);
  def := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  IF (length(def) - length(replace(def, old_req, ''))) / length(old_req) <> 1 THEN RAISE EXCEPTION 'open_requirements_read contact expression not found once'; END IF;
  EXECUTE replace(def, old_req, new_req);
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
