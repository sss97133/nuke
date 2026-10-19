-- work_order_quotes_read exposes release terms (iOS lane gap; terms declared by 20261019221500).
--   * the current quote and every live history version carry release_conditions (the normalized declared conditions, or
--     null when none were declared);
--   * a top-level release_conditions block: {current, accepted, declared_by: accepted_quote | platform_standard};
--   * viewer.issuer_actions gains issue_quote (issue_work_order_quote) for an eligible issuer while there is no accepted
--     current quote (after acceptance a change order applies and inherits the base quote's terms), with a
--     p_release_conditions hint and the vocabulary.
-- Four anchored edits in the live definition; terms are open, like prices.
-- Contract: supabase/sql/test_quotes_release_conditions_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.work_order_quote_release_conditions(p_quote_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT rt.conditions FROM public.work_order_quote_release_terms rt WHERE rt.quote_id = p_quote_id
$$;
REVOKE ALL ON FUNCTION public.work_order_quote_release_conditions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_quote_release_conditions(uuid) TO service_role;

CREATE FUNCTION public.work_order_quote_issue_action(p_user uuid, p_work_order_id uuid, p_current_quote_id uuid, p_acceptance_state text, p_accepted_quote_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_user IS NULL OR public.work_order_quote_issuer_role(p_user, p_work_order_id) IS NULL
      OR (p_acceptance_state = 'accepted' AND p_accepted_quote_id IS NOT DISTINCT FROM p_current_quote_id AND p_current_quote_id IS NOT NULL)
    THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object('action', 'issue_quote', 'rpc', 'issue_work_order_quote',
      'args', jsonb_build_object('p_work_order_id', p_work_order_id, 'p_lines', '[]'::jsonb, 'p_deposit', NULL, 'p_valid_until', NULL,
        'p_supersedes_quote_id', p_current_quote_id, 'p_release_conditions', NULL),
      'release_conditions_vocabulary', jsonb_build_array('customer_completion_sign', 'inspector_attestation', 'installed_parts_witness',
        'photos_in_window', jsonb_build_object('kind', 'days_signed', 'days', '1..90')),
      'release_conditions_basis', 'optional; captured in the quote hash; when the quote is accepted, release is evaluated over these instead of the platform standard'))
  END
$$;
REVOKE ALL ON FUNCTION public.work_order_quote_issue_action(uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_quote_issue_action(uuid,uuid,uuid,text,uuid) TO service_role;

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.work_order_quotes_read(uuid)'::regprocedure);
  a1 constant text := $a$quote := public.work_order_quote_for_viewer(cur_id, party) || jsonb_build_object('scope_status', qs#>'{current_quote,scope_status}');$a$;
  a2 constant text := $a$ELSE public.work_order_quote_for_viewer(x.id, party) END$a$;
  a3 constant text := $a$'work_order_id', w.id, 'as_of', statement_timestamp(), 'work_order_status', w.status,$a$;
  a4 constant text := $a$'args', jsonb_build_object('p_work_order_id', w.id, 'p_base_quote_id', cur_id))) ELSE '[]'::jsonb END$a$;
  a text;
BEGIN
  IF position('work_order_quote_release_conditions' IN def) > 0 THEN RAISE EXCEPTION 'work_order_quotes_read already exposes release conditions'; END IF;
  FOREACH a IN ARRAY ARRAY[a1, a2, a3, a4] LOOP
    IF (length(def) - length(replace(def, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'work_order_quotes_read anchor not found once: %', a; END IF;
  END LOOP;
  def := replace(def, a1, $r$quote := public.work_order_quote_for_viewer(cur_id, party) || jsonb_build_object('scope_status', qs#>'{current_quote,scope_status}',
      'release_conditions', public.work_order_quote_release_conditions(cur_id));$r$);
  def := replace(def, a2, $r$ELSE public.work_order_quote_for_viewer(x.id, party) || jsonb_build_object('release_conditions', public.work_order_quote_release_conditions(x.id)) END$r$);
  def := replace(def, a3, $r$'work_order_id', w.id, 'as_of', statement_timestamp(), 'work_order_status', w.status,
    'release_conditions', jsonb_build_object('current', public.work_order_quote_release_conditions(cur_id),
      'accepted', CASE WHEN acc_state = 'accepted' THEN public.work_order_quote_release_conditions((qs#>>'{acceptance,quote_id}')::uuid) END,
      'declared_by', CASE WHEN acc_state = 'accepted' AND public.work_order_quote_release_conditions((qs#>>'{acceptance,quote_id}')::uuid) IS NOT NULL
        THEN 'accepted_quote' ELSE 'platform_standard' END),$r$);
  def := replace(def, a4, a4 || $r$ || public.work_order_quote_issue_action(viewer, w.id, cur_id, acc_state, (qs#>>'{acceptance,quote_id}')::uuid)$r$);
  EXECUTE def;
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
