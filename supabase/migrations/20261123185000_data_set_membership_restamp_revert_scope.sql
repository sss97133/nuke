-- Third review round on the data-set membership producer (Bugbot):
--   1. Comment members carry the auction they were found on (basis_detail auction_event_id), which comps read. A re-plan
--      now compares that stamp, so a comment moved to another auction is superseded and re-added with the new stamp;
--      apply re-checks the stamp (data_set_basis_live) and runs a batch's supersedes before its adds so the two rows of
--      one tuple never collide.
--   2. data_set_membership_revert_v1 deletes the run's adds first, then restores its supersedes (one per tuple), and
--      brings back an earlier kept-superseded row only for a tuple whose re-add this revert deleted, one per tuple.
--      Before, it reactivated every kept row with no active duplicate, which could revive a membership a later applied
--      run had turned off or collide on data_set_members_active_uq.
-- Contract: supabase/sql/test_data_set_membership.sql. Revert: supabase/sql/revert_20261123185000_data_set_membership_restamp_revert_scope.sql
begin;
set local lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.data_set_basis_live(p_basis_type text, p_basis_id uuid, p_vehicle uuid, p_detail jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT CASE p_basis_type
    WHEN 'observation' THEN EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.id = p_basis_id
                                      AND o.vehicle_id = p_vehicle AND NOT coalesce(o.is_superseded, false))
    WHEN 'field_evidence' THEN EXISTS (SELECT 1 FROM public.field_evidence f WHERE f.id = p_basis_id AND f.vehicle_id = p_vehicle
                                      AND coalesce(f.status, '') NOT IN ('rejected','superseded')
                                      AND upper(btrim(f.proposed_value)) = p_detail->>'vin')
    WHEN 'vehicle_vin' THEN EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = p_basis_id AND x.deleted_at IS NULL
                                      AND x.merged_into_vehicle_id IS NULL AND upper(btrim(x.vin)) = p_detail->>'vin')
    WHEN 'vehicle_flag' THEN EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = p_basis_id AND x.deleted_at IS NULL
                                      AND x.merged_into_vehicle_id IS NULL AND x.is_replica IS TRUE
                                      AND upper(btrim(x.vin)) = p_detail->>'vin'
                                      AND (p_detail->>'cohort' IS DISTINCT FROM 'as_presented'
                                           OR ((public.data_set_replica_presented_v1(x.replica_quote)).p_series IS NOT DISTINCT FROM p_detail->>'presented_series'
                                               AND (public.data_set_replica_presented_v1(x.replica_quote)).p_app IS NOT DISTINCT FROM p_detail->>'presented_engine')))
    WHEN 'comment_rubric' THEN EXISTS (SELECT 1 FROM public.auction_comments c WHERE c.id = p_basis_id
                                      AND c.vehicle_id IS NOT DISTINCT FROM p_vehicle
                                      AND c.auction_event_id IS NOT DISTINCT FROM nullif(p_detail->>'auction_event_id', '')::uuid)
    ELSE false END
$function$;

