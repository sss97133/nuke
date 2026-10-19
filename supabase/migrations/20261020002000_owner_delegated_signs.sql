-- Owner-delegated signatures: a public register of every Sign an agent executes on the owner's behalf.
--
-- Owner authorization, 2026-10-19 09:09 PT (16:09Z): "dude its fine you need to be running and making tests. you can sign
-- on my behalf and register as such". It covers Sign steps executed AS the owner (the platform's only owner/admin
-- account), each registered as agent-signed on his behalf. It does not cover messaging third parties, moving money,
-- acting as anyone else or weakening protections.
--
--   owner_delegated_signs: append-only, service-only. One row per delegated Sign: rpc, args_summary (ids and counts,
--     never personal information), result_ref (the row the Sign wrote), the authorization quote and clock, the agent
--     session. The only permitted change is rolled_back false -> true (a later reversal of that Sign); no delete.
--   owner_delegation_owner_id(): the owner account the authorization names.
--   owner_delegated_sign_register(...): service-only. The agent calls it AFTER the Sign, in the SAME transaction, so the
--     row commits iff the Sign commits; it refuses when the transaction has written nothing yet.
--   owner_delegated_sign_record(...): internal (no grants); writers that sign as the owner register through it.
--   owner_delegated_signs_read(): open. Counts by rpc, sign clocks and the authorization clock; no args, no refs.
--   is_owner_delegated_sign(rpc, ref): open. Lets a reader say "signed by an agent on the owner's behalf".
-- Contract: supabase/sql/test_owner_delegated_signs.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.owner_delegation_owner_id() RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$ SELECT '0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid $$;
COMMENT ON FUNCTION public.owner_delegation_owner_id() IS 'The owner account named by the 2026-10-19 16:09Z delegated-sign authorization.';

CREATE FUNCTION public.owner_delegated_args_clean(p_args jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_typeof(p_args) = 'object' AND length(p_args::text) <= 4000
    AND p_args::text !~* '"[^"]*(e-?mail|phone|name|address|street|zip|postal|licen[cs]e|birth)[^"]*"\s*:'
    AND NOT EXISTS (SELECT 1 FROM jsonb_path_query(p_args, 'strict $.** ? (@.type() == "string")') s(v)
      WHERE v #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (v #>> '{}' ~ '@' OR v #>> '{}' ~ '\+?[0-9][0-9 ().-]{8,}[0-9]'))
$$;

CREATE TABLE public.owner_delegated_signs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
    CHECK (owner_user_id = public.owner_delegation_owner_id()),
  rpc text NOT NULL CHECK (rpc ~ '^[a-z_][a-z0-9_]{0,62}$'),
  args_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.owner_delegated_args_clean(args_summary)),
  result_ref text CHECK (result_ref IS NULL OR length(result_ref) BETWEEN 1 AND 200),
  authorization_quote text NOT NULL CHECK (length(btrim(authorization_quote)) BETWEEN 1 AND 1000),
  authorized_at timestamptz NOT NULL,
  agent_session text NOT NULL CHECK (length(btrim(agent_session)) BETWEEN 1 AND 200),
  rolled_back boolean NOT NULL DEFAULT false,
  CHECK (authorized_at <= signed_at)
);
CREATE INDEX owner_delegated_signs_ref ON public.owner_delegated_signs (rpc, result_ref);
ALTER TABLE public.owner_delegated_signs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_delegated_signs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.owner_delegated_signs TO service_role;
COMMENT ON TABLE public.owner_delegated_signs IS
  'Append-only register of Signs an agent executed on the owner''s behalf (authorization 2026-10-19 16:09Z). Written only by owner_delegated_sign_register / owner-delegated writers, in the Sign''s own transaction. Only rolled_back false->true may change.';

CREATE FUNCTION public.owner_delegated_signs_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'rolled_back') = (to_jsonb(NEW) - 'rolled_back')
      AND OLD.rolled_back IS FALSE AND NEW.rolled_back IS TRUE THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'owner_delegated_signs is append-only (only rolled_back false -> true may change)';
END $$;
CREATE TRIGGER owner_delegated_signs_append_only BEFORE UPDATE OR DELETE ON public.owner_delegated_signs
  FOR EACH ROW EXECUTE FUNCTION public.owner_delegated_signs_append_only();
CREATE TRIGGER owner_delegated_signs_no_truncate BEFORE TRUNCATE ON public.owner_delegated_signs
  FOR EACH STATEMENT EXECUTE FUNCTION public.owner_delegated_signs_append_only();

