-- Keep photos already in an open review, or already marked wrong on a visual
-- pre_gate for the same vehicle, out of clear landing sets.
--
-- Why: chunk 6748ad5b (forward 2026-11-03..04) halted landing on 11 Nov with
-- required_n=1, 0 correct / 1 wrong, error_rate 1.000. The one clear photo
-- (afc898a9, typ=part_closeup) is a dealer key tag on a thread spool, not the
-- 1966 Chevelle the set was scored to. Skylar marked it wrong on 7 Nov; the
-- subscription reader marked it wrong/unclear on later passes; it has been in
-- an open no_clear_lead review since 4 Nov. plan_step still put it in a new
-- clear set, the gate failed, and landing halted. This is a content mismatch,
-- not an infrastructure error, plus a planner gap that re-clears held / already
-- rejected frames.
--
-- Does not bump any epoch, does not call capture_landing_gate_check, does not
-- re-arm days, does not move typ or taken_at, does not file, does not move
-- forward_cursor.
-- Revert: supabase/sql/revert_20261116243000_capture_no_clear_held_or_wrong.sql

SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $do$
DECLARE
  v_plan text;
  v_n int;
  v_old_clearable text := $old$             coalesce((select array_agg(vi.id order by vi.taken_at)
                         from vehicle_images vi
                        where vi.id = any (t.image_ids)
                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')), '{}'::uuid[]) as clearable_ids,  -- (20261115123000)$old$;
  v_new_clearable text := $new$             coalesce((select array_agg(vi.id order by vi.taken_at)
                         from vehicle_images vi
                        where vi.id = any (t.image_ids)
                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')
                          and not exists (
                                select 1 from capture_set_review r
                                 where r.status = 'open' and vi.id = any (r.image_ids)
                              )
                          and not exists (
                                select 1 from auto_filing_audit_queue q
                                 where q.image_id = vi.id
                                   and q.vehicle_id is not distinct from t.vehicle_id
                                   and q.source = 'pre_gate'
                                   and q.status = 'wrong'
                                   and q.verified_at is not null
                              )
                       ), '{}'::uuid[]) as clearable_ids,  -- (20261115123000, 20261116243000)$new$;
  v_old_reason text := $old$                when cardinality(t.clearable_ids) = 0 then 'non_vehicle_type'
                when t.identity_conflict then 'identity_conflict' end,  -- (20261115123000, 20261115135000)$old$;
  v_new_reason text := $new$                when cardinality(t.clearable_ids) = 0
                     and exists (
                       select 1 from vehicle_images vi
                        where vi.id = any (t.image_ids)
                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')
                     ) then 'already_held_or_prior_wrong'
                when cardinality(t.clearable_ids) = 0 then 'non_vehicle_type'
                when t.identity_conflict then 'identity_conflict' end,  -- (20261115123000, 20261115135000, 20261116243000)$new$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_plan
    FROM pg_proc
   WHERE proname = 'capture_landing_plan_step' AND pronargs = 2
     AND pronamespace = 'public'::regnamespace;
  IF v_plan IS NULL THEN RAISE EXCEPTION 'capture_landing_plan_step is not live'; END IF;
  IF position('20261116243000' in v_plan) > 0 THEN
    RAISE NOTICE 'capture_landing_plan_step already carries 20261116243000 held/wrong filter';
    RETURN;
  END IF;
  v_n := (length(v_plan) - length(replace(v_plan, v_old_clearable, ''))) / length(v_old_clearable);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'capture_landing_plan_step clearable_ids snippet drifted (n=%); refusing held/wrong patch', v_n;
  END IF;
  v_n := (length(v_plan) - length(replace(v_plan, v_old_reason, ''))) / length(v_old_reason);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'capture_landing_plan_step reason snippet drifted (n=%); refusing held/wrong patch', v_n;
  END IF;
  v_plan := replace(v_plan, v_old_clearable, v_new_clearable);
  v_plan := replace(v_plan, v_old_reason, v_new_reason);
  EXECUTE v_plan;
END
$do$;