CREATE OR REPLACE FUNCTION public.data_set_membership_plan_v1(p_run uuid, p_scope text DEFAULT 'vehicle', p_vehicle uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE v_ids uuid[]; n_add int; n_sup int; n_cand int;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_plan_v1: run required'; END IF;
  IF p_scope NOT IN ('vehicle','pontiac_f_body') THEN RAISE EXCEPTION 'data_set_membership_plan_v1: unknown scope %', p_scope; END IF;
  IF p_scope = 'vehicle' AND p_vehicle IS NULL THEN RAISE EXCEPTION 'data_set_membership_plan_v1: scope vehicle needs a vehicle'; END IF;
  IF EXISTS (SELECT 1 FROM public.data_set_runs r WHERE r.run_id = p_run::text) THEN
    RAISE EXCEPTION 'data_set_membership_plan_v1: run % already planned', p_run;
  END IF;
  v_ids := coalesce(public.data_set_scope_vehicles(p_scope, p_vehicle), '{}');
  INSERT INTO public.data_set_runs (run_id, producer, logic_version, scope, vehicle_id, n_vehicles)
  VALUES (p_run::text, 'data_set_membership_v1', 'data_set_membership/20261123180000.1', p_scope, p_vehicle, cardinality(v_ids));

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.data_set_cand (LIKE public.data_set_member_plan INCLUDING DEFAULTS) ON COMMIT DROP;
  TRUNCATE pg_temp.data_set_cand;
  INSERT INTO pg_temp.data_set_cand (id, run_id, action, set_kind, set_key, set_label, set_provenance, member_type, member_id,
    vehicle_id, basis_type, basis_id, basis_detail, confidence, member_rule_version)
  SELECT 0, p_run::text, 'add', c.set_kind, c.set_key, c.set_label, c.set_provenance, c.member_type, c.member_id,
         c.vehicle_id, c.basis_type, c.basis_id, c.basis_detail, c.confidence, c.member_rule_version
    FROM (SELECT DISTINCT ON (c0.set_kind, c0.set_key, c0.member_type, c0.member_id, c0.basis_type, c0.basis_id) c0.*
            FROM public.data_set_candidates_v1(v_ids) c0
           ORDER BY c0.set_kind, c0.set_key, c0.member_type, c0.member_id, c0.basis_type, c0.basis_id, c0.confidence DESC) c;
  GET DIAGNOSTICS n_cand = ROW_COUNT;
  ANALYZE pg_temp.data_set_cand;

  INSERT INTO public.data_set_member_plan (run_id, action, set_kind, set_key, set_label, set_provenance, member_type, member_id,
    vehicle_id, basis_type, basis_id, basis_detail, confidence, member_rule_version)
  SELECT c.run_id, 'add', c.set_kind, c.set_key, c.set_label, c.set_provenance, c.member_type, c.member_id,
         c.vehicle_id, c.basis_type, c.basis_id, c.basis_detail, c.confidence, c.member_rule_version
    FROM pg_temp.data_set_cand c
   WHERE NOT EXISTS (SELECT 1 FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
                      WHERE m.state = 'active' AND s.set_kind = c.set_kind AND s.set_key = c.set_key
                        AND s.rule_version = 'data_set_keys_v1' AND m.member_type = c.member_type
                        AND m.member_id = c.member_id AND m.basis_type = c.basis_type AND m.basis_id = c.basis_id
                        -- a comment that moved to another auction is a new stamp: supersede the old, add the new
                        AND (c.member_type <> 'auction_comment'
                             OR m.basis_detail->>'auction_event_id' IS NOT DISTINCT FROM c.basis_detail->>'auction_event_id'))
   ORDER BY c.vehicle_id, c.set_kind, c.set_key, c.member_type, c.member_id;
  GET DIAGNOSTICS n_add = ROW_COUNT;

  INSERT INTO public.data_set_member_plan (run_id, action, set_kind, set_key, member_type, member_id, vehicle_id, basis_type,
    basis_id, basis_detail, confidence, member_rule_version, target_member_id)
  SELECT p_run::text, 'supersede', s.set_kind, s.set_key, m.member_type, m.member_id, m.vehicle_id, m.basis_type,
         m.basis_id, m.basis_detail, m.confidence, m.rule_version, m.id
    FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
   WHERE m.state = 'active' AND m.vehicle_id = ANY (v_ids)
     AND NOT EXISTS (SELECT 1 FROM pg_temp.data_set_cand c
                      WHERE c.set_kind = s.set_kind AND c.set_key = s.set_key AND c.member_type = m.member_type
                        AND c.member_id = m.member_id AND c.basis_type = m.basis_type AND c.basis_id = m.basis_id
                        AND (m.member_type <> 'auction_comment'
                             OR m.basis_detail->>'auction_event_id' IS NOT DISTINCT FROM c.basis_detail->>'auction_event_id'))
   ORDER BY m.id;
  GET DIAGNOSTICS n_sup = ROW_COUNT;

  UPDATE public.data_set_runs SET summary = jsonb_build_object('candidates', n_cand, 'planned_add', n_add, 'planned_supersede', n_sup)
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'scope', p_scope, 'vehicles', cardinality(v_ids), 'candidates', n_cand,
    'planned_add', n_add, 'planned_supersede', n_sup,
    'by_kind', (SELECT jsonb_object_agg(k, n) FROM (SELECT p.action || ':' || p.set_kind || ':' || p.member_type AS k, count(*) AS n
                  FROM public.data_set_member_plan p WHERE p.run_id = p_run::text GROUP BY 1) s));
END
$function$;

