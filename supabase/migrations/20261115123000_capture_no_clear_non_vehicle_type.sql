-- Frames typed other / receipt_document must never enter a clear landing set.
-- Stacked after live capture_sets_score + capture_landing_plan_step (20261111130000 / 20261111200000 on main;
-- live score has drifted in other legs, but the blocked line and the plan_step clear case are the same).
-- Revert: supabase/sql/revert_20261115123000_capture_no_clear_non_vehicle_type.sql
-- Does not bump any epoch, does not call capture_landing_gate_check, does not re-arm days.

-- Why: 2026-02-18 scored a typ=other passport card clear onto the 1983 GMC K15 (score 2.5, required_n=1,
-- would fail the visual gate at error_rate 1.0). 2019-09-24 scored typ=other clear onto the 1966 Mustang
-- (score 2.57). capture_sets_score did not treat typ as blocked, and plan_step would clear any set that
-- met score, margin, and has_evidence. Personal documents currently classify as typ=other.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $do$
DECLARE
  v_score text;
  v_plan text;
  v_n int;
  v_blocked text := $blk$or coalesce(vi.vision_gate_status::text,'') in ('rejected_personal','rejected_misattributed') blocked,$blk$;
  v_blocked_new text := $blk$or coalesce(vi.vision_gate_status::text,'') in ('rejected_personal','rejected_misattributed')
             or coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','') in ('other','receipt_document')  -- (20261115123000)
             blocked,$blk$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_score
    FROM pg_proc
   WHERE proname = 'capture_sets_score' AND pronargs = 6 AND pronamespace = 'public'::regnamespace;
  IF v_score IS NULL THEN RAISE EXCEPTION 'capture_sets_score (6 args) is not live'; END IF;
  IF position('(20261115123000)' in v_score) > 0 THEN
    RAISE NOTICE 'capture_sets_score already carries 20261115123000 typ-blocked';
  ELSE
    v_n := (length(v_score) - length(replace(v_score, v_blocked, ''))) / length(v_blocked);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'capture_sets_score blocked line drifted (n=%); refusing typ patch', v_n;
    END IF;
    v_score := replace(v_score, v_blocked, v_blocked_new);
    EXECUTE v_score;
  END IF;

  SELECT pg_get_functiondef(oid) INTO v_plan
    FROM pg_proc
   WHERE proname = 'capture_landing_plan_step' AND pronargs = 2 AND pronamespace = 'public'::regnamespace;
  IF v_plan IS NULL THEN RAISE EXCEPTION 'capture_landing_plan_step is not live'; END IF;
  IF position('(20261115123000)' in v_plan) > 0 THEN
    RAISE NOTICE 'capture_landing_plan_step already carries 20261115123000 typ-clear filter';
    RETURN;
  END IF;
  IF position($s$t.image_ids, t.filed_ids,$s$ in v_plan) = 0
     OR position($s$and t.has_evidence then 'clear' else 'review' end,$s$ in v_plan) = 0 THEN
    RAISE EXCEPTION 'capture_landing_plan_step insert snippet drifted; refusing typ patch';
  END IF;
  v_plan := replace(v_plan,
    $s$    insert into capture_landing_sets (chunk_id, set_key, t0, t1, vehicle_id, image_ids, filed_ids, cells, score, margin, decision, reason, top3)
    select c.id, t.set_key, t.t0, t.t1, t.vehicle_id, t.image_ids, t.filed_ids,$s$,
    $s$    insert into capture_landing_sets (chunk_id, set_key, t0, t1, vehicle_id, image_ids, filed_ids, cells, score, margin, decision, reason, top3)
    select c.id, t.set_key, t.t0, t.t1, t.vehicle_id,
           case when t.vehicle_id is not null and t.vehicle_id <> all (cfg.protected_vehicle_ids)
                 and (t.signals->>'score')::numeric >= greatest(2.5, cfg.min_score)
                 and (t.signals->>'margin_raw')::numeric >= greatest(1, cfg.min_margin)
                 and t.has_evidence
                 and cardinality(t.clearable_ids) > 0
                then t.clearable_ids else t.image_ids end,  -- (20261115123000) typ=other/receipt never stored on a clear set
           t.filed_ids,$s$);
  v_plan := replace(v_plan,
    $s$           case when t.vehicle_id is not null and t.vehicle_id <> all (cfg.protected_vehicle_ids)
                 and (t.signals->>'score')::numeric >= greatest(2.5, cfg.min_score)
                 and (t.signals->>'margin_raw')::numeric >= greatest(1, cfg.min_margin)
                 and t.has_evidence then 'clear' else 'review' end,
           case when t.vehicle_id is null then 'no_candidate'
                when t.vehicle_id = any (cfg.protected_vehicle_ids) then 'protected_vehicle'
                when (t.signals->>'margin_raw')::numeric < greatest(1, cfg.min_margin) then 'no_clear_lead'
                when (t.signals->>'score')::numeric < greatest(2.5, cfg.min_score) then 'score_below_threshold'
                when not t.has_evidence then 'priors_only' end,$s$,
    $s$           case when t.vehicle_id is not null and t.vehicle_id <> all (cfg.protected_vehicle_ids)
                 and (t.signals->>'score')::numeric >= greatest(2.5, cfg.min_score)
                 and (t.signals->>'margin_raw')::numeric >= greatest(1, cfg.min_margin)
                 and t.has_evidence
                 and cardinality(t.clearable_ids) > 0 then 'clear' else 'review' end,
           case when t.vehicle_id is null then 'no_candidate'
                when t.vehicle_id = any (cfg.protected_vehicle_ids) then 'protected_vehicle'
                when (t.signals->>'margin_raw')::numeric < greatest(1, cfg.min_margin) then 'no_clear_lead'
                when (t.signals->>'score')::numeric < greatest(2.5, cfg.min_score) then 'score_below_threshold'
                when not t.has_evidence then 'priors_only'
                when cardinality(t.clearable_ids) = 0 then 'non_vehicle_type' end,  -- (20261115123000)$s$);
  v_plan := replace(v_plan,
    $s$      select t.*,
             (coalesce((t.signals->>'visual')::numeric, 0) > 0 or coalesce((t.signals->>'vin')::numeric, 0) > 0
              or coalesce((t.signals->>'plate')::numeric, 0) > 0 or coalesce((t.signals->>'badge')::numeric, 0) > 0
              or coalesce((t.signals->>'model')::numeric, 0) > 0) as has_evidence
      from sc t where t.rank = 1$s$,
    $s$      select t.*,
             (coalesce((t.signals->>'visual')::numeric, 0) > 0 or coalesce((t.signals->>'vin')::numeric, 0) > 0
              or coalesce((t.signals->>'plate')::numeric, 0) > 0 or coalesce((t.signals->>'badge')::numeric, 0) > 0
              or coalesce((t.signals->>'model')::numeric, 0) > 0) as has_evidence,
             coalesce((select array_agg(vi.id order by vi.taken_at)
                         from vehicle_images vi
                        where vi.id = any (t.image_ids)
                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')), '{}'::uuid[]) as clearable_ids  -- (20261115123000)
      from sc t where t.rank = 1$s$);
  IF position('(20261115123000)' in v_plan) = 0 OR position('non_vehicle_type' in v_plan) = 0 THEN
    RAISE EXCEPTION 'capture_landing_plan_step typ patch did not land';
  END IF;
  EXECUTE v_plan;
END
$do$;

REVOKE ALL ON FUNCTION public.capture_sets_score(uuid, timestamptz, timestamptz, text, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_sets_score(uuid, timestamptz, timestamptz, text, uuid[], jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.capture_landing_plan_step(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_landing_plan_step(uuid, integer) TO service_role;
