-- Vouches I've given (iOS lane gap).
--
--   my_vouches_read(): authenticated. Vouches the viewer signed, and vouches of organizations the viewer currently owns or
--     belongs to (they may withdraw those too): subject by public handle or unnamed party (or actor label), voucher, kinds,
--     scope, signed and expiry clocks, status active|expired|withdrawn|superseded, and a withdraw_vouch action while active.
--   provider_profile_read vouched_for_by items carry is_mine and, for the signed-in voucher, a withdraw_vouch action
--     (provider_vouches_for_viewer decorates provider_vouched_for_by at its one call site; that function is unchanged).
-- Contract: supabase/sql/test_my_vouches_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.vouch_manageable_by(p_vouch public.provider_vouches, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_user IS NOT NULL AND (p_vouch.signer_user_id = p_user
    OR (p_vouch.voucher_organization_id IS NOT NULL AND public.work_order_org_member(p_user, p_vouch.voucher_organization_id)))
$$;
REVOKE ALL ON FUNCTION public.vouch_manageable_by(public.provider_vouches, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.my_vouches_read() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE uid uuid := auth.uid(); items jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.signed_at DESC, x.id), '[]'::jsonb) INTO items FROM (
    SELECT v.id, v.signed_at, jsonb_build_object('vouch_id', v.id,
      'subject', CASE WHEN v.subject_user_id IS NOT NULL THEN public.platform_person_label(v.subject_user_id)
        ELSE public.platform_actor_label(v.subject_actor_id) END
        || jsonb_build_object('subject_kind', CASE WHEN v.subject_user_id IS NOT NULL THEN 'account' ELSE 'work_actor' END),
      'voucher', CASE WHEN v.voucher_organization_id IS NOT NULL THEN public.platform_organization_label(v.voucher_organization_id)
        ELSE jsonb_build_object('kind', 'user', 'label', 'you') END,
      'signed_by_me', v.signer_user_id = uid, 'kinds', to_jsonb(v.kinds), 'scope', v.scope, 'signed_at', v.signed_at, 'expires_at', v.expires_at,
      'status', st.status, 'withdrawn_at', v.withdrawn_at,
      'actions', CASE WHEN st.status = 'active' THEN jsonb_build_array(jsonb_build_object('action', 'withdraw_vouch', 'rpc', 'withdraw_vouch',
        'args', jsonb_build_object('p_id', v.id))) ELSE '[]'::jsonb END) AS item
    FROM public.provider_vouches v
    CROSS JOIN LATERAL (SELECT CASE WHEN v.superseded_by IS NOT NULL THEN 'superseded' WHEN v.withdrawn_at IS NOT NULL THEN 'withdrawn'
      WHEN v.expires_at IS NOT NULL AND v.expires_at <= statement_timestamp() THEN 'expired' ELSE 'active' END AS status) st
    WHERE public.vouch_manageable_by(v, uid)
    ORDER BY v.signed_at DESC, v.id LIMIT 200) x;
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', public.viewer_identity_bridge(uid), false), 'as_of', statement_timestamp(),
    'items', items, 'coverage', jsonb_build_object('returned', jsonb_array_length(items), 'limit', 200,
      'population', 'vouches you signed and vouches of organizations you own or belong to'),
    'basis', 'a vouch is a standing statement with scope; never skill evidence');
END $$;
REVOKE ALL ON FUNCTION public.my_vouches_read() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.my_vouches_read() TO authenticated;
COMMENT ON FUNCTION public.my_vouches_read() IS 'Authenticated: vouches you signed or your organizations gave (subject by handle or unnamed party, kinds, scope, clocks, status) with withdraw_vouch while active.';

CREATE FUNCTION public.provider_vouches_for_viewer(p_section jsonb, p_viewer uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_section || jsonb_build_object('items', COALESCE((SELECT jsonb_agg(i || jsonb_build_object('is_mine', COALESCE(m.mine, false),
      'actions', CASE WHEN COALESCE(m.mine, false) THEN jsonb_build_array(jsonb_build_object('action', 'withdraw_vouch', 'rpc', 'withdraw_vouch',
        'args', jsonb_build_object('p_id', i->'vouch_id'))) ELSE '[]'::jsonb END) ORDER BY o)
    FROM jsonb_array_elements(COALESCE(p_section->'items', '[]'::jsonb)) WITH ORDINALITY e(i, o)
    LEFT JOIN LATERAL (SELECT public.vouch_manageable_by(v, p_viewer) AS mine FROM public.provider_vouches v WHERE v.id = (i->>'vouch_id')::uuid) m ON true), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.provider_vouches_for_viewer(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_vouches_for_viewer(jsonb, uuid) TO service_role;

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.provider_profile_read(uuid,uuid)'::regprocedure);
  a1 constant text := $a$'vouched_for_by', public.provider_vouched_for_by(p_user_id, actor_ids),$a$;
BEGIN
  IF position('provider_vouches_for_viewer' IN def) > 0 THEN RAISE EXCEPTION 'provider_profile_read already decorates vouches'; END IF;
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'provider_profile_read vouched_for_by anchor not found once'; END IF;
  EXECUTE replace(def, a1, $r$'vouched_for_by', public.provider_vouches_for_viewer(public.provider_vouched_for_by(p_user_id, actor_ids), uid),$r$);
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