CREATE FUNCTION public.owner_delegated_sign_record(p_rpc text, p_args_summary jsonb, p_result_ref text,
  p_authorization_quote text, p_agent_session text, p_authorized_at timestamptz DEFAULT '2026-10-19 16:09:00+00')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = public.owner_delegation_owner_id() AND au.is_active) THEN
    RAISE EXCEPTION 'The delegating owner must be an active admin';
  END IF;
  INSERT INTO public.owner_delegated_signs (owner_user_id, rpc, args_summary, result_ref, authorization_quote, authorized_at, agent_session)
  VALUES (public.owner_delegation_owner_id(), p_rpc, COALESCE(p_args_summary, '{}'::jsonb), p_result_ref, p_authorization_quote,
    p_authorized_at, p_agent_session)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.owner_delegated_sign_record(text, jsonb, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.owner_delegated_sign_register(p_rpc text, p_args_summary jsonb, p_result_ref text,
  p_authorization_quote text, p_agent_session text, p_authorized_at timestamptz DEFAULT '2026-10-19 16:09:00+00')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF txid_current_if_assigned() IS NULL THEN
    RAISE EXCEPTION 'Register a delegated sign after the Sign, in the same transaction (this transaction has written nothing)';
  END IF;
  IF p_rpc LIKE '%\_owner\_delegated' THEN
    RAISE EXCEPTION 'An owner-delegated writer registers its own sign';
  END IF;
  RETURN public.owner_delegated_sign_record(p_rpc, p_args_summary, p_result_ref, p_authorization_quote, p_agent_session, p_authorized_at);
END $$;
REVOKE ALL ON FUNCTION public.owner_delegated_sign_register(text, jsonb, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_delegated_sign_register(text, jsonb, text, text, text, timestamptz) TO service_role;
COMMENT ON FUNCTION public.owner_delegated_sign_register(text, jsonb, text, text, text, timestamptz) IS
  'Service-only. Call after a Sign executed as the owner, in the same transaction; the register row commits iff the Sign commits.';

CREATE FUNCTION public.is_owner_delegated_sign(p_rpc text, p_result_ref text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.owner_delegated_signs d WHERE d.rpc = p_rpc AND d.result_ref = p_result_ref AND NOT d.rolled_back)
$$;
REVOKE ALL ON FUNCTION public.is_owner_delegated_sign(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner_delegated_sign(text, text) TO anon, authenticated, service_role;

CREATE FUNCTION public.owner_delegated_signs_read() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
  SELECT jsonb_build_object('as_of', statement_timestamp(),
    'owner', public.platform_person_label(public.owner_delegation_owner_id()),
    'totals', jsonb_build_object('signs', count(*), 'rolled_back', count(*) FILTER (WHERE rolled_back)),
    'by_rpc', COALESCE((SELECT jsonb_agg(jsonb_build_object('rpc', r.rpc, 'signs', r.n, 'rolled_back', r.rb,
        'first_signed_at', r.first_at, 'last_signed_at', r.last_at) ORDER BY r.rpc)
      FROM (SELECT rpc, count(*) n, count(*) FILTER (WHERE rolled_back) rb, min(signed_at) first_at, max(signed_at) last_at
        FROM public.owner_delegated_signs GROUP BY rpc) r), '[]'::jsonb),
    'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('rpc', x.rpc, 'signed_at', x.signed_at, 'authorized_at', x.authorized_at,
        'rolled_back', x.rolled_back) ORDER BY x.signed_at DESC)
      FROM (SELECT * FROM public.owner_delegated_signs ORDER BY signed_at DESC LIMIT 50) x), '[]'::jsonb),
    'authorizations', COALESCE((SELECT jsonb_agg(DISTINCT authorized_at) FROM public.owner_delegated_signs), '[]'::jsonb),
    'meaning', 'each Sign here was executed by an agent on the owner''s behalf under his recorded authorization and registered in the same transaction',
    'withheld', jsonb_build_array('arguments', 'result references', 'agent sessions', 'authorization wording'))
  FROM public.owner_delegated_signs
$$;
REVOKE ALL ON FUNCTION public.owner_delegated_signs_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_delegated_signs_read() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.owner_delegated_signs_read() IS
  'Open: the public register of owner-delegated Signs (counts by rpc, sign and authorization clocks); no arguments or references.';

NOTIFY pgrst, 'reload schema';
COMMIT;
