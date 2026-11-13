-- Parsed lines follow the existing receipt's access decision. Do not infer
-- receipt ownership from vehicle access, job responsibility or an admin role.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
DO $$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.receipts'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.receipt_items'::regclass) THEN
    RAISE EXCEPTION 'Receipt and line RLS must already be enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='receipt_items' AND cmd IN ('SELECT','ALL')) THEN
    RAISE EXCEPTION 'Receipt line read policies changed; review their intended visibility before adding parent inheritance';
  END IF;
END $$;
CREATE POLICY receipt_items_read_visible_parent ON public.receipt_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_items.receipt_id));
COMMENT ON POLICY receipt_items_read_visible_parent ON public.receipt_items IS
  'Read-only inheritance of the parent receipt RLS. No new parent visibility, anonymous read or write grant; historic lines retain the parent history access decision.';
COMMIT;
