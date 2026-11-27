-- Candidate implementation for schema proposal f8215459-ec38-4e2e-a855-509257740313.
-- Not an automatically deployed migration. Disposable PG17 contracts only.

BEGIN;
DO $candidate$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
  OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'Operating-case candidate requires a disposable PG17 contract database';
 END IF;
END $candidate$;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
-- The pre-lease selection is only an eligibility hint. The existing guarded
-- DEFINER claim locks the selected case and rechecks its current recipe and
-- eligibility after the real vehicle lease is acquired. A pre-lease row lock
-- unnecessarily required direct UPDATE permission on the private case table.
DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure);
 a text:=$a$          order by c.attempted_at NULLS FIRST,c.generation_changed_at,c.id limit 1 for update skip locked;$a$;
 z text:=$z$          order by c.attempted_at NULLS FIRST,c.generation_changed_at,c.id limit 1;$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private eligibility selection caller anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.harness_operating_case_worker_claim(uuid,uuid,uuid)'::regprocedure);
 a:=$a$ SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE;$a$;
 z:=$z$ SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private claim context lookup anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$  RAISE EXCEPTION 'private case claim requires its active existing worker lease' USING ERRCODE='42501'; END IF;$a$;
 z:=a||$z$
 -- A concurrent author may hold the recipe head. Never wait or consume a
 -- private attempt before the protected calculation phase.
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','contended'); END IF;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private claim skip-locked anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.model_fold_tick()'::regprocedure);
 a:=$a$      v_dc_phase:=v_dc_claim->>'status'='claimed';$a$;
 z:=a||$z$
      -- Give generic work one normal turn, then yield this vehicle instead
      -- of repeatedly selecting its same temporarily locked private case.
      if v_dc_claim->>'status'='contended' then v_stage:='vehicle_followup';end if;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Contended claim followup anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;
GRANT EXECUTE ON FUNCTION public.harness_operating_case_worker_context(uuid),
 public.harness_operating_case_worker_key(),public.harness_operating_case_worker_due(uuid,uuid),
 public.harness_operating_case_worker_claim(uuid,uuid,uuid),public.harness_operating_case_worker_finish(uuid,uuid,jsonb),
 public.harness_operating_case_worker_prepare(uuid,uuid),public.harness_operating_case_worker_parent(uuid),
 public.harness_operating_case_worker_vehicle_due(uuid),public.harness_operating_case_worker_enqueue_changed(),
 public.harness_operating_case_worker_recover(uuid) TO service_role;
-- No PUBLIC, anonymous or authenticated grants; no table mutation grant.
COMMIT;
