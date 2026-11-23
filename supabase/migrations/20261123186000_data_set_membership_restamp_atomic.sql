-- Fourth review round (Bugbot) on the restamp of moved comments, data_set_membership_apply_v1 only:
--   1. A restamp (supersede of a comment member plus the add of the same tuple with the new auction) is applied as one
--      step: the add is taken with its supersede even past the batch limit, so no call can leave a comment hidden from
--      comps between batches.
--   2. If the comment is back on the auction of the old stamp by apply time, the old row stays (skip basis_live_again)
--      and the add is skipped as basis_changed, so the comment never ends up with no active row.
-- Contract: supabase/sql/test_data_set_membership.sql. Revert: supabase/sql/revert_20261123186000_data_set_membership_restamp_atomic.sql
begin;
set local lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.data_set_membership_apply_v1(p_run uuid, p_batch integer DEFAULT 200,
  p_max_batches integer DEFAULT 1, p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE
  r record; a record; b int := 0; n int; v_ids bigint[]; v_set uuid; v_created boolean; v_new bigint; n_bad int;
  n_app int := 0; n_skip int := 0; n_sets int := 0; v_batches jsonb := '[]'; b_app int; b_skip int;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_apply_v1: run required'; END IF;
  IF p_batch NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'data_set_membership_apply_v1: batch must be 1..500'; END IF;
  IF p_max_batches NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'data_set_membership_apply_v1: max_batches must be 1..200'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.data_set_runs x WHERE x.run_id = p_run::text AND x.status IN ('planned','applying','applied')) THEN
    RAISE EXCEPTION 'data_set_membership_apply_v1: run % is not planned (or was reverted)', p_run;
  END IF;
  IF p_dry THEN
    RETURN jsonb_build_object('run_id', p_run, 'dry', true,
      'planned', (SELECT jsonb_object_agg(k, c) FROM (SELECT p.action || ':' || p.set_kind AS k, count(*) AS c
                    FROM public.data_set_member_plan p WHERE p.run_id = p_run::text AND p.state = 'planned' GROUP BY 1) s),
      'would_take_now', least(p_batch * p_max_batches,
        (SELECT count(*) FROM public.data_set_member_plan p WHERE p.run_id = p_run::text AND p.state = 'planned')));
  END IF;
  UPDATE public.data_set_runs SET status = 'applying' WHERE run_id = p_run::text;
  WHILE b < p_max_batches LOOP
    n := 0; b_app := 0; b_skip := 0; v_ids := '{}';
    FOR r IN SELECT p.* FROM public.data_set_member_plan p WHERE p.run_id = p_run::text AND p.state = 'planned'
              ORDER BY (p.action = 'add'), p.id LIMIT p_batch FOR UPDATE SKIP LOCKED LOOP
      -- a restamp's add may already have been taken together with its supersede earlier in this batch
      CONTINUE WHEN (SELECT x.state FROM public.data_set_member_plan x WHERE x.id = r.id) <> 'planned';
      n := n + 1; v_ids := v_ids || r.id;
      a := NULL;
      IF r.action = 'add' THEN
        a := r;
      ELSE
        -- a restamp is a supersede plus an add of the same (set, member, basis): both are taken in this one step
        a := NULL;
        SELECT x.* INTO a FROM public.data_set_member_plan x
         WHERE x.run_id = r.run_id AND x.action = 'add' AND x.state = 'planned' AND r.member_type = 'auction_comment'
           AND x.set_kind = r.set_kind AND x.set_key = r.set_key AND x.member_type = r.member_type
           AND x.member_id = r.member_id AND x.basis_type = r.basis_type AND x.basis_id = r.basis_id
         ORDER BY x.id LIMIT 1 FOR UPDATE;
        IF a.id IS NOT NULL AND public.data_set_basis_live(r.basis_type, r.basis_id, r.vehicle_id, r.basis_detail) THEN
          -- the comment is back on the auction of the old stamp: keep the old row
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'basis_live_again' WHERE id = r.id;
          b_skip := b_skip + 1;
        ELSE
          UPDATE public.data_set_members SET state = 'superseded', superseded_at = now(), superseded_run_id = p_run::text
           WHERE id = r.target_member_id AND state = 'active';
          IF FOUND THEN
            UPDATE public.data_set_member_plan SET state = 'applied', applied_at = now() WHERE id = r.id; b_app := b_app + 1;
          ELSE
            UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'not_active' WHERE id = r.id; b_skip := b_skip + 1;
          END IF;
        END IF;
        IF a.id IS NOT NULL THEN n := n + 1; v_ids := v_ids || a.id; END IF;
      END IF;
      IF a.id IS NOT NULL THEN
        IF NOT public.data_set_basis_live(a.basis_type, a.basis_id, a.vehicle_id, a.basis_detail) THEN
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'basis_changed' WHERE id = a.id;
          b_skip := b_skip + 1;
        ELSE
          v_set := NULL;
          INSERT INTO public.data_sets (set_kind, set_key, rule_version, label, provenance, created_run_id)
          VALUES (a.set_kind, a.set_key, 'data_set_keys_v1', a.set_label, a.set_provenance, p_run::text)
          ON CONFLICT (set_kind, set_key, rule_version) DO NOTHING RETURNING id INTO v_set;
          v_created := v_set IS NOT NULL;
          IF v_set IS NULL THEN
            SELECT s.id INTO v_set FROM public.data_sets s
             WHERE s.set_kind = a.set_kind AND s.set_key = a.set_key AND s.rule_version = 'data_set_keys_v1';
          ELSE n_sets := n_sets + 1; END IF;
          v_new := NULL;
          INSERT INTO public.data_set_members (set_id, member_type, member_id, vehicle_id, basis_type, basis_id, basis_detail,
            confidence, rule_version, run_id)
          VALUES (v_set, a.member_type, a.member_id, a.vehicle_id, a.basis_type, a.basis_id, a.basis_detail, a.confidence,
            a.member_rule_version, p_run::text)
          ON CONFLICT (set_id, member_type, member_id, basis_type, basis_id) WHERE state = 'active' DO NOTHING
          RETURNING id INTO v_new;
          IF v_new IS NULL THEN
            UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'already_member', set_id = v_set,
                   set_created = v_created WHERE id = a.id;
            b_skip := b_skip + 1;
          ELSE
            UPDATE public.data_set_member_plan SET state = 'applied', applied_at = now(), set_id = v_set, set_created = v_created,
                   member_row_id = v_new WHERE id = a.id;
            b_app := b_app + 1;
          END IF;
        END IF;
      END IF;
    END LOOP;
    EXIT WHEN n = 0;
    b := b + 1;
    SELECT count(*) INTO n_bad FROM public.data_set_member_plan p
      LEFT JOIN public.data_set_members m ON m.id = coalesce(p.member_row_id, p.target_member_id)
     WHERE p.id = ANY (v_ids) AND p.state = 'applied'
       AND (m.id IS NULL
            OR (p.action = 'add' AND (m.run_id <> p.run_id OR m.set_id IS DISTINCT FROM p.set_id OR m.member_id <> p.member_id))
            OR (p.action = 'supersede' AND (m.state <> 'superseded' OR m.superseded_run_id IS DISTINCT FROM p.run_id)));
    IF n_bad > 0 THEN RAISE EXCEPTION 'data_set_membership_apply_v1: batch % verify failed: % applied plan rows do not match', b, n_bad; END IF;
    IF b_app + b_skip <> n THEN RAISE EXCEPTION 'data_set_membership_apply_v1: batch % took % rows, % applied, % skipped', b, n, b_app, b_skip; END IF;
    n_app := n_app + b_app; n_skip := n_skip + b_skip;
    v_batches := v_batches || jsonb_build_array(jsonb_build_object('batch', b, 'rows', n, 'applied', b_app, 'skipped', b_skip));
  END LOOP;
  UPDATE public.data_set_runs x
     SET status = CASE WHEN EXISTS (SELECT 1 FROM public.data_set_member_plan p WHERE p.run_id = x.run_id AND p.state = 'planned')
                       THEN 'applying' ELSE 'applied' END,
         applied_at = now(),
         summary = x.summary || jsonb_build_object('applied', (SELECT count(*) FROM public.data_set_member_plan p WHERE p.run_id = x.run_id AND p.state = 'applied'),
                                                    'skipped', (SELECT count(*) FROM public.data_set_member_plan p WHERE p.run_id = x.run_id AND p.state = 'skipped'),
                                                    'sets_created', (SELECT count(*) FROM public.data_sets s WHERE s.created_run_id = x.run_id))
   WHERE x.run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'dry', false, 'batches', b, 'applied', n_app, 'skipped', n_skip, 'sets_created', n_sets,
    'per_batch', v_batches,
    'still_planned', (SELECT count(*) FROM public.data_set_member_plan p WHERE p.run_id = p_run::text AND p.state = 'planned'));
END
$function$;

REVOKE ALL ON FUNCTION public.data_set_membership_apply_v1(uuid, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_membership_apply_v1(uuid, integer, integer, boolean) TO service_role;
commit;
