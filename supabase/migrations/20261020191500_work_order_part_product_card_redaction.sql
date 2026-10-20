-- work_order_operations_read gave non-parties a part's product card (product name, manufacturer, part number as printed,
-- page) even when the part's own name or brand is withheld because it names the customer or carries contact details,
-- so the card could restate what the redaction removed. Non-parties now get product null and product_visibility
-- 'withheld_personal_info' for such a part; parties and parts with nothing withheld are unchanged. One anchored edit.
-- Contract: supabase/sql/test_work_order_part_product_card_redaction.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $edit$
DECLARE
  rd text := pg_get_functiondef('public.work_order_operations_read(uuid)'::regprocedure);
  a1 text := $a$'product', public.work_order_part_product_card(p.id),$a$;
BEGIN
  IF (length(rd)-length(replace(rd,a1,'')))/length(a1) <> 1 THEN
    RAISE EXCEPTION 'operations reader product anchor not found exactly once';
  END IF;
  EXECUTE replace(rd, a1, $r$'product', CASE WHEN party OR NOT (public.work_order_text_is_personal(w.id, p.part_name)
          OR public.work_order_text_is_personal(w.id, p.brand)) THEN public.work_order_part_product_card(p.id) END,
      'product_visibility', CASE WHEN NOT party AND (public.work_order_text_is_personal(w.id, p.part_name)
          OR public.work_order_text_is_personal(w.id, p.brand)) THEN 'withheld_personal_info' END,$r$);
END $edit$;

NOTIFY pgrst, 'reload schema';
COMMIT;
