-- Close anonymous readers of private work-order and technician fields until their access
-- circumstances are established. Nothing is dropped; the service role keeps every path.
-- resolve_work_order_status is SECURITY DEFINER and returns customer contact fields and amounts
-- for a free-text match, so it is service-role only. work_order_balance runs as the caller over a
-- security_invoker view, so authenticated callers stay governed by row security; anon loses it.
-- technicians: contact columns are private; a signed-in technician reads only their own row.
-- equipment and work_order_assignments have no policies; the unused anon table grants go.
-- Contract: supabase/sql/test_close_work_order_pii_readers.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

REVOKE ALL ON FUNCTION public.resolve_work_order_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_work_order_status(text) TO service_role;

REVOKE ALL ON FUNCTION public.work_order_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_balance(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS technicians_public_read ON public.technicians;
DROP POLICY IF EXISTS technicians_own_read ON public.technicians;
CREATE POLICY technicians_own_read ON public.technicians
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.technicians, public.equipment, public.work_order_assignments FROM anon;

COMMIT;
