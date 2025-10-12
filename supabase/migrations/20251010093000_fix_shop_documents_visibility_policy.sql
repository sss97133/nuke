BEGIN;

-- Align shop_documents visibility policy with enum values ('admin_only','shop_members','public')
DROP POLICY IF EXISTS shop_documents_member_read ON public.shop_documents;
CREATE POLICY shop_documents_member_read ON public.shop_documents
  FOR SELECT
  TO authenticated
  USING (
    (visibility IN ('shop_members','public') AND public.is_shop_member(shop_id))
    OR public.is_shop_admin(shop_id)
  );

COMMIT;