CREATE OR REPLACE FUNCTION public.data_set_membership_apply_v1(p_run uuid, p_batch integer DEFAULT 200,
  p_max_batches integer DEFAULT 1, p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE
  r record; b int := 0; n int; v_ids bigint[]; v_set uuid; v_created boolean; v_new bigint; n_bad int;
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
      n := n + 1; v_ids := v_ids || r.id;
      IF r.action = 'add' THEN
        IF NOT public.data_set_basis_live(r.basis_type, r.basis_id, r.vehicle_id, r.basis_detail) THEN
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'basis_changed' WHERE id = r.id;
          b_skip := b_skip + 1; CONTINUE;
        END IF;
        v_set := NULL;
        INSERT INTO public.data_sets (set_kind, set_key, rule_version, label, provenance, created_run_id)
        VALUES (r.set_kind, r.set_key, 'data_set_keys_v1', r.set_label, r.set_provenance, p_run::text)
        ON CONFLICT (set_kind, set_key, rule_version) DO NOTHING RETURNING id INTO v_set;
        v_created := v_set IS NOT NULL;
        IF v_set IS NULL THEN
          SELECT s.id INTO v_set FROM public.data_sets s
           WHERE s.set_kind = r.set_kind AND s.set_key = r.set_key AND s.rule_version = 'data_set_keys_v1';
        ELSE n_sets := n_sets + 1; END IF;
        v_new := NULL;
        INSERT INTO public.data_set_members (set_id, member_type, member_id, vehicle_id, basis_type, basis_id, basis_detail,
          confidence, rule_version, run_id)
        VALUES (v_set, r.member_type, r.member_id, r.vehicle_id, r.basis_type, r.basis_id, r.basis_detail, r.confidence,
          r.member_rule_version, p_run::text)
        ON CONFLICT (set_id, member_type, member_id, basis_type, basis_id) WHERE state = 'active' DO NOTHING
        RETURNING id INTO v_new;
        IF v_new IS NULL THEN
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'already_member', set_id = v_set,
                 set_created = v_created WHERE id = r.id;
          b_skip := b_skip + 1;
        ELSE
          UPDATE public.data_set_member_plan SET state = 'applied', applied_at = now(), set_id = v_set, set_created = v_created,
                 member_row_id = v_new WHERE id = r.id;
          b_app := b_app + 1;
        END IF;
      ELSE
        UPDATE public.data_set_members SET state = 'superseded', superseded_at = now(), superseded_run_id = p_run::text
         WHERE id = r.target_member_id AND state = 'active';
        IF FOUND THEN
          UPDATE public.data_set_member_plan SET state = 'applied', applied_at = now() WHERE id = r.id; b_app := b_app + 1;
        ELSE
          UPDATE public.data_set_member_plan SET state = 'skipped', skip_reason = 'not_active' WHERE id = r.id; b_skip := b_skip + 1;
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

CREATE OR REPLACE FUNCTION public.data_set_membership_revert_v1(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE n_restore int; n_del int; n_sets int; n_left int; n_readded int; n_kept int;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_revert_v1: run required'; END IF;
  IF EXISTS (SELECT 1 FROM public.data_set_member_plan p JOIN public.data_set_members m ON m.id = p.member_row_id
              WHERE p.run_id = p_run::text AND p.state = 'applied' AND p.action = 'add' AND m.superseded_run_id IS NOT NULL
                AND m.superseded_run_id <> p_run::text
                AND EXISTS (SELECT 1 FROM public.data_set_runs x WHERE x.run_id = m.superseded_run_id AND x.status <> 'reverted')) THEN
    RAISE EXCEPTION 'data_set_membership_revert_v1: a later run superseded members of run %; revert it first', p_run;
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.data_set_rev_deleted
    (set_id uuid, member_type text, member_id uuid, basis_type text, basis_id uuid) ON COMMIT DROP;
  TRUNCATE pg_temp.data_set_rev_deleted;
  -- 1. this run's adds go first, so a member this run restamped (supersede + add of one tuple) restores cleanly
  WITH d AS (
    DELETE FROM public.data_set_members m USING public.data_set_member_plan p
     WHERE p.run_id = p_run::text AND p.action = 'add' AND p.state = 'applied' AND m.id = p.member_row_id AND m.run_id = p_run::text
    RETURNING m.set_id, m.member_type, m.member_id, m.basis_type, m.basis_id),
  i AS (INSERT INTO pg_temp.data_set_rev_deleted SELECT * FROM d RETURNING 1)
  SELECT count(*) INTO n_del FROM i;
  -- 2. this run's supersedes come back, unless a later run re-added the same (set, member, basis): that row stands
  WITH s AS (
    UPDATE public.data_set_members m SET state = 'active', superseded_at = NULL, superseded_run_id = NULL
     WHERE m.id IN (SELECT DISTINCT ON (t.set_id, t.member_type, t.member_id, t.basis_type, t.basis_id) t.id
                      FROM public.data_set_member_plan p JOIN public.data_set_members t ON t.id = p.target_member_id
                     WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied'
                       AND t.state = 'superseded' AND t.superseded_run_id = p_run::text
                     ORDER BY t.set_id, t.member_type, t.member_id, t.basis_type, t.basis_id, t.id DESC)
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members a WHERE a.state = 'active' AND a.id <> m.id
                        AND a.set_id = m.set_id AND a.member_type = m.member_type AND a.member_id = m.member_id
                        AND a.basis_type = m.basis_type AND a.basis_id = m.basis_id)
    RETURNING m.id)
  SELECT count(*) INTO n_restore FROM s;
  SELECT count(*) INTO n_readded FROM public.data_set_member_plan p JOIN public.data_set_members m ON m.id = p.target_member_id
   WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied' AND m.state = 'superseded'
     AND m.superseded_run_id = p_run::text;
  UPDATE public.data_set_member_plan p SET state = 'skipped', skip_reason = 'revert_kept_readded_active'
    FROM public.data_set_members m
   WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied' AND m.id = p.target_member_id
     AND m.state = 'superseded' AND m.superseded_run_id = p_run::text;
  -- 3. an earlier reverted run left a row superseded because a later run had re-added it. Only rows whose re-add THIS
  --    revert just deleted come back, one per (set, member, basis), and only if nothing else is active for it.
  WITH k AS (
    UPDATE public.data_set_members o SET state = 'active', superseded_at = NULL, superseded_run_id = NULL
     WHERE o.id IN (SELECT DISTINCT ON (t.set_id, t.member_type, t.member_id, t.basis_type, t.basis_id) t.id
                      FROM public.data_set_member_plan kp
                      JOIN public.data_set_runs kr ON kr.run_id = kp.run_id AND kr.status = 'reverted'
                      JOIN public.data_set_members t ON t.id = kp.target_member_id
                      JOIN pg_temp.data_set_rev_deleted dd ON dd.set_id = t.set_id AND dd.member_type = t.member_type
                       AND dd.member_id = t.member_id AND dd.basis_type = t.basis_type AND dd.basis_id = t.basis_id
                     WHERE kp.action = 'supersede' AND kp.state = 'skipped' AND kp.skip_reason = 'revert_kept_readded_active'
                       AND t.state = 'superseded' AND t.superseded_run_id = kp.run_id
                     ORDER BY t.set_id, t.member_type, t.member_id, t.basis_type, t.basis_id, t.id DESC)
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members a WHERE a.state = 'active' AND a.id <> o.id
                        AND a.set_id = o.set_id AND a.member_type = o.member_type AND a.member_id = o.member_id
                        AND a.basis_type = o.basis_type AND a.basis_id = o.basis_id)
    RETURNING o.id)
  UPDATE public.data_set_member_plan kp SET state = 'reverted', reverted_at = now(), skip_reason = 'restored_after_readd_reverted'
   WHERE kp.action = 'supersede' AND kp.state = 'skipped' AND kp.skip_reason = 'revert_kept_readded_active'
     AND kp.target_member_id IN (SELECT id FROM k);
  GET DIAGNOSTICS n_kept = ROW_COUNT;
  WITH d AS (
    DELETE FROM public.data_sets s WHERE s.created_run_id = p_run::text
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members m WHERE m.set_id = s.id) RETURNING s.id)
  SELECT count(*) INTO n_sets FROM d;
  UPDATE public.data_set_member_plan SET state = 'reverted', reverted_at = now() WHERE run_id = p_run::text AND state = 'applied';
  SELECT count(*) INTO n_left FROM public.data_set_members m WHERE m.run_id = p_run::text;
  UPDATE public.data_set_runs SET status = 'reverted', reverted_at = now(),
         summary = summary || jsonb_build_object('reverted', jsonb_build_object('restored', n_restore, 'members_deleted', n_del, 'sets_deleted', n_sets))
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'supersedes_restored', n_restore, 'supersedes_kept_readded', n_readded, 'earlier_supersedes_restored', n_kept, 'members_deleted', n_del, 'sets_deleted', n_sets,
    'members_left', n_left);
END
$function$;

REVOKE ALL ON FUNCTION public.data_set_membership_plan_v1(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_membership_apply_v1(uuid, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_membership_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_membership_plan_v1(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.data_set_membership_apply_v1(uuid, integer, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.data_set_membership_revert_v1(uuid) TO service_role;
commit;
