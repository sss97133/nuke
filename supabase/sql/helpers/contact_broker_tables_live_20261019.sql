-- Contact broker tables and read helpers exactly as in migrations/20261019181500_contact_broker.sql (fixture for chains
-- that do not carry the readers that migration patches).
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

CREATE TABLE public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.contact_requests(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

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
