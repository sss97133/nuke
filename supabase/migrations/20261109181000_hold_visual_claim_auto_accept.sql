-- A cited photograph establishes the source of an interpretation, not the
-- vehicle specification it proposes. Keep generic visual claims pending for
-- review rather than letting an attached image alone fill canonical columns.
-- Existing claims, source pixels, schedules, permissions and other producers
-- are unchanged. Historical corrections use the existing cited writers.
BEGIN;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE
  definition text;
  selector constant text := 'where fe.status = ''pending''';
  qualification constant text := 'and fe.source_type IS DISTINCT FROM ''ai_visual''';
BEGIN
  SELECT pg_get_functiondef('public.accept_cited_field_evidence(uuid,integer,uuid)'::regprocedure)
    INTO definition;
  IF position(qualification IN definition) > 0 THEN RETURN; END IF;
  IF position(selector IN definition) = 0 THEN
    RAISE EXCEPTION 'accept_cited_field_evidence pending selector changed; review required';
  END IF;
  definition := replace(definition, selector, selector || E'\n      ' || qualification);
  EXECUTE definition;
END;
$guard$;
COMMIT;
