-- post_work_request sets work_orders.description (QUOTE lane RSI pass 8). Live work_orders.description is NOT NULL; the
-- 20261019233000 Sign wrote only scope_description, so every live call failed (found by a rolled-back live probe; no rows
-- were written). The work order's description is now the client's words verbatim, the same text as scope_description.
-- Anchored on the live definition (each anchor once); nothing else changes.
-- Contract: supabase/sql/test_post_work_request_description.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $$
DECLARE
  def text := pg_get_functiondef('public.post_work_request(uuid,text,uuid[],jsonb,timestamptz,text)'::regprocedure);
  a1 text := 'INSERT INTO public.work_orders(id, vehicle_id, customer_id, request_source, title, scope_description, status,';
  a2 text := $a$VALUES (wo_id, v.id, client, channel, left(ops->0->>'text', 120), descr, 'pending', req_id, p_visibility);$a$;
BEGIN
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 OR (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'post_work_request anchors not found exactly once';
  END IF;
  def := replace(def, a1, 'INSERT INTO public.work_orders(id, vehicle_id, customer_id, request_source, title, description, scope_description, status,');
  def := replace(def, a2, $r$VALUES (wo_id, v.id, client, channel, left(ops->0->>'text', 120), descr, descr, 'pending', req_id, p_visibility);$r$);
  EXECUTE def;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
