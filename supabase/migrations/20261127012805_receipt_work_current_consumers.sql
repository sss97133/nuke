-- Qualify the same receipt questions in both downstream consumers.
-- Existing testimony is untouched; the labor fold's logic key changes and its
-- normal queue must recompute before a stored result is fresh.
SET lock_timeout = '5s';

DO $patch$
DECLARE
  d text;
  a text;
  n int;
BEGIN
  d := pg_get_functiondef('public.vehicle_part_installation_evidence(uuid)'::regprocedure);
  IF position('current_receipt_judgments AS MATERIALIZED' IN d) = 0 THEN
    a := '  aq0 AS (';
    IF (length(d)-length(replace(d,a,'')))/length(a) <> 1 THEN
      RAISE EXCEPTION 'part installation reader changed; review its judgment CTE';
    END IF;
    d := replace(d,a,'  current_receipt_judgments AS MATERIALIZED (SELECT * FROM public.receipt_work_current_judgments(p_vehicle_id)),
  aq0 AS (');
    a := 'FROM v JOIN public.evidence_judgment_requests q ON q.vehicle_id = v.id';
    IF (length(d)-length(replace(d,a,'')))/length(a) <> 1 THEN
      RAISE EXCEPTION 'part installation reader changed; review its judgment join';
    END IF;
    d := replace(d,a,a || ' JOIN current_receipt_judgments cq ON cq.judgment_id = q.id');
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.vehicle_labor_appraisal_compute(uuid)'::regprocedure);
  IF position('qualified_receipt_judgments' IN d) = 0 THEN
    a := E'DECLARE\n';
    IF (length(d)-length(replace(d,a,'')))/length(a) <> 1 THEN
      RAISE EXCEPTION 'labor compute changed; review declaration anchor';
    END IF;
    d := replace(d,a,a || E'  qualified_receipt_judgments uuid[];\n');
    a := E'  IF v_visible IS NOT TRUE THEN\n    RETURN NULL;\n  END IF;';
    IF (length(d)-length(replace(d,a,'')))/length(a) <> 1 THEN
      RAISE EXCEPTION 'labor compute changed; review visibility anchor';
    END IF;
    d := replace(d,a,a || E'\n  SELECT coalesce(array_agg(judgment_id), ''{}''::uuid[]) INTO qualified_receipt_judgments\n    FROM public.receipt_work_current_judgments(p_vehicle_id);');
    a := 'e.vehicle_id = p_vehicle_id';
    n := (length(d)-length(replace(d,a,'')))/length(a);
    IF n <> 5 THEN RAISE EXCEPTION 'labor compute changed; expected five judgment joins, got %', n; END IF;
    d := replace(d,a,'e.id = ANY (qualified_receipt_judgments) AND ' || a);
    EXECUTE d;
  END IF;
END
$patch$;

-- The new qualification participates in the existing fold's source-code key.
-- The closure guard refuses unregistered public callees rather than silently
-- storing a fold that cannot notice a rule change.
INSERT INTO public.labor_fold_logic_functions(proname, counts_in_key, reason)
VALUES ('receipt_work_current_judgments', true, 'qualification of receipt-part judgments'),
       ('receipt_work_judgment_qualification', true, 'current versus historical receipt-part question context'),
       ('jsonb_text_array_set', true, 'candidate image set equality'),
       ('receipt_work_frame_eligible', true, 'receipt question image eligibility')
ON CONFLICT (proname) DO UPDATE SET counts_in_key = EXCLUDED.counts_in_key, reason = EXCLUDED.reason;

DO $$
DECLARE missing text;
BEGIN
  SELECT public.labor_fold_logic_unlisted() INTO missing;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'labor fold logic closure incomplete: %', missing; END IF;
END $$;
