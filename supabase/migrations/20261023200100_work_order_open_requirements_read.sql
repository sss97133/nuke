-- work_order_open_requirements_read: open_requirements_read narrowed to ONE work order, server-side.
--
-- The iOS job screen called open_requirements_read(p_limit => 100), which builds the resource
-- graph, plan-B suppliers and per-input match for every open requirement in the marketplace,
-- then filtered the page to its job on the device. A job outside that first page showed no
-- supplier rows, and each job open paid for the whole graph.
--
-- Additive and backward compatible: open_requirements_read(uuid,integer,text) is untouched
-- (its body is hash-guarded and read by contract tests by that signature). The new reader is
-- derived from the LIVE definition at apply time, the same way earlier migrations patch it,
-- so the two never drift at deploy: same viewer, rows, match, coverage and visibility rule
-- (open, public vehicle, not invite_only), with one extra predicate on the work-order set.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  head_old constant text := $a$CREATE OR REPLACE FUNCTION public.open_requirements_read(p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25, p_kind text DEFAULT NULL::text)$a$;
  head_new constant text := $a$CREATE OR REPLACE FUNCTION public.work_order_open_requirements_read(p_work_order_id uuid, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100, p_kind text DEFAULT NULL::text)$a$;
  wos_mark constant text := $a$AND EXISTS (SELECT 1 FROM public.work_order_resource_requirements r WHERE r.work_order_id = w.id)$a$;
BEGIN
  IF to_regprocedure('public.work_order_open_requirements_read(uuid,uuid,integer,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'work_order_open_requirements_read already exists';
  END IF;
  IF (length(def) - length(replace(def, head_old, ''))) / length(head_old) <> 1
     OR (length(def) - length(replace(def, wos_mark, ''))) / length(wos_mark) <> 1 THEN
    RAISE EXCEPTION 'open_requirements_read markers not found once; reader differs from reviewed shape';
  END IF;
  def := replace(def, head_old, head_new);
  def := replace(def, wos_mark, wos_mark || E'\n      AND w.id = p_work_order_id');
  EXECUTE def;
END $apply$;

REVOKE ALL ON FUNCTION public.work_order_open_requirements_read(uuid,uuid,integer,text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_open_requirements_read(uuid,uuid,integer,text) TO anon, authenticated;
COMMENT ON FUNCTION public.work_order_open_requirements_read(uuid,uuid,integer,text) IS 'open_requirements_read for one work order (server-side filter; same rows, match, coverage and visibility rule). Derived from the live open_requirements_read at apply time.';
NOTIFY pgrst, 'reload schema';
COMMIT;
