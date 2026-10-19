-- work_order_evidence_read named each attachment's operation with its raw task_description, to non-parties too, while
-- work_order_operations_read withholds the same text when it names the customer or carries contact details. Non-parties now
-- get task_description null and task_description_visibility 'withheld_personal_info' in that case, the shape
-- work_order_quote_redact gives. Parties and non-personal text are unchanged. One anchored edit.
-- Contract: supabase/sql/test_job_evidence_operation_redaction.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $edit$
DECLARE
  rd text := pg_get_functiondef('public.work_order_evidence_read(uuid)'::regprocedure);
  a1 text := $a$'task_description', li.task_description) FROM public.work_order_line_items li WHERE li.id = a.operation_id) END,$a$;
BEGIN
  IF (length(rd)-length(replace(rd,a1,'')))/length(a1) <> 1 THEN
    RAISE EXCEPTION 'evidence reader anchor not found exactly once';
  END IF;
  EXECUTE replace(rd, a1, $r$'task_description', li.task_description)
          || CASE WHEN NOT party AND public.work_order_text_is_personal(w.id, li.task_description)
            THEN jsonb_build_object('task_description', NULL, 'task_description_visibility', 'withheld_personal_info') ELSE '{}'::jsonb END
        FROM public.work_order_line_items li WHERE li.id = a.operation_id) END,$r$);
END $edit$;

NOTIFY pgrst, 'reload schema';
COMMIT;
